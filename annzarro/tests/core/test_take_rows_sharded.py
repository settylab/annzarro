"""A subset read of a sharded zarr 3 array holds the inner chunks it touches, not the shards.

zarr reads a shard's index and then only the inner chunks a selection touches,
but a selection that touches ALL of a shard's inner chunks is read as the whole
shard, and scattered rows touch all of them. anndata 0.13 writes 1 GB shards,
so a 10,000-cell subset could hold a gigabyte per shard in flight. take_rows
reads a sharded array in batches of inner chunks that are never a whole shard.
"""
import sys
import tracemalloc

import numpy as np
import pytest

import annzarro.core.zarr_reader  # noqa: F401  (the package attribute `zarr_reader` is the reader instance)
from annzarro.tests.zarr_compat import ZARR_V3

zr = sys.modules["annzarro.core.zarr_reader"]

sharded_only = pytest.mark.skipif(not ZARR_V3, reason="sharding is zarr format 3")


def _sharded(path, shape, chunks, shards, dtype="float32"):
    import zarr
    a = zarr.create_array(str(path), shape=shape, chunks=chunks, shards=shards, dtype=dtype,
                          zarr_format=3, overwrite=True)
    data = np.random.default_rng(0).random(shape).astype(dtype) if dtype.startswith("f") \
        else np.arange(int(np.prod(shape)), dtype=dtype).reshape(shape)
    a[...] = data
    return zarr.open_array(str(path), mode="r"), data


@sharded_only
@pytest.mark.parametrize("shape, chunks, shards", [
    ((10_000, 3), (100, 3), (400, 3)),      # 4 inner chunks per shard
    ((10_000, 3), (100, 2), (300, 4)),      # shards cut the columns too, ragged edge
    ((10_000, 3), (100, 3), (100, 3)),      # a shard of one inner chunk
    ((10_001,), (64,), (64 * 8,)),          # an obs column
    ((3_000, 40), (100, 8), (400, 16)),     # shards that split the columns, read in column groups
])
@pytest.mark.parametrize("block", [1 << 20, 1 << 10])
def test_sharded_gather_is_array_rows(tmp_path, monkeypatch, shape, chunks, shards, block):
    """Whatever the batching, the result is array[rows] (also unsorted, repeated, and a column subset)."""
    monkeypatch.setattr(zr, "WHOLE_READ_MAX_BYTES", 0)
    monkeypatch.setattr(zr, "GATHER_BLOCK_BYTES", block)
    a, data = _sharded(tmp_path / "a.zarr", shape, chunks, shards)
    rng = np.random.default_rng(1)
    rows = np.concatenate([np.sort(rng.choice(shape[0], 3000, replace=False)), [7, 7, 0, shape[0] - 1]])
    assert np.array_equal(zr.take_rows(a, rows), data[rows])
    shuffled = rng.permutation(rows)
    assert np.array_equal(zr.take_rows(a, shuffled), data[shuffled])
    if len(shape) == 2:
        for cols in ([2, 0], [2, 0, 2], [1], [shape[1] - 1, 0, shape[1] // 2, shape[1] // 2]):
            assert np.array_equal(zr.take_rows(a, rows, cols), data[rows][:, cols])
            assert np.array_equal(zr.take_rows(a, shuffled, cols), data[shuffled][:, cols])
    assert zr.take_rows(a, np.array([], dtype=np.int64)).shape[0] == 0


def _peak(path, rows):
    import zarr
    a = zarr.open_array(str(path), mode="r")
    tracemalloc.start()
    out = zr.take_rows(a, rows)
    peak = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()
    return peak, out


@sharded_only
@pytest.mark.parametrize("inner_per_shard", [32, 1024])
def test_memory_follows_the_inner_chunks_not_the_shard(tmp_path, monkeypatch, inner_per_shard):
    """4M x 4 float32 in inner chunks of 4096 rows (64 KiB), shards of 32 or 1024 of them (2 or 64 MiB),
    80,000 scattered rows: every inner chunk is touched. The peak (5 MiB; 27 and 65 before) is a 1 MiB batch plus the
    result (1.3 MB) and a few decoded chunks, whatever the shard."""
    monkeypatch.setattr(zr, "WHOLE_READ_MAX_BYTES", 0)
    monkeypatch.setattr(zr, "GATHER_BLOCK_BYTES", 1 << 20)
    n, chunk = 1 << 22, 4096
    a, data = _sharded(tmp_path / "a.zarr", (n, 4), (chunk, 4), (chunk * inner_per_shard, 4))
    rows = np.sort(np.random.default_rng(3).choice(n, 80_000, replace=False))
    peak, out = _peak(tmp_path / "a.zarr", rows)
    assert np.array_equal(out, data[rows])
    assert peak < 8 * 2 ** 20, f"peak {peak / 2 ** 20:.1f} MiB with {inner_per_shard} inner chunks per shard"


@sharded_only
def test_a_column_subset_is_budgeted_by_the_stored_chunk_width(tmp_path, monkeypatch):
    """The client reads an obsm matrix two columns at a time (``cols=0,1``), but an inner chunk holds
    every stored column: 64 here. Budgeting by the 2 selected columns made a batch 32x too big
    (the whole 64 MiB shard); by the stored width it is 4 inner chunks of 256 KiB per batch, 8 batches at once (about 14 MiB)."""
    monkeypatch.setattr(zr, "WHOLE_READ_MAX_BYTES", 0)
    monkeypatch.setattr(zr, "GATHER_BLOCK_BYTES", 4 << 20)
    n = 1 << 18
    a, data = _sharded(tmp_path / "a.zarr", (n, 64), (1024, 64), (n, 64))
    rows = np.sort(np.random.default_rng(3).choice(n, 20_000, replace=False))
    import zarr
    tracemalloc.start()
    out = zr.take_rows(zarr.open_array(str(tmp_path / "a.zarr"), mode="r"), rows, [0, 1])
    peak = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()
    assert np.array_equal(out, data[rows][:, [0, 1]])
    assert peak < 20 * 2 ** 20, f"peak {peak / 2 ** 20:.1f} MiB for 2 columns of a 64 MiB shard"


class _Spy:
    """An array that records its orthogonal selections and how many run at once."""

    def __init__(self, array, delay=0.0):
        self.array, self.delay, self.calls, self.running, self.most = array, delay, [], 0, 0
        import threading
        self._lock = threading.Lock()

    def __getattr__(self, name):
        return getattr(self.array, name)

    @property
    def oindex(self):
        spy = self

        class _Indexer:
            def __getitem__(self, sel):
                import time
                with spy._lock:
                    spy.calls.append(sel)
                    spy.running += 1
                    spy.most = max(spy.most, spy.running)
                time.sleep(spy.delay)
                try:
                    return spy.array.oindex[sel]
                finally:
                    with spy._lock:
                        spy.running -= 1
        return _Indexer()


@sharded_only
def test_batches_overlap_up_to_the_bound(tmp_path, monkeypatch):
    """Over a network the requests of different batches must overlap (sequential batches multiplied the
    round trips), but the decoded bytes they hold at once are capped (GATHER_HELD_FACTOR x
    GATHER_BLOCK_BYTES, here 1 MiB of 256 KiB batches: 4), not the number of batches."""
    monkeypatch.setattr(zr, "WHOLE_READ_MAX_BYTES", 0)
    monkeypatch.setattr(zr, "GATHER_BLOCK_BYTES", 1 << 20)
    monkeypatch.setattr(zr, "GATHER_HELD_FACTOR", 1)
    a, data = _sharded(tmp_path / "a.zarr", (1 << 18, 4), (1024, 4), (1 << 18, 4))
    spy = _Spy(a, delay=0.02)
    rows = np.sort(np.random.default_rng(5).choice(1 << 18, 30_000, replace=False))
    assert np.array_equal(zr.take_rows(spy, rows), data[rows])
    assert len(spy.calls) > 4
    assert 1 < spy.most <= 4


def test_unsharded_pairwise_reads_keep_the_single_orthogonal_read(tmp_path, monkeypatch):
    """An obsp row of an unsharded matrix is one ``oindex[rows, cols]``, as before sharding was handled:
    take_rows (a whole read of a small matrix, blocks on zarr 2) made it 5x to 90x slower."""
    import zarr
    from annzarro.core.zarr_reader import ZarrReader
    from annzarro.tests.zarr_compat import open_group
    root = open_group(str(tmp_path / "t.zarr"))
    data = np.random.default_rng(0).random((300, 300)).astype("float32")
    # made here, not by write_array: that one shards every array when the suites run in 3-sharded mode
    if ZARR_V3:
        arr = root.create_array("d", shape=data.shape, dtype=data.dtype, chunks=(30, 30))
        arr[...] = data
    else:
        arr = root.create_dataset("d", data=data, chunks=(30, 30))
    spy = _Spy(arr)

    def boom(*args, **kwargs):
        raise AssertionError("an unsharded pairwise read went through the gather")
    monkeypatch.setattr(zr, "take_rows", boom)
    monkeypatch.setattr(zr, "_take_rows_sharded", boom)
    reader = ZarrReader(enable_caching=False)
    got = reader._read_pairwise(root, "obsp", "d", spy, False, [3, 200], None)
    assert np.array_equal(got, data[[3, 200]])
    got = reader._read_pairwise(root, "obsp", "d", spy, False, [3, 200], [5, 7, 250])
    assert np.array_equal(got, data[[3, 200]][:, [5, 7, 250]])
    assert len(spy.calls) == 2


@sharded_only
@pytest.mark.parametrize("cols", [None, [4, 1]])
def test_sharded_pairwise_reads_gather_by_inner_chunk(tmp_path, monkeypatch, cols):
    """A dense sharded obsp is gathered by inner chunk, whatever its size (no whole read)."""
    from annzarro.core.zarr_reader import ZarrReader
    a, data = _sharded(tmp_path / "a.zarr", (400, 8), (20, 8), (100, 8))
    root = __import__("zarr").open_group(str(tmp_path / "g.zarr"), mode="w", zarr_format=3)
    seen = []
    real = zr._take_rows_sharded
    monkeypatch.setattr(zr, "_take_rows_sharded", lambda *args: seen.append(1) or real(*args))
    rows = [399, 0, 150, 150]
    got = ZarrReader(enable_caching=False)._read_pairwise(root, "obsp", "d", a, False, rows, cols)
    assert seen
    assert np.array_equal(got, data[rows] if cols is None else data[rows][:, cols])


@sharded_only
def test_a_row_band_counts_every_column_shard_it_spans(tmp_path, monkeypatch):
    """Shards that split the columns (a dense X or layer): a row band of 16384 x 4096 float32 in chunks of
    512 x 512 and shards of 4096 x 2048 is 2 column shards (64 MiB), not the 32 MiB of one. Weighing a batch
    by one column shard let 8 batches hold 4x what the budget said; the bytes in flight are capped."""
    monkeypatch.setattr(zr, "WHOLE_READ_MAX_BYTES", 0)
    monkeypatch.setattr(zr, "GATHER_BLOCK_BYTES", 8 << 20)
    a, data = _sharded(tmp_path / "a.zarr", (16384, 4096), (512, 512), (4096, 2048))
    rows = np.sort(np.random.default_rng(9).choice(16384, 300, replace=False))
    peak, out = _peak(tmp_path / "a.zarr", rows)
    assert np.array_equal(out, data[rows])
    # the cap is 16 MiB of decoded chunks, the result 4.9 MB; the compressed bytes come on top (0f75a0d: 147 MiB)
    assert peak < 50 * 2 ** 20, f"peak {peak / 2 ** 20:.1f} MiB"


@sharded_only
def test_concurrent_gathers_share_one_byte_budget(tmp_path, monkeypatch):
    """Requests running at the same time share the pool and the in-flight bytes: the peak of 4 gathers at
    once is not 4 times that of one."""
    import threading
    monkeypatch.setattr(zr, "WHOLE_READ_MAX_BYTES", 0)
    monkeypatch.setattr(zr, "GATHER_BLOCK_BYTES", 2 << 20)
    n = 1 << 21
    a, data = _sharded(tmp_path / "a.zarr", (n, 4), (4096, 4), (n, 4))
    rows = [np.sort(np.random.default_rng(i).choice(n, 40_000, replace=False)) for i in range(4)]
    results = [None] * 4

    def run(i):
        results[i] = zr.take_rows(a, rows[i])
    tracemalloc.start()
    threads = [threading.Thread(target=run, args=(i,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    peak = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()
    for i in range(4):
        assert np.array_equal(results[i], data[rows[i]])
    # 4 results of 640 KB, 4 MiB of decoded chunks in flight, and their compressed bytes
    assert peak < 24 * 2 ** 20, f"peak {peak / 2 ** 20:.1f} MiB for 4 gathers of a 32 MiB shard"
