"""POST /api/v1/cache/reset empties the cache every user shares: admins only when hosted."""
import pytest

from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app


def _app(tmp_path, **extra):
    (tmp_path / "data").mkdir(exist_ok=True)
    users = tmp_path / "users.json"
    if not users.exists():
        manager = AuthManager(user_file=str(users))
        manager.create_user("alice", "pw")
        manager.create_user("root", "pw", is_admin=True)
    config = {"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"),
              "log_file": str(tmp_path / "test.log"), "auth_enabled": False,
              "user_file": str(users)}
    config.update(extra)
    return create_app(config)


def _as(app, user):
    client = app.test_client()
    client.post("/login", data={"username": user, "password": "pw"})
    return client


def test_signed_in_user_cannot_reset(tmp_path):
    resp = _as(_app(tmp_path, auth_enabled=True), "alice").post("/api/v1/cache/reset")
    assert resp.status_code == 403 and resp.get_json()["reason"] == "admin_only"


def test_admin_can_reset(tmp_path):
    resp = _as(_app(tmp_path, auth_enabled=True), "root").post("/api/v1/cache/reset")
    assert resp.status_code == 200


def test_anonymous_gets_401(tmp_path):
    assert _app(tmp_path, auth_enabled=True).test_client().post("/api/v1/cache/reset").status_code == 401


def test_hosted_without_login_refuses(tmp_path):
    resp = _app(tmp_path, host="0.0.0.0").test_client().post("/api/v1/cache/reset")
    assert resp.status_code == 403


def test_local_single_user_may_reset(tmp_path):
    assert _app(tmp_path).test_client().post("/api/v1/cache/reset").status_code == 200
