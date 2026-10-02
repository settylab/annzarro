"""
The login cookie: SameSite=Lax, Secure over HTTPS, and an idle timeout that
is actually enforced (auth.session_timeout used to be read by nothing).
"""
import time

import pytest

from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app


def _app(tmp_path, **extra):
    (tmp_path / "data").mkdir(exist_ok=True)
    users = tmp_path / "users.json"
    if not users.exists():
        AuthManager(user_file=str(users)).create_user("alice", "pw")
    config = {"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"),
              "log_file": str(tmp_path / "test.log"), "auth_enabled": True,
              "user_file": str(users)}
    config.update(extra)
    return create_app(config)


def _login(client, **kw):
    return client.post("/login", data={"username": "alice", "password": "pw"}, **kw)


def test_cookie_is_lax_and_httponly_and_not_secure_over_http(tmp_path):
    cookie = _login(_app(tmp_path).test_client()).headers["Set-Cookie"]
    assert "SameSite=Lax" in cookie and "HttpOnly" in cookie
    assert "Secure" not in cookie


def test_cookie_is_secure_over_https(tmp_path):
    cookie = _login(_app(tmp_path).test_client(), base_url="https://localhost").headers["Set-Cookie"]
    assert "Secure" in cookie


def test_cookie_is_secure_behind_a_trusted_tls_proxy(tmp_path):
    client = _app(tmp_path, proxy_count=1).test_client()
    cookie = _login(client, headers={"X-Forwarded-Proto": "https"}).headers["Set-Cookie"]
    assert "Secure" in cookie


def test_untrusted_forwarded_proto_is_ignored(tmp_path):
    client = _app(tmp_path).test_client()  # proxy_count 0
    cookie = _login(client, headers={"X-Forwarded-Proto": "https"}).headers["Set-Cookie"]
    assert "Secure" not in cookie


@pytest.mark.parametrize("setting,secure", [(True, True), ("true", True), (False, False), ("false", False)])
def test_cookie_secure_can_be_forced(tmp_path, setting, secure):
    cookie = _login(_app(tmp_path, cookie_secure=setting).test_client()).headers["Set-Cookie"]
    assert ("Secure" in cookie) is secure


def test_idle_session_expires(tmp_path):
    client = _app(tmp_path, session_timeout=60).test_client()
    _login(client)
    assert client.get("/api/v1/auth/me").status_code == 200
    with client.session_transaction() as sess:
        sess["last_activity"] = time.time() - 61
    assert client.get("/api/v1/auth/me").status_code == 401
    # and stays expired: the session was cleared, not just refused once
    with client.session_transaction() as sess:
        assert "user_id" not in sess


def test_activity_keeps_the_session_alive(tmp_path):
    client = _app(tmp_path, session_timeout=120).test_client()
    _login(client)
    with client.session_transaction() as sess:
        sess["last_activity"] = time.time() - 100
    assert client.get("/api/v1/auth/me").status_code == 200
    with client.session_transaction() as sess:
        assert time.time() - sess["last_activity"] < 5


def test_zero_timeout_never_expires(tmp_path):
    client = _app(tmp_path, session_timeout=0).test_client()
    _login(client)
    with client.session_transaction() as sess:
        sess["last_activity"] = 0
    assert client.get("/api/v1/auth/me").status_code == 200


def test_timeout_comes_from_the_yaml_config(tmp_path, monkeypatch):
    from annzarro.server.wsgi import load_hosted_config
    for name in list(__import__("os").environ):
        if name.startswith("ANNZARRO_"):
            monkeypatch.delenv(name, raising=False)
    path = tmp_path / "site.yaml"
    path.write_text(f"server:\n  data_dir: \"{tmp_path}\"\n  log_file: \"{tmp_path / 'l.log'}\"\n"
                    f"auth:\n  user_file: \"{tmp_path / 'u.json'}\"\n  session_timeout: 600\n"
                    "  cookie_secure: true\n")
    config = load_hosted_config(config_path=str(path))
    assert config["session_timeout"] == 600 and config["cookie_secure"] is True
