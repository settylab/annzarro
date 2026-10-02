"""
A store rewritten in place without re-consolidating its metadata.

The server opens stores through .zmetadata. When an array was replaced
(anndata write_elem, zarr) and .zmetadata not regenerated, the read failed
inside the reader and the route answered 200 with "data": []. It now
answers 500 reason stale_metadata, naming the array and the fix.
"""
import numpy as np
import pytest
import zarr

from annzarro.core import zarr_reader
from annzarro.server.core import create_app
from annzarro.tests.server.rich_store import make_rich_store


def _rewrite(path, group, name, data):
    root = zarr.open_group(path, mode="a", use_consolidated=False)
    del root[group][name]
    root[group].create_array(name, data=data)   # .zmetadata left as it was


@pytest.fixture
def client(tmp_path):
    zarr_reader.clear_cache()
    yield create_app({"TESTING": True, "data_dir": str(tmp_path),
                      "log_file": str(tmp_path / "l.log")}).test_client()
    zarr_reader.clear_cache()


@pytest.mark.parametrize("group,name,data,url,query", [
    ("obsp", "conn", np.ones((200, 7), dtype="float32"), "/api/v1/data/obsp/conn", {"rows": "0,1"}),
    ("layers", "counts", np.ones((200, 20), dtype="float64"), "/api/v1/data/layer/counts",
     {"rows": "0", "cols": "0,1"}),
    ("obsm", "X_umap", np.ones((200, 5), dtype="float64"), "/api/v1/data/obsm/X_umap", {"rows": "0"}),
])
def test_stale_consolidated_metadata_is_reported(tmp_path, client, group, name, data, url, query):
    path = make_rich_store(tmp_path / "stale.zarr")
    _rewrite(path, group, name, data)
    resp = client.get(url, query_string=dict(query, dataset_path=path))
    assert resp.status_code == 500, resp.get_data(as_text=True)
    body = resp.get_json()
    assert body["reason"] == "stale_metadata"
    assert f"{group}/{name}" in body["error"] and "consolidate_metadata" in body["error"]


def test_reconsolidated_store_reads_again(tmp_path, client):
    path = make_rich_store(tmp_path / "fixed.zarr")
    _rewrite(path, "obsp", "conn", np.full((200, 200), 2, dtype="float32"))
    zarr.consolidate_metadata(path)
    resp = client.get("/api/v1/data/obsp/conn", query_string={"dataset_path": path, "rows": "0", "cols": "0"})
    assert resp.status_code == 200 and resp.get_json()["data"] == [[2.0]]
