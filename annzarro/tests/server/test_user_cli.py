"""
`annzarro user passwd` and `annzarro user set-admin [--no-admin]` change a user
in place (previously: remove and re-add, losing nothing but awkward and racy).
A password change, or removing the user, ends their existing logins.
"""
import os

import pytest

from annzarro import cli
from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app


@pytest.fixture
def users(tmp_path, monkeypatch):
    for var in list(os.environ):
        if var.startswith("ANNZARRO_"):
            monkeypatch.delenv(var)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / ".config"))
    monkeypatch.chdir(tmp_path)
    path = tmp_path / "users.json"
    cfg = tmp_path / "site.yaml"
    cfg.write_text(f"server:\n  log_file: \"{tmp_path / 'l.log'}\"\nauth:\n  user_file: \"{path}\"\n")
    AuthManager(user_file=str(path)).create_user("alice", "old")
    return path, str(cfg)


def _run(cfg, *argv):
    return cli.main(["--config", cfg, "user", *argv])


def test_passwd_changes_password_in_place(users):
    path, cfg = users
    assert _run(cfg, "passwd", "--username", "alice", "--password", "new") == 0
    manager = AuthManager(user_file=str(path))
    assert manager.authenticate("alice", "new")
    assert not manager.authenticate("alice", "old")


def test_passwd_unknown_user_fails(users):
    _, cfg = users
    assert _run(cfg, "passwd", "--username", "bob", "--password", "x") == 1


def test_set_admin_and_revoke(users):
    path, cfg = users
    assert _run(cfg, "set-admin", "--username", "alice") == 0
    assert AuthManager(user_file=str(path)).get_user("alice").is_admin is True
    assert _run(cfg, "set-admin", "--username", "alice", "--no-admin") == 0
    assert AuthManager(user_file=str(path)).get_user("alice").is_admin is False
    assert _run(cfg, "set-admin", "--username", "bob") == 1


def _app(tmp_path, path):
    (tmp_path / "data").mkdir(exist_ok=True)
    return create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"),
                       "log_file": str(tmp_path / "t.log"), "auth_enabled": True,
                       "user_file": str(path)})


def test_password_change_signs_out_existing_logins(users, tmp_path):
    path, cfg = users
    client = _app(tmp_path, path).test_client()
    client.post("/login", data={"username": "alice", "password": "old"})
    assert client.get("/api/v1/auth/me").status_code == 200
    assert _run(cfg, "passwd", "--username", "alice", "--password", "new") == 0
    assert client.get("/api/v1/auth/me").status_code == 401
    client.post("/login", data={"username": "alice", "password": "new"})
    assert client.get("/api/v1/auth/me").status_code == 200


def test_removed_user_is_signed_out(users, tmp_path):
    path, cfg = users
    client = _app(tmp_path, path).test_client()
    client.post("/login", data={"username": "alice", "password": "old"})
    assert client.get("/api/v1/auth/me").status_code == 200
    assert _run(cfg, "remove", "--username", "alice") == 0
    assert client.get("/api/v1/auth/me").status_code == 401


def test_user_commands_load_the_production_environment_like_start(users, monkeypatch):
    """`annzarro user` loaded the development defaults while `start` loads
    production, so a user_file set for production could differ."""
    from annzarro.utils.config_manager import ConfigManager
    seen = []
    real = ConfigManager.load_config

    def spy(self, env="development", *a, **kw):
        seen.append(env)
        return real(self, env, *a, **kw)
    monkeypatch.setattr(ConfigManager, "load_config", spy)
    _, cfg = users
    assert cli.main(["user", "--config", cfg, "list"]) == 0, "--config after `user` is accepted"
    assert seen == ["production"]
