"""dataset_structure said X was available, with a shape, for a store without X."""
import shutil

import zarr

from annzarro.core import zarr_reader
from annzarro.server.core import create_app
from annzarro.tests.server.rich_store import make_rich_store


def _client(tmp_path):
    zarr_reader.clear_cache()
    return create_app({"TESTING": True, "data_dir": str(tmp_path),
                       "log_file": str(tmp_path / "l.log")}).test_client()


def test_store_without_x(tmp_path):
    path = make_rich_store(tmp_path / "nox.zarr")
    shutil.rmtree(f"{path}/X")
    zarr.consolidate_metadata(path)
    client = _client(tmp_path)
    structure = client.get("/api/v1/data/dataset_structure", query_string={"dataset_path": path}).get_json()
    assert structure["X"]["available"] is False
    assert structure["n_obs"] == 200, "the shape still comes from obs/var"
    resp = client.get("/api/v1/data/X", query_string={"dataset_path": path, "cols": "0"})
    assert resp.status_code == 404 and resp.get_json()["reason"] == "key_not_found"
    zarr_reader.clear_cache()


def test_store_with_x(tmp_path):
    path = make_rich_store(tmp_path / "x.zarr")
    structure = _client(tmp_path).get("/api/v1/data/dataset_structure",
                                      query_string={"dataset_path": path}).get_json()
    assert structure["X"] == {"available": True, "shape": [200, 20]}
    zarr_reader.clear_cache()
