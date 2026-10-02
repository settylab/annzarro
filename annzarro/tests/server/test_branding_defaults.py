"""Every install's login page used to show the Setty Lab and a personal email."""
import os

import pytest

from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.utils.config_manager import ConfigManager


@pytest.fixture(autouse=True)
def clean_env(monkeypatch, tmp_path):
    for var in list(os.environ):
        if var.startswith("ANNZARRO_"):
            monkeypatch.delenv(var)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / ".config"))
    monkeypatch.setattr(ConfigManager, "SYSTEM_CONFIG_PATH", str(tmp_path / "none.yaml"))
    monkeypatch.chdir(tmp_path)


@pytest.mark.parametrize("env", ["production", "development"])
def test_defaults_carry_no_contact_and_spell_the_name(env):
    mgr = ConfigManager()
    mgr.load_config(env=env)
    flat = mgr.to_flask_config()
    assert flat["app_name"] == "AnnZarro"
    assert not any(flat["contact_info"].values())


def _login_html(tmp_path, **extra):
    (tmp_path / "data").mkdir(exist_ok=True)
    config = {"TESTING": True, "data_dir": str(tmp_path / "data"), "log_file": str(tmp_path / "l.log"),
              "auth_enabled": True, "user_file": str(tmp_path / "u.json"), "app_name": "AnnZarro",
              "contact_info": {"lab_name": None, "lab_url": None, "email": None, "custom_html": None}}
    config.update(extra)
    return create_app(config).test_client().get("/login").get_data(as_text=True)


def test_login_page_has_no_contact_block_by_default(tmp_path):
    html = _login_html(tmp_path)
    assert 'class="contact-info"' not in html
    assert "AnnZarro" in html


def test_configured_contact_is_shown(tmp_path):
    html = _login_html(tmp_path, contact_info={"lab_name": "Example Lab", "email": "a@example.org"})
    assert 'class="contact-info"' in html and "Example Lab" in html and "a@example.org" in html
