"""The code cache in POST /api/v1/data/cell_groups (SHR-40, CMP-6, CMP-15, PER-3; plan step E6b).

The first frame says whether the grouping came from the worker's cache; a hit resolves nothing and answers what a
miss answers. The key is the dataset, its freshness token and the engine's key (review M10), so another dataset, a
moved fingerprint, a Refresh that found the store changed and another subset all miss. The cache holds codes only,
counts on the ledger, is emptied before a reservation waits, and a session opening with one grouping and three
dependants resolves the grouping once.
"""
import json
import os
import threading
import time

import numpy as np
import pytest

from annzarro.core import cell_groups as cg
from annzarro.core import freshness
from annzarro.core import subset as cell_subset
from annzarro.core import zarr_reader
from annzarro.server.core import create_app
from annzarro.server.routes import cell_groups as route
from annzarro.server.routes import compute_stream as cstream
from annzarro.tests.core import grouping_store as gstore
from annzarro.core import get_reader
from annzarro.core import group_features as gf
from annzarro.tests.server.test_cell_groups_route import (CELL_TYPE, GENE1, N, SUBSET, data, ds, grouping, layout,
                                                          parse, post, run)

__all__ = ["data", "layout"]          # fixtures, imported for pytest

FEATURE = {"id": "f0", "kind": "gene", "name": gstore.gene(1), "layer": "X", "detect_above": 0}
SCORE_BIN = {"source": {"type": "obs", "key": "score"}, "binning": {"method": "equal_width", "bins": 4}}


@pytest.fixture(autouse=True)
def fresh():
    zarr_reader.clear_cache()
    cell_subset.clear()
    route.CODES.clear()
    yield
    zarr_reader.clear_cache()
    cell_subset.clear()
    route.CODES.clear()


@pytest.fixture
def app(layout, tmp_path):
    return create_app({"TESTING": True, "data_dir": str(layout / "data"), "log_file": str(tmp_path / "t.log"),
                       "refresh_min_interval_s": 0})


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def resolves(monkeypatch):
    """The groupings the engine resolved (``cell_groups.compute`` without cached codes), by request order."""
    seen = []
    real = cg.compute

    def counted(plan_, *a, **k):
        if k.get("codes") is None:
            seen.append(plan_.cache_key)
        return real(plan_, *a, **k)
    monkeypatch.setattr(cg, "compute", counted)
    return seen


def claimed(before, timeout=5.0):
    """Wait until a request has claimed a grouping since the cache's miss count was ``before``."""
    deadline = time.monotonic() + timeout
    while route.CODES.stats["misses"] <= before and time.monotonic() < deadline:
        time.sleep(0.01)
    assert route.CODES.stats["misses"] > before


def stages(frames):
    return [f.get("stage") for f in frames if f["type"] == "progress"]


# --- hit and miss in the first frame ---------------------------------------------------------------------------------

def test_the_second_request_for_a_grouping_is_a_hit_that_resolves_nothing(client, layout, resolves):
    body = grouping([{"source": CELL_TYPE}, SCORE_BIN], want={"codes": True})
    cold, cold_blocks = run(client, layout, body)
    warm, warm_blocks = run(client, layout, body)
    assert cold[0]["codes"] == "miss" and warm[0]["codes"] == "hit"
    assert len(resolves) == 1
    assert "groups" in stages(cold) and "groups" not in stages(warm)
    assert warm[-1] == cold[-1]                                        # the same result frame
    assert warm_blocks["codes"].tobytes() == cold_blocks["codes"].tobytes()
    assert [f["type"] for f in warm] == ["start", "result"]


def test_a_dependant_hits_the_grouping_its_panel_resolved_and_reads_its_gene(client, layout, resolves):
    panel = grouping([{"source": CELL_TYPE}])
    dependant = grouping([{"source": CELL_TYPE}], features=[FEATURE])
    run(client, layout, panel)
    warm, warm_blocks = run(client, layout, dependant)
    assert warm[0]["codes"] == "hit" and len(resolves) == 1
    route.CODES.clear()
    cold, cold_blocks = run(client, layout, dependant)
    assert cold[0]["codes"] == "miss"
    assert warm[-1] == cold[-1]
    np.testing.assert_array_equal(warm_blocks["feature_moments"], cold_blocks["feature_moments"])


def test_a_hit_counts_only_the_entries_it_reads(client, layout):
    body = grouping([{"source": GENE1}], features=[FEATURE])
    cold, _ = run(client, layout, body)
    warm, _ = run(client, layout, body)
    plan = gf.plan(get_reader(ds(layout)), ds(layout), cg.parse_request(body))
    assert cold[0]["entries_total"] == plan.groups.entries
    assert warm[0]["entries_total"] == plan.work.entries < plan.groups.entries
    done = [f["entries_done"] for f in warm if f["type"] == "progress"]
    assert done and max(done) <= warm[0]["entries_total"]
    assert all(f["entries_total"] == plan.work.entries for f in warm if f["type"] == "progress")


def test_it_holds_codes_only_so_a_repeated_feature_is_read_again(client, layout):
    body = grouping([{"source": CELL_TYPE}], features=[FEATURE])
    run(client, layout, body)
    warm, _ = run(client, layout, body)
    assert warm[0]["codes"] == "hit" and "features" in stages(warm)
    assert warm[0]["entries_total"] > 0


def test_a_grid_neither_says_nor_uses_codes(client, layout, resolves):
    run(client, layout, grouping([{"source": CELL_TYPE}]))
    frames, _ = run(client, layout, {"shape": "grid", "mode": "1d", "partitionings": [{"source": CELL_TYPE}]})
    assert "codes" not in frames[0] and len(route.CODES) == 1


def test_a_refused_grouping_is_not_kept(client, layout, resolves):
    every = [f"c:m{i:04d}" for i in range(gstore.N_MANY)]             # 2,001 levels kept: over the limit (FX-E M5)
    body = grouping([{"source": {"type": "obs", "key": "many"}, "levels": every}])
    for _ in range(2):
        frames, _ = run(client, layout, body)
        assert frames[0]["codes"] == "miss" and frames[-1]["refused"]["reason"] == "too_many_levels"
    assert len(resolves) == 2 and len(route.CODES) == 0


# --- the key (PER-3, review M10) -------------------------------------------------------------------------------------

def test_another_dataset_with_the_same_cells_misses(client, layout, resolves):
    body = grouping([{"source": CELL_TYPE}])
    run(client, layout, body)
    other, _ = run(client, layout, body, name="out.zarr")
    assert other[0]["codes"] == "miss" and len(resolves) == 2 and len(route.CODES) == 2


def test_a_moved_fingerprint_misses_and_drops_the_old_codes(client, layout, resolves):
    body = grouping([{"source": CELL_TYPE}])
    run(client, layout, body)
    before = route.CODES.size()
    freshness.bump(ds(layout), reason="cache_reset")              # a new generation, as every worker sees it
    frames, _ = run(client, layout, body)
    assert frames[0]["codes"] == "miss" and len(resolves) == 2
    assert len(route.CODES) == 1 and route.CODES.size() == before
    assert run(client, layout, body)[0][0]["codes"] == "hit"


def test_a_store_rewritten_on_disk_misses(client, layout, resolves):
    body = grouping([{"source": CELL_TYPE}])
    run(client, layout, body)
    obs = os.path.join(ds(layout, "csr.zarr"), "obs")
    run(client, layout, body, name="csr.zarr")
    st = os.stat(obs)
    os.utime(obs, ns=(st.st_atime_ns, st.st_mtime_ns + 10 ** 9))   # what an anndata rewrite of obs does to it
    frames, _ = run(client, layout, body, name="csr.zarr")
    assert frames[0]["codes"] == "miss"
    assert run(client, layout, body)[0][0]["codes"] == "hit"       # another store is untouched


def test_a_refresh_that_finds_the_store_changed_drops_its_codes(client, layout, resolves):
    body = grouping([{"source": CELL_TYPE}])
    path = ds(layout, "out.zarr")
    refresh = lambda: client.post("/api/v1/data/refresh", query_string={"dataset_path": path}).get_json()
    refresh()                                                      # the first walk records the store
    run(client, layout, body, name="out.zarr")
    assert refresh()["changed"] is False
    assert run(client, layout, body, name="out.zarr")[0][0]["codes"] == "hit"     # an unchanged store keeps them
    chunk = next(os.path.join(root, f) for root, _, files in os.walk(os.path.join(path, "obs"))
                 for f in files if not f.startswith("."))
    st = os.stat(chunk)
    os.utime(chunk, ns=(st.st_atime_ns, st.st_mtime_ns + 10 ** 9))   # an in-place chunk write: no stat moves above
    assert run(client, layout, body, name="out.zarr")[0][0]["codes"] == "hit"     # not seen before the refresh
    assert refresh()["changed"] is True
    assert run(client, layout, body, name="out.zarr")[0][0]["codes"] == "miss"


def test_another_subset_or_another_recipe_misses(client, layout, resolves):
    base = grouping([{"source": CELL_TYPE}])
    run(client, layout, base)
    for body in (grouping([{"source": CELL_TYPE}], subset=SUBSET),
                 grouping([{"source": CELL_TYPE}], small={"threshold": 10, "mode": "collect"}),
                 grouping([{"source": CELL_TYPE, "levels": ["c:" + gstore.CELL_TYPES[0][0]]}])):
        frames, _ = run(client, layout, body)
        assert frames[0]["codes"] == "miss", body
    assert run(client, layout, base)[0][0]["codes"] == "hit"


def test_a_label_or_the_codes_wanted_change_nothing(client, layout, resolves):
    run(client, layout, grouping([{"source": CELL_TYPE}], want={"codes": False}))
    frames, blocks = run(client, layout, grouping([{"source": CELL_TYPE}], want={"codes": True}))
    assert frames[0]["codes"] == "hit" and blocks["codes"].size == N and len(resolves) == 1


# --- histograms, kept outside the codes -------------------------------------------------------------------------------

def test_histograms_are_held_beside_the_codes_and_a_hit_carries_those_asked(client, layout, resolves):
    asked = grouping([{"source": CELL_TYPE}, SCORE_BIN], want={"histograms": [1]})
    plain = grouping([{"source": CELL_TYPE}, SCORE_BIN])
    cold, _ = run(client, layout, asked)
    assert "histogram" in cold[-1]["partitionings"][1]
    warm, _ = run(client, layout, plain)                             # a dependant asks for none: a hit
    assert warm[0]["codes"] == "hit" and all("histogram" not in p for p in warm[-1]["partitionings"])
    again, _ = run(client, layout, asked)
    assert again[0]["codes"] == "hit" and again[-1] == cold[-1]
    assert len(resolves) == 1


def test_a_histogram_the_cache_does_not_hold_is_a_miss(client, layout, resolves):
    plain = grouping([{"source": CELL_TYPE}, SCORE_BIN])
    asked = grouping([{"source": CELL_TYPE}, SCORE_BIN], want={"histograms": [1]})
    run(client, layout, plain)
    frames, _ = run(client, layout, asked)
    assert frames[0]["codes"] == "miss" and "histogram" in frames[-1]["partitionings"][1]
    assert run(client, layout, plain)[0][0]["codes"] == "hit" and len(resolves) == 2


# --- the ledger and the budget (CMP-15) --------------------------------------------------------------------------------

def test_the_cache_counts_on_the_ledger_and_is_emptied_before_a_reservation_waits(client, layout):
    run(client, layout, grouping([{"source": CELL_TYPE}]))
    assert route.CODES.size() >= N and cstream.LEDGER.held() == 0
    start = time.monotonic()
    everything = cstream.LEDGER.reserve(cstream.LEDGER.bound, 0.0, "everything")     # would not fit beside it
    try:
        assert time.monotonic() - start < 1.0 and everything.nbytes == cstream.LEDGER.bound
        assert route.CODES.size() == 0 and len(route.CODES) == 0
    finally:
        everything.release()
    assert run(client, layout, grouping([{"source": CELL_TYPE}]))[0][0]["codes"] == "miss"
    assert len(route.CODES) == 1


def test_no_grouping_is_kept_in_room_the_ledger_has_reserved(client, layout, monkeypatch):
    real = cstream.LEDGER.held
    monkeypatch.setattr(cstream.LEDGER, "held", lambda: cstream.LEDGER.bound)   # every byte reserved elsewhere
    run(client, layout, grouping([{"source": CELL_TYPE}]))
    assert len(route.CODES) == 0
    monkeypatch.setattr(cstream.LEDGER, "held", real)
    run(client, layout, grouping([{"source": CELL_TYPE}]))
    assert len(route.CODES) == 1


def test_a_grouping_is_kept_within_the_servers_code_cache_setting(layout, tmp_path, monkeypatch, resolves):
    monkeypatch.setattr(cstream, "CODE_CACHE_BYTES", cstream.CODE_CACHE_BYTES)
    app = create_app({"TESTING": True, "data_dir": str(layout / "data"), "log_file": str(tmp_path / "t.log"),
                      "group_code_cache_mb": 1})                       # the smallest the setting takes
    assert cstream.CODE_CACHE_BYTES == 1 << 20
    client = app.test_client()
    body = grouping([{"source": CELL_TYPE}])
    assert [run(client, layout, body)[0][0]["codes"] for _ in range(2)] == ["miss", "hit"]
    route.CODES.clear()
    monkeypatch.setattr(cstream, "CODE_CACHE_BYTES", N // 2)           # half the codes of one grouping
    assert [run(client, layout, body)[0][0]["codes"] for _ in range(2)] == ["miss", "miss"]
    assert len(route.CODES) == 0 and len(resolves) == 3


# --- a session opening: one grouping and three dependants (CMP-6) -----------------------------------------------------

def _stream(client, layout, body, out, i, name="in.zarr"):
    resp = post(client, layout, body, name=name)
    out[i] = (resp.status_code, parse(resp.get_data())[0])


def test_a_session_opening_with_three_dependants_resolves_the_grouping_once(client, layout, monkeypatch, resolves):
    gate = threading.Event()
    real = cg.compute

    def held(plan_, *a, **k):                                         # the panel's resolve takes a while
        for event in real(plan_, *a, **k):
            if event[0] == "result":
                gate.wait(10)
            yield event
    monkeypatch.setattr(cg, "compute", held)
    parts = [{"source": CELL_TYPE}, SCORE_BIN]
    panel = grouping(parts, want={"histograms": [1]})
    dependants = [grouping(parts, features=[{**FEATURE, "name": gstore.gene(i)}]) for i in (1, 2, 3)]
    out = [None] * 4
    threads = [threading.Thread(target=_stream, args=(client, layout, panel, out, 0))]
    misses = route.CODES.stats["misses"]
    threads[0].start()
    claimed(misses)
    for i, body in enumerate(dependants, start=1):
        threads.append(threading.Thread(target=_stream, args=(client, layout, body, out, i)))
        threads[-1].start()
    time.sleep(0.2)
    gate.set()
    for t in threads:
        t.join(20)
    assert all(not t.is_alive() for t in threads)
    assert [o[0] for o in out] == [200] * 4
    starts = [next(f for f in o[1] if f["type"] == "start") for o in out]
    assert [s["codes"] for s in starts] == ["miss", "hit", "hit", "hit"]
    assert len(resolves) == 1
    assert all(o[1][-1]["type"] == "result" and o[1][-1]["features"] == [{"id": "f0", "status": "ok"}]
               for o in out[1:])


def test_a_waiter_resolves_on_its_own_when_the_resolve_it_waited_for_fails(client, layout, monkeypatch, resolves):
    gate = threading.Event()
    real = cg.compute
    calls = []

    def first_fails(plan_, *a, **k):
        calls.append(1)
        if len(calls) == 1:
            gate.wait(10)
            raise OSError("disk gone")
        yield from real(plan_, *a, **k)
    monkeypatch.setattr(cg, "compute", first_fails)
    body = grouping([{"source": CELL_TYPE}])
    out = [None] * 2
    first = threading.Thread(target=_stream, args=(client, layout, body, out, 0))
    misses = route.CODES.stats["misses"]
    first.start()
    claimed(misses)
    waits = route.CODES.stats["waits"]
    second = threading.Thread(target=_stream, args=(client, layout, body, out, 1))
    second.start()
    time.sleep(0.2)
    assert route.CODES.stats["waits"] > waits
    gate.set()
    first.join(10)
    second.join(10)
    assert out[0][1][-1]["type"] == "error" and out[1][1][-1]["type"] == "result"
    assert out[1][1][0]["codes"] == "miss" and len(route.CODES) == 1


def test_a_heavy_request_waiting_on_a_heavy_resolve_gives_it_the_lane(client, layout, monkeypatch):
    """Both take the heavy slot (a gene of a CSR store): the waiter, holding the slot, must give it back to the job
    resolving its grouping, or neither ends."""
    gate = threading.Event()
    real = cg.compute
    first = []

    def slow(plan_, *a, **k):
        pause = k.get("pause")
        if not first:
            first.append(1)
            while not gate.is_set():                                   # between slabs: may give way
                if pause is not None and pause.wanted():
                    pause.wait()
                time.sleep(0.01)
        yield from real(plan_, *a, **k)
    monkeypatch.setattr(cg, "compute", slow)
    body = grouping([{"source": GENE1}])
    out = [None] * 2
    a = threading.Thread(target=_stream, args=(client, layout, body, out, 0, "csr.zarr"))
    misses = route.CODES.stats["misses"]
    a.start()
    claimed(misses)
    b = threading.Thread(target=_stream, args=(client, layout, body, out, 1, "csr.zarr"))
    b.start()
    time.sleep(0.5)                                                    # b runs, waits, and gives way to a again
    gate.set()
    a.join(15)
    b.join(15)
    assert not a.is_alive() and not b.is_alive()
    assert out[0][1][0]["lane"] == "heavy" and out[0][1][-1]["type"] == "result"
    starts = [f for f in out[1][1] if f["type"] == "start"]
    assert starts[0]["codes"] == "hit" and out[1][1][-1]["type"] == "result"
    assert cstream.LEDGER.held() == 0


# --- a dependant's claim is filled before its genes are read (FX-E's grouping event) ------------------------------------

def test_a_second_dependant_waits_for_the_first_ones_claim_and_hits(client, layout, monkeypatch, resolves):
    gate = threading.Event()
    real = cg.compute

    def held(plan_, *a, **k):                                         # the first dependant's resolve takes a while
        for event in real(plan_, *a, **k):
            if event[0] == "result":
                gate.wait(10)
            yield event
    monkeypatch.setattr(cg, "compute", held)
    parts = [{"source": CELL_TYPE}, SCORE_BIN]
    first, second = (grouping(parts, features=[{**FEATURE, "name": gstore.gene(i)}]) for i in (1, 2))
    out = [None] * 2
    misses = route.CODES.stats["misses"]
    a = threading.Thread(target=_stream, args=(client, layout, first, out, 0))
    a.start()
    claimed(misses)
    waits = route.CODES.stats["waits"]
    b = threading.Thread(target=_stream, args=(client, layout, second, out, 1))
    b.start()
    deadline = time.monotonic() + 5
    while route.CODES.stats["waits"] == waits and time.monotonic() < deadline:
        time.sleep(0.01)
    assert route.CODES.stats["waits"] > waits                        # it waits for the first one's claim
    gate.set()
    a.join(20)
    b.join(20)
    assert [o[1][0]["codes"] for o in out] == ["miss", "hit"] and len(resolves) == 1
    assert [o[1][-1]["features"] for o in out] == [[{"id": "f0", "status": "ok"}]] * 2


def test_the_claim_is_filled_before_the_genes_are_read(client, layout, monkeypatch):
    seen = []
    real = gf.accumulate

    def watched(*a, **k):
        seen.append(len(route.CODES))
        yield from real(*a, **k)
    monkeypatch.setattr(gf, "accumulate", watched)
    run(client, layout, grouping([{"source": CELL_TYPE}], features=[FEATURE]))
    assert seen and all(n == 1 for n in seen)                         # kept before any gene is read


# --- a hit takes the lane of what it still reads ------------------------------------------------------------------------

def test_a_hit_on_a_heavy_grouping_does_not_queue_behind_a_heavy_job(client, layout):
    body = grouping([{"source": GENE1}])
    cold, _ = run(client, layout, body, name="csr.zarr")
    assert cold[0]["lane"] == "heavy" and cold[0]["codes"] == "miss"     # a gene of a CSR store: a whole-matrix read
    held = cstream.LANES.enter("heavy")
    assert held.running
    try:
        frames, _ = run(client, layout, body, name="csr.zarr")
    finally:
        held.leave()
    assert frames[0]["type"] == "start" and frames[0]["codes"] == "hit" and frames[0]["lane"] == "light"
    assert frames[-1]["type"] == "result" and frames[-1] == cold[-1]


def test_a_hit_reserves_only_what_it_still_reads(client, layout):
    body = grouping([{"source": GENE1}])
    path = ds(layout, "csr.zarr")
    plan = gf.plan(get_reader(path), path, cg.parse_request(body))
    full, _ = route.reservation(plan, N)
    run(client, layout, body, name="csr.zarr")
    resp = post(client, layout, body, name="csr.zarr", buffered=False)
    try:
        chunks = resp.iter_encoded()
        assert json.loads(next(chunks))["codes"] == "hit"
        held = cstream.LEDGER.held()
    finally:
        resp.close()
    assert held == route.reservation(plan, N, codes_held=True)[0] < full
    assert held == 0                                                  # no feature, no measure: nothing to read


def test_a_hit_with_a_feature_takes_the_features_lane(client, layout):
    body = grouping([{"source": GENE1}], features=[{**FEATURE, "name": gstore.gene(2)}])
    run(client, layout, body, name="csr.zarr")
    held = cstream.LANES.enter("heavy")
    try:
        resp = post(client, layout, body, name="csr.zarr", buffered=False)
        first = json.loads(next(resp.iter_encoded()))
        resp.close()
    finally:
        held.leave()
    assert first["type"] == "progress" and first["queue"]["ahead"] == 1   # a gene of a CSR store: still heavy
