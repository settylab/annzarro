"""The lean name index (core/name_index.py) answers exactly as the former one.

``ReferenceIndex`` below is the list-of-strings index the lean one replaced
(annzarro before #62), kept verbatim as the reference. Both are asked the same
exact, prefix/substring, regex and empty queries, at several limits, over
names that exercise every path of the lean build: ASCII and non-ASCII, upper
case, names that lower() lengthens ('İ'), newlines, empty names, None and
duplicates, with a chunk size small enough that names span several chunks.
Real names: the committed fixture, and bm_aging when its store is present.
"""
import os
import re
from typing import Dict, List

import numpy as np
import pytest

from annzarro.core import name_index
from annzarro.core.name_index import NameIndex, MAX_LIMIT, DEFAULT_LIMIT

_SEP = "\n"

class ReferenceIndex:
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




SYNTH = (["cell_%d" % i for i in range(40)]
         + ["Cell_7", "CELL_7", "cell_7", "İstanbul", "istanbul", "naïve T", "NAÏVE t", "細胞-1", "細胞-12",
            "line\nbreak", "", None, "dup", "dup", "Dup", "a b", "ABC", "abc", "xabcx", "ß", "SS",
            "0001", "00010", "Ǆemal", "ǆemal"])


def _queries(names):
    qs = {"", "zzz-none", "ABC", "abc", "c", "cell", "CELL_", "_1", "7", "dup", "Dup", "DUP", "i̇", "İst",
          "istan", "naïve", "NAÏVE", "細胞", "胞-1", "ss", "ß", "line", "break", "a b", " ", "0001", "ǆ", "Ǆ"}
    for v in names[:: max(1, len(names) // 25)]:
        if v:
            s = str(v)
            qs.update({s, s.upper(), s.lower(), s[:3], s[1:5], s[-3:]})
    return sorted(q for q in qs if "\n" not in q)


def _compare(names, chunk):
    old = ReferenceIndex(names)
    saved = NameIndex._CHUNK
    NameIndex._CHUNK = chunk
    try:
        new = NameIndex(names)
    finally:
        NameIndex._CHUNK = saved
    assert len(new) == len(old.names)
    for i in range(len(old.names)):
        assert new.name(i) == old.names[i]
    for q in _queries(names):
        for mode in ("substring", "exact"):
            for limit in (1, 5, DEFAULT_LIMIT, MAX_LIMIT):
                assert new.search(q, limit=limit, mode=mode) == old.search(q, limit=limit, mode=mode), (q, mode, limit)
    for rx in ("^cell_1", "7$", "naïve", "細", "^$", "d.p", "[A-Z]{3}"):
        for limit in (1, 5, 50):
            assert new.search(rx, limit=limit, mode="regex") == old.search(rx, limit=limit, mode="regex"), (rx, limit)


@pytest.mark.parametrize("chunk", [1, 7, 1 << 20])
def test_synthetic_names_every_path(chunk):
    _compare(SYNTH, chunk)


@pytest.mark.parametrize("chunk", [3, 1 << 20])
def test_ascii_lowercase_names_keep_no_second_copy(chunk):
    names = ["%02d_%03d_%03d-lib_%04d" % (i // 1000, i // 10 % 100, i % 1000, i * 7 % 10000) for i in range(500)]
    _compare(names, chunk)
    saved = NameIndex._CHUNK
    NameIndex._CHUNK = chunk
    try:
        assert NameIndex(names)._orig is None, "lower-case ASCII names are read back from the haystack"
    finally:
        NameIndex._CHUNK = saved


def test_empty_index():
    _compare([], 7)


def test_fixture_store_names():
    from annzarro.core.zarr_reader import ZarrReader
    store = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "fixture_small.zarr")
    _compare(ZarrReader().get_cell_gene_names(store, "cells"), 64)
    _compare(ZarrReader().get_cell_gene_names(store, "genes"), 64)


def test_bm_aging_names():
    store = os.path.join(os.environ.get("ANNZARRO_DOCS_DATA", os.path.expanduser("~/gits/annzarro-paper/data")),
                         "bm_aging.zarr")
    if not os.path.isdir(store):
        pytest.skip(f"no {store}")
    from annzarro.core.zarr_reader import ZarrReader
    _compare(ZarrReader().get_cell_gene_names(store, "cells"), 1000)
    _compare(ZarrReader().get_cell_gene_names(store, "genes"), 1000)


# --- built a zarr chunk at a time (string_chunks.iter_chunks) -----------------
import numcodecs  # noqa: E402

from annzarro.core import string_chunks  # noqa: E402
from annzarro.core.name_index import NameChunks  # noqa: E402
from annzarro.tests.zarr_compat import open_group, write_strings  # noqa: E402

JOIN_CASES = [[f"AAAC{i:06d}-1" for i in range(50)], ["a", "bb", "", "cccc", "e"], ["", "", ""],
              ["é", "漢字", "naïve", "😀x"], ["q\nline", "x", "tab\tin"], ["only"], []]


@pytest.mark.parametrize("items", JOIN_CASES)
def test_joined_items_is_exact_or_declines(items):
    encoded = numcodecs.VLenUTF8().encode(np.array(items, dtype=object))
    got = string_chunks.joined_items(encoded)
    if got is None:
        return
    joined, lengths = got
    assert lengths.tolist() == [len(x.encode()) for x in items]
    assert joined == "\n".join(items).encode()


def _chunked_names(n, kind):
    if kind == "barcodes":
        return [f"{i // 1000:02d}_{i % 1000:03d}-lib_{i * 7 % 10000:04d}" for i in range(n)]
    if kind == "upper":
        return [f"AAAC{i:06d}-1" for i in range(n)]
    rng = np.random.default_rng(n)
    pool = ["", "AAACCTGAGAAACCAT-1", "é漢字_ü", "İstanbul", "😀,#;x", "q\nline", "Dup", "dup", "x" * 300, "ß"]
    names = [f"cell_{i}" for i in range(n)]
    for i in rng.choice(n, size=n // 3, replace=False):
        names[i] = pool[int(rng.integers(len(pool)))] + ("" if rng.random() < 0.5 else f"_{i}")
    return names


@pytest.mark.parametrize("compressor", ["blosc-zstd", "none"])
@pytest.mark.parametrize("kind", ["barcodes", "upper", "tricky"])
def test_chunked_build_equals_reference(tmp_path, compressor, kind, monkeypatch):
    n, chunk = 2_050, 256                       # the last chunk is partial
    names = _chunked_names(n, kind)
    comp = numcodecs.Blosc(cname="zstd", clevel=3, shuffle=numcodecs.Blosc.SHUFFLE) if compressor != "none" else None
    root = open_group(tmp_path / "s.zarr")
    arr = write_strings(root, "idx", names, chunks=(chunk,), compressor=comp)
    raw_chunks = []
    real = string_chunks.joined_items
    monkeypatch.setattr(string_chunks, "joined_items",
                        lambda *a: raw_chunks.append(real(*a)) or raw_chunks[-1])
    new = NameIndex(NameChunks(string_chunks.iter_chunks(arr, str(tmp_path / "s.zarr" / "idx"))))
    if kind != "tricky":
        assert raw_chunks and all(c is not None for c in raw_chunks), "a chunk fell back to zarr"
    old = ReferenceIndex(names)
    assert len(new) == n
    for i in range(n):
        assert new.name(i) == names[i]
    for q in _queries(names):
        for mode in ("substring", "exact"):
            for limit in (1, 50, MAX_LIMIT):
                assert new.search(q, limit=limit, mode=mode) == old.search(q, limit=limit, mode=mode), (q, mode)
    assert new.search("^cell_1", limit=20, mode="regex") == old.search("^cell_1", limit=20, mode="regex")


def _reader_chunks_vs_list(store, entity):
    from annzarro.core.zarr_reader import ZarrReader
    reader = ZarrReader()
    names = reader.get_cell_gene_names(store, entity)
    chunks = reader.iter_cell_gene_name_chunks(store, entity)
    assert chunks is not None
    new, old = NameIndex(NameChunks(chunks)), ReferenceIndex(names)
    assert len(new) == len(names)
    for q in _queries(names):
        for mode in ("substring", "exact"):
            assert new.search(q, limit=50, mode=mode) == old.search(q, limit=50, mode=mode), (q, mode)


def test_fixture_store_chunked():
    store = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "fixture_small.zarr")
    _reader_chunks_vs_list(store, "cells")
    _reader_chunks_vs_list(store, "genes")


def test_bm_aging_chunked():
    store = os.path.join(os.environ.get("ANNZARRO_DOCS_DATA", os.path.expanduser("~/gits/annzarro-paper/data")),
                         "bm_aging.zarr")
    if not os.path.isdir(store):
        pytest.skip(f"no {store}")
    _reader_chunks_vs_list(store, "cells")
    _reader_chunks_vs_list(store, "genes")
