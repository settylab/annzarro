"""The Health section: snapshots, their merge, refusal counts, the cache clear, and who may see server details."""
import json
import os
import subprocess
import sys
import threading
import time

import numpy as np
import pytest

from annzarro.core import read_guard, zarr_reader
from annzarro.server import health, snapshots
from annzarro.server.admin import audit
from annzarro.tests.server.admin_helpers import ADMIN, USER, login, make_app, unsafe_headers

HEALTH = "/api/v1/admin/health"
CLEAR = "/api/v1/admin/cache/clear"


@pytest.fixture
def app(tmp_path):
    app = make_app(tmp_path)
    with app.app_context():
        yield app


def _get(app, user=ADMIN, path=HEALTH):
    return login(app, user).get(path)


def _other_worker(app, pid, host="other-host"):
    """A second worker's monitor, writing into the same snapshot directory."""
    mon = health.monitor(app)
    return health.Monitor(snapshots.Snapshots(mon.snapshots.directory, pid=pid, host=host), window_s=mon.window_s)


class _Reply:
    """What the monitor reads of a reply."""
    def __init__(self, status, body=None):
        from flask import jsonify
        self.response = jsonify(body or {})
        self.response.status_code = status


def test_the_endpoint_reports_this_worker(app):
    body = _get(app).get_json()
    assert [w["pid"] for w in body["workers"]] == [os.getpid()]
    worker = body["workers"][0]
    assert worker["stale"] is False and worker["age_s"] < 5
    assert set(worker["read_guard"]) >= {"in_flight_mb", "budget_mb", "share_mb", "by_requester"}
    assert set(worker["cache"]) >= {"memory_mb", "max_mb", "datasets", "name_index_mb"}
    assert worker["rss_mb"] > 1 and body["totals"]["rss_mb"] == worker["rss_mb"]
    assert body["totals"]["refusals"] == 0


def test_refusals_are_counted_by_their_reason(app):
    client = login(app, USER)
    assert client.get(HEALTH).status_code == 403                     # admin_only
    assert client.get(HEALTH).status_code == 403
    assert client.get("/api/v1/cache/info").status_code == 403       # admin_only again
    assert client.get("/api/v1/nope").status_code == 404             # no JSON body: http_404
    anonymous = app.test_client().get("/api/v1/data/info?dataset_path=x")
    assert anonymous.status_code == 401
    refusals = _get(app).get_json()["workers"][0]["refusals"]
    assert refusals["admin_only"] == 3
    assert refusals["http_404"] == 1
    assert refusals["login_required"] == 1
    assert "http_200" not in refusals and sum(refusals.values()) == 5


def test_a_reply_without_a_reason_counts_as_its_status(app):
    mon = health.monitor(app)
    with app.test_request_context("/x"):
        mon.count(_Reply(500).response)
        mon.count(_Reply(400, {"reason": "a" * 100}).response)
    refusals = mon.section()["refusals"]
    assert refusals["http_500"] == 1 and refusals["a" * 40] == 1


def test_distinct_reasons_are_bounded(app):
    mon = health.monitor(app)
    for n in range(health.MAX_REASONS + 20):
        mon.count(_Reply(400, {"reason": f"r{n}"}).response)
    refusals = mon.section()["refusals"]
    assert len(refusals) == health.MAX_REASONS + 1 and refusals["other"] == 20


def test_snapshots_merge_across_two_workers(app):
    other = _other_worker(app, pid=os.getpid() + 1)
    other.count(_Reply(503, {"reason": "read_busy"}).response, "carol")
    other.count(_Reply(200).response)
    other.snapshots.write()
    login(app, USER).get(HEALTH)                                     # one admin_only here
    body = _get(app).get_json()
    by_pid = {w["pid"]: w for w in body["workers"]}
    assert set(by_pid) == {os.getpid(), os.getpid() + 1}
    assert by_pid[os.getpid() + 1]["refusals"] == {"read_busy": 1}
    assert by_pid[os.getpid() + 1]["requests"] == 2
    assert body["totals"]["refusals"] == 2                           # read_busy there, admin_only here
    assert "carol" in [a["username"] for a in body["active"]]


def test_active_users_take_the_latest_sighting_across_workers(app):
    other = _other_worker(app, pid=os.getpid() + 1)
    other._last_seen["alice"] = time.time() - 100
    other._last_seen["old"] = time.time() - app.config.get("session_timeout", 8 * 3600) - 100
    other.snapshots.write()
    login(app, USER)
    _get(app)
    active = {a["username"]: a["last_seen"] for a in _get(app).get_json()["active"]}
    assert set(active) == {"alice", ADMIN, USER}                     # "old" is outside the window


def test_last_seen_by_user_merges_workers_without_writing(app):
    other = _other_worker(app, pid=os.getpid() + 1)
    other._last_seen["alice"] = time.time() - 50
    other.snapshots.write()
    login(app, USER)
    before = sorted(os.listdir(other.snapshots.directory))
    seen = health.last_seen(app)
    assert set(seen) == {"alice", USER} and seen["alice"].endswith("+00:00")
    assert sorted(os.listdir(other.snapshots.directory)) == before
    assert "nobody" not in seen


def test_an_expired_session_is_not_seen(app):
    client = login(app, USER)
    health.monitor(app)._last_seen.clear()
    with client.session_transaction() as sess:
        sess["last_activity"] = time.time() - app.config.get("session_timeout", 8 * 3600) - 10
    client.get("/api/v1/config")
    assert USER not in health.last_seen(app)
    client = login(app, USER)
    client.get("/api/v1/config")
    assert USER in health.last_seen(app)


def test_a_dead_process_on_this_host_is_dropped_and_its_file_removed(app):
    gone = subprocess.Popen([sys.executable, "-c", "pass"])
    gone.wait()
    dead = _other_worker(app, pid=gone.pid, host=health.monitor(app).snapshots.host).snapshots
    dead.write()
    assert os.path.exists(dead.path)
    pids = [w["pid"] for w in _get(app).get_json()["workers"]]
    assert gone.pid not in pids and not os.path.exists(dead.path)


def _old_snapshot(app, pid, host):
    other = _other_worker(app, pid=pid, host=host)
    other.count(_Reply(503, {"reason": "read_busy"}).response)
    snap = other.snapshots.snapshot()
    snap["written"] -= health.STALE_S + 60
    os.makedirs(other.snapshots.directory, exist_ok=True)
    snapshots.atomic_store.write_json(other.snapshots.path, snap)
    return other


@pytest.mark.parametrize("host", ["this", "other-host"])
def test_an_old_snapshot_is_stale_and_left_out_of_the_totals(app, host):
    # its writer thread has not run for a minute: stuck, or (on another host) gone
    pid = os.getppid() if host == "this" else os.getpid() + 1      # this host: a live process
    _old_snapshot(app, pid, health.monitor(app).snapshots.host if host == "this" else host)
    body = _get(app).get_json()
    stale = [w for w in body["workers"] if w["stale"]]
    assert [w["pid"] for w in stale] == [pid] and "idle" not in stale[0]
    assert body["totals"]["refusals"] == 0
    assert stale[0]["refusals"] == {"read_busy": 1}                  # still shown, never silently summed


def test_a_garbled_snapshot_is_ignored(app):
    directory = health.monitor(app).snapshots.directory
    os.makedirs(directory, exist_ok=True)
    for name, text in (("a-1.json", "{not json"), ("b-2.json", "[]"), ("c-3.json", '{"pid": "x"}')):
        with open(os.path.join(directory, name), "w") as f:
            f.write(text)
    assert [w["pid"] for w in _get(app).get_json()["workers"]] == [os.getpid()]


def test_one_writer_thread_per_process_starts_on_the_first_request(app):
    snaps = health.monitor(app).snapshots
    def writers():
        return [t for t in threading.enumerate() if t.name == "worker-snapshot"]
    before = len(writers())
    client = login(app, ADMIN)
    for _ in range(5):
        client.get("/api/v1/config")
    assert len(writers()) == before + 1
    assert snaps._writer_pid == os.getpid()
    deadline = time.time() + 5
    while not os.path.exists(snaps.path) and time.time() < deadline:
        time.sleep(0.05)
    assert snapshots.atomic_store.read_json(snaps.path)["health"]["requests"] >= 1


def test_the_writer_stops_when_the_state_directory_is_gone(tmp_path):
    snaps = snapshots.Snapshots(str(tmp_path / "state" / "health"), interval_s=0.01)
    (tmp_path / "state").mkdir()
    assert snaps.write() is not None
    import shutil
    shutil.rmtree(tmp_path / "state")
    assert snaps.write() is None and not (tmp_path / "state").exists()     # never recreated
    thread = threading.Thread(target=snapshots._write_forever, args=(__import__("weakref").ref(snaps),))
    thread.start()
    thread.join(2)
    assert not thread.is_alive()


def test_the_snapshot_file_is_private_and_holds_no_paths(app):
    _get(app)
    path = health.monitor(app).snapshots.path
    assert oct(os.stat(path).st_mode & 0o777) == "0o600"
    assert app.config["data_dir"] not in open(path).read()


def test_no_hook_without_login(tmp_path):
    app = make_app(tmp_path, auth=False)
    assert health.monitor(app) is None
    assert app.test_client().get("/api/v1/config").status_code == 200


def test_read_guard_snapshot(monkeypatch):
    read_guard.configure(max_mb=10, budget_mb=40)
    try:
        with read_guard.admit(5 * 2 ** 20):
            snap = read_guard.snapshot()
            assert snap["in_flight_mb"] == 5 and snap["budget_mb"] == 40
            assert snap["by_requester"] == []                         # nobody named
        read_guard.requester("bob")
        with read_guard.admit(6 * 2 ** 20):
            snap = read_guard.snapshot()
            assert snap["by_requester"] == [{"who": "bob", "mb": 6}]
        assert read_guard.snapshot()["in_flight_mb"] == 0
    finally:
        read_guard.requester(None)
        read_guard.configure()


def test_read_guard_snapshot_lists_the_largest_holders_first():
    read_guard.configure(max_mb=100, budget_mb=1000)
    try:
        with read_guard._cond:
            read_guard._by_owner.update({f"u{n}": n * 2 ** 20 for n in range(1, 15)})
        who = [h["who"] for h in read_guard.snapshot()["by_requester"]]
        assert who[:3] == ["u14", "u13", "u12"] and len(who) == 10
    finally:
        read_guard._by_owner.clear()
        read_guard.configure()


# Cache clear

def _cache_key(path):
    import urllib.parse
    return f"path:{urllib.parse.quote(path, safe='')}:test_data"


def _fill():
    zarr_reader.clear_cache()
    for name in ("one", "two"):
        zarr_reader._add_to_cache(_cache_key(f"/d/{name}.zarr"), np.random.rand(10, 10), "matrix")


def _clear(client, body):
    return client.post(CLEAR, data=json.dumps(body), headers=unsafe_headers(client))


def test_clear_empties_the_cache_and_is_audited(app):
    _fill()
    client = login(app, ADMIN)
    reply = _clear(client, {})
    assert reply.status_code == 200 and reply.get_json()["cleared_all"] is True
    assert zarr_reader.get_cache_info()["item_counts"]["total"] == 0
    last = audit.read(app.admin_dir, limit=1)[0]
    assert (last["action"], last["actor"], last["target"], last["outcome"]) == ("cache.clear", ADMIN, None, "ok")


def test_clear_one_dataset(app):
    _fill()
    reply = _clear(login(app, ADMIN), {"dataset_path": "/d/one.zarr"})
    assert reply.status_code == 200
    assert list(zarr_reader.get_cache_info()["datasets"]) == ["/d/two.zarr"]
    assert audit.read(app.admin_dir, limit=1)[0]["target"] == "/d/one.zarr"


def test_clear_bumps_the_generation_for_every_worker(app):
    from annzarro.core import freshness
    before = freshness.generation("/d/one.zarr")
    _clear(login(app, ADMIN), {"dataset_path": "/d/one.zarr"})
    assert freshness.generation("/d/one.zarr") != before


@pytest.mark.parametrize("body", [{"dataset_path": 5}, {"dataset_path": ""}, {"dataset_path": "x" * 5000}, []])
def test_clear_refuses_a_bad_body_without_clearing(app, body):
    _fill()
    reply = _clear(login(app, ADMIN), body)
    assert reply.status_code == 400 and reply.get_json()["reason"] == "bad_request"
    assert zarr_reader.get_cache_info()["item_counts"]["total"] == 2


def test_the_legacy_reset_is_audited_too(app):
    _fill()
    client = login(app, ADMIN)
    reply = client.post("/api/v1/cache/reset?dataset_path=/d/one.zarr", headers=unsafe_headers(client))
    assert reply.status_code == 200
    last = audit.read(app.admin_dir, limit=1)[0]
    assert (last["action"], last["target"]) == ("cache.clear", "/d/one.zarr")


def test_a_user_cannot_clear_and_nothing_is_audited(app):
    _fill()
    client = login(app, USER)
    assert _clear(client, {}).status_code == 403
    assert client.post("/api/v1/cache/reset", headers=unsafe_headers(client)).status_code == 403
    assert zarr_reader.get_cache_info()["item_counts"]["total"] == 2
    assert not [r for r in audit.read(app.admin_dir, limit=500) if r["outcome"] == "ok"]


# Who may see server details

PATH_WORDS = ("data_dir", "hostname", "pid", "platform", "python_version", "start_time")


@pytest.mark.parametrize("path", ["/api/v1/status", "/api/v1/cache/info", HEALTH, CLEAR])
def test_the_access_matrix(app, path):
    post = path == CLEAR
    def call(client):
        if post:
            return client.post(path, data="{}", headers=unsafe_headers(client)) if "csrf" in _session(client) \
                else client.post(path, data="{}")
        return client.get(path)
    anonymous, user, admin = app.test_client(), login(app, USER), login(app, ADMIN)
    assert call(anonymous).status_code in (401, 302)
    assert call(admin).status_code == 200
    reply = call(user)
    if path == "/api/v1/status":
        assert reply.status_code == 200 and set(reply.get_json()) == {"server"}
        assert set(reply.get_json()["server"]) == {"status", "version"}
    else:
        assert reply.status_code == 403


def _session(client):
    with client.session_transaction() as sess:
        return dict(sess)


@pytest.mark.parametrize("path", ["/api/v1/status", "/api/v1/cache/info", HEALTH])
def test_non_admins_get_no_paths_from_any_status_route(app, tmp_path, path):
    _fill()
    for client in (login(app, USER), app.test_client()):
        text = client.get(path).get_data(as_text=True)
        for secret in (str(tmp_path), app.config["data_dir"], "/d/one.zarr", health.monitor(app).snapshots.host or "-",
                       *PATH_WORDS):
            assert secret not in text, (path, secret)


def test_the_admin_still_gets_the_full_status(app):
    body = _get(app, ADMIN, "/api/v1/status").get_json()
    assert body["config"]["data_dir"] == app.config["data_dir"] and body["server"]["pid"] == os.getpid()


def test_a_local_server_without_login_keeps_its_status_and_cache_info(tmp_path):
    app = make_app(tmp_path, auth=False, host="127.0.0.1")
    client = app.test_client()
    assert client.get("/api/v1/status").get_json()["config"]["data_dir"] == app.config["data_dir"]
    assert client.get("/api/v1/cache/info").status_code == 200


def test_a_shared_server_without_login_has_no_admins(tmp_path):
    app = make_app(tmp_path, auth=False, hosted=True)
    client = app.test_client()
    assert set(client.get("/api/v1/status").get_json()["server"]) == {"status", "version"}
    assert client.get("/api/v1/cache/info").status_code == 403
