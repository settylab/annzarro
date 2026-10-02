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

#: ``where`` limits: a spec is a URL parameter, not a query language.
MAX_CONDITIONS = 16
MAX_VALUES = 1000
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

    def canonical(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {"n": self.n, "seed": self.seed}
        if self.balance is not None:
            out["balance"] = self.balance
        if self.where:
            out["where"] = [c.canonical() for c in self.where]
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
        try:
            raw = json.loads(text)
        except ValueError:
            raise SubsetError(f"subset must be JSON, 'all' or 'auto', got {text[:80]!r}")
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise SubsetError(f"subset must be a JSON object, got {raw!r}")
    unknown = set(raw) - {"n", "seed", "balance", "where"}
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
    return SubsetSpec(n=n, seed=seed, balance=balance, where=conditions)


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
    open_groups = list(np.argsort(sizes, kind="stable"))
    while open_groups:
        share = budget // len(open_groups)
        smallest = open_groups[0]
        if sizes[smallest] <= share:
            quota[smallest] = sizes[smallest]
            budget -= int(sizes[smallest])
            open_groups.pop(0)
            continue
        rest = sorted(open_groups)
        quota[rest] = share
        for g in rest[: budget - share * len(rest)]:
            quota[g] += 1
        break
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


def select_indices(n_obs: int, spec: SubsetSpec,
                   read_column: Callable[[str], Sequence]) -> Tuple[np.ndarray, Dict[str, Any]]:
    """Sorted row indices of the subset, and counts that describe it.

    ``read_column(name)`` returns one obs column for all ``n_obs`` cells.
    """
    eligible = np.ones(n_obs, dtype=bool)
    for cond in spec.where:
        values = read_column(cond.col)
        if len(values) != n_obs:
            raise SubsetError(f"obs column {cond.col!r} has {len(values)} entries, expected {n_obs}")
        eligible &= _condition_mask(cond, values)
    rows = np.flatnonzero(eligible)
    n_eligible = int(len(rows))
    want = n_eligible if spec.n is None else min(spec.n, n_eligible)
    info: Dict[str, Any] = {"n_total": int(n_obs), "n_eligible": n_eligible}

    if want >= n_eligible:
        chosen = rows
    else:
        keys = rank_keys(n_obs, spec.seed)[rows]
        if spec.balance is None:
            chosen = rows[_smallest(keys, want)]
        else:
            labels = read_column(spec.balance)
            if len(labels) != n_obs:
                raise SubsetError(f"obs column {spec.balance!r} has {len(labels)} entries, expected {n_obs}")
            text = [MISSING_GROUP if _is_missing(labels[i]) else value_text(labels[i]) for i in rows]
            names, codes = np.unique(np.asarray(text, dtype=object), return_inverse=True)
            sizes = np.bincount(codes, minlength=len(names))
            quota = balanced_quota(sizes, want)
            # Order by (group, key); keep the first quota[g] of each group's run.
            order = np.lexsort((keys, codes))
            starts = np.concatenate([[0], np.cumsum(sizes)[:-1]])
            pos = np.arange(len(order)) - starts[codes[order]]
            chosen = rows[order[pos < quota[codes[order]]]]
            info["groups"] = {str(name): {"total": int(s), "shown": int(q)}
                              for name, s, q in zip(names, sizes, quota)}
    indices = np.sort(chosen).astype(np.int64)
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

    def describe(self) -> Dict[str, Any]:
        out = {"subset": self.spec.canonical(), "key": self.spec.key()}
        out.update(self.info)
        return out


_cache: "OrderedDict[Tuple[str, Tuple, str], Subset]" = OrderedDict()
_lock = threading.Lock()
_CACHE_SIZE = 16


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

    def read_column(name):
        result = reader.get_obs_var(entity="cells", dataset_path=dataset_path,
                                    column_names=[name], include_categories=False)
        data = result.get("data", result) if isinstance(result, dict) else result
        values = data.get(name) if isinstance(data, dict) else data
        if values is None:
            raise SubsetError(f"obs column {name!r} could not be read", "read_failed", 500)
        return values

    indices, info = select_indices(n_obs, spec, read_column)
    subset = Subset(dataset_path, spec, indices, info)
    with _lock:
        _cache[key] = subset
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_SIZE:
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
                       else self.subset.to_rows(indices))
        return self._reader.get_obs_var(entity=entity, dataset_path=dataset_path, indices=indices,
                                        column_names=column_names,
                                        include_categories=include_categories)

    def get_obsm_varm(self, entity="cells", key=None, dataset_path=None, indices=None,
                      col_indices=None, column_name=None):
        if entity != "cells" or indices is not None:
            rows = indices if entity != "cells" else self.subset.to_rows(indices)
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
                else self.subset.to_rows(row_indices))
        data = self._reader.get_obsp_varp(key=key, entity=entity, dataset_path=dataset_path,
                                          row_indices=rows, col_indices=None)
        cols = (self.subset.indices if col_indices is None
                else np.asarray(self.subset.to_rows(col_indices), dtype=np.int64))
        return _take_cols(data, cols)

    def get_X(self, dataset_path=None, row_indices=None, col_indices=None):
        return self._matrix(lambda rows: self._reader.get_X(dataset_path, rows, col_indices),
                            row_indices)

    def get_layer(self, layer_name, dataset_path=None, row_indices=None, col_indices=None):
        return self._matrix(lambda rows: self._reader.get_layer(layer_name, dataset_path, rows, col_indices),
                            row_indices)

    def _matrix(self, read, row_indices):
        if row_indices is not None:
            return read(self.subset.to_rows(row_indices))
        return _take_rows(read(None), self.subset.indices)
