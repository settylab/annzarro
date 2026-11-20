"""The compute routes' shared plumbing (annzarro/server/routes/compute_stream.py): lanes, the ledger, blocks.

Lanes and the ledger are driven directly, with threads. Every thread a test starts is joined before the test ends,
on every way out (``_threads``); a test that would hang fails at its join timeout instead.
"""
import contextlib
import random
import threading
import time

import numpy as np
import pytest

from annzarro.server.routes import compute_stream as cs

JOIN_S = 20


@contextlib.contextmanager
def _threads():
    """Start threads through ``spawn``; all are joined on the way out, and one still alive fails the test."""
    started = []

    def spawn(fn, *args):
        t = threading.Thread(target=fn, args=args, daemon=True)
        started.append(t)
        t.start()
        return t
    try:
        yield spawn
    finally:
        deadline = time.monotonic() + JOIN_S
        for t in started:
            t.join(max(deadline - time.monotonic(), 0.01))
        alive = [t for t in started if t.is_alive()]
        assert not alive, f"{len(alive)} thread(s) outlived the test"


def _until(cond, timeout=5.0, what="the condition"):
    deadline = time.monotonic() + timeout
    while not cond():
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out waiting for {what}")
        time.sleep(0.005)


class Clock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


# --- blocks --------------------------------------------------------------------------------------------------

def test_blocks_are_little_endian_c_ordered_one_after_another(monkeypatch):
    monkeypatch.setattr(cs, "WRITE_CHUNK", 7)
    a = np.arange(5, dtype=np.uint8)
    b = np.arange(6, dtype=">f8").reshape(2, 3)          # big-endian in memory: written little-endian
    c = np.asfortranarray(np.arange(6, dtype=np.uint32).reshape(2, 3))
    pieces = list(cs.block_bytes([a, b, c]))
    assert all(0 < len(p) <= 7 for p in pieces)
    data = b"".join(pieces)
    want = a.tobytes() + np.arange(6, dtype="<f8").tobytes() + np.arange(6, dtype="<u4").tobytes()
    assert data == want
    assert cs.block("codes", a) == {"name": "codes", "dtype": "uint8", "length": 5}
    assert cs.block("m", np.zeros((2, 28, 5))) == {"name": "m", "dtype": "float64", "length": 280, "shape": [2, 28, 5]}


def test_a_frame_refuses_numbers_that_are_not_finite():
    assert cs.frame({"type": "progress", "done": 1}) == b'{"type":"progress","done":1}\n'
    with pytest.raises(ValueError):
        cs.frame({"x": float("nan")})


# --- the ledger ------------------------------------------------------------------------------------------------

def test_the_bound_is_a_constructor_argument_with_the_default_of_4_5_gb():
    assert cs.Ledger().bound == cs.DEFAULT_LEDGER_BYTES == 4_500_000_000
    assert cs.Ledger(1000).bound == 1000
    with pytest.raises(ValueError):
        cs.Ledger(0)


def test_a_reservation_that_does_not_fit_waits_and_proceeds_on_a_release():
    ledger = cs.Ledger(100)
    first = ledger.reserve(70, 0, "first")
    with pytest.raises(cs.Busy):
        ledger.reserve(40, 0, "second")                  # does not fit, and may not wait
    got = []
    with _threads() as spawn:
        spawn(lambda: got.append(ledger.reserve(40, 10, "second")))
        time.sleep(0.05)
        assert not got, "it did not wait"
        first.release()
        _until(lambda: got, what="the waiting reservation")
    assert ledger.held() == 40
    got[0].release()
    assert ledger.held() == 0


def test_a_wait_past_its_time_is_busy_and_holds_nothing():
    ledger = cs.Ledger(100)
    held = ledger.reserve(90, 0, "first")
    start = time.monotonic()
    with pytest.raises(cs.Busy) as info:
        ledger.reserve(20, 0.1, "the grouping")
    assert time.monotonic() - start >= 0.09 and "the grouping" in str(info.value)
    assert isinstance(info.value, cs.read_guard.ReadBusyError)
    assert ledger.held() == 90
    held.release()


def test_two_resolves_run_together_only_if_both_fit():
    ledger = cs.Ledger(100)
    a = ledger.reserve(50, 0, "a")
    b = ledger.reserve(50, 0, "b")                       # both fit
    with pytest.raises(cs.Busy):
        ledger.reserve(1, 0, "c")
    a.release(), b.release()
    a = ledger.reserve(60, 0, "a")
    with pytest.raises(cs.Busy):
        ledger.reserve(60, 0, "b")                       # not both
    a.release()


def test_the_evictable_is_emptied_before_a_reservation_waits():
    ledger = cs.Ledger(100)
    cache = {"bytes": 60, "evicted": 0}

    def evict():
        cache["evicted"] += 1
        cache["bytes"] = 0
    ledger.register_evictable("codes", lambda: cache["bytes"], evict)
    small = ledger.reserve(30, 0, "fits beside the cache")
    assert cache["evicted"] == 0 and cache["bytes"] == 60
    big = ledger.reserve(60, 0, "needs the cache's room")     # no wait: the cache gave way
    assert cache["evicted"] == 1 and cache["bytes"] == 0
    cache["bytes"] = 10                                       # the cache refills while the resolves run
    with pytest.raises(cs.Busy):
        ledger.reserve(20, 0, "too much even without the cache")
    assert cache["evicted"] == 2                              # emptied again before giving up
    small.release(), big.release()


def test_a_reservation_over_the_bound_is_the_whole_bound_and_runs_alone():
    ledger = cs.Ledger(100)
    whole = ledger.reserve(10 ** 12, 0, "a huge score")
    assert whole.nbytes == 100 and ledger.held() == 100
    with pytest.raises(cs.Busy):
        ledger.reserve(1, 0, "anything")
    whole.release()


def test_resize_shrinks_at_once_and_grows_only_into_room():
    ledger = cs.Ledger(100)
    job = ledger.reserve(80, 0, "job")
    job.resize(10)                                            # given way: its accumulators only
    other = ledger.reserve(85, 0, "other")
    with pytest.raises(cs.Busy):
        job.resize(80, 0)
    assert job.nbytes == 10
    other.release()
    job.resize(80, 0)
    assert ledger.held() == 80
    job.release()
    job.release()                                             # twice is harmless
    assert ledger.held() == 0


# --- lanes ---------------------------------------------------------------------------------------------------

def test_a_job_in_a_free_lane_runs_at_once_and_the_next_one_queues():
    lanes = cs.Lanes()
    a = lanes.enter("heavy")
    b = lanes.enter("heavy")
    c = lanes.enter("heavy")
    assert a.running and not b.running and not c.running
    assert a.queue() == {"ahead": 0, "sharing": 0}
    assert b.queue() == {"ahead": 1, "sharing": 0} and c.queue() == {"ahead": 2, "sharing": 0}
    b.leave()                                                 # cancelled while queued
    assert c.queue() == {"ahead": 1, "sharing": 0}
    a.leave()
    assert c.running
    c.leave()
    with pytest.raises(ValueError):
        lanes.enter("medium")


def test_light_never_waits_on_heavy_and_runs_two_at_a_time():
    lanes = cs.Lanes()
    heavy = [lanes.enter("heavy"), lanes.enter("heavy")]
    light = [lanes.enter("light") for _ in range(3)]
    assert [j.running for j in light] == [True, True, False]
    assert light[2].queue() == {"ahead": 2, "sharing": 0}
    light[0].leave()
    assert light[2].running
    for j in heavy + light:
        j.leave()


def test_a_light_job_is_never_asked_to_give_way():
    lanes = cs.Lanes()
    a, b, c = lanes.enter("light"), lanes.enter("light"), lanes.enter("light")
    assert not a.wanted() and not b.wanted()
    for j in (a, b, c):
        j.leave()


def test_wait_turn_reports_each_change_of_place_then_the_turn():
    clock = Clock()
    lanes = cs.Lanes(clock=clock)
    a, b, c = lanes.enter("heavy"), lanes.enter("heavy"), lanes.enter("heavy")
    seen = []
    with _threads() as spawn:
        def waiter():
            last = c.queue()
            seen.append(last)
            while (last := lanes.wait_turn(c, clock() + 60, last, 60)) is not None:
                seen.append(last)
            seen.append("running")
        spawn(waiter)
        _until(lambda: len(seen) == 1)
        b.leave()
        _until(lambda: len(seen) == 2)
        a.leave()
        _until(lambda: len(seen) == 3)
    assert seen == [{"ahead": 2, "sharing": 0}, {"ahead": 1, "sharing": 0}, "running"]
    c.leave()


def test_wait_turn_past_the_deadline_is_busy_and_the_job_stays_queued_until_it_leaves():
    lanes = cs.Lanes()
    a, b = lanes.enter("heavy"), lanes.enter("heavy")
    with pytest.raises(cs.Busy) as info:
        lanes.wait_turn(b, time.monotonic() + 0.05, b.queue(), 0.05)
    assert info.value.retry_after_s == 1
    assert b.queue() == {"ahead": 1, "sharing": 0}
    b.leave()
    a.leave()


def test_giving_way_passes_the_lane_and_comes_back_after_one_turn():
    lanes = cs.Lanes()
    a = lanes.enter("heavy")
    a.wait()                                                  # nobody waits: nothing happens
    assert a.running and not a.wanted()
    b = lanes.enter("heavy")
    assert a.wanted()
    order = []
    with _threads() as spawn:
        def long_job():
            order.append("a gives way")
            a.wait()
            order.append("a again")
        spawn(long_job)
        _until(lambda: b.running, what="b's turn")
        assert a.state == "yielded" and order == ["a gives way"]
        assert a.queue() == {"ahead": 0, "sharing": 1} and b.queue() == {"ahead": 0, "sharing": 1}
        assert b.wanted()                                     # a waits again: b gives way at its next batch
        b.leave()
        _until(lambda: order == ["a gives way", "a again"])
    assert a.running and a.queue() == {"ahead": 0, "sharing": 0}
    a.leave()


def test_a_job_that_has_given_way_holds_its_accumulators_only():
    ledger = cs.Ledger(1000)
    lanes = cs.Lanes()
    a = lanes.enter("heavy")
    a.hold(ledger.reserve(800, 0, "a"), keep_bytes=16, wait_s=5)
    b = lanes.enter("heavy")
    with _threads() as spawn:
        spawn(a.wait)
        _until(lambda: b.running)
        assert ledger.held() == 16                            # a's read-ahead is free while b runs
        b.hold(ledger.reserve(900, 0, "b"), keep_bytes=0, wait_s=5)
        b.reservation.release()
        b.leave()
        _until(lambda: a.running and ledger.held() == 800, what="a grown back")
    a.reservation.release()
    a.leave()


def test_running_s_stands_still_while_a_job_waits_or_has_given_way():
    clock = Clock()
    lanes = cs.Lanes(clock=clock)
    a = lanes.enter("heavy")
    b = lanes.enter("heavy")
    clock.t += 5                                              # b waits 5 s
    assert b.running_s() == 0.0 and a.running_s() == 5.0
    with _threads() as spawn:
        spawn(a.wait)
        _until(lambda: b.running)
        clock.t += 3                                          # b runs 3 s while a has given way
        assert a.running_s() == 5.0 and b.running_s() == 3.0
        b.leave()
        _until(lambda: a.running)
    clock.t += 2
    assert a.running_s() == 7.0
    a.leave()
    clock.t += 10
    assert a.running_s() == 7.0


def test_the_holder_acts_as_a_semaphore_of_the_lane():
    lanes = cs.Lanes()
    slot = lanes.holder("heavy")
    assert slot.acquire(blocking=False)
    job = lanes.enter("heavy")
    assert not job.running and not slot.acquire(blocking=False)
    start = time.monotonic()
    assert not slot.acquire(timeout=0.05) and time.monotonic() - start >= 0.04
    assert job.queue() == {"ahead": 1, "sharing": 0}          # a timed-out acquire left the queue
    slot.release()
    assert job.running
    with pytest.raises(ValueError):
        slot.release()
    job.leave()
    with _threads() as spawn:
        assert slot.acquire()
        timer = threading.Timer(0.05, slot.release)
        timer.start()
        try:
            assert slot.acquire(timeout=5)
        finally:
            timer.join()
        slot.release()


def test_two_hundred_requests_on_two_lanes_keep_every_bound_and_all_finish():
    """Heavy jobs of several batches giving way, light jobs, cancels while queued, under one ledger. Run under an
    outside watchdog (the step's report names the command); every thread is joined here."""
    rng = random.Random(7)
    lanes, ledger = cs.Lanes(), cs.Ledger(1000)
    lock = threading.Lock()
    now = {"heavy": 0, "light": 0}
    peak = {"heavy": 0, "light": 0, "held": 0}
    finished, cancelled, errors = [], [], []

    def inside(lane, delta):
        with lock:
            now[lane] += delta
            peak[lane] = max(peak[lane], now[lane])
            peak["held"] = max(peak["held"], ledger.held())

    def request(i, lane, batches, nbytes, cancel):
        job = lanes.enter(lane)
        try:
            last = job.queue()
            deadline = time.monotonic() + (0.01 if cancel else 30)
            try:
                while (last := lanes.wait_turn(job, deadline, last, 30)) is not None:
                    pass
            except cs.Busy:
                cancelled.append(i)
                return
            job.hold(ledger.reserve(nbytes, 30, f"job {i}"), keep_bytes=nbytes // 10, wait_s=30)
            for _ in range(batches):
                inside(lane, 1)
                time.sleep(0.0005)
                inside(lane, -1)
                if job.wanted():
                    job.wait()
            finished.append(i)
        except Exception as exc:                              # noqa: BLE001 - reported below
            errors.append(repr(exc))
        finally:
            if job.reservation is not None:
                job.reservation.release()
            job.leave()

    with _threads() as spawn:
        for i in range(200):
            heavy = rng.random() < 0.5
            spawn(request, i, "heavy" if heavy else "light", rng.randint(1, 6) if heavy else 1,
                  rng.randint(100, 900) if heavy else rng.randint(50, 400), rng.random() < 0.05)
    assert not errors, errors[:3]
    assert len(finished) + len(cancelled) == 200
    assert peak["heavy"] <= 1 and peak["light"] <= cs.LIGHT_WIDTH and peak["held"] <= 1000
    assert ledger.held() == 0
    for lane in cs.LANE_NAMES:
        probe = lanes.enter(lane)
        assert probe.running, f"the {lane} lane is still held"
        probe.leave()
