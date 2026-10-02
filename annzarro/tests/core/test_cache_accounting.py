"""
DatasetCache.memory_usage_mb counts exactly what it holds.

Entries were counted at their estimated size when added, but metadata was
freed at a fixed 1 MB, and re-adding a key counted it twice, so the figure
(and the memory-limit eviction that uses it) drifted.
"""
import numpy as np
import pytest

from annzarro.core.caching import DatasetCache

BIG = {"columns": ["x" * 1000] * 2000}            # metadata estimated at ~2 MB, not 1
ARRAY = np.zeros((512, 512), dtype="float64")     # 2 MB


def _expected(cache):
    return sum(cache._estimate_memory_usage(v) for c in (cache._matrix_cache, cache._dataframe_cache,
                                                          cache._metadata_cache) for v in c.values())


@pytest.mark.parametrize("kind,value", [("metadata", BIG), ("matrix", ARRAY), ("dataframe", {"a": ARRAY})])
def test_add_then_clear_dataset_returns_to_zero(kind, value):
    cache = DatasetCache(max_memory_mb=1000)
    for i in range(5):
        cache._add_to_cache(f"k{i}", value, dataset_path="/d", cache_type=kind)
    assert cache.memory_usage_mb == pytest.approx(_expected(cache))
    freed = cache.clear_cache("/d")["memory_freed_mb"]
    assert cache.memory_usage_mb == pytest.approx(0)
    assert freed == pytest.approx(5 * cache._estimate_memory_usage(value))


def test_replacing_a_key_is_counted_once():
    cache = DatasetCache(max_memory_mb=1000)
    for _ in range(10):
        cache._add_to_cache("same", ARRAY, dataset_path="/d")
    assert cache.memory_usage_mb == pytest.approx(cache._estimate_memory_usage(ARRAY))


def test_eviction_keeps_the_count_exact():
    size = DatasetCache()._estimate_memory_usage(ARRAY)
    cache = DatasetCache(max_memory_mb=size * 3.5)
    for i in range(10):
        cache._add_to_cache(f"m{i}", ARRAY, dataset_path="/d")
        cache._add_to_cache(f"meta{i}", BIG, dataset_path="/d", cache_type="metadata")
    assert cache.memory_usage_mb <= cache.max_memory_mb
    assert cache.memory_usage_mb == pytest.approx(_expected(cache))
