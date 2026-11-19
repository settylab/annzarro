"""POST /api/v1/data/gene_score (annzarro/server/routes/gene_score.py): the contract of the route.

Subset handling, access, forged requests, cancelling, the limits, the cost tiers and what a stream looks
like. The arithmetic is tested against a dense reference in tests/core/test_gene_score.py.
"""
import io
import json
import re
import socket
import threading
import time

import numpy as np
import pytest
from flask.testing import FlaskClient

from annzarro.core import gene_score as gs
from annzarro.core import read_guard, subset as cell_subset, zarr_reader
from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.server.routes import gene_score as route
from annzarro.tests.core.gene_score_store import N_OBS, gene, make_matrix, make_store, reference, wide_matrix, wide_names
from annzarro.tests.server.test_data_access_matrix import RESTRICTED, USERS, PASSWORD, inject_deny_list

URL = "/api/v1/data/gene_score"
GENES = [0, 1, 4, 6, 8, 9]
NAMES = [gene(i) for i in GENES]


@pytest.fixture
def matrix():
    return make_matrix()


@pytest.fixture
def layout(tmp_path, matrix):
    data = tmp_path / "data"
    data.mkdir()
    make_store(data / "in.zarr", matrix, "csc", "zarr", layer=np.round(matrix * 2))
    make_store(data / "out.zarr", matrix, "csc", "zarr")
    make_store(data / "cells.h5ad", matrix, "csr", "h5ad")
    zarr_reader.clear_cache()
    cell_subset.clear()
    yield tmp_path
    zarr_reader.clear_cache()
    cell_subset.clear()


@pytest.fixture
def app(layout):
    return create_app({"TESTING": True, "data_dir": str(layout / "data"), "log_file": str(layout / "t.log")})


@pytest.fixture
def client(app):
    return app.test_client()


def ds(layout, name="in.zarr"):
    return str(layout / "data" / name)


def post(client, layout, body, name="in.zarr", query=None, **kw):
    query = {"dataset_path": ds(layout, name), **(query or {})}
    return client.post(URL, query_string=query, data=json.dumps(body), content_type="application/json", **kw)


def parse(data):
    """(frames, vector): the frames of a stream, and the float32 values after its result frame."""
    frames, pos = [], 0
    vector = None
    while pos < len(data):
        end = data.index(b"\n", pos)
        frame = json.loads(data[pos:end])
        frames.append(frame)
        pos = end + 1
        if frame["type"] == "result":
            n = frame["byte_length"]
            vector = np.frombuffer(data[pos:pos + n], dtype="<f4")
            pos += n
    return frames, vector


def score(client, layout, recipe=None, **body):
    resp = post(client, layout, {"recipe": {"genes": NAMES, **(recipe or {})}, **body})
    assert resp.status_code == 200, resp.get_data(as_text=True)
    return parse(resp.get_data())


# --- the stream ---------------------------------------------------------------------------------

def test_a_stream_is_progress_then_a_result_then_the_vector(client, layout, matrix):
    resp = post(client, layout, {"recipe": {"genes": NAMES}})
    assert resp.status_code == 200 and resp.mimetype == route.MIMETYPE
    assert resp.headers["Cache-Control"] == "no-store" and resp.headers["X-Annzarro-Score-Version"] == "1"
    assert "Content-Encoding" not in resp.headers
    frames, vector = parse(resp.get_data())
    assert [f["type"] for f in frames][-1] == "result" and {f["type"] for f in frames[:-1]} == {"progress"}
    assert (frames[0]["done"], frames[0]["total"]) == (0, len(GENES))
    assert (frames[-2]["done"], frames[-2]["total"]) == (len(GENES), len(GENES))
    result = frames[-1]
    assert result["scored"] and result["dtype"] == "float32" and result["byte_length"] == 4 * N_OBS
    assert (result["n_cells"], result["n_shown"], result["n_used"]) == (N_OBS, N_OBS, len(GENES))
    assert result["recipe"] == {"method": "zscore_mean", "input": "X", "clip": 10.0, "seed": None, "bins": None,
                                "controls": None, "detect_above": None, "version": 1, "genes": len(GENES)}
    want, _ = reference(matrix, GENES)
    np.testing.assert_allclose(vector, want, rtol=2e-6, atol=2e-6)
    assert {g["name"]: g["status"] for g in result["genes"]}[gene(1)] == "used"
    assert all(set(g) == {"name", "column", "status", "mean", "sd", "detected", "clipped"} for g in result["genes"])


def test_the_clip_in_the_recipe_is_honoured(client, layout, matrix):
    for clip in (3, None):
        _, vector = score(client, layout, {"clip": clip})
        want, _ = reference(matrix, GENES, clip=clip)
        np.testing.assert_allclose(vector, want, rtol=2e-6, atol=2e-6)
    frames, _ = score(client, layout, {"method": "mean", "clip": 3})
    assert frames[-1]["recipe"]["clip"] is None                       # the mean does not clip


def test_a_layer_and_an_h5ad_store_are_scored(client, layout, matrix):
    _, vector = score(client, layout, {"input": "counts"})
    want, _ = reference(np.round(matrix * 2), GENES)
    np.testing.assert_allclose(vector, want, rtol=2e-6, atol=2e-6)
    resp = post(client, layout, {"recipe": {"genes": NAMES}}, name="cells.h5ad")
    _, from_h5 = parse(resp.get_data())
    _, from_zarr = score(client, layout)
    np.testing.assert_allclose(from_h5, from_zarr, rtol=2e-6, atol=2e-6)


def test_a_signature_with_no_score_says_why_and_sends_no_values(client, layout):
    for genes, reason in (([], "empty_signature"), (["NOPE"], "no_gene_present"), ([gene(2), gene(3)], "no_usable_gene")):
        resp = post(client, layout, {"recipe": {"genes": genes}})
        assert resp.status_code == 200
        frames, vector = parse(resp.get_data())
        result = frames[-1]
        assert (result["scored"], result["reason"], result["byte_length"]) == (False, reason, 0)
        assert result["message"] and vector.size == 0


def test_the_result_names_what_was_left_out(client, layout):
    frames, _ = score(client, layout, {"genes": [gene(0), "NOPE", gene(2), gene(5), gene(8)]})
    result = frames[-1]
    assert result["missing"] == ["NOPE"]
    codes = {w["code"]: w["names"] for w in result["warnings"]}
    assert codes == {"missing_genes": ["NOPE"], "constant_genes": [gene(2)], "no_values": [gene(5)]}
    assert result["n_used"] == 2
    json.dumps(result, allow_nan=False)                                # no NaN leaks into the JSON


# --- subsets --------------------------------------------------------------------------------------

@pytest.mark.parametrize("subset", [{"n": 37, "seed": 5}, json.dumps({"n": 37, "seed": 5})])
def test_a_subset_gets_the_scores_of_the_whole_dataset_at_its_cells(client, layout, matrix, subset):
    _, full = score(client, layout)
    frames, vector = score(client, layout, subset=subset)
    rows, _ = cell_subset.select_indices(N_OBS, cell_subset.parse_spec({"n": 37, "seed": 5}), None)
    assert vector.shape == (37,) and (frames[-1]["n_shown"], frames[-1]["n_cells"]) == (37, N_OBS)
    np.testing.assert_array_equal(vector, full[rows])
    want, _ = reference(matrix, GENES)
    np.testing.assert_allclose(vector, want[rows], rtol=2e-6, atol=2e-6)


def test_a_subset_that_keeps_every_cell_is_the_whole_dataset(client, layout):
    _, full = score(client, layout)
    _, same = score(client, layout, subset={"n": N_OBS + 10})
    np.testing.assert_array_equal(full, same)


def test_a_bad_subset_is_refused(client, layout):
    resp = post(client, layout, {"recipe": {"genes": NAMES}, "subset": "{not json"})
    assert resp.status_code == 400 and resp.get_json()["reason"] == "bad_subset"


# --- the estimate and the cost tiers -----------------------------------------------------------------

def test_estimate_only_reads_nothing(client, layout, monkeypatch):
    monkeypatch.setattr(gs, "compute", lambda *a, **k: pytest.fail("estimate_only computed"))
    resp = post(client, layout, {"recipe": {"genes": NAMES + ["NOPE"]}, "estimate_only": True})
    body = resp.get_json()
    assert resp.status_code == 200 and resp.mimetype == "application/json"
    est = body["estimate"]
    assert est["layout"] == "csc" and est["tier"] == "auto" and est["entries"] > 0 and est["n_cells"] == N_OBS
    assert (est["genes"], est["genes_requested"], est["genes_missing"]) == (len(GENES), len(GENES) + 1, 1)
    assert (est["live_max_s"], est["auto_max_s"], est["max_s"]) == (5.0, 60.0, 600.0) and est["seconds"] >= gs.BASE_SECONDS
    assert body["missing"] == ["NOPE"] and body["recipe"]["method"] == "zscore_mean"


def test_the_estimate_follows_the_layout(client, layout, matrix):
    est = post(client, layout, {"recipe": {"genes": NAMES}, "estimate_only": True}, name="cells.h5ad").get_json()["estimate"]
    assert est["layout"] == "csr" and est["entries"] == int(np.count_nonzero(matrix))


def _slow(monkeypatch, seconds_per_entry_count):
    """Make a score of the test store take ``seconds_per_entry_count`` times its entries in seconds."""
    monkeypatch.setitem(gs.RATES, "csc", 1.0 / seconds_per_entry_count)


def test_a_score_between_the_limits_asks_for_one_confirmation(client, layout, monkeypatch):
    entries = post(client, layout, {"recipe": {"genes": NAMES}, "estimate_only": True}).get_json()["estimate"]["entries"]
    monkeypatch.setitem(gs.RATES, "csc", entries / 120.0)                   # about 2 minutes
    est = post(client, layout, {"recipe": {"genes": NAMES}, "estimate_only": True}).get_json()["estimate"]
    assert est["tier"] == "confirm" and 60 < est["seconds"] <= 600
    resp = post(client, layout, {"recipe": {"genes": NAMES}})
    assert resp.status_code == 409 and resp.get_json()["reason"] == "confirmation_required"
    assert resp.get_json()["estimate"]["tier"] == "confirm"
    resp = post(client, layout, {"recipe": {"genes": NAMES}, "confirm": True})
    assert resp.status_code == 200 and parse(resp.get_data())[0][-1]["scored"]


def test_a_score_above_ten_minutes_is_refused_even_when_confirmed(client, layout, monkeypatch):
    entries = post(client, layout, {"recipe": {"genes": NAMES}, "estimate_only": True}).get_json()["estimate"]["entries"]
    monkeypatch.setitem(gs.RATES, "csc", entries / 3000.0)                  # about 50 minutes
    est = post(client, layout, {"recipe": {"genes": NAMES}, "estimate_only": True}).get_json()["estimate"]
    assert est["tier"] == "refused"                                          # the estimate is still answered
    for body in ({"recipe": {"genes": NAMES}}, {"recipe": {"genes": NAMES}, "confirm": True}):
        resp = post(client, layout, body)
        assert resp.status_code == 413 and resp.get_json()["reason"] == "score_too_expensive"
        assert "minutes" in resp.get_json()["error"] and resp.get_json()["estimate"]["tier"] == "refused"
        assert resp.mimetype == "application/json"


def test_a_refused_csr_score_names_the_way_out(client, layout, monkeypatch):
    monkeypatch.setitem(gs.RATES, "csr", 1.0)
    resp = post(client, layout, {"recipe": {"genes": NAMES}}, name="cells.h5ad")
    assert resp.status_code == 413 and "CSC" in resp.get_json()["error"]


# --- limits and bad requests ----------------------------------------------------------------------------

def test_two_thousand_genes_are_allowed_and_more_are_refused(client, layout):
    ok = post(client, layout, {"recipe": {"genes": [f"G{i}" for i in range(2000)]}})
    assert ok.status_code == 200 and parse(ok.get_data())[0][-1]["reason"] == "no_gene_present"
    resp = post(client, layout, {"recipe": {"genes": [f"G{i}" for i in range(2001)]}})
    assert resp.status_code == 413 and resp.get_json()["reason"] == "too_many_genes"
    assert (resp.get_json()["limit"], resp.get_json()["requested"]) == (2000, 2001)


def test_a_body_over_the_limit_is_refused_before_it_is_parsed(client, layout):
    big = json.dumps({"recipe": {"genes": ["A"], "title": "x" * (route.MAX_BODY_BYTES + 10)}})
    resp = client.post(URL, query_string={"dataset_path": ds(layout)}, data=big, content_type="application/json")
    assert resp.status_code == 413 and resp.get_json()["reason"] == "request_too_large"
    chunked = client.post(URL, query_string={"dataset_path": ds(layout)}, input_stream=io.BytesIO(big.encode()),
                          content_type="application/json")
    assert chunked.status_code == 413


@pytest.mark.parametrize("body,reason", [
    ("not json", "bad_request"), ("[]", "bad_request"), ("{}", "bad_recipe"), ('{"recipe": 3}', "bad_recipe"),
    ('{"recipe": {"genes": []}, "extra": 1}', "bad_request"),
    ('{"recipe": {"genes": []}, "estimate_only": "yes"}', "bad_request"),
    ('{"recipe": {"genes": [], "clip": 0}}', "bad_clip"), ('{"recipe": {"genes": [], "clip": -3}}', "bad_clip"),
    ('{"recipe": {"genes": [], "down": ["A"]}}', "down_not_available"),
    ('{"recipe": {"genes": []}, "dataset_path": "/somewhere/else.zarr"}', "dataset_path_conflict"),
])
def test_a_bad_request_is_a_400_with_a_reason(client, layout, body, reason):
    resp = client.post(URL, query_string={"dataset_path": ds(layout)}, data=body, content_type="application/json")
    assert resp.status_code == 400 and resp.get_json()["reason"] == reason and resp.get_json()["error"]


def test_the_dataset_must_be_named_and_exist(client, layout):
    assert client.post(URL, data="{}").status_code == 400
    resp = post(client, layout, {"recipe": {"genes": NAMES}}, name="nope.zarr")
    assert resp.status_code == 404 and resp.get_json()["reason"] == "not_found"
    resp = post(client, layout, {"recipe": {"genes": NAMES, "input": "nolayer"}})
    assert resp.status_code == 404 and resp.get_json()["reason"] == "key_not_found"


def test_a_body_dataset_path_naming_the_same_dataset_is_accepted(client, layout):
    resp = post(client, layout, {"recipe": {"genes": NAMES}, "dataset_path": ds(layout)})
    assert resp.status_code == 200


def test_only_post_is_allowed(client, layout):
    assert client.get(URL, query_string={"dataset_path": ds(layout)}).status_code in (404, 405)


def test_a_failure_after_the_stream_began_is_an_error_frame(client, layout, monkeypatch):
    real = gs.compute

    def broken(plan, rows=None, should_stop=None):
        events = real(plan, rows, should_stop)
        yield next(events)
        raise OSError("disk gone")
    monkeypatch.setattr(gs, "compute", broken)
    resp = post(client, layout, {"recipe": {"genes": NAMES}})
    frames, vector = parse(resp.get_data())
    assert resp.status_code == 200 and [f["type"] for f in frames] == ["progress", "error"]
    assert frames[-1]["reason"] == "read_failed" and "disk gone" in frames[-1]["message"] and vector is None
    assert route._slot.acquire(blocking=False)                       # the slot is free again
    route._slot.release()


# --- one at a time, and cancelling ------------------------------------------------------------------------

def test_another_request_waits_for_the_slot_then_is_told_to_retry(client, layout, monkeypatch):
    monkeypatch.setattr(route, "QUEUE_WAIT_S", 0.2)
    assert route._slot.acquire(blocking=False)
    try:
        resp = post(client, layout, {"recipe": {"genes": NAMES}})
    finally:
        route._slot.release()
    assert resp.status_code == 503 and resp.get_json()["reason"] == "read_busy"
    assert resp.headers["Retry-After"] == "1"
    assert post(client, layout, {"recipe": {"genes": NAMES}}).status_code == 200      # and it is free after


def test_a_queued_request_runs_when_the_slot_frees(client, layout, monkeypatch):
    monkeypatch.setattr(route, "QUEUE_WAIT_S", 5)
    assert route._slot.acquire(blocking=False)
    threading.Timer(0.3, route._slot.release).start()
    start = time.monotonic()
    resp = post(client, layout, {"recipe": {"genes": NAMES}})
    assert resp.status_code == 200 and time.monotonic() - start >= 0.25


def test_the_memory_of_a_score_is_held_while_it_streams_and_released_after(client, layout):
    before = read_guard.in_flight_bytes()
    resp = post(client, layout, {"recipe": {"genes": NAMES}}, buffered=False)
    assert read_guard.in_flight_bytes() > before                      # admitted, not yet read out
    resp.get_data()
    resp.close()
    assert read_guard.in_flight_bytes() == before


def _slow_reads(monkeypatch, seconds, started):
    real = gs._CscSource._read

    def slow(self, lo, hi, spans):
        started.append(spans[0][0])
        time.sleep(seconds)
        return real(self, lo, hi, spans)
    monkeypatch.setattr(gs._CscSource, "_read", slow)
    monkeypatch.setattr(gs, "READ_THREADS", 1)
    monkeypatch.setattr(gs, "READ_AHEAD_ENTRIES", 1)
    monkeypatch.setattr(gs, "GROUP_GAP_ENTRIES", 0)


def test_closing_the_response_stops_the_work_and_frees_the_slot(client, layout, monkeypatch):
    started = []
    _slow_reads(monkeypatch, 0.1, started)
    everything = [gene(i) for i in (0, 1, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)]
    resp = post(client, layout, {"recipe": {"genes": everything}}, buffered=False)
    chunks = resp.iter_encoded()
    first = next(chunks)
    assert json.loads(first)["type"] == "progress"
    next(chunks)
    resp.close()                                                      # the page went away
    seen = len(started)
    time.sleep(0.6)
    assert len(started) == seen < len(everything)                    # nothing more was read
    assert route._slot.acquire(timeout=2)
    route._slot.release()


def test_a_closed_connection_stops_a_real_server(layout, monkeypatch):
    """Over a socket: the client hangs up while the score is computing, the next progress write fails,
    and the work stops between genes."""
    from waitress.server import create_server
    started = []
    _slow_reads(monkeypatch, 0.15, started)
    app = create_app({"TESTING": True, "data_dir": str(layout / "data"), "log_file": str(layout / "t.log")})
    server = create_server(app, host="127.0.0.1", port=0)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        everything = [gene(i) for i in (0, 1, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)]
        body = json.dumps({"recipe": {"genes": everything}}).encode()
        sock = socket.create_connection(("127.0.0.1", server.effective_port), timeout=10)
        request = (f"POST {URL}?dataset_path={ds(layout)} HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n"
                   f"Content-Length: {len(body)}\r\n\r\n").encode() + body
        sock.sendall(request)
        buf = b""
        while b"progress" not in buf:                                 # the stream began
            buf += sock.recv(4096)
        sock.close()
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline and not route._slot.acquire(blocking=False):
            time.sleep(0.05)
        else:
            route._slot.release()
        time.sleep(0.5)
        assert len(started) < len(everything), "the score ran to the end after the connection closed"
    finally:
        server.close()
        thread.join(5)


# --- access and forged requests -----------------------------------------------------------------------------

@pytest.fixture
def secured(layout):
    """Login on, with an admin, an unrestricted user and a restricted one."""
    manager = AuthManager(user_file=str(layout / "users.json"))
    for name, admin in USERS.items():
        manager.add_user(name, PASSWORD, is_admin=admin)
    return create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(layout / "data"),
                       "log_file": str(layout / "t.log"), "auth_enabled": True,
                       "user_file": str(layout / "users.json"), "secret_key": "test-only-secret"})


def signed_in(app, name):
    from annzarro.tests.conftest import _BrowsesLikeAPage
    app.test_client_class = _BrowsesLikeAPage
    client = app.test_client()
    assert client.post("/login", data={"username": name, "password": PASSWORD}).status_code == 302
    return client


def test_a_requester_who_is_not_signed_in_is_turned_away(secured, layout):
    resp = post(secured.test_client(), layout, {"recipe": {"genes": NAMES}})
    assert resp.status_code in (401, 302)


def test_a_restricted_user_cannot_score_a_store_they_may_not_read(secured, layout, monkeypatch):
    inject_deny_list(monkeypatch, secured, [ds(layout, "out.zarr")])
    bob = signed_in(secured, RESTRICTED)
    assert post(bob, layout, {"recipe": {"genes": NAMES}}, name="in.zarr").status_code == 200
    denied = post(bob, layout, {"recipe": {"genes": NAMES}}, name="out.zarr")
    missing = post(bob, layout, {"recipe": {"genes": NAMES}}, name="nope.zarr")
    assert denied.status_code == 404 and denied.get_json()["reason"] == "not_found"
    assert (denied.status_code, denied.get_json()["reason"]) == (missing.status_code, missing.get_json()["reason"])
    # estimating names the same refusal, and nothing leaks through the body's dataset_path
    estimate = post(bob, layout, {"recipe": {"genes": NAMES}, "estimate_only": True}, name="out.zarr")
    assert estimate.status_code == 404
    tricky = post(bob, layout, {"recipe": {"genes": NAMES}, "dataset_path": ds(layout, "out.zarr")}, name="in.zarr")
    assert tricky.status_code == 400


def test_a_path_outside_the_data_directory_is_refused(secured, layout):
    carol = signed_in(secured, "carol")        # signed in, not an admin
    resp = carol.post(URL, query_string={"dataset_path": "/etc/passwd"}, data=json.dumps({"recipe": {"genes": []}}),
                      content_type="application/json")
    assert resp.status_code in (403, 404)


def test_a_forged_request_is_refused(secured, layout):
    """Another page cannot make a signed-in browser compute a score: the session's token must come back."""
    body = json.dumps({"recipe": {"genes": NAMES}})
    q = {"dataset_path": ds(layout)}
    sign_in = FlaskClient(secured, secured.response_class, use_cookies=True)
    page = sign_in.get("/login").get_data(as_text=True)
    form = re.search(r'name="login_csrf" value="([^"]+)"', page).group(1)
    assert sign_in.post("/login", data={"username": "alice", "password": PASSWORD, "login_csrf": form}).status_code == 302
    with sign_in.session_transaction() as sess:
        good = sess["csrf"]
    headers = {"Content-Type": "application/json"}
    assert sign_in.post(URL, query_string=q, data=body, headers=headers).status_code == 403            # no token
    assert sign_in.post(URL, query_string=q, data=body, headers={**headers, "X-AnnZarro-CSRF": "wrong"}).status_code == 403
    assert sign_in.post(URL, query_string=q, data=body,
                        headers={**headers, "X-AnnZarro-CSRF": good, "Origin": "https://evil.example"}).status_code == 403
    assert sign_in.post(URL, query_string=q, data=body,
                        headers={**headers, "X-AnnZarro-CSRF": good, "Sec-Fetch-Site": "cross-site"}).status_code == 403
    ok = sign_in.post(URL, query_string=q, data=body, headers={**headers, "X-AnnZarro-CSRF": good})
    assert ok.status_code == 200 and parse(ok.get_data())[0][-1]["scored"]


# --- the control-adjusted score -----------------------------------------------------------------------------
# A control needs a bin with genes outside the signature, and the seed matters only where a bin holds more than
# 50 genes, so these use a 1,500 gene store.

BIG = wide_names()
SIGNATURE = BIG[10:30]


@pytest.fixture
def big(layout):
    x = wide_matrix()
    make_store(layout / "data" / "big.zarr", x, "csc", "zarr", var_names=BIG)
    make_store(layout / "data" / "big.h5ad", x, "csr", "h5ad", var_names=BIG)
    zarr_reader.clear_cache()
    return layout


def run_big(client, big, recipe, name="big.zarr", **body):
    resp = post(client, big, {"recipe": {"genes": SIGNATURE, **recipe}, **body}, name=name)
    assert resp.status_code == 200, resp.get_data(as_text=True)
    return parse(resp.get_data())


def test_a_control_adjusted_score_reports_its_seed_and_controls(client, big):
    recipe = {"method": "control_adjusted", "seed": 5, "clip": 3}
    frames, vector = run_big(client, big, recipe)
    result = frames[-1]
    assert result["recipe"] == {"method": "control_adjusted", "input": "X", "clip": None, "seed": 5, "bins": 25,
                                "controls": 50, "detect_above": None, "version": 1, "genes": len(SIGNATURE)}
    assert result["binning"] == "detection" and result["n_controls"] == result["n_controls_used"] > 0
    assert result["scored"] and vector.shape == (200,)
    assert frames[0]["total"] == len(SIGNATURE) and frames[1]["total"] == len(SIGNATURE) + result["n_controls"]
    np.testing.assert_array_equal(vector, run_big(client, big, recipe)[1])
    assert not np.array_equal(vector, run_big(client, big, {**recipe, "seed": 6})[1])
    assert not np.array_equal(vector, run_big(client, big, {})[1])


def test_the_estimate_of_a_control_adjusted_score_counts_its_controls(client, big):
    est = run_big_estimate(client, big, "control_adjusted")
    plain = run_big_estimate(client, big, "mean")
    assert est["controls"] > 0 and est["binning"] == "detection" and "controls" not in plain
    assert est["entries"] > plain["entries"]
    by_cell = run_big_estimate(client, big, "control_adjusted", name="big.h5ad")
    assert by_cell["controls"] is None, "a store by cell has to be read before its controls are known"
    assert by_cell["entries"] > run_big_estimate(client, big, "mean", name="big.h5ad")["entries"]


def run_big_estimate(client, big, method, name="big.zarr"):
    resp = post(client, big, {"recipe": {"genes": SIGNATURE, "method": method}, "estimate_only": True}, name=name)
    return resp.get_json()["estimate"]


def test_a_score_by_cell_store_draws_the_same_controls(client, big):
    recipe = {"method": "control_adjusted", "seed": 3}
    np.testing.assert_allclose(run_big(client, big, recipe)[1], run_big(client, big, recipe, name="big.h5ad")[1],
                               rtol=2e-6, atol=2e-6)


def test_a_control_adjusted_score_with_no_possible_control_says_why(client, big):
    resp = post(client, big, {"recipe": {"genes": BIG, "method": "control_adjusted"}}, name="big.zarr")
    frames, vector = parse(resp.get_data())
    assert frames[-1]["scored"] is False and frames[-1]["reason"] == "no_control_genes" and vector.size == 0
    assert "control genes" in frames[-1]["message"]


# --- what an input looks like -------------------------------------------------------------------------------

KIND = "/api/v1/data/matrix_kind"


def kind(client, layout, name="in.zarr", **query):
    return client.get(KIND, query_string={"dataset_path": ds(layout, name), **query})


def test_matrix_kind_names_the_input_and_what_it_looks_like(client, layout):
    resp = kind(client, layout, input="counts")                       # the layer is round(2 x): whole numbers
    body = resp.get_json()
    assert resp.status_code == 200 and body["input"] == "counts" and body["kind"] == "counts"
    assert body["stats"]["whole"] == 1.0 and body["stats"]["max"] >= 10 and body["suggest"] is None
    assert set(body["checked"]) == {"X"}, "the other matrices are looked at when this one is counts"
    x = kind(client, layout).get_json()                                 # default input X; floats reaching 100
    assert x["input"] == "X" and x["kind"] == "normalised"
    assert set(x) == {"input", "kind", "stats", "suggest", "checked"}


def test_matrix_kind_reads_an_h5ad_store_too(client, layout):
    body = kind(client, layout, name="cells.h5ad").get_json()
    assert body["kind"] in {"log", "normalised"} and body["input"] == "X"


def test_matrix_kind_refuses_what_it_cannot_answer(client, layout):
    assert kind(client, layout, input="nope").status_code == 404
    assert kind(client, layout, input="nope").get_json()["reason"] == "key_not_found"
    assert client.get(KIND).status_code == 400
    assert kind(client, layout, input="x" * 1001).status_code == 400
    assert client.get(KIND, query_string={"dataset_path": str(layout / "data" / "missing.zarr")}).status_code in (403, 404)


def test_a_refused_or_failed_control_adjusted_request_leaves_the_slot_and_the_budget_free(client, big, monkeypatch):
    """One bad request must not block every later score on the worker: the slot and the read budget are
    given back on every way out (no control to draw, an error after the stream began, a closed stream)."""
    before = read_guard.in_flight_bytes()

    def free():
        assert route._slot.acquire(blocking=False), "the slot is held"
        route._slot.release()
        assert read_guard.in_flight_bytes() == before, "the read budget is held"

    parse(post(client, big, {"recipe": {"genes": BIG, "method": "control_adjusted"}}, name="big.zarr").get_data())
    free()                                                             # no control genes
    real = gs.compute

    def broken(plan, rows=None, should_stop=None):
        events = real(plan, rows, should_stop)
        yield next(events)
        raise OSError("disk gone")
    monkeypatch.setattr(gs, "compute", broken)
    frames, _ = parse(post(client, big, {"recipe": {"genes": SIGNATURE, "method": "control_adjusted"}},
                           name="big.zarr").get_data())
    assert frames[-1]["type"] == "error"
    free()                                                             # failed after the stream began
    monkeypatch.setattr(gs, "compute", real)
    resp = post(client, big, {"recipe": {"genes": SIGNATURE, "method": "control_adjusted"}}, name="big.zarr",
                buffered=False)
    next(resp.response)                                                # one frame read, then the client goes away
    resp.close()
    free()
    refused = post(client, big, {"recipe": {"genes": SIGNATURE, "method": "control_adjusted", "clip": -1}}, name="big.zarr")
    assert refused.status_code == 200 or refused.status_code == 400
    free()
    assert run_big(client, big, {"method": "control_adjusted"})[0][-1]["scored"], "and the next score runs"


@pytest.mark.parametrize("method", ["sum", "detected", "fraction_of_total"])
def test_the_new_aggregations_stream_like_any_other(client, layout, matrix, method):
    frames, vector = score(client, layout, {"method": method})
    result = frames[-1]
    assert result["recipe"]["method"] == method and result["scored"] and vector.shape == (N_OBS,)
    if method == "fraction_of_total":
        assert result["entries_read"] > 0 and frames[0]["total"] == len(GENES)
        est = post(client, layout, {"recipe": {"genes": NAMES, "method": method}, "estimate_only": True}).get_json()["estimate"]
        plain = post(client, layout, {"recipe": {"genes": NAMES, "method": "sum"}, "estimate_only": True}).get_json()["estimate"]
        assert est["entries"] > plain["entries"], "the pass over every gene is in the estimate"
