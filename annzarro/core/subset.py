"""Reproducible cell subsets that every cell-axis read agrees on.

A dataset with a million cells cannot be drawn whole in a browser tab, so the
viewer shows a subset. The subset has to be the SAME cells in every response:
if the UMAP holds 100,000 cells and the obs column colouring it holds a
different 100,000, every colour is wrong and nothing says so. This module
makes that one decision in one place.

A subset is described by a small spec, sent by the client as the ``subset``
query parameter (compact JSON)::

    {"n": 100000, "seed": 0}                         100,000 cells, seed 0
    {"n": 100000, "seed": 0, "balance": "batch"}     as even across batches as the sizes allow
    {"n": null, "seed": 0, "where": [...]}           every cell passing the filter
    {"n": 5000, "seed": 3, "where": [{"col": "cluster", "op": "in", "values": ["3", "5"]}]}

Which cells: every cell gets a rank key, ``splitmix64(splitmix64(seed) ^ row)``,
and the subset is the ``n`` eligible cells with the smallest keys. That is a
fixed function of (seed, row), not a draw from numpy's generator, so the same
spec names the same cells on every machine and numpy version. Because the keys
are a bijection of the row number there are no ties, and a larger ``n`` with
the same seed keeps every cell of a smaller one: going from 50,000 to 100,000
cells adds cells, it never swaps the ones already on screen.

How it is served: :class:`SubsetView` wraps a reader and presents the subset as
an AnnData view, ``adata[indices]``. Cell positions in a request are positions
in the subset; whole-axis reads come back with only the subset's rows, in
dataset order; the metadata reports the subset's shape, so the routes' index
checks and size guard apply to the subset unchanged. Matrix reads go through
the inner reader exactly as an unsubset request would (all cells, one gene
column is the reader's fast path) and are sliced afterwards; asking zarr for
100,000 scattered rows of a gene-by-cell matrix would read far more than the
column. obs columns, which are one value per cell, are read by index.

Nothing about the subset is stored per client: the spec travels with every
request, and the server caches the resolved indices (16 specs, keyed by the
store's stat signature). Responses are cached as before: a subset response is
the inner reader's cached full-axis result, sliced.
"""

from __future__ import annotations

import json
import math
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np

from .name_index import _signature as _store_signature

#: Limits: a spec rides in the query string of every cell-axis request, and
#: gunicorn refuses a request line over 4094 bytes.
MAX_CONDITIONS = 16
MAX_VALUES = 200
MAX_SPEC_CHARS = 2000
MAX_SEED = 2**32 - 1

#: Ops on a column's text form (categorical/string/bool columns, any column).
TEXT_OPS = ("in", "not_in")
#: Ops on a column's numeric value. "between" is inclusive at both ends.
NUMERIC_OPS = (">", ">=", "<", "<=", "==", "!=", "between")

#: Defaults when the server config does not set ui.defaults.subset_*.
DEFAULT_THRESHOLD = 200_000
DEFAULT_SIZE = 100_000
DEFAULT_SEED = 0

#: Label a missing value gets as a balance group.
MISSING_GROUP = "(missing)"

_U64 = np.uint64


class SubsetError(ValueError):
    """A subset spec the server cannot apply; answered as 400 (or 404 for an
    unknown column) with a ``reason`` code."""

    def __init__(self, message: str, reason: str = "bad_subset", status: int = 400):
        super().__init__(message)
        self.message, self.reason, self.status = message, reason, status


@dataclass(frozen=True)
class Condition:
    col: str
    op: str
    values: Tuple[Any, ...] = ()

    def canonical(self) -> Dict[str, Any]:
        if self.op in TEXT_OPS:
            return {"col": self.col, "op": self.op, "values": list(self.values)}
        if self.op == "between":
            return {"col": self.col, "op": self.op, "value": list(self.values)}
        return {"col": self.col, "op": self.op, "value": self.values[0]}


@dataclass(frozen=True)
class SubsetSpec:
    n: Optional[int]
    seed: int = DEFAULT_SEED
    balance: Optional[str] = None
    where: Tuple[Condition, ...] = field(default_factory=tuple)
    part: int = 0

    def canonical(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {"n": self.n, "seed": self.seed}
        if self.balance is not None:
            out["balance"] = self.balance
        if self.where:
            out["where"] = [c.canonical() for c in self.where]
        # Part 0 is written as before parts existed, so its key, its cache
        # entries and every link that names it are unchanged.
        if self.part:
            out["part"] = self.part
        return out

    def key(self) -> str:
        """The spec as compact JSON with a fixed key order: what the client
        sends back, and the cache key."""
        return json.dumps(self.canonical(), separators=(",", ":"), sort_keys=False)

    def columns(self) -> List[str]:
        cols = [c.col for c in self.where]
        if self.balance is not None:
            cols.append(self.balance)
        return list(dict.fromkeys(cols))


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def _int(value, name, lo, hi, allow_none=False):
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SubsetError(f"subset {name} must be an integer, got {value!r}")
    if isinstance(value, float):
        if not value.is_integer():
            raise SubsetError(f"subset {name} must be an integer, got {value!r}")
        value = int(value)
    if value < lo or value > hi:
        raise SubsetError(f"subset {name} must be between {lo} and {hi}, got {value}")
    return int(value)


def _number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise SubsetError(f"subset condition {name} must be a finite number, got {value!r}")
    return value


def _condition(raw) -> Condition:
    if not isinstance(raw, dict):
        raise SubsetError(f"subset condition must be an object, got {raw!r}")
    col, op = raw.get("col"), raw.get("op")
    if not isinstance(col, str) or not col:
        raise SubsetError("subset condition needs a column name in 'col'")
    if op in TEXT_OPS:
        values = raw.get("values")
        if not isinstance(values, list) or not values:
            raise SubsetError(f"subset condition '{op}' on {col!r} needs a non-empty 'values' list")
        if len(values) > MAX_VALUES:
            raise SubsetError(f"subset condition on {col!r} lists more than {MAX_VALUES} values")
        text = sorted({value_text(v) for v in values})
        return Condition(col, op, tuple(text))
    if op == "between":
        bounds = raw.get("value")
        if not isinstance(bounds, list) or len(bounds) != 2:
            raise SubsetError(f"subset condition 'between' on {col!r} needs 'value': [low, high]")
        lo, hi = (_number(b, "bound") for b in bounds)
        if lo > hi:
            lo, hi = hi, lo
        return Condition(col, op, (lo, hi))
    if op in NUMERIC_OPS:
        return Condition(col, op, (_number(raw.get("value"), "value"),))
    raise SubsetError(f"unknown subset condition op {op!r}; "
                      f"use one of {', '.join(TEXT_OPS + NUMERIC_OPS)}")


def parse_spec(raw) -> Optional[SubsetSpec]:
    """A validated spec from the ``subset`` parameter (JSON text or a dict).

    ``"all"`` (or an empty value) means no subset and returns None. ``"auto"``
    is resolved by :func:`resolve` and is not accepted here.
    """
    if raw is None:
        return None
    if isinstance(raw, str):
        text = raw.strip()
        if text in ("", "all", "null"):
            return None
        if len(text) > MAX_SPEC_CHARS:
            raise SubsetError(f"subset is {len(text)} characters long; at most {MAX_SPEC_CHARS} "
                              "fit in a request. Use fewer filter values.")
        try:
            raw = json.loads(text)
        except ValueError:
            raise SubsetError(f"subset must be JSON, 'all' or 'auto', got {text[:80]!r}")
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise SubsetError(f"subset must be a JSON object, got {raw!r}")
    unknown = set(raw) - {"n", "seed", "balance", "where", "part"}
    if unknown:
        raise SubsetError(f"unknown subset field(s): {', '.join(sorted(unknown))}")
    n = _int(raw.get("n"), "n", 1, 2**62, allow_none=True)
    seed = _int(raw.get("seed", DEFAULT_SEED), "seed", 0, MAX_SEED)
    balance = raw.get("balance")
    if balance is not None and (not isinstance(balance, str) or not balance):
        raise SubsetError("subset balance must be an obs column name")
    where = raw.get("where")
    where = [] if where is None else where
    if not isinstance(where, list):
        raise SubsetError("subset where must be a list of conditions")
    if len(where) > MAX_CONDITIONS:
        raise SubsetError(f"subset where has more than {MAX_CONDITIONS} conditions")
    conditions = tuple(_condition(c) for c in where)
    if n is None and balance is not None:
        raise SubsetError("subset balance needs a cell count n")
    part = _int(raw.get("part", 0), "part", 0, 2**62)
    return SubsetSpec(n=n, seed=seed, balance=balance, where=conditions, part=part)


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------

def _splitmix64(x: np.ndarray) -> np.ndarray:
    """splitmix64's output function on a uint64 array (wraps mod 2**64)."""
    with np.errstate(over="ignore"):
        z = x + _U64(0x9E3779B97F4A7C15)
        z = (z ^ (z >> _U64(30))) * _U64(0xBF58476D1CE4E5B9)
        z = (z ^ (z >> _U64(27))) * _U64(0x94D049BB133111EB)
        return z ^ (z >> _U64(31))


def rank_keys(n_obs: int, seed: int) -> np.ndarray:
    """One distinct uint64 key per row; the subset takes the smallest."""
    salt = _splitmix64(np.array([seed], dtype=_U64))[0]
    return _splitmix64(np.arange(n_obs, dtype=_U64) ^ salt)


#: Rows whose rank keys are computed at once when only the smallest are kept.
_KEY_BLOCK = 1 << 20


def _block_rows(n_obs: int, eligible: Optional[np.ndarray], block: int = _KEY_BLOCK):
    """(rows, slice) per block of ``block`` dataset rows: the eligible rows
    in it (every row when ``eligible`` is None) and the block's slice."""
    for start in range(0, n_obs, block):
        stop = min(start + block, n_obs)
        if eligible is None:
            yield np.arange(start, stop, dtype=np.int64), slice(start, stop)
        else:
            yield start + np.flatnonzero(eligible[start:stop]), slice(start, stop)


def _keys(rows: np.ndarray, salt) -> np.ndarray:
    """rank_keys(n_obs, seed)[rows], for the salt of seed."""
    return _splitmix64(rows.astype(_U64) ^ salt)


def _salt(seed: int):
    return _splitmix64(np.array([seed], dtype=_U64))[0]


_MAX_KEY = np.iinfo(np.uint64).max


def _key_limit(fraction: float):
    """The rank key at ``fraction`` of the key range (0 -> 0, 1 -> the top)."""
    if fraction <= 0:
        return 0
    if fraction >= 1:
        return int(_MAX_KEY)
    return min(int(fraction * 2.0**64), int(_MAX_KEY))


def _rank_window(n_obs: int, eligible: Optional[np.ndarray], group_of, n_groups: int, seed: int,
                 sizes, lo, count, block: int = _KEY_BLOCK) -> np.ndarray:
    """For each group g, the eligible rows of g whose rank among g's rows by
    rank key is in [lo[g], lo[g] + count[g]): the rows a sort of every
    eligible row by (group, key) would put there, without that sort.

    Rank keys are splitmix64 outputs, spread evenly over the key range, so
    rank r of a group of size S sits near key r / S of the range. One pass
    over the rows (a block at a time) counts each group's rows below a key a
    little under that window and collects the rows inside it. When a group's
    count or collection does not bracket its ranks the window is widened and
    that group is collected again. The ranks are then exact: only the
    collected rows (about 1.1 x the window) are sorted, and memory stays at
    one block plus them.

    ``group_of(rows, slice)`` gives each row's group (0..n_groups-1).
    """
    salt = _salt(seed)
    sizes = np.maximum(np.asarray(sizes, dtype=np.float64), 1.0)
    lo = np.asarray(lo, dtype=np.int64)
    count = np.asarray(count, dtype=np.int64)
    margin = 0.05 * count + 6 * np.sqrt(lo + count + 1.0) + 16
    fa = np.where(lo > 0, (lo - margin) / sizes, 0.0)
    fb = (lo + count + margin) / sizes
    pending = np.flatnonzero(count > 0)
    out_rows, out_keys, out_groups = [], [], []
    below_all = np.zeros(n_groups, dtype=np.int64)
    while pending.size:
        a = np.zeros(n_groups, dtype=_U64)
        b = np.zeros(n_groups, dtype=_U64)
        a[pending] = [_key_limit(f) for f in fa[pending].tolist()]
        b[pending] = [_key_limit(f) for f in fb[pending].tolist()]
        wanted = np.zeros(n_groups, dtype=bool)
        wanted[pending] = True
        below = np.zeros(n_groups, dtype=np.int64)
        hits = []
        for part, sl in _block_rows(n_obs, eligible, block):
            groups = group_of(part, sl)
            keys = _keys(part, salt)
            w = wanted[groups]
            under = w & (keys < a[groups])
            below += np.bincount(groups[under], minlength=n_groups)
            inside = w & ~under & (keys <= b[groups])
            hits.append((part[inside], keys[inside], groups[inside]))
        rows = np.concatenate([h[0] for h in hits]) if hits else np.empty(0, np.int64)
        keys = np.concatenate([h[1] for h in hits]) if hits else np.empty(0, _U64)
        groups = np.concatenate([h[2] for h in hits]) if hits else np.empty(0, np.int64)
        got = np.bincount(groups, minlength=n_groups)
        too_high = below[pending] > lo[pending]
        too_few = below[pending] + got[pending] < lo[pending] + count[pending]
        # a window over the whole key range has every row of its group: final
        whole = (fa[pending] <= 0) & (fb[pending] >= 1)
        retry = pending[(too_high | too_few) & ~whole]
        done = ~np.isin(groups, retry)
        out_rows.append(rows[done]); out_keys.append(keys[done]); out_groups.append(groups[done])
        below_all[np.setdiff1d(pending, retry)] = below[np.setdiff1d(pending, retry)]
        width = np.maximum(fb[retry] - fa[retry], 1e-9)
        fa[retry] = np.where(below[retry] > lo[retry], np.maximum(fa[retry] - 2 * width, 0.0), fa[retry])
        fa[retry] = np.where(fa[retry] < 1e-12, 0.0, fa[retry])
        fb[retry] = np.where(below[retry] + got[retry] < lo[retry] + count[retry],
                             fb[retry] + 2 * width, fb[retry])
        pending = retry
    rows = np.concatenate(out_rows) if out_rows else np.empty(0, np.int64)
    keys = np.concatenate(out_keys) if out_keys else np.empty(0, _U64)
    groups = np.concatenate(out_groups) if out_groups else np.empty(0, np.int64)
    order = np.lexsort((keys, groups))
    g = groups[order]
    rank = np.arange(len(order)) - np.searchsorted(g, g, side="left") + below_all[g]
    return rows[order[(rank >= lo[g]) & (rank < lo[g] + count[g])]]


def _rows_with_smallest_keys(n_obs: int, eligible: Optional[np.ndarray], seed: int, k: int,
                             block: int = _KEY_BLOCK) -> np.ndarray:
    """The k eligible rows (every row when ``eligible`` is None) with the
    smallest rank keys: ``rows[_smallest(rank_keys(n_obs, seed)[rows], k)]``
    without the n_obs-long key array (3 GB at the peak at 95.6M cells)."""
    total = n_obs if eligible is None else int(np.count_nonzero(eligible))
    zeros = lambda part, sl: np.zeros(len(part), dtype=np.int64)  # noqa: E731
    return _rank_window(n_obs, eligible, zeros, 1, seed, [total], [0], [min(k, total)], block)


def partition_quotas(sizes, n: int, part: int):
    """(first rank, count) per group for ``part`` of a balanced partition.

    Part j is the balanced selection (water-filling, balanced_quota) of n
    cells from the cells not in parts 0..j-1. Within a group the parts take
    its cells in rank-key order, so group g's part-j cells are its ranks
    [first[g], first[g] + count[g]). Arithmetic on the group sizes only.
    """
    remaining = np.asarray(sizes, dtype=np.int64).copy()
    first = np.zeros(len(remaining), dtype=np.int64)
    for _ in range(part):
        q = balanced_quota(remaining, n)
        first += q
        remaining -= q
    return first, balanced_quota(remaining, n)


def _smallest(keys: np.ndarray, k: int) -> np.ndarray:
    """Positions of the k smallest keys (keys are distinct, so this is exact)."""
    if k >= len(keys):
        return np.arange(len(keys))
    if k <= 0:
        return np.array([], dtype=np.int64)
    return np.argpartition(keys, k - 1)[:k]


def balanced_quota(sizes: Sequence[int], budget: int) -> np.ndarray:
    """Cells to take from each group: as equal as the group sizes allow.

    Water-filling: a group smaller than its equal share is taken whole and
    its unused share goes to the others; the groups still over their share
    get ``budget // k`` each and the remainder one extra each, in group order.
    Sums to ``min(budget, sum(sizes))``.
    """
    sizes = np.asarray(sizes, dtype=np.int64)
    quota = np.zeros(len(sizes), dtype=np.int64)
    budget = int(min(budget, sizes.sum())) if len(sizes) else 0
    if not len(sizes):
        return quota
    # The smallest group still open is taken whole while it fits its share
    # of what is left; the first that does not fit ends that. Vectorised:
    # step i (groups by size) has budget - (sizes taken before) to share
    # among the len - i groups still open.
    order = np.argsort(sizes, kind="stable")
    ordered = sizes[order]
    before = np.concatenate([[0], np.cumsum(ordered)[:-1]])
    open_count = len(sizes) - np.arange(len(sizes))
    fits = ordered <= (budget - before) // open_count
    t = int(np.argmin(fits)) if not fits.all() else len(sizes)
    quota[order[:t]] = ordered[:t]
    if t < len(sizes):
        left = budget - int(before[t])
        rest = np.sort(order[t:])
        share = left // len(rest)
        quota[rest] = share
        quota[rest[: left - share * len(rest)]] += 1
    return quota


def value_text(v) -> str:
    """The text a value is matched as in ``in``/``not_in`` and grouped by."""
    if isinstance(v, (bool, np.bool_)):
        return "true" if v else "false"
    if isinstance(v, (int, np.integer)):
        return str(int(v))
    if isinstance(v, (float, np.floating)):
        return str(int(v)) if float(v).is_integer() else repr(float(v))
    if isinstance(v, bytes):
        return v.decode("utf-8", "replace")
    return str(v)


def _is_missing(v) -> bool:
    return v is None or (isinstance(v, (float, np.floating)) and math.isnan(v))


def _numeric(values: Sequence) -> np.ndarray:
    """float64 view of a column; missing and non-numeric entries are NaN."""
    arr = np.asarray(values)
    if arr.dtype.kind in "iuf":
        return arr.astype(np.float64, copy=False)
    if arr.dtype.kind == "b":
        return arr.astype(np.float64)
    out = np.full(len(arr), np.nan)
    for i, v in enumerate(values):
        if isinstance(v, (bool, np.bool_)):
            out[i] = float(v)
        elif isinstance(v, (int, float, np.integer, np.floating)):
            out[i] = float(v)
    return out


def _condition_mask(cond: Condition, values: Sequence) -> np.ndarray:
    """True where a cell passes; a missing value passes no condition."""
    n = len(values)
    if cond.op in TEXT_OPS:
        wanted = set(cond.values)
        hit = np.fromiter((not _is_missing(v) and value_text(v) in wanted for v in values),
                          dtype=bool, count=n)
        if cond.op == "in":
            return hit
        present = np.fromiter((not _is_missing(v) for v in values), dtype=bool, count=n)
        return present & ~hit
    x = _numeric(values)
    with np.errstate(invalid="ignore"):
        if cond.op == "between":
            lo, hi = cond.values
            return (x >= lo) & (x <= hi)
        v = cond.values[0]
        return {">": x > v, ">=": x >= v, "<": x < v, "<=": x <= v,
                "==": x == v, "!=": (x != v) & ~np.isnan(x)}[cond.op]


def _compare(cond: Condition, x: np.ndarray) -> np.ndarray:
    with np.errstate(invalid="ignore"):
        if cond.op == "between":
            lo, hi = cond.values
            return (x >= lo) & (x <= hi)
        v = cond.values[0]
        return {">": x > v, ">=": x >= v, "<": x < v, "<=": x <= v,
                "==": x == v, "!=": (x != v) & ~np.isnan(x)}[cond.op]


class _Values:
    """A column as one Python value per cell (read_column)."""

    def __init__(self, values):
        self.values = values

    def __len__(self):
        return len(self.values)

    def mask(self, cond: Condition) -> np.ndarray:
        return _condition_mask(cond, self.values)

    def groups(self, eligible: np.ndarray):
        """(sorted group names, group_of(rows, sl)) for the eligible rows."""
        rows = np.flatnonzero(eligible)
        text = [MISSING_GROUP if _is_missing(self.values[i]) else value_text(self.values[i])
                for i in rows.tolist()]
        names, inverse = np.unique(np.asarray(text, dtype=object), return_inverse=True)
        gid = np.full(len(self.values), -1, dtype=np.int64)
        gid[rows] = inverse.reshape(-1)
        return names, lambda part, sl: gid[part]


class _Codes:
    """A categorical column as its stored codes and categories.

    Every per-cell question is asked once per category and answered for the
    cells with one numpy lookup: the same answers as asking each cell's
    value, which is categories[code] (None for a code outside them).
    """

    def __init__(self, codes, categories):
        self.codes = np.asarray(codes)
        self.categories = list(categories)
        k = len(self.categories)
        self.k = k
        self.missing = np.array([_is_missing(c) for c in self.categories] + [True], dtype=bool)

    def __len__(self):
        return len(self.codes)

    def ids(self, sl=slice(None)) -> np.ndarray:
        """Category index per cell; k (one past the last) for a missing value."""
        c = self.codes[sl].astype(np.int64, copy=False)
        return np.where((c < 0) | (c >= self.k), self.k, c)

    def mask(self, cond: Condition) -> np.ndarray:
        if cond.op in TEXT_OPS:
            wanted = set(cond.values)
            hit = np.array([not m and value_text(c) in wanted
                            for c, m in zip(self.categories, self.missing)] + [False], dtype=bool)
            lut = hit if cond.op == "in" else (~self.missing & ~hit)
        else:
            lut = _compare(cond, np.append(_numeric(self.categories), np.nan))
        out = np.empty(len(self.codes), dtype=bool)
        for start in range(0, len(self.codes), _KEY_BLOCK):
            sl = slice(start, start + _KEY_BLOCK)
            out[sl] = lut[self.ids(sl)]
        return out

    def groups(self, eligible: np.ndarray):
        counts = np.zeros(self.k + 1, dtype=np.int64)
        for start in range(0, len(self.codes), _KEY_BLOCK):
            sl = slice(start, start + _KEY_BLOCK)
            counts += np.bincount(self.ids(sl)[eligible[sl]], minlength=self.k + 1)
        text = np.array([MISSING_GROUP if m else value_text(c)
                         for c, m in zip(self.categories, self.missing)] + [MISSING_GROUP], dtype=object)
        names = np.unique(text[counts > 0])
        lut = np.full(self.k + 1, -1, dtype=np.int64)
        present = np.flatnonzero(counts > 0)
        lut[present] = np.searchsorted(names, text[present])
        return names, lambda part, sl: lut[self.ids(part)]


def _column_reader(n_obs: int, read_column, read_codes):
    """``column(name)``: one obs column as _Codes (categorical) or _Values."""
    def column(name):
        coded = read_codes(name) if read_codes is not None else None
        col = _Codes(*coded) if coded is not None else _Values(read_column(name))
        if len(col) != n_obs:
            raise SubsetError(f"obs column {name!r} has {len(col)} entries, expected {n_obs}")
        return col
    return column


def _eligible_rows(spec: SubsetSpec, column) -> Optional[np.ndarray]:
    """The rows the spec's filter keeps, as a mask; None without a filter."""
    eligible = None
    for cond in spec.where:
        mask = column(cond.col).mask(cond)
        eligible = mask if eligible is None else (eligible & mask)
    return eligible


def parts_of_rows(n_obs: int, spec: SubsetSpec, rows: Sequence[int],
                  read_column: Callable[[str], Sequence],
                  read_codes: Optional[Callable[[str], Optional[Tuple[Sequence, Sequence]]]] = None
                  ) -> List[Optional[int]]:
    """The part of the spec's partition that shows each dataset row; None
    for a row its filter leaves out.

    A row's part follows from its rank by rank key among the eligible rows
    (of its balance group, when balanced): one pass over the keys a block at
    a time, as select_indices makes, without resolving any part.
    """
    column = _column_reader(n_obs, read_column, read_codes)
    eligible = _eligible_rows(spec, column)
    n_eligible = int(n_obs if eligible is None else np.count_nonzero(eligible))
    n = n_eligible if spec.n is None else spec.n
    rows = np.asarray(rows, dtype=np.int64)
    ok = (rows >= 0) & (rows < n_obs)
    if eligible is not None:
        ok[ok] = eligible[rows[ok]]
    if not n or not ok.any():
        return [None] * len(rows)
    salt = _salt(spec.seed)
    mine = _keys(rows[ok], salt)
    if spec.balance is None:
        group = np.zeros(len(mine), dtype=np.int64)
        names, group_of = [0], (lambda part, sl: np.zeros(len(part), dtype=np.int64))
    else:
        names, group_of = column(spec.balance).groups(
            eligible if eligible is not None else np.ones(n_obs, dtype=bool))
        group = group_of(rows[ok], None)
    rank = np.zeros(len(mine), dtype=np.int64)
    sizes = np.zeros(len(names), dtype=np.int64)
    for part, sl in _block_rows(n_obs, eligible):
        groups = group_of(part, sl)
        sizes += np.bincount(groups, minlength=len(names))
        keys = _keys(part, salt)
        for g in np.unique(group):
            at = np.flatnonzero(group == g)
            k = keys[groups == g] if spec.balance is not None else keys
            if len(at) <= 8:     # the usual call: one focused cell
                for i in at:
                    rank[i] += int(np.count_nonzero(k < mine[i]))
            else:
                rank[at] += np.searchsorted(np.sort(k), mine[at], side="left")
    out = np.full(len(rows), -1, dtype=np.int64)
    if spec.balance is None:
        out[ok] = rank // n
    else:
        # parts take each group's cells in rank order: walk the quotas
        parts = max(1, -(-n_eligible // n))
        remaining = sizes.copy()
        first = np.zeros(len(sizes), dtype=np.int64)
        found = np.full(len(mine), -1, dtype=np.int64)
        for p in range(parts):
            q = balanced_quota(remaining, n)
            hit = (found < 0) & (rank >= first[group]) & (rank < first[group] + q[group])
            found[hit] = p
            if (found >= 0).all():
                break
            first += q
            remaining -= q
        out[ok] = found
    return [int(p) if p >= 0 else None for p in out.tolist()]


def select_indices(n_obs: int, spec: SubsetSpec,
                   read_column: Callable[[str], Sequence],
                   read_codes: Optional[Callable[[str], Optional[Tuple[Sequence, Sequence]]]] = None
                   ) -> Tuple[np.ndarray, Dict[str, Any]]:
    """Sorted row indices of the subset, and counts that describe it.

    ``read_column(name)`` returns one obs column for all ``n_obs`` cells.
    ``read_codes(name)``, when given, returns a categorical column as
    ``(codes, categories)`` (None when it is not categorical); the filter and
    the balance groups are then computed per category, not per cell. A
    per-cell Python loop over 95.6 million cells took minutes.
    """
    column = _column_reader(n_obs, read_column, read_codes)
    eligible = _eligible_rows(spec, column)
    n_eligible = int(n_obs if eligible is None else np.count_nonzero(eligible))
    n = n_eligible if spec.n is None else spec.n
    parts = max(1, -(-n_eligible // n)) if n else 1
    if spec.part >= parts:
        raise SubsetError(f"subset part {spec.part} does not exist: {n_eligible:,} cells in parts of "
                          f"{n:,} make {parts:,} part(s), numbered 0-{parts - 1}", "part_out_of_range")
    info: Dict[str, Any] = {"n_total": int(n_obs), "n_eligible": n_eligible,
                            "part": int(spec.part), "parts": int(parts)}

    if parts == 1:
        chosen = np.arange(n_obs) if eligible is None else np.flatnonzero(eligible)
    elif spec.balance is None:
        lo = spec.part * n
        zeros = lambda part, sl: np.zeros(len(part), dtype=np.int64)  # noqa: E731
        chosen = _rank_window(n_obs, eligible, zeros, 1, spec.seed, [n_eligible], [lo],
                              [min(n, n_eligible - lo)])
    else:
        if eligible is None:
            eligible = np.ones(n_obs, dtype=bool)
        names, group_of = column(spec.balance).groups(eligible)
        sizes = np.zeros(len(names), dtype=np.int64)
        for part, sl in _block_rows(n_obs, eligible):
            sizes += np.bincount(group_of(part, sl), minlength=len(names))
        first, quota = partition_quotas(sizes, n, spec.part)
        chosen = _rank_window(n_obs, eligible, group_of, len(names), spec.seed, sizes, first, quota)
        info["groups"] = {str(name): {"total": int(s), "shown": int(q), "before": int(f)}
                          for name, s, q, f in zip(names, sizes, quota, first)}
    indices = np.sort(chosen).astype(np.int32 if n_obs < 2**31 else np.int64)
    info["n"] = int(len(indices))
    return indices, info


# ---------------------------------------------------------------------------
# Resolution and cache
# ---------------------------------------------------------------------------

@dataclass
class Subset:
    """A resolved subset of one dataset."""
    dataset_path: str
    spec: SubsetSpec
    indices: np.ndarray            # sorted int64 rows of the full dataset
    info: Dict[str, Any]
    _names: Optional[List[str]] = None

    def __len__(self) -> int:
        return len(self.indices)

    def to_rows(self, positions) -> List[int]:
        """Dataset rows for positions in the subset (None stays None: all)."""
        if positions is None:
            return None
        pos = np.asarray(positions, dtype=np.int64)
        if pos.size and (pos.min() < 0 or pos.max() >= len(self.indices)):
            bad = int(pos[(pos < 0) | (pos >= len(self.indices))][0])
            raise IndexError(f"index {bad} is out of range: the subset has "
                             f"{len(self.indices)} cells (0-{len(self.indices) - 1})")
        return self.indices[pos].tolist()

    def to_positions(self, rows) -> List[int]:
        """Positions in the subset of dataset rows; -1 for a row it does not show."""
        rows = np.asarray(rows, dtype=np.int64)
        if not len(self.indices):
            return [-1] * len(rows)
        pos = np.searchsorted(self.indices, rows)
        found = self.indices[np.minimum(pos, len(self.indices) - 1)] == rows
        return np.where(found, pos, -1).tolist()

    def describe(self) -> Dict[str, Any]:
        out = {"subset": self.spec.canonical(), "key": self.spec.key()}
        out.update(self.info)
        return out


_cache: "OrderedDict[Tuple[str, Tuple, str], Subset]" = OrderedDict()
_lock = threading.Lock()
_CACHE_SIZE = 16
#: Bound on the cells all cached subsets hold together (indices, and names once
#: /cells asked for them): a filter-only spec on a 20M-cell store holds up to
#: 20M rows, and 16 of those would be gigabytes. The newest subset is always kept.
_CACHE_MAX_CELLS = 20_000_000


def _held(subset) -> int:
    return len(subset.indices) * (2 if subset._names is not None else 1)


def defaults(config) -> Dict[str, int]:
    """ui.defaults.subset_* from the Flask config (flattened as ui_subset_*)."""
    def get(key, default):
        value = config.get(key) if config is not None else None
        return default if value is None else int(value)
    return {
        "threshold": get("ui_subset_threshold", DEFAULT_THRESHOLD),
        "size": max(1, get("ui_subset_size", DEFAULT_SIZE)),
        "seed": get("ui_subset_seed", DEFAULT_SEED),
    }


def auto_spec(n_obs: int, config=None) -> Optional[SubsetSpec]:
    """The subset a dataset opens with: none up to the threshold, else the
    configured size and seed."""
    d = defaults(config)
    if n_obs <= d["threshold"]:
        return None
    return SubsetSpec(n=min(d["size"], n_obs), seed=d["seed"])


def _n_obs(reader, dataset_path) -> int:
    meta = reader.get_metadata(dataset_path) or {}
    shape = meta.get("shape") or ()
    if not shape:
        raise SubsetError(f"cannot subset {dataset_path}: its cell count is unknown", "unavailable", 400)
    return int(shape[0])


def _obs_columns(reader, dataset_path) -> Optional[List[str]]:
    meta = reader.get_metadata(dataset_path) or {}
    return meta.get("obs_columns")


def _readers(reader, dataset_path: str):
    """(read_column, read_codes) over the dataset's obs, for select_indices."""
    def read_column(name):
        result = reader.get_obs_var(entity="cells", dataset_path=dataset_path,
                                    column_names=[name], include_categories=False)
        data = result.get("data", result) if isinstance(result, dict) else result
        values = data.get(name) if isinstance(data, dict) else data
        if values is None:
            raise SubsetError(f"obs column {name!r} could not be read", "read_failed", 500)
        return values

    get_codes = getattr(reader, "get_obs_var_codes", None)

    def read_codes(name):
        if get_codes is None:
            return None
        return get_codes(entity="cells", dataset_path=dataset_path, column_name=name)

    return read_column, read_codes


def locate_parts(reader, dataset_path: str, spec: SubsetSpec, rows) -> List[Optional[int]]:
    """The part of ``spec`` that shows each dataset row (parts_of_rows)."""
    read_column, read_codes = _readers(reader, dataset_path)
    return parts_of_rows(_n_obs(reader, dataset_path), spec, rows, read_column, read_codes)


def get_subset(reader, dataset_path: str, spec: SubsetSpec) -> Subset:
    """The resolved subset for a spec, computed once per store version."""
    key = (dataset_path, _store_signature(dataset_path), spec.key())
    with _lock:
        hit = _cache.get(key)
        if hit is not None:
            _cache.move_to_end(key)
            return hit

    n_obs = _n_obs(reader, dataset_path)
    known = _obs_columns(reader, dataset_path)
    missing = [c for c in spec.columns() if known is not None and c not in known]
    if missing:
        raise SubsetError(f"No obs column {', '.join(repr(c) for c in missing)} in this dataset.",
                          "key_not_found", 404)

    read_column, read_codes = _readers(reader, dataset_path)
    indices, info = select_indices(n_obs, spec, read_column, read_codes)
    subset = Subset(dataset_path, spec, indices, info)
    with _lock:
        _cache[key] = subset
        _cache.move_to_end(key)
        while len(_cache) > 1 and (len(_cache) > _CACHE_SIZE or
                                   sum(_held(v) for v in _cache.values()) > _CACHE_MAX_CELLS):
            _cache.popitem(last=False)
    return subset


def resolve(reader, dataset_path: str, raw, config=None) -> Optional[Subset]:
    """The subset a ``subset`` parameter names; None for all cells.

    ``auto`` applies the server's default for this dataset's size. A spec
    that keeps every cell (no filter, n at least the cell count) is the
    whole dataset and resolves to None, so it is served exactly as a request
    without a subset is.
    """
    if raw is None:
        return None
    if isinstance(raw, str) and raw.strip() == "auto":
        spec = auto_spec(_n_obs(reader, dataset_path), config)
    else:
        spec = parse_spec(raw)
    if spec is None:
        return None
    if not spec.where and (spec.n is None or spec.n >= _n_obs(reader, dataset_path)):
        if spec.part:
            raise SubsetError(f"subset part {spec.part} does not exist: these cells form one part (part 0)",
                              "part_out_of_range")
        return None
    return get_subset(reader, dataset_path, spec)


def clear(dataset_path: Optional[str] = None) -> None:
    with _lock:
        if dataset_path is None:
            _cache.clear()
        else:
            for key in [k for k in _cache if k[0] == dataset_path]:
                del _cache[key]


# ---------------------------------------------------------------------------
# The reader view
# ---------------------------------------------------------------------------

def _take_rows(data, rows: np.ndarray):
    """``data`` restricted to ``rows`` along its first axis."""
    if isinstance(data, list):
        return [data[i] for i in rows.tolist()]
    if hasattr(data, "shape") and len(getattr(data, "shape", ())) >= 1:
        return data[rows]
    return data


def _take_cols(data, cols: np.ndarray):
    if isinstance(data, list):
        return [_take_rows(row, cols) for row in data]
    if hasattr(data, "shape") and len(data.shape) == 2:
        return data[:, cols]
    if hasattr(data, "shape") and len(data.shape) == 1:
        return data[cols]
    return data


class SubsetView:
    """A reader that serves ``adata[subset.indices]``.

    Only the cell axis changes. Gene-axis methods, uns and anything not
    defined here go to the wrapped reader untouched.
    """

    def __init__(self, reader, subset: Subset):
        self._reader = reader
        self.subset = subset

    def __getattr__(self, name):
        return getattr(self._reader, name)

    @property
    def base(self):
        """The reader of the whole dataset."""
        return self._reader

    def at_dataset_rows(self) -> "DatasetRowsView":
        """The same view, with the cells a read names given as dataset rows."""
        return DatasetRowsView(self._reader, self.subset)

    def _rows(self, positions) -> List[int]:
        """Dataset rows of the cells a read names."""
        return self.subset.to_rows(positions)

    # -- metadata -----------------------------------------------------------

    def get_metadata(self, dataset_path, *args, **kwargs):
        meta = self._reader.get_metadata(dataset_path, *args, **kwargs)
        if not meta:
            return meta
        n = len(self.subset)
        meta = dict(meta)
        shape = tuple(meta.get("shape") or ())
        if shape:
            meta["shape"] = (n,) + tuple(shape[1:])
        for field_name, both in (("obsm_info", False), ("layers_info", False), ("obsp_info", True)):
            info = meta.get(field_name)
            if not isinstance(info, dict):
                continue
            resized = {}
            for key, entry in info.items():
                entry_shape = tuple((entry or {}).get("shape") or ())
                if entry_shape:
                    entry = dict(entry)
                    new_shape = (n,) + entry_shape[1:]
                    if both and len(entry_shape) == 2:
                        new_shape = (n, n)
                    entry["shape"] = new_shape
                resized[key] = entry
            meta[field_name] = resized
        meta["subset"] = self.subset.describe()
        return meta

    # -- names --------------------------------------------------------------

    def get_cell_gene_names(self, dataset_path, entity, use_cache=True):
        if entity != "cells":
            return self._reader.get_cell_gene_names(dataset_path, entity, use_cache=use_cache)
        sub = self.subset
        take = getattr(self._reader, "get_cell_gene_names_at", None)
        if take is not None:
            # Only the subset's names are read (by index, chunk by chunk);
            # reading every name of a 95-million-cell store to keep 100,000
            # was most of the time it took to open one. The reader caches
            # them in its DatasetCache, under its memory accounting.
            return list(take(dataset_path, "cells", sub.indices))
        if sub._names is None:
            names = self._reader.get_cell_gene_names(dataset_path, "cells", use_cache=use_cache)
            sub._names = [names[i] for i in sub.indices.tolist()]
        return list(sub._names)

    # -- cell-axis reads ----------------------------------------------------
    #
    # Two cases each. Named cells (a focused cell's row, a handful of
    # positions): their dataset rows go to the reader as a short index list.
    # The whole axis: the reader reads all cells exactly as an unsubset
    # request would, and the result is cut to the subset's rows.

    def get_obs_var(self, entity="cells", dataset_path=None, indices=None,
                    column_names=None, include_categories=True):
        # obs columns are read by index: decoding a categorical for 100,000
        # cells is cheaper than for all of them, and the sorted subset rows
        # are what h5py needs too.
        if entity == "cells":
            indices = (self.subset.indices.tolist() if indices is None
                       else self._rows(indices))
        return self._reader.get_obs_var(entity=entity, dataset_path=dataset_path, indices=indices,
                                        column_names=column_names,
                                        include_categories=include_categories)

    def get_obs_var_codes(self, entity="cells", dataset_path=None, column_name=None, indices=None):
        if entity == "cells":
            indices = (self.subset.indices.tolist() if indices is None
                       else self._rows(indices))
        return self._reader.get_obs_var_codes(entity=entity, dataset_path=dataset_path,
                                              column_name=column_name, indices=indices)

    def get_obsm_varm(self, entity="cells", key=None, dataset_path=None, indices=None,
                      col_indices=None, column_name=None):
        if entity != "cells" or indices is not None:
            rows = indices if entity != "cells" else self._rows(indices)
            return self._reader.get_obsm_varm(entity=entity, key=key, dataset_path=dataset_path,
                                              indices=rows, col_indices=col_indices,
                                              column_name=column_name)
        data = self._reader.get_obsm_varm(entity=entity, key=key, dataset_path=dataset_path,
                                          indices=None, col_indices=col_indices,
                                          column_name=column_name)
        return _take_rows(data, self.subset.indices)

    def get_obsp_varp(self, key=None, entity="cells", dataset_path=None,
                      row_indices=None, col_indices=None):
        if entity != "cells":
            return self._reader.get_obsp_varp(key=key, entity=entity, dataset_path=dataset_path,
                                              row_indices=row_indices, col_indices=col_indices)
        # Rows are read by index (a focused cell's row is the reader's one-row
        # fast path), whole, and then cut to the subset's columns.
        rows = (self.subset.indices.tolist() if row_indices is None
                else self._rows(row_indices))
        data = self._reader.get_obsp_varp(key=key, entity=entity, dataset_path=dataset_path,
                                          row_indices=rows, col_indices=None)
        cols = (self.subset.indices if col_indices is None
                else np.asarray(self.subset.to_rows(col_indices), dtype=np.int64))
        return _take_cols(data, cols)

    def get_X(self, dataset_path=None, row_indices=None, col_indices=None):
        return self._matrix(lambda rows: self._reader.get_X(dataset_path, rows, col_indices),
                            row_indices, col_indices)

    def get_layer(self, layer_name, dataset_path=None, row_indices=None, col_indices=None):
        return self._matrix(lambda rows: self._reader.get_layer(layer_name, dataset_path, rows, col_indices),
                            row_indices, col_indices)

    def _matrix(self, read, row_indices, col_indices=None):
        if row_indices is not None:
            return read(self._rows(row_indices))
        if col_indices is not None:
            # A few columns (a gene's column): ask the reader for the subset's
            # rows of them. For sparse matrices only those rows are kept
            # (ZarrReader._rows_of_major_slices) instead of a 50-million-row
            # column built, cached and then cut.
            return read(self.subset.indices.tolist())
        return _take_rows(read(None), self.subset.indices)


class DatasetRowsView(SubsetView):
    """A SubsetView whose named cells are dataset rows, not positions.

    For a cell that is not shown, such as a focused cell from another part:
    its obsp row is read whole from the dataset and cut to the subset's
    cells, exactly as a shown cell's row is, and its layer or X row is its
    own. Column indices (obsp ``cols``) and whole-axis reads stay the
    subset's.
    """

    @property
    def n_obs(self) -> int:
        return int(self.subset.info["n_total"])

    def _rows(self, positions) -> List[int]:
        rows = np.asarray(positions, dtype=np.int64)
        if rows.size and (rows.min() < 0 or rows.max() >= self.n_obs):
            bad = int(rows[(rows < 0) | (rows >= self.n_obs)][0])
            raise IndexError(f"dataset row {bad} is out of range: the dataset has "
                             f"{self.n_obs} cells (0-{self.n_obs - 1})")
        return rows.tolist()
