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


class NameIndex:
    """Case-insensitive exact / prefix / substring / regex lookup over names."""

    def __init__(self, names: List[str]):
        self.names = [("" if n is None else str(n)) for n in names]
        # Lower-case each name on its own and keep its length: str.lower() can
        # change the length of a string (e.g. 'İ'), so offsets are computed from
        # the lowered pieces, never from the originals. A newline inside a name
        # would break the separator scheme; it becomes a space in the haystack.
        lowered = [n.lower().replace(_SEP, " ") for n in self.names]
        lengths = np.fromiter((len(s) for s in lowered), dtype=np.int64, count=len(lowered))
        # starts[i] = offset of name i's first character in the haystack
        starts = np.empty(len(lowered), dtype=np.int64)
        if len(lowered):
            starts[0] = 1
            np.cumsum(lengths[:-1] + 1, out=starts[1:])
            starts[1:] += 1
        self._starts = starts
        self._hay = _SEP + _SEP.join(lowered) + _SEP

    def __len__(self) -> int:
        return len(self.names)

    def _row_at(self, offset: int) -> int:
        return int(np.searchsorted(self._starts, offset, side="right") - 1)

    def _find_rows(self, needle: str, want: int, skip: set, out: List[int]) -> bool:
        """Append rows whose haystack contains ``needle`` (first occurrence per
        row) to ``out`` until ``want`` rows are collected. Returns True if more
        matches exist beyond the ones collected."""
        hay = self._hay
        pos = hay.find(needle)
        seen_last = -1
        while pos != -1:
            row = self._row_at(pos + (1 if needle.startswith(_SEP) else 0))
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
            for i, name in enumerate(self.names):
                if rx.search(name):
                    if len(rows) >= limit:
                        truncated = True
                        break
                    rows.append(i)
            return self._result(rows, truncated)

        if query == "":
            rows = list(range(min(limit, len(self.names))))
            return self._result(rows, len(self.names) > limit)

        q = query.lower()
        if _SEP in q:
            return self._result([], False)

        skip: set = set()
        exact = self._exact_rows(query, q)
        for r in exact[:1]:
            rows.append(r)
            skip.add(r)
        if mode == "exact":
            return self._result(rows, False)

        # _find_rows stops at the first row it has no room for, so "truncated"
        # means a further matching name really exists, not just a full page.
        truncated = (self._find_rows(_SEP + q, limit, skip, rows)
                     or self._find_rows(q, limit, skip, rows))
        return self._result(rows, truncated)

    def _exact_rows(self, query: str, q: str) -> List[int]:
        """Rows whose name equals the query: case-sensitive hits first."""
        needle = _SEP + q + _SEP
        hits = []
        pos = self._hay.find(needle)
        while pos != -1:
            hits.append(self._row_at(pos + 1))
            pos = self._hay.find(needle, pos + 1)
        hits.sort(key=lambda r: (self.names[r] != query, r))
        return hits

    def _result(self, rows: List[int], truncated: bool) -> Dict:
        return {
            "matches": [{"name": self.names[r], "index": int(r)} for r in rows],
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
