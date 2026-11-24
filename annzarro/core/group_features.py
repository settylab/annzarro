"""Features and measures per group: the moments a Cell-Gene Plot and a count plot are drawn from (SHR-19 to SHR-21,
CMP-2, CMP-16).

A *feature* is one row of the gene axis: a gene of a matrix (``X`` or a layer) with its expression threshold, or a
per-cell score with its threshold. A *measure* is one numeric per-cell source (an obs column, an obsm or obsp
column, a gene of a layer, or a score) with its threshold. For every group, and every feature or measure, the
server sends five moments over the cells of the group with a finite value ``x``::

    n          cells with a finite value
    sum        sum of x
    sumsq      sum of x squared
    n_above    cells with x > t            t: the feature's detect_above (a gene) or above (a score, a measure)
    sum_above  sum of x over those cells

The browser derives every statistic and every scaling from them (SHR-19), so a change of statistic costs no request.
A non-finite value is left out of all five (SHR-20). Cells in no group (``rest: 'exclude'``, a hidden small group, no
value) are in no group's moments, so pooling the groups pools the grouped cells only (OD 12). ``sum_above`` is sent at
every threshold, 0 included: the mean of expressing cells needs it on a signed matrix too. Whether a statistic is
offered on a layer (OD 8, SHR-27) is the browser's decision, from the existing matrix-kind fact; the moments are
always all five.

Reads. Each gene of a matrix is read once, whatever number of features want it: the colour and the size of a row
(OD 15), two thresholds, two sections, and a score of the same matrix, whose reads the features take their genes
from (``gene_score.compute``'s ``on_read``). A score is computed once for every feature and measure that asks for
it, through the score engine. A gene a score was to read and did not (it stopped first, as when no control gene can
be drawn) is read afterwards, so a score without a result never costs a feature its moments. Gene reads go through the score engine's
``pipeline``, so memory is the read-ahead (``READ_AHEAD_ENTRIES``) whatever the number of genes, and one gene is worked
through ``SEGMENT_ENTRIES`` entries at a time (CMP-2). A sparse gene costs its stored entries: a cell without an entry
holds zero, which adds to ``n`` only (and to ``n_above`` under a negative threshold).

Giving way (SHR-41). ``pause`` (``wanted()``, ``wait()``) is the pipeline's: between batches the reads in flight are
handed out and ``wait()`` is called with nothing read ahead. Score reads take the same pause through the score
engine, and a measure's slabs and a score's per-cell pass ask it between slabs.

The wire (``features`` and ``measures`` of the request, plan 1.2)::

    {"id": "f0", "kind": "gene", "name": "Cd3e", "layer": "X", "detect_above": 0}
    {"id": "f1", "kind": "score", "recipe": {...}, "column": "mean", "layer": "logged", "above": 0}
    {"id": "m0", "source": {"type": "obs", "key": "total_counts"}, "above": 0}

``layer`` defaults to ``X`` and the thresholds to 0. A score's ``recipe`` is the score route's; ``column`` (the
method) and ``layer`` (the input) are optional and override it, as for a ``gene-score`` partitioning source. A
measure's ``source`` is a partitioning source of a per-cell number: ``obs``, ``obsm``, ``layer``, ``obsp`` or
``gene-score``.

Two shapes use this module. ``plan`` and ``compute`` answer a ``grouping`` request: the groups of
``core/cell_groups.py``, then the moments of each group. ``plan_work`` and ``accumulate`` take any one code per cell
shown, so the ``grid`` shape (``core/cell_grid.py``) gets a measure's moments per grid cell from them.
"""
from __future__ import annotations

import dataclasses
import json
import math
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, List, Optional, Sequence, Tuple

import numpy as np

from . import cell_groups as cg
from . import cell_sources as cs
from . import cost_limits
from . import gene_score as gs
from .remote import is_remote_path

ALGORITHM_VERSION = 1

#: The five moments of every group, in the order of the blocks' last axis.
MOMENTS = ("n", "sum", "sumsq", "n_above", "sum_above")

#: The most grid cells a measure is accumulated over: 512 x 512 x 8, the largest grid (SHR-39). The default of
#: limits.grid_cells; ``grid_cells()`` is the value in force.
MAX_GRID_MEASURE_CELLS = cost_limits.COST_LIMITS["grid_cells"].default

#: Entries a feature job reads ahead of its arithmetic: a quarter of the score engine's (``READ_AHEAD_ENTRIES``), so
#: within CMP-2's bound. The arithmetic, not the read, is the slower side (it holds the GIL), so a deeper read-ahead
#: only holds memory: at 1M cells it is as fast, and 2,000 genes then hold what 200 do.
READ_AHEAD_ENTRIES = 12_000_000

#: The most values (groups x (features + measures)) one grouping request accumulates: CXG-17's matrix limit, which
#: the browser keeps to, so the accumulators stay under 16 MB (40 B a value). A request over it is refused once its
#: groups are known. ``accumulate`` itself holds at most ``MAX_GRID_MEASURE_CELLS`` values, whatever its caller.
MAX_FEATURE_CELLS = cost_limits.COST_LIMITS["matrix_values"].default

#: The most measures one request carries. A count plot sends one (CNT-16); a grouping's are bounded by the value
#: limit as well, and this bounds the planning before the groups are known.
MAX_MEASURES = cost_limits.COST_LIMITS["measures"].default

#: The most distinct thresholds one gene of one matrix, or one vector, is compared with. The interface asks for two
#: at most (a row's colour and its size); each costs a pass over the gene's entries that the estimate does not
#: charge, so more are refused before anything is read.
MAX_THRESHOLDS = cost_limits.COST_LIMITS["thresholds"].default


def grid_cells() -> int:
    """The most grid cells, and values a measure accumulates, in force (limits.grid_cells)."""
    return cost_limits.get("grid_cells")


def feature_cells() -> int:
    """The most values one grouping request accumulates, in force (limits.matrix_values)."""
    return cost_limits.get("matrix_values")

_GENE_FIELDS = ("id", "kind", "name", "layer", "detect_above", "transform", "clip")
#: The transforms a gene feature takes: its z-score over all cells of the dataset (design aggregation-unify 2.1).
TRANSFORMS = ("zscore",)
_SCORE_FIELDS = ("id", "kind", "recipe", "column", "layer", "above")
_MEASURE_FIELDS = ("id", "source", "above")
_NUMERIC_SOURCES = ("obs", "obsm", "layer", "obsp", "gene-score")


def _bad(message: str, reason: str = "bad_request", **extra) -> cg.GroupError:
    return cg.GroupError(400, reason, message, **extra)


# --------------------------------------------------------------------------------------------------------------
# The request
# --------------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Feature:
    id: str
    kind: str                               # gene | score
    threshold: float                        # a gene's detect_above, a score's above
    name: Optional[str] = None              # a gene
    layer: str = "X"                        # a gene's matrix
    source: Optional[Dict[str, Any]] = None  # a score, as a gene-score source
    transform: Optional[str] = None         # a gene: None (the raw values) or "zscore"
    clip: Optional[float] = None            # a z-scored gene: the clip (None: not clipped)

    @property
    def variant(self) -> Tuple[Optional[str], Optional[float]]:
        """What a gene is read as: two features of one gene and one variant share their moments."""
        return (self.transform, self.clip if self.transform else None)


@dataclass(frozen=True)
class Measure:
    id: str
    source: Dict[str, Any]
    threshold: float = 0.0


def _id(raw: Dict[str, Any], what: str, seen: set) -> str:
    fid = raw.get("id")
    if not isinstance(fid, str) or not fid:
        raise _bad(f"Every {what} needs an id.", "bad_feature" if what == "feature" else "bad_request")
    if fid in seen:
        raise _bad(f"Two {what}s are called '{fid}'.", "duplicate_id", id=fid)
    seen.add(fid)
    return fid


def _threshold(raw: Dict[str, Any], name: str) -> float:
    v = raw.get(name, 0)
    if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(float(v)):
        raise _bad(f"{name} must be a finite number.", "bad_threshold")
    return float(v)


def parse_features(raw: Any) -> Tuple[Feature, ...]:
    """Validate ``features``. Refusals are ``cell_groups.GroupError`` (400), or the score engine's own for a recipe."""
    if not isinstance(raw, (list, tuple)):
        raise _bad("features must be a list.", "bad_feature")
    seen: set = set()
    out = []
    for f in raw:
        if not isinstance(f, dict):
            raise _bad("A feature must be an object.", "bad_feature")
        kind = f.get("kind")
        if kind == "gene":
            cg._unknown(f, _GENE_FIELDS, "a gene feature")
            fid = _id(f, "feature", seen)
            name, layer = f.get("name"), f.get("layer", "X")
            if not isinstance(name, str) or not name:
                raise _bad("A gene feature names its gene.", "bad_feature", id=fid)
            if not isinstance(layer, str) or not layer:
                raise _bad("layer must be 'X' or the name of a layer.", "bad_feature", id=fid)
            transform, clip = None, None
            if "transform" in f:
                if f["transform"] not in TRANSFORMS:
                    raise _bad(f"transform is {', '.join(repr(t) for t in TRANSFORMS)}.", "bad_feature", id=fid)
                transform = f["transform"]
                clip = gs.parse_clip(f["clip"]) if "clip" in f else gs.DEFAULT_CLIP
            elif "clip" in f:
                raise _bad("clip belongs to a transform.", "bad_feature", id=fid)
            out.append(Feature(fid, "gene", _threshold(f, "detect_above"), name=name, layer=layer,
                               transform=transform, clip=clip))
        elif kind == "score":
            cg._unknown(f, _SCORE_FIELDS, "a score feature")
            fid = _id(f, "feature", seen)
            if not isinstance(f.get("recipe"), dict):
                raise _bad("A score feature carries its recipe.", "bad_feature", id=fid)
            source = {"type": "gene-score", **{k: f[k] for k in ("recipe", "column", "layer") if k in f}}
            gs.parse_recipe(_recipe_of(source))                       # refused here, before anything is planned
            out.append(Feature(fid, "score", _threshold(f, "above"), source=source))
        else:
            raise _bad("A feature's kind is 'gene' or 'score'.", "bad_feature")
    return tuple(out)


def parse_measures(raw: Any) -> Tuple[Measure, ...]:
    """Validate ``measures``: a numeric per-cell source each, with ``above``."""
    if not isinstance(raw, (list, tuple)):
        raise _bad("measures must be a list.")
    most = cost_limits.get("measures")
    if len(raw) > most:
        raise _bad(f"A request has at most {most} measures; this one has {len(raw)}.", "too_many_measures",
                   count=len(raw), limit=most)
    seen: set = set()
    out = []
    for m in raw:
        if not isinstance(m, dict):
            raise _bad("A measure must be an object.")
        cg._unknown(m, _MEASURE_FIELDS, "a measure")
        mid = _id(m, "measure", seen)
        if not isinstance(m.get("source"), dict):
            raise _bad("A measure needs a source object.", id=mid)
        source, _ = cg._parse_source(m["source"], 0)
        if source["type"] not in _NUMERIC_SOURCES:
            raise _bad(f"A measure is a number per cell; a {source['type']} source is not.", "not_numeric", id=mid)
        out.append(Measure(mid, source, _threshold(m, "above")))
    return tuple(out)


def _recipe_of(source: Dict[str, Any]) -> Dict[str, Any]:
    """A gene-score source's recipe with its ``column`` (method) and ``layer`` (input) applied."""
    raw = dict(source["recipe"])
    if source.get("column") is not None:
        raw["method"] = source["column"]
    if source.get("layer") is not None:
        raw["input"] = source["layer"]
    return raw


# --------------------------------------------------------------------------------------------------------------
# The plan
# --------------------------------------------------------------------------------------------------------------


@dataclass
class _MatrixRead:
    """The genes the features read from one matrix: every gene they want (``thresholds``), of which ``columns`` are
    read here and the rest ride on a score's read of the same matrix (``gene_score.compute``'s ``on_read``)."""
    layer: str
    thresholds: Dict[int, Dict[Tuple, List[float]]]     # column -> variant (transform, clip) -> distinct thresholds
    columns: List[int] = field(default_factory=list)    # read here, distinct, ascending
    entries: int = 0
    layout: str = ""


@dataclass
class _Vector:
    """One number per cell shown that features or measures take their moments of: a score or a stored column."""
    part: cg.PartPlan                                   # planned as a partitioning source would be
    thresholds: List[float]                             # distinct, in order of first use


@dataclass
class Work:
    """What the features and measures read, and what that costs, before anything is read."""
    features: Tuple[Feature, ...]
    measures: Tuple[Measure, ...]
    n_cells: int
    reads: List[_MatrixRead]
    vectors: List[_Vector]
    gene_target: Dict[str, Tuple[int, int, Tuple, float]]   # gene feature id -> (read, column, variant, threshold);
    #                                                         absent: missing
    vector_of: Dict[Tuple[str, str], int]               # ("feature" | "measure", id) -> vector
    missing: List[str]                                  # gene names not in the dataset, in request order
    entries: int
    seconds: float
    whole_matrix: bool                                  # a read decodes the whole matrix (SHR-41)
    layouts: List[str]

    @property
    def items(self) -> int:
        """Units of progress: each gene read, each gene of each score, each stored column."""
        return sum(len(r.columns) for r in self.reads) + sum(
            len(v.part.score.columns) if v.part.score is not None else 1 for v in self.vectors)


def _add_threshold(ts: List[float], threshold: float, fid: str) -> None:
    """Add a distinct threshold, in order of first use; refuse past ``MAX_THRESHOLDS``."""
    if threshold in ts:
        return
    most = cost_limits.get("thresholds")
    if len(ts) >= most:
        raise cg.GroupError(422, "too_many_thresholds", f"One gene or source is compared with at most "
                            f"{most} thresholds; '{fid}' asks for one more.", count=len(ts) + 1,
                            limit=most, id=fid)
    ts.append(threshold)


def _vector_key(source: Dict[str, Any]) -> str:
    """What makes two vectors the same: a score's effective recipe (not the panel it comes from), or a stored
    column's setting."""
    what: Dict[str, Any] = dict(source)
    if source["type"] == "gene-score":
        r = gs.parse_recipe(_recipe_of(source))
        what = {"score": {**r.describe(), "genes": list(r.genes), "down": list(r.down)}}
    return json.dumps(what, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def plan_work(reader, dataset_path: str, features: Sequence[Feature] = (), measures: Sequence[Measure] = ()) -> Work:
    """Resolve the genes and sources against the store and estimate the reads (CMP-1). Reads no gene.

    A gene costs its stored entries (a CSR or dense matrix the entries its batches decode) at the score engine's
    rates; a score its own estimate less the fixed cost already counted; a stored column what a partitioning on
    it costs, the pass over its cells included. Such a pass is charged to a score too.
    """
    remote = is_remote_path(dataset_path)
    with cs.root(reader, dataset_path) as root:
        n_cells = cs.n_cells(root)
    request = cg.Request(shape="grouping", grouping=cg.Grouping(()), sets={}, set_hashes={})   # no nested grouping
    reads: List[_MatrixRead] = []
    gene_target: Dict[str, Tuple[int, int, Tuple, float]] = {}
    missing: List[str] = []
    genes = [f for f in features if f.kind == "gene"]
    by_layer: Dict[str, List[Feature]] = {}
    for f in genes:
        by_layer.setdefault(f.layer, []).append(f)
    var_names = reader.get_cell_gene_names(dataset_path, "genes") if genes else []
    seconds, entries, whole, layouts = 0.0, 0, False, set()
    for layer, fs in by_layer.items():
        column_of, absent, _ = gs._resolve_names(var_names, [f.name for f in fs])
        thresholds: Dict[int, Dict[Tuple, List[float]]] = {}
        for f in fs:
            col = column_of.get(f.name)
            if col is None:
                continue
            _add_threshold(thresholds.setdefault(col, {}).setdefault(f.variant, []), f.threshold, f.id)
            gene_target[f.id] = (len(reads), col, f.variant, f.threshold)
        missing += [n for n in absent if n not in missing]
        reads.append(_MatrixRead(layer, thresholds))
    vectors: List[_Vector] = []
    index: Dict[str, int] = {}
    vector_of: Dict[Tuple[str, str], int] = {}
    wanted = [("feature", f.id, f.source, f.threshold) for f in features if f.kind == "score"] + \
        [("measure", m.id, m.source, m.threshold) for m in measures]
    for what, fid, source, threshold in wanted:
        key = _vector_key(source)
        if key not in index:
            part = cg._plan_part(reader, dataset_path, cg.Partitioning(source=source), request, n_cells, remote)
            if part.kind != "number":
                raise _bad(f"Measure '{fid}' is not a number per cell.", "not_numeric", id=fid)
            index[key] = len(vectors)
            vectors.append(_Vector(part, []))
            seconds += part.seconds
            entries += part.entries
            whole = whole or part.whole_matrix
            if part.entries:
                layouts.add(part.layout)
        _add_threshold(vectors[index[key]].thresholds, threshold, fid)
        vector_of[(what, fid)] = index[key]
    for read in reads:
        # a gene a score of the same matrix reads for sure (its signature, up and down) is counted there, once
        shared = {c for v in vectors if v.part.score is not None and v.part.score.recipe.input == read.layer
                  for c in v.part.score.columns}
        with gs.open_source(reader, dataset_path, read.layer) as source:
            read.columns = sorted(c for c in read.thresholds if c not in shared)
            read.entries = int(source.entries(read.columns)) if read.columns else 0
            read.layout = source.layout
        if read.columns:
            seconds += cg._rate_seconds(read.layout, read.entries, remote)
            entries += read.entries
            whole = whole or read.layout in ("csr", "dense")             # as a layer partitioning (cell_groups)
            layouts.add(read.layout)
    return Work(features=tuple(features), measures=tuple(measures), n_cells=n_cells, reads=reads, vectors=vectors,
                gene_target=gene_target, vector_of=vector_of, missing=missing, entries=entries, seconds=seconds,
                whole_matrix=whole, layouts=sorted(layouts))


@dataclass
class Plan:
    """A grouping request with its features and measures: ``groups`` is the grouping's plan with the reads of
    ``work`` added to its estimate, tier and lane; its ``cache_key`` stays the codes' own."""
    groups: cg.Plan
    work: Work

    @property
    def missing(self) -> Dict[str, Any]:
        return {"genes": list(self.work.missing)} if self.work.missing else {}

    def estimate(self) -> Dict[str, Any]:
        return self.groups.estimate()


def plan(reader, dataset_path: str, request: cg.Request) -> Plan:
    """Plan the grouping (``cell_groups.plan``) and its features and measures. Reads no column.

    The lane is light only when the whole request is in the live tier and nothing reads a whole matrix: a gene of a
    CSR or dense matrix, a score, or a source that does (SHR-41). A gene of a CSC matrix inside the live tier is light.
    """
    groups = cg.plan(reader, dataset_path, request)
    work = plan_work(reader, dataset_path, parse_features(request.features), parse_measures(request.measures))
    if not work.features and not work.measures:
        return Plan(groups, work)
    seconds = groups.seconds + work.seconds
    layouts = sorted({p.layout for p in groups.top.all_parts() if p.entries} | set(work.layouts))
    light = groups.lane == "light" and not work.whole_matrix and seconds <= gs.live_max_s()
    merged = dataclasses.replace(groups, seconds=seconds, entries=groups.entries + work.entries,
                                 tier=gs.tier_of(seconds), lane="light" if light else "heavy",
                                 layout=layouts[0] if len(layouts) == 1 else ("mixed" if layouts else "column"))
    return Plan(merged, work)


# --------------------------------------------------------------------------------------------------------------
# Moments of one value per cell
# --------------------------------------------------------------------------------------------------------------


class _Bins:
    """Where each cell's values go: its code, and every code past the last group into one bin that is dropped.

    ``codes`` is one code per cell shown. A gene's entries are by dataset row, so with a subset shown the codes are
    spread over the dataset's rows once (``by_row``, a cell not shown in no group); with every cell shown the codes
    are that already.
    """

    def __init__(self, codes: np.ndarray, k: int, rows: Optional[np.ndarray], n_obs: int):
        self.k = k
        self.codes = codes
        self.narrow = codes.dtype == np.uint8                  # 256 bins: no clipping needed
        self.n_bins = 256 if self.narrow else k + 1
        if rows is None:
            self.by_row = codes
        else:
            self.by_row = np.full(n_obs, np.iinfo(codes.dtype).max, dtype=codes.dtype)
            self.by_row[rows] = codes

    def index(self, codes: np.ndarray) -> np.ndarray:
        """Bin indices (intp) of the given codes."""
        if self.narrow:
            return codes.astype(np.intp)
        return np.minimum(codes, self.k).astype(np.intp)


#: The running per-bin sums (``gene_score.MomentSums``, shared with the genes shape's ``row_moments``).
_Sums = gs.MomentSums


def _segments(n: int) -> Iterator[Tuple[int, int]]:
    step = max(int(gs.SEGMENT_ENTRIES), 1)
    for a in range(0, n, step):
        yield a, min(a + step, n)


def _gene_moments(bins: _Bins, sizes: np.ndarray, rows: Optional[np.ndarray], values: np.ndarray,
                  thresholds: Sequence[float], outs: Sequence[Sequence[np.ndarray]],
                  should_stop: Optional[Callable[[], bool]] = None,
                  transform: Optional[Callable[[np.ndarray], np.ndarray]] = None) -> None:
    """One gene's moments per code at each threshold, into ``outs`` (as ``_Sums.write``): its stored entries
    (``rows`` the dataset rows) or its whole column (``rows`` None), ``SEGMENT_ENTRIES`` at a time (CMP-2).

    ``should_stop`` is asked before each segment. A pause is not: this runs while the pipeline holds reads in
    flight (its own, or a score's through ``on_read``), and the pipeline waits only with none, between its reads.
    With at most ``MAX_THRESHOLDS`` thresholds one gene's arithmetic is a few passes over its entries.
    ``transform`` maps each segment's values before they are summed (a z-scored gene, ``_zgene_moments``)."""
    sums = _Sums(bins.n_bins, thresholds)
    if rows is not None:
        rows, values = gs._canonical(np.asarray(rows), np.asarray(values))
    for a, b in _segments(values.size):
        if should_stop is not None and should_stop():
            raise gs.ScoreCancelled()
        chunk = values[a:b] if transform is None else transform(values[a:b])
        sums.add(bins.index(bins.by_row[a:b] if rows is None else bins.by_row[rows[a:b]]), chunk)
    sums.write(sizes, outs)


def _zgene_moments(bins: _Bins, sizes: np.ndarray, n_obs: int, rows: Optional[np.ndarray], values: np.ndarray,
                   clip: Optional[float], thresholds: Sequence[float], outs: Sequence[Sequence[np.ndarray]],
                   should_stop: Optional[Callable[[], bool]] = None) -> bool:
    """The moments of one gene's z-score, ``clip(((x - mean) / sd), +-clip)``, per code at each threshold, into
    ``outs``; False, with ``outs`` untouched, when the gene has no spread. Mean and SD are over every cell of the
    dataset (``gene_score.gene_reference``), whatever cells are shown.

    A sparse gene's cell with no stored entry holds ``z0 = z(0)``. The stored entries go through the moments as
    ``d = z - z0`` at the threshold ``t - z0`` (a cell with no entry is a ``d`` of 0), and each group is put right:
    with ``n`` its cells with a value, ``sum_d`` and ``sum_above_d`` the moments of ``d``::

        sumsq += 2 z0 sum_d + n z0^2      sum += n z0      sum_above += n_above z0

    A dense column has ``z0 = 0`` and nothing to put right. A non-finite value stays non-finite and is left out."""
    if rows is not None:
        rows, values = gs._canonical(np.asarray(rows), np.asarray(values))
    ref = gs.gene_reference(values, n_obs)
    if ref.constant:
        return False
    mean, sd = ref.mean, ref.sd

    def z(x: np.ndarray) -> np.ndarray:
        out = (x - mean) / sd
        return out if clip is None else np.clip(out, -clip, clip)

    z0 = 0.0
    if rows is not None:
        z0 = float(z(np.float64(0.0)))

    def shifted(chunk: np.ndarray) -> np.ndarray:
        x = chunk.astype(np.float64)
        finite = np.isfinite(x)
        if finite.all():
            return z(x) - z0
        out = x                                                     # a non-finite value stays as it is
        out[finite] = z(x[finite]) - z0
        return out

    _gene_moments(bins, sizes, rows, values, [t - z0 for t in thresholds], outs, should_stop, transform=shifted)
    if z0:
        for per_threshold in outs:
            for m in per_threshold:
                n, sum_d = m[:, 0], m[:, 1].copy()
                m[:, 2] += 2.0 * z0 * sum_d + n * z0 * z0
                m[:, 1] += n * z0
                m[:, 4] += m[:, 3] * z0
    return True


# --------------------------------------------------------------------------------------------------------------
# Accumulating
# --------------------------------------------------------------------------------------------------------------


@dataclass
class Moments:
    """The moments of every feature and measure: float64 ``[items, codes, 5]`` blocks, in request order."""
    features: Optional[np.ndarray]
    feature_status: List[Dict[str, Any]]
    measures: Optional[np.ndarray]
    measure_status: List[Dict[str, Any]]


def accumulate(work: Work, reader, dataset_path: str, rows: Optional[np.ndarray], codes: np.ndarray, n_codes: int, *,
               sizes: Optional[np.ndarray] = None, sets: Optional[Dict[str, np.ndarray]] = None,
               should_stop: Optional[Callable[[], bool]] = None, pause=None,
               on_entries: Optional[Callable[[int], None]] = None) -> Iterator[Tuple[str, Any]]:
    """The moments of ``work`` over ``n_codes`` codes, from one code per cell shown (``rows``: sorted dataset rows,
    None for every cell); a code of ``n_codes`` or more is in none. ``sizes`` are the cells per code when known.

    Yields ``("progress", {"stage": "features", "done", "total", "entries_done", "entries_total"})`` and a final
    ``("result", Moments)``. ``on_entries(n)`` is told the stored entries as they are read; the calls add up to
    ``work.entries``. ``should_stop`` and ``pause`` are asked between batches and slabs.
    """
    most = grid_cells()
    if n_codes > most:
        raise cg.GroupError(422, "grid_too_large", f"Measures are accumulated over at most "
                            f"{most:,} cells; this asks for {n_codes:,}.", count=int(n_codes),
                            limit=most)
    values = int(n_codes) * (len(work.features) + len(work.measures))
    if values > most:                                    # the blocks below: 40 B a value, 84 MB at the default
        raise cg.GroupError(422, "too_many_values", f"At most {most:,} values are accumulated; "
                            f"this asks for {values:,}.", count=values, limit=most)
    rows = None if rows is None else np.asarray(rows, dtype=np.int64)
    bins = _Bins(np.asarray(codes), int(n_codes), rows, work.n_cells)
    if sizes is None:
        sizes = np.zeros(n_codes, dtype=np.int64)
        for a, b in cs._spans(bins.codes.size):
            sizes += np.bincount(bins.index(bins.codes[a:b]), minlength=bins.n_bins)[:n_codes]
    sizes = np.asarray(sizes, dtype=np.float64)
    features = np.zeros((len(work.features), int(n_codes), 5)) if work.features else None
    measures = np.zeros((len(work.measures), int(n_codes), 5)) if work.measures else None
    # where each sum goes: (read, column, threshold) and (vector, threshold) -> rows of the blocks
    gene_rows: Dict[Tuple[int, int, Tuple, float], List[np.ndarray]] = {}
    vector_rows: Dict[Tuple[int, float], List[np.ndarray]] = {}
    for i, f in enumerate(work.features):
        if f.kind == "score":
            vector_rows.setdefault((work.vector_of[("feature", f.id)], f.threshold), []).append(features[i])
        elif f.id in work.gene_target:
            gene_rows.setdefault(work.gene_target[f.id], []).append(features[i])
    for i, m in enumerate(work.measures):
        vector_rows.setdefault((work.vector_of[("measure", m.id)], m.threshold), []).append(measures[i])
    vector_status: List[Dict[str, Any]] = [{"status": "ok"} for _ in work.vectors]
    progress = {"stage": "features", "done": 0, "total": work.items, "entries_done": 0,
                "entries_total": work.entries}

    def told(n: int) -> None:
        progress["entries_done"] += int(n)
        if on_entries is not None:
            on_entries(n)

    done: List[set] = [set() for _ in work.reads]             # columns whose moments are written, per read
    constant: set = set()                                     # (read, column) of a gene with no spread, for a z-score

    def take(r: int, rows_values) -> None:
        """The moments of the genes of read ``r`` in one matrix read (its own, or a score's)."""
        read = work.reads[r]
        for col, at, values in rows_values:
            if col in read.thresholds and col not in done[r]:
                values = np.asarray(values)
                for variant, ts in read.thresholds[col].items():
                    outs = [gene_rows[(r, col, variant, t)] for t in ts]
                    if variant[0] is None:
                        _gene_moments(bins, sizes, at, values, ts, outs, should_stop)
                    elif not _zgene_moments(bins, sizes, work.n_cells, at, values, variant[1], ts, outs,
                                            should_stop):
                        constant.add((r, col))
                done[r].add(col)

    def settle(items: int, entries0: int, planned: int) -> None:
        """Once a read or a score ends, the totals become what it did: a CSR or dense read counts its batches'
        entries, not the plan's scans, and a score that stopped early read less. So entries_done ends at
        entries_total, and done at total."""
        progress["total"] += items
        progress["entries_total"] += progress["entries_done"] - entries0 - planned

    def vector(v: int, vec: _Vector) -> Iterator[Tuple[str, Any]]:
        sums = _Sums(bins.n_bins, vec.thresholds)
        part = vec.part
        if part.score is not None:
            # the features' genes of the score's matrix ride on its reads: each gene is read once (OD 15)
            riders = [r for r, read in enumerate(work.reads) if read.layer == part.score.recipe.input]
            done0, entries0 = progress["done"], progress["entries_done"]
            result = None
            for event, payload in gs.compute(part.score, rows, should_stop, pause, on_entries=told,
                                             on_read=(lambda rv: [take(r, rv) for r in riders]) if riders else None):
                if event == "progress":
                    progress["done"] = done0 + min(payload[0], len(part.score.columns))
                    yield "progress", dict(progress)
                else:
                    result = payload
            progress["done"] = done0 + len(part.score.columns)
            settle(0, entries0, part.entries)
            if result.values is None:                    # no score: no cell has a value, as a missing gene
                vector_status[v] = {"status": "no_score", "reason": result.reason}
                yield "progress", dict(progress)
                return
            for a, b in cs._spans(result.values.size):
                gs._checkpoint(should_stop, pause)
                sums.add(bins.index(bins.codes[a:b]), result.values[a:b])
        else:
            for slab in cs.column(reader, dataset_path, part.spec.source, rows, sets=sets, should_stop=should_stop):
                gs._checkpoint(should_stop, pause)
                if slab.kind != "number":
                    raise _bad("This source is not a number per cell.", "not_numeric")
                sums.add(bins.index(bins.codes[slab.start:slab.start + slab.values.size]), slab.values)
            told(part.entries)
            progress["done"] += 1
        sums.write(sizes, [vector_rows.get((v, t), []) for t in vec.thresholds])
        yield "progress", dict(progress)

    yield "progress", dict(progress)
    for v, vec in enumerate(work.vectors):                    # scores first: the genes they share are read there
        if vec.part.score is not None:
            yield from vector(v, vec)
    for r, read in enumerate(work.reads):
        # what is left: the planned columns, less any a score read though not planned to (a control drawn as it
        # ran), plus any it was to read and did not (it stopped first)
        left = [c for c in sorted(read.thresholds) if c not in done[r]]
        if not left and not read.columns:
            continue
        entries0 = progress["entries_done"]
        if left:
            with gs.open_source(reader, dataset_path, read.layer) as source:
                for task, rows_values, _ in gs.pipeline(source.tasks(left), source.threads, READ_AHEAD_ENTRIES,
                                                        pause):
                    gs._checkpoint(should_stop, None)
                    take(r, rows_values)
                    told(task.entries)
                    progress["done"] += len(task.cols)
                    yield "progress", dict(progress)
        settle(len(left) - len(read.columns), entries0, read.entries)
        yield "progress", dict(progress)
    for v, vec in enumerate(work.vectors):
        if vec.part.score is None:
            yield from vector(v, vec)
    def gene_status(f: Feature) -> Dict[str, Any]:
        if f.id not in work.gene_target:
            return {"status": "missing"}
        return {"status": "constant" if f.transform and work.gene_target[f.id][:2] in constant else "ok"}

    feature_status = [{"id": f.id, **(gene_status(f) if f.kind == "gene"
                                      else vector_status[work.vector_of[("feature", f.id)]])}
                      for f in work.features]
    measure_status = [{"id": m.id, **vector_status[work.vector_of[("measure", m.id)]]} for m in work.measures]
    yield "result", Moments(features, feature_status, measures, measure_status)


# --------------------------------------------------------------------------------------------------------------
# The grouping shape
# --------------------------------------------------------------------------------------------------------------


@dataclass
class Result:
    """A grouping with the moments of its features and measures."""
    grouping: cg.GroupingResult
    features: List[Dict[str, Any]] = field(default_factory=list)      # {"id", "status", "reason"?}, request order
    measures: List[Dict[str, Any]] = field(default_factory=list)
    feature_moments: Optional[np.ndarray] = None                     # float64 [features, groups, 5]
    measure_moments: Optional[np.ndarray] = None                     # float64 [measures, groups, 5]
    over_limit: Optional[Dict[str, Any]] = None                      # MAX_FEATURE_CELLS refused

    @property
    def refused(self) -> Optional[Dict[str, Any]]:
        return self.grouping.refused or self.over_limit

    def to_reply(self, want_codes: bool) -> Tuple[Dict[str, Any], List[Tuple[str, np.ndarray]]]:
        """The ``result`` frame and its blocks: ``codes`` (when asked), ``feature_moments``, ``measure_moments``."""
        head, blocks = self.grouping.to_reply(want_codes)
        if self.refused is not None:
            head = {k: v for k, v in head.items() if k in ("type", "version", "shape", "n_shown")}
            head["refused"] = self.refused
            return head, []
        if not self.features and not self.measures:
            return head, blocks
        head["features"], head["measures"], head["moments"] = self.features, self.measures, list(MOMENTS)
        for name, arr in (("feature_moments", self.feature_moments), ("measure_moments", self.measure_moments)):
            if arr is not None:
                blocks.append((name, arr))
        head["blocks"] = [{"name": name, "dtype": a.dtype.name, "length": int(a.size)} if a.ndim == 1 else
                          {"name": name, "dtype": a.dtype.name, "shape": list(a.shape)} for name, a in blocks]
        return head, blocks


def compute(plan_: Plan, shown_rows: Optional[np.ndarray] = None, *, codes: Optional[cg.GroupingResult] = None,
            should_stop: Optional[Callable[[], bool]] = None, pause=None,
            on_entries: Optional[Callable[[int], None]] = None,
            grouping_event: bool = False) -> Iterator[Tuple[str, Any]]:
    """The groups (``cell_groups.compute``, whose progress frames pass through), then the moments of every feature
    and measure per group (stage ``features``). The final event is ``("result", Result)``.

    ``codes`` is a grouping from the code cache: the groups are not resolved, the features are read. ``on_entries``
    is told the grouping's entries as its partitionings are read (``cell_groups.compute``) and then each read's, so
    the calls add up to the plan's entries (less the grouping's on a cache hit, or what a refused grouping did not
    read).

    ``grouping_event`` adds ``("grouping", GroupingResult)`` once the groups are known (resolved, or the code cache's)
    and before any feature is read, so the code cache can keep the codes while the features are still to come
    (E6b). It is off by default: a caller that takes every event other than progress as the result stays as it is.
    """
    grouping = None
    for event, payload in cg.compute(plan_.groups, shown_rows, codes=codes, should_stop=should_stop, pause=pause,
                                     on_entries=on_entries):
        if event == "result":
            grouping = payload
        else:
            yield event, payload
    if grouping_event:
        yield "grouping", grouping
    work = plan_.work
    result = Result(grouping)
    if grouping.refused is not None or (not work.features and not work.measures):
        yield "result", result
        return
    k = len(grouping.groups)
    values = k * (len(work.features) + len(work.measures))
    most = feature_cells()
    if values > most:
        result.over_limit = {"reason": "too_many_values", "count": values, "limit": most}
        yield "result", result
        return
    sizes = np.asarray([g["n"] for g in grouping.groups], dtype=np.int64)
    rows = None if shown_rows is None else np.asarray(shown_rows, dtype=np.int64)
    moments = None
    for event, payload in accumulate(work, plan_.groups.reader, plan_.groups.dataset_path, rows, grouping.codes, k,
                                     sizes=sizes, sets=plan_.groups.request.sets, should_stop=should_stop,
                                     pause=pause, on_entries=on_entries):
        if event == "result":
            moments = payload
        else:
            yield event, payload
    result.features, result.measures = moments.feature_status, moments.measure_status
    result.feature_moments, result.measure_moments = moments.features, moments.measures
    yield "result", result
