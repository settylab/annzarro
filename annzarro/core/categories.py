"""Categorical columns with many categories, up to one per cell.

A barcode or a sample-cell id stored as a categorical has as many categories
as cells: 95.6 million on the Tahoe atlas. Every reply that carried "the
column's categories" then carried the whole column again as one JSON list,
built in server memory before the first byte was sent, and the client gave
up after downloading it (16-bit codes). Three rules replace that:

**Colouring has a limit.** A colour stands for a group of cells, and the
legend and palette say which group. The legend lists every category up to
:data:`LEGEND_CATEGORIES` (the client draws more in a fixed palette with a
one-line "N categories" legend); past :data:`DEFAULT_COLOUR_LIMIT`
(``ui.defaults.category_colour_limit``) categories share each colour with
over a hundred others, so a colour no longer names a group, and the column
is refused for colour with ``too_many_categories``. The count comes from the
column's metadata (the categories array's shape), so the refusal reads
nothing.

**Labels are read for the rows asked.** Above :data:`READ_ALL_MAX`
categories a reader reads the codes of the requested rows, then only the
categories those codes use, and renumbers the codes into that short list (a
"compact" reply, which also says the column's full count). Hover and table
columns of a subset of 100,000 cells thus read and send at most 100,000
labels, whatever the column holds.

**A reply has a size.** A compact reply can still need one label per row; it
is refused above :data:`MAX_LABELS` labels (request a subset), instead of
building gigabytes of strings.
"""

from __future__ import annotations

from typing import Optional

import numpy as np

#: Categories the client lists in a legend, one entry each; more are drawn in
#: a fixed palette with one "N categories" entry (static/js/utils/categories.js).
LEGEND_CATEGORIES = 100

#: Default limit for colouring by a categorical column. With the 64-colour
#: palette used above LEGEND_CATEGORIES, 10,000 categories put about 156
#: categories on each colour; past that a colour says nothing about which
#: group a cell is in. Columns with a category per cell (barcodes, ids) are
#: far above it; clusters, samples, cell lines and drugs (the Tahoe atlas has
#: 1,344 samples and 380 drugs) are below it.
DEFAULT_COLOUR_LIMIT = 10_000

#: Above this many categories a reader reads only the categories the
#: requested rows use. Below it reading them all is cheaper than finding which
#: are used (65,536 is also the client's 16-bit code range).
READ_ALL_MAX = 65_536

#: Most labels a compact reply may carry: 2M labels of ~20 characters is
#: ~40 MB of JSON, more than any table or hover over a subset needs.
MAX_LABELS = 2_000_000


class TooManyCategories(Exception):
    """A categorical column with more categories than a request can use.

    ``status``/``reason`` are what the route answers (413
    ``too_many_categories``); ``count`` is the column's number of
    categories and ``limit`` the one it exceeds.
    """

    status = 413
    reason = "too_many_categories"

    def __init__(self, column: str, count: int, limit: int, purpose: str):
        self.column, self.count, self.limit, self.purpose = column, int(count), int(limit), purpose
        if purpose == "colour":
            detail = (f"{self.count:,} distinct values (the limit is {self.limit:,}): "
                      "show it in the hover or in a table instead")
            message = f"'{column}' has {self.count:,} distinct values, too many to colour by (the limit is {self.limit:,})."
        else:
            detail = (f"{self.count:,} distinct values; labelling {purpose} would send more than "
                      f"{self.limit:,} of them: use a cell subset to label fewer rows")
            message = f"'{column}' has {self.count:,} distinct values; " + detail.split("; ", 1)[1] + "."
        super().__init__(message)
        self.message, self.detail = message, detail

    def body(self) -> dict:
        return {"error": self.message, "detail": self.detail, "reason": self.reason, "column": self.column,
                "count": self.count, "limit": self.limit, "purpose": self.purpose}


def colour_limit(config) -> int:
    """``ui.defaults.category_colour_limit`` (flattened as ui_category_colour_limit)."""
    value = config.get("ui_category_colour_limit") if config is not None else None
    return DEFAULT_COLOUR_LIMIT if value is None else max(1, int(value))


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


def check_labels(column: str, n_categories: Optional[int], n_rows: int) -> None:
    """Refuse a compact reply that could need more than MAX_LABELS labels."""
    if n_categories is not None and n_categories > READ_ALL_MAX and min(n_categories, n_rows) > MAX_LABELS:
        raise TooManyCategories(column, n_categories, MAX_LABELS, f"{n_rows:,} rows")
