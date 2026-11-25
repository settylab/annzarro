"""Try anyway (aggregation-unify-080.md 14): a time refusal is soft, a size refusal is hard.

``force: true`` on ``POST /data/gene_score`` and ``/data/cell_groups`` runs what the ``refused`` tier would not, only when
the refusal is for time, ``limits.try_max_s`` is above 0 and the estimate is within ten times it, under a wall-clock
deadline of ``try_max_s`` and one such run per user at a time. Estimates carry ``try`` so the browser needs no guess.
"""
import json

import pytest

from annzarro.core import cost_limits as cl
from annzarro.core import read_guard
from annzarro.server.routes import compute_stream as cstream
from annzarro.tests.core import grouping_store as gstore
from annzarro.tests.server.test_cost_limits import (  # noqa: F401 (the fixtures and helpers)
    CELL_TYPE, GROUPS, SCORE, GENE1, client_with, fresh, genes, grouping, last_frame, layout, post)

# every estimate above 0 seconds is refused; the run itself is a few milliseconds
REFUSED = dict(live_update_s=0, ask_first_s=0, refuse_s=0)
RAISED = dict(live_update_s=0, ask_first_s=0)          # the same, with the limits raised: it runs unasked once confirmed
SCORE_BODY = {"recipe": {"genes": [gstore.gene(1), gstore.gene(2), gstore.gene(3)]}}
GROUPING_BODY = grouping([CELL_TYPE], features=genes(3))


def frames_and_tail(resp):
    """``(frames up to and including the first result or error, the bytes after it)``."""
    assert resp.status_code == 200, resp.get_data(as_text=True)[:300]
    data, pos, out = resp.get_data(), 0, []
    while pos < len(data):
        end = data.index(b"\n", pos)
        out.append(json.loads(data[pos:end]))
        pos = end + 1
        if out[-1]["type"] in ("result", "error"):
            break
    return out, data[pos:]


@pytest.fixture
def one_user(monkeypatch):
    monkeypatch.setattr(read_guard, "current_requester", lambda: "user-1")
    cstream._TRIED.clear()
    yield "user-1"
    cstream._TRIED.clear()


@pytest.mark.parametrize("url, body", [(SCORE, SCORE_BODY), (GROUPS, GROUPING_BODY)], ids=["score", "grouping"])
def test_a_forced_run_of_a_refused_tier_returns_the_values_of_an_unforced_run(layout, tmp_path, one_user, url, body):
    refused = client_with(layout, tmp_path, **REFUSED)
    plain = post(refused, layout, body, url=url)
    assert plain.status_code == 413
    assert plain.get_json()["estimate"]["tier"] == "refused" and plain.get_json()["estimate"]["try"]["allowed"] is True
    assert post(refused, layout, {**body, "confirm": True}, url=url).status_code == 413, "confirm alone is still refused"
    forced = post(refused, layout, {**body, "force": True}, url=url)
    got, tail = frames_and_tail(forced)
    reference, want_tail = frames_and_tail(post(client_with(layout, tmp_path, **RAISED), layout, {**body, "confirm": True}, url=url))
    assert got[-1]["type"] == "result" and tail == want_tail and tail, "the same values"
    assert got[0].get("forced") is True and got[0].get("deadline_s") == 1800, got[0]
    assert "forced" not in reference[0]
    assert not cstream._TRIED, "the slot is free again"


def test_force_with_try_max_s_zero_is_refused_as_before(layout, tmp_path):
    client = client_with(layout, tmp_path, try_max_s=0, **REFUSED)
    for url, body in ((SCORE, SCORE_BODY), (GROUPS, GROUPING_BODY)):
        resp = post(client, layout, {**body, "force": True}, url=url)
        assert resp.status_code == 413
        assert resp.get_json()["estimate"]["try"] == {"allowed": False, "max_s": 0, "why": "off"}


def test_an_estimate_over_ten_times_try_max_s_is_not_offered(layout, tmp_path):
    client = client_with(layout, tmp_path, try_max_s=0.01, **REFUSED)        # the estimate is at least 0.2 s: over 0.1 s
    resp = post(client, layout, {**SCORE_BODY, "force": True}, url=SCORE)
    assert resp.status_code == 413
    assert resp.get_json()["estimate"]["try"] == {"allowed": False, "max_s": 0.01, "why": "too_long"}
    est = post(client, layout, {**GROUPING_BODY, "estimate_only": True})
    assert est.get_json()["estimate"]["try"]["why"] == "too_long"


def test_every_estimate_says_whether_it_may_be_tried(layout, tmp_path):
    client = client_with(layout, tmp_path)
    for url, body in ((SCORE, SCORE_BODY), (GROUPS, GROUPING_BODY)):
        est = post(client, layout, {**body, "estimate_only": True}, url=url).get_json()["estimate"]
        assert est["try"] == {"allowed": True, "max_s": 1800, "why": None}


@pytest.mark.parametrize("limits, body, status, reason", [
    ({"groups": 3}, grouping([CELL_TYPE]), 200, "too_many_levels"),
    ({"grid_cells": 100}, {"shape": "grid", "mode": "2d", "partitionings": [
        {"source": {"type": "obs", "key": "score"}, "binning": {"method": "equal_width", "bins": 20}},
        {"source": {"type": "obs", "key": "depth"}, "binning": {"method": "equal_width", "bins": 20}}]}, 422, "grid_too_large"),
], ids=["groups", "grid_cells"])
def test_a_size_refusal_does_not_change_under_force(layout, tmp_path, limits, body, status, reason):
    client = client_with(layout, tmp_path, **limits)
    plain, forced = post(client, layout, body), post(client, layout, {**body, "force": True})
    assert plain.status_code == forced.status_code == status
    if status == 200:
        assert last_frame(plain)["refused"]["reason"] == last_frame(forced)["refused"]["reason"] == reason
    else:
        assert plain.get_json()["reason"] == forced.get_json()["reason"] == reason


def test_a_request_over_the_body_limit_is_still_refused_under_force(layout, tmp_path):
    client = client_with(layout, tmp_path)
    big = {**SCORE_BODY, "force": True, "pad": "x" * ((16 << 20) + 1)}
    assert post(client, layout, big, url=SCORE).status_code == 413


def test_force_must_be_a_boolean(layout, tmp_path):
    assert post(client_with(layout, tmp_path), layout, {**SCORE_BODY, "force": "yes"}, url=SCORE).status_code == 400


@pytest.mark.parametrize("url, body", [(SCORE, SCORE_BODY), (GROUPS, GROUPING_BODY)], ids=["score", "grouping"])
def test_a_forced_run_past_its_deadline_ends_with_try_time_exceeded_and_frees_its_slot(layout, tmp_path, monkeypatch,
                                                                                      one_user, url, body):
    ticks = iter(range(0, 10_000))
    monkeypatch.setattr(cstream, "_clock", lambda: float(next(ticks)) * 2.0)         # two seconds a look at the clock
    client = client_with(layout, tmp_path, try_max_s=1, **REFUSED)
    frames, _ = frames_and_tail(post(client, layout, {**body, "force": True}, url=url))
    assert frames[-1]["type"] == "error" and frames[-1]["reason"] == "try_time_exceeded", frames[-1]
    assert frames[-1]["limit_s"] == 1
    assert frames[0].get("forced") is True and frames[0].get("deadline_s") == 1
    assert not cstream._TRIED, "its slot is free"
    monkeypatch.setattr(cstream, "_clock", __import__("time").monotonic)
    assert frames_and_tail(post(client_with(layout, tmp_path, **REFUSED), layout, {**body, "force": True}, url=url))[0][-1]["type"] == "result"


@pytest.mark.parametrize("url, body", [(SCORE, SCORE_BODY), (GROUPS, GROUPING_BODY)], ids=["score", "grouping"])
def test_a_second_forced_run_of_the_same_user_is_429_try_busy(layout, tmp_path, one_user, url, body):
    held = cstream.TriedRun(1800, one_user)
    assert held.claim()
    client = client_with(layout, tmp_path, **REFUSED)
    resp = post(client, layout, {**body, "force": True}, url=url)
    assert resp.status_code == 429 and resp.get_json()["reason"] == "try_busy"
    held.release()
    assert frames_and_tail(post(client, layout, {**body, "force": True}, url=url))[0][-1]["type"] == "result"


def test_a_forced_genes_request_is_tried_too(layout, tmp_path, one_user):
    body = {"shape": "genes", "partitionings": [CELL_TYPE], "group": ["c:B cell"], "layer": "logged"}
    client = client_with(layout, tmp_path, **REFUSED)
    plain = post(client, layout, body)
    assert plain.status_code == 413 or last_frame(plain).get("refused", {}).get("reason") == "groups_too_expensive"
    frames, tail = frames_and_tail(post(client, layout, {**body, "force": True}))
    assert frames[-1]["type"] == "result" and tail
    assert frames[0].get("forced") is True


def test_the_policy_reports_try_max_s(layout, tmp_path):
    assert cl.COST_LIMITS["try_max_s"].default == 1800 and cl.COST_LIMITS["try_max_s"].maximum == 18000
    assert cl.check({"try_max_s": 0}) == [] and cl.check({"try_max_s": 18001})
