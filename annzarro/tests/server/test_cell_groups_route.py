"""POST /api/v1/data/cell_groups (annzarro/server/routes/cell_groups.py): the contract of the route (SHR-29, SHR-32,
SHR-33, SHR-41, SHR-47, CMP-5, CMP-9).

The arithmetic is the engine's (tests/core/test_cell_groups.py, test_cell_grid.py, test_group_features.py); these
tests cover what the route adds: the access gate, the forged request, the body limit, unknown fields, both shapes,
the estimate and the cost tiers (409, 413, 422), the lane the estimate chooses, the ledger, the stream, bitsets and
subsets, and a closed connection.
"""
import base64
import io
import json
import re
import threading
import time

import numpy as np
import pytest
from flask.testing import FlaskClient

from annzarro.core import cell_groups as cg
from annzarro.core import cell_grid
from annzarro.core import cell_sources
from annzarro.core import gene_score as gsc
from annzarro.core import get_reader
from annzarro.core import group_features as gf
from annzarro.core import subset as cell_subset
from annzarro.core import zarr_reader
from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.server.routes import cell_groups as route
from annzarro.server.routes import compute_stream as cstream
from annzarro.tests.core import grouping_store as gstore
from annzarro.tests.server.test_data_access_matrix import RESTRICTED, USERS, PASSWORD, inject_deny_list
from annzarro.tests.server.test_gene_score_route import signed_in

URL = "/api/v1/data/cell_groups"
N = gstore.N_OBS
CELL_TYPE = {"type": "obs", "key": "cell_type"}
GENE1 = {"type": "layer", "key": "logged", "column": gstore.gene(1)}


@pytest.fixture(scope="module")
def data():
    return gstore.make_data()


@pytest.fixture(scope="module")
def layout(tmp_path_factory):
    base = tmp_path_factory.mktemp("cgroute")
    (base / "data").mkdir()
    gstore.make_store(base / "data" / "in.zarr", "csc", "zarr")
    gstore.make_store(base / "data" / "out.zarr", "csc", "zarr")
    gstore.make_store(base / "data" / "csr.zarr", "csr", "zarr")
    gstore.make_store(base / "data" / "cells.h5ad", "csc", "h5ad")
    return base


@pytest.fixture(autouse=True)
def fresh():
    zarr_reader.clear_cache()
    cell_subset.clear()
    yield
    zarr_reader.clear_cache()
    cell_subset.clear()


@pytest.fixture
def app(layout, tmp_path):
    return create_app({"TESTING": True, "data_dir": str(layout / "data"), "log_file": str(tmp_path / "t.log")})


@pytest.fixture
def client(app):
    return app.test_client()


def ds(layout, name="in.zarr"):
    return str(layout / "data" / name)


def post(client, layout, body, name="in.zarr", query=None, **kw):
    query = {"dataset_path": ds(layout, name), **(query or {})}
    return client.post(URL, query_string=query, data=json.dumps(body), content_type="application/json", **kw)


def parse(data):
    """(frames, blocks): the JSON frames of a stream, and the arrays its result frame lists, by name."""
    frames, blocks, pos = [], {}, 0
    while pos < len(data):
        end = data.index(b"\n", pos)
        frame = json.loads(data[pos:end])
        frames.append(frame)
        pos = end + 1
        if frame["type"] == "result":
            for b in frame.get("blocks", []):
                dtype = np.dtype(b["dtype"]).newbyteorder("<")
                shape = tuple(b.get("shape", (b["length"],)))
                nbytes = int(np.prod(shape)) * dtype.itemsize
                blocks[b["name"]] = np.frombuffer(data[pos:pos + nbytes], dtype=dtype).reshape(shape)
                pos += nbytes
    return frames, blocks


def run(client, layout, body, name="in.zarr"):
    resp = post(client, layout, body, name=name)
    assert resp.status_code == 200, resp.get_data(as_text=True)
    return parse(resp.get_data())


def grouping(parts, **kw):
    return {"shape": "grouping", "partitionings": parts, **kw}


def bitset(mask):
    return {"encoding": "bitset-base64", "length": int(mask.size),
            "data": base64.b64encode(np.packbits(mask, bitorder="little").tobytes()).decode()}


# --- the stream: both shapes ---------------------------------------------------------------------------------------

def test_a_grouping_streams_start_progress_result_then_its_codes(client, layout, data):
    resp = post(client, layout, grouping([{"source": CELL_TYPE}], want={"codes": True}))
    assert resp.status_code == 200 and resp.mimetype == route.MIMETYPE
    assert resp.headers["Cache-Control"] == "no-store" and "Content-Encoding" not in resp.headers
    frames, blocks = parse(resp.get_data())
    kinds = [f["type"] for f in frames]
    assert kinds[0] == "start" and kinds[-1] == "result" and set(kinds[1:-1]) == {"progress"}
    start = frames[0]
    assert (start["codes"], start["lane"], start["queue"]) == ("miss", "light", {"ahead": 0, "sharing": 0})
    assert start["entries_total"] == 0
    assert all("queue" in f and "running_s" in f and "entries_total" in f for f in frames[1:-1])
    assert (frames[1]["stage"], frames[1]["done"], frames[1]["total"]) == ("groups", 0, 1)
    result = frames[-1]
    assert (result["shape"], result["n_shown"], result["n_grouped"]) == ("grouping", N, N)
    want = data.obs["cell_type"].value_counts()
    assert {g["key"][0]: g["n"] for g in result["groups"]} == {f"c:{k}": int(v) for k, v in want.items()}
    assert result["blocks"] == [{"name": "codes", "dtype": "uint8", "length": N}]
    codes = blocks["codes"]
    assert codes.shape == (N,) and np.bincount(codes, minlength=len(result["groups"])).tolist() == \
        [g["n"] for g in result["groups"]]


def test_codes_are_sent_only_when_asked(client, layout):
    frames, blocks = run(client, layout, grouping([{"source": CELL_TYPE}]))
    assert blocks == {} and frames[-1]["blocks"] == []
    frames, blocks = run(client, layout, grouping([{"source": CELL_TYPE}], want={"codes": False}))
    assert blocks == {}


def test_a_feature_comes_back_as_moments_per_group(client, layout, data):
    feature = {"id": "f0", "kind": "gene", "name": gstore.gene(1), "layer": "X", "detect_above": 0}
    frames, blocks = run(client, layout, grouping([{"source": CELL_TYPE}], features=[feature]))
    result = frames[-1]
    assert result["features"] == [{"id": "f0", "status": "ok"}] and result["moments"] == list(gf.MOMENTS)
    moments = blocks["feature_moments"]
    assert moments.dtype == np.float64 and moments.shape == (1, len(result["groups"]), 5)
    x = data.x[:, 1].astype(np.float64)
    for g, row in zip(result["groups"], moments[0]):
        cells = (data.obs["cell_type"] == g["key"][0][2:]).to_numpy()
        assert row[0] == cells.sum() and row[1] == pytest.approx(x[cells].sum(), rel=1e-6)
    assert [b["name"] for b in result["blocks"]] == ["feature_moments"]
    assert [f["type"] for f in frames].count("progress") >= 2 and \
        any(f.get("stage") == "features" for f in frames if f["type"] == "progress")


def test_a_measure_and_a_missing_gene_are_reported(client, layout):
    parts = [{"source": CELL_TYPE}]
    frames, blocks = run(client, layout, grouping(parts, features=[
        {"id": "f0", "kind": "gene", "name": "NOPE"}, {"id": "f1", "kind": "gene", "name": gstore.gene(2)}],
        measures=[{"id": "m0", "source": {"type": "obs", "key": "score"}, "above": 0}]))
    result = frames[-1]
    assert [f["status"] for f in result["features"]] == ["missing", "ok"]
    assert [m["status"] for m in result["measures"]] == ["ok"]
    assert blocks["measure_moments"].shape == (1, len(result["groups"]), 5)


def test_a_grid_streams_its_counts(client, layout, data):
    body = {"shape": "grid", "mode": "1d", "partitionings": [{"source": CELL_TYPE}]}
    frames, blocks = run(client, layout, body)
    kinds = [f["type"] for f in frames]
    assert kinds[0] == "start" and kinds[-1] == "result" and frames[0]["lane"] == "light" and "codes" not in frames[0]
    result = frames[-1]
    assert (result["shape"], result["mode"], result["n_shown"]) == ("grid", "1d", N)
    counts = blocks["counts"]
    assert counts.dtype == np.uint32 and int(counts.sum()) == result["n_counted"] == N
    levels = result["axes"][0]["levels"]
    want = data.obs["cell_type"].value_counts()
    assert dict(zip(levels, counts.tolist())) == {f"c:{k}": int(v) for k, v in want.items()}
    assert result["axes"][0]["n_outside"] == [0, 0] and "codes" not in blocks


def test_a_grid_with_a_measure_streams_its_moments(client, layout):
    body = {"shape": "grid", "mode": "1d", "partitionings": [{"source": CELL_TYPE}],
            "measures": [{"id": "m0", "source": {"type": "obs", "key": "score"}}]}
    frames, blocks = run(client, layout, body)
    assert frames[-1]["measures"] == [{"id": "m0", "status": "ok"}]
    assert blocks["measure_moments"].shape == (1, blocks["counts"].size, 5)


def test_an_h5ad_store_is_grouped_like_a_zarr_one(client, layout):
    parts = grouping([{"source": CELL_TYPE}], want={"codes": True})
    a, ba = run(client, layout, parts)
    b, bb = run(client, layout, parts, name="cells.h5ad")
    assert a[-1]["groups"] == b[-1]["groups"]
    np.testing.assert_array_equal(ba["codes"], bb["codes"])


def test_a_grouping_over_the_limit_is_a_result_that_says_so(client, layout):
    frames, blocks = run(client, layout, grouping([{"source": {"type": "obs", "key": "many"}}]))
    refused = frames[-1]["refused"]
    assert frames[-1]["type"] == "result" and refused["reason"] == "too_many_levels" and blocks == {}
    assert refused["limit"] == 2000


def test_a_stream_that_fails_after_it_began_ends_in_an_error_frame(client, layout, monkeypatch):
    real = gf.compute

    def broken(*a, **k):
        events = real(*a, **k)
        yield next(events)
        raise OSError("disk gone")
    monkeypatch.setattr(gf, "compute", broken)
    resp = post(client, layout, grouping([{"source": CELL_TYPE}]))
    frames, _ = parse(resp.get_data())
    assert resp.status_code == 200 and frames[-1]["type"] == "error" and frames[-1]["reason"] == "read_failed"
    assert "disk gone" in frames[-1]["message"] and "result" not in [f["type"] for f in frames]
    assert cstream.LEDGER.held() == 0
    job = cstream.LANES.enter("light")
    assert job.running
    job.leave()


# --- the estimate and the cost tiers --------------------------------------------------------------------------------

def test_estimate_only_reads_nothing(client, layout, monkeypatch):
    monkeypatch.setattr(cg, "compute", lambda *a, **k: pytest.fail("estimate_only computed"))
    monkeypatch.setattr(gf, "compute", lambda *a, **k: pytest.fail("estimate_only computed"))
    body = grouping([{"source": CELL_TYPE}], features=[{"id": "f0", "kind": "gene", "name": "NOPE"}],
                    estimate_only=True)
    resp = post(client, layout, body)
    out = resp.get_json()
    assert resp.status_code == 200 and resp.mimetype == "application/json"
    est = out["estimate"]
    assert (est["tier"], est["lane"], est["n_cells"]) == ("auto", "light", N)
    assert (est["live_max_s"], est["auto_max_s"], est["max_s"]) == (5.0, 60.0, 600.0)
    assert out["missing"] == {"genes": ["NOPE"]}
    grid = post(client, layout, {"shape": "grid", "mode": "1d", "partitionings": [{"source": CELL_TYPE}],
                                 "estimate_only": True}).get_json()
    assert grid["estimate"]["cells"] == len(gstore.CELL_TYPES) and grid["estimate"]["lane"] == "light"


def _slow(monkeypatch, layout_name, seconds):
    monkeypatch.setitem(gsc.RATES, layout_name, 1.0 / seconds)


def test_a_request_between_the_limits_asks_for_one_confirmation(client, layout, monkeypatch):
    body = grouping([{"source": GENE1}])
    entries = post(client, layout, {**body, "estimate_only": True}).get_json()["estimate"]["entries"]
    monkeypatch.setitem(gsc.RATES, "csc", entries / 120.0)
    est = post(client, layout, {**body, "estimate_only": True}).get_json()["estimate"]
    assert est["tier"] == "confirm" and 60 < est["seconds"] <= 600
    resp = post(client, layout, body)
    assert resp.status_code == 409 and resp.get_json()["reason"] == "confirmation_required"
    assert resp.get_json()["estimate"]["tier"] == "confirm"
    resp = post(client, layout, {**body, "confirm": True})
    assert resp.status_code == 200 and parse(resp.get_data())[0][-1]["type"] == "result"


def test_a_request_above_ten_minutes_is_refused_even_when_confirmed(client, layout, monkeypatch):
    body = grouping([{"source": GENE1}])
    entries = post(client, layout, {**body, "estimate_only": True}).get_json()["estimate"]["entries"]
    monkeypatch.setitem(gsc.RATES, "csc", entries / 3000.0)
    assert post(client, layout, {**body, "estimate_only": True}).get_json()["estimate"]["tier"] == "refused"
    for extra in ({}, {"confirm": True}):
        resp = post(client, layout, {**body, **extra})
        assert resp.status_code == 413 and resp.get_json()["reason"] == "groups_too_expensive"
        assert "minutes" in resp.get_json()["error"] and resp.get_json()["estimate"]["tier"] == "refused"
        assert resp.mimetype == "application/json"


def test_a_refused_csr_request_names_the_way_out(client, layout, monkeypatch):
    monkeypatch.setitem(gsc.RATES, "csr", 1.0)
    resp = post(client, layout, grouping([{"source": GENE1}]), name="csr.zarr")
    assert resp.status_code == 413 and "CSC" in resp.get_json()["error"]


def test_a_grid_over_its_limit_is_a_422_with_the_count_and_the_limit(client, layout):
    axis = {"source": {"type": "obs", "key": "score"}, "binning": {"method": "equal_width", "bins": 400}}
    resp = post(client, layout, {"shape": "grid", "mode": "2d", "partitionings": [axis, axis, axis]})
    out = resp.get_json()
    assert resp.status_code == 422 and out["reason"] in ("grid_too_large", "too_many_bins") and out["error"]
    assert out["limit"] and out["count"] > out["limit"]
    sets = [{"source": {"type": "obs", "key": "is_doublet"}}] * 17
    resp = post(client, layout, {"shape": "grid", "mode": "sets", "partitionings": sets})
    assert resp.status_code == 422 and resp.get_json()["reason"] == "too_many_sets"
    assert (resp.get_json()["count"], resp.get_json()["limit"]) == (17, 16)


# --- the lane is chosen by the estimate (SHR-41) --------------------------------------------------------------------

def lane_of(client, layout, body, name="in.zarr"):
    return post(client, layout, {**body, "estimate_only": True}, name=name).get_json()["estimate"]["lane"]


def test_a_layer_partitioning_on_a_csr_store_takes_the_heavy_slot(client, layout):
    body = grouping([{"source": GENE1}])
    assert lane_of(client, layout, body) == "light"                            # by gene, inside the live tier
    assert lane_of(client, layout, body, name="csr.zarr") == "heavy"           # a whole-matrix read
    frames, _ = run(client, layout, body, name="csr.zarr")
    assert frames[0]["type"] == "start" and frames[0]["lane"] == "heavy"


def test_a_wide_obsm_column_and_anything_past_the_live_tier_take_the_heavy_slot(client, layout, monkeypatch):
    wide = grouping([{"source": {"type": "obsm", "key": "X_wide", "column": "3"}}])
    assert lane_of(client, layout, wide) == "light"
    monkeypatch.setitem(gsc.RATES, "dense", gstore.N_OBS * 50 / 30.0)          # the whole matrix takes 30 s
    assert lane_of(client, layout, wide) == "heavy"
    assert lane_of(client, layout, grouping([{"source": CELL_TYPE}])) == "light"
    monkeypatch.setitem(gsc.RATES, "csc", 1.0)                                  # a gene past the live tier
    assert lane_of(client, layout, grouping([{"source": GENE1}])) == "heavy"


def test_a_gene_feature_on_a_csr_store_is_heavy_and_a_csc_one_light(client, layout):
    body = grouping([{"source": CELL_TYPE}], features=[{"id": "f0", "kind": "gene", "name": gstore.gene(1)}])
    assert lane_of(client, layout, body) == "light"
    assert lane_of(client, layout, body, name="csr.zarr") == "heavy"
    grid = {"shape": "grid", "mode": "1d", "partitionings": [{"source": CELL_TYPE}],
            "measures": [{"id": "m0", "source": GENE1}]}
    assert lane_of(client, layout, grid, name="csr.zarr") == "heavy"


def _first_frame(chunks):
    return json.loads(next(chunks))


def test_a_heavy_request_waits_for_the_slot_and_tells_its_place(client, layout):
    held = cstream.LANES.enter("heavy")
    assert held.running
    resp = post(client, layout, grouping([{"source": GENE1}]), name="csr.zarr", buffered=False)
    try:
        chunks = resp.iter_encoded()
        first = _first_frame(chunks)
        assert first["type"] == "progress" and first["queue"] == {"ahead": 1, "sharing": 0}
        assert first["done"] == 0 and first["entries_done"] == 0 and "running_s" in first
        threading.Timer(0.2, held.leave).start()
        rest = [json.loads(c) for c in chunks if c.startswith(b"{")]
        assert rest[0]["type"] == "start" and rest[0]["lane"] == "heavy" and rest[-1]["type"] == "result"
    finally:
        resp.close()
        held.leave()


def test_a_light_request_never_waits_on_the_heavy_slot(client, layout):
    held = cstream.LANES.enter("heavy")
    try:
        frames, _ = run(client, layout, grouping([{"source": CELL_TYPE}]))
        assert frames[0]["type"] == "start" and frames[0]["lane"] == "light"
    finally:
        held.leave()


def test_a_wait_past_the_limit_is_a_read_busy_error_frame(client, layout, monkeypatch):
    monkeypatch.setattr(route, "QUEUE_WAIT_S", 0.2)
    held = cstream.LANES.enter("heavy")
    try:
        resp = post(client, layout, grouping([{"source": GENE1}]), name="csr.zarr")
        frames, _ = parse(resp.get_data())
    finally:
        held.leave()
    assert resp.status_code == 200 and [f["type"] for f in frames] == ["progress", "error"]
    assert frames[1]["reason"] == "read_busy"
    assert frames[0]["queue"] == {"ahead": 1, "sharing": 0}


# --- the ledger -----------------------------------------------------------------------------------------------------

def _plan(layout, body, name="in.zarr"):
    path = ds(layout, name)
    return gf.plan(get_reader(path), path, cg.parse_request(body))


MB = 2 ** 20


def test_a_resolve_is_charged_its_codes_its_column_and_the_slab_temporaries(layout):
    n = N
    full, keep = route.reservation(_plan(layout, grouping([{"source": CELL_TYPE}])), n)
    assert full == 2 * n + 100 * MB and keep == 2 * n
    one = [{"source": {"type": "obs", "key": "score"}, "binning": {"method": "equal_width", "bins": 4}}]
    full, keep = route.reservation(_plan(layout, grouping(one)), n)
    assert full == 2 * n + 8 * n + 100 * MB                                    # a float64 column of the cells shown
    allcells = [{**one[0], "binning": {"method": "equal_width", "bins": 4, "edges_from": "all"}}]
    full, _ = route.reservation(_plan(layout, grouping(allcells)), 300)
    assert full == 2 * 300 + 8 * N + 100 * MB                                  # edges_from all: the column of every cell
    two = [{"source": CELL_TYPE}, {"source": {"type": "obs", "key": "condition"}}]
    full, _ = route.reservation(_plan(layout, grouping(two)), n)
    assert full == 2 * n + n + 100 * MB                                        # the byte slot array of an intersection


def test_a_score_partitioning_adds_its_own_reservation(layout):
    recipe = {"genes": [gstore.gene(1), gstore.gene(2)], "method": "mean", "input": "logged"}
    part = {"source": {"type": "gene-score", "column": "mean", "layer": "logged", "recipe": recipe}}
    plan = _plan(layout, grouping([part]))
    full, keep = route.reservation(plan, N)
    score = plan.groups.top.parts[0].score
    own = N * (8 + 2) * score.vectors + min(gsc.READ_AHEAD_ENTRIES, score.entries) * 12
    assert full == 2 * N + 8 * N + 4 * N + own + 100 * MB
    assert keep < full and keep >= 2 * N


def test_features_add_their_read_ahead_and_their_segments(layout):
    plain = _plan(layout, grouping([{"source": CELL_TYPE}]))
    plan = _plan(layout, grouping([{"source": CELL_TYPE}], features=[{"id": "f0", "kind": "gene", "name": gstore.gene(1)}]))
    extra = route.reservation(plan, N)[0] - route.reservation(plain, N)[0]
    assert extra > 0 and extra >= 12 * min(gf.READ_AHEAD_ENTRIES, plan.work.entries)


def test_the_ledger_holds_a_request_while_it_streams_and_gives_it_back(client, layout):
    want, _ = route.reservation(_plan(layout, grouping([{"source": CELL_TYPE}])), N)
    assert cstream.LEDGER.held() == 0
    resp = post(client, layout, grouping([{"source": CELL_TYPE}]), buffered=False)
    chunks = resp.iter_encoded()
    _first_frame(chunks)
    assert cstream.LEDGER.held() == want
    list(chunks)
    resp.close()
    assert cstream.LEDGER.held() == 0


def test_a_resolve_that_does_not_fit_waits_for_the_ledger(client, layout, monkeypatch):
    monkeypatch.setattr(route, "QUEUE_WAIT_S", 5.0)
    everything = cstream.LEDGER.reserve(cstream.LEDGER.bound, 0, "everything")
    threading.Timer(0.3, everything.release).start()
    start = time.monotonic()
    resp = post(client, layout, grouping([{"source": CELL_TYPE}]))
    frames, _ = parse(resp.get_data())
    assert time.monotonic() - start >= 0.25
    kinds = [f["type"] for f in frames]
    assert kinds[0] == "progress" and frames[0]["queue"] == {"ahead": 0, "sharing": 0}     # told at once
    assert kinds[1] == "start" and kinds[-1] == "result"


def test_a_wait_for_the_ledger_past_the_limit_is_read_busy(client, layout, monkeypatch):
    monkeypatch.setattr(route, "QUEUE_WAIT_S", 0.2)
    everything = cstream.LEDGER.reserve(cstream.LEDGER.bound, 0, "everything")
    try:
        frames, _ = parse(post(client, layout, grouping([{"source": CELL_TYPE}])).get_data())
    finally:
        everything.release()
    assert [f["type"] for f in frames] == ["progress", "error"] and frames[1]["reason"] == "read_busy"
    assert cstream.LEDGER.held() == 0


def test_a_smaller_budget_makes_a_request_wait_for_the_other(layout, tmp_path, monkeypatch):
    monkeypatch.setattr(cstream.LEDGER, "bound", cstream.LEDGER.bound)
    app = create_app({"TESTING": True, "data_dir": str(layout / "data"), "log_file": str(tmp_path / "t.log"),
                      "compute_budget_mb": 150})
    assert cstream.LEDGER.bound == 150 * MB
    want, _ = route.reservation(_plan(layout, grouping([{"source": CELL_TYPE}])), N)
    assert 100 * MB < want < 150 * MB < 2 * want                  # one fits, two do not
    client = app.test_client()
    first = post(client, layout, grouping([{"source": CELL_TYPE}]), buffered=False)
    second = None
    try:
        chunks = first.iter_encoded()
        _first_frame(chunks)
        second = post(client, layout, grouping([{"source": CELL_TYPE}]), buffered=False)
        told = _first_frame(second.iter_encoded())
        assert told["type"] == "progress" and told["done"] == 0                  # the second is queued on the ledger
        list(chunks)
    finally:
        first.close()
        if second is not None:
            second.close()


# --- cancelling -----------------------------------------------------------------------------------------------------

def test_closing_the_response_stops_the_work_and_frees_the_lane_and_the_ledger(client, layout, monkeypatch):
    seen = []
    real = cg.compute

    def slow(*a, **k):
        for event in real(*a, **k):
            seen.append(event[0])
            time.sleep(0.05)
            yield event
    monkeypatch.setattr(cg, "compute", slow)
    parts = [{"source": {"type": "obs", "key": k}} for k in ("cell_type", "condition", "sample", "batch")]
    resp = post(client, layout, grouping(parts), buffered=False)
    chunks = resp.iter_encoded()
    _first_frame(chunks)
    next(chunks)
    resp.close()                                                  # the page went away
    count = len(seen)
    time.sleep(0.3)
    assert len(seen) == count and "result" not in seen
    assert cstream.LEDGER.held() == 0
    job = cstream.LANES.enter("heavy")
    assert job.running
    job.leave()


# --- bitsets and subsets -----------------------------------------------------------------------------------------

def test_a_table_partitioning_is_in_or_out(client, layout):
    mask = np.zeros(N, dtype=bool)
    mask[:350] = True
    body = grouping([{"source": {"type": "table", "ref": "s0"}}], sets={"s0": bitset(mask)})
    frames, _ = run(client, layout, body)
    assert {tuple(g["key"]): g["n"] for g in frames[-1]["groups"]} == {("@in",): 350, ("@out",): N - 350}


@pytest.mark.parametrize("sets,reason", [
    ({"s0": {"encoding": "bitset-base64", "length": 8, "data": "!!!"}}, "bad_set"),
    ({"s0": {"encoding": "raw", "length": 8, "data": "AA=="}}, "bad_set"),
    ({"s0": {"encoding": "bitset-base64", "length": 16, "data": "AA=="}}, "bad_set"),
    ({"s0": {"encoding": "bitset-base64", "length": 4, "data": "/w=="}}, "bad_set"),
    ({"s0": bitset(np.ones(N - 1, dtype=bool))}, "set_length_mismatch"),
    ({"s0": bitset(np.ones(N + 8, dtype=bool))}, "set_length_mismatch"),
    ({}, "set_missing"),
])
def test_a_bitset_that_is_not_one_is_refused_before_anything_is_read(client, layout, monkeypatch, sets, reason):
    monkeypatch.setattr(cg, "compute", lambda *a, **k: pytest.fail("computed"))
    monkeypatch.setattr(gf, "compute", lambda *a, **k: pytest.fail("computed"))
    resp = post(client, layout, grouping([{"source": {"type": "table", "ref": "s0"}}], sets=sets))
    assert resp.status_code == 400 and resp.get_json()["reason"] == reason and resp.get_json()["error"]


def test_a_grid_checks_its_bitsets_too(client, layout):
    sets = {"s0": bitset(np.ones(N - 1, dtype=bool)), "s1": bitset(np.ones(N - 1, dtype=bool))}
    parts = [{"source": {"type": "table", "ref": "s0"}}, {"source": {"type": "table", "ref": "s1"}}]
    resp = post(client, layout, {"shape": "grid", "mode": "sets", "partitionings": parts, "sets": sets})
    assert resp.status_code == 400 and resp.get_json()["reason"] == "set_length_mismatch"


SUBSET = {"n": 37, "seed": 5}


@pytest.mark.parametrize("subset", [SUBSET, json.dumps(SUBSET)])
def test_a_subset_groups_the_cells_it_shows(client, layout, data, subset):
    frames, blocks = run(client, layout, grouping([{"source": CELL_TYPE}], subset=subset, want={"codes": True}))
    rows, _ = cell_subset.select_indices(N, cell_subset.parse_spec(SUBSET), None)
    assert frames[-1]["n_shown"] == 37 and blocks["codes"].shape == (37,)
    want = data.obs["cell_type"].iloc[rows].value_counts()
    assert {g["key"][0]: g["n"] for g in frames[-1]["groups"]} == {f"c:{k}": int(v) for k, v in want.items() if v}


def test_a_table_over_a_subset_is_the_length_of_the_cells_shown(client, layout):
    mask = np.zeros(37, dtype=bool)
    mask[:10] = True
    body = grouping([{"source": {"type": "table", "ref": "s0"}}], sets={"s0": bitset(mask)}, subset=SUBSET)
    frames, _ = run(client, layout, body)
    assert {tuple(g["key"]): g["n"] for g in frames[-1]["groups"]} == {("@in",): 10, ("@out",): 27}
    full = bitset(np.ones(N, dtype=bool))
    resp = post(client, layout, grouping([{"source": {"type": "table", "ref": "s0"}}], sets={"s0": full}, subset=SUBSET))
    assert resp.status_code == 400 and resp.get_json()["reason"] == "set_length_mismatch"


def test_a_subset_that_keeps_every_cell_is_the_whole_dataset(client, layout):
    frames, _ = run(client, layout, grouping([{"source": CELL_TYPE}], subset={"n": N + 10}))
    assert frames[-1]["n_shown"] == N


def test_a_bad_subset_is_refused(client, layout):
    resp = post(client, layout, grouping([{"source": CELL_TYPE}], subset="{not json"))
    assert resp.status_code == 400 and resp.get_json()["reason"] == "bad_subset"


# --- limits and bad requests --------------------------------------------------------------------------------------------

def test_a_body_over_the_limit_is_refused_before_it_is_parsed(client, layout, monkeypatch):
    monkeypatch.setattr(cg, "parse_request", lambda *a: pytest.fail("parsed"))
    big = json.dumps({"partitionings": [], "subset": "x" * (route.MAX_BODY_BYTES + 10)})
    resp = client.post(URL, query_string={"dataset_path": ds(layout)}, data=big, content_type="application/json")
    assert resp.status_code == 413 and resp.get_json()["reason"] == "request_too_large"
    chunked = client.post(URL, query_string={"dataset_path": ds(layout)}, input_stream=io.BytesIO(big.encode()),
                          content_type="application/json")
    assert chunked.status_code == 413


def test_sixteen_full_size_bitsets_fit_the_body_limit(client, layout):
    """CMP-9: 16 tables at 1M cells are 2.7 MB of base64 each side of the limit; the shape of the request is accepted."""
    mask = np.ones(N, dtype=bool)
    sets = {f"s{i}": bitset(mask) for i in range(16)}
    parts = [{"source": {"type": "table", "ref": f"s{i}"}} for i in range(8)]
    assert len(json.dumps({"sets": {f"s{i}": {"encoding": "bitset-base64", "length": 10 ** 6,
                                              "data": "A" * 166668} for i in range(16)}})) < route.MAX_BODY_BYTES
    resp = post(client, layout, grouping(parts, sets=sets, estimate_only=True))
    assert resp.status_code == 200


@pytest.mark.parametrize("body,reason", [
    ("not json", "bad_request"), ("[]", "bad_request"),
    ('{"partitionings": [{"source": {"type": "obs", "key": "cell_type"}}], "extra": 1}', "bad_request"),
    ('{"partitionings": [{"source": {"type": "obs", "key": "cell_type"}}], "estimate_only": "yes"}', "bad_request"),
    ('{"partitionings": [{"source": {"type": "obs", "key": "cell_type"}}], "dataset_path": "/x"}', "bad_request"),
    ('{}', "bad_request"),
    ('{"shape": "cube", "partitionings": []}', "bad_shape"),
    ('{"partitionings": [{"source": {"type": "obs", "key": "cell_type"}, "bogus": 1}]}', "unknown_field"),
    ('{"partitionings": [{"source": {"type": "obs", "key": "cell_type", "bogus": 1}}]}', "unknown_field"),
    ('{"partitionings": [{"source": {"type": "obs", "key": "cell_type"}}], "mode": "1d"}', "unknown_field"),
    ('{"shape": "grid", "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}]}', "bad_mode"),
    ('{"shape": "grid", "mode": "1d", "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}], "small": {}}',
     "unknown_field"),
    ('{"shape": "grid", "mode": "1d", "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}], "want": {}}',
     "unknown_field"),
])
def test_a_bad_request_is_a_400_with_a_reason(client, layout, body, reason):
    resp = client.post(URL, query_string={"dataset_path": ds(layout)}, data=body, content_type="application/json")
    assert resp.status_code == 400 and resp.get_json()["reason"] == reason and resp.get_json()["error"]


def test_the_dataset_must_be_named_and_exist(client, layout):
    assert client.post(URL, data="{}").status_code == 400
    resp = post(client, layout, grouping([{"source": CELL_TYPE}]), name="nope.zarr")
    assert resp.status_code == 404 and resp.get_json()["reason"] == "not_found"
    resp = post(client, layout, grouping([{"source": {"type": "obs", "key": "nope"}}]))
    assert resp.status_code == 404 and resp.get_json()["reason"] == "key_not_found"


def test_only_post_is_allowed(client, layout):
    assert client.get(URL, query_string={"dataset_path": ds(layout)}).status_code in (404, 405)


# --- the review's limits (engine M3, M4) ---------------------------------------------------------------------------------

def nested(depth, width):
    """A grouping `width` wide whose every partitioning is a grouping `depth` deeper, with obs leaves."""
    if depth == 0:
        return [{"source": CELL_TYPE}] * width
    return [{"source": {"type": "cell-group", "key": "p", "recipe": {"partitionings": nested(depth - 1, width)}}}
            for _ in range(width)]


def test_nesting_is_bounded_before_anything_is_planned(client, layout, monkeypatch):
    monkeypatch.setattr(cg, "parse_request", lambda *a: pytest.fail("parsed"))
    monkeypatch.setattr(cg, "plan", lambda *a: pytest.fail("planned"))
    monkeypatch.setattr(gf, "plan", lambda *a: pytest.fail("planned"))
    body = grouping(nested(3, 8))                                   # 8 + 64 + 512 + 4096 partitionings
    for extra in ({}, {"estimate_only": True}):
        resp = post(client, layout, {**body, **extra})
        out = resp.get_json()
        assert resp.status_code == 422 and out["reason"] == "too_many_partitionings"
        assert out["limit"] == route.MAX_PARTITIONINGS and out["count"] > out["limit"]


def test_a_request_inside_the_nesting_bound_is_planned(client, layout):
    body = grouping(nested(1, 4))                                   # 4 + 16 partitionings
    assert post(client, layout, {**body, "estimate_only": True}).status_code == 200


def test_the_nesting_bound_counts_the_leaves_of_a_grid_too(client, layout, monkeypatch):
    monkeypatch.setattr(cell_grid, "plan", lambda *a: pytest.fail("planned"))
    inner = {"source": {"type": "cell-group", "key": "p", "recipe": {"partitionings": nested(2, 5)}}}
    resp = post(client, layout, {"shape": "grid", "mode": "1d", "partitionings": [inner]})
    assert resp.status_code == 422 and resp.get_json()["reason"] == "too_many_partitionings"


def test_an_obsp_row_is_refused_above_the_large_plot_limit(client, layout, monkeypatch):
    body = grouping([{"source": {"type": "obsp", "key": "connectivities", "column": "5"}}])
    assert post(client, layout, {**body, "estimate_only": True}).status_code == 200
    monkeypatch.setattr(cell_sources, "OBSP_MAX_CELLS", N - 1)
    for extra in ({"estimate_only": True}, {}):
        resp = post(client, layout, {**body, **extra})
        out = resp.get_json()
        assert resp.status_code == 422 and out["reason"] == "obsp_too_large"
        assert (out["count"], out["limit"]) == (N, N - 1)
    measure = grouping([{"source": CELL_TYPE}], measures=[{"id": "m0", "source": body["partitionings"][0]["source"]}])
    assert post(client, layout, measure).status_code == 422


# --- access and forged requests -----------------------------------------------------------------------------------------

@pytest.fixture
def secured(layout, tmp_path):
    manager = AuthManager(user_file=str(tmp_path / "users.json"))
    for name, admin in USERS.items():
        manager.add_user(name, PASSWORD, is_admin=admin)
    return create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(layout / "data"),
                       "log_file": str(tmp_path / "t.log"), "auth_enabled": True,
                       "user_file": str(tmp_path / "users.json"), "secret_key": "test-only-secret"})


def test_a_requester_who_is_not_signed_in_is_turned_away(secured, layout):
    resp = post(secured.test_client(), layout, grouping([{"source": CELL_TYPE}]))
    assert resp.status_code in (401, 302)


def test_a_restricted_user_cannot_group_a_store_they_may_not_read(secured, layout, monkeypatch):
    inject_deny_list(monkeypatch, secured, [ds(layout, "out.zarr")])
    bob = signed_in(secured, RESTRICTED)
    body = grouping([{"source": CELL_TYPE}])
    assert post(bob, layout, body, name="in.zarr").status_code == 200
    denied = post(bob, layout, body, name="out.zarr")
    missing = post(bob, layout, body, name="nope.zarr")
    assert denied.status_code == 404 and denied.get_json()["reason"] == "not_found"
    assert (denied.status_code, denied.get_json()["reason"]) == (missing.status_code, missing.get_json()["reason"])
    assert post(bob, layout, {**body, "estimate_only": True}, name="out.zarr").status_code == 404


def test_a_path_outside_the_data_directory_is_refused(secured, layout):
    carol = signed_in(secured, "carol")
    resp = carol.post(URL, query_string={"dataset_path": "/etc/passwd"}, data=json.dumps(grouping([{"source": CELL_TYPE}])),
                      content_type="application/json")
    assert resp.status_code in (403, 404)


def test_a_forged_request_is_refused(secured, layout):
    body = json.dumps(grouping([{"source": CELL_TYPE}]))
    q = {"dataset_path": ds(layout)}
    sign_in = FlaskClient(secured, secured.response_class, use_cookies=True)
    page = sign_in.get("/login").get_data(as_text=True)
    form = re.search(r'name="login_csrf" value="([^"]+)"', page).group(1)
    assert sign_in.post("/login", data={"username": "alice", "password": PASSWORD, "login_csrf": form}).status_code == 302
    with sign_in.session_transaction() as sess:
        good = sess["csrf"]
    headers = {"Content-Type": "application/json"}
    assert sign_in.post(URL, query_string=q, data=body, headers=headers).status_code == 403
    assert sign_in.post(URL, query_string=q, data=body, headers={**headers, "X-AnnZarro-CSRF": "wrong"}).status_code == 403
    assert sign_in.post(URL, query_string=q, data=body,
                        headers={**headers, "X-AnnZarro-CSRF": good, "Origin": "https://evil.example"}).status_code == 403
    ok = sign_in.post(URL, query_string=q, data=body, headers={**headers, "X-AnnZarro-CSRF": good})
    assert ok.status_code == 200 and parse(ok.get_data())[0][-1]["type"] == "result"
