"""
/data/uns returns uns values as plain JSON.

0-d arrays (how anndata stores scalars) came back as null, members of a
dict as the zarr Array repr ("<Array file://... shape=() dtype=...>"), and a
missing key as 200 {"data": null}.
"""
import pytest

from annzarro.core import zarr_reader
from annzarro.server.core import create_app
from annzarro.tests.server.rich_store import make_rich_store


@pytest.fixture
def uns(tmp_path):
    path = make_rich_store(tmp_path / "rich.zarr")
    zarr_reader.clear_cache()
    client = create_app({"TESTING": True, "data_dir": str(tmp_path),
                         "log_file": str(tmp_path / "l.log")}).test_client()

    def _get(key, route="data"):
        if route == "data":
            return client.get(f"/api/v1/data/uns/{key}", query_string={"dataset_path": path})
        return client.get(f"/api/v1/datasets/uns/{key}", query_string={"dataset_path": path})
    yield _get
    zarr_reader.clear_cache()


@pytest.mark.parametrize("key,value", [
    ("title", "hello"),
    ("run", {"n": 7, "when": "2026-10-02"}),
    ("run/n", 7),
    ("run/when", "2026-10-02"),
    ("vec", [1.0, 2.0, 3.0]),
    ("names", ["a", "b"]),
])
def test_values_decode(uns, key, value):
    resp = uns(key)
    assert resp.status_code == 200
    assert resp.get_json()["data"] == value


@pytest.mark.parametrize("key", ["nope", "run/nope", "title/deeper"])
@pytest.mark.parametrize("route", ["data", "datasets"])
def test_missing_key_is_404(uns, key, route):
    resp = uns(key, route)
    assert resp.status_code == 404 and resp.get_json()["reason"] == "key_not_found"
