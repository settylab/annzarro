"""Search over obs/var names without shipping the whole list to the browser.

The header's Focused Cell / Focused Gene pickers used to download every name
and hand it to a <select>; at a million cells that is a 15 MB response and a
tab that is unresponsive for ~15 s. They now ask this index for the few names
that match what the user has typed.

One index per (dataset, axis) is built on first use from the reader's name
list and kept in a small LRU, keyed against a stat() signature so a rewritten
store is re-read. Matching is case-insensitive and runs on one lower-cased,
newline-joined copy of the names, so a substring or prefix query is a C-level
``str.find`` over a single string rather than a Python loop over a million
objects; offsets map back to row indices with a binary search.
"""

from __future__ import annotations

import os
import re
import threading
from collections import OrderedDict
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np

MAX_LIMIT = 500
DEFAULT_LIMIT = 50
_CACHE_SIZE = 8

_SEP = "\n"


class NameChunks:
    """Names handed to NameIndex a chunk at a time: each chunk a list of
    strings or a ``(joined_bytes, lengths)`` pair (string_chunks.iter_chunks)."""

    def __init__(self, chunks):
        self.chunks = chunks


class NameIndex:
    """Case-insensitive exact / prefix / substring / regex lookup over names.

    Stored lean, for tens of millions of names: the lower-cased names as one
    newline-joined UTF-8 ``bytes`` haystack plus a ``uint32``/``uint64`` array
    of where each name starts in it. The original names are kept the same way
    (one blob plus offsets) only when some name differs from its haystack
    form (upper case, non-lowerable characters, a newline); otherwise a name is
    read back from the haystack. A list of 50M Python strings took about
    10 GB; this is about 1.2 GB for 50M 19-character names.

    Searching a UTF-8 haystack with a UTF-8 needle finds exactly the matches a
    ``str`` search would (UTF-8 is self-synchronising), so results are the
    same as the former list-of-strings index.
    """

    #: names per build step: bounds the transient per-name objects
    _CHUNK = 1 << 20

    def __init__(self, names):
        """``names``: a sequence of names, or a NameChunks of them (read a
        chunk at a time, never all as Python strings at once)."""
        if isinstance(names, NameChunks):
            chunks = names.chunks
        else:
            chunks = (names[a:a + self._CHUNK] for a in range(0, len(names), self._CHUNK))
        sep = _SEP.encode()
        self._hay_parts: List[bytes] = [sep]
        self._hay_lens: List[np.ndarray] = []
        self._orig_parts: List[bytes] = []
        self._orig_lens: List[np.ndarray] = []
        self._need_orig = False
        for chunk in chunks:
            if isinstance(chunk, tuple):
                self._add_joined(*chunk)
            else:
                self._add_list(["" if v is None else str(v) for v in chunk])
        n = int(sum(x.size for x in self._hay_lens))
        self._n = n
        self._hay = b"".join(self._hay_parts) if n else sep * 2
        lens = np.concatenate(self._hay_lens) if self._hay_lens else np.zeros(0, np.int64)
        starts = np.empty(n, dtype=np.int64)
        if n:
            starts[0] = 1
            np.cumsum(lens[:-1] + 1, out=starts[1:])
            starts[1:] += 1
        self._starts = starts.astype(np.uint32 if len(self._hay) < 2 ** 32 else np.uint64)
        if self._need_orig:
            off = np.zeros(n + 1, dtype=np.int64)
            np.cumsum(np.concatenate(self._orig_lens), out=off[1:])
            blob = b"".join(self._orig_parts)
            self._orig = blob
            self._orig_off = off.astype(np.uint32 if len(blob) < 2 ** 32 else np.uint64)
        else:
            self._orig = None
            self._orig_off = None
        del self._hay_parts, self._hay_lens, self._orig_parts, self._orig_lens, self._need_orig

    def _add_joined(self, joined: bytes, lengths: np.ndarray) -> None:
        """One chunk as newline-joined UTF-8 and item byte lengths
        (string_chunks.joined_items): ASCII without newlines in the names is
        lower-cased as bytes, which for ASCII is what str.lower() does."""
        k = int(lengths.size)
        if k == 0:
            return
        if joined.isascii() and joined.count(_SEP.encode()) == k - 1:
            low = joined.lower()
            self._hay_parts.append(low)
            self._hay_parts.append(_SEP.encode())
            self._hay_lens.append(np.asarray(lengths, dtype=np.int64))
            self._orig_parts.append(joined.replace(_SEP.encode(), b""))
            self._orig_lens.append(np.asarray(lengths, dtype=np.int64))
            if low != joined:
                self._need_orig = True
            return
        names, pos = [], 0
        for ln in lengths.tolist():
            names.append(joined[pos:pos + ln].decode())
            pos += ln + 1
        self._add_list(names)

    def _add_list(self, part: List[str]) -> None:
        if not part:
            return
        sep = _SEP.encode()
        joined = _SEP.join(part)
        if joined.isascii() and joined.count(_SEP) == len(part) - 1:
            # one byte per character, no newline inside a name: whole-chunk ops
            lens = np.fromiter(map(len, part), dtype=np.int64, count=len(part))
            low = joined.lower()
            self._hay_parts.append(low.encode("ascii"))
            if low != joined:
                self._need_orig = True
            self._orig_parts.append(joined.replace(_SEP, "").encode("ascii"))
            self._orig_lens.append(lens)
            self._hay_lens.append(lens)
        else:
            # lower() may change a name's length ('İ'); a newline becomes a space
            low = [x.lower().replace(_SEP, " ").encode() for x in part]
            enc = [x.encode() for x in part]
            self._hay_parts.append(sep.join(low))
            self._hay_lens.append(np.fromiter(map(len, low), dtype=np.int64, count=len(low)))
            self._orig_parts.append(b"".join(enc))
            self._orig_lens.append(np.fromiter(map(len, enc), dtype=np.int64, count=len(enc)))
            if any(lo != e for lo, e in zip(low, enc)):
                self._need_orig = True
        self._hay_parts.append(sep)

    def __len__(self) -> int:
        return self._n

    def name(self, row: int) -> str:
        """The original name of ``row``."""
        if self._orig is not None:
            return self._orig[int(self._orig_off[row]):int(self._orig_off[row + 1])].decode()
        a = int(self._starts[row])
        b = int(self._starts[row + 1]) - 1 if row + 1 < self._n else len(self._hay) - 1
        return self._hay[a:b].decode()

    def _names_from(self, start: int):
        """Original names in dataset order from ``start``, decoded a chunk at a time."""
        for a in range(start, self._n, self._CHUNK):
            b = min(a + self._CHUNK, self._n)
            if self._orig is not None:
                for r in range(a, b):
                    yield self.name(r)
            else:
                lo = int(self._starts[a])
                hi = int(self._starts[b]) - 1 if b < self._n else len(self._hay) - 1
                yield from self._hay[lo:hi].decode().split(_SEP)

    def _row_at(self, offset: int) -> int:
        # the offset in the array's own dtype: a Python int would make numpy
        # cast the whole (uint32) array to int64 on every call
        return int(np.searchsorted(self._starts, self._starts.dtype.type(offset), side="right") - 1)

    def _find_rows(self, needle: bytes, want: int, skip: set, out: List[int]) -> bool:
        """Append rows whose haystack contains ``needle`` (first occurrence per
        row) to ``out`` until ``want`` rows are collected. Returns True if more
        matches exist beyond the ones collected."""
        hay = self._hay
        sep = _SEP.encode()
        pos = hay.find(needle)
        seen_last = -1
        while pos != -1:
            row = self._row_at(pos + (1 if needle.startswith(sep) else 0))
            if row != seen_last and row not in skip:
                if len(out) >= want:
                    return True
                out.append(row)
                skip.add(row)
            seen_last = row
            # jump to the next name: one row contributes at most once
            nxt = self._starts[row + 1] - 1 if row + 1 < len(self._starts) else len(hay)
            pos = hay.find(needle, max(pos + 1, int(nxt)))
        return False

    def search(self, query: str, limit: int = DEFAULT_LIMIT, mode: str = "substring") -> Dict:
        """Return ``{"matches": [{"name", "index"}], "truncated": bool}``.

        Order: an exact (case-sensitive, then case-insensitive) match first,
        then names that start with the query, then names that contain it, each
        group in dataset order. ``mode="regex"`` applies a case-insensitive
        ``re.search`` instead; ``mode="exact"`` returns only an exact match.
        """
        limit = max(1, min(int(limit), MAX_LIMIT))
        query = "" if query is None else str(query)
        rows: List[int] = []
        truncated = False

        if mode == "regex":
            rx = re.compile(query, re.IGNORECASE)
            for i, name in enumerate(self._names_from(0)):
                if rx.search(name):
                    if len(rows) >= limit:
                        truncated = True
                        break
                    rows.append(i)
            return self._result(rows, truncated)

        if query == "":
            rows = list(range(min(limit, self._n)))
            return self._result(rows, self._n > limit)

        q = query.lower()
        if _SEP in q:
            return self._result([], False)
        qb = q.encode()
        sep = _SEP.encode()

        skip: set = set()
        exact = self._exact_rows(query, qb)
        for r in exact[:1]:
            rows.append(r)
            skip.add(r)
        if mode == "exact":
            return self._result(rows, False)

        # _find_rows stops at the first row it has no room for, so "truncated"
        # means a further matching name really exists, not just a full page.
        truncated = (self._find_rows(sep + qb, limit, skip, rows)
                     or self._find_rows(qb, limit, skip, rows))
        return self._result(rows, truncated)

    def _exact_rows(self, query: str, qb: bytes) -> List[int]:
        """Rows whose name equals the query: case-sensitive hits first."""
        sep = _SEP.encode()
        needle = sep + qb + sep
        hits = []
        pos = self._hay.find(needle)
        while pos != -1:
            hits.append(self._row_at(pos + 1))
            pos = self._hay.find(needle, pos + 1)
        hits.sort(key=lambda r: (self.name(r) != query, r))
        return hits

    def _result(self, rows: List[int], truncated: bool) -> Dict:
        return {
            "matches": [{"name": self.name(r), "index": int(r)} for r in rows],
            "truncated": bool(truncated),
        }


def _signature(dataset_path: str) -> Tuple:
    """Cheap fingerprint of a local store; remote paths are trusted as-is."""
    sig = []
    for member in ("", "obs", "var", ".zattrs", "zarr.json"):
        p = os.path.join(dataset_path, member) if member else dataset_path
        try:
            st = os.stat(p)
            sig.append((member, st.st_mtime_ns, st.st_size))
        except OSError:
            continue
    return tuple(sig)


_cache: "OrderedDict[Tuple[str, str], Tuple[Tuple, NameIndex]]" = OrderedDict()
_lock = threading.Lock()


def get_index(dataset_path: str, entity: str, load_names: Callable[[], List[str]]) -> NameIndex:
    """The cached NameIndex for one axis of one dataset, built on first use."""
    key = (dataset_path, entity)
    sig = _signature(dataset_path)
    with _lock:
        hit = _cache.get(key)
        if hit is not None and hit[0] == sig:
            _cache.move_to_end(key)
            return hit[1]
    index = NameIndex(load_names())
    with _lock:
        _cache[key] = (sig, index)
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)
    return index


def clear(dataset_path: Optional[str] = None) -> None:
    with _lock:
        if dataset_path is None:
            _cache.clear()
        else:
            for key in [k for k in _cache if k[0] == dataset_path]:
                del _cache[key]
