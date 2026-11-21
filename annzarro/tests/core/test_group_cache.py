"""The code cache of a worker (annzarro/core/group_cache.py; SHR-40, CMP-6, PER-3).

What the route makes of it (hit and miss in the first frame, the ledger, a session opening with dependants) is in
tests/server/test_cell_groups_cache.py; these tests cover the cache on its own: the key, the budget and the ledger's
room, least recently used first out, the histograms kept beside the codes, and claims.
"""
import threading

import numpy as np
import pytest

from annzarro.core import freshness
from annzarro.core import group_cache as gc
from annzarro.core.cell_groups import GroupingResult

N = 1000


def result(n=N, groups=3, histogram=None, seed=0):
    codes = (np.arange(n) % groups).astype(np.uint8)
    parts = [{"kind": "categorical", "levels": [{"id": f"c:{i}", "n": int((codes == i).sum())} for i in range(groups)]},
             {"kind": "binned", "levels": [{"id": "bin:0", "n": n}], "edges": [0.0, 1.0]}]
    if histogram is not None:
        parts[1]["histogram"] = histogram
    return GroupingResult(n_shown=n, n_grouped=n, groups=[{"key": [f"c:{i}"], "n": int((codes == i).sum())}
                                                          for i in range(groups)],
                          partitionings=parts, codes=codes, small={"threshold": 10, "mode": "keep", "n_small": 0})


def key(name="a", fingerprint="f1", cache_key="k1", n=N):
    return gc.Key(name, fingerprint, cache_key, n)


def cache(budget=1 << 20, room=None):
    return gc.GroupCache(budget=lambda: budget, room=room)


def fill(c, k, r=None, asked=()):
    claim = c.begin(k, asked)
    assert isinstance(claim, gc.Claim)
    assert claim.fill(r if r is not None else result())
    return claim


# --- the key --------------------------------------------------------------------------------------------------------

def test_a_kept_grouping_is_a_hit_with_its_codes(tmp_path):
    c = cache()
    r = result()
    fill(c, key(), r)
    hit = c.begin(key())
    assert isinstance(hit, gc.Hit)
    np.testing.assert_array_equal(hit.result.codes, r.codes)
    assert hit.result.groups == r.groups and hit.result.n_grouped == N
    assert c.stats["hits"] == 1 and c.stats["misses"] == 1


@pytest.mark.parametrize("other", [key(name="b"), key(fingerprint="f2"), key(cache_key="k2"), key(n=N - 1)],
                         ids=["another dataset", "a moved fingerprint", "another recipe", "other cells shown"])
def test_a_key_that_differs_in_any_part_misses(other):
    c = cache()
    fill(c, key())
    assert isinstance(c.begin(other), gc.Claim)


def test_a_moved_fingerprint_drops_the_datasets_entries_and_only_its(tmp_path):
    c = cache()
    fill(c, key("a", "f1", "k1"))
    fill(c, key("a", "f1", "k2"))
    fill(c, key("b", "f1", "k1"))
    held = c.size()
    assert len(c) == 3
    assert isinstance(c.begin(key("a", "f2", "k1")), gc.Claim)
    assert len(c) == 1 and isinstance(c.begin(key("b", "f1", "k1")), gc.Hit)
    assert 0 < c.size() < held


def test_the_key_is_the_real_path_and_the_freshness_token(tmp_path):
    store = tmp_path / "s.zarr"
    store.mkdir()
    (store / ".zgroup").write_text("{}")
    link = tmp_path / "link.zarr"
    link.symlink_to(store)
    k = gc.key_of(str(link), "abc", N)
    assert k.dataset == str(store.resolve()) and k.cache_key == "abc" and k.n_shown == N
    assert k.fingerprint == freshness.token(str(link))
    freshness.bump(str(store), reason="refresh")                   # what a Refresh that found a change does
    moved = gc.key_of(str(store), "abc", N)
    assert moved.dataset == k.dataset and moved.fingerprint != k.fingerprint


def test_a_store_without_a_fingerprint_is_not_cached(tmp_path):
    assert gc.key_of(str(tmp_path / "missing.zarr"), "abc", N) is None


# --- what is held, and how much -------------------------------------------------------------------------------------

def test_it_holds_codes_and_the_grouping_table_only_and_the_codes_are_read_only():
    c = cache()
    r = result()
    fill(c, key(), r)
    held = c.begin(key()).result
    assert isinstance(held, GroupingResult)
    assert held.codes is r.codes and not held.codes.flags.writeable
    with pytest.raises(ValueError):
        held.codes[0] = 1
    assert r.codes.nbytes <= c.size() < r.codes.nbytes + 4096


def test_a_refused_grouping_or_one_without_codes_is_not_kept():
    c = cache()
    refused = GroupingResult(n_shown=N, refused={"reason": "too_many_groups", "count": 3000, "limit": 2000})
    assert not c.begin(key()).fill(refused)
    assert not c.begin(key()).fill(GroupingResult(n_shown=N))
    assert len(c) == 0 and c.size() == 0


def test_the_least_recently_used_leaves_first_within_the_budget():
    one = result()
    c = cache(budget=3 * one.codes.nbytes + 1024)
    for name in "abc":
        fill(c, key(name))
    assert isinstance(c.begin(key("a")), gc.Hit)                  # a is now the most recent
    fill(c, key("d"))
    assert len(c) == 3
    assert isinstance(c.begin(key("b")), gc.Claim)                # b was the least recent
    assert all(isinstance(c.begin(key(n)), gc.Hit) for n in "acd")
    assert c.size() <= 3 * one.codes.nbytes + 1024


def test_a_grouping_larger_than_the_budget_is_not_kept_and_keeps_the_others():
    c = cache(budget=2 * N + 2048)
    fill(c, key("a"))
    assert not c.begin(key("big", n=10 * N)).fill(result(n=10 * N))
    assert isinstance(c.begin(key("a")), gc.Hit)


def test_the_budget_is_read_on_every_store():
    budget = [1 << 20]
    c = gc.GroupCache(budget=lambda: budget[0])
    fill(c, key("a"))
    one = c.size()
    budget[0] = 10                                                   # the setting changed: nothing more fits
    assert not c.begin(key("b")).fill(result())
    assert isinstance(c.begin(key("a")), gc.Hit)                    # and what never fits evicts nothing
    budget[0] = one + 10
    fill(c, key("c"))
    assert len(c) == 1 and isinstance(c.begin(key("c")), gc.Hit)  # one that fits makes room under the new size


def test_a_grouping_is_kept_only_in_the_room_the_ledger_has_left():
    room = [1 << 20]
    c = cache(room=lambda: room[0])
    fill(c, key("a"))
    room[0] = c.size() - 1                                           # the ledger is nearly full
    assert not c.begin(key("b")).fill(result())
    assert isinstance(c.begin(key("a")), gc.Hit)
    room[0] = c.size()                                               # room for what is held, or for one other
    fill(c, key("c"))
    assert len(c) == 1 and isinstance(c.begin(key("c")), gc.Hit)


def test_clear_empties_it():
    c = cache()
    fill(c, key("a"))
    fill(c, key("b"))
    c.clear()
    assert c.size() == 0 and len(c) == 0 and isinstance(c.begin(key("a")), gc.Claim)


# --- histograms, kept outside the codes ------------------------------------------------------------------------------

HIST = {"lo": 0.0, "hi": 1.0, "counts": [5, 5], "zero_share": 0.1}


def test_a_hit_carries_exactly_the_histograms_asked_for():
    c = cache()
    fill(c, key(), result(histogram=HIST), asked=(1,))
    plain = c.begin(key()).result
    assert all("histogram" not in p for p in plain.partitionings)
    asked = c.begin(key(), (1,)).result
    assert asked.partitionings[1]["histogram"] == HIST and "histogram" not in asked.partitionings[0]
    assert all("histogram" not in p for p in c.begin(key()).result.partitionings)   # the held table is unchanged


def test_a_histogram_not_held_is_a_miss_and_its_resolve_adds_it():
    c = cache()
    fill(c, key())                                                   # resolved without histograms
    claim = c.begin(key(), (1,))
    assert isinstance(claim, gc.Claim)
    claim.fill(result(histogram=HIST))
    assert c.begin(key(), (1,)).result.partitionings[1]["histogram"] == HIST
    assert isinstance(c.begin(key()), gc.Hit) and len(c) == 1


def test_histograms_from_two_resolves_are_merged():
    c = cache()
    first = result()
    first.partitionings[0]["histogram"] = {"counts": [1]}
    fill(c, key(), first, asked=(0,))
    c.begin(key(), (1,)).fill(result(histogram=HIST))
    both = c.begin(key(), (0, 1))
    assert isinstance(both, gc.Hit)
    assert both.result.partitionings[0]["histogram"] == {"counts": [1]}
    assert both.result.partitionings[1]["histogram"] == HIST


# --- claims ---------------------------------------------------------------------------------------------------------

def test_a_grouping_being_resolved_for_a_prompt_reply_is_waited_for():
    c = cache()
    claim = c.begin(key(), (1,), prompt=True)
    assert isinstance(claim, gc.Claim)
    pending = c.begin(key())
    assert isinstance(pending, gc.Pending) and not pending.wait(0.01)
    threading.Timer(0.05, lambda: claim.fill(result(histogram=HIST))).start()
    assert pending.wait(5)
    assert isinstance(c.begin(key()), gc.Hit)


def test_a_claim_is_not_waited_for_when_its_reply_reads_more_or_it_lacks_a_histogram():
    c = cache()
    c.begin(key(), prompt=False)                                     # a dependant: features after its resolve
    assert isinstance(c.begin(key()), gc.Claim)
    c2 = cache()
    c2.begin(key(), prompt=True)                                     # prompt, but without the histogram asked
    assert isinstance(c2.begin(key(), (1,)), gc.Claim)


def test_an_abandoned_claim_wakes_its_waiters_and_one_of_them_claims_next():
    c = cache()
    claim = c.begin(key(), prompt=True)
    pending = c.begin(key())
    with claim:
        pass                                                         # failed, closed or refused: never filled
    assert pending.wait(0)
    nxt = c.begin(key())
    assert isinstance(nxt, gc.Claim)
    assert isinstance(c.begin(key()), gc.Claim)                     # not prompt: the next request resolves too


def test_a_refused_fill_ends_the_claim_too():
    c = cache()
    claim = c.begin(key(), prompt=True)
    pending = c.begin(key())
    assert not claim.fill(GroupingResult(n_shown=N, refused={"reason": "too_many_groups"}))
    assert pending.wait(0) and isinstance(c.begin(key()), gc.Claim)
