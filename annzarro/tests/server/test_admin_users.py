"""The users endpoints of the admin interface, and the last-admin rule behind them.

The generic access matrix (test_admin_access.py) already walks every admin
route; this file adds the behaviour: each endpoint's success and error codes,
the audit record, a generated password shown once, and "at least one admin"
across processes through the API and the command line.
"""
import json
import logging
import multiprocessing
import os
import time

import pytest

from annzarro import cli
from annzarro.server.admin import audit
from annzarro.server.auth import AuthManager
from annzarro.tests.server.admin_helpers import (ADMIN, PASSWORD, USER, login, make_app, unsafe_headers)

BASE = "/api/v1/admin/users"


@pytest.fixture
def app(tmp_path):
    return make_app(tmp_path)


@pytest.fixture
def admin(app):
    return login(app, ADMIN)


def call(client, method, path, body=None, **headers):
    return client.open(path, method=method, data=json.dumps({} if body is None else body),
                       headers=unsafe_headers(client, **headers))


def records(app, **match):
    return [r for r in audit.read(app.admin_dir, limit=500)
            if all(r.get(k) == v for k, v in match.items())]


def add_admin(app, name="boss"):
    AuthManager(user_file=app.config["user_file"]).create_user(name, PASSWORD, is_admin=True)


# ---- who may call them

NEW_ROUTES = [
    ("GET", BASE, None), ("POST", BASE, {"username": "carol", "generate": True}),
    ("DELETE", f"{BASE}/{USER}", {}), ("POST", f"{BASE}/{USER}/password", {"generate": True}),
    ("POST", f"{BASE}/{USER}/admin", {"is_admin": True}), ("POST", f"{BASE}/{USER}/unlock", {}),
]


def test_the_user_routes_exist_and_are_in_the_matrix(app):
    from annzarro.tests.server.admin_helpers import admin_rules
    have = {(r, m) for r, m, _ in admin_rules(app)}
    for method, path, _ in NEW_ROUTES:
        rule = path.replace(f"/{USER}", "/<username>")
        assert (rule, method) in have, (method, rule)


def test_a_plain_user_changes_nothing_and_each_attempt_is_audited(app):
    client = login(app, USER)
    before = open(app.config["user_file"]).read()
    for method, path, body in NEW_ROUTES:
        response = call(client, method, path, body)
        assert response.status_code == 403 and response.get_json()["reason"] == "admin_only", (method, path)
    assert open(app.config["user_file"]).read() == before
    assert all(r["outcome"] == "refused:admin_only" and r["actor"] == USER for r in records(app))


def test_anonymous_gets_nothing_from_the_user_routes(app):
    client = app.test_client()
    for method, path, body in NEW_ROUTES:
        response = client.open(path, method=method, data=json.dumps(body or {}),
                               headers={"Content-Type": "application/json"})
        assert response.status_code == 401, (method, path)


# ---- list

def test_list_shows_the_table_without_secrets(app, admin):
    body = admin.get(BASE).get_json()
    assert [u["username"] for u in body] == [USER, ADMIN]
    root = body[1]
    assert root["is_admin"] is True and root["locked"] == [] and root["panel_sets"] == 0
    assert set(root) == {"username", "is_admin", "last_login", "password_changed_at", "locked",
                         "panel_sets", "last_seen"}
    assert "scrypt" not in json.dumps(body) and "pbkdf2" not in json.dumps(body)


def test_list_counts_panel_sets_and_shows_active_locks(app, admin):
    sessions = os.path.join(app.config["data_dir"], "sessions")
    os.makedirs(sessions)
    for i, owner in enumerate([USER, USER, ADMIN, None]):
        with open(os.path.join(sessions, f"s{i}.json"), "w") as f:
            json.dump({"owner": owner, "layout": {}}, f)
    manager = AuthManager(user_file=app.config["user_file"])
    for _ in range(5):
        manager.authenticate(USER, "wrong", client_ip="10.0.0.9")
    by = {u["username"]: u for u in admin.get(BASE).get_json()}
    assert by[USER]["panel_sets"] == 2 and by[ADMIN]["panel_sets"] == 1
    lock = by[USER]["locked"]
    assert [(entry["address"], entry["failures"]) for entry in lock] == [("10.0.0.9", 5)]
    assert lock[0]["until"]


# ---- add

def test_add_with_a_password(app, admin):
    response = call(admin, "POST", BASE, {"username": "carol", "password": "a long enough one", "is_admin": True})
    assert response.status_code == 201 and response.get_json() == {"username": "carol"}
    user = AuthManager(user_file=app.config["user_file"]).get_user("carol")
    assert user.is_admin and login_works(app, "carol", "a long enough one")
    assert records(app, action="user.add")[0]["detail"] == {"generated": False, "is_admin": True}


def login_works(app, name, password):
    return app.test_client().post("/login", data={"username": name, "password": password}).status_code == 302


@pytest.mark.parametrize("body,reason", [
    ({"username": "has space", "generate": True}, "invalid_username"),
    ({"username": "", "generate": True}, "invalid_username"),
    ({"username": "x" * 65, "generate": True}, "invalid_username"),
    ({"username": "a/b", "generate": True}, "invalid_username"),
    ({"generate": True}, "invalid_username"),
    ({"username": "carol", "password": "short"}, "weak_password"),
    ({"username": "carolcarol1", "password": "carolcarol1"}, "weak_password"),
    ({"username": "carol"}, "bad_request"),
    ({"username": "carol", "password": "long enough password", "generate": True}, "bad_request"),
    ({"username": "carol", "generate": True, "is_admin": "yes"}, "bad_request"),
])
def test_add_refuses_bad_input_and_writes_nothing(app, admin, body, reason):
    before = open(app.config["user_file"]).read()
    response = call(admin, "POST", BASE, body)
    assert response.status_code == 400 and response.get_json()["reason"] == reason
    assert open(app.config["user_file"]).read() == before


def test_add_refuses_an_existing_name_and_audits_the_refusal(app, admin):
    response = call(admin, "POST", BASE, {"username": USER, "generate": True})
    assert response.status_code == 409 and response.get_json()["reason"] == "user_exists"
    assert records(app, action="user.add")[0]["outcome"] == "refused:user_exists"
    assert login_works(app, USER, PASSWORD), "the existing account is untouched"


# ---- the generated password: once, nowhere else

class Logs:
    """Every log record, whatever logger (create_app resets the root handlers)."""

    def __init__(self):
        self.records, self.handler = [], logging.Handler(level=logging.DEBUG)
        self.handler.emit = self.records.append

    def __enter__(self):
        root = logging.getLogger()
        self.level = root.level
        root.setLevel(logging.DEBUG)
        root.addHandler(self.handler)
        return self

    def __exit__(self, *exc):
        root = logging.getLogger()
        root.removeHandler(self.handler)
        root.setLevel(self.level)

    @property
    def text(self):
        return "\n".join(r.getMessage() for r in self.records)


def test_a_generated_password_is_in_the_reply_only(app, admin, tmp_path):
    with Logs() as logs:
        made = call(admin, "POST", BASE, {"username": "carol", "generate": True}).get_json()
        reset = call(admin, "POST", f"{BASE}/{USER}/password", {"generate": True}).get_json()
        listed = admin.get(BASE).get_data(as_text=True)
    first, second = made["password"], reset["password"]
    assert len(first) >= 16 and len(second) >= 16 and first != second
    assert login_works(app, "carol", first) and login_works(app, USER, second)
    assert not login_works(app, USER, PASSWORD), "the old password is gone"
    for secret in (first, second):
        assert secret not in logs.text, "not in the server log"
        assert secret not in listed
        for name in os.listdir(app.admin_dir):
            path = os.path.join(app.admin_dir, name)
            if os.path.isfile(path):
                assert secret not in open(path).read(), f"not in {name}"
        assert secret not in open(app.config["user_file"]).read(), "only a hash is stored"
        assert secret not in open(app.config["log_file"]).read() if os.path.exists(app.config["log_file"]) else True
    assert [r["detail"] for r in records(app, action="user.password")] == [{"generated": True}]


def test_a_chosen_password_is_not_echoed_or_logged_either(app, admin):
    chosen = "my-own-very-private-pw"
    with Logs() as logs:
        reply = call(admin, "POST", f"{BASE}/{USER}/password", {"password": chosen})
    assert reply.status_code == 200 and reply.get_json() == {}
    assert chosen not in logs.text and chosen not in reply.get_data(as_text=True)
    assert chosen not in open(os.path.join(app.admin_dir, "audit.jsonl")).read()


# ---- reset

def test_reset_ends_the_users_logins_but_not_the_admins_own(app, admin):
    other = login(app, USER)
    assert other.get("/api/v1/auth/me").status_code == 200
    assert call(admin, "POST", f"{BASE}/{USER}/password", {"password": "brand new password"}).status_code == 200
    assert other.get("/api/v1/auth/me").status_code == 401
    assert login_works(app, USER, "brand new password")
    # resetting your own password signs the other logins out, and keeps this one
    assert call(admin, "POST", f"{BASE}/{ADMIN}/password", {"generate": True}).status_code == 200
    assert admin.get("/api/v1/auth/me").status_code == 200
    assert call(admin, "POST", f"{BASE}/{USER}/unlock", {}).status_code == 200


def test_reset_errors(app, admin):
    assert call(admin, "POST", f"{BASE}/nobody/password", {"generate": True}).get_json()["reason"] == "unknown_user"
    for body, reason in (({"password": "short"}, "weak_password"), ({}, "bad_request"),
                         ({"password": USER + USER, "generate": True}, "bad_request")):
        response = call(admin, "POST", f"{BASE}/{USER}/password", body)
        assert response.status_code == 400 and response.get_json()["reason"] == reason, body
    assert login_works(app, USER, PASSWORD)


def test_reset_clears_a_lockout(app, admin):
    manager = AuthManager(user_file=app.config["user_file"])
    for _ in range(5):
        manager.authenticate(USER, "wrong", client_ip="127.0.0.1")
    assert manager.lock_remaining(USER, "127.0.0.1")
    call(admin, "POST", f"{BASE}/{USER}/password", {"generate": True})
    assert not manager.lock_remaining(USER, "127.0.0.1")


# ---- admin right

def test_grant_and_revoke_admin(app, admin):
    assert call(admin, "POST", f"{BASE}/{USER}/admin", {"is_admin": True}).get_json() == {"is_admin": True}
    mine = login(app, USER)
    assert mine.get("/api/v1/admin/audit").status_code == 200
    assert call(admin, "POST", f"{BASE}/{USER}/admin", {"is_admin": False}).get_json() == {"is_admin": False}
    assert mine.get("/api/v1/admin/audit").status_code == 403, "the revocation is seen on the next request"
    assert [r["detail"] for r in records(app, action="user.set_admin")] == [{"is_admin": False}, {"is_admin": True}]


def test_admin_flag_errors(app, admin):
    assert call(admin, "POST", f"{BASE}/nobody/admin", {"is_admin": True}).status_code == 404
    for body in ({}, {"is_admin": "true"}, {"is_admin": 1}):
        assert call(admin, "POST", f"{BASE}/{USER}/admin", body).status_code == 400, body


def test_the_last_admin_cannot_be_demoted_or_removed_by_another_admin(tmp_path):
    # two admins; one demotes the other (fine), then the survivor is the last
    app = make_app(tmp_path)
    add_admin(app, "boss")
    boss = login(app, "boss")
    assert call(boss, "POST", f"{BASE}/{ADMIN}/admin", {"is_admin": False}).status_code == 200
    assert AuthManager(user_file=app.config["user_file"]).admins() == {"boss"}
    # root is a plain user now; no way for boss to demote or remove themselves
    for response in (call(boss, "POST", f"{BASE}/boss/admin", {"is_admin": False}),
                     call(boss, "DELETE", f"{BASE}/boss")):
        assert response.status_code == 409 and response.get_json()["reason"] == "self"
    assert AuthManager(user_file=app.config["user_file"]).admins() == {"boss"}


def test_last_admin_is_refused_inside_the_lock_even_when_the_caller_looked_earlier(app, admin, monkeypatch):
    """The API's own pre-checks are not the guarantee: the stored table is. Admins root and boss;
    root asks to demote boss, and between that request's look and its write a CLI run removes root."""
    add_admin(app, "boss")
    manager = app.auth_manager
    real = manager.set_admin

    def after_a_cli_run(username, is_admin, force=False):
        AuthManager(user_file=manager.user_file).remove_user(ADMIN, force=True)   # lands before our write
        return real(username, is_admin, force=force)

    monkeypatch.setattr(manager, "set_admin", after_a_cli_run)
    response = call(admin, "POST", f"{BASE}/boss/admin", {"is_admin": False})
    assert response.status_code == 409 and response.get_json()["reason"] == "last_admin"
    assert AuthManager(user_file=manager.user_file).admins() == {"boss"}
    assert records(app, action="user.set_admin")[0]["outcome"] == "refused:last_admin"


# ---- remove

def test_remove_user(app, admin):
    other = login(app, USER)
    response = call(admin, "DELETE", f"{BASE}/{USER}")
    assert response.status_code == 200 and response.get_json() == {"removed": USER, "panel_sets_reassigned": 0}
    assert AuthManager(user_file=app.config["user_file"]).get_user(USER) is None
    assert other.get("/api/v1/auth/me").status_code == 401, "their login ends with the account"
    assert records(app, action="user.remove")[0]["target"] == USER


def test_remove_can_hand_the_panel_sets_over(app, admin):
    sessions = os.path.join(app.config["data_dir"], "sessions")
    os.makedirs(sessions)
    for i, owner in enumerate([USER, USER, ADMIN]):
        with open(os.path.join(sessions, f"s{i}.json"), "w") as f:
            json.dump({"owner": owner, "layout": {"k": i}}, f)
    response = call(admin, "DELETE", f"{BASE}/{USER}", {"reassign_to": ADMIN})
    assert response.get_json() == {"removed": USER, "panel_sets_reassigned": 2}
    owners = [json.load(open(os.path.join(sessions, f"s{i}.json"))) for i in range(3)]
    assert [o["owner"] for o in owners] == [ADMIN, ADMIN, ADMIN]
    assert [o["layout"] for o in owners] == [{"k": 0}, {"k": 1}, {"k": 2}], "only the owner changes"
    assert records(app, action="user.remove")[0]["detail"] == {"panel_sets_reassigned": 2, "reassigned_to": ADMIN}
    assert [f for f in os.listdir(sessions) if f.endswith(".tmp")] == []


def test_remove_errors(app, admin):
    assert call(admin, "DELETE", f"{BASE}/nobody").get_json()["reason"] == "unknown_user"
    assert call(admin, "DELETE", f"{BASE}/{USER}", {"reassign_to": "nobody"}).status_code == 404
    assert call(admin, "DELETE", f"{BASE}/{USER}", {"reassign_to": USER}).status_code == 400
    assert AuthManager(user_file=app.config["user_file"]).get_user(USER) is not None


def test_removing_the_last_admin_or_yourself_is_refused(app, admin):
    response = call(admin, "DELETE", f"{BASE}/{ADMIN}")
    assert response.status_code == 409 and response.get_json()["reason"] == "self"
    assert call(admin, "POST", f"{BASE}/{ADMIN}/admin", {"is_admin": False}).get_json()["reason"] == "self"
    assert [r["outcome"] for r in records(app)][:2] == ["refused:self", "refused:self"]
    assert AuthManager(user_file=app.config["user_file"]).admins() == {ADMIN}


# ---- unlock

def test_unlock_one_address_or_all(app, admin):
    manager = AuthManager(user_file=app.config["user_file"])
    for address in ("10.0.0.1", "10.0.0.2"):
        for _ in range(5):
            manager.authenticate(USER, "wrong", client_ip=address)
    assert call(admin, "POST", f"{BASE}/{USER}/unlock", {"address": "10.0.0.1"}).get_json() == {"cleared": 1}
    assert not manager.lock_remaining(USER, "10.0.0.1") and manager.lock_remaining(USER, "10.0.0.2")
    assert call(admin, "POST", f"{BASE}/{USER}/unlock", {"address": "10.9.9.9"}).get_json() == {"cleared": 0}
    assert call(admin, "POST", f"{BASE}/{USER}/unlock", {}).get_json() == {"cleared": 1}
    assert not manager.lock_remaining(USER, "10.0.0.2")
    assert call(admin, "POST", f"{BASE}/nobody/unlock", {}).status_code == 404
    assert call(admin, "POST", f"{BASE}/{USER}/unlock", {"address": 7}).status_code == 400
    assert [r["detail"] for r in records(app, action="user.unlock")][0] == {"address": None, "cleared": 1}


# ---- the last-admin rule across processes: API and CLI

def _api_demote(tmp_path, actor, target, barrier, out):
    app = make_app(tmp_path)
    client = login(app, actor)
    barrier.wait(30)
    response = call(client, "POST", f"{BASE}/{target}/admin", {"is_admin": False})
    out.put(("api", response.status_code, (response.get_json() or {}).get("reason")))


def _cli_demote(cfg, target, barrier, out):
    barrier.wait(30)
    code = cli.main(["--config", cfg, "user", "set-admin", "--username", target, "--no-admin"])
    out.put(("cli", code, None))


def _cli_remove(cfg, target, barrier, out):
    barrier.wait(30)
    code = cli.main(["--config", cfg, "user", "remove", "--username", target])
    out.put(("cli", code, None))


def _api_remove(tmp_path, actor, target, barrier, out):
    app = make_app(tmp_path)
    client = login(app, actor)
    barrier.wait(30)
    response = call(client, "DELETE", f"{BASE}/{target}")
    out.put(("api", response.status_code, (response.get_json() or {}).get("reason")))


def _site(tmp_path, app):
    cfg = tmp_path / "site.yaml"
    cfg.write_text(f"server:\n  log_file: \"{tmp_path / 'cli.log'}\"\nauth:\n  user_file: \"{app.config['user_file']}\"\n")
    return str(cfg)


def _race(tmp_path, first, second):
    ctx = multiprocessing.get_context("spawn")
    barrier, out = ctx.Barrier(2), ctx.Queue()
    procs = [ctx.Process(target=fn, args=(*args, barrier, out)) for fn, args in (first, second)]
    for p in procs:
        p.start()
    results = [out.get(timeout=120) for _ in procs]
    for p in procs:
        p.join(60)
        assert p.exitcode == 0
    return results


@pytest.mark.parametrize("round_", range(3))
def test_api_and_cli_cannot_both_remove_the_last_two_admins(tmp_path, round_):
    """Admins root and boss; the API (as root) demotes boss while the CLI demotes root.
    Whatever the interleaving, one admin is left."""
    app = make_app(tmp_path)
    add_admin(app, "boss")
    cfg = _site(tmp_path, app)
    results = _race(tmp_path, (_api_demote, (tmp_path, ADMIN, "boss")), (_cli_demote, (cfg, ADMIN)))
    admins = AuthManager(user_file=app.config["user_file"]).admins()
    assert len(admins) == 1, (results, admins)
    by = {who: (code, reason) for who, code, reason in results}
    # root first: the CLI wins, and the API request is then from a non-admin (403) or hits the rule (409)
    # boss first: the API wins, and the CLI is refused by the rule (exit 1)
    if by["cli"][0] == 0:
        assert admins == {"boss"} and by["api"][0] in (403, 409), results
    else:
        assert by["cli"][0] == 1 and by["api"][0] == 200 and admins == {ADMIN}, results


@pytest.mark.parametrize("round_", range(3))
def test_api_and_cli_cannot_both_remove_the_last_two_admins_by_removal(tmp_path, round_):
    app = make_app(tmp_path)
    add_admin(app, "boss")
    cfg = _site(tmp_path, app)
    results = _race(tmp_path, (_api_remove, (tmp_path, ADMIN, "boss")), (_cli_remove, (cfg, ADMIN)))
    admins = AuthManager(user_file=app.config["user_file"]).admins()
    assert len(admins) == 1, (results, admins)


def _api_demote_other(tmp_path, actor, target, barrier, out):
    _api_demote(tmp_path, actor, target, barrier, out)


@pytest.mark.parametrize("round_", range(3))
def test_two_admins_demoting_each_other_through_the_api_leave_one(tmp_path, round_):
    app = make_app(tmp_path)
    add_admin(app, "boss")
    results = _race(tmp_path, (_api_demote, (tmp_path, ADMIN, "boss")), (_api_demote_other, (tmp_path, "boss", ADMIN)))
    assert len(AuthManager(user_file=app.config["user_file"]).admins()) == 1, results
    assert sorted(code for _, code, _ in results)[0] == 200 and sum(code == 200 for _, code, _ in results) == 1, results


def test_the_cli_force_flag_skips_the_rule_not_the_lock(tmp_path):
    from annzarro.server import atomic_store
    app = make_app(tmp_path)
    cfg = _site(tmp_path, app)
    user_file = app.config["user_file"]
    assert cli.main(["--config", cfg, "user", "set-admin", "--username", ADMIN, "--no-admin"]) == 1
    # a lock held elsewhere stops a forced change too: it waits for the lock, then times out
    atomic_store.set_default_lock_timeout(0.3)
    try:
        with atomic_store.locked(user_file):
            started = time.monotonic()
            import threading
            seen = {}

            def forced():
                try:
                    AuthManager(user_file=user_file).set_admin(ADMIN, False, force=True)
                    seen["done"] = True
                except atomic_store.LockTimeout:
                    seen["timeout"] = True
            # a second thread: the lock is per path and not re-entrant across threads
            t = threading.Thread(target=forced)
            t.start()
            t.join(10)
        assert seen == {"timeout": True}, seen
        assert time.monotonic() - started < 10
    finally:
        atomic_store.set_default_lock_timeout(10)
    assert AuthManager(user_file=user_file).get_user(ADMIN).is_admin is True
    assert AuthManager(user_file=user_file).set_admin(ADMIN, False, force=True) is True
    assert AuthManager(user_file=user_file).admins() == set()
