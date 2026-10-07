"""Put numeric slices on the wire: binary vectors, and JSON without the waste.

One interaction in AnnZarro moves one vector (a gene column, a cell row, an
embedding axis, a kNN row). At 1M cells that vector used to cost 21.5 MB of
JSON and ~500 ms of ``tolist`` + ``jsonify`` for 4 MB of float32: every value
was written at float64 precision (~19 characters) and a gene column was an
n x 1 nested list.

Binary protocol
---------------
A client opts in per request with the query parameter ``format=f32`` on
``/data/X``, ``/data/layer/<k>``, ``/data/obsm/<k>``, ``/data/varm/<k>``,
``/data/obsp/<k>``, ``/data/varp/<k>``, and on ``/data/obs`` / ``/data/var``
when exactly one column is requested. A query parameter (not ``Accept``) keeps
the two encodings at different URLs, so browser and client caches never
confuse them. When the slice is numeric the reply is::

    Content-Type: application/octet-stream
    X-Annzarro-Shape:    "n" or "rows,cols" (row-major)
    X-Annzarro-Dtype:    "float32" or "float64"
    X-Annzarro-Encoding: "dense" or "sparse"
    X-Annzarro-Nnz:      stored entries (sparse only)

``dense``: prod(shape) little-endian values. ``sparse``: nnz little-endian
values, then nnz little-endian uint32 flat row-major positions; every other
entry is 0. Sparse is chosen whenever it is smaller, which is the normal case
for a kNN row (15 of 1.17M entries) or a UMI-count gene column. NaN and +-inf
are preserved as IEEE values (and are "non-zero").

The dtype is float32 whenever that is exact: float32 sources, integers below
2**24, and float64 arrays whose values all survive the round trip (e.g. counts
stored as f8). Anything else (tiny p-values, large ids) goes as float64, so
binary never loses information that JSON carried.

When the slice is not numeric (strings, booleans, categoricals) the reply is
the ordinary JSON body even with ``format=f32``; clients must look at
``Content-Type``.

Categorical columns
-------------------
A client that also sends ``categorical=codes`` gets a categorical obs/var
column (one column requested) as integer codes instead of one JSON string
per cell (12 B per cell; 120 MB for 10M cells)::

    Content-Type: application/octet-stream
    X-Annzarro-Encoding:        "categorical"
    X-Annzarro-Shape:           "n"
    X-Annzarro-Dtype:           "int8", "int16" or "int32" (the narrowest
                                that holds every code; -1 is a missing value)
    X-Annzarro-Categories-Bytes: length L of the categories prefix

The body is a UTF-8 JSON array of the categories, padded with spaces to L
bytes (a multiple of 4, so the codes that follow are aligned), then n
little-endian codes. Code k is categories[k]. A client that does not send
``categorical=codes`` (every client before this encoding) still gets JSON.

A column with more than 65,536 categories (a barcode column has one per
cell), or a request with ``categories=used``, gets only the categories the
returned codes use, renumbered, and the header
``X-Annzarro-Categories-Total`` with the column's count.

``categories=ranked``: code r means the r-th largest category of the WHOLE
column (by cells; ties by stored code), the same in every subset; the prefix
is empty, ``X-Annzarro-Categories-Used`` the number of categories with
cells and ``X-Annzarro-Categories-Order: ranked`` says so. It is what
colouring by colour group needs; the few names a legend shows come from
``category_ranks=`` (core/categories.py).

JSON
----
JSON stays the default and keeps its shape contract (an n x 1 slice is still a
list of one-element lists). Numbers are written in their shortest round-trip
form for their own dtype (float32 ``0.1`` is ``0.1``, not
``0.10000000149011612``) and non-finite values are ``null``, which is what the
browser client turned ``NaN`` literals into anyway, after a failed parse.
"""

import json
import logging

import numpy as np
from flask import Response, jsonify

logger = logging.getLogger(__name__)

BINARY_FORMAT = "f32"
BINARY_MIMETYPE = "application/octet-stream"
HEADER_SHAPE = "X-Annzarro-Shape"
HEADER_DTYPE = "X-Annzarro-Dtype"
HEADER_ENCODING = "X-Annzarro-Encoding"
HEADER_NNZ = "X-Annzarro-Nnz"
HEADER_CATEGORIES_BYTES = "X-Annzarro-Categories-Bytes"
HEADER_CATEGORIES_TOTAL = "X-Annzarro-Categories-Total"
HEADER_CATEGORIES_USED = "X-Annzarro-Categories-Used"
HEADER_CATEGORIES_ORDER = "X-Annzarro-Categories-Order"
EXPOSED_HEADERS = ", ".join((HEADER_SHAPE, HEADER_DTYPE, HEADER_ENCODING, HEADER_NNZ,
                             HEADER_CATEGORIES_BYTES, HEADER_CATEGORIES_TOTAL,
                             HEADER_CATEGORIES_USED, HEADER_CATEGORIES_ORDER, "ETag"))

_F32_EXACT_INT = 2 ** 24


def wants_binary(args) -> bool:
    """True when the request asked for the binary encoding (``format=f32``)."""
    return (args.get("format") or "").lower() == BINARY_FORMAT


def wants_codes(args) -> bool:
    """True when a binary request also accepts categorical codes
    (``categorical=codes``)."""
    return wants_binary(args) and (args.get("categorical") or "").lower() == "codes"


def numeric_array(data):
    """``data`` as a 1-D/2-D int or float ndarray, or None when it is not one.

    Booleans, strings and object arrays (e.g. a list holding ``None``) are
    not numeric here: they keep their JSON form.
    """
    if hasattr(data, "toarray") and not isinstance(data, np.ndarray):
        data = data.toarray()
    if isinstance(data, list):
        if not data:
            return None
        try:
            data = np.asarray(data)
        except (ValueError, TypeError):
            return None
    if not isinstance(data, np.ndarray):
        return None
    if data.dtype.kind not in "iuf" or data.ndim not in (1, 2):
        return None
    return data


def wire_values(arr: np.ndarray) -> np.ndarray:
    """The array in the narrowest little-endian float dtype that is exact."""
    kind = arr.dtype.kind
    if arr.dtype == np.float32 or (kind == "f" and arr.dtype.itemsize < 4):
        return arr.astype("<f4", copy=False)
    if kind in "iu":
        if arr.size == 0 or (int(arr.max()) < _F32_EXACT_INT and int(arr.min()) > -_F32_EXACT_INT):
            return arr.astype("<f4")
        return arr.astype("<f8")
    as32 = arr.astype("<f4")
    with np.errstate(over="ignore", invalid="ignore"):
        exact = np.array_equal(as32.astype(arr.dtype), arr, equal_nan=True)
    return as32 if exact else arr.astype("<f8", copy=False)


def binary_response(arr: np.ndarray) -> Response:
    """Encode a numeric ndarray per the protocol in this module's docstring."""
    values = wire_values(arr)
    flat = np.ascontiguousarray(values).reshape(-1)
    itemsize = flat.dtype.itemsize
    nnz = int(np.count_nonzero(flat))  # NaN != 0, so NaN is stored
    headers = {
        HEADER_SHAPE: ",".join(str(int(d)) for d in values.shape),
        HEADER_DTYPE: "float32" if itemsize == 4 else "float64",
        "Access-Control-Expose-Headers": EXPOSED_HEADERS,
    }
    if flat.size and flat.size < 2 ** 32 and nnz * (itemsize + 4) < flat.size * itemsize:
        pos = np.flatnonzero(flat)
        body = flat[pos].tobytes() + pos.astype("<u4").tobytes()
        headers[HEADER_ENCODING] = "sparse"
        headers[HEADER_NNZ] = str(nnz)
    else:
        body = flat.tobytes()
        headers[HEADER_ENCODING] = "dense"
    return Response(body, mimetype=BINARY_MIMETYPE, headers=headers)


def code_dtype(n_categories: int) -> np.dtype:
    """The narrowest signed integer holding codes -1..n_categories-1."""
    for dtype in ("<i1", "<i2"):
        if n_categories - 1 <= np.iinfo(dtype).max:
            return np.dtype(dtype)
    return np.dtype("<i4")


# Labels encoded per piece of a categorical reply: the reply is streamed, so
# a request never holds every label as Python strings plus their JSON copy
# (2M barcodes: about 120 MB of str objects and 30 MB of JSON before).
LABEL_CHUNK = 65_536
# Encoded label pieces kept from the length pass up to this size; past it
# they are encoded again while streaming.
KEEP_ENCODED_BYTES = 8 << 20
# Bytes of codes per streamed piece.
CODE_CHUNK_BYTES = 4 << 20


def _label_pieces(categories):
    """The JSON array of ``categories`` as UTF-8 pieces of LABEL_CHUNK labels."""
    n = len(categories)
    if n == 0:
        yield b"[]"
        return
    for start in range(0, n, LABEL_CHUNK):
        part = categories[start:start + LABEL_CHUNK]
        items = part.tolist() if isinstance(part, np.ndarray) else [
            c.item() if isinstance(c, np.generic) else c for c in part]
        text = ",".join(json.dumps(c, ensure_ascii=False, separators=(",", ":")) for c in items)
        yield (("[" if start == 0 else ",") + text).encode("utf-8")
    yield b"]"


def categorical_response(codes: np.ndarray, categories, total=None, used=None, ranked=False) -> Response:
    """A categorical column as codes plus its categories (module docstring).

    ``total``: the column's number of categories when ``categories`` holds
    only those the codes use (core/categories.py); sent as
    X-Annzarro-Categories-Total, so a client never takes the short list for
    the column's. ``ranked``: the codes are ranks in the column's ranking,
    ``categories`` empty, and ``used`` the number of categories with cells
    (X-Annzarro-Categories-Used).

    The reply is streamed: the labels are encoded LABEL_CHUNK at a time, once
    to learn the prefix length the header announces and again while sending
    (kept from the first pass when small), and the codes go out in slices.
    """
    codes = np.asarray(codes).reshape(-1)
    span = int(used) if ranked else len(categories)
    bad = (codes < 0) | (codes >= span)
    wire = codes.astype(code_dtype(span))
    if bad.any():
        wire[bad] = -1
    del bad
    kept, length = [], 0
    for piece in _label_pieces(categories):
        length += len(piece)
        if kept is not None:
            kept.append(piece)
            if length > KEEP_ENCODED_BYTES:
                kept = None
    pad = b" " * (-length % 4)
    headers = {
        HEADER_ENCODING: "categorical",
        HEADER_SHAPE: str(int(wire.size)),
        HEADER_DTYPE: wire.dtype.name,
        HEADER_CATEGORIES_BYTES: str(length + len(pad)),
        "Access-Control-Expose-Headers": EXPOSED_HEADERS,
        "Content-Length": str(length + len(pad) + wire.nbytes),
    }
    if total is not None:
        headers[HEADER_CATEGORIES_TOTAL] = str(int(total))
    if ranked:
        headers[HEADER_CATEGORIES_USED] = str(int(used))
        headers[HEADER_CATEGORIES_ORDER] = "ranked"

    def body():
        yield from (kept if kept is not None else _label_pieces(categories))
        yield pad
        raw = memoryview(wire).cast("B")
        for start in range(0, len(raw), CODE_CHUNK_BYTES):
            yield raw[start:start + CODE_CHUNK_BYTES].tobytes()

    return Response(body(), mimetype=BINARY_MIMETYPE, headers=headers)


def numeric_json_text(arr: np.ndarray) -> str:
    """Shape-faithful JSON for a numeric ndarray, shortest repr, NaN -> null."""
    if arr.dtype.kind == "f" and arr.dtype.itemsize < 4:
        arr = arr.astype(np.float32)
    flat = arr.reshape(-1)
    nonzero = np.flatnonzero(flat)
    if len(nonzero) * 2 < flat.size:
        # Mostly zeros (a kNN row, a UMI gene column): format only the rest.
        text = ["0"] * flat.size
        for i, s in zip(nonzero.tolist(), flat[nonzero].astype(str).tolist()):
            text[i] = s
    else:
        text = flat.astype(str).tolist()
    if arr.dtype.kind == "f":
        for i in np.flatnonzero(~np.isfinite(flat)).tolist():
            text[i] = "null"
    if arr.ndim == 1:
        return "[" + ",".join(text) + "]"
    rows, cols = arr.shape
    if rows == 0:
        return "[]"
    if cols == 1:
        return "[[" + "],[".join(text) + "]]"
    return "[" + ",".join("[" + ",".join(text[r * cols:(r + 1) * cols]) + "]"
                          for r in range(rows)) + "]"


def _serializable(data):
    if hasattr(data, "tolist"):
        return data.tolist()
    if isinstance(data, list) and data and hasattr(data[0], "tolist"):
        return [row.tolist() if hasattr(row, "tolist") else row for row in data]
    return data


def array_response(data, meta: dict, binary: bool = False):
    """Reply with ``{"data": data, **meta}`` -- or the binary form when asked.

    ``meta`` carries the small identifying fields each route always returned
    (``layer_name``, ``dataset_path`` ...); in the binary form the client
    already knows them, having asked.
    """
    arr = numeric_array(data)
    if arr is None:
        return jsonify({"data": _serializable(data), **meta})
    if binary:
        return binary_response(arr)
    rest = json.dumps(meta)
    body = '{"data":' + numeric_json_text(arr) + ("," + rest[1:] if len(rest) > 2 else "}")
    return Response(body, mimetype="application/json")
