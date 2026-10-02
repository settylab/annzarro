"""
The WSGI factory (gunicorn) is hosted by default: login on, paths confined
(annzarro/server/wsgi.py). It cannot know its bind address, so it must not
fall back to the laptop defaults the old `create_app()` target ran with.
"""
import json
import os
from unittest import mock

import pytest

from annzarro.server import core as core_module
from annzarro.server.confinement import is_hosted
from annzarro.server.permissions import is_exposed
from annzarro.server.wsgi import create_wsgi_app, load_hosted_config


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in list(os.environ):
        if name.startswith("ANNZARRO_"):
            monkeypatch.delenv(name, raising=False)


@pytest.fixture
def layout(tmp_path):
    (tmp_path / "data" / "inside.zarr").mkdir(parents=True)
    (tmp_path / "outside" / "secret.zarr").mkdir(parents=True)
    return tmp_path


def _yaml(tmp_path, auth_extra=""):
    path = tmp_path / "site.yaml"
    path.write_text(
        "server:\n"
        f"  data_dir: \"{tmp_path / 'data'}\"\n"
        f"  log_file: \"{tmp_path / 'test.log'}\"\n"
        "auth:\n"
        f"  user_file: \"{tmp_path / 'users.json'}\"\n"
        + auth_extra
    )
    return str(path)


def test_factory_defaults_to_login_and_confinement(layout):
    app = create_wsgi_app(config_path=_yaml(layout))
    assert app.config["auth_enabled"] is True
    assert app.config["hosted"] is True
    assert is_hosted(app.config)
    assert hasattr(app, "auth_manager")

    client = app.test_client()
    outside = client.get("/api/v1/data/dataset_structure",
                         query_string={"dataset_path": str(layout / "outside" / "secret.zarr")})
    assert outside.status_code == 401, "login is checked before the path"
    app.auth_manager.create_user("alice", "pw")
    with client.session_transaction() as sess:
        sess["user_id"] = "alice"
        sess["last_activity"] = 9e12
    outside = client.get("/api/v1/data/dataset_structure",
                         query_string={"dataset_path": str(layout / "outside" / "secret.zarr")})
    assert outside.status_code == 403
    assert outside.get_json()["reason"] == "outside_data_dir"
    client = app.test_client()

    inside = client.get("/api/v1/data/dataset_structure",
                        query_string={"dataset_path": str(layout / "data" / "inside.zarr")})
    assert inside.status_code == 401, "login is required"


def test_explicitly_disabled_login_stays_possible_but_warns(layout):
    with mock.patch.object(core_module.logger, "warning") as warning:
        app = create_wsgi_app(config_path=_yaml(layout, "  enabled: false\n"))
    assert app.config["auth_enabled"] is False
    assert is_hosted(app.config), "still confined: it is still a shared server"
    assert is_exposed(app.config)
    assert any("login" in str(c.args) and "DISABLED" in str(c.args) for c in warning.call_args_list)


def test_auth_disabled_env_var_is_honoured_and_warns(layout, monkeypatch):
    monkeypatch.setenv("ANNZARRO_AUTH_DISABLED", "1")
    config = load_hosted_config(config_path=_yaml(layout))
    assert config["auth_enabled"] is False and is_exposed(config)


@pytest.mark.parametrize("value", ["false", "False", "0", "no", "off", ""])
def test_auth_disabled_env_var_set_to_false_keeps_login(layout, monkeypatch, value):
    """Only a true value disables login; ``=false`` used to disable it too."""
    monkeypatch.setenv("ANNZARRO_AUTH_DISABLED", value)
    config = load_hosted_config(config_path=_yaml(layout))
    assert config["auth_enabled"] is True


@pytest.mark.parametrize("value", ["true", "YES", "1", "on"])
def test_auth_disabled_env_var_true_values(layout, monkeypatch, value):
    monkeypatch.setenv("ANNZARRO_AUTH_DISABLED", value)
    assert load_hosted_config(config_path=_yaml(layout))["auth_enabled"] is False


def test_auth_disabled_env_var_typo_keeps_login(layout, monkeypatch):
    monkeypatch.setenv("ANNZARRO_AUTH_DISABLED", "ture")
    assert load_hosted_config(config_path=_yaml(layout))["auth_enabled"] is True


def test_flat_json_config_is_understood(layout):
    """The shipped server/production_config.json is flat; its keys must land."""
    path = layout / "flat.json"
    path.write_text(json.dumps({
        "data_dir": str(layout / "data"),
        "log_file": str(layout / "test.log"),
        "auth_enabled": False,
        "user_file": str(layout / "users.json"),
    }))
    config = load_hosted_config(config_path=str(path))
    assert config["auth_enabled"] is False
    assert config["data_dir"] == str(layout / "data")
    assert config["user_file"] == str(layout / "users.json")


def test_shipped_production_config_loads_hosted_with_login(monkeypatch):
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    config = load_hosted_config(config_path=os.path.join(root, "annzarro", "server", "production_config.json"))
    assert config["auth_enabled"] is True
    assert config["hosted"] is True
    assert config["host"] == "127.0.0.1", "gunicorn should sit behind a reverse proxy"
