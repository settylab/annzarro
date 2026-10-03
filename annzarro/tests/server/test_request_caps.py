"""
max_cells/max_genes are the client's own caps, not server settings.

The server settings max_cells_per_request / max_genes_per_request only gave
the request parameter a default; any client could send a larger value, and
the frontend always does. They were removed rather than pretend to limit
anything. The parameter still works when sent.
"""
import os
import shutil

import pytest

from annzarro.server.core import DEFAULT_CONFIG, create_app
from annzarro.utils.config_manager import ConfigManager

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "data", "fixture_small.zarr")
REMOVED = ("max_cells_per_request", "max_genes_per_request", "max_embedding_dims")


@pytest.fixture
def client(tmp_path):
    (tmp_path / "data").mkdir()
    shutil.copytree(FIXTURE, tmp_path / "data" / "a.zarr")
    app = create_app({"TESTING": True, "data_dir": str(tmp_path / "data"),
                      "log_file": str(tmp_path / "l.log")})
    return app.test_client(), str(tmp_path / "data" / "a.zarr")


def test_client_cap_is_enforced_when_sent(client):
    c, path = client
    resp = c.get("/api/v1/data/obs", query_string={"dataset_path": path, "rows": "0,1,2", "max_cells": 2})
    assert resp.status_code == 400 and resp.get_json()["reason"] == "cap_exceeded"


def test_no_cap_without_the_parameter(client):
    c, path = client
    resp = c.get("/api/v1/data/obs", query_string={"dataset_path": path, "rows": "0,1,2"})
    assert (resp.get_json() or {}).get("reason") != "cap_exceeded"


@pytest.mark.parametrize("env", ["production", "development"])
def test_removed_settings_are_gone(env, monkeypatch, tmp_path):
    for var in list(os.environ):
        if var.startswith("ANNZARRO_"):
            monkeypatch.delenv(var)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "SYSTEM_CONFIG_PATH", str(tmp_path / "none.yaml"))
    mgr = ConfigManager()
    mgr.load_config(env=env)
    flat = mgr.to_flask_config()
    for key in REMOVED:
        assert key not in flat and key not in DEFAULT_CONFIG
