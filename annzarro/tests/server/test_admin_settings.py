"""The settings API: the admin layer, the per-user layer, and what they refuse."""
import json
import multiprocessing
import os

import pytest

from annzarro.server.admin import audit
from annzarro.server.policy import engine
from annzarro.tests.server.admin_helpers import ADMIN, USER, login, unsafe_headers
from annzarro.tests.server.settings_helpers import WRITABLE, sample_app

POLICY = "/api/v1/admin/policy"


def user_url(name):
    return f"/api/v1/admin/users/{name}/policy"


@pytest.fixture
def app(tmp_path):
    return sample_app(tmp_path)


@pytest.fixture
def admin(app):
    return login(app, ADMIN)


def put(client, url, body):
    return client.put(url, data=json.dumps(body), headers=unsafe_headers(client))


def keys_of(reply):
    return {k["name"]: k for k in reply.get_json()["keys"]}


def stored(app, name="overlay.json"):
    with open(os.path.join(app.admin_dir, name)) as fh:
        return json.load(fh)


def effective(client, keys=None):
    suffix = f"?keys={keys}" if keys else ""
    response = client.get("/api/v1/policy/effective" + suffix)
    return response.get_json()["values"], response.headers["X-AnnZarro-Policy"]


# -- reading ------------------------------------------------------------------

def test_get_lists_every_key_with_its_value_source_and_layers(admin):
    reply = admin.get(POLICY)
    assert reply.status_code == 200
    body = reply.get_json()
    keys = keys_of(reply)
    assert set(keys) == {"t.limit", "t.hosts", "t.switch", "t.mode", "t.user_switch", "t.user_num", "t.fixed", *WRITABLE}
    assert body["unknown"] == [] and body["issues"] == []
    limit = keys["t.limit"]
    assert (limit["value"], limit["source"], limit["default"], limit["locked"]) == (5, "default", 5, False)
    assert limit["type"]["kind"] == "int" and limit["scope"] == "server" and limit["layers"] == {"default": 5}
    fixed = keys["t.fixed"]
    assert fixed["scope"] == "config" and fixed["value"] == 7 and fixed["source"] == "default"


def test_the_page_is_for_admins_only(app):
    alice = login(app, USER)
    assert alice.get(POLICY).status_code == 403
    assert alice.get(user_url(USER)).status_code == 403
    assert put(alice, POLICY, {"t.limit": 3}).status_code == 403
    assert not os.path.exists(os.path.join(app.admin_dir, "overlay.json"))


# -- writing the admin layer ------------------------------------------------------

def test_put_sets_a_value_and_reset_returns_to_the_inherited_one(app, admin):
    reply = put(admin, POLICY, {"t.limit": 3})
    assert reply.status_code == 200
    limit = keys_of(reply)["t.limit"]
    assert (limit["value"], limit["source"]) == (3, "admin")
    assert limit["layers"] == {"admin": 3, "default": 5} and limit["inherited"] == {"admin": 5}
    assert reply.get_json()["capped"] == {}
    assert stored(app)["policy"] == {"t.limit": 3}
    reply = put(admin, POLICY, {"t.limit": None})
    assert (keys_of(reply)["t.limit"]["value"], keys_of(reply)["t.limit"]["source"]) == (5, "default")
    assert "policy" not in stored(app)


def test_the_inherited_value_is_the_config_value_when_the_yaml_set_one(tmp_path):
    app = sample_app(tmp_path, t={"limit": 8})
    admin = login(app, ADMIN)
    put(admin, POLICY, {"t.limit": 2})
    limit = keys_of(admin.get(POLICY))["t.limit"]
    assert (limit["value"], limit["source"], limit["config_value"]) == (2, "admin", 8)
    assert limit["inherited"] == {"admin": 8} and limit["layers"] == {"admin": 2, "config": 8, "default": 5}


def test_a_change_reaches_policy_effective_for_other_users(app, admin):
    alice = login(app, USER)
    before, version = effective(alice)
    assert before["t.user_num"] == 5
    put(admin, POLICY, {"t.limit": 4})
    after, new_version = effective(alice)
    assert after["t.limit"] == 4 and new_version != version
    put(admin, POLICY, {"t.limit": None})
    assert effective(alice)[0]["t.limit"] == 5


def test_outbound_hosts_are_reported_for_the_value(tmp_path):
    from annzarro.server.policy import Hosts, Key
    app = sample_app(tmp_path)
    reg = engine(app).registry
    key = reg.keys["t.hosts"]
    reg.keys["t.hosts"] = Key(**{**key.__dict__, "outbound_hosts": lambda value, config: list(value)})
    admin = login(app, ADMIN)
    assert keys_of(admin.get(POLICY))["t.hosts"]["outbound_hosts_now"] == ["a.example.org"]
    reply = put(admin, POLICY, {"t.hosts": ["b.example.org"]})
    assert keys_of(reply)["t.hosts"]["outbound_hosts_now"] == ["b.example.org"]


# -- every refusal ----------------------------------------------------------------

@pytest.mark.parametrize("body, reason", [
    ({"t.nope": 1}, "unknown_key"),
    ({"t.limit": "many"}, "bad_type"),
    ({"t.limit": 99}, "out_of_range"),
])
def test_a_bad_request_is_a_400_with_the_reason_per_name(app, admin, body, reason):
    reply = put(admin, POLICY, {**body, "t.hosts": ["c.example.org"]})
    assert reply.status_code == 400
    assert reply.get_json()["errors"] == {next(iter(body)): reason}
    assert "policy" not in (stored(app) if os.path.exists(os.path.join(app.admin_dir, "overlay.json")) else {}), \
        "nothing is written when any name is refused"


@pytest.mark.parametrize("body", [[], "x", {}, {"": 1}])
def test_a_body_that_is_not_an_object_of_changes_is_a_400(admin, body):
    reply = put(admin, POLICY, body)
    assert reply.status_code == 400 and reply.get_json()["reason"] == "bad_request"


def test_a_key_the_config_locks_is_a_409(tmp_path):
    app = sample_app(tmp_path, policy={"locked": ["t.limit"]})
    admin = login(app, ADMIN)
    limit = keys_of(admin.get(POLICY))["t.limit"]
    assert limit["locked"] is True
    reply = put(admin, POLICY, {"t.limit": 2})
    assert reply.status_code == 409 and reply.get_json()["reason"] == "locked_by_config"
    assert reply.get_json()["errors"] == {"t.limit": "locked_by_config"}
    assert put(admin, user_url(USER), {"t.limit": 2}).status_code == 409
    (tmp_path / "b").mkdir()
    user_lock = sample_app(tmp_path / "b", policy={"locked": ["t.user_num"]})
    other = login(user_lock, ADMIN)
    reply = put(other, user_url(USER), {"t.user_num": 2})
    assert reply.status_code == 409 and reply.get_json()["reason"] == "locked_by_config"


def test_a_config_scope_key_is_a_409_in_both_layers(app, admin):
    for url in (POLICY, user_url(USER)):
        reply = put(admin, url, {"t.fixed": 3})
        assert reply.status_code == 409 and reply.get_json()["reason"] == "config_scope"


def test_a_server_scope_key_is_a_409_for_a_user(app, admin):
    reply = put(admin, user_url(USER), {"t.limit": 3})
    assert reply.status_code == 409 and reply.get_json()["reason"] == "server_scope"


def test_the_admin_cannot_widen_the_config_of_a_restrict_key(tmp_path):
    app = sample_app(tmp_path, t={"switch": False})
    admin = login(app, ADMIN)
    reply = put(admin, POLICY, {"t.switch": True})
    assert reply.status_code == 409 and reply.get_json()["reason"] == "config_ceiling"
    assert put(admin, POLICY, {"t.switch": False}).status_code == 200


def test_a_per_user_override_on_an_admin_is_a_409(app, admin):
    reply = put(admin, user_url(ADMIN), {"t.user_num": 3})
    assert reply.status_code == 409 and reply.get_json()["reason"] == "admin_user"
    assert not os.path.exists(os.path.join(app.admin_dir, "access.json"))


def test_the_user_of_a_per_user_policy_must_exist(admin):
    assert admin.get(user_url("nobody")).status_code == 404
    reply = put(admin, user_url("nobody"), {"t.user_num": 3})
    assert reply.status_code == 404 and reply.get_json()["reason"] == "unknown_user"


def test_every_refusal_is_audited_and_so_is_every_change(app, admin):
    put(admin, POLICY, {"t.limit": 3})
    put(admin, POLICY, {"t.limit": 99})
    put(admin, POLICY, {"t.fixed": 1})
    records = [r for r in audit.read(app.admin_dir, limit=50) if r["action"] == "policy.update"]
    records.reverse()
    assert [r["outcome"] for r in records] == ["ok", "refused:out_of_range", "refused:config_scope"]
    assert records[0]["target"] == "overlay"
    assert records[0]["detail"]["changed"] == {"t.limit": {"from": None, "to": 3}}
    assert records[0]["actor"] == ADMIN


# -- unknown and invalid stored values -------------------------------------------------

def test_unknown_and_invalid_stored_values_are_shown_and_kept(app, admin):
    os.makedirs(app.admin_dir, exist_ok=True)
    with open(os.path.join(app.admin_dir, "overlay.json"), "w") as fh:
        json.dump({"version": 1, "data_roots": [], "policy": {"t.gone": True, "t.limit": "many", "t.fixed": 3}}, fh)
    body = admin.get(POLICY).get_json()
    assert body["unknown"] == [{"name": "t.gone", "value": True}]
    reasons = {i["name"]: i["reason"] for i in body["issues"]}
    assert reasons == {"t.gone": "unknown_key", "t.limit": "bad_type", "t.fixed": "config_scope"}
    assert keys_of(admin.get(POLICY))["t.limit"]["value"] == 5
    put(admin, POLICY, {"t.hosts": ["z.example.org"]})
    assert stored(app)["policy"] == {"t.gone": True, "t.limit": "many", "t.fixed": 3, "t.hosts": ["z.example.org"]}
    assert stored(app)["data_roots"] == []
    reply = put(admin, POLICY, {"t.gone": None, "t.limit": None, "t.fixed": None})
    assert reply.status_code == 200 and reply.get_json()["issues"] == []
    assert stored(app)["policy"] == {"t.hosts": ["z.example.org"]}


def test_a_stored_value_of_a_locked_key_is_flagged(tmp_path):
    app = sample_app(tmp_path, policy={"locked": ["t.limit"]})
    os.makedirs(app.admin_dir, exist_ok=True)
    with open(os.path.join(app.admin_dir, "overlay.json"), "w") as fh:
        json.dump({"version": 1, "policy": {"t.limit": 2}}, fh)
    admin = login(app, ADMIN)
    body = admin.get(POLICY).get_json()
    assert [i["reason"] for i in body["issues"]] == ["locked_by_config"]
    assert keys_of(admin.get(POLICY))["t.limit"]["value"] == 5
    assert put(admin, POLICY, {"t.limit": None}).status_code == 200


def test_a_corrupt_overlay_is_not_replaced(app, admin):
    os.makedirs(app.admin_dir, exist_ok=True)
    path = os.path.join(app.admin_dir, "overlay.json")
    with open(path, "w") as fh:
        fh.write("{not json")
    reply = put(admin, POLICY, {"t.limit": 3})
    assert reply.status_code == 503 and reply.get_json()["reason"] == "store_unreadable"
    with open(path) as fh:
        assert fh.read() == "{not json"


# -- the per-user layer ---------------------------------------------------------------

def test_a_user_override_is_stored_in_access_json_and_applies_to_that_user_only(app, admin):
    reply = put(admin, user_url(USER), {"t.user_num": 2})
    assert reply.status_code == 200
    assert stored(app, "access.json")["principals"]["user:alice"]["policy"] == {"t.user_num": 2}
    row = keys_of(reply)["t.user_num"]
    assert (row["value"], row["source"], row["override"], row["inherited"], row["has_override"]) == (2, "user", 2, 5, True)
    assert reply.get_json()["effective"]["t.user_num"] == 2
    assert effective(login(app, USER))[0]["t.user_num"] == 2
    assert effective(admin)[0]["t.user_num"] == 5
    put(admin, user_url(USER), {"t.user_num": None})
    assert stored(app, "access.json")["principals"] == {}
    assert effective(login(app, USER))[0]["t.user_num"] == 5


def test_an_update_keeps_the_rest_of_the_principal_entry(app, admin):
    os.makedirs(app.admin_dir, exist_ok=True)
    entry = {"restricted": True, "grants": [{"kind": "dir", "path": "/x"}]}
    with open(os.path.join(app.admin_dir, "access.json"), "w") as fh:
        json.dump({"version": 1, "principals": {"user:alice": entry, "user:bob": {"restricted": False}}}, fh)
    put(admin, user_url(USER), {"t.user_num": 3})
    principals = stored(app, "access.json")["principals"]
    assert principals["user:alice"] == {**entry, "policy": {"t.user_num": 3}} and principals["user:bob"] == {"restricted": False}
    put(admin, user_url(USER), {"t.user_num": None})
    assert stored(app, "access.json")["principals"]["user:alice"] == entry


def test_capped_reports_the_value_that_applies_instead(tmp_path):
    app = sample_app(tmp_path, t={"user_switch": False})
    admin = login(app, ADMIN)
    reply = put(admin, user_url(USER), {"t.user_switch": True})
    assert reply.status_code == 200 and reply.get_json()["capped"] == {"t.user_switch": False}
    assert keys_of(reply)["t.user_switch"]["value"] is False
    assert effective(login(app, USER))[0]["t.user_switch"] is False


def test_the_user_layer_is_ignored_for_admins(app, admin):
    os.makedirs(app.admin_dir, exist_ok=True)
    with open(os.path.join(app.admin_dir, "access.json"), "w") as fh:
        json.dump({"version": 1, "principals": {"user:root": {"policy": {"t.user_num": 2}},
                                                "user:alice": {"policy": {"t.user_num": 2}}}}, fh)
    assert effective(admin)[0]["t.user_num"] == 5
    assert effective(login(app, USER))[0]["t.user_num"] == 2
    body = admin.get(user_url(ADMIN)).get_json()
    assert body["is_admin"] is True and body["effective"]["t.user_num"] == 5
    assert [i["reason"] for i in body["issues"]] == ["admin_user"]
    assert put(admin, user_url(ADMIN), {"t.user_num": None}).status_code == 200, "stale overrides can be removed"
    assert "policy" not in stored(app, "access.json")["principals"].get("user:root", {})


def test_a_user_promoted_to_admin_stops_being_overridden_at_once(app, admin):
    put(admin, user_url(USER), {"t.user_num": 2})
    alice = login(app, USER)
    assert effective(alice)[0]["t.user_num"] == 2
    app.auth_manager.set_admin(USER, True)
    assert effective(alice)[0]["t.user_num"] == 5


# -- two workers ----------------------------------------------------------------------

def _writer(tmp_path, names, barrier, out):
    app = sample_app(tmp_path)
    client = login(app, ADMIN)
    barrier.wait(30)
    codes = [put(client, POLICY, {name: n + 1}).status_code for n, name in enumerate(names)]
    out.put(codes)


def test_concurrent_puts_from_two_processes_lose_no_key(tmp_path):
    ctx = multiprocessing.get_context("fork")
    app = sample_app(tmp_path)
    os.makedirs(app.admin_dir, exist_ok=True)
    with open(os.path.join(app.admin_dir, "overlay.json"), "w") as fh:
        json.dump({"version": 1, "policy": {"t.survivor": "kept"}}, fh)
    barrier, out = ctx.Barrier(2), ctx.Queue()
    procs = [ctx.Process(target=_writer, args=(tmp_path, WRITABLE[i::2], barrier, out)) for i in range(2)]
    for p in procs:
        p.start()
    results = [out.get(timeout=60) for _ in procs]
    for p in procs:
        p.join(30)
    assert all(code == 200 for codes in results for code in codes), results
    policy = stored(app)["policy"]
    assert policy.pop("t.survivor") == "kept"
    assert set(policy) == set(WRITABLE), sorted(set(WRITABLE) - set(policy))


def _reader(tmp_path, pipe):
    app = sample_app(tmp_path)
    client = login(app, USER)
    while pipe.recv() == "read":
        pipe.send(effective(client))
    pipe.close()


def test_a_change_reaches_another_worker_on_its_next_request(tmp_path):
    ctx = multiprocessing.get_context("fork")
    app = sample_app(tmp_path)
    admin = login(app, ADMIN)
    mine, theirs = ctx.Pipe()
    proc = ctx.Process(target=_reader, args=(tmp_path, theirs))
    proc.start()
    try:
        def ask():
            mine.send("read")
            return mine.recv()
        values, version = ask()
        assert values["t.limit"] == 5 and values["t.user_num"] == 5
        put(admin, POLICY, {"t.limit": 3})
        put(admin, user_url(USER), {"t.user_num": 2})
        values, new_version = ask()
        assert (values["t.limit"], values["t.user_num"]) == (3, 2) and new_version != version
        put(admin, POLICY, {"t.limit": None})
        assert ask()[0]["t.limit"] == 5
    finally:
        mine.send("stop")
        proc.join(30)


# -- fail closed ---------------------------------------------------------------------

def test_a_corrupt_access_file_tightens_every_non_admin_and_not_admins(app, admin):
    put(admin, user_url(USER), {"t.user_num": 2})
    alice = login(app, USER)
    assert effective(alice)[0]["t.user_switch"] is True
    with open(os.path.join(app.admin_dir, "access.json"), "w") as fh:
        fh.write("{not json")
    values, _ = effective(alice)
    assert values["t.user_switch"] is False, "the most restrictive value of a user restrict key"
    assert values["t.user_num"] == 5, "override keys have no restrictive value; they fall back"
    assert effective(admin)[0]["t.user_switch"] is True
    body = admin.get(POLICY).get_json()
    assert [p["store"] for p in body["store_problems"]] == ["access.json"]
    assert put(admin, user_url(USER), {"t.user_num": 3}).status_code == 503
    with open(os.path.join(app.admin_dir, "access.json"), "w") as fh:
        json.dump({"version": 1, "principals": {}}, fh)
    assert effective(alice)[0]["t.user_switch"] is True
    assert admin.get(POLICY).get_json()["store_problems"] == []


def test_a_corrupt_access_file_closes_the_outbound_hosts_in_the_csp(tmp_path):
    """The real registry (panel and outbound keys) and the real CSP builder."""
    from annzarro.server.admin.settings import wire_sources
    from annzarro.server.policy.csp import connect_src
    from annzarro.tests.server.admin_helpers import make_app
    app = make_app(tmp_path)
    wire_sources(app)
    eng = engine(app)
    assert "https://" in connect_src(eng, USER)
    os.makedirs(app.admin_dir, exist_ok=True)
    with open(os.path.join(app.admin_dir, "access.json"), "w") as fh:
        fh.write("[")
    assert connect_src(eng, USER) == "connect-src 'self' data: blob:"
    assert "https://" in connect_src(eng, ADMIN), "administrators keep their view"
    values = eng.effective(USER, client_only=True)
    assert values["outbound.allow_external"] is False


def test_a_failed_audit_write_still_answers_with_the_saved_change(app, admin, monkeypatch, caplog):
    def broken(*args, **kwargs):
        raise OSError("disk full")
    monkeypatch.setattr(audit, "record", broken)
    reply = put(admin, POLICY, {"t.limit": 3})
    assert reply.status_code == 200 and reply.get_json()["audit_failed"] is True
    assert stored(app)["policy"] == {"t.limit": 3}
    assert "Could not write the audit record" in caplog.text
