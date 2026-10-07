"""Categorical columns with many categories, up to one per cell.

A barcode or a sample-cell id stored as a categorical has as many categories
as cells: 95.6 million on the Tahoe atlas. Every reply that carried "the
column's categories" then carried the whole column again as one JSON list,
built in server memory before the first byte was sent, and the client gave
up after downloading it (16-bit codes). Now:

**Colouring needs codes, not labels.** Past :data:`GROUP_COLOURS` (64)
categories the client colours by colour group: categories ranked by how many
cells of the WHOLE column they hold, rank r drawn in colour r mod 64, so the
64 largest categories each lead a colour (static/js/utils/categories.js).
The rank is the column's, not the view's, so a category keeps its colour in
every panel, subset, part and filter; ties (every count is 1 in a column with
a category per cell) break by stored code. The ranking is computed once per
store and column from all codes and cached (:func:`column_ranking`). A
``categories=ranked`` reply gives each requested cell its category's rank;
``category_ranks=`` gives the labels of a few ranks (the legend's names).

**Labels are read for the rows asked.** Above :data:`READ_ALL_MAX`
categories a reader reads the codes of the requested rows, then only the
categories those codes use, and renumbers the codes into that short list (a
"compact" reply, which also says the column's full count). Hover and table
columns of a subset of 100,000 cells thus read and send at most 100,000
labels, whatever the column holds.

**A reply has a size.** A compact reply can still need one label per row; it
is refused above :data:`MAX_LABELS` labels (request a subset), instead of
building gigabytes of strings. The column's number of categories comes from
its metadata (the categories array's shape), so these decisions read
nothing.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Optional

import numpy as np

from . import freshness
from .name_index import _signature as _store_signature

#: Colours of the palette a column with more categories is grouped into.
GROUP_COLOURS = 64

#: Above this many categories a reader reads only the categories the
#: requested rows use. Below it reading them all is cheaper than finding which
#: are used (65,536 is also the client's 16-bit code range).
READ_ALL_MAX = 65_536

#: Most labels a compact reply may carry: 2M labels of ~20 characters is
#: ~40 MB of JSON, more than any table or hover over a subset needs.
MAX_LABELS = 2_000_000

#: Most groups a subset may be balanced across. Balance takes a share of every
#: group; with one group per cell (a barcode column) that is no balance, and
#: the per-group bookkeeping grows with the groups.
MAX_BALANCE_GROUPS = 10_000


class TooManyCategories(Exception):
    """A categorical column with more categories than a request can use.

    ``status``/``reason`` are what the route answers (413
    ``too_many_categories``); ``count`` is the column's number of categories
    and ``limit`` the one it exceeds.
    """

    status = 413
    reason = "too_many_categories"

    def __init__(self, column: str, count: int, limit: int, rows: int):
        self.column, self.count, self.limit = column, int(count), int(limit)
        self.detail = (f"{self.count:,} distinct values; labelling {rows:,} rows would send more than "
                       f"{self.limit:,} of them: use a cell subset to label fewer rows")
        self.message = (f"'{column}' has {self.count:,} distinct values; labelling {rows:,} rows "
                        f"would send more than {self.limit:,} of them. Use a cell subset to label fewer rows.")
        super().__init__(self.message)

    def body(self) -> dict:
        return {"error": self.message, "detail": self.detail, "reason": self.reason,
                "column": self.column, "count": self.count, "limit": self.limit}


def category_count(metadata: Optional[dict], entity: str, column: str) -> Optional[int]:
    """Number of categories of an obs/var column from metadata, or None."""
    if not metadata:
        return None
    info = (metadata.get(f"{'obs' if entity == 'cells' else 'var'}_columns_info") or {}).get(column) or {}
    count = info.get("n_categories")
    return int(count) if count is not None else None


def compact(codes: np.ndarray, read_categories):
    """``(codes, categories)`` with only the categories ``codes`` use.

    ``read_categories(positions)`` reads those positions (sorted, unique) of
    the categories array. Codes are renumbered into the short list; a code
    outside the column's categories stays -1 (missing).
    """
    codes = np.asarray(codes).reshape(-1)
    valid = codes >= 0
    used = np.unique(codes[valid]).astype(np.int64)
    labels = read_categories(used) if len(used) else []
    labels = labels.tolist() if hasattr(labels, "tolist") else list(labels)
    out = np.full(codes.shape, -1, dtype=np.int64)
    out[valid] = np.searchsorted(used, codes[valid])
    return out, labels


#: rank_of entry of a category no cell uses
UNUSED = np.uint32(0xFFFFFFFF)


@dataclass
class ColumnRanking:
    """A column's categories ranked by their cells over the whole column
    (0 = most cells; ties by stored code).

    ``rank_of[code]`` is the rank as uint32 (UNUSED for a category no cell
    uses), or None when the rank IS the code: every category used and all
    equally large, as in a column with a category per cell, which then costs
    no ranking and no memory. ``used`` is the number of categories with cells.
    """
    rank_of: Optional[np.ndarray]
    used: int
    n_categories: int
    seconds: float = 0.0

    @property
    def nbytes(self) -> int:
        return 0 if self.rank_of is None else int(self.rank_of.nbytes)

    def ranks(self, codes) -> np.ndarray:
        """Ranks of ``codes`` (-1 for a missing code)."""
        codes = np.asarray(codes).reshape(-1)
        valid = (codes >= 0) & (codes < self.n_categories)
        out = np.full(codes.shape, -1, dtype=np.int64)
        out[valid] = codes[valid] if self.rank_of is None else self.rank_of[codes[valid]]
        return out

    def codes_of(self, ranks) -> list:
        """The codes at ``ranks`` (None past ``used``): a scan of rank_of,
        done for the few ranks a legend names."""
        ranks = [int(r) for r in ranks]
        if self.rank_of is None:
            return [r if 0 <= r < self.used else None for r in ranks]
        wanted = np.asarray(sorted({r for r in ranks if 0 <= r < self.used}), dtype=np.uint32)
        # a lookup table over the wanted ranks: one linear pass, not one per rank
        hits = (np.flatnonzero(np.isin(self.rank_of, wanted, kind="table")) if len(wanted)
                else np.array([], dtype=np.int64))
        by_rank = dict(zip(self.rank_of[hits].tolist(), hits.tolist()))
        return [by_rank.get(r) for r in ranks]


def rank_codes(codes: np.ndarray, n_categories: int) -> ColumnRanking:
    """Rank a column's categories by their cells in ``codes`` (all of them).

    One bincount over the categories. When every category used holds the same
    number of cells (one each, in a barcode column) the order is the code
    order: no sort, and with every category used no table at all. Otherwise a
    stable sort of the counts, a radix sort when they fit 16 bits.
    """
    t0 = time.perf_counter()
    codes = np.asarray(codes).reshape(-1)
    valid = (codes >= 0) & (codes < n_categories)
    counts = np.bincount(codes if valid.all() else codes[valid], minlength=n_categories)
    nonzero = counts > 0
    used = int(np.count_nonzero(nonzero))
    present = counts[nonzero]
    if used == 0 or present.min() == present.max():
        if used == n_categories:
            return ColumnRanking(None, used, n_categories, time.perf_counter() - t0)
        # code order among the categories used
        rank_of = np.full(n_categories, UNUSED, dtype=np.uint32)
        rank_of[nonzero] = np.arange(used, dtype=np.uint32)
        return ColumnRanking(rank_of, used, n_categories, time.perf_counter() - t0)
    neg = -counts
    if counts.max(initial=0) < 2 ** 15:
        neg = neg.astype(np.int16)
    order = np.argsort(neg, kind="stable")[:used]
    del neg, counts
    rank_of = np.full(n_categories, UNUSED, dtype=np.uint32)
    rank_of[order] = np.arange(used, dtype=np.uint32)
    return ColumnRanking(rank_of, used, n_categories, time.perf_counter() - t0)


#: Bytes of rankings kept: 4 bytes per category (a 95.6M-category column
#: takes 382 MB, and none when the rank is the code).
RANKING_CACHE_BYTES = 512 * 2 ** 20
_rankings: "OrderedDict[tuple, ColumnRanking]" = OrderedDict()
_rank_lock = threading.Lock()


def column_ranking(dataset_path: str, entity: str, column: str, n_categories: int,
                   read_all_codes) -> ColumnRanking:
    """The cached ranking of one column over all its cells
    (``read_all_codes()`` reads every code), computed on first use and again
    when the store changes (its stat signature, as the name index)."""
    # the store's stat signature and freshness token: a rewrite or a cache
    # reset (which bumps the token in every worker) ranks again
    key = (str(dataset_path), _store_signature(str(dataset_path)), freshness.current(str(dataset_path)),
           entity, column, int(n_categories))
    with _rank_lock:
        hit = _rankings.get(key)
        if hit is not None:
            _rankings.move_to_end(key)
            return hit
    ranking = rank_codes(read_all_codes(), n_categories)
    if ranking.nbytes <= RANKING_CACHE_BYTES:
        with _rank_lock:
            _rankings[key] = ranking
            while sum(r.nbytes for r in _rankings.values()) > RANKING_CACHE_BYTES:
                _rankings.popitem(last=False)
    return ranking


def clear_rankings(dataset_path: Optional[str] = None) -> None:
    with _rank_lock:
        for key in [k for k in _rankings if dataset_path is None or k[0] == str(dataset_path)]:
            del _rankings[key]


def labels_of_ranks(ranking: ColumnRanking, ranks, read_categories) -> list:
    """Labels of the categories at ``ranks`` (None for a rank past ``used``)."""
    codes = ranking.codes_of(ranks)
    wanted = sorted({c for c in codes if c is not None})
    got = read_categories(np.asarray(wanted, dtype=np.int64)) if wanted else []
    got = got.tolist() if hasattr(got, "tolist") else list(got)
    by_code = dict(zip(wanted, got))
    return [None if c is None else by_code[c] for c in codes]


#: Most ranks one category_ranks request may name (the legend asks for ~192).
MAX_RANK_LABELS = 5000


def check_labels(column: str, n_categories: Optional[int], n_rows: int) -> None:
    """Refuse a compact reply that could need more than MAX_LABELS labels."""
    if n_categories is not None and n_categories > READ_ALL_MAX and min(n_categories, n_rows) > MAX_LABELS:
        raise TooManyCategories(column, n_categories, MAX_LABELS, n_rows)
