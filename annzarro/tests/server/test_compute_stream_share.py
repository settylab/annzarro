"""The read-guard admission is part of the lanes' fit (SHR-41; the lead's ruling on E6b's finding).

A heavy job holds its requester's read-guard admission from its first turn until it ends, given way or not. A job
whose admission would not fit its requester's share (or the budget) beside what the running and yielded jobs hold
waits in the lane queue, with queued frames and the ``QUEUE_WAIT_S`` rules, and runs when a holder ends; it never
sits in the read guard's own wait and ends in ``read_busy`` because a longer job of its requester is running. Another
requester is not held behind it. A refusal that does come from the read guard names no pairwise matrices.
"""
import threading
import time

import pytest

from annzarro.core import cell_groups as cg
from annzarro.core import get_reader
from annzarro.core import group_features as gf
from annzarro.core import read_guard
from annzarro.core import subset as cell_subset
from annzarro.core import zarr_reader
from annzarro.server.core import create_app
from annzarro.server.routes import cell_groups as route
from annzarro.server.routes import compute_stream as cs
from annzarro.tests.core import grouping_store as gstore
from annzarro.tests.server.test_cell_groups_route import data, grouping, layout, parse, post
from annzarro.tests.server.test_compute_stream import _threads, _until

__all__ = ["data", "layout"]          # fixtures, imported for pytest

MB = 2 ** 20


@pytest.fixture
def guard():
    """A read budget of 1000 MB with a share of 500 MB, and a read-guard wait short enough for a test."""
    read_guard.configure(max_mb=400, budget_mb=1000, wait_s=0.3, share_pct=50)
    assert read_guard.share_bytes() == 500 * MB
    yield
    read_guard.configure()


# --- the lanes ---------------------------------------------------------------------------------------------------

def test_a_job_whose_admission_does_not_fit_its_requesters_share_waits_in_the_queue(guard):
    lanes = cs.Lanes()
    a = lanes.enter("heavy", admit_bytes=300 * MB, owner="alice")
    b = lanes.enter("heavy", admit_bytes=300 * MB, owner="alice")
    assert a.running and not b.running
    a.wanted()                                # a turn reads one batch first
    assert not a.wanted()                     # b may not take a turn while a holds alice's share
    a.wait()                                  # so a never gives way to it
    assert a.running and b.queue() == {"ahead": 1, "sharing": 0}
    a.leave()
    assert b.running                          # taken again when the holder ends
    b.leave()


def test_three_jobs_of_one_requester_over_half_its_share_run_in_turn(guard):
    lanes = cs.Lanes()
    jobs = [lanes.enter("heavy", admit_bytes=260 * MB, owner="alice") for _ in range(3)]
    assert [j.running for j in jobs] == [True, False, False]
    jobs[0].leave()
    assert [j.running for j in jobs[1:]] == [True, False]
    jobs[1].leave()
    assert jobs[2].running
    jobs[2].leave()


def test_jobs_that_fit_the_share_together_take_turns(guard):
    lanes = cs.Lanes()
    a = lanes.enter("heavy", admit_bytes=200 * MB, owner="alice")
    b = lanes.enter("heavy", admit_bytes=200 * MB, owner="alice")
    a.wanted()
    assert a.wanted()                         # 400 MB fit alice's 500 MB: b may take a turn
    with _threads() as spawn:
        spawn(a.wait)
        _until(lambda: b.running, what="b's turn")
        b.leave()
        _until(lambda: a.running, what="a's turn back")
    a.leave()


def test_another_requester_is_not_held_behind_one_over_its_share(guard):
    lanes = cs.Lanes()
    a1 = lanes.enter("heavy", admit_bytes=300 * MB, owner="alice")
    a2 = lanes.enter("heavy", admit_bytes=300 * MB, owner="alice")
    a3 = lanes.enter("heavy", admit_bytes=300 * MB, owner="alice")
    bob = lanes.enter("heavy", admit_bytes=300 * MB, owner="bob")
    assert bob.queue() == {"ahead": 3, "sharing": 0}
    a1.wanted()
    assert a1.wanted()                        # bob's job may take a turn: it passes alice's blocked ones
    with _threads() as spawn:
        spawn(a1.wait)
        _until(lambda: bob.running, what="bob's turn")
        assert not a2.running and not a3.running
        bob.leave()
        _until(lambda: a1.running, what="a1's turn back")
    a1.leave()
    assert a2.running and not a3.running
    a2.leave()
    a3.leave()


def test_the_whole_budget_held_by_others_makes_a_job_wait_for_its_turn(guard):
    lanes = cs.Lanes()
    a, b, c = (lanes.enter("heavy", admit_bytes=450 * MB, owner=who) for who in ("a", "b", "c"))
    a.wanted()
    assert a.wanted()                         # b fits beside a: 900 of 1000 MB
    with _threads() as spawn:
        spawn(a.wait)
        _until(lambda: b.running, what="b's turn")
        b.wanted()
        assert b.wanted()                     # the turn goes back to a, not to c: 1350 MB would not fit
        spawn(b.wait)
        _until(lambda: a.running, what="a's turn back")
        assert not c.running
        a.leave()
        _until(lambda: c.running, what="c, now that a's 450 MB are free")
        c.leave()
        _until(lambda: b.running, what="b's turn back")
        b.leave()


def test_a_requester_with_nothing_of_its_own_running_is_admitted_as_before(guard):
    lanes = cs.Lanes()
    big = lanes.enter("heavy", admit_bytes=900 * MB, owner="alice")          # over the share, alone: runs
    assert big.running
    big.leave()
    light = [lanes.enter("light", admit_bytes=300 * MB, owner="alice") for _ in range(2)]
    assert [j.running for j in light] == [True, False]                        # the light lane keeps it too
    light[0].leave()
    assert light[1].running
    light[1].leave()


def test_jobs_without_an_admission_or_a_requester_are_not_held(guard):
    lanes = cs.Lanes()
    a = lanes.enter("heavy", admit_bytes=300 * MB, owner=None)
    b = lanes.enter("heavy", admit_bytes=300 * MB, owner=None)
    light = lanes.enter("light", owner="alice")
    a.wanted()
    assert a.wanted() and light.running
    for j in (a, b, light):
        j.leave()


# --- the routes ----------------------------------------------------------------------------------------------------

@pytest.fixture
def hosted(layout, tmp_path, guard):
    """A shared server (every request has a requester: here the test client's address), the guard above."""
    zarr_reader.clear_cache()
    cell_subset.clear()
    route.CODES.clear()
    app = create_app({"TESTING": True, "hosted": True, "auth_enabled": False, "data_dir": str(layout / "data"),
                      "log_file": str(tmp_path / "t.log")})
    read_guard.configure(max_mb=400, budget_mb=1000, wait_s=0.3, share_pct=50)
    yield app
    route.CODES.clear()


def _gene_part(i):
    return {"source": {"type": "layer", "key": "logged", "column": gstore.gene(i)}}


def test_three_heavy_requests_of_one_requester_all_finish_in_turn(hosted, layout, monkeypatch):
    monkeypatch.setattr(route, "QUEUE_WAIT_S", 30.0)
    path = str(layout / "data" / "csr.zarr")
    plan = gf.plan(get_reader(path), path, cg.parse_request(grouping([_gene_part(1)])))
    full, _ = route.reservation(plan, gstore.N_OBS)
    assert 250 * MB < full <= 500 * MB                     # each over half the share: one at a time
    real = cg.compute

    def slow(plan_, *a, **k):                              # each resolve takes a while and gives way when asked
        pause = k.get("pause")
        end = time.monotonic() + 0.4
        while time.monotonic() < end:
            if pause is not None and pause.wanted():
                pause.wait()
            time.sleep(0.01)
        yield from real(plan_, *a, **k)
    monkeypatch.setattr(cg, "compute", slow)
    client = hosted.test_client()
    out = [None] * 3

    def one(i):
        resp = post(client, layout, grouping([_gene_part(i + 1)]), name="csr.zarr")
        out[i] = (resp.status_code, parse(resp.get_data())[0])
    with _threads() as spawn:
        for i in range(3):
            spawn(one, i)
    assert [o[0] for o in out] == [200] * 3
    ends = [o[1][-1] for o in out]
    assert [e["type"] for e in ends] == ["result"] * 3, ends
    assert all(f.get("reason") != "read_busy" for o in out for f in o[1])
    queued = [f for o in out for f in o[1] if f["type"] == "progress" and f.get("done") == 0
              and f.get("entries_done") == 0 and f["queue"]["ahead"] > 0]
    assert queued, "the waiting requests were told their place"
    assert read_guard.in_flight_bytes() == 0 and cs.LEDGER.held() == 0


def test_a_read_guard_refusal_names_no_pairwise_matrices(hosted, layout, monkeypatch):
    """Something other than a computation (a pairwise read) holds the requester's share: the read guard's own wait
    applies as before, and its refusal is told in the computation's words."""
    monkeypatch.setattr(route, "QUEUE_WAIT_S", 0.2)
    client = hosted.test_client()
    held = threading.Event()
    done = threading.Event()

    def pairwise_read():
        read_guard.requester(read_guard.address_requester("127.0.0.1"))
        with read_guard.admit(450 * MB):
            held.set()
            done.wait(10)
    t = threading.Thread(target=pairwise_read, daemon=True)
    t.start()
    try:
        assert held.wait(5)
        resp = post(client, layout, grouping([_gene_part(1)]), name="csr.zarr")
    finally:
        done.set()
        t.join(10)
    assert resp.status_code == 503
    body = resp.get_json()
    assert body["reason"] == "read_busy" and "pairwise" not in body["error"] and "this request" in body["error"]


# --- a job held only by its own requester waits without the queue's time limit -------------------------------------

def _wait_for_turn(lanes, job, wait_s):
    """What ``respond`` does while a job is queued: wait_turn until it runs, from one deadline."""
    deadline = lanes.now() + wait_s
    last = job.queue()
    while (last := lanes.wait_turn(job, deadline, last, wait_s)) is not None:
        pass


def test_a_job_held_only_by_its_own_requester_outlasts_the_queue_wait(guard, monkeypatch):
    monkeypatch.setattr(cs, "OWN_WAIT_HEARTBEAT_S", 0.05)
    lanes = cs.Lanes()
    first = lanes.enter("heavy", admit_bytes=300 * MB, owner="alice")
    second = lanes.enter("heavy", admit_bytes=300 * MB, owner="alice")
    got = []
    with _threads() as spawn:
        def waiter():
            try:
                _wait_for_turn(lanes, second, 0.1)
                got.append("ran")
            except cs.Busy:
                got.append("busy")
        spawn(waiter)
        time.sleep(0.5)                                   # five times the queue wait
        assert got == [] and not second.running
        first.leave()
        _until(lambda: got, what="the second job's turn")
    assert got == ["ran"] and second.running
    second.leave()


def test_a_job_held_by_another_requester_still_times_out(guard):
    lanes = cs.Lanes()
    others = [lanes.enter("heavy", admit_bytes=450 * MB, owner=who) for who in ("bob", "carol")]
    with _threads() as spawn:
        spawn(others[0].wait)                             # bob gives way: both hold 900 of the 1000 MB budget
        _until(lambda: others[1].running)
        alice = lanes.enter("heavy", admit_bytes=450 * MB, owner="alice")
        start = time.monotonic()
        with pytest.raises(cs.Busy):
            _wait_for_turn(lanes, alice, 0.2)
        assert time.monotonic() - start < 2
        alice.leave()
        others[1].leave()
        _until(lambda: others[0].running)
    others[0].leave()


def test_the_wait_is_limited_again_once_another_requester_holds_it(guard, monkeypatch):
    """Alice's second job fits her share beside her first (200 + 300 MB); what holds it is bob's 750 MB: the budget
    would not fit it even without alice's own. So the queue's time limit applies."""
    monkeypatch.setattr(cs, "OWN_WAIT_HEARTBEAT_S", 0.05)
    lanes = cs.Lanes()
    mine = lanes.enter("heavy", admit_bytes=200 * MB, owner="alice")
    bob = lanes.enter("heavy", admit_bytes=750 * MB, owner="bob")
    with _threads() as spawn:
        mine.wanted()
        spawn(mine.wait)                                  # bob takes a turn: 950 of the 1000 MB held
        _until(lambda: bob.running)
        second = lanes.enter("heavy", admit_bytes=300 * MB, owner="alice")
        with pytest.raises(cs.Busy):
            _wait_for_turn(lanes, second, 0.2)
        second.leave()
        bob.leave()
        _until(lambda: mine.running)
    mine.leave()


def test_one_requesters_second_request_finishes_after_a_first_longer_than_the_queue_wait(hosted, layout, monkeypatch):
    monkeypatch.setattr(route, "QUEUE_WAIT_S", 0.3)
    monkeypatch.setattr(cs, "OWN_WAIT_HEARTBEAT_S", 0.1)
    real = cg.compute
    slow_first = []

    def slow(plan_, *a, **k):                             # the first request runs well past the queue wait
        if not slow_first:
            slow_first.append(1)
            time.sleep(1.5)
        yield from real(plan_, *a, **k)
    monkeypatch.setattr(cg, "compute", slow)
    client = hosted.test_client()
    out = [None] * 2

    def one(i):
        resp = post(client, layout, grouping([_gene_part(i + 1)]), name="csr.zarr")
        out[i] = parse(resp.get_data())[0]
    with _threads() as spawn:
        spawn(one, 0)
        _until(lambda: slow_first, what="the first request's resolve")
        spawn(one, 1)
    assert [o[-1]["type"] for o in out] == ["result", "result"], out
    assert out[1][0]["type"] == "progress" and out[1][0]["queue"]["ahead"] >= 1        # told it is queued
    assert all(f.get("reason") != "read_busy" for o in out for f in o)
