"""One requester cannot flush everyone's cell subsets, nor take every place.

The subset cache held 16 subsets in plain LRU order, so one requester asking
for new seeds (any of 2^32) or filters evicted every other user's subsets,
and one filter keeping every cell of a 20M-cell store (the newest subset was
always kept) emptied the whole cache in one request. SubsetCache keeps the
same budget but evicts from the requester charged the most; with one
requester (the desktop: requester None) it is exactly the old LRU.
"""
import random
import threading
import time
from collections import OrderedDict

import pytest

from annzarro.core import subset as cs
from annzarro.core.read_guard import ReadBusyError

M = 1_000_000


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def _cache(clock=None, **kwargs):
    # values are their own size in cells, so a 20M-cell subset costs no memory here
    return cs.SubsetCache(size=lambda cells: cells, clock=clock or Clock(), **kwargs)


def _put(cache, key, owner, cells=100_000):
    if cache.get(key, owner) is None:
        cache.put(key, cells, owner)


# -- one requester: the old LRU -----------------------------------------------

def _old_lru(ops, max_entries=16, max_cells=20 * M):
    """The 0.4.3 rule: LRU, the newest always kept; returns the keys after each op."""
    cache, seen = OrderedDict(), []
    for key, cells in ops:
        if key in cache:
            cache.move_to_end(key)
        else:
            cache[key] = cells
            while len(cache) > 1 and (len(cache) > max_entries or sum(cache.values()) > max_cells):
                cache.popitem(last=False)
        seen.append(list(cache))
    return seen


def test_one_requester_is_exactly_the_old_lru():
    """The desktop (requester None) and a hosted server with one user: no
    entry is kept or evicted differently from 0.4.3, so no hit rate changes."""
    rng = random.Random(0)
    ops = [(f"s{rng.randrange(40)}", rng.choice([100_000, 100_000, 2 * M, 9 * M, 20 * M]))
           for _ in range(3000)]
    for owner in (None, "203.0.113.9"):
        clock = Clock()
        cache = _cache(clock)
        seen = []
        for key, cells in ops:
            clock.now += rng.uniform(0, 900)          # pins lapse and are renewed
            _put(cache, key, owner, cells)
            seen.append(list(cache.keys()))
        assert seen == _old_lru(ops)


# -- several requesters -------------------------------------------------------

def test_stepping_through_seeds_evicts_only_the_steppers_subsets():
    cache = _cache()
    for i in range(3):
        _put(cache, f"bob/{i}", "bob")
    for seed in range(200):
        _put(cache, f"eve/seed{seed}", "eve")
        assert len(cache) <= 16
    assert all(f"bob/{i}" in cache for i in range(3))
    assert "eve/seed199" in cache
    # under the old LRU bob's subsets were gone after 16 of eve's
    assert not any(k.startswith("bob/") for k in _old_lru(
        [(f"bob/{i}", 100_000) for i in range(3)] + [(f"eve/seed{s}", 100_000) for s in range(200)])[-1])


def test_a_subset_of_every_cell_no_longer_flushes_the_cache():
    """A filter keeping all 20M cells is the whole cell budget: in 0.4.3 the
    newest is always kept, so one request evicted every other subset."""
    clock = Clock()
    cache = _cache(clock)
    for i in range(5):
        _put(cache, f"bob/{i}", "bob")
    _put(cache, "eve/all", "eve", 20 * M)
    assert all(f"bob/{i}" in cache for i in range(5))
    assert "eve/all" not in cache                     # served, not kept
    assert sum(cache.values()) <= 20 * M


def test_a_large_subset_is_kept_once_the_others_have_gone_quiet():
    """Subsets nobody used for the pin time are anybody's to evict: a big
    filter is not refused a place by an idle user's leftovers."""
    clock = Clock()
    cache = _cache(clock)
    for i in range(5):
        _put(cache, f"bob/{i}", "bob")
    clock.now += cs.PIN_S + 1
    _put(cache, "ann/all", "ann", 20 * M)
    assert list(cache.keys()) == ["ann/all"]


def test_the_subset_a_requester_is_looking_at_is_pinned():
    """bob's current subset is the default one he shares with eve; eve's own
    flood evicts her share of everything else, not what bob is looking at."""
    clock = Clock()
    cache = _cache(clock)
    _put(cache, "auto", "eve")
    _put(cache, "auto", "bob")
    for seed in range(100):
        clock.now += 1
        _put(cache, f"eve/seed{seed}", "eve")
    assert "auto" in cache
    # once bob has gone (no use for the pin time), it is an old entry like any other
    clock.now += cs.PIN_S + 1
    for seed in range(100, 120):
        _put(cache, f"eve/seed{seed}", "eve")
    assert "auto" not in cache


def test_a_shared_subset_is_charged_to_each_requester_in_part():
    cache = _cache()
    _put(cache, "auto", "bob")
    _put(cache, "auto", "eve")
    _put(cache, "eve/1", "eve")
    _put(cache, "big", "bob", 5 * M)                  # 4 slots of 1.25M cells
    assert cache.charges() == {"bob": pytest.approx(4.5), "eve": pytest.approx(1.5)}


def test_the_heaviest_requester_loses_first():
    cache = _cache()
    for i in range(6):
        _put(cache, f"bob/{i}", "bob")
    for i in range(10):
        _put(cache, f"ann/{i}", "ann")
    _put(cache, "eve/0", "eve")                       # 17 entries: ann holds the most
    assert "ann/0" not in cache
    assert all(f"bob/{i}" in cache for i in range(6)) and "eve/0" in cache


def test_the_requesters_remembered_are_bounded():
    cache = _cache()
    for i in range(3 * cs.MAX_REQUESTERS):
        _put(cache, f"k{i % 20}", f"203.0.113.{i}")
    assert len(cache._latest) <= cs.MAX_REQUESTERS


# -- the compute places -------------------------------------------------------

def _hold(places, owner):
    """Take a place for ``owner`` on a thread; returns (got, release)."""
    got, release = threading.Event(), threading.Event()
    errors = []

    def run():
        try:
            with places.take(owner):
                got.set()
                release.wait(5)
        except ReadBusyError as exc:
            errors.append(exc)
            got.set()

    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.errors = errors
    return got, release, t


def test_one_requester_alone_gets_every_place():
    places = cs.SubsetPlaces(2, wait_s=0.05, share_pct=50)
    with places.take("ann"):
        with places.take("ann"):                      # nobody else waits: no share
            pass


def test_a_freed_place_goes_to_the_requester_under_its_share():
    places = cs.SubsetPlaces(2, wait_s=5, share_pct=50)
    a1, ra1, _ = _hold(places, "ann")
    a2, ra2, _ = _hold(places, "ann")
    assert a1.wait(2) and a2.wait(2)                  # ann alone: both places
    b, rb, tb = _hold(places, "bob")
    time.sleep(0.1)
    a3, ra3, ta3 = _hold(places, "ann")
    time.sleep(0.1)
    assert not b.is_set() and not a3.is_set()
    ra1.set()                                          # one place frees: bob's, not ann's third
    assert b.wait(2) and not tb.errors
    time.sleep(0.1)
    assert not a3.is_set()
    rb.set()
    assert a3.wait(2) and not ta3.errors
    for r in (ra2, ra3):
        r.set()


def test_a_requester_may_have_one_request_waiting():
    """Otherwise one requester parks every thread of a worker in the wait."""
    places = cs.SubsetPlaces(1, wait_s=5, share_pct=50)
    held, release, _ = _hold(places, "eve")
    assert held.wait(2)
    waiting, release_w, _ = _hold(places, "eve")
    time.sleep(0.1)
    t = time.monotonic()
    with pytest.raises(ReadBusyError, match="already waiting"):
        with places.take("eve"):
            pass
    assert time.monotonic() - t < 1
    release.set()
    assert waiting.wait(2)
    release_w.set()


def test_reads_outside_a_request_have_no_share_and_may_all_wait():
    places = cs.SubsetPlaces(1, wait_s=5, share_pct=50)
    held, release, _ = _hold(places, None)
    assert held.wait(2)
    w1, r1, t1 = _hold(places, None)
    w2, r2, t2 = _hold(places, None)
    time.sleep(0.1)
    assert not w1.is_set() and not w2.is_set()
    for r in (release, r1, r2):
        r.set()
    assert w1.wait(2) and w2.wait(2) and not t1.errors and not t2.errors


def test_the_share_is_at_least_one_place_and_zero_turns_it_off():
    assert cs.SubsetPlaces(2, wait_s=1, share_pct=50).share == 1
    assert cs.SubsetPlaces(2, wait_s=1, share_pct=10).share == 1
    assert cs.SubsetPlaces(8, wait_s=1, share_pct=50).share == 4
    assert cs.SubsetPlaces(2, wait_s=1, share_pct=0).share == 2
    assert cs.SubsetPlaces(2, wait_s=1, share_pct=100).share == 2


def test_over_its_share_a_requester_is_refused_with_the_setting_named():
    places = cs.SubsetPlaces(2, wait_s=0.2, share_pct=50)
    a1, ra1, _ = _hold(places, "ann")
    a2, ra2, _ = _hold(places, "ann")
    assert a1.wait(2) and a2.wait(2)
    b, rb, tb = _hold(places, "bob")
    assert b.wait(2)                                   # bob waited 0.2 s, then 503
    assert tb.errors and "subset_budget_mb" in str(tb.errors[0])
    for r in (ra1, ra2, rb):
        r.set()
