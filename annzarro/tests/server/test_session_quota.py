"""Panel sets have a quota: per user, per server, and in bytes.

Sets are files in the sessions directory, written by every user (anyone, with
login off). Nothing bounded their number or size, so a loop of POST
/sessions/save filled the disk, and sessions/list parsed every file on every
call.
"""
import json
import os
from unittest.mock import patch

import pytest

from annzarro.server import panel_sets
from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app

API = "/api/v1/sessions"
PASSWORD = "pw-for-tests"


def _app(tmp_path, auth=True, **limits):
    user_file = str(tmp_path / "users.json")
    if auth:
        manager = AuthManager(user_file=user_file)
        for name in ("alice", "bob"):
            manager.add_user(name, PASSWORD)
    return create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"),
                       "log_file": str(tmp_path / "test.log"), "auth_enabled": auth,
                       "user_file": user_file, "secret_key": "test-only-secret", **limits})


def _client(app, username=None):
    client = app.test_client()
    if username:
        assert client.post("/login", data={"username": username, "password": PASSWORD}).status_code == 302
    return client


def _save(client, name, **extra):
    return client.post(f"{API}/save", json={"name": name, "dataset": "d.zarr", **extra})


def test_a_user_cannot_keep_more_sets_than_the_limit(tmp_path):
    app = _app(tmp_path, max_sessions_per_user=3)
    alice, bob = _client(app, "alice"), _client(app, "bob")
    for i in range(3):
        assert _save(alice, f"a{i}").status_code == 200
    refused = _save(alice, "a3")
    assert refused.status_code == 409
    body = refused.get_json()
    assert body["reason"] == "session_quota_user" and body["limit"] == 3 and body["used"] == 3
    assert "max_sessions_per_user" in body["error"]
    assert not os.path.exists(os.path.join(panel_sets.directory(app.config), "a3.json"))
    # her own sets can still be overwritten, and another user has their own allowance
    assert _save(alice, "a0", note="again").status_code == 200
    assert _save(bob, "b0").status_code == 200
    # deleting frees a place
    assert alice.delete(f"{API}/delete", query_string={"name": "a1"}).status_code == 200
    assert _save(alice, "a3").status_code == 200


def test_duplicate_and_import_count_too(tmp_path):
    import io
    app = _app(tmp_path, max_sessions_per_user=2)
    alice = _client(app, "alice")
    assert _save(alice, "one").status_code == 200
    assert alice.post(f"{API}/duplicate", json={"source_name": "one", "new_name": "two"}).status_code == 200
    dup = alice.post(f"{API}/duplicate", json={"source_name": "one", "new_name": "three"})
    assert dup.status_code == 409 and dup.get_json()["reason"] == "session_quota_user"
    payload = json.dumps({"name": "four"}).encode()
    imp = alice.post(f"{API}/import", data={"file": (io.BytesIO(payload), "four.json")},
                     content_type="multipart/form-data")
    assert imp.status_code == 409 and imp.get_json()["reason"] == "session_quota_user"


def test_the_server_wide_count_and_size_are_limited(tmp_path):
    app = _app(tmp_path, auth=False, max_sessions=2, max_sessions_per_user=0)
    anyone = _client(app)
    assert _save(anyone, "x").status_code == 200 and _save(anyone, "y").status_code == 200
    refused = _save(anyone, "z")
    assert refused.status_code == 409 and refused.get_json()["reason"] == "session_quota_total"

    app = _app(tmp_path / "mb", auth=False, max_sessions_mb=0.01, max_sessions_per_user=0)
    anyone = _client(app)
    assert _save(anyone, "s1", padding="x" * 4000).status_code == 200
    assert _save(anyone, "s2", padding="x" * 4000).status_code == 200
    refused = _save(anyone, "s3", padding="x" * 4000)
    assert refused.status_code == 409 and refused.get_json()["reason"] == "session_quota_total"
    # overwriting counts the new size against the old one, not both
    assert _save(anyone, "s1", padding="y" * 4000).status_code == 200
    grown = _save(anyone, "s1", padding="y" * 9000)
    assert grown.status_code == 409


def test_zero_turns_every_quota_off(tmp_path):
    app = _app(tmp_path, auth=False, max_sessions_per_user=0, max_sessions=0, max_sessions_mb=0)
    client = _client(app)
    assert all(_save(client, f"n{i}", padding="x" * 3000).status_code == 200 for i in range(30))


def test_the_list_parses_a_file_only_when_it_changed(tmp_path):
    from annzarro.server import session_quota
    app = _app(tmp_path, auth=False)
    client = _client(app)
    for i in range(5):
        assert _save(client, f"s{i}").status_code == 200
    session_quota._summaries.clear()
    from unittest.mock import MagicMock
    spy = MagicMock(wraps=json)
    with patch.object(session_quota, "json", spy):
        names = [s["name"] for s in client.get(f"{API}/list").get_json()]
        first = spy.load.call_count
        assert first == 5 and sorted(names) == [f"s{i}" for i in range(5)]
        assert client.get(f"{API}/list").get_json() and spy.load.call_count == first
        _save(client, "s2", changed=True)
        client.get(f"{API}/list")
        assert spy.load.call_count == first + 1


def test_a_rename_is_not_a_new_set(tmp_path):
    app = _app(tmp_path, max_sessions_per_user=1)
    alice = _client(app, "alice")
    assert _save(alice, "old").status_code == 200
    reply = alice.post(f"{API}/rename", json={"old_name": "old", "new_name": "new"})
    assert reply.status_code == 200, reply.get_json()
