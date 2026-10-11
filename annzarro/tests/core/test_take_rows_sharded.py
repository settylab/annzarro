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

pytestmark = pytest.mark.skipif(not ZARR_V3, reason="sharding is zarr format 3")


def _sharded(path, shape, chunks, shards, dtype="float32"):
    import zarr
    a = zarr.create_array(str(path), shape=shape, chunks=chunks, shards=shards, dtype=dtype,
                          zarr_format=3, overwrite=True)
    data = np.random.default_rng(0).random(shape).astype(dtype) if dtype.startswith("f") \
        else np.arange(int(np.prod(shape)), dtype=dtype).reshape(shape)
    a[...] = data
    return zarr.open_array(str(path), mode="r"), data


@pytest.mark.parametrize("shape, chunks, shards", [
    ((10_000, 3), (100, 3), (400, 3)),      # 4 inner chunks per shard
    ((10_000, 3), (100, 2), (300, 4)),      # shards cut the columns too, ragged edge
    ((10_000, 3), (100, 3), (100, 3)),      # a shard of one inner chunk
    ((10_001,), (64,), (64 * 8,)),          # an obs column
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
        cols = [2, 0]
        assert np.array_equal(zr.take_rows(a, rows, cols), data[rows][:, cols])
    assert zr.take_rows(a, np.array([], dtype=np.int64)).shape[0] == 0


def _peak(path, rows):
    import zarr
    a = zarr.open_array(str(path), mode="r")
    tracemalloc.start()
    out = zr.take_rows(a, rows)
    peak = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()
    return peak, out


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
