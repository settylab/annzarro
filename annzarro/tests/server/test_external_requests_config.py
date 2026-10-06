"""The Gene Set Analysis panel's server switch for external requests.

- ``integrations.external_requests`` (base.yaml, schema.yaml) reaches the
  browser through ``GET /api/v1/config``: ``ask`` by default, an admin's
  file overrides it.
- ``ANNZARRO_EXTERNAL_REQUESTS`` (off/ask/on) wins over the file, so the
  desktop app or an offline install can force ``off`` without one; an
  unknown value is ignored. ``config show`` does not call it unknown.
- STRING is pinned to the versioned 12.5 host, and the panel is offered.
"""
import os

import pytest

from annzarro.server.wsgi import create_wsgi_app
from annzarro.utils.config_manager import ConfigManager


@pytest.fixture
def site(tmp_path, monkeypatch):
    for name in list(os.environ):
        if name.startswith("ANNZARRO_"):
            monkeypatch.delenv(name, raising=False)
    (tmp_path / "data").mkdir()

    def write(extra=""):
        path = tmp_path / "site.yaml"
        path.write_text(f"server:\n  data_dir: \"{tmp_path / 'data'}\"\n  log_file: \"{tmp_path / 'l.log'}\"\n"
                        f"auth:\n  enabled: false\n  user_file: \"{tmp_path / 'u.json'}\"\n" + extra)
        return str(path)
    return write


def _client_config(path):
    return create_wsgi_app(config_path=path).test_client().get("/api/v1/config").get_json()


def test_defaults_reach_the_browser(site):
    cfg = _client_config(site())
    integrations = cfg["integrations"]
    assert integrations["external_requests"] == "ask"
    assert integrations["gene_set"] == {"services": None, "timeout_ms": 20000}
    assert integrations["string_db"] == {"base_url": "https://version-12-5.string-db.org/api", "version": "12.5"}
    assert "gene-set" in cfg["ui"]["enabled_panel_types"]


def test_an_admin_turns_it_off(site):
    cfg = _client_config(site('integrations:\n  external_requests: "off"\n  gene_set:\n    services: [string]\n'))
    assert cfg["integrations"]["external_requests"] == "off"
    assert cfg["integrations"]["gene_set"]["services"] == ["string"]
    assert cfg["integrations"]["string_db"]["version"] == "12.5", "the rest from the defaults"


@pytest.mark.parametrize("value", ["off", "ON", " ask "])
def test_the_environment_wins(site, monkeypatch, value):
    path = site('integrations:\n  external_requests: "on"\n')
    monkeypatch.setenv("ANNZARRO_EXTERNAL_REQUESTS", value)
    assert _client_config(path)["integrations"]["external_requests"] == value.strip().lower()


def test_an_unknown_environment_value_is_ignored(site, monkeypatch):
    path = site('integrations:\n  external_requests: "off"\n')
    monkeypatch.setenv("ANNZARRO_EXTERNAL_REQUESTS", "sometimes")
    assert _client_config(path)["integrations"]["external_requests"] == "off"


def test_the_variable_is_not_reported_as_ignored(site, monkeypatch):
    monkeypatch.setenv("ANNZARRO_EXTERNAL_REQUESTS", "off")
    mgr = ConfigManager()
    mgr.load_config(env="production", config_path=site())
    assert not [layer for layer in mgr.layers if layer["status"] == "ignored"]
