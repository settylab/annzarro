"""A newer subset request of the same page stops the older one's pass over the rows.

Choosing a subset reads every row's rank key (5-8 s at 1B cells, longer on a
network disk). Stepping through parts asks for part 3, then part 4 before part 3
is computed; the pass for part 3 serves no one. The pass checks between blocks
of rows whether its page has since asked for another subset (core/subset.py
claim), and stops. Another page's request, the same subset again, and a
request that names no page never stop it.
"""
import threading

import numpy as np
import pytest

from annzarro.core import subset as cell_subset
from annzarro.core.subset import SubsetSpec, SubsetSuperseded

N = 40_000
BLOCK = 1000        # 40 blocks per pass


class _Reader:
    """Just enough reader for get_subset: the cell count and no obs columns."""

    def get_metadata(self, dataset_path):
        return {"shape": (N, 3), "obs": {"columns": []}}

    def get_obs_var(self, **kwargs):
        raise AssertionError("no column is read for an unfiltered subset")


@pytest.fixture(autouse=True)
def small_blocks(monkeypatch):
    monkeypatch.setattr(cell_subset._rank_window, "__defaults__", (BLOCK,))
    cell_subset.clear()
    cell_subset._claims.clear()
    yield
    cell_subset.clear()
    cell_subset._claims.clear()


class _Gate:
    """Lets a pass run to its second block, then holds it until released."""

    def __init__(self, monkeypatch):
        self.reached = threading.Event()
        self.release = threading.Event()
        self.blocks = 0
        real = cell_subset._block_rows

        def blocks(n_obs, eligible, block=cell_subset._KEY_BLOCK):
            for item in real(n_obs, eligible, block):
                self.blocks += 1
                if self.blocks == 2:
                    self.reached.set()
                    assert self.release.wait(10), "the test never released the pass"
                yield item

        monkeypatch.setattr(cell_subset, "_block_rows", blocks)


def _spec(part):
    return SubsetSpec(n=100, seed=0, part=part)


def _run(part, client="page-1", low=False, out=None):
    try:
        out["subset"] = cell_subset.get_subset(_Reader(), "/d.zarr", _spec(part), client=client, low=low)
    except SubsetSuperseded as exc:
        out["error"] = exc


def _in_thread(*args, **kwargs):
    out = {}
    t = threading.Thread(target=_run, args=args, kwargs={**kwargs, "out": out})
    t.start()
    return t, out


def test_a_newer_subset_of_the_same_page_stops_the_pass(monkeypatch):
    gate = _Gate(monkeypatch)
    t, out = _in_thread(3)
    assert gate.reached.wait(10)
    cell_subset.claim("page-1", "/d.zarr", _spec(4).key())      # the page asks for part 4
    gate.release.set()
    t.join(10)
    assert "error" in out and out["error"].status == 409 and out["error"].reason == "subset_superseded"
    assert gate.blocks < N // BLOCK, "the pass went on over every row"


def test_the_same_subset_asked_again_or_by_another_page_does_not_stop_it(monkeypatch):
    gate = _Gate(monkeypatch)
    t, out = _in_thread(3)
    assert gate.reached.wait(10)
    cell_subset.claim("page-1", "/d.zarr", _spec(3).key())      # the same part again
    cell_subset.claim("page-2", "/d.zarr", _spec(5).key())      # another tab
    cell_subset.claim(None, "/d.zarr", _spec(5).key())          # no page named
    cell_subset.claim("page-1", "/other.zarr", _spec(5).key())  # another dataset
    gate.release.set()
    t.join(10)
    assert "subset" in out and len(out["subset"]) == 100
    assert gate.blocks == N // BLOCK


def test_a_request_without_a_page_is_never_stopped(monkeypatch):
    gate = _Gate(monkeypatch)
    t, out = _in_thread(3, client=None)
    assert gate.reached.wait(10)
    cell_subset.claim("page-1", "/d.zarr", _spec(4).key())
    gate.release.set()
    t.join(10)
    assert "subset" in out


def test_a_prefetch_is_stopped_by_any_real_request_and_stops_nothing(monkeypatch):
    gate = _Gate(monkeypatch)
    t, out = _in_thread(4, low=True)
    assert gate.reached.wait(10)
    cell_subset.claim("page-1", "/d.zarr", _spec(3).key())      # the page asks for a part
    gate.release.set()
    t.join(10)
    assert "error" in out, "the prefetch went on while a part was asked for"

    cell_subset.clear()
    gate = _Gate(monkeypatch)
    t, out = _in_thread(3)                                     # a real request
    assert gate.reached.wait(10)
    cell_subset.claim("page-1", "/d.zarr", _spec(9).key(), low=True)     # a prefetch beside it
    gate.release.set()
    t.join(10)
    assert "subset" in out, "a prefetch stopped the part being loaded"


def test_a_stopped_pass_leaves_nothing_cached_and_the_next_asks_again():
    cell_subset._claims[("page-1", "/d.zarr")] = (10 ** 9, "newer")
    # a check that raised leaves no half result: computing again works
    again = cell_subset.get_subset(_Reader(), "/d.zarr", _spec(2))
    assert len(again) == 100 and np.all(np.diff(again.indices) > 0)


def test_the_claims_stay_few():
    for i in range(cell_subset._CLAIMS_MAX + 50):
        cell_subset.claim(f"page-{i}", "/d.zarr", "k")
    assert len(cell_subset._claims) == cell_subset._CLAIMS_MAX
