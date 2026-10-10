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

import logging
import threading
import time
from contextlib import contextmanager

import numpy as np

logger = logging.getLogger(__name__)

_limit_mb: Optional[float] = None
_budget_mb: Optional[float] = None
_decompress_mb: Optional[float] = None
_wait_s: float = 5.0
_cond = threading.Condition()
_in_flight = 0

MIN_DEFAULT_MB = 256
MAX_DEFAULT_MB = 4096
DEFAULT_FRACTION = 0.05


class ReadTooLargeError(Exception):
    """A read whose estimated memory is over server.max_read_mb. Carries the
    elements and their estimated sizes; answered 413 ``read_too_large``."""

    def __init__(self, message: str, limit_bytes: int, requested_bytes: int,
                 elements: List[Dict[str, Any]], limit_name: str = "max_read_mb"):
        super().__init__(message)
        self.limit_name = limit_name
        self.limit_bytes = limit_bytes
        self.requested_bytes = requested_bytes
        self.elements = elements


class ReadBusyError(Exception):
    """The server is holding as much pairwise-read memory as it may (see
    admit); answered 503 ``read_busy`` with Retry-After."""

    def __init__(self, message: str, retry_after_s: int):
        super().__init__(message)
        self.retry_after_s = retry_after_s


def default_limit_bytes() -> int:
    """5% of this machine's memory, between 256 MiB and 4 GiB: a request, not
    a cache, and a server runs several workers with several threads each."""
    try:
        import psutil
        total = psutil.virtual_memory().total
    except Exception:
        total = 8 * 2 ** 30
    return int(min(max(total * DEFAULT_FRACTION, MIN_DEFAULT_MB * 2 ** 20), MAX_DEFAULT_MB * 2 ** 20))


def configure(max_mb: Optional[float] = None, budget_mb: Optional[float] = None,
              wait_s: Optional[float] = None, decompress_mb: Optional[float] = None) -> None:
    """Set the per-request limit in MB (None or 0: the default,
    default_limit_bytes()), the budget of all pairwise reads in flight in this
    process (None or 0: twice the limit) and the seconds a read waits for it."""
    global _limit_mb, _budget_mb, _wait_s, _decompress_mb
    _decompress_mb = float(decompress_mb) if decompress_mb else None
    _limit_mb = float(max_mb) if max_mb else None
    _budget_mb = float(budget_mb) if budget_mb else None
    _wait_s = 5.0 if wait_s is None else float(wait_s)


def decompress_limit_bytes() -> int:
    """Bytes of chunks one request may decompress: ``max_decompress_mb``, else
    ten times the read limit (a column of a row-chunked matrix touches every
    chunk row; that work, not memory, is what this bounds)."""
    return int(_decompress_mb * 2 ** 20) if _decompress_mb else 10 * limit_bytes()


def budget_bytes() -> int:
    return int(_budget_mb * 2 ** 20) if _budget_mb else 2 * limit_bytes()


def in_flight_bytes() -> int:
    return _in_flight


@contextmanager
def admit(need: int):
    """Hold ``need`` bytes of the budget for the length of a read.

    ``check`` refuses a read over the limit on its own, and the budget is at
    least that limit, so a read that passed it fits an idle server: waiting
    cannot deadlock. Over the budget with others in flight, wait up to
    ``wait_s`` for them, then ReadBusyError (the route's 503, Retry-After).
    """
    global _in_flight
    need = min(int(need), budget_bytes())
    deadline = time.monotonic() + _wait_s
    with _cond:
        while _in_flight + need > budget_bytes():
            left = deadline - time.monotonic()
            if left <= 0:
                raise ReadBusyError(
                    f"The server is reading other large pairwise matrices "
                    f"({_in_flight / 2 ** 20:,.0f} MB in flight of a "
                    f"{budget_bytes() / 2 ** 20:,.0f} MB budget); try again in a moment.",
                    max(1, int(round(_wait_s))))
            _cond.wait(left)
        _in_flight += need
    try:
        yield
    finally:
        with _cond:
            _in_flight -= need
            _cond.notify_all()


def limit_bytes() -> int:
    return int(_limit_mb * 2 ** 20) if _limit_mb else default_limit_bytes()


def _nbytes(arr) -> int:
    n = 1
    for d in arr.shape:
        n *= int(d)
    return n * int(arr.dtype.itemsize)


#: Chunks zarr decompresses at the same time (zarr config async.concurrency).
READ_CONCURRENCY = 10


def _chunks_touched(selection, size: int, chunk: int) -> int:
    if selection is None:
        return -(-size // chunk)
    sel = np.asarray(selection, dtype=np.int64)
    return int(np.unique(sel // chunk).size) if sel.size else 0


def chunk_working_set(obj, row_indices=None, col_indices=None) -> int:
    """Bytes of decompressed chunks a read of dense ``obj`` holds at once.

    A row of an array chunked (1000, 1000) decompresses 4 MB chunks; a row of
    one chunked (1000, n) decompresses 1000 x n x itemsize bytes (4.8 GB at 1.2M
    cells) to keep n values. zarr works on up to READ_CONCURRENCY chunks at a
    time, so the working set is that many chunks, or all the chunks the request
    touches if fewer. Measured: 22 MB for one row of (256, 20000) float32 (a
    20.5 MB chunk), 42 MB at (256, 40000), about 10 chunks for a column.
    """
    shape = tuple(int(d) for d in obj.shape)
    unit = getattr(obj, "shards", None) or getattr(obj, "chunks", None)
    if len(shape) != 2 or not unit or len(unit) != 2:
        return 0
    touched = (_chunks_touched(row_indices, shape[0], int(unit[0]))
               * _chunks_touched(col_indices, shape[1], int(unit[1])))
    return min(touched, READ_CONCURRENCY) * int(unit[0]) * int(unit[1]) * int(obj.dtype.itemsize)


def chunks_touched_bytes(obj, row_indices=None, col_indices=None) -> int:
    """Bytes the chunks a read touches hold decompressed, counting a chunk
    position the store has no file for as a chunk (metadata cannot tell
    which are written without listing the store)."""
    shape = tuple(int(d) for d in obj.shape)
    unit = getattr(obj, "shards", None) or getattr(obj, "chunks", None)
    if len(shape) != 2 or not unit or len(unit) != 2:
        return 0
    touched = (_chunks_touched(row_indices, shape[0], int(unit[0]))
               * _chunks_touched(col_indices, shape[1], int(unit[1])))
    return touched * int(unit[0]) * int(unit[1]) * int(obj.dtype.itemsize)


def estimate_bytes(obj, is_sparse: bool, row_indices=None, col_indices=None):
    """(bytes, shape) the read of ``obj`` would hold in memory.

    Dense array: the rows x columns returned (the reader selects both axes at
    once) plus the chunks being decompressed (chunk_working_set). Sparse group: its stored arrays as loaded (all of them, unless a
    row selection of a CSR / column selection of a CSC loads only that share),
    plus the dense block the reply is made of.
    """
    if not is_sparse:
        shape = tuple(int(d) for d in obj.shape)
        if len(shape) != 2:
            return _nbytes(obj), shape
        rows = len(row_indices) if row_indices is not None else shape[0]
        cols = len(col_indices) if col_indices is not None else shape[1]
        return (rows * cols * int(obj.dtype.itemsize)
                + chunk_working_set(obj, row_indices, col_indices)), shape

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


def check(name: str, obj, is_sparse: bool, row_indices=None, col_indices=None) -> int:
    """The estimated bytes of reading ``name`` (e.g. "obsp/distances") as
    asked, or ReadTooLargeError when that is more than the limit. Reads no data."""
    try:
        need, shape = estimate_bytes(obj, is_sparse, row_indices, col_indices)
    except Exception:
        return 0                    # not sizeable from metadata: the read decides
    limit = limit_bytes()
    if need <= limit and not is_sparse:
        work = chunks_touched_bytes(obj, row_indices, col_indices)
        if work > decompress_limit_bytes():
            n_rows = len(row_indices) if row_indices is not None else shape[0]
            n_cols = len(col_indices) if col_indices is not None else shape[1]
            unit = [int(c) for c in (getattr(obj, "shards", None) or obj.chunks)]
            element = {"element": name, "shape": list(shape), "rows": n_rows, "columns": n_cols,
                       "sparse": False, "chunks": unit, "estimated_mb": round(need / 2 ** 20, 1),
                       "decompressed_mb": round(work / 2 ** 20, 1)}
            raise ReadTooLargeError(
                f"Reading {n_rows} x {n_cols} of {name} (stored {shape[0]} x {shape[1]}, chunks "
                f"{tuple(unit)}) touches chunks holding about {work / 2 ** 20:,.0f} MB decompressed; "
                f"the limit is {decompress_limit_bytes() / 2 ** 20:,.0f} MB (server.max_decompress_mb). "
                "Ask for rows rather than columns: a column decompresses every chunk of its band.",
                decompress_limit_bytes(), work, [element], limit_name="max_decompress_mb")
    if need <= limit:
        return need
    n_rows = len(row_indices) if row_indices is not None else shape[0]
    n_cols = len(col_indices) if col_indices is not None else shape[1]
    element = {"element": name, "shape": list(shape), "rows": n_rows, "columns": n_cols,
               "sparse": bool(is_sparse), "estimated_mb": round(need / 2 ** 20, 1)}
    unit = getattr(obj, "shards", None) or getattr(obj, "chunks", None)
    if not is_sparse and unit:
        element["chunks"] = [int(c) for c in unit]
        element["chunk_working_set_mb"] = round(
            chunk_working_set(obj, row_indices, col_indices) / 2 ** 20, 1)
    raise ReadTooLargeError(
        f"Reading {n_rows} x {n_cols} of {name} (stored {shape[0]} x {shape[1]}) would hold about "
        f"{need / 2 ** 20:,.0f} MB in memory; the limit is {limit / 2 ** 20:,.0f} MB "
        "(server.max_read_mb). Ask for fewer rows or columns"
        + (f"; its chunks are {tuple(element['chunks'])}, and every chunk a read touches is "
           "decompressed whole: rewrite it with smaller chunks (e.g. one or a few rows by "
           "a few thousand columns)." if element.get("chunks") else "."),
        limit, need, [element])


def chunking_notice(root, dataset_path: str = "") -> Optional[Dict[str, Any]]:
    """Dense obsp/varp members of ``root`` whose chunks make ONE ROW read hold
    more than the limit, as a notice for the dataset's structure; None when
    there are none. From metadata only. Logged once per dataset (a warning)."""
    items = []
    limit = limit_bytes()
    for group in ("obsp", "varp"):
        try:
            members = list(root[group].keys()) if group in root else []
        except Exception:
            continue
        for key in members:
            try:
                obj = root[group][key]
                if not hasattr(obj, "shape") or len(obj.shape) != 2:
                    continue
                need = chunk_working_set(obj, [0])
                if need > limit:
                    unit = getattr(obj, "shards", None) or obj.chunks
                    items.append({"element": f"{group}/{key}", "shape": [int(d) for d in obj.shape],
                                  "chunks": [int(c) for c in unit],
                                  "row_read_mb": round(need / 2 ** 20, 1)})
            except Exception:
                continue
    if not items:
        return None
    names = ", ".join(f"{i['element']} chunks {tuple(i['chunks'])} (one row reads {i['row_read_mb']:,.0f} MB)"
                      for i in items)
    message = (f"Reading one row of {names} decompresses whole chunks, more than the server's "
               f"read limit of {limit / 2 ** 20:,.0f} MB (server.max_read_mb): focusing a cell will be refused. "
               "Rewrite them with row-friendly chunks, e.g. (1, 8192) to (64, 8192) "
               "(whole rows, a few thousand columns), then Refresh dataset.")
    _warned = _WARNED
    if dataset_path not in _warned:
        _warned.add(dataset_path)
        logger.warning("%s: %s", dataset_path, message)
    return {"elements": items, "message": message, "suggested_chunks": "(1, 8192)"}


_WARNED: set = set()
