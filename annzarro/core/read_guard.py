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

import contextvars
import ipaddress
import logging
import threading
import time
from contextlib import contextmanager

import numpy as np

logger = logging.getLogger(__name__)

_limit_mb: Optional[float] = None
_budget_mb: Optional[float] = None
_wait_s: float = 5.0
_share_pct: float = 50.0
_cond = threading.Condition()
_in_flight = 0
#: bytes in flight per requester (see ``requester``)
_by_owner: Dict[str, int] = {}

DEFAULT_SHARE_PCT = 50

#: Who the current request is for: the user name, else the client address. Set
#: by the server for each request (``requester``); reads made outside a
#: request (scripts, tests) have none and share the budget freely.
_owner: "contextvars.ContextVar[Optional[str]]" = contextvars.ContextVar("annzarro_read_owner", default=None)


def requester(owner: Optional[str]) -> None:
    """Name who the reads of this request are for (None: nobody in particular)."""
    _owner.set(owner)


def current_requester() -> Optional[str]:
    """Who the reads of this request are for (see ``requester``)."""
    return _owner.get()


def address_requester(address: Optional[str]) -> Optional[str]:
    """The requester for a client address: the address, or for IPv6 its /64.

    One host routinely holds a whole IPv6 /64; one share per address would
    let it name itself anew for every request.
    """
    try:
        ip = ipaddress.ip_address(address or "")
    except ValueError:
        return address
    if ip.version == 6:
        if ip.ipv4_mapped is not None:
            return str(ip.ipv4_mapped)
        return str(ipaddress.ip_network(f"{ip}/64", strict=False))
    return address

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


#: Rows one pairwise (obsp/varp) request may name. The web client reads one row
#: per cell or gene; 1000 is the most /data/paginated shows and /data/subset/locate
#: translates. max_response_elements (10M values) cuts it further on large matrices.
MAX_PAIRWISE_ROWS = 1000


class RowsRequiredError(ReadTooLargeError):
    """A pairwise read that names no rows, or too many: answered 400
    (``rows_required`` / ``too_many_rows``). A ReadTooLargeError so every
    route that answers the guard's refusals answers this one."""

    def __init__(self, reason: str, message: str):
        super().__init__(message, 0, 0, [])
        self.reason = reason


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
              wait_s: Optional[float] = None, share_pct: Optional[float] = None) -> None:
    """Set the per-request limit in MB (None or 0: the default,
    default_limit_bytes()), the budget of all pairwise reads in flight in this
    process (None or 0: twice the limit), the seconds a read waits for it, and
    the percentage of that budget one requester may hold at once (None: 50;
    0 or 100: no share)."""
    global _limit_mb, _budget_mb, _wait_s, _share_pct
    _limit_mb = float(max_mb) if max_mb else None
    _budget_mb = float(budget_mb) if budget_mb else None
    _wait_s = 5.0 if wait_s is None else float(wait_s)
    _share_pct = float(DEFAULT_SHARE_PCT if share_pct is None else share_pct)


def share_bytes() -> int:
    """What one requester may hold of the budget at once: its share, but at
    least ``max_read_mb`` so that one read the guard admits always fits."""
    if _share_pct <= 0 or _share_pct >= 100:
        return budget_bytes()
    return min(budget_bytes(), max(int(budget_bytes() * _share_pct / 100), limit_bytes()))


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

    One requester (``requester``) may hold only ``share_bytes()`` of the
    budget: its next read waits, or is refused, while the rest of the budget
    stays free for everybody else, instead of one user's reads using it all.
    """
    global _in_flight
    need = min(int(need), budget_bytes())
    owner = _owner.get()
    deadline = time.monotonic() + _wait_s
    with _cond:
        while (_in_flight + need > budget_bytes()
               or (owner is not None and _by_owner.get(owner, 0) > 0
                   and _by_owner[owner] + need > share_bytes())):
            left = deadline - time.monotonic()
            if left <= 0:
                mine = owner is not None and _by_owner.get(owner, 0) + need > share_bytes()
                raise ReadBusyError(
                    (f"You are already reading {_by_owner.get(owner, 0) / 2 ** 20:,.0f} MB of large pairwise "
                     f"matrices, the most one user may hold of the server's {budget_bytes() / 2 ** 20:,.0f} MB "
                     "read budget at once (server.read_user_share_percent); try again in a moment."
                     if mine else
                     f"The server is reading other large pairwise matrices "
                     f"({_in_flight / 2 ** 20:,.0f} MB in flight of a "
                     f"{budget_bytes() / 2 ** 20:,.0f} MB budget); try again in a moment."),
                    max(1, int(round(_wait_s))))
            _cond.wait(left)
        _in_flight += need
        if owner is not None:
            _by_owner[owner] = _by_owner.get(owner, 0) + need
    try:
        yield
    finally:
        with _cond:
            _in_flight -= need
            if owner is not None:
                left_over = _by_owner.get(owner, 0) - need
                if left_over > 0:
                    _by_owner[owner] = left_over
                else:
                    _by_owner.pop(owner, None)
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
    touches if fewer. In a sharded array (zarr format 3) ``chunks`` is the INNER chunk
    and ``shards`` the file: zarr reads the shard's index and then only the inner chunks
    a request touches (byte ranges), so the unit is the inner chunk, never the shard.
    Measured: five single-row reads of a (16000, 16000) float32 array raised the process's
    peak memory by 7.2 MB with (62, 16000) chunks, and by 7.3 MB with the same chunks in
    (992, 16000) shards of 63 MB. Also measured: 22 MB for one row of (256, 20000) float32
    (a 20.5 MB chunk), 42 MB at (256, 40000), about 10 chunks for a column.
    """
    shape = tuple(int(d) for d in obj.shape)
    unit = getattr(obj, "chunks", None)
    if len(shape) != 2 or not unit or len(unit) != 2:
        return 0
    touched = (_chunks_touched(row_indices, shape[0], int(unit[0]))
               * _chunks_touched(col_indices, shape[1], int(unit[1])))
    return min(touched, READ_CONCURRENCY) * int(unit[0]) * int(unit[1]) * int(obj.dtype.itemsize)


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


def require_rows(row_indices, name: str) -> None:
    """RowsRequiredError unless ``row_indices`` names 1..MAX_PAIRWISE_ROWS rows."""
    if row_indices is None:
        raise RowsRequiredError(
            "rows_required", f"{name} is read by rows: pairwise matrices are never read whole or by "
            "column. Ask for the rows you need (rows=, or the located cell); cols= only filters those rows.")
    if len(row_indices) > MAX_PAIRWISE_ROWS:
        raise RowsRequiredError(
            "too_many_rows", f"{len(row_indices)} rows of {name} asked for; at most {MAX_PAIRWISE_ROWS} per request.")


def check(name: str, obj, is_sparse: bool, row_indices=None, col_indices=None) -> int:
    """The estimated bytes of reading ``name`` (e.g. "obsp/distances") as
    asked, or ReadTooLargeError when that is more than the limit. Reads no data."""
    require_rows(row_indices, name)
    try:
        need, shape = estimate_bytes(obj, is_sparse, row_indices, col_indices)
    except Exception:
        return 0                    # not sizeable from metadata: the read decides
    limit = limit_bytes()
    if need <= limit:
        return need
    n_rows = len(row_indices) if row_indices is not None else shape[0]
    n_cols = len(col_indices) if col_indices is not None else shape[1]
    element = {"element": name, "shape": list(shape), "rows": n_rows, "columns": n_cols,
               "sparse": bool(is_sparse), "estimated_mb": round(need / 2 ** 20, 1)}
    unit = getattr(obj, "chunks", None)
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


#: Bytes a uns array costs per element once it is a Python list inside a JSON
#: reply: measured at 90 for float64 (10 million values, +907 MB of memory
#: while the reply is built); strings hold their text on top
UNS_BYTES_PER_ELEMENT = 100
UNS_BYTES_PER_STRING = 160


def estimate_uns_bytes(node, stop_above: Optional[int] = None) -> tuple:
    """(estimated bytes, elements) of reading ``node`` of uns whole, as the
    JSON reply the uns routes make of it; from shapes and dtypes only.
    ``node`` is a zarr or h5py group or array. Stops counting once the
    estimate passes ``stop_above``."""
    total, elements = 0, 0
    stack = [node]
    while stack:
        item = stack.pop()
        if hasattr(item, "keys"):
            try:
                stack.extend(item[k] for k in item.keys())
            except Exception:
                continue
            continue
        shape = getattr(item, "shape", None)
        if shape is None:
            continue
        n = 1
        for d in shape:
            n *= int(d)
        kind = getattr(getattr(item, "dtype", None), "kind", "f")
        total += n * (UNS_BYTES_PER_STRING if kind in ("S", "O", "U", "T") else UNS_BYTES_PER_ELEMENT)
        elements += n
        if stop_above is not None and total > stop_above:
            break
    return total, elements


def check_uns(key: str, node) -> int:
    """The estimated bytes of reading ``uns/<key>`` whole, or
    ReadTooLargeError when that is more than the limit. Reads no data.

    The uns routes read an array whole (``[()]``), turn it into nested Python
    lists and serialise those: 10 million floats held about 900 MB at once. A
    uns member is a plot's colours or a few parameters; one that is a
    matrix is asked for by a member of it instead (``uns/key/member``).
    """
    limit = limit_bytes()
    need, elements = estimate_uns_bytes(node, stop_above=limit)
    if need <= limit:
        return need
    raise ReadTooLargeError(
        f"Reading uns/{key} whole would hold about {need / 2 ** 20:,.0f} MB in memory"
        f" (at least {elements:,} values); the limit is {limit / 2 ** 20:,.0f} MB "
        "(server.max_read_mb). It is too large to send as JSON: read a smaller member of it, "
        "or ask the dataset's owner for it as an array in obsm, varm or a layer.",
        limit, need, [{"element": f"uns/{key}", "values": elements, "estimated_mb": round(need / 2 ** 20, 1)}])


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
                    unit = obj.chunks
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
