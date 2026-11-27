"""The score pipeline's ``pause`` hook (SHR-41): a heavy job frees its read-ahead before it gives way.

With ``pause=None`` nothing changes (every other ``test_gene_score*.py`` runs without it). With a pause wanted
mid-run, no read is in flight when ``wait()`` is called, nothing is read twice, and the result is bit-identical to
an unpaused run.
"""
import itertools
import threading

import numpy as np
import pytest

from annzarro.core import gene_score as gs
from annzarro.core import get_reader
from annzarro.tests.core.gene_score_store import BACKENDS, LAYOUTS, gene, make_matrix, make_store


class Pause:
    """Wants a pause on the listed calls of ``wanted()``; ``wait()`` checks that nothing is in flight."""

    def __init__(self, tracker, wanted_on):
        self.tracker, self.wanted_on = tracker, set(wanted_on)
        self.calls = 0
        self.waits = []

    def wanted(self):
        self.calls += 1
        return self.calls in self.wanted_on

    def wait(self):
        self.waits.append(self.tracker.in_flight())


class Tracker:
    """Counts reads started and tasks handed out; in flight is the difference."""

    def __init__(self, n):
        self.lock = threading.Lock()
        self.started = [0] * n
        self.handed = 0

    def task(self, i, entries=10):
        def read():
            with self.lock:
                self.started[i] += 1
            return [(i, None, np.full(3, float(i), dtype=np.float32))]
        return gs._Task([i], entries, read)

    def in_flight(self):
        with self.lock:
            return sum(self.started) - self.handed


def run_pipeline(n, pause_on, threads=4, budget=1_000):
    tracker = Tracker(n)
    pause = Pause(tracker, pause_on)
    out = []
    for task, result, _ in gs.pipeline([tracker.task(i) for i in range(n)], threads, budget, pause):
        tracker.handed += 1
        out.append((task.cols[0], float(result[0][2][0])))
    return tracker, pause, out


@pytest.mark.parametrize("pause_on", [(), (1,), (2,), (3, 6), (1, 2, 3, 4, 5, 6, 7, 8), tuple(range(1, 60))])
def test_nothing_is_in_flight_when_a_pause_waits(pause_on):
    tracker, pause, out = run_pipeline(30, pause_on)
    assert bool(pause.waits) == bool(pause_on), "a wanted pause must wait, and only then"
    assert all(n == 0 for n in pause.waits)
    assert tracker.started == [1] * 30                    # no task read twice, none skipped
    assert out == [(i, float(i)) for i in range(30)]     # order kept


def test_without_a_pause_the_pipeline_reads_ahead_as_before():
    tracker = Tracker(30)
    seen = []
    for _ in gs.pipeline([tracker.task(i) for i in range(30)], 4, 1_000):
        seen.append(tracker.in_flight())
        tracker.handed += 1
    assert max(seen) > 1                                  # it does read ahead
    assert tracker.started == [1] * 30


def test_a_pause_that_is_never_wanted_changes_nothing():
    tracker, pause, out = run_pipeline(12, ())
    assert pause.waits == []
    assert tracker.started == [1] * 12


def test_a_pause_wanted_after_the_last_task_does_not_wait():
    tracker, pause, _ = run_pipeline(5, (50,))
    assert pause.waits == []


def test_pause_wanted_before_the_first_read_waits_with_nothing_started():
    tracker, pause, _ = run_pipeline(6, (1,))
    assert pause.waits[0] == 0


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
@pytest.mark.parametrize("method", ["zscore_mean", "control_adjusted"])
def test_a_paused_score_is_bit_identical(tmp_path, backend, layout, method):
    x = make_matrix()
    suffix = "zarr" if backend == "zarr" else "h5ad"
    path = make_store(tmp_path / f"s.{suffix}", x, layout, backend)
    reader = get_reader(path)
    recipe = {"genes": [gene(i) for i in (0, 4, 8, 9, 10, 12, 15)], "method": method, "controls": 2, "bins": 3}
    plan = gs.plan(reader, path, gs.parse_recipe(recipe))

    def run(pause):
        events, result = [], None
        for kind, payload in gs.compute(plan, None, None, pause):
            if kind == "progress":
                events.append(payload)
            else:
                result = payload
        return events, result

    base_events, base = run(None)
    tracker = Tracker(1)
    pause = Pause(tracker, range(1, 400, 2))
    pause_events, paused = run(pause)
    assert pause.waits
    assert pause_events == base_events
    np.testing.assert_array_equal(paused.values, base.values)
    assert paused.entries_read == base.entries_read
    assert [g.name for g in paused.genes] == [g.name for g in base.genes]
