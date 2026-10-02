"""
Too many failed logins lock out the ADDRESS that failed, for that account.

The lockout used to be per user name only, so anyone who knew a user name
could lock its owner out for 15 minutes by failing five times on purpose.
"""
import time

import pytest

from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app


@pytest.fixture
def manager(tmp_path):
    m = AuthManager(user_file=str(tmp_path / "users.json"), max_login_attempts=3, lockout_time=60)
    m.create_user("alice", "pw")
    return m


def test_attacker_locks_only_themselves_out(manager):
    for _ in range(3):
        assert not manager.authenticate("alice", "guess", client_ip="10.0.0.66")
    assert not manager.authenticate("alice", "pw", client_ip="10.0.0.66"), "attacker address locked"
    assert manager.authenticate("alice", "pw", client_ip="10.0.0.5"), "the owner still gets in"


def test_lockout_is_shared_across_processes(manager, tmp_path):
    for _ in range(3):
        manager.authenticate("alice", "guess", client_ip="10.0.0.66")
    other_worker = AuthManager(user_file=str(tmp_path / "users.json"), max_login_attempts=3, lockout_time=60)
    assert not other_worker.authenticate("alice", "pw", client_ip="10.0.0.66")


def test_lockout_expires(manager, monkeypatch):
    for _ in range(3):
        manager.authenticate("alice", "guess", client_ip="10.0.0.66")
    later = time.time() + 61
    monkeypatch.setattr(time, "time", lambda: later)
    assert manager.authenticate("alice", "pw", client_ip="10.0.0.66")


def test_success_resets_the_count_and_old_failures_are_forgotten(manager, monkeypatch):
    manager.authenticate("alice", "guess", client_ip="10.0.0.7")
    manager.authenticate("alice", "guess", client_ip="10.0.0.7")
    assert manager.authenticate("alice", "pw", client_ip="10.0.0.7")
    manager.authenticate("alice", "guess", client_ip="10.0.0.8")
    later = time.time() + 61
    monkeypatch.setattr(time, "time", lambda: later)
    manager.authenticate("alice", "guess", client_ip="10.0.0.9")
    assert set(manager.get_user("alice").failed_logins) == {"10.0.0.9"}


def test_login_route_counts_by_remote_address(tmp_path):
    users = tmp_path / "users.json"
    AuthManager(user_file=str(users)).create_user("alice", "pw")
    (tmp_path / "data").mkdir()
    app = create_app({"TESTING": True, "data_dir": str(tmp_path / "data"), "log_file": str(tmp_path / "l.log"),
                      "auth_enabled": True, "user_file": str(users)})
    client = app.test_client()
    attacker = {"REMOTE_ADDR": "10.0.0.66"}
    for _ in range(5):
        client.post("/login", data={"username": "alice", "password": "x"}, environ_base=attacker)
    owner = app.test_client()
    resp = owner.post("/login", data={"username": "alice", "password": "pw"},
                      environ_base={"REMOTE_ADDR": "10.0.0.5"})
    assert resp.status_code == 302 and resp.headers["Location"] == "/"
    locked = app.test_client().post("/login", data={"username": "alice", "password": "pw"},
                                    environ_base=attacker)
    assert locked.status_code == 200, "the attacker's address gets the login page again"
