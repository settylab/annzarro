"""Binning: the one place where bin edges are computed and cells are assigned to bins.

A *binning* turns a numeric per-cell column into ordered levels. Everything that needs it, the grouping and the
count plot, goes through this module, so the arithmetic exists once. The browser holds only the schema, the
defaults and the label text, and never computes an edge from data.

Conventions
-----------
* Values are compared as float64. Float32 and integer columns are widened one chunk at a time.
* Bins are closed below and open above, ``[lo, hi)``. The last bin is closed above.
* ``NaN`` and the infinities have no value. They get ``NO_LEVEL``.
* The level index is a ``uint16``. With the zero bin on, level 0 is ``@zero`` and the bins follow from 1. The ids
  are ``@zero``, ``bin:0``, ``bin:1`` ... (:func:`level_ids`). Degenerate data has the one level ``bin:0``.
* Equal-count edges are the exact quantiles, bit-identical to ``numpy.quantile(values.astype(float64), q)`` with
  numpy's default (linear) method, ``q = i / bins``. They are found with an exact select that never copies the
  column (see :func:`_exact_quantiles`), so a float64 column of 100M values needs no more memory than a float32 one.

Slabs
-----
The data enter as a *callable* that returns a fresh iterable of arrays on every call (``slabs()``). Edge finding
reads the column more than once. A one-shot generator is refused with a clear error rather than silently giving
wrong edges.

The code cannot import anything but numpy: it runs in the compute path next to a 100M-cell read.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Tuple

import numpy as np

#: Level index of a cell that is in no level: no value, or outside the range under ``outside: 'exclude'``.
NO_LEVEL = 0xFFFF

METHODS = ("equal_width", "equal_count", "log", "manual", "categories")
OUTSIDE = ("clamp", "exclude")
EDGES_FROM = ("shown", "all")
BINS_MIN, BINS_MAX = 2, 1000
#: Default bin count per method (SHR-14).
DEFAULT_BINS = {"equal_count": 4, "equal_width": 10, "log": 10}
#: Share of exact zeros from which the zero bin defaults to on (SHR-15).
ZERO_BIN_SHARE = 0.25
#: A column cut by its distinct values cannot have more levels than a uint16 code can hold.
MAX_CATEGORY_LEVELS = NO_LEVEL - 1

#: Buckets of the first pass of the exact select.
SELECT_BUCKETS = 65_536
#: A bucket with more values than this is split again by the same two passes; a batch of buckets collected in one
#: pass holds at most this many values (128 MB of float64, in a pathological column only).
SELECT_COLLECT_CAP = 16_000_000
#: Temporaries are bounded by working in chunks of this many values, whatever the slab size.
CHUNK = 1 << 20
#: Recursion bound of the select on a bucket that cannot be split (it can only be all-equal values then).
_SELECT_DEPTH = 6


class BinningError(ValueError):
    """A binning that cannot be used. ``reason`` is a stable key; ``extra`` carries counts and limits."""

    def __init__(self, reason: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message
        self.extra = extra


# --------------------------------------------------------------------------------------------------------------
# The recipe
# --------------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Binning:
    """A validated binning recipe. ``to_dict()`` is its canonical form (snake_case, only the fields that apply)."""

    method: str
    bins: Optional[int] = None
    thresholds: Optional[Tuple[float, ...]] = None
    zero_bin: bool = False
    range: Optional[Tuple[Optional[float], Optional[float]]] = None   # a side may be None: taken from the values
    outside: str = "clamp"
    edges_from: str = "shown"

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {"method": self.method}
        if self.bins is not None:
            out["bins"] = self.bins
        if self.thresholds is not None:
            out["thresholds"] = list(self.thresholds)
        if self.zero_bin:
            out["zero_bin"] = True
        if self.range is not None:
            out["range"] = list(self.range)                 # a None side is written as null
        if self.method != "manual" and self.method != "categories":
            out["outside"] = self.outside
        if self.method != "manual":
            out["edges_from"] = self.edges_from
        return out


_FIELDS = ("method", "bins", "thresholds", "zero_bin", "range", "outside", "edges_from")


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float, np.integer, np.floating)) and not isinstance(v, (bool, np.bool_))


def _finite_number(v: Any, what: str) -> float:
    if not _is_number(v) or not math.isfinite(float(v)):
        raise BinningError("bad_number", f"{what} must be a finite number.", field=what)
    return float(v)


def parse(raw: Optional[Mapping[str, Any]], *, numeric: bool) -> Binning:
    """Validate a binning recipe.

    ``numeric`` is whether the source is a numeric column. A categorical source has no binning but the implied
    ``categories``. Fields that do not belong to the method (``bins`` on manual, ``range`` on equal count ...) are
    dropped, so a recipe edited through several methods stays clean. Unknown fields are refused.
    """
    if raw is None:
        raw = {}
    if not isinstance(raw, Mapping):
        raise BinningError("bad_binning", "A binning must be an object.")
    unknown = sorted(str(k) for k in raw if k not in _FIELDS)
    if unknown:
        raise BinningError("unknown_field", "Unknown binning field: " + ", ".join(unknown) + ".", fields=unknown)

    method = raw.get("method")
    if method is None:
        method = "equal_count" if numeric else "categories"
    if method not in METHODS:
        raise BinningError("bad_method", f"Unknown binning method {method!r}.", method=str(method))
    if not numeric and method != "categories":
        raise BinningError("not_numeric", "Only a numeric source can be binned; a categorical one is split by its categories.")

    outside = raw.get("outside", "clamp")
    if outside not in OUTSIDE:
        raise BinningError("bad_outside", "outside must be 'clamp' or 'exclude'.")
    edges_from = raw.get("edges_from", "shown")
    if edges_from not in EDGES_FROM:
        raise BinningError("bad_edges_from", "edges_from must be 'shown' or 'all'.")
    zero_bin = raw.get("zero_bin", False)
    if not isinstance(zero_bin, (bool, np.bool_)):
        raise BinningError("bad_zero_bin", "zero_bin must be true or false.")
    zero_bin = bool(zero_bin)

    bins: Optional[int] = None
    thresholds: Optional[Tuple[float, ...]] = None
    rng: Optional[Tuple[Optional[float], Optional[float]]] = None

    if method in DEFAULT_BINS:
        b = raw.get("bins")
        if b is None:
            bins = DEFAULT_BINS[method]
        else:
            if not _is_number(b) or float(b) != int(b) or not BINS_MIN <= int(b) <= BINS_MAX:
                raise BinningError("bad_bins", f"The number of bins must be a whole number from {BINS_MIN} to {BINS_MAX}.",
                                   minimum=BINS_MIN, maximum=BINS_MAX)
            bins = int(b)
    if method in ("equal_width", "log"):
        r = raw.get("range")
        if r is not None:
            if not isinstance(r, (list, tuple)) or len(r) != 2:
                raise BinningError("bad_range", "range must be [low, high].")
            lo = None if r[0] is None else _finite_number(r[0], "range")
            hi = None if r[1] is None else _finite_number(r[1], "range")
            if lo is not None and hi is not None and not lo < hi:
                raise BinningError("bad_range", "range must have low below high.")
            if method == "log" and lo is not None and lo <= 0:
                raise BinningError("bad_range", "A log-spaced range must start above 0.")
            if lo is not None or hi is not None:       # [null, null] is no range
                rng = (lo, hi)
    if method == "manual":
        t = raw.get("thresholds")
        if not isinstance(t, (list, tuple)) or not t:
            raise BinningError("bad_thresholds", "Manual thresholds need at least one value.")
        vals = sorted({_finite_number(v, "thresholds") for v in t})
        if len(vals) > BINS_MAX - 1:
            raise BinningError("bad_thresholds", f"At most {BINS_MAX - 1} thresholds.", limit=BINS_MAX - 1, count=len(vals))
        thresholds = tuple(vals)
    if method == "categories":
        zero_bin = False
    return Binning(method=method, bins=bins, thresholds=thresholds, zero_bin=zero_bin, range=rng,
                   outside=outside, edges_from=edges_from)


# --------------------------------------------------------------------------------------------------------------
# Edges
# --------------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Edges:
    """The result of :func:`edges`: what :func:`assign` needs and what the reply reports.

    ``edges`` holds the boundaries of the bins: ``bins + 1`` of them for the data-derived methods, the thresholds
    themselves for ``manual`` (whose first and last bin are open), the sorted distinct values for ``categories``
    (one level each), and two equal values for degenerate data.
    """

    binning: Binning
    edges: np.ndarray
    n_bins: int                       # bins of the method, without the zero bin
    degenerate: bool = False
    degenerate_value: Optional[float] = None
    bins_asked: Optional[int] = None
    range_stored: bool = False        # a side was stored: that end bin is then the "<= lo" or ">= hi" bin of SHR-45
    range_used: Optional[Tuple[float, float]] = None   # the low and high edge actually used, a null side resolved
    edges_n: int = 0                  # finite values the edges were computed over, zeros included
    n_zero: int = 0
    n_no_value: int = 0               # not finite, in the population the edges came from

    @property
    def method(self) -> str:
        return self.binning.method

    @property
    def zero_bin(self) -> bool:
        return self.binning.zero_bin

    @property
    def n_levels(self) -> int:
        return self.n_bins + (1 if self.zero_bin else 0)

    def to_reply(self) -> Dict[str, Any]:
        """The fields the compute reply carries for this partitioning (``edges``, ``edges_n``, ...)."""
        out: Dict[str, Any] = {
            "edges": [float(v) for v in self.edges],
            "edges_from": self.binning.edges_from,
            "edges_n": int(self.edges_n),
            "bins_asked": self.bins_asked,
            "bins_made": int(self.n_bins),
            "degenerate": bool(self.degenerate),
            "outside": self.binning.outside,
        }
        if self.range_used is not None:
            out["range"] = [float(self.range_used[0]), float(self.range_used[1])]
        if self.degenerate:
            out["value"] = self.degenerate_value
        return out


def level_ids(e: Edges) -> List[str]:
    """``["@zero", "bin:0", "bin:1", ...]``, ``@zero`` only with the zero bin on. Degenerate data has ``bin:0``."""
    ids = ["@zero"] if e.zero_bin else []
    ids.extend(f"bin:{i}" for i in range(e.n_bins))
    return ids


def level_bounds(e: Edges) -> List[Tuple[Optional[float], Optional[float]]]:
    """``(lo, hi)`` of each level in :func:`level_ids` order. ``None`` is an open end, or a level of one value."""
    out: List[Tuple[Optional[float], Optional[float]]] = []
    if e.zero_bin:
        out.append((0.0, 0.0))
    if e.degenerate:
        out.append((e.degenerate_value, e.degenerate_value))
    elif e.method == "categories":
        out.extend((float(v), float(v)) for v in e.edges)
    elif e.method == "manual":
        t = [float(v) for v in e.edges]
        out.append((None, t[0]))
        out.extend((t[i], t[i + 1]) for i in range(len(t) - 1))
        out.append((t[-1], None))
    else:
        ed = [float(v) for v in e.edges]
        out.extend((ed[i], ed[i + 1]) for i in range(e.n_bins))
    return out


def _check_replayable(slabs: Any) -> Callable[[], Iterable[np.ndarray]]:
    if not callable(slabs):
        raise BinningError("slabs_not_replayable",
                           "edges() needs a callable that gives a fresh pass over the slabs each time it is called; "
                           "an iterator or generator can be read only once.")
    return slabs


def _passes(slabs: Callable[[], Iterable[np.ndarray]]) -> Callable[[], Iterable[np.ndarray]]:
    """Wrap ``slabs`` so that a call returning the object of the previous call (a one-shot) is refused."""
    last: List[Any] = []

    def fresh() -> Iterable[np.ndarray]:
        it = slabs()
        if last and it is last[0]:
            raise BinningError("slabs_not_replayable",
                               "The slab source returned the same iterator twice; it must start a fresh pass on every call.")
        last[:] = [it]
        return it

    return fresh


def _chunks(slab: Any) -> Iterable[np.ndarray]:
    """The slab as float64 chunks of at most CHUNK values, flat. A float64 slab is not copied."""
    a = np.asarray(slab)
    if a.ndim != 1:
        a = a.reshape(-1)
    for i in range(0, a.size, CHUNK):
        c = a[i:i + CHUNK]
        yield c if c.dtype == np.float64 else c.astype(np.float64)


@dataclass
class _Scan:
    n_total: int = 0          # every value read
    n_no_value: int = 0       # not finite
    n_zero: int = 0           # finite and exactly 0
    n: int = 0                # finite values that count for the edges (zeros out under the zero bin, <= 0 out under log)
    vmin: float = math.inf    # over those
    vmax: float = -math.inf
    n_negative: int = 0       # finite and below 0, anywhere
    minpos: float = math.inf  # least value above 0, anywhere (log-spaced lower end)


def _counted(c: np.ndarray, zero_bin: bool, positive: bool) -> np.ndarray:
    """The values of a chunk that take part in the edges."""
    f = np.isfinite(c)
    if not f.all():
        c = c[f]
    if zero_bin:
        c = c[c != 0]
    if positive:
        c = c[c > 0]
    return c


def _scan(slabs: Callable[[], Iterable[np.ndarray]], zero_bin: bool, positive: bool) -> _Scan:
    s = _Scan()
    for slab in slabs():
        for c in _chunks(slab):
            s.n_total += c.size
            f = np.isfinite(c)
            nf = int(f.size - np.count_nonzero(f))
            s.n_no_value += nf
            if nf:
                c = c[f]
            if c.size == 0:
                continue
            s.n_zero += int(c.size - np.count_nonzero(c))
            lo, hi = float(c.min()), float(c.max())
            if lo < 0:
                s.n_negative += int(np.count_nonzero(c < 0))
            pos = c[c > 0]
            if pos.size:
                s.minpos = min(s.minpos, float(pos.min()))
            v = c
            if zero_bin:
                v = v[v != 0]
            if positive:
                v = v[v > 0]
            if v.size:
                s.n += v.size
                s.vmin = min(s.vmin, float(v.min()))
                s.vmax = max(s.vmax, float(v.max()))
    return s


def edges(slabs: Callable[[], Iterable[np.ndarray]], b: Binning) -> Edges:
    """The edges of ``b`` over the values ``slabs()`` gives. ``slabs`` is called once per pass.

    ``manual`` reads nothing. ``equal_width`` with a stored ``range`` needs no edge-finding read but still
    scans once for the counts (and to refuse a zero bin on a source with negative values). ``equal_count`` makes
    three passes over the data: range and counts, bucket counts, and the values of the buckets that hold the
    wanted order statistics.
    """
    if b.method == "manual":
        t = np.asarray(b.thresholds, dtype=np.float64)
        return Edges(binning=b, edges=t, n_bins=len(t) + 1)
    slabs = _passes(_check_replayable(slabs))
    if b.method == "categories":
        return _category_edges(slabs, b)

    log = b.method == "log"
    s = _scan(slabs, b.zero_bin, positive=log)
    if b.zero_bin and s.n_negative:
        raise BinningError("zero_bin_negative", "The zero bin is offered only when the source has no negative value.",
                           n_negative=s.n_negative)
    common = dict(binning=b, bins_asked=b.bins, edges_n=s.n_total - s.n_no_value, n_zero=s.n_zero, n_no_value=s.n_no_value)

    def degenerate(value: Optional[float]) -> Edges:
        v = None if value is None else float(value)
        return Edges(edges=np.asarray([v, v] if v is not None else [], dtype=np.float64), n_bins=1, degenerate=True,
                     degenerate_value=v, **common)

    if b.method in ("equal_width", "log"):
        # a stored side stands; a missing side comes from the values under the same rules as no range
        slo, shi = b.range if b.range is not None else (None, None)
        if (slo is None or shi is None) and s.n == 0:
            return degenerate(None)
        lo = s.vmin if slo is None else slo
        hi = s.vmax if shi is None else shi
        if lo > hi:
            raise BinningError("bad_range", "The stored side of the range lies beyond all the values, so no bin is left.",
                               lo=lo, hi=hi)
        if lo == hi:
            return degenerate(lo)
        stored = b.range is not None
        if b.method == "equal_width":
            # np.linspace is what numpy.histogram_bin_edges builds, so the two agree to the bit.
            return Edges(edges=np.linspace(lo, hi, b.bins + 1, endpoint=True), n_bins=b.bins,
                         range_stored=stored, range_used=(lo, hi), **common)
        ed = lo * (hi / lo) ** (np.arange(b.bins + 1, dtype=np.float64) / b.bins)
        ed[0], ed[-1] = lo, hi
        ed = _merge(ed)
        if ed.size < 2:
            return degenerate(lo)
        return Edges(edges=ed, n_bins=ed.size - 1, range_stored=stored, range_used=(lo, hi), **common)

    # equal_count
    if s.n == 0:
        return degenerate(None)
    if s.vmin == s.vmax:
        return degenerate(s.vmin)
    qs = np.arange(b.bins + 1, dtype=np.float64) / b.bins

    def values() -> Iterable[np.ndarray]:
        for slab in slabs():
            for c in _chunks(slab):
                v = _counted(c, b.zero_bin, False)
                if v.size:
                    yield v

    ed = _merge(_exact_quantiles(values, s.n, s.vmin, s.vmax, qs))
    if ed.size < 2:
        return degenerate(s.vmin)
    return Edges(edges=ed, n_bins=ed.size - 1, **common)


def _merge(ed: np.ndarray) -> np.ndarray:
    """Equal neighbouring edges are one edge, so a bin is never empty by construction."""
    if ed.size < 2:
        return ed
    keep = np.concatenate(([True], ed[1:] != ed[:-1]))
    return ed[keep]


def _category_edges(slabs: Callable[[], Iterable[np.ndarray]], b: Binning) -> Edges:
    distinct = np.empty(0, dtype=np.float64)
    n_total = n_no_value = 0
    for slab in slabs():
        for c in _chunks(slab):
            n_total += c.size
            f = np.isfinite(c)
            nf = int(f.size - np.count_nonzero(f))
            n_no_value += nf
            if nf:
                c = c[f]
            if c.size:
                distinct = np.union1d(distinct, np.unique(c))
                if distinct.size > MAX_CATEGORY_LEVELS:
                    raise BinningError("too_many_levels",
                                       f"The source has more than {MAX_CATEGORY_LEVELS} distinct values.",
                                       limit=MAX_CATEGORY_LEVELS)
    distinct = distinct + 0.0           # -0.0 and 0.0 are one value: unique keeps one of them, make it +0
    return Edges(binning=b, edges=distinct, n_bins=int(distinct.size), edges_n=n_total - n_no_value,
                 n_zero=0, n_no_value=n_no_value)


# --------------------------------------------------------------------------------------------------------------
# The exact select
# --------------------------------------------------------------------------------------------------------------


def _exact_quantiles(values: Callable[[], Iterable[np.ndarray]], n: int, vmin: float, vmax: float,
                     qs: np.ndarray) -> np.ndarray:
    """``numpy.quantile(x, qs)`` (linear method) for the ``n`` values ``values()`` yields, bit for bit.

    numpy's default needs the order statistics ``k = floor(q (n-1))`` and ``k + 1`` (clipped to ``n - 1``). They are
    found without copying the column: :func:`_select` counts the values in 65,536 equal-width buckets, the
    cumulative counts name the bucket of each wanted rank, and only those buckets' values are collected and
    sorted. A bucket of more than SELECT_COLLECT_CAP values is split again the same way.
    """
    virtual = (n - 1) * qs                      # numpy: get_virtual_index for 'linear'
    prev = np.floor(virtual).astype(np.int64)
    gamma_base = virtual
    over = virtual >= n - 1
    prev = np.where(over, n - 1, prev)
    nxt = np.where(over, n - 1, prev + 1)
    gamma = gamma_base - prev                   # numpy computes gamma after the clip
    ranks = np.unique(np.concatenate((prev, nxt)))
    got = _select(values, ranks, n, vmin, vmax, 0)
    a = got[np.searchsorted(ranks, prev)]
    bb = got[np.searchsorted(ranks, nxt)]
    # numpy's _lerp
    diff = bb - a
    out = a + diff * gamma
    upper = gamma >= 0.5
    out[upper] = (bb - diff * (1 - gamma))[upper]
    return out


def _bucket(x: np.ndarray, lo: float, scale: float) -> np.ndarray:
    idx = ((x - lo) * scale).astype(np.int64)
    np.clip(idx, 0, SELECT_BUCKETS - 1, out=idx)
    return idx


def _select(values: Callable[[], Iterable[np.ndarray]], ranks: np.ndarray, n: int, lo: float, hi: float,
            depth: int) -> np.ndarray:
    """The values of the sorted order statistics ``ranks`` (ascending, unique) of the ``n`` values in ``[lo, hi]``."""
    if lo == hi:
        return np.full(ranks.size, lo, dtype=np.float64)
    scale = SELECT_BUCKETS / (hi - lo)
    counts = np.zeros(SELECT_BUCKETS, dtype=np.int64)
    seen = 0
    for v in values():
        counts += np.bincount(_bucket(v, lo, scale), minlength=SELECT_BUCKETS)
        seen += v.size
    if seen != n:
        raise BinningError("slabs_changed", "The slabs gave a different number of values on a later pass.", first=n, later=seen)
    cum = np.cumsum(counts)
    bucket_of = np.searchsorted(cum, ranks, side="right")
    first_of = cum[bucket_of] - counts[bucket_of]
    offset = ranks - first_of
    result = np.empty(ranks.size, dtype=np.float64)

    wanted = np.unique(bucket_of)
    big = [int(w) for w in wanted if counts[w] > SELECT_COLLECT_CAP]
    small = [int(w) for w in wanted if counts[w] <= SELECT_COLLECT_CAP]

    for w in big:
        sel = bucket_of == w
        sub_n = int(counts[w])

        def members(w=w) -> Iterable[np.ndarray]:
            for v in values():
                m = v[_bucket(v, lo, scale) == w]
                if m.size:
                    yield m

        sub_lo, sub_hi = math.inf, -math.inf
        for m in members():
            sub_lo, sub_hi = min(sub_lo, float(m.min())), max(sub_hi, float(m.max()))
        if depth >= _SELECT_DEPTH and sub_lo != sub_hi:
            raise BinningError("select_failed", "A bucket of equal-looking values could not be split.")
        result[sel] = _select(members, offset[sel], sub_n, sub_lo, sub_hi, depth + 1)

    # Small buckets are collected in batches that keep the held values under the cap.
    batch: List[int] = []
    held = 0
    batches: List[List[int]] = []
    for w in small:
        if batch and held + int(counts[w]) > SELECT_COLLECT_CAP:
            batches.append(batch)
            batch, held = [], 0
        batch.append(w)
        held += int(counts[w])
    if batch:
        batches.append(batch)
    for batch in batches:
        table = np.zeros(SELECT_BUCKETS, dtype=bool)
        table[batch] = True
        vals: List[np.ndarray] = []
        idxs: List[np.ndarray] = []
        for v in values():
            idx = _bucket(v, lo, scale)
            m = table[idx]
            if m.any():
                vals.append(v[m])
                idxs.append(idx[m])
        got = np.concatenate(vals) if vals else np.empty(0)
        gi = np.concatenate(idxs) if idxs else np.empty(0, dtype=np.int64)
        if got.size != sum(int(counts[w]) for w in batch):
            raise BinningError("slabs_changed", "The slabs gave different values on a later pass.")
        order = np.lexsort((got, gi))
        got = got[order]
        starts = np.concatenate(([0], np.cumsum([int(counts[w]) for w in batch])))
        pos = {w: int(starts[i]) for i, w in enumerate(batch)}
        for j in np.flatnonzero(np.isin(bucket_of, batch)):
            result[j] = got[pos[int(bucket_of[j])] + int(offset[j])]
    return result


# --------------------------------------------------------------------------------------------------------------
# Assignment
# --------------------------------------------------------------------------------------------------------------


@dataclass
class Counts:
    """Counts :func:`assign` adds up across slabs, for the reply (``n_no_value``, ``n_outside``)."""

    n_no_value: int = 0     # not finite, or <= 0 under log-spaced bins
    n_below: int = 0        # below the first edge: clamped or excluded as ``outside`` says
    n_above: int = 0        # above the last edge
    n_unmatched: int = 0    # a value no category matches (categories only)
    n_zero: int = 0         # exactly 0 under the zero bin

    @property
    def n_outside(self) -> List[int]:
        return [self.n_below, self.n_above]


def assign(values: Any, e: Edges, counts: Optional[Counts] = None) -> np.ndarray:
    """The ``uint16`` level index of each value: the position in :func:`level_ids`, or ``NO_LEVEL``.

    ``[lo, hi)`` with the last bin closed. A value outside the edges (only possible with a stored range, or with
    edges computed over other cells) goes to the first or last bin under ``outside: 'clamp'`` and to ``NO_LEVEL``
    under ``'exclude'``; ``counts``, if given, gets the number of such cells either way.
    """
    a = np.asarray(values)
    flat = a.reshape(-1)
    out = np.empty(flat.size, dtype=np.uint16)
    for i in range(0, flat.size, CHUNK):
        c = flat[i:i + CHUNK]
        out[i:i + CHUNK] = _assign_chunk(c if c.dtype == np.float64 else c.astype(np.float64), e, counts)
    return out.reshape(a.shape)


def _assign_chunk(x: np.ndarray, e: Edges, counts: Optional[Counts]) -> np.ndarray:
    b = e.binning
    code = np.full(x.size, NO_LEVEL, dtype=np.uint16)
    ok = np.isfinite(x)
    if counts is not None:
        counts.n_no_value += int(ok.size - np.count_nonzero(ok))
    base = 0
    if e.zero_bin:
        base = 1
        z = ok & (x == 0)
        code[z] = 0
        if counts is not None:
            counts.n_zero += int(np.count_nonzero(z))
        ok &= ~z
    if b.method == "log":
        pos = x > 0
        if counts is not None:
            counts.n_no_value += int(np.count_nonzero(ok & ~pos))
        ok &= pos
    if not ok.any():
        return code
    v = x[ok]
    if e.degenerate:
        idx = np.zeros(v.size, dtype=np.int64)
    elif b.method == "manual":
        idx = np.searchsorted(e.edges, v, side="right")
    elif b.method == "categories":
        idx = np.searchsorted(e.edges, v, side="left")
        hit = idx < e.edges.size
        hit[hit] = e.edges[idx[hit]] == v[hit]
        if not hit.all():
            if counts is not None:
                counts.n_unmatched += int(hit.size - np.count_nonzero(hit))
            idx = np.where(hit, idx, NO_LEVEL - base)
    else:
        ed = e.edges
        idx = np.searchsorted(ed[1:-1], v, side="right")
        below = v < ed[0]
        above = v > ed[-1]
        if counts is not None:
            counts.n_below += int(np.count_nonzero(below))
            counts.n_above += int(np.count_nonzero(above))
        if b.outside == "exclude":
            gone = below | above
            if gone.any():
                idx = np.where(gone, NO_LEVEL - base, idx)
    full = idx + base
    code[ok] = np.where(idx >= NO_LEVEL - base, NO_LEVEL, full).astype(np.uint16)
    return code


# --------------------------------------------------------------------------------------------------------------
# Preview
# --------------------------------------------------------------------------------------------------------------


def preview(slabs: Callable[[], Iterable[np.ndarray]], bins: int = 100) -> Dict[str, Any]:
    """The histogram of SHR-18: an equal-width count of the finite values, and what the zero bin needs to know.

    ``{lo, hi, counts, n, n_no_value, n_zero, zero_share, has_negative, zero_bin_default, degenerate}``. The
    default of the zero bin (SHR-15) is on when at least 25% of the values are exactly 0 and none is negative.
    """
    slabs = _passes(_check_replayable(slabs))
    s = _scan(slabs, zero_bin=False, positive=False)
    n_finite = s.n_total - s.n_no_value
    share = (s.n_zero / n_finite) if n_finite else 0.0
    out: Dict[str, Any] = {
        "n": int(n_finite), "n_no_value": int(s.n_no_value), "n_zero": int(s.n_zero), "zero_share": share,
        "has_negative": bool(s.n_negative), "zero_bin_default": bool(n_finite and share >= ZERO_BIN_SHARE and not s.n_negative),
        "degenerate": False,
    }
    if n_finite == 0:
        out.update(lo=None, hi=None, counts=[], degenerate=True)
        return out
    lo, hi = s.vmin, s.vmax
    if lo == hi:
        out.update(lo=lo, hi=hi, counts=[int(n_finite)], degenerate=True)
        return out
    counts = np.zeros(bins, dtype=np.int64)
    # the same edges numpy.histogram would use: linspace, last bin closed
    ed = np.linspace(lo, hi, bins + 1)
    seen = 0
    for slab in slabs():
        for c in _chunks(slab):
            c = c[np.isfinite(c)]
            if c.size:
                idx = np.searchsorted(ed[1:-1], c, side="right")
                counts += np.bincount(idx, minlength=bins)
                seen += c.size
    if seen != n_finite:
        raise BinningError("slabs_changed", "The slabs gave a different number of values on a later pass.")
    out.update(lo=lo, hi=hi, counts=[int(v) for v in counts])
    return out
