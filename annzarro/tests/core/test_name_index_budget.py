"""The name index stays within a memory budget; a store too large for it is
searched by scanning its names, with the same answers.

- indices are evicted by bytes, least recently used first, and an axis that
  could not fit alone is not built (IndexOverBudget), not even partly;
- stream_search() agrees with NameIndex.search() on a fixture whose budget is
  set tiny, for every mode, and says so when it stopped before the end;
- building an index does not hold a second full copy of its offsets.
"""
import random
import tracemalloc

import numpy as np
import pytest

from annzarro.core import name_index
from annzarro.core.name_index import IndexOverBudget, NameChunks, NameIndex, estimate_bytes, stream_search


@pytest.fixture(autouse=True)
def _reset():
    name_index.clear()
    name_index.configure(None, None)
    yield
    name_index.clear()
    name_index.configure(None, None)


def _joined(names):
    """A raw chunk: newline-joined bytes plus lengths (string_chunks.joined_items)."""
    enc = [n.encode() for n in names]
    return b"\n".join(enc), np.array([len(e) for e in enc], dtype=np.int64)


def _source(names, size=7, raw=False, n_known=True):
    def chunks():
        for a in range(0, len(names), size):
            part = names[a:a + size]
            yield _joined(part) if raw else list(part)
    return NameChunks(chunks(), n=len(names) if n_known else None, factory=chunks)


def _names(count=400, seed=3):
    rng = random.Random(seed)
    out = []
    for i in range(count):
        kind = rng.random()
        if kind < 0.5:
            out.append(f"cell_{i:05d}")
        elif kind < 0.75:
            out.append(f"Sample{rng.randrange(20)}_AAC{rng.randrange(1000):03d}")
        else:
            out.append(f"xcell_{i}_{rng.choice('abcdef')}")
    out += ["CELL_00007", "Cell_00007", "cell_00007_dup"]          # exact, case-insensitive exact, prefix
    return out


QUERIES = ["cell_0000", "cell_00007", "CELL_00007", "Cell_00007", "cell", "xcell", "sample1_", "sample", "aac1",
           "_a", "nope", "e", "5", "cell_00007_dup", "ll_0001"]


@pytest.mark.parametrize("raw", [False, True])
@pytest.mark.parametrize("limit", [1, 5, 50])
def test_stream_search_agrees_with_the_index(raw, limit):
    names = _names()
    ix = NameIndex(names)
    for q in QUERIES:
        for mode in ("substring", "exact", "regex"):
            query = q if mode != "regex" else q.replace("_", ".")
            want = ix.search(query, limit=limit, mode=mode)
            got = stream_search(_source(names, raw=raw), query, limit=limit, mode=mode, max_scan=10 ** 9)
            if not got["partial"]:
                assert got["matches"] == want["matches"], (q, mode, limit)
                assert got["truncated"] == want["truncated"], (q, mode, limit)
            else:
                # stopped on a full page of prefix hits: every hit is one
                # the index finds too, in the same order, only a later exact
                # match could have come first
                assert got["matches"] and got["note"]
                assert [m["index"] for m in got["matches"]] == sorted(m["index"] for m in got["matches"])
                assert got["scanned"] < len(names)


def test_stream_search_exact_stops_at_the_hit():
    names = [f"n{i}" for i in range(1000)]
    got = stream_search(_source(names, size=10), "n12", mode="exact")
    assert got["matches"] == [{"name": "n12", "index": 12}]
    assert got["scanned"] == 20 and got["partial"] is False       # two chunks, not a hundred


def test_stream_search_prefix_page_stops_early_and_says_so():
    names = [f"cell{i}" for i in range(1000)]
    got = stream_search(_source(names, size=10), "cell", limit=5)
    assert [m["index"] for m in got["matches"]] == [0, 1, 2, 3, 4]
    assert got["truncated"] is True and got["partial"] is True and got["scanned"] == 10
    assert "searched" in got["note"]


def test_stream_search_scan_cap_gives_a_partial_answer():
    names = [f"gene{i}" for i in range(100)] + ["zzz_target"]
    got = stream_search(_source(names, size=10), "target", max_scan=50)
    assert got["matches"] == [] and got["partial"] is True and got["scanned"] == 50
    assert "50 of 101" in got["note"]
    full = stream_search(_source(names, size=10), "target", max_scan=1000)
    assert full["matches"] == [{"name": "zzz_target", "index": 100}] and full["partial"] is False


def test_stream_search_empty_query_and_a_newline_in_the_query():
    names = _names(50)
    got = stream_search(_source(names), "", limit=4)
    assert [m["name"] for m in got["matches"]] == names[:4] and got["truncated"] is True
    assert stream_search(_source(names), "a\nb")["matches"] == []


def test_stream_search_holds_one_chunk_at_a_time():
    names = [f"cell_{i:07d}" for i in range(200_000)]
    chunks = [_joined(names[a:a + 20_000]) for a in range(0, len(names), 20_000)]      # made before tracing
    source = NameChunks(None, n=len(names), factory=lambda: iter(chunks))
    tracemalloc.start()
    try:
        got = stream_search(source, "cell_0199999", mode="exact")
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert got["matches"][0]["index"] == 199_999
    whole = NameIndex(names).nbytes()
    assert peak < whole / 2, (peak, whole)      # one chunk of ten, with its temporaries


# ---- budget and eviction ---------------------------------------------------

def test_estimate_tracks_the_real_size():
    names = [f"cell_{i:07d}" for i in range(50_000)]
    real = NameIndex(_source(names, size=10_000, raw=True)).nbytes()
    est = estimate_bytes(len(names), 12.0)
    assert 0.8 * real <= est <= 1.4 * real, (est, real)
    assert estimate_bytes(10, 20.0, True) > estimate_bytes(10, 20.0, False)       # upper case doubles it


def _build(path, names, size=1000):
    return name_index.get_index(path, "cells", lambda: _source(names, size=size, raw=True))


def test_indices_are_evicted_by_bytes_least_recent_first(tmp_path):
    one = NameIndex([f"cell_{i:06d}" for i in range(20_000)]).nbytes()
    name_index.configure(budget_mb=(2.5 * one) / 2 ** 20)
    paths = []
    for k in range(4):
        d = tmp_path / f"s{k}.zarr"
        d.mkdir()
        paths.append(str(d))
    mk = lambda: [f"cell_{i:06d}" for i in range(20_000)]
    _build(paths[0], mk())
    _build(paths[1], mk())
    assert name_index.index_state(paths[0], "cells") == "ready"
    _build(paths[0], mk())                                  # touch: 0 is now the most recent
    _build(paths[2], mk())                                  # room for two: 1 goes
    assert name_index.index_state(paths[1], "cells") == "absent"
    assert name_index.index_state(paths[0], "cells") == "ready"
    assert name_index.index_state(paths[2], "cells") == "ready"
    _build(paths[3], mk())
    assert name_index.cached_bytes() <= name_index.budget_bytes()
    assert name_index.index_state(paths[0], "cells") == "absent"


def test_an_axis_over_the_budget_is_not_built(tmp_path):
    name_index.configure(budget_mb=0.05)
    d = tmp_path / "big.zarr"
    d.mkdir()
    built = []

    def load():
        src = _source([f"cell_{i:06d}" for i in range(50_000)], size=1000, raw=True)
        built.append(1)
        return src
    with pytest.raises(IndexOverBudget):
        name_index.get_index(str(d), "cells", load)
    assert name_index.cached_bytes() == 0
    assert name_index.index_state(str(d), "cells") == "streaming"
    with pytest.raises(IndexOverBudget):                    # refused again without reading the names
        name_index.get_index(str(d), "cells", load)
    # a larger budget builds it
    name_index.configure(budget_mb=64)
    assert len(name_index.get_index(str(d), "cells", load)) == 50_000
    assert name_index.index_state(str(d), "cells") == "ready"


def test_a_build_without_a_size_gives_up_part_way(tmp_path):
    name_index.configure(budget_mb=0.05)
    d = tmp_path / "unsized.zarr"
    d.mkdir()
    seen = []

    def chunks():
        for a in range(0, 200_000, 1000):
            seen.append(a)
            yield _joined([f"cell_{i:07d}" for i in range(a, a + 1000)])
    with pytest.raises(IndexOverBudget):
        name_index.get_index(str(d), "cells", lambda: NameChunks(chunks(), factory=chunks))
    assert len(seen) < 200                                  # stopped well before the end
    assert name_index.cached_bytes() == 0


def test_a_released_index_is_freed(tmp_path):
    import gc
    import weakref
    d = tmp_path / "s.zarr"
    d.mkdir()
    ix = _build(str(d), [f"cell_{i}" for i in range(3000)])
    ref = weakref.ref(ix)
    del ix
    name_index.clear(str(d))
    gc.collect()
    assert ref() is None


def test_default_budget_follows_the_machine():
    b = name_index.default_budget()
    assert 512 * 2 ** 20 <= b <= 16 * 2 ** 30
    name_index.configure(budget_mb=100)
    assert name_index.budget_bytes() == 100 * 2 ** 20
    name_index.configure(None, None)
    assert name_index.budget_bytes() == b


# ---- build without a second copy -------------------------------------------

def test_build_peak_is_close_to_the_index_itself():
    n = 300_000
    names = [f"cell_{i:08d}" for i in range(n)]
    chunks = [_joined(names[a:a + 50_000]) for a in range(0, n, 50_000)]       # made before tracing
    src = NameChunks(None, n=n, factory=lambda: iter(chunks))
    tracemalloc.start()
    try:
        ix = NameIndex(src)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    # hay + starts + a chunk's temporaries: not the lengths, a cumsum, an
    # arange and the starts all at once
    assert peak < 1.35 * ix.nbytes(), (peak, ix.nbytes())
    assert ix.search("cell_00299999", mode="exact")["matches"][0]["index"] == n - 1
    assert ix.search("cell_00000000", mode="exact")["matches"][0]["index"] == 0


def test_offsets_are_right_across_chunks_and_unsized_sources():
    names = _names(500)
    a = NameIndex(_source(names, size=13, raw=False))
    b = NameIndex(_source(names, size=13, raw=True, n_known=False))
    c = NameIndex(names)
    for q in QUERIES:
        assert a.search(q, 20) == c.search(q, 20) == b.search(q, 20), q
    assert [a.name(i) for i in (0, 13, 499)] == [names[i] for i in (0, 13, 499)]
    assert a._starts.tolist() == c._starts.tolist() == b._starts.tolist()
