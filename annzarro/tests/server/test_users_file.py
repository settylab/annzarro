"""
users.json is shared by the server and `annzarro user add/remove`: neither may
drop the other's changes (see AuthManager._save_users).
"""
import json
import os

import pytest

from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app

PASSWORD = "pw-for-tests"


@pytest.fixture
def app(tmp_path):
    user_file = str(tmp_path / "users.json")
    AuthManager(user_file=user_file).add_user("alice", PASSWORD)
    return create_app({
        "TESTING": True,
        "data_dir": str(tmp_path / "data"),
        "log_file": str(tmp_path / "test.log"),
        "auth_enabled": True,
        "user_file": user_file,
        "secret_key": "test-only-secret",
    })


def _login(app, username):
    return app.test_client().post("/login", data={"username": username, "password": PASSWORD})


def _on_disk(app):
    with open(app.auth_manager.user_file) as f:
        return json.load(f)


def test_user_added_by_cli_survives_a_server_login(app):
    # The app holds its store in memory; the CLI is a separate AuthManager
    cli = AuthManager(user_file=app.auth_manager.user_file)
    cli.add_user("carol", PASSWORD)

    assert _login(app, "alice").status_code == 302  # the server writes users.json
    assert "carol" in _on_disk(app), "the server's write dropped a user the CLI added"
    assert _login(app, "carol").status_code == 302, "a CLI-added user can log in without a restart"


def test_admin_granted_by_cli_takes_effect_without_restart(app):
    cli = AuthManager(user_file=app.auth_manager.user_file)
    cli.add_user("root", PASSWORD, is_admin=True)
    assert app.auth_manager.get_user("root").is_admin is True


def test_user_removed_by_cli_is_not_resurrected_by_a_failed_login(app):
    cli = AuthManager(user_file=app.auth_manager.user_file)
    cli.remove_user("alice")
    app.test_client().post("/login", data={"username": "alice", "password": "wrong"})
    assert "alice" not in _on_disk(app)


def test_write_racing_the_reload_is_still_merged(app):
    """The reload before each operation narrows the window; the merge closes it.

    Disable the reload to model the CLI writing between the server's reload
    and its save: the save must still re-read the file, not dump its table.
    """
    app.auth_manager._reload_if_changed = lambda: None
    AuthManager(user_file=app.auth_manager.user_file).add_user("carol", PASSWORD)
    assert _login(app, "alice").status_code == 302
    assert "carol" in _on_disk(app)


def test_stale_store_merges_instead_of_overwriting(tmp_path):
    user_file = str(tmp_path / "users.json")
    first = AuthManager(user_file=user_file)
    second = AuthManager(user_file=user_file)  # both loaded an empty file
    first.add_user("a", PASSWORD)
    second.add_user("b", PASSWORD)
    first.remove_user("a")
    with open(user_file) as f:
        assert set(json.load(f)) == {"b"}


def test_write_is_atomic_and_leaves_no_temp_files(app):
    _login(app, "alice")
    directory = os.path.dirname(app.auth_manager.user_file)
    leftovers = [n for n in os.listdir(directory) if n.startswith(".users_")]
    assert leftovers == []
    _on_disk(app)  # parses


def test_login_never_logs_the_password_hash(tmp_path, caplog):
    """authenticate() logged the first 20 characters of the stored hash at INFO."""
    import logging
    from annzarro.server.auth import AuthManager
    manager = AuthManager(user_file=str(tmp_path / "users.json"))
    manager.create_user("alice", "correct horse")
    stored = manager.get_user("alice").password_hash
    with caplog.at_level(logging.DEBUG):
        manager.authenticate("alice", "correct horse")
        manager.authenticate("alice", "wrong")
    text = caplog.text
    assert "correct horse" not in text and "wrong" not in text.replace("Invalid password", "")
    for part in stored.split("$"):
        assert part[:8] not in text, "part of the password hash reached the log"
