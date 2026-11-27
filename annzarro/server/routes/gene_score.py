"""``POST /api/v1/data/gene_score``: one score per cell for a gene signature.

The body carries the recipe (a long list of gene names does not fit a request line); the dataset is named, as on
every data route, by ``?dataset_path=``, which is what the access gate and the path confinement read.
A ``dataset_path`` in the body is allowed only if it names the same dataset.

Body::

    {"recipe": {...},              # core/gene_score.py: genes, down, down_weight, input, method and its parameters, version
                                   # (method control_adjusted draws its control genes with ``seed``)
     "subset": "<spec>" | {...},   # optional: the cells shown (as ?subset= elsewhere)
     "estimate_only": false,       # answer with the cost estimate and read nothing
     "confirm": false}             # the user accepted an estimate above ``auto_max_s``

``estimate_only`` answers ``200`` JSON ``{"estimate": {entries, seconds, tier, auto_max_s, max_s,
layout, ...}, "missing": [...], "duplicated": [...], "recipe": {...}}``. The tier is ``auto`` (compute
without asking), ``confirm`` (ask once: send ``confirm: true``) or ``refused`` (``413
score_too_expensive`` when asked to compute). Without ``confirm`` a ``confirm`` tier answers ``409
confirmation_required``.

Otherwise the reply is a stream of frames, ``application/x-annzarro-score-stream``: JSON objects,
one per line, and after the ``result`` frame ``byte_length`` bytes of little-endian float32, one
value per cell shown, in the order of the cells shown. Frames: ``progress``
``{done, total, entries_done, entries_total, running_s, queue}`` (genes, stored entries, the seconds the score has
held its lane, and ``{ahead, sharing}``), then ``result`` (the vector's header, gene figures, warnings), or ``error``
``{reason, message}`` when the work fails after the stream began (the status is already 200, so a
stream that ends without a ``result`` frame has failed). A closed connection stops the work after the
read in progress.

A score takes the heavy lane of compute_stream (SHR-41). A score that has to wait for it is sent a ``progress``
frame at once, with ``done`` and ``entries_done`` 0 and its ``queue``, and another whenever its place changes; a
wait past ``QUEUE_WAIT_S`` ends in an ``error`` frame with reason ``read_busy``. A running score gives the lane way
between read batches while another job waits, so a long score delays a later one by one batch at most.
"""
import json
import logging

import numpy as np
from flask import jsonify, request

from .. import access
from ...core import gene_score, get_reader, read_guard, remote
from ...core import subset as cell_subset
from . import compute_stream, data_routes

logger = logging.getLogger(__name__)

#: Body size one request may have. There is no gene limit, so this is the bound on a gene list: 16 MiB holds about
#: 490,000 names of 30 characters (a dataset's every gene is 20,000 to 60,000, a few names of 15 to 20 characters),
#: with a subset spec and a few flags. It equals the server's own default for every request (server.max_request_mb),
#: which answers first when it is set lower.
MAX_BODY_BYTES = 16 << 20
#: Seconds a score waits for its lane and its memory before it ends with the ``read_busy`` error frame.
QUEUE_WAIT_S = 30.0
#: Seconds a remote store may be read for one score (the request deadline ends with the request itself).
REMOTE_COMPUTE_S = 1800.0
#: Seconds a remote store may be sampled for the kind of an input.
REMOTE_KIND_S = 30.0
MIMETYPE = "application/x-annzarro-score-stream"
_BODY_FIELDS = ("recipe", "subset", "estimate_only", "confirm", "force", "dataset_path")

#: The heavy lane held like a semaphore (compute_stream.Holder), by what is not a score: a test keeps the lane busy
#: through it.
_slot = compute_stream.LANES.holder("heavy")

_error = compute_stream.error_response
_frame = compute_stream.frame


def _clean(value):
    """JSON cannot hold NaN or infinity: figures that are not finite become null."""
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value


def _gene_json(stat):
    return {key: _clean(val) for key, val in stat.to_json().items()}


def _result_frame(plan, result):
    shown = result.values
    names = {"constant": [g.name for g in result.genes if g.status == "constant"],
             "no_values": [g.name for g in result.genes if g.status == "no_values"]}
    warnings = []
    if plan.missing:
        warnings.append({"code": "missing_genes", "names": plan.missing,
                         "message": f"{len(plan.missing)} gene(s) are not in this dataset and were left out."})
    if plan.duplicated:
        warnings.append({"code": "duplicate_names", "names": plan.duplicated,
                         "message": "These names occur more than once in the dataset; the first was used."})
    recipe = plan.recipe
    if recipe.overlap:
        warnings.append({"code": "genes_on_both_sides", "names": list(recipe.overlap),
                         "message": f"{len(recipe.overlap)} gene(s) were named as up and as down; they count as up."})
    if recipe.down and result.values is not None and result.n_used_down == 0:
        warnings.append({"code": "down_side_empty", "names": [],
                         "message": "None of the down genes could be scored, so only the up genes are scored."})
    if recipe.genes and result.values is not None and result.n_used_up == 0:
        warnings.append({"code": "up_side_empty", "names": [],
                         "message": "None of the up genes could be scored, so the score is the negative of the down genes' average."})
    if names["constant"] and plan.recipe.method == "zscore_mean":
        warnings.append({"code": "constant_genes", "names": names["constant"],
                         "message": "These genes have the same value in every cell and were left out of the z-score mean."})
    if names["no_values"]:
        warnings.append({"code": "no_values", "names": names["no_values"],
                         "message": "These genes have no value in any cell and were left out."})
    if plan.recipe.method == "fraction_of_total" and result.input_kind in ("log", "signed"):
        warnings.append({"code": "fraction_not_meaningful", "names": [],
                         "message": "This input looks " + ("log-transformed" if result.input_kind == "log" else "scaled")
                                    + ", so the share of the total is not meaningful. Use counts or linear normalised values."})
    return {"type": "result", "algorithm_version": gene_score.ALGORITHM_VERSION,
            "recipe": plan.recipe.describe(), "scored": shown is not None, "reason": result.reason,
            "message": gene_score.NO_SCORE_MESSAGES.get(result.reason), "n_cells": result.n_cells,
            "n_shown": result.n_shown, "n_used": result.n_used, "n_used_up": result.n_used_up,
            "n_used_down": result.n_used_down, "missing_down": plan.missing_down, "overlap": list(plan.recipe.overlap),
            "genes": [_gene_json(g) for g in result.genes],
            "missing": plan.missing, "duplicated": plan.duplicated, "warnings": warnings,
            **({"n_controls": len(result.controls or ()), "n_controls_used": result.n_controls_used,
                "binning": plan.binning} if plan.recipe.method == "control_adjusted" else {}),
            "entries_read": result.entries_read, "seconds": round(result.seconds, 3),
            "dtype": "float32", "byte_length": 0 if shown is None else int(shown.size) * 4}


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
    logger.exception("Gene score failed")
    return {"type": "error", "reason": "read_failed", "message": f"Failed to read the dataset: {exc}"}


def _progress(job, plan, done, total, entries_done):
    return {"type": "progress", "done": done, "total": total,
            **compute_stream.progress_fields(job, entries_done, plan.entries)}


def _work(plan, shown_rows, tried=None):
    """The frames and the vector of one score, given its job (the pause of ``compute``). ``tried``: the run was started
    with Try anyway: its deadline, and the first frame says so (aggregation-unify-080.md 14.6)."""
    def frames(job):
        events = None
        pause = job if tried is None else tried.pause(job)
        extra = {} if tried is None else tried.fields()
        if tried is not None:
            tried.begin()
        entries = [0]                                  # stored entries read so far (compute's on_entries)

        def read(n):
            entries[0] += n
        try:
            with remote.deadline(REMOTE_COMPUTE_S if plan.remote else None):
                events = gene_score.compute(plan, shown_rows, pause=pause, on_entries=read)
                for kind, payload in events:
                    if kind == "progress":
                        done, total = payload
                        yield _frame({**_progress(job, plan, done, total, entries[0]), **extra})
                    else:
                        yield _frame(_result_frame(plan, payload))
                        if payload.values is not None:
                            yield from compute_stream.block_bytes([payload.values.astype("<f4", copy=False)])
        except GeneratorExit:
            raise
        except gene_score.ScoreCancelled:
            if tried is not None and tried.exceeded:
                logger.info("tried score stopped at its deadline: dataset=%s estimate=%.0fs limit=%.0fs",
                            plan.dataset_path, plan.seconds, tried.max_s)
                yield _frame(tried.error_frame())
        except Exception as exc:
            yield _frame(_error_frame(exc))
        finally:
            if events is not None:
                events.close()
    return frames


def register_gene_score_routes(app_, api_version):
    @app_.route(f"/api/{api_version}/data/gene_score", methods=["POST"])
    @access.gate("dataset")
    def gene_score_route():
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
        named = body.get("dataset_path")
        if named is not None and named not in (dataset_path, access.spelled(dataset_path)):
            return _error(400, "dataset_path_conflict",
                          "dataset_path in the body must name the dataset of the request's dataset_path.")
        try:
            recipe = gene_score.parse_recipe(body.get("recipe"))
            plan = gene_score.plan(reader, dataset_path, recipe)
        except gene_score.ScoreError as exc:
            return _error(exc.status, exc.reason, exc.message, **exc.extra)
        except Exception as exc:
            return data_routes._reader_error_response(exc, dataset_path)
        estimate = plan.estimate()

        if body.get("estimate_only", False):
            return jsonify({"estimate": estimate, "missing": plan.missing, "missing_down": plan.missing_down,
                            "duplicated": plan.duplicated,
                            "recipe": recipe.describe()})
        hint = (" The matrix is stored by cell (CSR), which is slow to read by gene; a copy stored by gene "
                "(CSC) would be far faster." if plan.layout == "csr" else "")
        forced = bool(body.get("force", False))
        refusal = compute_stream.tier_refusal(
            plan.tier, body.get("confirm", False), estimate, too_expensive="score_too_expensive", forced=forced,
            refused_message=f"This score would take about {gene_score.duration(plan.seconds)}; the limit is "
                            f"{gene_score.duration(gene_score.confirm_max_s())}. Use fewer genes.{hint}",
            confirm_message=f"This score would take about {plan.seconds:.0f} seconds. "
                            "Send confirm: true to compute it.")
        if refusal is not None:
            return refusal
        tried = compute_stream.tried_run_of(forced, plan.tier, estimate)

        shown_rows = None
        if body.get("subset") is not None:
            raw = body["subset"]
            try:
                resolved = cell_subset.resolve(reader, dataset_path, raw if isinstance(raw, str) else json.dumps(raw),
                                               app_.config, client=None, low=False)
            except cell_subset.SubsetError as exc:
                return _error(exc.status, exc.reason, exc.message)
            except Exception as exc:
                return data_routes._reader_error_response(exc, dataset_path)
            shown_rows = None if resolved is None else resolved.indices

        # the heavy lane; the memory is held on the worker's ledger and with the other large reads
        n_shown = plan.n_obs if shown_rows is None else int(shown_rows.size)
        accumulators = n_shown * (8 + 2) * plan.vectors
        need = accumulators + min(gene_score.READ_AHEAD_ENTRIES, plan.entries) * 12

        def admit():
            admitted = read_guard.admit(need)
            admitted.__enter__()
            return lambda: admitted.__exit__(None, None, None)
        if tried is not None and not tried.claim():
            return compute_stream.tried_busy()
        extra = {} if tried is None else tried.fields()
        try:
            return compute_stream.respond(
                "heavy", nbytes=need, keep_bytes=accumulators, what="this score", wait_s=QUEUE_WAIT_S, admit=admit,
                work=_work(plan, shown_rows, tried), on_release=None if tried is None else tried.release,
                queued_frame=lambda job: {**_progress(job, plan, 0, len(plan.columns), 0), **extra}, mimetype=MIMETYPE,
                headers={"X-Annzarro-Score-Version": str(gene_score.ALGORITHM_VERSION)})
        except BaseException:
            if tried is not None:
                tried.release()
            raise


def register_matrix_kind_route(app_, api_version):
    """``GET /api/v1/data/matrix_kind?dataset_path=&input=X``: what the numbers of an input look like.

    ``{"input", "kind", "stats", "suggest", "checked"}``. ``kind`` is one of ``counts``, ``normalised``,
    ``log``, ``signed``, ``other`` or ``unknown`` (core/matrix_kind.py); ``suggest`` names a layer that looks
    log-normalised when the input does not (only then are the other matrices looked at). A sample of a few
    thousand stored values is read, never the matrix.
    """
    @app_.route(f"/api/{api_version}/data/matrix_kind", methods=["GET"])
    @access.gate("dataset")
    def matrix_kind_route():
        dataset_path = request.args.get("dataset_path")
        if not dataset_path:
            return _error(400, "bad_request", "dataset_path parameter is required")
        name = request.args.get("input", "X")
        if not name or len(name) > gene_score.MAX_NAME_CHARS:
            return _error(400, "bad_request", "input must be 'X' or the name of a layer.")
        try:
            reader = get_reader(dataset_path)
            with remote.deadline(REMOTE_KIND_S if remote.is_remote_path(dataset_path) else None):
                return jsonify(gene_score.matrix_kinds(reader, dataset_path, name, request.args.get("suggest", "1") != "0"))
        except gene_score.ScoreError as exc:
            return _error(exc.status, exc.reason, exc.message, **exc.extra)
        except Exception as exc:
            return data_routes._reader_error_response(exc, dataset_path)
