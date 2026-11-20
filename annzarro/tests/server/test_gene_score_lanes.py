"""The score route in the heavy lane (SHR-41, SHR-47, SHR-48): queued frames, giving way, the ledger.

The route's own contract is tests/server/test_gene_score_route.py; these tests add what the lanes change. Two
scores at once need two threads reading their streams, as two request threads would; every thread is joined, and
every response closed, on every way out.
"""
import contextlib
import json
import threading
import time

import pytest

from annzarro.core import gene_score as gs
from annzarro.server.routes import compute_stream as cs
from annzarro.server.routes import gene_score as route
from annzarro.tests.core.gene_score_store import gene
from annzarro.tests.server.test_gene_score_route import (  # noqa: F401 - fixtures
    NAMES, _slow_reads, app, client, ds, layout, matrix, parse, post)

JOIN_S = 30


def _no_survivors(threads):
    """A thread still alive after its join deadline is a hang in the code under test: dump every stack and end the
    process, so no thread (and no pytest) outlives the test and holds the bench."""
    alive = [t for t in threads if t.is_alive()]
    if alive:
        import faulthandler
        import os
        import sys
        sys.stderr.write(f"\n{len(alive)} thread(s) outlived the test; stacks follow, then the process ends.\n")
        faulthandler.dump_traceback(all_threads=True)
        os._exit(1)


@contextlib.contextmanager
def _streams():
    """Open streamed responses through ``open_``; each is closed, and each reader thread joined, on the way out."""
    responses, threads = [], []

    def open_(resp):
        responses.append(resp)
        return resp

    def spawn(fn, *args):
        t = threading.Thread(target=fn, args=args, daemon=True)
        threads.append(t)
        t.start()
        return t
    try:
        yield open_, spawn
    finally:
        deadline = time.monotonic() + JOIN_S
        for t in threads:
            t.join(max(deadline - time.monotonic(), 0.01))
        for resp in responses:
            resp.close()
        _no_survivors(threads)


def _frames(chunks):
    """The next JSON frame of a streamed response read chunk by chunk (each frame is one chunk)."""
    return json.loads(next(chunks))


def _plan(layout, names):
    from annzarro.core import get_reader
    reader = get_reader(ds(layout))
    return gs.plan(reader, ds(layout), gs.parse_recipe({"genes": names}))


def test_a_queued_score_is_told_its_place_at_once_and_on_each_change(client, layout):
    entries = _plan(layout, NAMES).entries
    assert route._slot.acquire(blocking=False)
    held = True
    try:
        with _streams() as (open_, _):
            b = open_(post(client, layout, {"recipe": {"genes": NAMES}}, buffered=False))
            c = open_(post(client, layout, {"recipe": {"genes": NAMES}}, buffered=False))
            assert b.status_code == 200 and c.status_code == 200 and c.mimetype == route.MIMETYPE
            bs, cs_ = b.iter_encoded(), c.iter_encoded()
            first = _frames(cs_)
            assert first == {"type": "progress", "done": 0, "total": len(NAMES), "entries_done": 0,
                             "entries_total": entries, "running_s": 0.0, "queue": {"ahead": 2, "sharing": 0}}
            assert _frames(bs)["queue"] == {"ahead": 1, "sharing": 0}
            b.close()                                               # cancelled while queued
            assert _frames(cs_)["queue"] == {"ahead": 1, "sharing": 0}
            route._slot.release()
            held = False
            rest = b"".join(cs_)
            frames, vector = parse(rest)
            assert frames[-1]["type"] == "result" and vector is not None
            assert all(f["queue"] == {"ahead": 0, "sharing": 0} for f in frames[:-1])
            assert frames[-2]["entries_total"] == entries and frames[-2]["entries_done"] == entries
            done = [f["entries_done"] for f in frames[:-1]]
            assert done == sorted(done) and done[0] == 0
    finally:
        if held:
            route._slot.release()
    assert route._slot.acquire(blocking=False)                      # nothing holds the lane
    route._slot.release()


def test_a_second_score_starts_within_one_batch_of_a_long_one(client, layout, monkeypatch):
    """A long score (16 genes, one read each) and a short one sent while it runs: the short one starts after at most
    the read in flight and the one after it, and neither is told the server is busy though the long one takes far
    longer than QUEUE_WAIT_S."""
    started = []
    _slow_reads(monkeypatch, 0.1, started)
    monkeypatch.setattr(gs, "MAX_GROUP_ENTRIES", 0)                 # one read per gene, neighbours or not
    monkeypatch.setattr(route, "QUEUE_WAIT_S", 0.5)
    long_genes = [gene(i) for i in range(16)]
    short_genes = [gene(17), gene(18)]
    out = {}
    with _streams() as (open_, spawn):
        def run(name, genes):
            resp = open_(post(client, layout, {"recipe": {"genes": genes}}, buffered=False))
            out[name] = (resp.status_code, resp.get_data())
        spawn(run, "long", long_genes)
        deadline = time.monotonic() + 10
        while len(started) < 3 and time.monotonic() < deadline:
            time.sleep(0.01)
        at_arrival = len(started)
        assert 0 < at_arrival < 6, "the long score did not start, or ran too far before the second was sent"
        spawn(run, "short", short_genes)
    (long_status, long_data), (short_status, short_data) = out["long"], out["short"]
    assert long_status == short_status == 200, (long_status, short_status, short_data[:200])
    (long_frames, long_vector), (short_frames, short_vector) = parse(long_data), parse(short_data)
    assert long_frames[-1]["type"] == "result" and short_frames[-1]["type"] == "result", (long_frames[-1], short_frames[-1])
    assert long_vector is not None and short_vector is not None
    short_cols = {17, 18}
    first_short = next(i for i, col in enumerate(started) if col in short_cols)
    long_between = sum(1 for col in started[at_arrival:first_short] if col not in short_cols)
    assert len(started) == 18, "a gene was read twice, or not at all"
    assert long_between <= 2, f"the long score read {long_between} more genes before the short one started"
    assert any(f.get("queue", {}).get("sharing") == 1 for f in long_frames[:-1]), "the long score never shared"
    running = [f["running_s"] for f in long_frames[:-1]]
    assert running == sorted(running)


def test_a_second_score_starts_within_one_chunk_of_a_whole_matrix_pass(client, layout, monkeypatch):
    """The share of the total on a CSR store first sums every cell over the whole matrix; a score sent during that
    pass starts after at most two of its chunks."""
    events = []
    real_checkpoint = gs._checkpoint

    def slow_checkpoint(should_stop, pause):
        real_checkpoint(should_stop, pause)
        events.append("chunk")
        time.sleep(0.05)
    monkeypatch.setattr(gs, "_checkpoint", slow_checkpoint)
    monkeypatch.setattr(gs, "STAT_CHUNK", 50)
    real_read = gs._CscSource._read

    def recorded_read(self, lo, hi, spans):
        events.append("short")
        return real_read(self, lo, hi, spans)
    monkeypatch.setattr(gs._CscSource, "_read", recorded_read)
    monkeypatch.setattr(route, "QUEUE_WAIT_S", 0.5)
    out = {}
    with _streams() as (open_, spawn):
        def run(name, body, dataset):
            resp = open_(post(client, layout, body, name=dataset, buffered=False))
            out[name] = (resp.status_code, resp.get_data())
        spawn(run, "long", {"recipe": {"genes": NAMES, "method": "fraction_of_total"}}, "cells.h5ad")
        deadline = time.monotonic() + 10
        while events.count("chunk") < 3 and time.monotonic() < deadline:
            time.sleep(0.01)
        at_arrival = len(events)
        assert events.count("chunk") >= 3, "the whole-matrix pass did not start"
        spawn(run, "short", {"recipe": {"genes": NAMES}}, "in.zarr")
    (long_status, long_data), (short_status, short_data) = out["long"], out["short"]
    assert long_status == short_status == 200, (long_status, short_status, short_data[:200])
    long_frames, long_vector = parse(long_data)
    short_frames, short_vector = parse(short_data)
    assert long_frames[-1]["type"] == "result" and short_frames[-1]["type"] == "result"
    assert long_vector is not None and short_vector is not None
    first_short = events.index("short")
    between = events[at_arrival:first_short].count("chunk")
    assert first_short >= at_arrival and between <= 2, f"the pass ran {between} more chunks before the short score"
    assert "chunk" in events[first_short:], "the pass did not resume after the short score began"


def test_a_score_waits_for_memory_on_the_ledger_and_runs_when_it_is_released(client, layout, monkeypatch):
    monkeypatch.setattr(route, "QUEUE_WAIT_S", 10)
    full = cs.LEDGER.reserve(cs.LEDGER.bound, 0, "everything")
    try:
        with _streams() as (open_, _):
            resp = open_(post(client, layout, {"recipe": {"genes": NAMES}}, buffered=False))
            chunks = resp.iter_encoded()
            first = _frames(chunks)
            assert first["type"] == "progress" and first["queue"] == {"ahead": 0, "sharing": 0}
            assert first["entries_done"] == 0
            timer = threading.Timer(0.2, full.release)
            timer.start()
            try:
                frames, vector = parse(b"".join(chunks))
            finally:
                timer.join()
            assert frames[-1]["type"] == "result" and vector is not None
    finally:
        full.release()
    assert cs.LEDGER.held() == 0


def test_a_score_that_finds_no_memory_in_time_ends_in_read_busy(client, layout, monkeypatch):
    monkeypatch.setattr(route, "QUEUE_WAIT_S", 0.2)
    full = cs.LEDGER.reserve(cs.LEDGER.bound, 0, "everything")
    try:
        resp = post(client, layout, {"recipe": {"genes": NAMES}})
        frames, vector = parse(resp.get_data())
    finally:
        full.release()
    assert resp.status_code == 200 and [f["type"] for f in frames] == ["progress", "error"]
    assert frames[-1]["reason"] == "read_busy" and vector is None
    assert cs.LEDGER.held() == 0 and route._slot.acquire(blocking=False)
    route._slot.release()


@pytest.mark.parametrize("hold", ["lane", "memory"])
def test_closing_a_waiting_score_gives_back_its_place_and_holds_nothing(client, layout, monkeypatch, hold):
    monkeypatch.setattr(route, "QUEUE_WAIT_S", 10)
    held = route._slot.acquire(blocking=False) if hold == "lane" else cs.LEDGER.reserve(cs.LEDGER.bound, 0, "all")
    try:
        resp = post(client, layout, {"recipe": {"genes": NAMES}}, buffered=False)
        assert _frames(resp.iter_encoded())["type"] == "progress"
        resp.close()
    finally:
        route._slot.release() if hold == "lane" else held.release()
    assert cs.LEDGER.held() == 0
    probe = cs.LANES.enter("heavy")
    assert probe.running, "the closed score kept its place"
    probe.leave()
