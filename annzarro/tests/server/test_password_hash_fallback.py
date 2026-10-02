"""
Login works on a Python whose hashlib has no scrypt (Apple's Xcode Python,
built against LibreSSL), where werkzeug's default hash raised AttributeError.
"""
import hashlib

import pytest

from annzarro.server import auth as auth_module
from annzarro.server.auth import AuthManager, UnsupportedPasswordHash
from annzarro.server.core import create_app


@pytest.fixture
def no_scrypt(monkeypatch):
    if hasattr(hashlib, "scrypt"):
        monkeypatch.delattr(hashlib, "scrypt")


def test_new_users_get_pbkdf2_without_scrypt(tmp_path, no_scrypt):
    manager = AuthManager(user_file=str(tmp_path / "users.json"))
    manager.create_user("alice", "pw")
    assert manager.get_user("alice").password_hash.startswith("pbkdf2:sha256")
    assert manager.authenticate("alice", "pw")
    assert not manager.authenticate("alice", "wrong")


@pytest.mark.skipif(not hasattr(hashlib, "scrypt"), reason="needs scrypt to create the hash")
def test_new_users_keep_scrypt_where_available(tmp_path):
    manager = AuthManager(user_file=str(tmp_path / "users.json"))
    manager.create_user("alice", "pw")
    assert manager.get_user("alice").password_hash.startswith("scrypt:")


@pytest.mark.skipif(not hasattr(hashlib, "scrypt"), reason="needs scrypt to create the hash")
def test_stored_scrypt_hash_without_scrypt_is_a_clear_error(tmp_path, monkeypatch):
    users = tmp_path / "users.json"
    AuthManager(user_file=str(users)).create_user("alice", "pw")   # scrypt
    monkeypatch.delattr(hashlib, "scrypt")
    manager = AuthManager(user_file=str(users))
    with pytest.raises(UnsupportedPasswordHash, match="scrypt"):
        manager.authenticate("alice", "pw")
    assert not manager.get_user("alice").failed_logins, "not counted as a wrong password"

    (tmp_path / "data").mkdir()
    app = create_app({"TESTING": True, "data_dir": str(tmp_path / "data"),
                      "log_file": str(tmp_path / "l.log"), "auth_enabled": True,
                      "user_file": str(users)})
    resp = app.test_client().post("/login", data={"username": "alice", "password": "pw"})
    assert resp.status_code == 500
    assert "cannot check your password" in resp.get_data(as_text=True)

    # the documented way out: reset the password on this Python
    manager.set_password("alice", "pw2")
    assert manager.authenticate("alice", "pw2")
