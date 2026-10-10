"""A size guard for reads of pairwise matrices (obsp, varp), from metadata only.

A dense n x n obsp array (the "v3" layout: NaN outside blocks, chunked) is 120 GB
at 175,000 cells. The reader used to read ``array[rows, :]`` and cut the columns
afterwards, so one request for a single column of it, or for a few thousand rows
with two columns, allocated that much (or a large part of it) inside a worker
that serves other users. ``max_response_elements`` counted only the elements
returned, not the elements read.

``check`` sizes a read BEFORE any chunk is fetched, from shape, dtype and the
stored sizes of a sparse matrix's arrays, and raises ReadTooLargeError over
``server.max_read_mb``. No request parameter changes the limit.
"""
from typing import Any, Dict, List, Optional

_limit_mb: Optional[float] = None

MIN_DEFAULT_MB = 256
MAX_DEFAULT_MB = 4096
DEFAULT_FRACTION = 0.05


class ReadTooLargeError(Exception):
    """A read whose estimated memory is over server.max_read_mb. Carries the
    elements and their estimated sizes; answered 413 ``read_too_large``."""

    def __init__(self, message: str, limit_bytes: int, requested_bytes: int,
                 elements: List[Dict[str, Any]]):
        super().__init__(message)
        self.limit_bytes = limit_bytes
        self.requested_bytes = requested_bytes
        self.elements = elements


def default_limit_bytes() -> int:
    """5% of this machine's memory, between 256 MiB and 4 GiB: a request, not
    a cache, and a server runs several workers with several threads each."""
    try:
        import psutil
        total = psutil.virtual_memory().total
    except Exception:
        total = 8 * 2 ** 30
    return int(min(max(total * DEFAULT_FRACTION, MIN_DEFAULT_MB * 2 ** 20), MAX_DEFAULT_MB * 2 ** 20))


def configure(max_mb: Optional[float] = None) -> None:
    """Set the limit in MB (None or 0: the default, default_limit_bytes())."""
    global _limit_mb
    _limit_mb = float(max_mb) if max_mb else None


def limit_bytes() -> int:
    return int(_limit_mb * 2 ** 20) if _limit_mb else default_limit_bytes()


def _nbytes(arr) -> int:
    n = 1
    for d in arr.shape:
        n *= int(d)
    return n * int(arr.dtype.itemsize)


def estimate_bytes(obj, is_sparse: bool, row_indices=None, col_indices=None):
    """(bytes, shape) the read of ``obj`` would hold in memory.

    Dense array: the rows x columns returned (the reader selects both axes at
    once). Sparse group: its stored arrays as loaded (all of them, unless a
    row selection of a CSR / column selection of a CSC loads only that share),
    plus the dense block the reply is made of.
    """
    if not is_sparse:
        shape = tuple(int(d) for d in obj.shape)
        if len(shape) != 2:
            return _nbytes(obj), shape
        rows = len(row_indices) if row_indices is not None else shape[0]
        cols = len(col_indices) if col_indices is not None else shape[1]
        return rows * cols * int(obj.dtype.itemsize), shape

    shape = tuple(int(d) for d in obj.attrs.get("shape", ()))
    if len(shape) != 2 or "data" not in obj:
        return 0, shape
    held = sum(_nbytes(obj[k]) for k in ("data", "indices", "indptr") if k in obj)
    fmt = obj.attrs.get("encoding-type")
    if fmt == "csr_matrix" and row_indices is not None and shape[0]:
        held = int(held * min(1.0, max(len(row_indices), 1) / shape[0]))
    elif fmt == "csc_matrix" and col_indices is not None and shape[1]:
        held = int(held * min(1.0, max(len(col_indices), 1) / shape[1]))
    rows = len(row_indices) if row_indices is not None else shape[0]
    cols = len(col_indices) if col_indices is not None else shape[1]
    return held + rows * cols * int(obj["data"].dtype.itemsize), shape


def check(name: str, obj, is_sparse: bool, row_indices=None, col_indices=None) -> None:
    """Raise ReadTooLargeError when reading ``name`` (e.g. "obsp/distances")
    as asked would hold more than the limit. Reads no data."""
    try:
        need, shape = estimate_bytes(obj, is_sparse, row_indices, col_indices)
    except Exception:
        return                      # not sizeable from metadata: the read decides
    limit = limit_bytes()
    if need <= limit:
        return
    n_rows = len(row_indices) if row_indices is not None else shape[0]
    n_cols = len(col_indices) if col_indices is not None else shape[1]
    element = {"element": name, "shape": list(shape), "rows": n_rows, "columns": n_cols,
               "sparse": bool(is_sparse), "estimated_mb": round(need / 2 ** 20, 1)}
    raise ReadTooLargeError(
        f"Reading {n_rows} x {n_cols} of {name} (stored {shape[0]} x {shape[1]}) would hold about "
        f"{need / 2 ** 20:,.0f} MB in memory; the limit is {limit / 2 ** 20:,.0f} MB "
        "(server.max_read_mb). Ask for fewer rows or columns: one row of it is always small.",
        limit, need, [element])
