"""
The login cookie key is never a placeholder, and is shared by every instance
that shares a users file (see annzarro/server/secret_key.py).
"""
import os
import stat

from unittest import mock

import pytest

from annzarro.server import secret_key as secret_key_module
from annzarro.server.core import create_app
from annzarro.server.secret_key import (
    PLACEHOLDER_SECRET_KEYS,
    SECRET_KEY_FILENAME,
    resolve_secret_key,
)


def _app(tmp_path, **config):
    base = {
        "TESTING": True,
        "data_dir": str(tmp_path / "data"),
        "log_file": str(tmp_path / "test.log"),
        "auth_enabled": True,
        "user_file": str(tmp_path / "auth" / "users.json"),
    }
    base.update(config)
    return create_app(base)


def test_instances_sharing_a_users_file_share_the_generated_key(tmp_path):
    first = _app(tmp_path)
    second = _app(tmp_path)
    assert first.secret_key == second.secret_key
    assert len(first.secret_key) >= 64

    key_file = tmp_path / "auth" / SECRET_KEY_FILENAME
    assert key_file.read_text().strip() == first.secret_key
    if os.name == "posix":
        assert stat.S_IMODE(key_file.stat().st_mode) == 0o600


@pytest.mark.parametrize("placeholder", sorted(PLACEHOLDER_SECRET_KEYS))
def test_placeholder_keys_are_never_used(tmp_path, placeholder):
    # create_app resets the root logger's handlers (and so caplog's): watch
    # the module logger directly
    with mock.patch.object(secret_key_module.logger, "warning") as warning:
        app = _app(tmp_path, secret_key=placeholder)
    assert app.secret_key != placeholder
    assert app.secret_key not in PLACEHOLDER_SECRET_KEYS
    assert any("placeholder" in str(c.args[0]) for c in warning.call_args_list)


def test_missing_key_is_generated(tmp_path):
    app = _app(tmp_path, secret_key=None)
    assert app.secret_key and app.secret_key not in PLACEHOLDER_SECRET_KEYS


def test_explicit_key_wins(tmp_path):
    app = _app(tmp_path, secret_key="an-operator-chosen-random-value")
    assert app.secret_key == "an-operator-chosen-random-value"
    assert not (tmp_path / "auth" / SECRET_KEY_FILENAME).exists()


def test_a_forged_cookie_from_a_placeholder_is_rejected(tmp_path):
    """The point of all this: a cookie signed with a published key logs nobody in."""
    from flask import Flask
    from flask.sessions import SecureCookieSessionInterface

    forger = Flask("forger")
    forger.secret_key = "change-this-in-production"
    serializer = SecureCookieSessionInterface().get_signing_serializer(forger)
    cookie = serializer.dumps({"user_id": "root", "is_admin": True, "last_activity": 9e12})

    app = _app(tmp_path, secret_key="change-this-in-production")
    client = app.test_client()
    client.set_cookie("session", cookie)
    assert client.get("/api/v1/auth/me").status_code == 401


def test_shipped_configs_carry_no_placeholder():
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    shipped = [
        "annzarro/server/config.json",
        "annzarro/server/production_config.json",
        "config/base.yaml",
        "config/production.yaml",
        "config/development.yaml",
    ]
    for rel in shipped:
        path = os.path.join(root, rel)
        if not os.path.exists(path):
            continue
        text = open(path).read()
        for placeholder in PLACEHOLDER_SECRET_KEYS:
            assert placeholder not in text, f"{rel} ships the placeholder {placeholder!r}"


def test_unwritable_directory_falls_back_to_a_random_key(tmp_path):
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("")
    key = resolve_secret_key(None, str(blocker / "users.json"))
    assert key and key not in PLACEHOLDER_SECRET_KEYS
