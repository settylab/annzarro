"""
A relative dataset_path names a dataset in the data directory.

A share link with ``?dataset_path=bm_aging_showcase.zarr`` (no directory)
opened nothing: the path was resolved against the server's working
directory and /data/info answered 500. Now a relative path that exists under
data_dir is read from there, also on a hosted server (where confinement then
sees the absolute path inside data_dir).
"""
import os
import shutil

import pytest

from annzarro.server.core import create_app

FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr"
)


@pytest.fixture
def data_dir(tmp_path):
    d = tmp_path / "data"
    d.mkdir()
    shutil.copytree(FIXTURE, d / "showcase.zarr")
    return d


@pytest.mark.parametrize("hosted", [False, True])
def test_relative_path_reads_from_data_dir(data_dir, tmp_path, monkeypatch, hosted):
    monkeypatch.chdir(tmp_path)   # the working directory has no showcase.zarr
    cfg = {"TESTING": True, "DEBUG": False, "auth_enabled": False, "data_dir": str(data_dir)}
    if hosted:
        cfg["hosted"] = True
    client = create_app(cfg).test_client()
    resp = client.get("/api/v1/data/info", query_string={"dataset_path": "showcase.zarr"})
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["n_obs"] == 200
    names = client.get("/api/v1/data/names", query_string={"dataset_path": "showcase.zarr", "q": "cell_0001"})
    assert names.status_code == 200 and names.get_json()["matches"][0]["name"] == "cell_0001"


def test_a_missing_relative_path_still_says_not_found(data_dir, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    client = create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False,
                         "data_dir": str(data_dir)}).test_client()
    resp = client.get("/api/v1/data/cells", query_string={"dataset_path": "nope.zarr"})
    assert resp.status_code == 404


def test_relative_path_cannot_escape_on_a_hosted_server(data_dir, tmp_path, monkeypatch):
    outside = tmp_path / "outside.zarr"
    shutil.copytree(FIXTURE, outside)
    monkeypatch.chdir(data_dir)
    client = create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False, "hosted": True,
                         "data_dir": str(data_dir)}).test_client()
    resp = client.get("/api/v1/data/info", query_string={"dataset_path": "../outside.zarr"})
    assert resp.status_code == 403
