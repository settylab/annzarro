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

Reads. Each matrix is opened once and each gene of it is read once, whatever number of features want it: the colour
and the size of a row (OD 15), two thresholds, two sections. A score is computed once for every feature and measure
that asks for it, through the score engine (``gene_score.compute``). Gene reads go through the score engine's
``pipeline``, so memory is its read-ahead (``READ_AHEAD_ENTRIES``) whatever the number of genes, and one gene is worked
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
from . import gene_score as gs
from .remote import is_remote_path

ALGORITHM_VERSION = 1

#: The five moments of every group, in the order of the blocks' last axis.
MOMENTS = ("n", "sum", "sumsq", "n_above", "sum_above")

#: The most grid cells a measure is accumulated over: 512 x 512 x 8, the largest grid (SHR-39).
MAX_GRID_MEASURE_CELLS = 2_097_152

#: The most values (groups x features) one grouping request accumulates: CXG-17's matrix limit, which the browser
#: keeps to, so the accumulators stay under 16 MB. A request over it is refused once its groups are known.
MAX_FEATURE_CELLS = 400_000

_GENE_FIELDS = ("id", "kind", "name", "layer", "detect_above")
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
            out.append(Feature(fid, "gene", _threshold(f, "detect_above"), name=name, layer=layer))
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
    """The genes the features read from one matrix."""
    layer: str
    columns: List[int]                                  # distinct, ascending
    thresholds: Dict[int, List[float]]                  # column -> its distinct thresholds
    entries: int
    layout: str


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
    gene_target: Dict[str, Tuple[int, int, float]]      # gene feature id -> (read, column, threshold); absent: missing
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
    with cs._root(reader, dataset_path) as root:
        n_cells = cs._n_cells(root)
    request = cg.Request(shape="grouping", grouping=cg.Grouping(()), sets={}, set_hashes={})   # no nested grouping
    reads: List[_MatrixRead] = []
    gene_target: Dict[str, Tuple[int, int, float]] = {}
    missing: List[str] = []
    genes = [f for f in features if f.kind == "gene"]
    by_layer: Dict[str, List[Feature]] = {}
    for f in genes:
        by_layer.setdefault(f.layer, []).append(f)
    var_names = reader.get_cell_gene_names(dataset_path, "genes") if genes else []
    seconds, entries, whole, layouts = 0.0, 0, False, set()
    for layer, fs in by_layer.items():
        with gs.open_source(reader, dataset_path, layer) as source:
            column_of, absent, _ = gs._resolve_names(var_names, [f.name for f in fs])
            thresholds: Dict[int, List[float]] = {}
            for f in fs:
                col = column_of.get(f.name)
                if col is None:
                    continue
                ts = thresholds.setdefault(col, [])
                if f.threshold not in ts:
                    ts.append(f.threshold)
                gene_target[f.id] = (len(reads), col, f.threshold)
            missing += [n for n in absent if n not in missing]
            columns = sorted(thresholds)
            n_entries = int(source.entries(columns)) if columns else 0
            reads.append(_MatrixRead(layer, columns, thresholds, n_entries, source.layout))
            if columns:
                seconds += cg._rate_seconds(source.layout, n_entries, remote)
                entries += n_entries
                whole = whole or source.layout in ("csr", "dense")      # as a layer partitioning (cell_groups)
                layouts.add(source.layout)
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
        v = vectors[index[key]]
        if threshold not in v.thresholds:
            v.thresholds.append(threshold)
        vector_of[(what, fid)] = index[key]
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
    light = groups.lane == "light" and not work.whole_matrix and seconds <= gs.LIVE_MAX_S
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


class _Sums:
    """Running per-bin sums of values for several thresholds; ``seen`` counts the values given (finite or not)."""

    def __init__(self, n_bins: int, thresholds: Sequence[float]):
        self.thresholds = list(thresholds)
        z = lambda: np.zeros(n_bins, dtype=np.float64)                    # noqa: E731
        self.seen, self.bad, self.sum, self.sumsq = z(), z(), z(), z()
        self.n_above = [z() for _ in self.thresholds]
        self.sum_above = [z() for _ in self.thresholds]

    def add(self, b: np.ndarray, values: np.ndarray) -> None:
        n = self.seen.size
        v = values.astype(np.float64)
        finite = np.isfinite(v)
        if finite.all():
            finite = None
        else:
            self.bad += np.bincount(b[~finite], minlength=n)
            v[~finite] = 0.0
        self.seen += np.bincount(b, minlength=n)
        self.sum += np.bincount(b, weights=v, minlength=n)
        self.sumsq += np.bincount(b, weights=v * v, minlength=n)
        for i, t in enumerate(self.thresholds):
            above = v > t
            if finite is not None and t < 0:
                above &= finite
            b_above = b[above]
            self.n_above[i] += np.bincount(b_above, minlength=n)
            self.sum_above[i] += np.bincount(b_above, weights=v[above], minlength=n)

    def write(self, sizes: np.ndarray, outs: Sequence[Sequence[np.ndarray]]) -> None:
        """The moments at threshold ``i`` into each ``[k, 5]`` array of ``outs[i]``; ``sizes`` are the cells per
        code. A cell given no value (a sparse gene's implicit zero) is a finite zero."""
        k = sizes.size
        for i, t in enumerate(self.thresholds):
            if not outs[i]:
                continue
            m = outs[i][0]
            m[:, 0] = sizes - self.bad[:k]
            m[:, 1] = self.sum[:k]
            m[:, 2] = self.sumsq[:k]
            m[:, 3] = self.n_above[i][:k]
            if 0.0 > t:
                m[:, 3] += sizes - self.seen[:k]
            m[:, 4] = self.sum_above[i][:k]
            for other in outs[i][1:]:
                other[...] = m


def _segments(n: int) -> Iterator[Tuple[int, int]]:
    step = max(int(gs.SEGMENT_ENTRIES), 1)
    for a in range(0, n, step):
        yield a, min(a + step, n)


def _gene_moments(bins: _Bins, sizes: np.ndarray, rows: Optional[np.ndarray], values: np.ndarray,
                  thresholds: Sequence[float], outs: Sequence[Sequence[np.ndarray]]) -> None:
    """One gene's moments per code at each threshold, into ``outs`` (as ``_Sums.write``): its stored entries
    (``rows`` the dataset rows) or its whole column (``rows`` None), ``SEGMENT_ENTRIES`` at a time (CMP-2)."""
    sums = _Sums(bins.n_bins, thresholds)
    if rows is None:
        for a, b in _segments(values.size):
            sums.add(bins.index(bins.by_row[a:b]), values[a:b])
    else:
        rows, values = gs._canonical(np.asarray(rows), np.asarray(values))
        for a, b in _segments(values.size):
            sums.add(bins.index(bins.by_row[rows[a:b]]), values[a:b])
    sums.write(sizes, outs)


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
    if n_codes > MAX_GRID_MEASURE_CELLS:
        raise cg.GroupError(422, "grid_too_large", f"Measures are accumulated over at most "
                            f"{MAX_GRID_MEASURE_CELLS:,} cells; this asks for {n_codes:,}.", count=int(n_codes),
                            limit=MAX_GRID_MEASURE_CELLS)
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
    gene_rows: Dict[Tuple[int, int, float], List[np.ndarray]] = {}
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

    yield "progress", dict(progress)
    for r, read in enumerate(work.reads):
        if not read.columns:
            continue
        with gs.open_source(reader, dataset_path, read.layer) as source:
            for task, rows_values, _ in gs.pipeline(source.tasks(read.columns), source.threads,
                                                    gs.READ_AHEAD_ENTRIES, pause):
                gs._checkpoint(should_stop, None)
                for col, at, values in rows_values:
                    ts = read.thresholds[col]
                    _gene_moments(bins, sizes, at, np.asarray(values), ts, [gene_rows[(r, col, t)] for t in ts])
                told(task.entries)
                progress["done"] += len(task.cols)
                yield "progress", dict(progress)
    for v, vec in enumerate(work.vectors):
        sums = _Sums(bins.n_bins, vec.thresholds)
        part = vec.part
        if part.score is not None:
            done0 = progress["done"]
            result = None
            for event, payload in gs.compute(part.score, rows, should_stop, pause, on_entries=told):
                if event == "progress":
                    progress["done"] = done0 + min(payload[0], len(part.score.columns))
                    yield "progress", dict(progress)
                else:
                    result = payload
            progress["done"] = done0 + len(part.score.columns)
            if result.values is None:                    # no score: no cell has a value, as a missing gene
                vector_status[v] = {"status": "no_score", "reason": result.reason}
                yield "progress", dict(progress)
                continue
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
    feature_status = [{"id": f.id, **({"status": "ok" if f.id in work.gene_target else "missing"} if f.kind == "gene"
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
            on_entries: Optional[Callable[[int], None]] = None) -> Iterator[Tuple[str, Any]]:
    """The groups (``cell_groups.compute``, whose progress frames pass through), then the moments of every feature
    and measure per group (stage ``features``). The final event is ``("result", Result)``.

    ``codes`` is a grouping from the code cache: the groups are not resolved, the features are read. ``on_entries``
    is told the grouping's entries once its groups are resolved and then each read's, so the calls add up to the
    plan's entries (less the grouping's on a cache hit).
    """
    grouping = None
    for event, payload in cg.compute(plan_.groups, shown_rows, codes=codes, should_stop=should_stop, pause=pause):
        if event == "result":
            grouping = payload
        else:
            yield event, payload
    if codes is None and on_entries is not None and plan_.groups.entries - plan_.work.entries:
        on_entries(plan_.groups.entries - plan_.work.entries)
    work = plan_.work
    result = Result(grouping)
    if grouping.refused is not None or (not work.features and not work.measures):
        yield "result", result
        return
    k = len(grouping.groups)
    if k * len(work.features) > MAX_FEATURE_CELLS:
        result.over_limit = {"reason": "too_many_values", "count": k * len(work.features), "limit": MAX_FEATURE_CELLS}
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
