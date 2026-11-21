"""``POST /api/v1/data/cell_groups``: cells into groups, with features and measures per group (SHR-29).

The dataset is named, as on every data route, by ``?dataset_path=`` (what the access gate and the path confinement
read). Two shapes share the route: ``grouping`` (the groups of a list of partitionings, one code per cell, moments of
genes, scores and columns per group; ``core/cell_groups.py`` and ``core/group_features.py``) and ``grid`` (the dense
counts of a count plot; ``core/cell_grid.py``). The body is plan 1.2's::

    {"shape": "grouping" | "grid",         # default grouping
     "partitionings": [...], "sets": {...}, "subset": "<spec>" | {...},
     "small": {...}, "features": [...], "measures": [...], "want": {...},      # grouping
     "mode": "2d" | "1d" | "categorical" | "sets", "density": false,            # grid
     "estimate_only": false, "confirm": false}

A field the shape does not take is refused by the engine (``unknown_field``), a field no shape takes by the body
reader (``bad_request``). It follows the score route (``gene_score.py``) in the access gate, the CSRF check, the body
limit, ``estimate_only``, the cost tiers, ``confirm``, the framed stream and a closed connection.

Before the stream, everything is plain HTTP: ``400`` a bad request, ``404`` a missing dataset or source, ``409
confirmation_required``, ``413 groups_too_expensive`` (the tier is ``refused``) or ``request_too_large``, ``422`` a
limit (``grid_too_large``, ``too_many_partitionings``, ``obsp_too_large``).

**Stream** (``application/x-annzarro-groups-stream``), JSON lines then the binary blocks the ``result`` frame lists,
little-endian, in that order:

* ``start``: ``{codes: "hit" | "miss", lane, entries_total, queue}`` (a grid has no ``codes``). ``hit``: the grouping
  came from the worker's code cache (``CODES``, ``core/group_cache.py``) and is not resolved; ``entries_total`` is then
  the features' and measures' alone.
* ``progress``: ``{stage: groups | features | grid, done, total, entries_done, entries_total, running_s, queue}``.
* ``result``: the engine's reply (``groups``, ``partitionings``, ``features``, ``measures``, ``blocks`` for a grouping;
  ``axes``, ``measures``, ``blocks`` for a grid), or ``refused: {reason, count, limit, ...}`` and no blocks.
* ``error``: ``{reason, message}`` when the work fails after the stream began, also ``read_busy``.

**A queued request is told at once** (SHR-47): a request that has to wait for its lane or for room on the ledger is
sent a ``progress`` frame with its ``queue`` and ``done`` 0 and ``entries_done`` 0 before ``start``, and another when its
place changes. A wait past ``QUEUE_WAIT_S`` ends in the ``read_busy`` error frame.

**Lane** (SHR-41): the estimate's. ``light`` only inside the live tier and with no whole-matrix read (a gene of a CSR
or dense layer, a score, a wide obsm column, an obsp row past the live tier); everything else is ``heavy``.

**Ledger** (CMP-15): a request holds :func:`reservation` on the worker's ledger while it runs, and waits for room when
it does not fit.

**Code cache** (SHR-40, CMP-6): ``CODES`` keeps the groupings this worker resolved, within the server setting
``group_code_cache_mb``, as the ledger's evictable (emptied before any reservation waits). A grouping is looked up
before the request queues: a hit reads no column, so it takes the lane of what it still reads (its features and
measures; none: light) and reserves only that. Otherwise the grouping is looked up again when the job's turn comes:
a hit passes the codes to the engine, a miss claims the grouping, resolves it and keeps it as soon as the groups are
known (``group_features.compute``'s grouping event), before any gene is read. A request that finds its grouping
claimed by another waits for that resolve, giving its lane way meanwhile when another job waits for it.
"""
import json
import logging

from flask import jsonify, request

from .. import access
from ...core import cell_grid, cell_groups, gene_score, get_reader, read_guard, remote
from ...core import group_cache, group_features
from ...core import subset as cell_subset
from . import compute_stream, data_routes

logger = logging.getLogger(__name__)

#: Body size one request may have: 16 sets of 1M cells are 2.7 MB of base64 (CMP-9); a table of 12M cells does not
#: travel. It equals the score route's, and the server's own default for every request.
MAX_BODY_BYTES = 16 << 20
#: Seconds a request waits for its lane and its memory before it ends with the ``read_busy`` error frame.
QUEUE_WAIT_S = 30.0
#: Seconds a remote store may be read for one request.
REMOTE_COMPUTE_S = 1800.0
#: The most partitionings a request holds counted across nesting (a ``cell-group`` source holds a grouping of its
#: own): any real use is a few; a request of thousands is refused before the store is opened for any of them.
MAX_PARTITIONINGS = 64
MIMETYPE = "application/x-annzarro-groups-stream"
#: Every field a shape takes; the engine refuses, per shape, those the shape does not (``unknown_field``).
_BODY_FIELDS = ("shape", "mode", "partitionings", "sets", "small", "subset", "features", "measures", "want", "density",
                "estimate_only", "confirm")

#: Bytes of the reservation: FX-E's measured formula for a resolve (superseding E3's), E5's additions for features.
_RESOLVE_TEMPORARIES = int(0.35 * 2 ** 30)  # what a resolve works on besides its codes and its source column
_RESOLVE_PAUSE_FREES = 128 << 20          # what a resolve gives back when it gives way (FX-E: keep = full - 128 MB)
_WIDE_COMBINATIONS = 65_534               # past this many possible combinations an intersection holds 4 B a cell more
_SEGMENT_TEMPORARIES = 180 << 20          # a feature job's segment temporaries, at most
_GRID_MEASURE_AT_LIMIT = 290 << 20        # a grid measure at the cell limit: moments, codes and the lookup
_COLUMN_ITEM = 8                          # a numeric source column is held as float64 at most
_PER_GROUP = 40                           # bytes of accumulator per group and feature or measure

#: What a hit that reads genes or measures reserves beyond its features' own figures. A hit has no resolve, whose
#: 0.35 GB of temporaries covered the read's own until then: on the 95.6M-cell store one dependant of 2 genes, a hit,
#: grew by 1364 MB and 1302 MB against the 1274.5 MB reserved (E6b's session-open runs), so the features' figures alone
#: undercount real memory by up to about 90 MB. The ledger must never count less than is held.
HIT_MARGIN_BYTES = 256 << 20

#: Seconds between looks at a grouping another request is resolving (and at the lane, whether to give it way).
_PENDING_POLL_S = 0.05

_error = compute_stream.error_response
_frame = compute_stream.frame

#: The resolved groupings of this worker (SHR-40), counted on its ledger and emptied by it first when room is needed.
CODES = group_cache.GroupCache(budget=lambda: compute_stream.CODE_CACHE_BYTES,
                               room=lambda: compute_stream.LEDGER.bound - compute_stream.LEDGER.held())
compute_stream.LEDGER.register_evictable("group codes", CODES.size, CODES.clear)


def _partitionings_in(body):
    """The partitionings of the raw body counted across nesting, stopping once they are over the limit. It reads only
    the lists the engine would parse as groupings, so a malformed body is the engine's to refuse."""
    total, pending = 0, [body.get("partitionings")]
    while pending:
        parts = pending.pop()
        if not isinstance(parts, list):
            continue
        total += len(parts)
        if total > MAX_PARTITIONINGS:
            return total
        for part in parts:
            source = part.get("source") if isinstance(part, dict) else None
            recipe = source.get("recipe") if isinstance(source, dict) and source.get("type") == "cell-group" else None
            if isinstance(recipe, dict):
                pending.append(recipe.get("partitionings"))
    return total


def _level_bound(part):
    """The most levels a partitioning can have, from its recipe alone (the store's categories are not counted)."""
    if part.member is not None or part.kind == "bool":
        return 3                                            # in, out and no value
    if part.binning is not None and part.binning.method != "categories":
        b = part.binning
        bins = b.bins if b.bins is not None else len(b.thresholds or ()) + 1
        return bins + 3                                     # the bins, the zero bin, the two outsides or no value
    if part.spec.levels is not None:
        return len(part.spec.levels) + 2                    # the levels, the rest and no value
    return cell_groups.GROUP_LIMIT + 2


def _resolve_bytes(parts, n_shown, n_cells, grid=False):
    """Bytes of resolving one grouping's ``parts`` (FX-E's measurement): 4 B a cell shown, the largest numeric
    source column (8 B a cell read: of every cell for ``edges_from: all``, else of the cells shown), 0.35 GB of
    temporaries, 4 B a cell more when an intersection may hold over 65,534 combinations; a score source adds 4 B a
    cell read and its own reservation, a ``cell-group`` source its own grouping's reservation while it runs."""
    full, column, combinations = 4 * n_shown + _RESOLVE_TEMPORARIES, 0, 1
    for part in parts:
        combinations *= _level_bound(part)
        if part.nested is not None:
            full += _resolve_bytes(part.nested.parts, n_shown, n_cells)
            continue
        if part.kind != "number":
            continue
        binned_all = part.binning is not None and part.binning.edges_from == "all"
        n_source = n_cells if binned_all else n_shown
        column = max(column, _COLUMN_ITEM * n_source)
        if part.score is not None:
            accumulators, read_ahead = _score_bytes(part, n_shown)
            full += 4 * n_source + accumulators + read_ahead
    if not grid and len(parts) > 1 and combinations > _WIDE_COMBINATIONS:
        full += 4 * n_shown
    return full + column


def _score_bytes(part, n_shown):
    """``(accumulators, read-ahead)`` of a score's own reservation, as the score route holds it."""
    score = part.score
    return n_shown * (8 + 2) * score.vectors, min(gene_score.READ_AHEAD_ENTRIES, score.entries) * 12


def reservation(plan, n_shown, codes_held=False):
    """``(full, keep)`` bytes a request holds on the ledger while it runs and while it has given way.

    ``codes_held``: the grouping came from the code cache, which holds (and counts) its codes, so nothing is resolved;
    a hit that reads features or measures adds ``HIT_MARGIN_BYTES`` while it reads.

    ``plan`` is a ``group_features.Plan`` (shape grouping) or a ``cell_grid.Plan`` (shape grid); ``n_shown`` the cells
    shown. A resolve: :func:`_resolve_bytes`, FX-E's measured formula. Features and measures (E5): the read-ahead
    (12 bytes an entry, up to a gene of every cell), the segment temporaries (180 MB), the accumulators of each group
    (40 bytes per feature or measure), a column per score or measure and its score's own reservation; a grid's
    measure at the cell limit adds 290 MB.

    ``keep`` is what stays held while the job has given way: the resolve's reservation less the 128 MB it gives
    back (FX-E), the columns in hand and the accumulators; the read-ahead and the segment temporaries are given back.
    """
    grid = isinstance(plan, cell_grid.Plan)
    work = plan.work
    top = plan.axes if grid else plan.groups.top.parts
    n_cells = plan.n_cells if grid else plan.groups.n_cells
    resolve = 0 if codes_held else _resolve_bytes(top, n_shown, n_cells, grid=grid)
    features_keep, features_full = 0, 0
    for vector in work.vectors:
        held = _COLUMN_ITEM * n_shown
        features_keep += held
        features_full += held
        if vector.part.score is not None:
            accumulators, read_ahead = _score_bytes(vector.part, n_shown)
            features_keep += 4 * n_shown + accumulators
            features_full += 4 * n_shown + accumulators + read_ahead
    n_items = len(work.features) + len(work.measures)
    per_group = _PER_GROUP * cell_groups.GROUP_LIMIT * n_items
    if work.reads:
        entries = sum(read.entries for read in work.reads)
        features_full += 12 * max(min(group_features.READ_AHEAD_ENTRIES, entries), min(entries, n_cells))
        features_full += _SEGMENT_TEMPORARIES
    if grid and work.measures:
        features_full += _GRID_MEASURE_AT_LIMIT
        features_keep += _GRID_MEASURE_AT_LIMIT
    keep = max(resolve - _RESOLVE_PAUSE_FREES, 0) + features_keep + per_group
    full = resolve + features_full + per_group
    if codes_held and (work.features or work.measures):
        full += HIT_MARGIN_BYTES
    return full, min(keep, full)


def _error_frame(exc):
    """The ``error`` frame for a failure after the stream began."""
    if isinstance(exc, read_guard.ReadBusyError):
        return compute_stream.busy_frame(exc)
    if isinstance(exc, gene_score.ScoreError):
        return {"type": "error", "reason": exc.reason, "message": exc.message}
    exceeded = remote.find_deadline_exceeded(exc)
    if exceeded is not None:
        return {"type": "error", "reason": "remote_deadline", "message": str(exceeded)}
    if remote.is_timeout(exc):
        return {"type": "error", "reason": "remote_timeout", "message": f"Timed out reading the dataset: {exc}"}
    logger.exception("Cell groups failed")
    return {"type": "error", "reason": "read_failed", "message": f"Failed to read the dataset: {exc}"}


class _Job:
    """One request past its refusals: the plan, the cells shown and what the stream needs of them."""

    def __init__(self, shape, plan, rows, want_codes, cached=None):
        self.shape, self.plan, self.rows, self.want_codes = shape, plan, rows, want_codes
        self.grid = shape == "grid"
        self.cached = cached                           # the grouping from the code cache, found before queueing
        self.pinned = None                             # the cache key a hit found in the stream pinned
        self.entries = plan.entries if self.grid else plan.groups.entries
        self.lane = plan.lane if self.grid else plan.groups.lane
        if cached is not None:                         # it reads its features and measures only (SHR-41)
            work = plan.work
            live = gene_score.BASE_SECONDS + work.seconds <= gene_score.LIVE_MAX_S
            self.lane = "light" if live and not work.whole_matrix else "heavy"
        self.tier = plan.tier if self.grid else plan.groups.tier
        self.n_cells = plan.n_cells if self.grid else plan.groups.n_cells
        self.dataset_path = plan.dataset_path if self.grid else plan.groups.dataset_path
        self.n_shown = self.n_cells if rows is None else int(rows.size)
        self.sets = plan.request.sets if self.grid else plan.groups.request.sets
        self.stages = len(plan.axes) if self.grid else len(plan.groups.top.parts)

    def queued_frame(self, job):
        return {"type": "progress", "stage": "grid" if self.grid else "groups", "done": 0, "total": self.stages,
                **compute_stream.progress_fields(job, 0, self.entries)}

    def _lookup(self, job):
        """``(cached grouping or None, claim or None)``: the code cache's answer for this grouping. While another
        request resolves it for a reply that ends with the resolve, wait for that, giving the lane way when asked."""
        key = group_cache.key_of(self.dataset_path, self.plan.groups.cache_key, self.n_shown)
        if key is None:
            return None, None
        while True:
            # every claim is filled as soon as its groups are known (the grouping event), so each may be waited for
            found = CODES.begin(key, self.plan.groups.request.histograms, prompt=True, pin=True)
            if isinstance(found, group_cache.Hit):
                self.pinned = key                      # unpinned when the stream ends
                return found.result, None
            if isinstance(found, group_cache.Claim):
                return None, found
            while not found.wait(_PENDING_POLL_S):
                if job.wanted():                       # the resolver may be the job this one would wait behind
                    job.wait()

    def frames(self, job):
        """The bytes of the stream, given the job the lane gave (the pause of the engine)."""
        events, claim = None, None
        entries = [0]                                  # stored entries read so far (the engine's on_entries)

        def read(n):
            entries[0] += n
        try:
            with remote.deadline(REMOTE_COMPUTE_S if remote.is_remote_path(self.dataset_path) else None):
                start, total, cached = {"type": "start"}, self.entries, None
                if not self.grid:
                    cached, claim = (self.cached, None) if self.cached is not None else self._lookup(job)
                    start["codes"] = "miss" if cached is None else "hit"
                    if cached is not None:
                        total = self.plan.work.entries            # the grouping's own entries are not read
                yield _frame({**start, "lane": self.lane, "entries_total": total, "queue": job.queue()})
                if self.grid:
                    events = cell_grid.compute(self.plan, self.rows, pause=job)
                else:
                    events = group_features.compute(self.plan, self.rows, codes=cached, pause=job, on_entries=read,
                                                    grouping_event=True)
                for kind, payload in events:
                    if kind == "grouping":                     # the groups are known: keep them before any gene is read
                        if claim is not None:
                            claim.fill(payload)
                        continue
                    if kind == "progress":
                        done = entries[0] if not self.grid else payload.get("entries_done", 0)
                        yield _frame({"type": "progress", **payload,
                                      **compute_stream.progress_fields(job, done, total)})
                        continue
                    head, blocks = payload.to_reply() if self.grid else payload.to_reply(self.want_codes)
                    yield _frame(head)
                    yield from compute_stream.block_bytes([array for _, array in blocks])
        except GeneratorExit:
            raise
        except gene_score.ScoreCancelled:
            return
        except Exception as exc:
            yield _frame(_error_frame(exc))
        finally:
            if claim is not None:
                claim.abandon()
            if self.pinned is not None:
                CODES.unpin(self.pinned)
                self.pinned = None
            if events is not None:
                events.close()


def _refusal(job, body, plan_layout):
    """The plain-HTTP answer to a cost tier that may not run now, or None."""
    hint = (" The matrix is stored by cell (CSR), which is slow to read by gene; a copy stored by gene "
            "(CSC) would be far faster." if plan_layout == "csr" else "")
    seconds = job.plan.estimate()["seconds"]
    return compute_stream.tier_refusal(
        job.tier, body.get("confirm", False), job.plan.estimate(), too_expensive="groups_too_expensive",
        refused_message=f"This would take about {seconds / 60:.0f} minutes; the limit is "
                        f"{gene_score.CONFIRM_MAX_S / 60:.0f}. Use fewer genes or groups, or a subset.{hint}",
        confirm_message=f"This would take about {seconds:.0f} seconds. Send confirm: true to compute it.")


def register_cell_groups_routes(app_, api_version):
    @app_.route(f"/api/{api_version}/data/cell_groups", methods=["POST"])
    @access.gate("dataset")
    def cell_groups_route():
        dataset_path = request.args.get("dataset_path")
        if not dataset_path:
            return _error(400, "bad_request", "dataset_path parameter is required")
        try:
            reader = get_reader(dataset_path)    # a missing store answers before the body is looked at, as on every route
        except Exception as exc:
            return data_routes._reader_error_response(exc, dataset_path)
        body, refusal = compute_stream.read_body(_BODY_FIELDS, MAX_BODY_BYTES)
        if refusal:
            return _error(*refusal)
        count = _partitionings_in(body)
        if count > MAX_PARTITIONINGS:
            return _error(422, "too_many_partitionings",
                          f"A request holds at most {MAX_PARTITIONINGS} partitionings, groupings used as sources "
                          f"included; this one holds {count} or more.", count=count, limit=MAX_PARTITIONINGS)
        try:
            if body.get("shape") == "grid":
                shape, parsed = "grid", cell_grid.parse_request(body)
                plan = cell_grid.plan(reader, dataset_path, parsed)
                missing = {}
            else:
                shape, parsed = "grouping", cell_groups.parse_request(body)
                plan = group_features.plan(reader, dataset_path, parsed)
                missing = plan.missing
        except gene_score.ScoreError as exc:
            return _error(exc.status, exc.reason, exc.message, **exc.extra)
        except Exception as exc:
            return data_routes._reader_error_response(exc, dataset_path)
        job = _Job(shape, plan, None, shape == "grouping" and parsed.want_codes)
        estimate = plan.estimate()

        if parsed.estimate_only:
            return jsonify({"estimate": estimate, "missing": missing})
        refusal = _refusal(job, body, estimate["layout"])
        if refusal is not None:
            return refusal

        rows = None
        if body.get("subset") is not None:
            raw = body["subset"]
            try:
                resolved = cell_subset.resolve(reader, dataset_path, raw if isinstance(raw, str) else json.dumps(raw),
                                               app_.config, client=None, low=False)
            except cell_subset.SubsetError as exc:
                return _error(exc.status, exc.reason, exc.message)
            except Exception as exc:
                return data_routes._reader_error_response(exc, dataset_path)
            rows = None if resolved is None else resolved.indices
        job = _Job(shape, plan, rows, job.want_codes)
        for ref, members in job.sets.items():
            if members.size != job.n_shown:
                return _error(400, "set_length_mismatch",
                              f"Set '{ref}' has {members.size} cells; the request shows {job.n_shown}.",
                              count=int(members.size), shown=job.n_shown)
        unpin = None
        if shape == "grouping":                        # a hit reads no column: its lane and memory are its features'
            key = group_cache.key_of(dataset_path, plan.groups.cache_key, job.n_shown)
            cached = None if key is None else CODES.peek(key, parsed.histograms, pin=True)
            if cached is not None:                     # pinned until the stream ends, however it ends
                job = _Job(shape, plan, rows, job.want_codes, cached=cached)
                unpin = lambda: CODES.unpin(key)       # noqa: E731

        full, keep = reservation(plan, job.n_shown, codes_held=job.cached is not None)

        def admit():
            if job.lane != "heavy":
                return lambda: None
            admitted = read_guard.admit(full)
            admitted.__enter__()
            return lambda: admitted.__exit__(None, None, None)
        return compute_stream.respond(
            job.lane, nbytes=full, keep_bytes=keep, what="this request", wait_s=QUEUE_WAIT_S, admit=admit,
            admit_bytes=full if job.lane == "heavy" else 0, on_release=unpin,
            work=job.frames, queued_frame=job.queued_frame, mimetype=MIMETYPE,
            headers={"X-Annzarro-Groups-Version": str(cell_groups.ALGORITHM_VERSION)})
