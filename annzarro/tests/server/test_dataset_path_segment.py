"""
/datasets/<path>[/info|/uns/...] take a path relative to data_dir.

They resolved the segment against the server's working directory (and an
absolute path lost its leading "/"), and answered a missing dataset with
200 and an error body, 400 or 500 depending on the route.
"""
import os

import pytest

from annzarro.core import zarr_reader
from annzarro.server.core import create_app
from annzarro.tests.server.rich_store import make_rich_store

SUFFIXES = ["", "/info", "/uns/structure", "/uns/title"]


def _client(tmp_path, **extra):
    zarr_reader.clear_cache()
    config = {"TESTING": True, "data_dir": str(tmp_path / "data"),
              "log_file": str(tmp_path / "l.log")}
    config.update(extra)
    return create_app(config).test_client()


@pytest.fixture
def layout(tmp_path, monkeypatch):
    (tmp_path / "data").mkdir()
    make_rich_store(tmp_path / "data" / "rich.zarr")
    (tmp_path / "cwd").mkdir()
    monkeypatch.chdir(tmp_path / "cwd")   # nothing to find relative to the CWD
    yield tmp_path
    zarr_reader.clear_cache()


@pytest.mark.parametrize("suffix", SUFFIXES)
def test_segment_is_relative_to_data_dir(layout, suffix):
    resp = _client(layout).get(f"/api/v1/datasets/rich.zarr{suffix}")
    assert resp.status_code == 200, resp.get_data(as_text=True)
    assert "error" not in resp.get_json()


@pytest.mark.parametrize("suffix", SUFFIXES)
def test_missing_dataset_is_404(layout, suffix):
    resp = _client(layout).get(f"/api/v1/datasets/nope.zarr{suffix}")
    assert resp.status_code == 404 and resp.get_json()["reason"] == "not_found"


def test_existing_non_dataset_is_400(layout):
    (layout / "data" / "plain").mkdir()
    for suffix in ["", "/info", "/uns/structure"]:
        resp = _client(layout).get(f"/api/v1/datasets/plain{suffix}")
        assert resp.status_code == 400, (suffix, resp.get_data(as_text=True))


def test_segment_is_confined_when_hosted(layout):
    make_rich_store(layout / "outside.zarr")
    client = _client(layout, host="0.0.0.0")
    resp = client.get("/api/v1/datasets/../outside.zarr/info")
    assert resp.status_code in (403, 404)
    resp = client.get("/api/v1/datasets/..%2Foutside.zarr/info")
    assert resp.status_code == 403 and resp.get_json()["reason"] == "outside_data_dir"
    assert client.get("/api/v1/datasets/rich.zarr/info").status_code == 200
