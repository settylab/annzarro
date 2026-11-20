"""The grid shape: a dense count over the product of a count plot's partitionings (SHR-39, CNT-8 to CNT-13).

Every count-plot mode is one grid request. Its partitionings are the plot's inputs (x, y, a split, a factor, or
the sets of a Venn or UpSet), here called *axes*. The reply counts the cells shown in every combination of one
level per axis, empty ones included, in mixed-radix order with the first axis slowest, and never carries codes.
Its limits are the mode's (``GRID_LIMITS``), not the grouping's.

Levels are made by ``core/cell_groups.py``, so an axis has the levels and ids a grouping's partitioning has, with
two differences that a count needs:

* **Values outside a range are excluded** when the binning says ``outside: 'exclude'`` (SHR-45), and counted:
  ``axes[i].n_outside`` is ``[below, above]``, each excluded cell attributed to the first axis, in request order,
  whose range it fails, so the sum over the axes counts each excluded cell once. A grouping refuses ``exclude``.
* **A one-dimensional axis takes up to 2,000 bins**; a grouping's binning stops at 1,000.

An axis lists its declared levels (every category, kept level or bin) and, of the reserved levels ``@other``,
``@na`` and ``@zero``, only those a cell shown is in; ``@in`` and ``@out`` are always listed. A cell without a value
on a binned axis is in its ``@na`` level, and is counted: the browser counts it apart.

The density pre-pass (CNT-10, ``density: true``): for each density axis (x, and y in 2D) the first pass over the
held column takes ``n``, ``sigma`` (ddof 1) and the exact 0.1st and 99.9th percentiles; the range is those padded by
``3h``, with ``h = sigma * n ** (-1 / (d + 4))`` (Scott's rule, ``d`` the density axes) unless the binning stores a
side; the second pass bins it equal-width, outside excluded. The smoothing is the browser's.

Measures (CNT-16) are the five moments ``[n, sum, sumsq, n_above, sum_above]`` of one numeric source per grid cell,
over the cells counted and the source's finite values, as Float64.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from typing import Any, Callable, Dict, Iterator, List, Optional, Sequence, Tuple

import numpy as np

from . import binning as bn
from . import cell_groups as cg
from . import cell_sources as cs
from . import gene_score as gs
from .remote import is_remote_path

ALGORITHM_VERSION = 1

#: The most levels of each axis, in request order, per mode (SHR-39): 2D x, y, split; 1D x, split; a categorical
#: x, y; the most sets. An axis past its mode's tuple (the factor of a categorical heatmap) has only the cell cap.
GRID_LIMITS = {"2d": (512, 512, 8), "1d": (2000, 200), "categorical": (200, 200), "sets": 16}
#: The most grid cells, so measure moments stay at 84 MB (512 x 512 x 8, five Float64 each).
MAX_GRID_MEASURE_CELLS = 2_097_152
MODES = tuple(GRID_LIMITS)
#: Axes each mode takes, fewest and most: the inputs its count-plot modes send (UX 4.2).
AXES = {"1d": (1, 2), "2d": (2, 3), "categorical": (1, 3), "sets": (2, GRID_LIMITS["sets"])}
#: Axes of a density, first in the request: x in 1D, x and y in 2D.
DENSITY_AXES = {"1d": 1, "2d": 2}
DENSITY_QUANTILES = (0.001, 0.999)
DENSITY_PAD = 3.0
#: A count plot has one measure (CNT-16).
MAX_MEASURES = 1
MOMENTS = ("n", "sum", "sumsq", "n_above", "sum_above")

_BODY_FIELDS = ("shape", "mode", "partitionings", "sets", "subset", "measures", "density", "estimate_only", "confirm")
_MEASURE_FIELDS = ("id", "source", "above")
#: Methods with a bin count and a range: the ones whose cells can fall outside.
_RANGED = tuple(bn.DEFAULT_BINS)

#: Level slabs: a cell outside the axis's range, below or above. Above every level, below ``NONE16``.
OUT_BELOW = 0xFFFE
OUT_ABOVE = 0xFFFD
#: Grid codes: a cell in no level of an axis (``NONE32``), or outside the range of an earlier axis (``_OUT32``).
NONE32 = 0xFFFFFFFF
_OUT32 = 0xFFFFFFFE


def _bad(message: str, reason: str = "bad_request", status: int = 400, **extra) -> cg.GroupError:
    return cg.GroupError(status, reason, message, **extra)


# --------------------------------------------------------------------------------------------------------------
# The request
# --------------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Measure:
    id: str
    source: Dict[str, Any]
    above: float = 0.0


@dataclass(frozen=True)
class Request:
    mode: str
    partitionings: Tuple[cg.Partitioning, ...]
    levels: cg.Request                              # what the levels of cell_groups read: the sets, the subset
    density: bool = False
    measures: Tuple[Measure, ...] = ()
    estimate_only: bool = False
    confirm: bool = False

    @property
    def sets(self) -> Dict[str, np.ndarray]:
        return self.levels.sets

    @property
    def subset(self) -> Any:
        return self.levels.subset


def _parse_measure(raw: Any, seen: set) -> Measure:
    if not isinstance(raw, dict):
        raise _bad("A measure must be an object.")
    cg._unknown(raw, _MEASURE_FIELDS, "a measure")
    mid = raw.get("id")
    if not isinstance(mid, str) or not mid:
        raise _bad("A measure needs an id.")
    if mid in seen:
        raise _bad(f"Two measures are called '{mid}'.")
    seen.add(mid)
    if not isinstance(raw.get("source"), dict):
        raise _bad("A measure needs a source object.")
    source, _ = cg._parse_source(raw["source"], 0)
    if source["type"] in ("table", "cell-group"):
        raise _bad("A measure is a numeric per-cell source.", "measure_not_numeric")
    above = raw.get("above", 0.0)
    if not isinstance(above, (int, float)) or isinstance(above, bool) or not math.isfinite(float(above)):
        raise _bad("A measure's above must be a finite number.")
    return Measure(mid, source, float(above))


def parse_request(body: Any) -> Request:
    """Validate a ``grid`` request body (plan 1.2). Refusals are ``cell_groups.GroupError`` (400 unless stated).

    The number of sets is a limit of the mode and is refused here, 422, with the count and the limit; the other
    limits need the store and are refused by :func:`plan`.
    """
    if not isinstance(body, dict):
        raise _bad("The body must be a JSON object.")
    cg._unknown(body, _BODY_FIELDS, "the request")
    if body.get("shape") != "grid":
        raise _bad("This parser takes the grid shape; the grouping has its own (core/cell_groups.py).", "bad_shape")
    mode = body.get("mode")
    if mode not in MODES:
        raise _bad(f"mode must be one of {', '.join(MODES)}.", "bad_mode")
    raw_parts = body.get("partitionings")
    if not isinstance(raw_parts, list) or not raw_parts:
        raise _bad("A grid needs at least one partitioning.")
    fewest, most = AXES[mode]
    n = len(raw_parts)
    if mode == "sets" and not fewest <= n <= most:
        reason, limit = ("too_few_sets", fewest) if n < fewest else ("too_many_sets", most)
        raise _bad(f"Sets take {fewest} to {most}; this request has {n}.", reason, 422, count=n, limit=limit, mode=mode)
    if not fewest <= n <= most:
        reason, limit = ("too_few_axes", fewest) if n < fewest else ("too_many_axes", most)
        raise _bad(f"A {mode} grid takes {fewest} to {most} partitionings; this one has {n}.", reason,
                   count=n, limit=limit, mode=mode)
    parts = tuple(cg._parse_partitioning(p, 0) for p in raw_parts)
    raw_sets = body.get("sets") or {}
    if not isinstance(raw_sets, dict):
        raise _bad("sets must be an object.")
    sets = {str(ref): cg.decode_set(str(ref), raw) for ref, raw in raw_sets.items()}
    for p in cg._sources_of(cg.Grouping(parts)):
        if p.source["type"] == "table" and p.source["ref"] not in sets:
            raise _bad(f"The request has no set '{p.source['ref']}'.", "set_missing")
    raw_measures = body.get("measures")
    if raw_measures is None:
        raw_measures = []
    if not isinstance(raw_measures, list):
        raise _bad("measures must be a list.")
    if len(raw_measures) > MAX_MEASURES:
        raise _bad(f"A grid has at most {MAX_MEASURES} measure.", "too_many_measures", count=len(raw_measures),
                   limit=MAX_MEASURES)
    seen: set = set()
    measures = tuple(_parse_measure(m, seen) for m in raw_measures)
    levels = cg.Request(shape="grid", grouping=cg.Grouping(parts), sets=sets, set_hashes={},
                        subset=body.get("subset"))
    return Request(mode=mode, partitionings=parts, levels=levels, density=cg._flag(body, "density"),
                   measures=measures, estimate_only=cg._flag(body, "estimate_only"), confirm=cg._flag(body, "confirm"))


# --------------------------------------------------------------------------------------------------------------
# The plan
# --------------------------------------------------------------------------------------------------------------


@dataclass
class Plan:
    """What a grid request means for one store, before any column is read."""
    reader: Any
    dataset_path: str
    request: Request
    axes: List[cg.PartPlan]
    measures: List[Tuple[Measure, cg.PartPlan]]
    declared: List[Optional[int]]   # levels of each axis known from the store's metadata (None: known once read)
    n_cells: int
    seconds: float
    entries: int
    layout: str
    tier: str
    lane: str

    @property
    def cells(self) -> Optional[int]:
        """Grid cells of the declared levels, or None while an axis's levels are known only once read."""
        return None if None in self.declared else int(np.prod(self.declared, dtype=np.int64))

    def estimate(self) -> Dict[str, Any]:
        parts = self.axes + [m for _, m in self.measures]
        return {"seconds": round(self.seconds, 2), "tier": self.tier,
                "live_max_s": gs.LIVE_MAX_S, "auto_max_s": gs.AUTO_MAX_S, "max_s": gs.CONFIRM_MAX_S,
                "entries": self.entries, "layout": self.layout, "n_cells": self.n_cells, "lane": self.lane,
                "cells": self.cells,
                "parts": [{"type": p.spec.source["type"], "seconds": round(p.seconds, 3), "entries": p.entries,
                           "layout": p.layout} for p in parts]}


def _grid_bins(raw: Dict[str, Any], method: str) -> int:
    """The bin count of a grid axis: a whole number from 2; the mode's limit is checked with the others."""
    b = raw.get("bins")
    if b is None:
        return bn.DEFAULT_BINS[method]
    if not bn._is_number(b) or float(b) != int(b) or int(b) < bn.BINS_MIN:
        raise _bad(f"The number of bins must be a whole number from {bn.BINS_MIN}.", "bad_bins", minimum=bn.BINS_MIN)
    return int(b)


def _plan_axis(reader, dataset_path: str, p: cg.Partitioning, request: Request, n_cells: int,
               remote: bool) -> cg.PartPlan:
    """The partitioning planned as a grouping's would be, then given the grid's own bin count and ``outside``.

    cell_groups checks the source and the binning as a grouping takes it (clamped, at most 1,000 bins); the two
    fields it would refuse are taken out for that check and put back here, validated.
    """
    raw = p.binning
    probe = p if raw is None else replace(p, binning={k: v for k, v in raw.items() if k not in ("bins", "outside")})
    part = cg._plan_part(reader, dataset_path, probe, request.levels, n_cells, remote)
    part.spec = p
    if raw is not None and part.binning is not None and part.binning.method in _RANGED:
        try:
            parsed = bn.parse({k: v for k, v in raw.items() if k != "bins"}, numeric=True)
        except bn.BinningError as e:
            raise cg.GroupError(400, e.reason, e.message, **e.extra) from None
        part.binning = replace(parsed, bins=_grid_bins(raw, parsed.method))
    return part


def _n_categories(reader, dataset_path: str, key: str) -> Optional[int]:
    """Categories of a categorical obs column, from the length of its stored list (no cell is read)."""
    with cs._root(reader, dataset_path) as root:
        node = root["obs"][key]
        if cs._is_group(node) and "categories" in node:
            return int(node["categories"].shape[0])
    return None


def _binned(part: cg.PartPlan) -> bool:
    """A number cut into bins (not split by its values): its levels are bins, its limit is a bin count."""
    return part.kind == "number" and part.member is None and part.binning is not None and \
        part.binning.method != "categories"


def _declared(reader, dataset_path: str, part: cg.PartPlan) -> Optional[int]:
    """The levels of an axis that count for its limit, when the store's metadata tell (reserved levels do not)."""
    if part.member is not None or part.kind == "set":
        return 2
    if part.spec.levels is not None:
        return len(part.spec.levels)
    if _binned(part):
        b = part.binning
        bins = len(b.thresholds) + 1 if b.method == "manual" else b.bins
        return bins + (1 if b.zero_bin else 0)
    if part.kind == "bool":
        return 2
    if part.kind == "category":
        return _n_categories(reader, dataset_path, part.spec.source["key"])
    return None


def _axis_limit(mode: str, i: int) -> Optional[int]:
    limits = GRID_LIMITS[mode]
    if not isinstance(limits, tuple):
        return None
    return limits[i] if i < len(limits) else None


def _over_cap(sizes: Sequence[Optional[int]]) -> Optional[int]:
    """The grid cells the known sizes already make, when that is more than the cap."""
    known = int(np.prod([s for s in sizes if s is not None], dtype=np.int64))
    return known if known > MAX_GRID_MEASURE_CELLS else None


def _limit_reason(part: cg.PartPlan) -> str:
    return "too_many_bins" if _binned(part) else "too_many_levels"


def _check_limits(mode: str, axes: List[cg.PartPlan], sizes: Sequence[Optional[int]]) -> None:
    """Refuse, 422, a grid over its cell cap and then an axis over its mode's limit, with the count and the limit."""
    cells = _over_cap(sizes)
    if cells is not None:
        raise _bad(f"The grid would have {cells:,} cells; the most is {MAX_GRID_MEASURE_CELLS:,}.", "grid_too_large",
                   422, count=cells, limit=MAX_GRID_MEASURE_CELLS, mode=mode)
    for i, (part, n) in enumerate(zip(axes, sizes)):
        limit = _axis_limit(mode, i)
        if n is not None and limit is not None and n > limit:
            raise _bad(f"Partitioning {i + 1} has {n:,} levels; a {mode} grid takes {limit:,} there.",
                       _limit_reason(part), 422, axis=i, count=n, limit=limit, mode=mode)


def _check_kinds(request: Request, axes: List[cg.PartPlan]) -> None:
    mode = request.mode
    if mode == "sets":
        for i, part in enumerate(axes):
            binary = part.member is not None or (part.kind == "set" and part.spec.rest == "other")
            if not binary:
                raise _bad("A set is a table, or a source with a member: a cell is in it or out of it.",
                           "not_a_set", axis=i)
    if not request.density:
        return
    if mode not in DENSITY_AXES:
        raise _bad("A density is a 1d or 2d grid.", "density_mode", mode=mode)
    for i in range(DENSITY_AXES[mode]):
        part = axes[i]
        if not _binned(part) or part.binning.method not in _RANGED:
            raise _bad("A density bins a number into equal-width bins.", "density_not_numeric", axis=i)
        part.binning = replace(part.binning, method="equal_width", outside="exclude")


def plan(reader, dataset_path: str, request: Request) -> Plan:
    """Resolve the request's sources against the store, refuse what its mode's limits rule out, and estimate it.

    Reads no column: the levels of a binned axis come from its binning, of a categorical obs column from the
    length of its category list. An axis whose levels are known only once read (a text column, an integer split
    by its values, cell names, a grouping) is checked again when it has been read, and refused in the result.
    The estimate and the lane follow the grouping's (SHR-41), with each measure's read added.
    """
    with cs._root(reader, dataset_path) as root:
        n_cells = cs._n_cells(root)
    remote = is_remote_path(dataset_path)
    axes = [_plan_axis(reader, dataset_path, p, request, n_cells, remote) for p in request.partitionings]
    _check_kinds(request, axes)
    declared = [_declared(reader, dataset_path, a) for a in axes]
    _check_limits(request.mode, axes, declared)
    measures = []
    for m in request.measures:
        mp = cg._plan_part(reader, dataset_path, cg.Partitioning(source=m.source), request.levels, n_cells, remote)
        if mp.kind != "number":
            raise _bad(f"Measure '{m.id}' is not a numeric source.", "measure_not_numeric", measure=m.id)
        measures.append((m, mp))
    parts = []
    for a in axes + [mp for _, mp in measures]:
        parts.append(a)
        if a.nested is not None:
            parts.extend(a.nested.all_parts())
    seconds = gs.BASE_SECONDS + sum(a.seconds for a in axes) + sum(mp.seconds for _, mp in measures)
    entries = sum(p.entries for p in parts if p.nested is None)
    layouts = sorted({p.layout for p in parts if p.entries})
    lane = "light" if seconds <= gs.LIVE_MAX_S and not any(p.whole_matrix for p in parts) else "heavy"
    return Plan(reader=reader, dataset_path=dataset_path, request=request, axes=axes, measures=measures,
                declared=declared, n_cells=n_cells, seconds=seconds, entries=entries,
                layout=layouts[0] if len(layouts) == 1 else ("mixed" if layouts else "column"),
                tier=gs.tier_of(seconds), lane=lane)


# --------------------------------------------------------------------------------------------------------------
# One axis
# --------------------------------------------------------------------------------------------------------------


class _Axis(cg._Levels):
    """A partitioning's levels as a grid axis: a binned one marks its cells outside the range (``OUT_BELOW``,
    ``OUT_ABOVE``) instead of folding them into ``@na``, and a density axis first takes its range (CNT-10)."""

    def __init__(self, part: cg.PartPlan, ctx: cg._Ctx, index: int, density_d: int = 0):
        super().__init__(part, ctx, index)
        self.density_d = density_d
        self.density: Optional[Dict[str, Any]] = None
        self.ranged = False                 # its slabs may mark cells outside its range

    def _prepare_binned(self) -> None:
        part, b = self.part, self.part.binning
        from_all = b.edges_from == "all" and self.ctx.rows is not None
        held = self._numbers(None if from_all else self.ctx.rows)
        if self.density_d:
            b = self._density_binning(held, b)
        try:
            e = bn.edges(lambda: iter(held), b)
        except bn.BinningError as err:
            raise cg.GroupError(422, err.reason, err.message, axis=self.index, **err.extra) from None
        ids = bn.level_ids(e)
        exclude = part.spec.rest == "exclude"
        self.slots = ids + ([] if exclude else ["@na"])
        self.info.update(e.to_reply())
        counts = bn.Counts()
        na = cg.NONE16 if exclude else len(ids)
        ranged = self.ranged = b.outside == "exclude" and b.method in _RANGED and not e.degenerate
        lo, hi = (float(e.edges[0]), float(e.edges[-1])) if ranged else (0.0, 0.0)
        log = b.method == "log"
        # Only the reserved levels' occupancy is wanted (the bins are listed whatever their count), and assign()
        # counts it already: the cells of @zero are the zeros, those of @na the cells without a value.
        self.count = False

        def slabs():
            for start, v in self._shown_values(held, from_all):
                lv = bn.assign(v, e, counts)
                gone = lv == bn.NO_LEVEL
                if ranged and gone.any():
                    x = np.asarray(v[gone], dtype=np.float64)
                    below = x < lo                           # NaN compares false: it has no value
                    if log:
                        below &= x > 0                       # under log-spaced bins, <= 0 has no value
                    lv[gone] = np.where(below, OUT_BELOW, np.where(x > hi, OUT_ABOVE, na))
                elif na != cg.NONE16:
                    np.minimum(lv, na, out=lv)               # every level is below na; only NO_LEVEL is above
                yield start, lv
            self.info["n_no_value"] = counts.n_no_value
            self.counts = np.zeros(len(self.slots), dtype=np.int64)
            if e.zero_bin:
                self.counts[0] = counts.n_zero
            if not exclude:
                self.counts[-1] = counts.n_no_value
        self._slabs = slabs()

    def _density_binning(self, held: List[np.ndarray], b: bn.Binning) -> bn.Binning:
        """The pre-pass of CNT-10 over the held values: ``n``, ``sigma``, the exact tails, the padded range."""
        def finite() -> Iterator[np.ndarray]:
            for h in held:
                for c in bn._chunks(h):
                    c = c[np.isfinite(c)]
                    if c.size:
                        yield c
        n, total, vmin, vmax = 0, 0.0, math.inf, -math.inf
        for c in finite():
            n += c.size
            total += float(c.sum())
            vmin, vmax = min(vmin, float(c.min())), max(vmax, float(c.max()))
        self.density = {"n": n}
        if n == 0:
            return b
        mean = total / n
        ss = sum(float(np.square(c - mean).sum()) for c in finite())
        sigma = math.sqrt(ss / (n - 1)) if n > 1 else 0.0
        q = bn._exact_quantiles(finite, n, vmin, vmax, np.asarray(DENSITY_QUANTILES, dtype=np.float64))
        h = sigma * n ** (-1.0 / (self.density_d + 4))
        lo, hi = float(q[0]) - DENSITY_PAD * h, float(q[1]) + DENSITY_PAD * h
        if b.range is not None:
            lo = lo if b.range[0] is None else b.range[0]
            hi = hi if b.range[1] is None else b.range[1]
        self.density.update(sigma=sigma, bandwidth=h, quantiles=[float(q[0]), float(q[1])], range=[lo, hi])
        return replace(b, range=(lo, hi))

    def reply(self) -> Dict[str, Any]:
        """The axis as the reply lists it: the grouping's fields, the levels as ids."""
        out = super().reply()
        out["levels"] = [lv["id"] for lv in out["levels"]]
        if self.density is not None:
            out["density"] = self.density
        return out


def _fold(codes: np.ndarray, axis: _Axis, outside_before: bool) -> Tuple[int, int]:
    """Fold one axis into the grid codes (first axis slowest); returns the cells it excludes ``[below, above]``,
    counting only those no earlier axis excluded. ``outside_before``: an earlier axis may have excluded a cell."""
    width = np.uint32(len(axis.slots))
    below_n = above_n = 0
    for start, lv in axis:
        r = codes[start:start + lv.size]
        bad = r >= _OUT32                               # in no level, or outside, already
        earlier = r == _OUT32 if outside_before else None
        out = None
        if axis.ranged:
            below, above = lv == OUT_BELOW, lv == OUT_ABOVE
            out = below | above
            if out.any():
                if earlier is not None:
                    below &= ~earlier
                    above &= ~earlier
                below_n += int(np.count_nonzero(below))
                above_n += int(np.count_nonzero(above))
            else:
                out = None
        bad |= lv >= OUT_ABOVE                          # OUT_ABOVE, OUT_BELOW and NONE16
        r *= width
        r += lv
        np.copyto(r, NONE32, where=bad)
        if earlier is not None and out is not None:
            out |= earlier
        elif out is None:
            out = earlier
        if out is not None:
            np.copyto(r, _OUT32, where=out)
    return below_n, above_n


# --------------------------------------------------------------------------------------------------------------
# Compute
# --------------------------------------------------------------------------------------------------------------


@dataclass
class GridResult:
    """A computed grid: the ``result`` frame's fields and its blocks."""
    mode: str
    n_shown: int
    n_counted: int = 0
    axes: List[Dict[str, Any]] = field(default_factory=list)
    counts: Optional[np.ndarray] = None             # uint32, mixed radix, first axis slowest
    measure_ids: List[str] = field(default_factory=list)
    moments: Optional[np.ndarray] = None            # float64 (measures, cells, 5)
    refused: Optional[Dict[str, Any]] = None

    def to_reply(self) -> Tuple[Dict[str, Any], List[Tuple[str, np.ndarray]]]:
        head: Dict[str, Any] = {"type": "result", "version": ALGORITHM_VERSION, "shape": "grid", "mode": self.mode,
                                "n_shown": self.n_shown}
        if self.refused is not None:
            head["refused"] = self.refused
            return head, []
        head.update(n_counted=self.n_counted, axes=self.axes,
                    measures=[{"id": m, "status": "ok"} for m in self.measure_ids])
        blocks = [("counts", self.counts)]
        meta = [{"name": "counts", "dtype": "uint32", "length": int(self.counts.size)}]
        if self.measure_ids:
            head["moments"] = list(MOMENTS)
            blocks.append(("measure_moments", self.moments))
            meta.append({"name": "measure_moments", "dtype": "float64", "shape": list(self.moments.shape)})
        head["blocks"] = meta
        return head, blocks


def _measure_slabs(mp: cg.PartPlan, ctx: cg._Ctx) -> Iterator[Tuple[int, np.ndarray]]:
    """The measure's values over the cells shown, slab by slab; a score is computed whole first."""
    if mp.score is not None:
        start = 0
        for v in cg._Levels(mp, ctx, -1)._numbers(ctx.rows):
            yield start, v
            start += v.size
        return
    for slab in cs.column(ctx.reader, ctx.dataset_path, mp.spec.source, ctx.rows, sets=ctx.request.sets,
                          should_stop=ctx.should_stop):
        if slab.kind != "number":
            raise _bad("A measure is a numeric per-cell source.", "measure_not_numeric")
        yield slab.start, slab.values


def _moments(codes: np.ndarray, space: int, slabs: Iterator[Tuple[int, np.ndarray]], above: float,
             ctx: cg._Ctx) -> np.ndarray:
    """``(5, space)`` moments of the finite values per grid code; cells outside the grid are left out."""
    acc = np.zeros((len(MOMENTS), space), dtype=np.float64)
    for start, v in slabs:
        ctx.check()
        c = codes[start:start + v.size]
        x = np.asarray(v, dtype=np.float64)
        ok = c < space
        ok &= np.isfinite(x)
        c, x = c[ok], x[ok]
        acc[0] += np.bincount(c, minlength=space)
        acc[1] += np.bincount(c, weights=x, minlength=space)
        acc[2] += np.bincount(c, weights=x * x, minlength=space)
        hi = x > above
        acc[3] += np.bincount(c[hi], minlength=space)
        acc[4] += np.bincount(c[hi], weights=x[hi], minlength=space)
    return acc


def _check_axis(mode: str, i: int, axis: _Axis, sizes: List[Optional[int]]) -> None:
    """The limits again, with the levels the axis made once read: the cap first, then the axis's own."""
    sizes[i] = axis.n_levels
    cells = _over_cap(sizes)
    if cells is not None:
        raise cg._Refused(reason="grid_too_large", count=cells, limit=MAX_GRID_MEASURE_CELLS, mode=mode)
    limit = _axis_limit(mode, i)
    if limit is not None and axis.n_levels > limit:
        raise cg._Refused(reason=_limit_reason(axis.part), axis=i, count=axis.n_levels, limit=limit, mode=mode)


def compute(plan_: Plan, shown_rows: Optional[np.ndarray] = None, *, should_stop: Optional[Callable[[], bool]] = None,
            pause=None) -> Iterator[Tuple[str, Any]]:
    """Count the grid over the cells ``shown_rows`` (sorted dataset rows; None: all cells).

    Yields ``("progress", {"stage": "grid", "done", "total"})`` per axis and measure and a final
    ``("result", GridResult)``. ``should_stop`` is asked between slabs (true raises ``gene_score.ScoreCancelled``);
    ``pause`` (``wanted()``, ``wait()``) is honoured between slabs and passed to a score's pipeline.

    Memory: one ``uint32`` grid code per cell shown, plus what an axis holds while it is read (a binned column in
    its stored type, as a grouping holds it), plus the counts and moments of the grid.
    """
    req = plan_.request
    rows = None if shown_rows is None else np.asarray(shown_rows, dtype=np.int64)
    n_shown = plan_.n_cells if rows is None else int(rows.size)
    ctx = cg._Ctx(plan_.reader, plan_.dataset_path, req.levels, rows, n_shown, should_stop, pause)
    total = len(plan_.axes) + len(plan_.measures)
    yield "progress", {"stage": "grid", "done": 0, "total": total}
    result = GridResult(mode=req.mode, n_shown=n_shown)
    codes = np.zeros(n_shown, dtype=np.uint32)
    sizes = list(plan_.declared)
    made: List[_Axis] = []
    outside: List[List[int]] = []
    density_d = DENSITY_AXES.get(req.mode, 0) if req.density else 0
    try:
        for i, part in enumerate(plan_.axes):
            ctx.check()
            axis = _Axis(part, ctx, i, density_d if i < density_d else 0)
            axis.prepare()
            _check_axis(req.mode, i, axis, sizes)
            outside.append(list(_fold(codes, axis, any(a.ranged for a in made))))
            made.append(axis)
            yield "progress", {"stage": "grid", "done": i + 1, "total": total}
    except cg._Refused as r:
        refused = dict(r.refused)
        if "partitioning" in refused:
            refused["axis"] = refused.pop("partitioning")
        result.refused = {**refused, "levels": [a.n_levels for a in made]}
        yield "result", result
        return
    widths = [len(a.slots) for a in made]
    space = int(np.prod(widths, dtype=np.int64))
    flat = np.zeros(space + 1, dtype=np.int64)
    for a, b in cg._spans(n_shown):
        c = codes[a:b]
        np.minimum(c, space, out=c)                     # every cell left out is now ``space``, past the grid
        flat += np.bincount(c, minlength=space + 1)
    flat = flat[:space]
    moments = []
    for j, (m, mp) in enumerate(plan_.measures):
        moments.append(_moments(codes, space, _measure_slabs(mp, ctx), m.above, ctx))
        yield "progress", {"stage": "grid", "done": len(made) + j + 1, "total": total}
    del codes
    result.axes = []
    keeps = []
    for axis, out in zip(made, outside):
        info = axis.reply()
        info["n_outside"] = out
        listed = set(info["levels"])
        keeps.append(np.asarray([k for k, sid in enumerate(axis.slots) if sid in listed], dtype=np.int64))
        result.axes.append(info)
    trim = any(k.size != w for k, w in zip(keeps, widths))
    if trim:
        index = np.ix_(*keeps)
        flat = flat.reshape(widths)[index].reshape(-1)
        moments = [acc.reshape([len(MOMENTS)] + widths)[(slice(None),) + index].reshape(len(MOMENTS), -1)
                   for acc in moments]
    result.counts = flat.astype(np.uint32)
    result.n_counted = int(flat.sum())
    if moments:
        result.measure_ids = [m.id for m, _ in plan_.measures]
        result.moments = np.ascontiguousarray(np.stack([acc.T for acc in moments]))
    yield "result", result
