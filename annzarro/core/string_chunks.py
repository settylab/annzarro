"""Read some entries of a 1-D string array without decoding all of it.

A cell subset of a large store needs the names of its cells, and only those:
100,000 of 95.6 million for Tahoe-100M. The names (``obs/_index``) are a
zarr string array in chunks of about a million entries, and a random subset
touches every chunk, so reading by index still reads every chunk. Reading
them was the cost of opening the store: zarr decodes every entry of every
chunk into a Python string (1.1 s per 10 million names, plus the memory of
all of them at once) to hand back 100,000.

:func:`take` reads one chunk at a time, so memory stays bounded by one
chunk. For a local zarr-format-2 chunk encoded ``vlen-utf8`` (what anndata
writes for a string index) it decompresses the chunk and finds the wanted
entries in the encoded bytes directly, making a Python string only for
those. Everything else (other encodings, zarr format 3, remote stores, a
chunk the parser cannot vouch for) is read through zarr, one chunk at a
time.

The ``vlen-utf8`` chunk layout (numcodecs): a little-endian uint32 count n,
then n items, each a uint32 byte length followed by that many UTF-8 bytes.
Finding item k needs the lengths of items 0..k-1, which is a sequential
scan; it is done with numpy in one of two ways, and the result is accepted
only if the item boundaries it found chain exactly from the first item to
the end of the chunk:

* fixed width: every item has the length of the first (barcodes usually
  do). The boundaries are then arithmetic.
* zero runs: UTF-8 text without NUL characters contains no zero byte, and
  the length header of an item shorter than 16 MiB ends in a zero byte that
  the item's first text byte follows. So each header ends where a run of
  zero bytes ends. An empty item, or a length that is a multiple of 256,
  joins two runs; the chain check then fails and the chunk is decoded by
  numcodecs instead.
"""

from __future__ import annotations

import json
import logging
import os
from typing import List, Optional, Sequence

import numpy as np

logger = logging.getLogger(__name__)


def _vlen_bounds(buf: np.ndarray):
    """(starts, lengths) of the items of a decompressed vlen-utf8 chunk, or
    None when neither parse can be verified."""
    if buf.size < 4:
        return None
    n = int(buf[:4].view("<u4")[0])
    body = buf[4:]
    if n == 0:
        return (np.empty(0, np.int64), np.empty(0, np.int64)) if body.size == 0 else None
    if body.size < 4 * n:
        return None

    # Fixed width: n records of (4 + width) bytes, each header equal to width.
    width = int(body[:4].view("<u4")[0])
    if body.size == n * (4 + width):
        records = body.reshape(n, 4 + width)
        if np.all(np.ascontiguousarray(records[:, :4]).view("<u4").ravel() == width):
            starts = np.arange(n, dtype=np.int64) * (4 + width) + 8
            return starts, np.full(n, width, dtype=np.int64)

    # Zero runs: header k ends at the last zero byte of a run.
    zero = body == 0
    ends = np.flatnonzero(zero & np.append(~zero[1:], True))
    heads = ends - 3
    if heads.size != n or heads[0] != 0:
        return None
    lengths = np.frombuffer(np.ascontiguousarray(
        body[heads[:, None] + np.arange(4)]).tobytes(), dtype="<u4").astype(np.int64)
    after = heads + 4 + lengths
    if after[-1] != body.size or not np.array_equal(after[:-1], heads[1:]):
        return None
    return heads + 8, lengths


def decode_vlen_items(chunk_bytes, positions: np.ndarray) -> Optional[List[str]]:
    """Items ``positions`` of a decompressed vlen-utf8 chunk, or None when the
    chunk cannot be parsed without decoding all of it."""
    buf = np.frombuffer(chunk_bytes, dtype=np.uint8)
    bounds = _vlen_bounds(buf)
    if bounds is None:
        return None
    starts, lengths = bounds
    if positions.size and positions[-1] >= starts.size:
        return None
    view = memoryview(buf)
    s, ln = starts[positions].tolist(), lengths[positions].tolist()
    return [str(view[a:a + b], "utf-8") for a, b in zip(s, ln)]


class _LocalVlenArray:
    """Raw chunk access to a local, 1-D, zarr-format-2 ``vlen-utf8`` array."""

    def __init__(self, directory: str, meta: dict):
        import numcodecs
        self.directory = directory
        self.chunk = int(meta["chunks"][0])
        compressor = meta.get("compressor")
        self.codec = numcodecs.get_codec(compressor) if compressor else None

    @classmethod
    def open(cls, directory: Optional[str]):
        if not directory:
            return None
        try:
            with open(os.path.join(directory, ".zarray")) as fh:
                meta = json.load(fh)
        except (OSError, ValueError):
            return None
        filters = meta.get("filters") or []
        if (meta.get("zarr_format") != 2 or meta.get("dtype") != "|O" or len(meta.get("shape") or ()) != 1
                or [f.get("id") for f in filters] != ["vlen-utf8"]):
            return None
        try:
            return cls(directory, meta)
        except Exception as exc:  # an unknown compressor id
            logger.debug("No raw chunk access for %s: %s", directory, exc)
            return None

    def items(self, chunk_index: int, positions: np.ndarray) -> Optional[List[str]]:
        try:
            with open(os.path.join(self.directory, str(chunk_index)), "rb") as fh:
                data = fh.read()
            if self.codec is not None:
                data = self.codec.decode(data)
            return decode_vlen_items(data, positions)
        except Exception as exc:
            logger.debug("Raw read of chunk %s of %s failed (%s); reading it through zarr",
                         chunk_index, self.directory, exc)
            return None


def take(array, rows: Sequence[int], local_dir: Optional[str] = None) -> List:
    """``array[rows]`` as a list, for sorted ``rows``, one chunk at a time.

    ``array`` is a 1-D zarr array; ``local_dir`` is its directory when the
    store is a local directory, which enables the raw path.
    """
    rows = np.asarray(rows, dtype=np.int64)
    if rows.size == 0:
        return []
    chunk = int(array.chunks[0]) or 1
    size = int(array.shape[0])
    raw = _LocalVlenArray.open(local_dir)
    if raw is not None and raw.chunk != chunk:
        raw = None
    out: List = []
    for part in np.split(rows, np.flatnonzero(np.diff(rows // chunk)) + 1):
        lo = int(part[0] // chunk) * chunk
        local = part - lo
        names = raw.items(lo // chunk, local) if raw is not None else None
        if names is None:
            names = np.asarray(array[lo:min(lo + chunk, size)])[local].tolist()
        out.extend(names)
    return out
