"""Two waits of the lanes and the ledger that must not end a running job (engine review M9), and the ledger's bound
read from the server setting (M6). The rest of the ledger and the lanes: tests/server/test_compute_stream.py."""
import time

import pytest

from annzarro.server.core import create_app
from annzarro.server.routes import compute_stream as cs
from annzarro.tests.server.test_compute_stream import _threads, _until


def test_a_job_that_gave_way_grows_back_whatever_the_light_lane_holds():
    """After a give-way the job waits for room as long as it takes. Light jobs hold memory for longer than the
    job's own wait, and the job is not told it is busy: SHR-41, no request fails as busy because a longer one runs."""
    ledger = cs.Ledger(100)
    lanes = cs.Lanes(ledger=ledger)
    job = lanes.enter("heavy", 80, 10)
    assert job.running
    job.hold(ledger.reserve(80, 0, "the job"), 0.05)           # a wait of 50 ms to grow back
    other = lanes.enter("heavy", 20, 5)                         # waits: the job gives way to it
    outcome = []

    def run():
        try:
            job.wait()
            outcome.append(job.reservation.nbytes)
        except BaseException as exc:                            # noqa: BLE001 - the test reports what ended the job
            outcome.append(exc)

    with _threads() as spawn:
        spawn(run)
        _until(lambda: job.state == "yielded", what="the give-way")
        light = ledger.reserve(60, 0, "a light resolve")        # holds what the job needs to grow back
        other.leave()                                           # the job's turn comes back
        _until(lambda: job.state == "running", what="the job's turn")
        time.sleep(0.4)                                         # eight times the job's own wait
        assert not outcome, f"the job ended while the light lane held its room: {outcome!r}"
        light.release()
        _until(lambda: outcome, what="the job growing back")
    assert outcome == [80], outcome
    job.reservation.release()
    job.leave()


def test_an_evictable_that_stays_full_does_not_make_a_reservation_spin():
    """The eviction loop looks at the deadline: an evictable that cannot be emptied (pinned entries, a refill from
    another thread) ends the wait in Busy at the time the caller allowed."""
    ledger = cs.Ledger(100)
    held = ledger.reserve(60, 0, "a job")
    calls = []

    def evict():
        calls.append(1)
        if len(calls) > 5000:
            raise RuntimeError("the reservation is spinning on an evictable that stays full")
    ledger.register_evictable("cache", lambda: 50, evict)
    start = time.monotonic()
    with pytest.raises(cs.Busy):
        ledger.reserve(40, 0.2, "a resolve")
    assert 0.15 <= time.monotonic() - start < 3.0
    assert ledger.held() == 60
    held.release()


def test_an_evictable_that_empties_is_still_emptied_for_a_reservation_that_may_not_wait():
    ledger = cs.Ledger(100)
    size = [50]
    ledger.register_evictable("cache", lambda: size[0], lambda: size.__setitem__(0, 0))
    ledger.reserve(80, 0, "a resolve").release()                 # no wait allowed, and the cache was emptied for it
    assert size == [0]


@pytest.fixture
def bound(monkeypatch):
    """The process's ledger as it was, restored after the test."""
    monkeypatch.setattr(cs.LEDGER, "bound", cs.LEDGER.bound)
    monkeypatch.setattr(cs, "CODE_CACHE_BYTES", cs.CODE_CACHE_BYTES)
    return cs.LEDGER


def _app(tmp_path, **config):
    return create_app({"TESTING": True, "data_dir": str(tmp_path), "log_file": str(tmp_path / "t.log"), **config})


def test_the_ledger_bound_is_the_server_setting(tmp_path, bound):
    _app(tmp_path, compute_budget_mb=1024)
    assert cs.LEDGER.bound == 1024 * 2 ** 20
    _app(tmp_path, compute_budget_mb=2048)
    assert cs.LEDGER.bound == 2048 * 2 ** 20                     # a changed setting changes the bound
    _app(tmp_path)
    assert cs.LEDGER.bound == cs.DEFAULT_LEDGER_BYTES == 4608 * 2 ** 20


@pytest.mark.parametrize("value", [0, -5, None, "lots"])
def test_a_setting_that_is_not_a_size_leaves_the_default(tmp_path, bound, value):
    _app(tmp_path, compute_budget_mb=value)
    assert cs.LEDGER.bound == cs.DEFAULT_LEDGER_BYTES


def test_the_ledger_and_the_lanes_share_the_one_bound(tmp_path, bound):
    """The lanes' fit test reads the ledger's bound, so a changed setting moves both."""
    _app(tmp_path, compute_budget_mb=64)
    job = cs.LANES.enter("heavy", 10 ** 12, 0)
    try:
        assert job.full_bytes == 64 * 2 ** 20                    # capped at the configured bound
    finally:
        job.leave()


def test_the_code_cache_size_is_the_server_setting_for_the_cache_step(tmp_path, bound):
    _app(tmp_path, group_code_cache_mb=64)
    assert cs.CODE_CACHE_BYTES == 64 * 2 ** 20
    _app(tmp_path)
    assert cs.CODE_CACHE_BYTES == 512 * 2 ** 20
