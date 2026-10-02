"""
zarr format 3 stores must either read correctly or fail with a reason.

A format 3 store (``zarr.json`` in every node, no ``.zgroup``) used to be
rejected by ``_get_root``'s marker check, whose ValueError the reader's broad
fallback swallowed into ``None``. Every data route then answered ``200`` with
``"data": {}`` -- under zarr 2 AND under zarr 3, which can read the format
perfectly well. Measured on the fixture pair below before the change:
``/data/obs`` -> ``200 {"data": {}}`` and ``/data/obsm/X_umap`` ->
``200 {"data": []}`` on both library versions.

Now: under zarr >= 3 the store reads exactly like its format 2 twin; under
zarr 2 every route and the dataset listing say what the store is and how to
rewrite it.

``fixture_small_v3.zarr`` is ``fixture_small.zarr`` rewritten by
``annzarro/tests/utils/make_fixture_zarr_v3.py`` (needs zarr >= 3).
"""
import os

import pytest
import zarr

from annzarro.core.zarr_reader import ZARR_LIBRARY_MAJOR, zarr_format_problem
from annzarro.server.core import create_app
from annzarro.server.routes import data_routes

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
V2 = os.path.join(DATA, "fixture_small.zarr")
V3 = os.path.join(DATA, "fixture_small_v3.zarr")

ROUTES = [
    "/api/v1/data/obs?dataset_path={p}&columns=total_counts,cell_type&rows=0,1,2",
    "/api/v1/data/var?dataset_path={p}&columns=gene_name",
    "/api/v1/data/obsm/X_umap?dataset_path={p}&rows=0,1,2",
    "/api/v1/data/X?dataset_path={p}&cols=3",
]


@pytest.fixture
def client():
    getattr(data_routes, "_LISTING_PROBE_CACHE", {}).clear()
    app = create_app({"TESTING": True, "DEBUG": False, "data_dir": DATA})
    yield app.test_client()
    getattr(data_routes, "_LISTING_PROBE_CACHE", {}).clear()


def test_fixture_is_really_format_3():
    assert os.path.exists(os.path.join(V3, "zarr.json"))
    assert not os.path.exists(os.path.join(V3, ".zgroup"))


def test_format_2_store_is_never_flagged():
    assert zarr_format_problem(V2) is None


@pytest.mark.skipif(ZARR_LIBRARY_MAJOR < 3, reason="needs zarr>=3 to read format 3")
@pytest.mark.parametrize("route", ROUTES)
def test_format_3_reads_like_its_format_2_twin(client, route):
    assert zarr_format_problem(V3) is None
    v2 = client.get(route.format(p=V2))
    v3 = client.get(route.format(p=V3))
    assert v2.status_code == 200, v2.get_data(as_text=True)
    assert v3.status_code == 200, v3.get_data(as_text=True)
    body2, body3 = v2.get_json(), v3.get_json()
    body2.pop("dataset_path", None)
    body3.pop("dataset_path", None)
    assert body3 == body2
    assert body3["data"], "an empty body is the defect this test exists for"


@pytest.mark.skipif(ZARR_LIBRARY_MAJOR >= 3, reason="zarr>=3 reads format 3")
@pytest.mark.parametrize("route", ROUTES)
def test_format_3_under_zarr_2_is_an_error_that_says_why(client, route):
    resp = client.get(route.format(p=V3))
    assert resp.status_code != 200, "served as data: " + resp.get_data(as_text=True)
    error = resp.get_json()["error"]
    assert "zarr format 3" in error
    assert "ad.settings.zarr_write_format = 2" in error


@pytest.mark.skipif(ZARR_LIBRARY_MAJOR >= 3, reason="zarr>=3 reads format 3")
def test_format_3_under_zarr_2_is_listed_with_its_reason(client):
    listing = {d["name"]: d for d in client.get("/api/v1/datasets").get_json()}
    entry = listing["fixture_small_v3.zarr"]
    assert entry["cells"] is None and entry["genes"] is None
    assert "zarr format 3" in entry["error"]
    assert listing["fixture_small.zarr"]["cells"] == 200


@pytest.mark.skipif(ZARR_LIBRARY_MAJOR < 3, reason="needs zarr>=3 to read format 3")
def test_format_3_under_zarr_3_is_listed_with_counts(client):
    listing = {d["name"]: d for d in client.get("/api/v1/datasets").get_json()}
    assert listing["fixture_small_v3.zarr"]["cells"] == 200
    assert listing["fixture_small_v3.zarr"]["genes"] == 20
    assert "error" not in listing["fixture_small_v3.zarr"]


def test_library_major_matches_installed_zarr():
    assert ZARR_LIBRARY_MAJOR == int(zarr.__version__.split(".")[0])
