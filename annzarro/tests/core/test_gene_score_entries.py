"""``on_entries`` and the pause in the whole-matrix passes of ``gene_score.compute`` (SHR-41, SHR-47).

The entries reported add up to ``result.entries_done``, for every method and layout, with and without the passes that
read the whole matrix (the cells' totals, the genes' means for the control genes). A pause held during such a pass
stops it within one chunk and the numbers are bit-identical with and without pauses.
"""
import itertools

import numpy as np
import pytest

from annzarro.core import gene_score as gs
from annzarro.core import get_reader
from annzarro.tests.core.gene_score_store import BACKENDS, LAYOUTS, gene, make_matrix, make_store, wide_matrix, wide_names

GENES = [gene(i) for i in (0, 4, 8, 9, 10, 12, 15)]
CASES = [("zscore_mean", "detection"), ("mean", "detection"), ("sum", "detection"), ("detected", "detection"),
         ("fraction_of_total", "detection"), ("control_adjusted", "detection"), ("control_adjusted", "mean")]


class Pause:
    def __init__(self, wanted_on):
        self.wanted_on, self.calls, self.waited_at = set(wanted_on), 0, []

    def wanted(self):
        self.calls += 1
        return self.calls in self.wanted_on

    def wait(self):
        self.waited_at.append(self.calls)


@pytest.fixture(scope="module")
def stores(tmp_path_factory):
    base = tmp_path_factory.mktemp("entries")
    out = {}
    for backend, layout in itertools.product(BACKENDS, LAYOUTS):
        suffix = "zarr" if backend == "zarr" else "h5ad"
        out[backend, layout] = make_store(base / f"{layout}_{backend}.{suffix}", wide_matrix(), layout, backend,
                                          var_names=wide_names())
    return out


def run(path, method, binning, **kw):
    reader = get_reader(path)
    recipe = {"genes": [f"W{i:04d}" for i in (0, 4, 8, 9, 10, 12, 15, 30, 31)], "method": method, "controls": 3, "bins": 5}
    p = gs.plan(reader, path, gs.parse_recipe(recipe), binning)
    events, result = [], None
    for kind, payload in gs.compute(p, None, None, **kw):
        if kind == "progress":
            events.append(payload)
        else:
            result = payload
    return p, result, events


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
@pytest.mark.parametrize("method,binning", CASES)
def test_the_entries_reported_add_up_to_entries_done(stores, backend, layout, method, binning):
    told = []
    p, result, events = run(stores[backend, layout], method, binning, on_entries=told.append)
    assert told and all(n >= 0 for n in told)
    assert sum(told) == result.entries_done
    if layout != "csr":                                   # a csr read reports its bound (batch cap), not stored values
        assert result.entries_done == result.entries_read + (p.stat_entries if result.reason is None and
                                                             (method == "fraction_of_total" or (
                                                                 method == "control_adjusted" and p.controls is None))
                                                             else 0)
    _, plain, plain_events = run(stores[backend, layout], method, binning)
    assert plain_events == events
    np.testing.assert_array_equal(plain.values, result.values)
    assert plain.entries_read == result.entries_read


def test_each_read_is_reported_before_the_progress_event_that_counts_it(stores):
    log = []
    reader = get_reader(stores["zarr", "csc"][0] if False else stores["zarr", "csc"])
    path = stores["zarr", "csc"]
    p = gs.plan(reader, path, gs.parse_recipe({"genes": GENES[:3] and [f"W{i:04d}" for i in (0, 4, 8, 9, 10)]}))
    for kind, payload in gs.compute(p, None, None, on_entries=lambda n: log.append(("entries", n))):
        if kind == "progress":
            log.append(("progress", payload[0]))
    done = [i for i, (k, v) in enumerate(log) if k == "progress" and v > 0]
    assert done and all(log[i - 1][0] == "entries" for i in done)


class Counting:
    """Stands in for a zarr array: counts the reads."""

    def __init__(self, array):
        self.array, self.reads = array, 0
        self.shape, self.dtype = array.shape, array.dtype

    def __getitem__(self, item):
        self.reads += 1
        return self.array[item]


@pytest.mark.parametrize("kind", ["mean", "detection"])
def test_a_pause_held_in_the_csr_column_stat_stops_within_one_chunk(stores, monkeypatch, kind):
    path = stores["zarr", "csr"]
    reader = get_reader(path)
    monkeypatch.setattr(gs, "STAT_CHUNK", 1000)
    with gs.open_source(reader, path, "X") as src:
        base = src.column_stat(kind)
        src.group = {"indices": Counting(src.group["indices"]), "data": Counting(src.group["data"])}
        chunks = -(-src.nnz // 1000)
        assert chunks > 6
        pause = Pause({3, 4, 5})
        got = src.column_stat(kind, None, pause)
    np.testing.assert_array_equal(got, base)
    assert pause.waited_at == [3, 4, 5]
    reads = src.group["indices"].reads
    assert reads == chunks                                # nothing read twice, nothing skipped


def test_a_pause_stops_the_pass_before_the_next_chunk_is_read(stores, monkeypatch):
    path = stores["zarr", "csr"]
    monkeypatch.setattr(gs, "STAT_CHUNK", 1000)
    reader = get_reader(path)
    with gs.open_source(reader, path, "X") as src:
        counter = Counting(src.group["indices"])
        src.group = {"indices": counter, "data": src.group["data"]}
        seen = []

        class Held(Pause):
            def wait(self):
                seen.append(counter.reads)
                super().wait()
        src.column_stat("detection", None, Held({3}))
    assert seen == [3]                                    # the third chunk was read; the fourth was not started


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
def test_row_totals_and_column_stat_are_bit_identical_with_pauses(stores, monkeypatch, backend, layout):
    path = stores[backend, layout]
    monkeypatch.setattr(gs, "STAT_CHUNK", 5000)
    monkeypatch.setattr(gs, "BATCH_ENTRIES", 20_000)
    with gs.open_source(get_reader(path), path, "X") as src:
        totals, mean, detection = src.row_totals(), src.column_stat("mean"), src.column_stat("detection")
        for wanted in (range(1, 400), {2}, set()):
            pause = Pause(wanted)
            np.testing.assert_array_equal(src.row_totals(None, pause), totals)
            np.testing.assert_array_equal(src.column_stat("mean", None, pause), mean)
            np.testing.assert_array_equal(src.column_stat("detection", None, pause), detection)
            assert bool(pause.waited_at) == bool(wanted)


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
@pytest.mark.parametrize("method,binning", [("fraction_of_total", "detection"), ("control_adjusted", "mean")])
def test_a_score_with_pauses_in_every_pass_is_bit_identical(stores, monkeypatch, backend, layout, method, binning):
    monkeypatch.setattr(gs, "STAT_CHUNK", 5000)
    path = stores[backend, layout]
    _, base, events = run(path, method, binning)
    pause = Pause(range(1, 2000, 2))
    _, paused, paused_events = run(path, method, binning, pause=pause)
    assert pause.waited_at
    assert paused_events == events
    np.testing.assert_array_equal(paused.values, base.values)
    assert paused.entries_done == base.entries_done
