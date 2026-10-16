"""Remote datasets as an admin setting: the policy key, its precedence with the
YAML and the environment, the admin API, and the server policy reading it."""
import json

import pytest

from annzarro.core import remote
from annzarro.server.admin import audit
from annzarro.server.policy import RemoteAccess
from annzarro.tests.server.admin_helpers import ADMIN, USER, login, make_app, unsafe_headers

POLICY = "/api/v1/admin/policy"
KEY = "feature.remote_stores"
ANY = {"mode": "any", "allowlist": []}
OFF = {"mode": "off", "allowlist": []}


def allow(*prefixes):
    return {"mode": "allowlist", "allowlist": list(prefixes)}


@pytest.fixture(autouse=True)
def _no_env(monkeypatch):
    monkeypatch.delenv(remote.ENV_MODE, raising=False)
    monkeypatch.delenv(remote.ENV_ALLOWLIST, raising=False)


def put(client, body):
    return client.put(POLICY, data=json.dumps(body), headers=unsafe_headers(client))


def entry(client):
    return {k["name"]: k for k in client.get(POLICY).get_json()["keys"]}[KEY]


def me_remote(client):
    return client.get("/api/v1/auth/me").get_json()["remote_stores"]


def policy_in_app(app):
    with app.app_context():
        return remote.get_remote_policy()


@pytest.fixture
def app(tmp_path):
    return make_app(tmp_path)


@pytest.fixture
def admin(app):
    return login(app, ADMIN)


# -- the value ------------------------------------------------------------------

def test_a_shared_server_starts_with_remote_datasets_off_and_says_why(app, admin):
    e = entry(admin)
    assert (e["value"], e["source"], e["locked"]) == (OFF, "default", False)
    assert e["type"]["kind"] == "remote_access" and e["section"] == "data" and "config_value" not in e
    assert me_remote(login(app, USER)) is False


def test_a_local_server_starts_with_any_location(tmp_path):
    app = make_app(tmp_path, auth=False)
    from annzarro.server.policy import engine
    resolved = engine(app).resolve(KEY)
    assert (resolved.value, resolved.source) == (ANY, "default")


@pytest.mark.parametrize("value, expected_mode", [(ANY, "any"), (allow("s3://lab/atlases/"), "allowlist"), (OFF, "off")])
def test_the_admin_sets_each_state_and_the_server_follows_at_once(app, admin, value, expected_mode):
    alice = login(app, USER)
    reply = put(admin, {KEY: value})
    assert reply.status_code == 200, reply.get_data(as_text=True)
    e = {k["name"]: k for k in reply.get_json()["keys"]}[KEY]
    assert (e["value"], e["source"]) == (value, "admin")
    policy = policy_in_app(app)
    assert policy.enabled is (expected_mode != "off")
    assert [str(p) for p in policy.allowlist] == value["allowlist"] and "Admin > Data sources" in policy.reason
    assert me_remote(alice) is (expected_mode != "off")


def test_auth_me_carries_the_effective_allowlist_for_the_dataset_browser(app, admin):
    alice = login(app, USER)

    def me():
        return alice.get("/api/v1/auth/me").get_json()

    assert me()["remote_stores"] is False and "remote_allowlist" not in me()
    put(admin, {KEY: allow("s3://lab/atlases/", "https://data.example.org/zarr/")})
    assert me()["remote_stores"] is True
    assert me()["remote_allowlist"] == ["s3://lab/atlases/", "https://data.example.org/zarr/"]
    put(admin, {KEY: ANY})
    assert me()["remote_stores"] is True and "remote_allowlist" not in me()
    put(admin, {KEY: OFF})
    assert me()["remote_stores"] is False and "remote_allowlist" not in me()


def test_changes_made_back_to_back_are_each_seen_by_the_next_request(tmp_path):
    """Whatever the file system's clock, a write is noticed: the answer follows every one of many quick changes."""
    app = make_app(tmp_path, admin_rate_per_minute=1000)
    admin = login(app, ADMIN)
    alice = login(app, USER)
    states = [(OFF, False), (ANY, True), (allow("s3://lab/a/"), True), (OFF, False), (allow("s3://lab/b/"), True),
              (OFF, False), (ANY, True), (OFF, False)] * 4
    for value, expected in states:
        assert put(admin, {KEY: value}).status_code == 200
        assert alice.get("/api/v1/auth/me").get_json()["remote_stores"] is expected, value
        assert policy_in_app(app).enabled is expected, value


def test_the_allowlist_is_enforced_by_the_server_policy(app, admin):
    put(admin, {KEY: allow("s3://lab/atlases", "HTTPS://Data.Example.org/zarr/")})
    assert entry(admin)["value"]["allowlist"] == ["s3://lab/atlases/", "https://data.example.org/zarr/"]
    policy = policy_in_app(app)
    policy.check("s3://lab/atlases/a.zarr")
    policy.check("https://data.example.org/zarr/x")
    for url in ("s3://lab/other/a.zarr", "s3://lab-evil/atlases/a.zarr", "https://data.example.org.evil.com/zarr/x"):
        with pytest.raises(remote.RemoteAccessDenied):
            policy.check(url)


def test_reset_returns_to_the_default(app, admin):
    put(admin, {KEY: ANY})
    assert me_remote(login(app, USER)) is True
    reply = put(admin, {KEY: None})
    assert reply.status_code == 200
    assert (entry(admin)["value"], entry(admin)["source"]) == (OFF, "default")
    assert me_remote(login(app, USER)) is False


def test_off_names_the_admin_setting_and_the_yaml_key(app, admin):
    put(admin, {KEY: OFF})
    with pytest.raises(remote.RemoteAccessDenied) as caught:
        policy_in_app(app).check("s3://lab/x.zarr")
    assert "Admin > Data sources > Remote datasets" in str(caught.value) and "server.remote_stores" in str(caught.value)


# -- validation ------------------------------------------------------------------

@pytest.mark.parametrize("value, fragment", [
    (allow("ftp://host/path/"), "must start with one of"),
    (allow("not a url"), "must start with one of"),
    (allow("https://user:secret@host/zarr/"), "credentials"),
    (allow("https://host/zarr/?X-Amz-Signature=1"), "query string"),
    (allow("https://host/a/../b/"), "'..'"),
    (allow("s3://"), "no host or bucket"),
    ({"mode": "allowlist", "allowlist": []}, "at least one"),
    ({"mode": "any", "allowlist": ["s3://b/"]}, "only the allowlist mode"),
    ({"mode": "sometimes", "allowlist": []}, "mode is one of"),
    ("any", "expected"),
])
def test_invalid_values_are_a_400_naming_the_problem_and_nothing_is_stored(app, admin, value, fragment):
    reply = put(admin, {KEY: value})
    assert reply.status_code == 400
    body = reply.get_json()
    assert body["reason"] == "invalid_settings" and KEY in body["errors"]
    assert fragment in body["messages"][KEY] and fragment in body["error"]
    assert entry(admin)["source"] == "default"


def test_duplicates_are_removed_and_entries_normalised(app, admin):
    put(admin, {KEY: allow("s3://Lab/a", "s3://lab/a/", " s3://lab/a// ")})
    assert entry(admin)["value"]["allowlist"] == ["s3://lab/a/"]


def test_a_credential_in_a_url_is_refused_and_never_reaches_the_audit_log(app, admin):
    assert put(admin, {KEY: allow("https://user:hunter2@host/zarr/")}).status_code == 400
    assert "hunter2" not in json.dumps(audit.read(app.admin_dir, limit=10))


# -- precedence --------------------------------------------------------------------

def test_yaml_deny_is_a_ceiling_the_admin_cannot_widen(tmp_path):
    app = make_app(tmp_path, remote_stores="deny")
    admin = login(app, ADMIN)
    e = entry(admin)
    assert (e["value"], e["source"], e["config_value"], e["config_origin"]) == (OFF, "config", OFF, "config")
    for value in (ANY, allow("s3://lab/")):
        reply = put(admin, {KEY: value})
        assert reply.status_code == 409 and reply.get_json()["reason"] == "config_ceiling"
    assert me_remote(login(app, USER)) is False


def test_yaml_allow_can_be_narrowed_by_the_admin(tmp_path):
    app = make_app(tmp_path, remote_stores="allow")
    admin = login(app, ADMIN)
    assert entry(admin)["value"] == ANY and entry(admin)["source"] == "config"
    assert put(admin, {KEY: allow("s3://lab/")}).status_code == 200
    assert [str(p) for p in policy_in_app(app).allowlist] == ["s3://lab"]
    assert put(admin, {KEY: OFF}).status_code == 200
    assert policy_in_app(app).enabled is False


def test_yaml_allowlist_is_the_ceiling_prefixes_may_be_narrowed_not_added(tmp_path):
    app = make_app(tmp_path, remote_allowlist=["s3://lab/atlases/"])
    admin = login(app, ADMIN)
    assert entry(admin)["value"] == allow("s3://lab/atlases/")
    assert put(admin, {KEY: allow("s3://lab/atlases/mouse/")}).status_code == 200
    assert policy_in_app(app).check("s3://lab/atlases/mouse/a.zarr")
    for wider in (allow("s3://lab/"), allow("s3://other/"), ANY):
        assert put(admin, {KEY: wider}).status_code == 409


def test_the_environment_beats_the_yaml_in_both_directions(tmp_path, monkeypatch):
    monkeypatch.setenv(remote.ENV_MODE, "deny")
    app = make_app(tmp_path / "a", remote_stores="allow") if (tmp_path / "a").mkdir() is None else None
    admin = login(app, ADMIN)
    e = entry(admin)
    assert (e["value"], e["source"], e["config_origin"]) == (OFF, "env", "env")
    assert put(admin, {KEY: ANY}).status_code == 409
    monkeypatch.setenv(remote.ENV_MODE, "allow")
    (tmp_path / "b").mkdir()
    app = make_app(tmp_path / "b", remote_stores="deny")
    assert entry(login(app, ADMIN))["value"] == ANY and entry(login(app, ADMIN))["source"] == "env"


def test_the_environment_allowlist(tmp_path, monkeypatch):
    monkeypatch.setenv(remote.ENV_ALLOWLIST, "s3://lab/a/, https://h.example.org/z")
    app = make_app(tmp_path)
    e = entry(login(app, ADMIN))
    assert e["value"] == allow("s3://lab/a/", "https://h.example.org/z/") and e["source"] == "env"


def test_policy_locked_wins_over_the_admin(tmp_path):
    app = make_app(tmp_path, config_tree={"policy": {"locked": [KEY]}})
    admin = login(app, ADMIN)
    assert entry(admin)["locked"] is True
    reply = put(admin, {KEY: ANY})
    assert reply.status_code == 409 and reply.get_json()["reason"] == "locked_by_config"


def test_the_outbound_switch_does_not_govern_remote_datasets(app, admin):
    put(admin, {KEY: ANY, "outbound.allow_external": False})
    assert policy_in_app(app).enabled is True and me_remote(login(app, USER)) is True


# -- the guard, the audit, per-user access -----------------------------------------

def test_only_an_admin_with_a_csrf_token_can_change_it(app, admin):
    alice = login(app, USER)
    assert put(alice, {KEY: ANY}).status_code == 403
    no_token = admin.put(POLICY, data=json.dumps({KEY: ANY}), headers={"Content-Type": "application/json"})
    assert no_token.status_code == 403 and no_token.get_json()["reason"] == "csrf_failed"
    assert entry(admin)["source"] == "default" and me_remote(alice) is False


def test_a_stale_session_must_confirm_the_password_first(tmp_path):
    app = make_app(tmp_path)
    admin = login(app, ADMIN)
    with admin.session_transaction() as sess:
        sess["admin_auth_at"] = 0
    reply = put(admin, {KEY: ANY})
    assert reply.status_code == 403 and reply.get_json()["reason"] == "reauth_required"
    assert entry(admin)["source"] == "default"


def test_changes_and_refusals_are_audited_with_the_allowlist_diff(app, admin):
    put(admin, {KEY: allow("s3://lab/a/", "s3://lab/b/")})
    put(admin, {KEY: allow("s3://lab/b/", "s3://lab/c/")})
    put(admin, {KEY: allow("ftp://x/")})
    records = [r for r in audit.read(app.admin_dir, limit=20) if r["action"] == "policy.update"]
    records.reverse()
    assert [r["outcome"] for r in records] == ["ok", "ok", "refused:bad_type"]
    first, second = records[0]["detail"]["changed"][KEY], records[1]["detail"]["changed"][KEY]
    assert first["from"] is None and first["to"] == allow("s3://lab/a/", "s3://lab/b/")
    assert first["allowlist_added"] == ["s3://lab/a/", "s3://lab/b/"] and first["allowlist_removed"] == []
    assert second["from"] == first["to"]
    assert (second["allowlist_added"], second["allowlist_removed"]) == (["s3://lab/c/"], ["s3://lab/a/"])
    assert records[0]["actor"] == ADMIN


def test_a_restricted_user_still_needs_a_remote_grant_whatever_the_admin_opens(app, admin):
    from annzarro.server import access
    url = "s3://lab/atlases/a.zarr"

    def may(path):
        with app.test_request_context():
            return access.may_read(USER, path)

    with app.app_context():
        access.set_restricted(app.config, USER, True)
    assert may(url) is False
    put(admin, {KEY: ANY})
    assert may(url) is False, "opening remote datasets grants a restricted user nothing"
    with app.app_context():
        access.add_grant(app.config, USER, "remote", "s3://lab/atlases/", actor=ADMIN)
    assert may(url) is True and may("s3://lab/secret/b.zarr") is False
    put(admin, {KEY: OFF})
    assert may(url) is False, "the grant is inactive while remote datasets are off"


# -- the type -------------------------------------------------------------------------

def test_restrict_narrows_and_never_widens():
    t = RemoteAccess()
    assert t.restrict([ANY, allow("s3://b/")]) == allow("s3://b/")
    assert t.restrict([allow("s3://b/"), OFF]) == OFF
    assert t.restrict([allow("s3://b/a/", "s3://c/"), allow("s3://b/")]) == allow("s3://b/a/")
    assert t.restrict([allow("s3://b/a/"), allow("s3://b/z/")]) == OFF
    assert t.restrict([ANY, ANY]) == ANY


# -- a second worker -------------------------------------------------------------------

def test_a_change_reaches_every_worker_at_once(tmp_path):
    import concurrent.futures
    from annzarro.tests.server.multiworker_helpers import start_cluster, stop_all
    procs = []
    try:
        cluster = start_cluster(tmp_path, workers=2, procs=procs)
        admin = cluster.client("root", admin_page=True)
        user = cluster.client("alice")

        def remote_flags():
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                replies = list(pool.map(lambda _: user.get("/api/v1/auth/me").json()["remote_stores"], range(64)))
            return set(replies)

        assert remote_flags() == {False}
        for value, expected in ((ANY, True), (OFF, False), (allow("s3://lab/"), True)):
            reply = admin.put(POLICY, {KEY: value})
            assert reply.status == 200, reply.body
            assert remote_flags() == {expected}, f"a worker is stale after {value}"
        # many changes in quick succession, each seen by both workers on the very next request
        for i in range(16):
            value, expected = (OFF, False) if i % 2 else (ANY, True)
            assert admin.put(POLICY, {KEY: value}).status == 200
            assert remote_flags() == {expected}, f"a worker missed change {i} ({value})"
    finally:
        stop_all(procs)
