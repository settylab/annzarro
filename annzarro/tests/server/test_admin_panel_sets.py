"""The admin panel-set endpoints: listing with quota use, reassign, delete.

Also the locked write they share with ``/sessions/save``: a save and a
reassignment racing from two processes must lose neither.
"""
import json
import multiprocessing
import os

import pytest

from annzarro.server import session_quota
from annzarro.server.admin import audit
from annzarro.tests.server.admin_helpers import ADMIN, USER, login, make_app, unsafe_headers

BASE = "/api/v1/admin/panel-sets"
SESSIONS = "/api/v1/sessions"
UNSAFE_CALLS = (("POST", BASE + "/reassign", {"names": ["a"], "to_owner": USER}),
                ("DELETE", BASE, {"names": ["a"]}))


@pytest.fixture
def app(tmp_path):
    return make_app(tmp_path)


def _save(client, name, **extra):
    return client.post(f"{SESSIONS}/save", json={"name": name, "dataset": "d.zarr", **extra})


def _read(app, name):
    with open(os.path.join(app.config["data_dir"], "sessions", f"{name}.json")) as f:
        return json.load(f)


def _call(client, method, path, body=None):
    return client.open(path, method=method, data=json.dumps(body if body is not None else {}),
                       headers=unsafe_headers(client))


def _seed(app, per_user=None):
    """alice owns a0..a{n-1}, root owns r0."""
    alice, root = login(app, USER), login(app, ADMIN)
    for i in range(3):
        assert _save(alice, f"a{i}").status_code == 200
    assert _save(root, "r0").status_code == 200
    return alice, root


def test_access_matrix(app):
    anon, alice, root = app.test_client(), login(app, USER), login(app, ADMIN)
    _seed(app)
    before = sorted(os.listdir(os.path.join(app.config["data_dir"], "sessions")))
    log = len(audit.read(app.admin_dir, limit=500))
    assert anon.get(BASE).status_code == 401
    assert alice.get(BASE).status_code == 403
    assert root.get(BASE).status_code == 200
    for method, path, body in UNSAFE_CALLS:
        assert anon.open(path, method=method, json=body).status_code == 401, path
        assert _call(alice, method, path, body).status_code == 403, path
    # a user's refused attempt changed nothing (the refusal itself may be audited)
    assert sorted(os.listdir(os.path.join(app.config["data_dir"], "sessions"))) == before
    assert _read(app, "a0")["owner"] == USER
    assert len(audit.read(app.admin_dir, limit=500)) >= log


def test_login_off_answers_404(tmp_path):
    app = make_app(tmp_path, auth=False)
    assert app.test_client().get(BASE).status_code == 404


def test_list_filters_pages_and_reports_usage(app):
    _, root = _seed(app)
    body = root.get(BASE).get_json()
    assert body["total"] == 4
    item = next(i for i in body["items"] if i["name"] == "a1")
    assert item["owner"] == USER and item["dataset"] == "d.zarr" and item["bytes"] > 0
    assert item["modified_by"] == USER and item["modified_at"]
    mine = root.get(BASE, query_string={"owner": USER}).get_json()
    assert mine["total"] == 3 and {i["owner"] for i in mine["items"]} == {USER}
    assert len(mine["usage"]) == 2        # usage is server-wide, whatever the filter
    page = root.get(BASE, query_string={"limit": 2, "offset": 3}).get_json()
    assert page["total"] == 4 and len(page["items"]) == 1
    assert root.get(BASE, query_string={"limit": "x"}).status_code == 400


def test_usage_is_what_the_quota_module_counts(tmp_path):
    app = make_app(tmp_path, max_sessions_per_user=3, max_sessions=10, max_sessions_mb=2)
    alice, root = _seed(app)
    refused = _save(alice, "a3")
    assert refused.status_code == 409
    body = root.get(BASE).get_json()
    usage = {u["owner"]: u for u in body["usage"]}
    assert usage[USER]["count"] == 3 and usage[USER]["limit"] == 3
    assert refused.get_json()["used"] == usage[USER]["count"]
    assert refused.get_json()["limit"] == usage[USER]["limit"]
    sessions = os.path.join(app.config["data_dir"], "sessions")
    on_disk = sum(os.path.getsize(os.path.join(sessions, n)) for n in os.listdir(sessions) if n.endswith(".json"))
    held = session_quota.entries(sessions)
    assert usage[USER]["bytes"] + usage[ADMIN]["bytes"] == on_disk == sum(e.size for e in held)
    assert body["server"] == {"count": 4, "max": 10, "mb": round(on_disk / 2 ** 20, 2), "max_mb": 2.0}
    assert body["server"] == session_quota.totals(app.config, held)
    assert body["usage"] == session_quota.usage_by_owner(app.config, held)
    assert [u["owner"] for u in body["usage"]][0] == USER      # the busiest first


def test_no_limit_is_null(tmp_path):
    app = make_app(tmp_path, max_sessions_per_user=0, max_sessions=0, max_sessions_mb=0)
    _, root = _seed(app)
    body = root.get(BASE).get_json()
    assert all(u["limit"] is None for u in body["usage"])
    assert body["server"]["max"] is None and body["server"]["max_mb"] is None


def test_reassign_by_names_is_audited_and_the_new_owner_may_modify(app):
    alice, root = _seed(app)
    response = _call(root, "POST", BASE + "/reassign", {"names": ["a0", "a1"], "to_owner": ADMIN})
    assert response.status_code == 200
    assert response.get_json() == {"moved": 2, "unchanged": 0, "over_quota": False}
    stored = _read(app, "a0")
    assert stored["owner"] == ADMIN and stored["modified_by"] == ADMIN and stored["dataset"] == "d.zarr"
    assert _save(alice, "a0").status_code == 403         # no longer hers
    assert _save(alice, "a2").status_code == 200
    record = audit.read(app.admin_dir, limit=1)[0]
    assert record["action"] == "panelset.reassign" and record["target"] == ADMIN
    assert record["detail"]["count"] == 2 and record["detail"]["from"] == [USER]


def test_reassign_from_owner_and_over_quota(tmp_path):
    app = make_app(tmp_path, max_sessions_per_user=3)
    _, root = _seed(app)
    assert _save(root, "r1").status_code == 200
    response = _call(root, "POST", BASE + "/reassign", {"from_owner": USER, "to_owner": ADMIN})
    assert response.get_json() == {"moved": 3, "unchanged": 0, "over_quota": True}   # root now holds 5 of 3
    assert {i["owner"] for i in root.get(BASE).get_json()["items"]} == {ADMIN}
    again = _call(root, "POST", BASE + "/reassign", {"from_owner": ADMIN, "to_owner": ADMIN}).get_json()
    assert again["moved"] == 0 and again["unchanged"] == 5
    assert audit.read(app.admin_dir, limit=1)[0]["action"] == "panelset.reassign"


def test_reassign_refusals_move_nothing(app):
    _, root = _seed(app)
    log = len(audit.read(app.admin_dir, limit=500))
    unknown = _call(root, "POST", BASE + "/reassign", {"names": ["a0"], "to_owner": "nobody"})
    assert unknown.status_code == 404 and unknown.get_json()["reason"] == "unknown_user"
    absent = _call(root, "POST", BASE + "/reassign", {"names": ["a0", "ghost", "../x"], "to_owner": ADMIN})
    assert absent.status_code == 404 and absent.get_json()["reason"] == "not_found"
    assert set(absent.get_json()["names"]) == {"ghost", "../x"}
    assert _read(app, "a0")["owner"] == USER
    for body in ({"to_owner": ADMIN}, {"names": ["a0"], "from_owner": USER, "to_owner": ADMIN},
                 {"names": [], "to_owner": ADMIN}, {"names": [1], "to_owner": ADMIN},
                 {"names": ["a0"]}, {"from_owner": "", "to_owner": ADMIN}):
        assert _call(root, "POST", BASE + "/reassign", body).status_code == 400, body
    assert len(audit.read(app.admin_dir, limit=500)) == log


def test_reassign_does_not_rewrite_an_unreadable_file(app):
    _, root = _seed(app)
    path = os.path.join(app.config["data_dir"], "sessions", "broken.json")
    with open(path, "w") as f:
        f.write("{not json")
    response = _call(root, "POST", BASE + "/reassign", {"names": ["a0", "broken"], "to_owner": ADMIN})
    assert response.status_code == 409 and response.get_json()["reason"] == "unreadable"
    assert open(path).read() == "{not json" and _read(app, "a0")["owner"] == USER


def test_the_old_owner_route_still_assigns(app):
    _, root = _seed(app)
    response = _call(root, "POST", SESSIONS + "/owner", {"name": "a0", "owner": ADMIN})
    assert response.status_code == 200 and response.get_json()["previous_owner"] == USER
    assert _read(app, "a0")["owner"] == ADMIN
    missing = _call(root, "POST", SESSIONS + "/owner", {"name": "ghost", "owner": ADMIN})
    assert missing.status_code == 404
    record = audit.read(app.admin_dir, limit=1)[0]
    assert record["action"] == "panelset.reassign" and record["target"] == ADMIN
    assert record["detail"] == {"names": ["a0"], "from": [USER]}


def test_delete(app):
    alice, root = _seed(app)
    response = _call(root, "DELETE", BASE, {"names": ["a0", "ghost", "r0"]})
    assert response.get_json() == {"deleted": 2, "missing": ["ghost"]}
    sessions = os.path.join(app.config["data_dir"], "sessions")
    assert sorted(n for n in os.listdir(sessions) if n.endswith(".json")) == ["a1.json", "a2.json"]
    record = audit.read(app.admin_dir, limit=1)[0]
    assert record["action"] == "panelset.delete" and record["detail"]["count"] == 2
    assert "a0 (alice)" in record["detail"]["names"]
    assert root.get(BASE).get_json()["total"] == 2
    assert _call(root, "DELETE", BASE, {"names": "a1"}).status_code == 400
    assert _call(root, "DELETE", BASE, {"names": ["x"] * 1001}).status_code == 400


def test_a_name_cannot_leave_the_directory(app, tmp_path):
    _, root = _seed(app)
    outside = os.path.join(app.config["data_dir"], "outside.json")
    with open(outside, "w") as f:
        f.write("{}")
    sessions = os.path.join(app.config["data_dir"], "sessions")
    os.symlink(outside, os.path.join(sessions, "link.json"))
    response = _call(root, "DELETE", BASE, {"names": ["../outside", "link"]})
    assert response.get_json() == {"deleted": 0, "missing": ["../outside", "link"]}
    assert os.path.exists(outside)


def test_lock_timeout_answers_503(app):
    from annzarro.server import atomic_store, session_store
    _, root = _seed(app)
    sessions = os.path.join(app.config["data_dir"], "sessions")
    with session_store.locked(sessions):
        # the same thread cannot take the lock twice, so hold it from another process
        pass
    holder = multiprocessing.get_context("spawn").Process(target=_hold, args=(sessions, 4))
    holder.start()
    try:
        _wait_held(sessions)
        app.config["lock_timeout_s"] = 0.2
        atomic_store.set_default_lock_timeout(0.2)
        assert _save(login(app, USER), "a0").status_code == 503
        assert _call(root, "DELETE", BASE, {"names": ["a1"]}).status_code == 503
        assert _call(root, "POST", BASE + "/reassign", {"names": ["a1"], "to_owner": ADMIN}).status_code == 503
        assert _read(app, "a1")["owner"] == USER
    finally:
        atomic_store.set_default_lock_timeout(10)
        holder.join()


def _hold(sessions, seconds):
    import time
    from annzarro.server import session_store
    with session_store.locked(sessions):
        open(os.path.join(sessions, ".held"), "w").close()
        time.sleep(seconds)


def _wait_held(sessions):
    import time
    for _ in range(300):
        if os.path.exists(os.path.join(sessions, ".held")):
            return
        time.sleep(0.05)
    raise AssertionError("the lock holder did not start")


ROUNDS = 100
HANDOVERS = 60
BLOB = "x" * 300_000      # a long read-to-write window for the save


def _rank(owner):
    """0 for the admin who made the set, k + 1 for the user ``u<k>`` it was handed to."""
    return 0 if owner == ADMIN else int(owner[1:]) + 1


def _saver(tmp_path, results, start):
    """The admin saves one set ROUNDS times; after each save the set's owner must
    not have moved back to someone it was already handed on from."""
    app = make_app(tmp_path, admin_rate_per_minute=100000)
    root = login(app, ADMIN)
    path = os.path.join(app.config["data_dir"], "sessions", "shared.json")
    start.wait(30)
    codes, seen, went_back = [], 0, []
    for i in range(ROUNDS):
        codes.append(root.post(f"{SESSIONS}/save", json={"name": "shared", "dataset": "d.zarr", "n": i,
                                                         "blob": BLOB}).status_code)
        with open(path) as f:
            rank = _rank(json.load(f)["owner"])
        if rank < seen:
            went_back.append((i, seen, rank))
        seen = max(seen, rank)
    results.put(("saver", (codes, went_back)))


def _reassigner(tmp_path, results, start):
    """The admin hands the set on to u0, u1, ...; right after each handover the set
    must belong to that user or a later one."""
    app = make_app(tmp_path, admin_rate_per_minute=100000)
    root = login(app, ADMIN)
    path = os.path.join(app.config["data_dir"], "sessions", "shared.json")
    start.wait(30)
    codes, went_back = [], []
    for k in range(HANDOVERS):
        codes.append(root.open(BASE + "/reassign", method="POST",
                               data=json.dumps({"names": ["shared"], "to_owner": f"u{k}"}),
                               headers=unsafe_headers(root)).status_code)
        with open(path) as f:
            rank = _rank(json.load(f)["owner"])
        if rank < k + 1:
            went_back.append((k, rank))
    results.put(("reassigner", (codes, went_back)))


def test_concurrent_save_and_reassign_across_processes_lose_nothing(tmp_path):
    app = make_app(tmp_path, admin_rate_per_minute=100000)
    from annzarro.server.auth import AuthManager
    manager = AuthManager(user_file=app.config["user_file"])
    for k in range(HANDOVERS):
        manager.create_user(f"u{k}", "correct horse battery")
    assert _save(login(app, ADMIN), "shared", n=-1).status_code == 200
    ctx = multiprocessing.get_context("spawn")
    results = ctx.Queue()
    start = ctx.Barrier(2)
    procs = [ctx.Process(target=_saver, args=(tmp_path, results, start)),
             ctx.Process(target=_reassigner, args=(tmp_path, results, start))]
    for p in procs:
        p.start()
    got = dict(results.get(timeout=120) for _ in procs)
    for p in procs:
        p.join(30)
    assert got["saver"][0] == [200] * ROUNDS
    assert got["reassigner"][0] == [200] * HANDOVERS
    # a save that read the set before a handover must not write the old owner back
    assert got["saver"][1] == [] and got["reassigner"][1] == []
    final = _read(app, "shared")
    assert final["n"] == ROUNDS - 1                      # the last save is the one on disk
    assert final["owner"] == f"u{HANDOVERS - 1}"         # and the last handover too
    assert [f for f in os.listdir(os.path.join(app.config["data_dir"], "sessions")) if f.endswith(".tmp")] == []


def test_reassign_owner_takes_every_set_of_one_owner_under_the_shared_lock(app):
    from annzarro.server import session_store
    _seed(app)
    sessions = os.path.join(app.config["data_dir"], "sessions")
    with app.test_request_context():
        assert session_store.reassign_owner(sessions, USER, ADMIN) == 3
        assert session_store.reassign_owner(sessions, USER, ADMIN) == 0
    assert {_read(app, f"a{i}")["owner"] for i in range(3)} == {ADMIN}
    assert os.path.exists(os.path.join(sessions, ".lock.lock"))      # slice 2 locks <dir>/.lock


def test_delete_of_a_directory_named_like_a_set_is_missing_not_a_500(app):
    _, root = _seed(app)
    os.mkdir(os.path.join(app.config["data_dir"], "sessions", "dir.json"))
    response = _call(root, "DELETE", BASE, {"names": ["dir"]})
    assert response.status_code == 200 and response.get_json() == {"deleted": 0, "missing": ["dir"]}


def test_rename_is_atomic_and_never_writes_through_a_link(app):
    alice, _ = _seed(app)
    sessions = os.path.join(app.config["data_dir"], "sessions")
    os.symlink(os.path.join(sessions, "a2.json"), os.path.join(sessions, "trap.json"))
    before = _read(app, "a2")
    refused = alice.post(f"{SESSIONS}/rename", json={"old_name": "a0", "new_name": "trap"})
    assert refused.status_code == 409
    assert _read(app, "a2") == before and os.path.exists(os.path.join(sessions, "a0.json"))
    ok = alice.post(f"{SESSIONS}/rename", json={"old_name": "a0", "new_name": "moved"})
    assert ok.status_code == 200 and _read(app, "moved")["owner"] == USER
    assert [f for f in os.listdir(sessions) if f.endswith(".tmp")] == []


def test_sets_keep_the_mode_open_w_gave(app):
    """New sets get 0666 & ~umask; an existing set keeps its mode through save, reassign and rename."""
    from annzarro.server import session_store
    alice, root = _seed(app)
    sessions = os.path.join(app.config["data_dir"], "sessions")
    mode = lambda name: os.stat(os.path.join(sessions, f"{name}.json")).st_mode & 0o777   # noqa: E731
    assert mode("a0") == 0o666 & ~session_store._UMASK
    os.chmod(os.path.join(sessions, "a1.json"), 0o640)
    assert _save(alice, "a1", note="again").status_code == 200
    assert mode("a1") == 0o640
    assert _call(root, "POST", BASE + "/reassign", {"names": ["a1"], "to_owner": ADMIN}).status_code == 200
    assert mode("a1") == 0o640
    assert alice.post(f"{SESSIONS}/rename", json={"old_name": "a2", "new_name": "a2b"}).status_code == 200
    os.chmod(os.path.join(sessions, "a2b.json"), 0o600)
    assert root.post(f"{SESSIONS}/rename", json={"old_name": "a2b", "new_name": "a2c"}).status_code == 200
    assert mode("a2c") == 0o600
