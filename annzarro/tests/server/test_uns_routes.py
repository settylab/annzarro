"""Tests for the uns routes under /api/v1/datasets/<path>/uns.

Run the real routes and reader against stores written into a temp data dir.
These used to mock reader methods against a dataset that did not exist, which
the routes now refuse with 404 before reading anything.
"""
import numpy as np
import pytest

from annzarro.server.core import create_app
from annzarro.tests import zarr_compat


def _store(path, with_uns):
    root = zarr_compat.open_group(path)
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    zarr_compat.write_array(root, "X", np.zeros((3, 2), dtype=np.float32))
    for name, n in (("obs", 3), ("var", 2)):
        g = root.create_group(name)
        g.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0",
                        "_index": "_index", "column-order": []})
        zarr_compat.write_array(g, "_index", np.array([f"{name}{i}" for i in range(n)]))
    if with_uns:
        spatial = root.create_group("uns").create_group("spatial")
        zarr_compat.write_array(spatial.create_group("scalefactors"), "spot_diameter_fullres",
                                np.array(0.8))
        zarr_compat.write_array(spatial, "coords", np.arange(4, dtype=np.int64))


@pytest.fixture
def client(tmp_path):
    _store(str(tmp_path / "with_uns.zarr"), with_uns=True)
    _store(str(tmp_path / "no_uns.zarr"), with_uns=False)
    app = create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False,
                      "data_dir": str(tmp_path)})
    return app.test_client()


def test_get_uns_structure(client):
    response = client.get("/api/v1/datasets/with_uns.zarr/uns/structure")
    assert response.status_code == 200, response.get_json()
    data = response.get_json()
    assert data["dataset_path"].endswith("with_uns.zarr")
    assert "spatial" in data["uns_structure"]


def test_get_uns_data(client):
    response = client.get("/api/v1/datasets/with_uns.zarr/uns/spatial")
    assert response.status_code == 200, response.get_json()
    data = response.get_json()
    assert data["uns_key"] == "spatial"
    assert data["data"]["scalefactors"]["spot_diameter_fullres"] == pytest.approx(0.8)
    assert data["data"]["coords"] == [0, 1, 2, 3]


def test_get_uns_data_missing_key(client):
    response = client.get("/api/v1/datasets/with_uns.zarr/uns/missing_key")
    assert response.status_code == 404
    data = response.get_json()
    assert data["reason"] == "key_not_found"
    assert "missing_key" in data["error"]


def test_get_uns_data_no_uns(client):
    response = client.get("/api/v1/datasets/no_uns.zarr/uns/spatial")
    assert response.status_code == 404
    assert "does not have uns data" in response.get_json()["error"]
