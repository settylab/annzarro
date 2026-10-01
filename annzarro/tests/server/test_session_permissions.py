"""
Who may delete, rename or overwrite a shared panel set.

Drives the real routes through the Flask test client with real logins, so the
check is exercised exactly where a browser would hit it. See
``annzarro/server/permissions.py`` for the rule being tested.
"""
import io
import json
import os

import pytest

from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.server.permissions import is_exposed

API = "/api/v1/sessions"
PASSWORD = "pw-for-tests"


def _make_app(tmp_path, auth_enabled):
    user_file = str(tmp_path / "users.json")
    if auth_enabled:
        manager = AuthManager(user_file=user_file)
        manager.add_user("alice", PASSWORD)
        manager.add_user("bob", PASSWORD)
        manager.add_user("root", PASSWORD, is_admin=True)
    return create_app({
        "TESTING": True,
        "host": "127.0.0.1",
        "data_dir": str(tmp_path / "data"),
        "log_file": str(tmp_path / "test.log"),
        "auth_enabled": auth_enabled,
        "user_file": user_file,
        "secret_key": "test-only-secret",
    })


@pytest.fixture
def app(tmp_path):
    return _make_app(tmp_path, auth_enabled=True)


@pytest.fixture
def open_app(tmp_path):
    return _make_app(tmp_path, auth_enabled=False)


def _sessions_dir(app):
    return os.path.join(app.config["data_dir"], "sessions")


def _client(app, username=None):
    client = app.test_client()
    if username:
        resp = client.post("/login", data={"username": username, "password": PASSWORD})
        assert resp.status_code == 302, f"login failed for {username}"
    return client


def _save(client, name, **extra):
    body = {"name": name, "dataset": "d.zarr", "panelConfigs": {}}
    body.update(extra)
    return client.post(f"{API}/save", json=body)


def _stored(app, name):
    with open(os.path.join(_sessions_dir(app), f"{name}.json")) as f:
        return json.load(f)


def _write_legacy(app, name):
    os.makedirs(_sessions_dir(app), exist_ok=True)
    with open(os.path.join(_sessions_dir(app), f"{name}.json"), "w") as f:
        json.dump({"name": name, "dataset": "d.zarr", "timestamp": "2025-01-01T00:00:00"}, f)


def _import(client, name, payload, overwrite=False):
    data = {
        "file": (io.BytesIO(json.dumps(payload).encode()), f"{name}.json"),
        "name": name,
        "overwrite": "true" if overwrite else "false",
    }
    return client.post(f"{API}/import", data=data, content_type="multipart/form-data")


# --- owner ------------------------------------------------------------------

def test_save_records_owner_and_timestamps(app):
    alice = _client(app, "alice")
    assert _save(alice, "mine").status_code == 200
    stored = _stored(app, "mine")
    assert stored["owner"] == "alice"
    assert stored["modified_by"] == "alice"
    assert stored["created_at"] and stored["modified_at"]


def test_owner_can_overwrite_rename_and_delete(app):
    alice = _client(app, "alice")
    _save(alice, "mine")
    created = _stored(app, "mine")["created_at"]

    assert _save(alice, "mine").status_code == 200
    assert _stored(app, "mine")["created_at"] == created, "overwrite must keep creation time"

    resp = alice.post(f"{API}/rename", json={"old_name": "mine", "new_name": "renamed"})
    assert resp.status_code == 200
    assert _stored(app, "renamed")["owner"] == "alice"

    assert alice.delete(f"{API}/delete?name=renamed").status_code == 200
    assert not os.path.exists(os.path.join(_sessions_dir(app), "renamed.json"))


# --- non-owner --------------------------------------------------------------

def test_non_owner_cannot_delete_rename_or_overwrite(app):
    _save(_client(app, "alice"), "alices")
    before = _stored(app, "alices")
    bob = _client(app, "bob")

    resp = bob.delete(f"{API}/delete?name=alices")
    assert resp.status_code == 403
    body = resp.get_json()
    assert body["reason"] == "not_owner" and body["owner"] == "alice"
    assert "alice" in body["error"]

    resp = bob.post(f"{API}/rename", json={"old_name": "alices", "new_name": "stolen"})
    assert resp.status_code == 403
    assert not os.path.exists(os.path.join(_sessions_dir(app), "stolen.json"))

    assert _save(bob, "alices").status_code == 403
    assert _import(bob, "alices", {"name": "alices"}, overwrite=True).status_code == 403

    assert _stored(app, "alices") == before, "a refused request must not touch the file"


def test_non_owner_can_still_read_and_duplicate(app):
    _save(_client(app, "alice"), "alices")
    bob = _client(app, "bob")
    assert bob.get(f"{API}/load?name=alices").status_code == 200
    assert bob.get(f"{API}/export?name=alices").status_code == 200

    resp = bob.post(f"{API}/duplicate", json={"source_name": "alices", "new_name": "bobs copy"})
    assert resp.status_code == 200
    assert _stored(app, "bobs copy")["owner"] == "bob", "a copy belongs to whoever made it"


def test_client_cannot_claim_ownership(app):
    bob = _client(app, "bob")
    _save(bob, "forged", owner="alice", created_at="1970-01-01")
    stored = _stored(app, "forged")
    assert stored["owner"] == "bob"
    assert stored["created_at"] != "1970-01-01"

    _import(bob, "imported", {"name": "imported", "owner": "alice"})
    assert _stored(app, "imported")["owner"] == "bob"


def test_list_reports_can_modify_per_user(app):
    _save(_client(app, "alice"), "alices")
    _save(_client(app, "bob"), "bobs")

    listed = {s["name"]: s for s in _client(app, "bob").get(f"{API}/list").get_json()}
    assert listed["alices"]["can_modify"] is False
    assert listed["alices"]["owner"] == "alice"
    assert listed["bobs"]["can_modify"] is True

    listed = {s["name"]: s for s in _client(app, "root").get(f"{API}/list").get_json()}
    assert listed["alices"]["can_modify"] is True

    exists = _client(app, "bob").get(f"{API}/exists?name=alices").get_json()
    assert exists["exists"] is True and exists["can_modify"] is False


# --- admin ------------------------------------------------------------------

def test_admin_can_modify_anything_and_ownership_is_kept(app):
    _save(_client(app, "alice"), "alices")
    root = _client(app, "root")

    assert _save(root, "alices").status_code == 200
    stored = _stored(app, "alices")
    assert stored["owner"] == "alice", "an admin's overwrite must not take ownership"
    assert stored["modified_by"] == "root"

    assert root.delete(f"{API}/delete?name=alices").status_code == 200


def test_admin_status_is_read_live_not_from_the_cookie(app):
    _save(_client(app, "alice"), "alices")
    root = _client(app, "root")
    app.auth_manager.get_user("root").is_admin = False
    assert root.delete(f"{API}/delete?name=alices").status_code == 403


# --- legacy sets without an owner -------------------------------------------

def test_legacy_set_is_admin_only(app):
    _write_legacy(app, "old")
    alice = _client(app, "alice")

    resp = alice.delete(f"{API}/delete?name=old")
    assert resp.status_code == 403
    assert resp.get_json()["reason"] == "legacy_admin_only"
    assert alice.post(f"{API}/rename", json={"old_name": "old", "new_name": "x"}).status_code == 403
    assert _save(alice, "old").status_code == 403
    assert alice.get(f"{API}/load?name=old").status_code == 200

    listed = {s["name"]: s for s in alice.get(f"{API}/list").get_json()}
    assert listed["old"]["can_modify"] is False and listed["old"]["owner"] is None

    assert _client(app, "root").delete(f"{API}/delete?name=old").status_code == 200


def test_unparseable_set_is_not_treated_as_absent(app):
    os.makedirs(_sessions_dir(app), exist_ok=True)
    with open(os.path.join(_sessions_dir(app), "broken.json"), "w") as f:
        f.write("{not json")
    assert _save(_client(app, "alice"), "broken").status_code == 403


# --- auth disabled: single local user, unchanged behaviour -------------------

def test_auth_disabled_allows_everything(open_app):
    client = _client(open_app)
    _write_legacy(open_app, "old")
    assert _save(client, "mine").status_code == 200
    assert _stored(open_app, "mine")["owner"] is None
    assert _save(client, "old").status_code == 200
    assert client.post(f"{API}/rename", json={"old_name": "old", "new_name": "older"}).status_code == 200
    assert client.delete(f"{API}/delete?name=older").status_code == 200
    assert all(s["can_modify"] for s in client.get(f"{API}/list").get_json())


# --- who am I ---------------------------------------------------------------

def test_auth_me(app, open_app):
    me = _client(app, "root").get("/api/v1/auth/me").get_json()
    assert me == {"auth_enabled": True, "username": "root", "is_admin": True, "exposed": False}
    assert _client(app, "bob").get("/api/v1/auth/me").get_json()["is_admin"] is False
    assert app.test_client().get("/api/v1/auth/me").status_code == 401

    me = _client(open_app).get("/api/v1/auth/me").get_json()
    assert me["auth_enabled"] is False and me["username"] is None


def test_is_exposed():
    assert is_exposed({"host": "0.0.0.0", "auth_enabled": False})
    assert not is_exposed({"host": "0.0.0.0", "auth_enabled": True})
    assert not is_exposed({"host": "127.0.0.1", "auth_enabled": False})
    assert not is_exposed({"auth_enabled": False})


# --- path containment and stored names --------------------------------------

def test_delete_by_file_cannot_leave_the_sessions_directory(open_app):
    client = _client(open_app)
    _save(client, "anchor")  # creates the sessions directory
    sibling = os.path.join(open_app.config["data_dir"], "sessions_old")
    os.makedirs(sibling)
    victim = os.path.join(sibling, "notes.json")
    with open(victim, "w") as f:
        f.write("{}")

    resp = client.delete(f"{API}/delete", query_string={"file": victim})
    assert resp.status_code == 400
    assert os.path.exists(victim)


def test_rename_stores_the_sanitized_name(open_app):
    client = _client(open_app)
    _save(client, "plain")
    resp = client.post(f"{API}/rename", json={"old_name": "plain", "new_name": "<img src=x onerror=alert(1)>"})
    assert resp.status_code == 200
    names = [s["name"] for s in client.get(f"{API}/list").get_json()]
    assert all("<" not in n for n in names), names


# --- startup warnings -------------------------------------------------------

def test_startup_warns_when_exposed_without_login(caplog):
    from annzarro.server.core import warn_about_exposure
    with caplog.at_level("WARNING"):
        warn_about_exposure({"host": "0.0.0.0", "auth_enabled": False})
    assert "login DISABLED" in caplog.text

    caplog.clear()
    with caplog.at_level("WARNING"):
        warn_about_exposure({"host": "0.0.0.0", "auth_enabled": True,
                             "secret_key": "change-this-in-production"})
    assert "placeholder" in caplog.text

    caplog.clear()
    with caplog.at_level("WARNING"):
        warn_about_exposure({"host": "127.0.0.1", "auth_enabled": False})
        warn_about_exposure({"host": "0.0.0.0", "auth_enabled": True, "secret_key": "s3cret"})
    assert "SECURITY" not in caplog.text
