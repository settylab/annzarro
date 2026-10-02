"""DatasetCache under concurrent threads.

The threaded dev server (``annzarro start``) and any threaded WSGI worker
share one reader, so one DatasetCache, between request threads. Its dicts
were mutated without a lock: an eviction iterating ``_cache_access_times``
or ``_dataset_caches`` while another thread added a key raised
``RuntimeError: dictionary changed size during iteration`` mid-request, and
interleaved add/evict updates left ``memory_usage_mb`` disagreeing with what
the cache held.

It also drifted single-threaded: an evicted or cleared metadata entry was
subtracted as a flat 1 MB whatever it had been charged, and re-adding a key
charged it twice.
"""
import sys
import threading

import numpy as np
import pytest

from annzarro.core.caching import DatasetCache


def _charged(cache):
    """What the cache should be charging for what it actually holds."""
    held = {**cache._matrix_cache, **cache._dataframe_cache, **cache._metadata_cache}
    return sum(cache._estimate_memory_usage(v) for v in held.values()), held


def _check_consistent(cache):
    total, held = _charged(cache)
    assert cache.memory_usage_mb == pytest.approx(total, abs=1e-6)
    tracked = {k for keys in cache._dataset_caches.values() for k in keys}
    assert tracked <= set(held)
    assert set(cache._cache_access_times) == set(held)


@pytest.fixture
def fast_switching():
    old = sys.getswitchinterval()
    sys.setswitchinterval(1e-6)
    yield
    sys.setswitchinterval(old)


def test_concurrent_add_get_evict_clear(fast_switching):
    cache = DatasetCache(max_memory_mb=2, cache_limit=3)
    block = np.ones(32 * 1024, dtype=np.float64)  # 0.25 MB: evictions are constant
    errors = []

    def work(t):
        try:
            for i in range(1500):
                ds = f"ds{(t + i) % 5}"
                kind = ("matrix", "dataframe", "metadata")[i % 3]
                cache._add_to_cache(f"{ds}:{t}:{i % 40}", block, dataset_path=ds, cache_type=kind)
                cache._get_from_cache(f"{ds}:{t}:{(i * 7) % 40}", cache_type=kind)
                if i % 97 == 0:
                    cache.clear_cache(dataset_path=ds)
                if i % 211 == 0:
                    cache.get_cache_info()
        except Exception as e:  # pragma: no cover - the failure being tested
            errors.append(repr(e))

    threads = [threading.Thread(target=work, args=(t,)) for t in range(8)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert errors == []
    _check_consistent(cache)
    assert cache.memory_usage_mb <= cache.max_memory_mb + 1e-6


def test_metadata_is_uncharged_by_what_it_was_charged():
    cache = DatasetCache(max_memory_mb=1000)
    big = {"x": np.ones(1 << 20)}  # 8 MB, cached as metadata
    cache._add_to_cache("m", big, dataset_path="d", cache_type="metadata")
    assert cache.memory_usage_mb == pytest.approx(8, abs=0.01)
    cache.clear_cache(dataset_path="d")
    assert cache.memory_usage_mb == 0


def test_re_adding_a_key_is_charged_once():
    cache = DatasetCache(max_memory_mb=1000)
    arr = np.ones(1 << 17)  # 1 MB
    for _ in range(3):
        cache._add_to_cache("k", arr, dataset_path="d")
    _check_consistent(cache)
    assert cache.memory_usage_mb == pytest.approx(1)
