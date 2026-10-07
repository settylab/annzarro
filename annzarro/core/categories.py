"""Categorical columns with many categories, up to one per cell.

A barcode or a sample-cell id stored as a categorical has as many categories
as cells: 95.6 million on the Tahoe atlas. Every reply that carried "the
column's categories" then carried the whole column again as one JSON list,
built in server memory before the first byte was sent, and the client gave
up after downloading it (16-bit codes). Now:

**Colouring needs codes, not labels.** Past :data:`GROUP_COLOURS` (64)
categories the client colours by colour group: categories ranked by how many
of the shown cells they hold, rank r drawn in colour r mod 64, so the 64
largest categories each lead a colour (static/js/utils/categories.js). A
``categories=ranked`` reply gives exactly that: each cell's code renumbered
to its category's frequency rank among the requested rows, and the labels of
the first ``labels`` ranks only (the legend's few names per colour).

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

from typing import Optional

import numpy as np

#: Colours of the palette a column with more categories is grouped into.
GROUP_COLOURS = 64

#: Labels a ranked reply carries by default: three names per colour group
#: for the legend ("S1, S7, S12 +18 more").
RANKED_LABELS = 3 * GROUP_COLOURS

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


def ranked(codes: np.ndarray, n_categories: int, read_categories, top: int = RANKED_LABELS):
    """``(ranks, labels, used)``: each code renumbered to its category's
    frequency rank among ``codes`` (0 = the most cells; ties by stored code),
    the labels of ranks ``0..top-1``, and the number of categories used.

    A code outside the column's categories stays -1 (missing). Counting is
    one bincount over the categories; the ranking sorts the counts with a
    stable radix sort when they fit 16 bits (the usual case: no category
    holds 32,768 of the rows), so a column with a category per cell ranks in
    linear time.
    """
    codes = np.asarray(codes).reshape(-1)
    valid = (codes >= 0) & (codes < n_categories)
    c = codes[valid].astype(np.int64, copy=False)
    counts = np.bincount(c, minlength=n_categories)
    neg = -counts
    if counts.size and counts.max(initial=0) < 2 ** 15:
        neg = neg.astype(np.int16)
    order = np.argsort(neg, kind="stable")
    used = int(np.count_nonzero(counts))
    order = order[:used]
    rank_of = np.empty(n_categories, dtype=np.int64)
    rank_of[order] = np.arange(used, dtype=np.int64)
    out = np.full(codes.shape, -1, dtype=np.int64)
    out[valid] = rank_of[c]
    head = order[:top]
    if len(head):
        positions = np.sort(head)
        got = read_categories(positions)
        got = got.tolist() if hasattr(got, "tolist") else list(got)
        by_code = dict(zip(positions.tolist(), got))
        labels = [by_code[int(k)] for k in head]
    else:
        labels = []
    return out, labels, used


def check_labels(column: str, n_categories: Optional[int], n_rows: int) -> None:
    """Refuse a compact reply that could need more than MAX_LABELS labels."""
    if n_categories is not None and n_categories > READ_ALL_MAX and min(n_categories, n_rows) > MAX_LABELS:
        raise TooManyCategories(column, n_categories, MAX_LABELS, n_rows)
