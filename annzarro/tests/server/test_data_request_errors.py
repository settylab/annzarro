"""
A request the dataset cannot answer gets an error, not 200 with empty data.

A missing layer/obsm/varm/obsp/varp/uns key, an unknown obs/var column or an
index past the end of an axis all used to come back as ``200 {"data": []}``
(or ``{}``), indistinguishable from a slot that is really empty. Now: 404
``key_not_found`` and 400 ``index_out_of_range``.
"""
import logging

import pytest

from annzarro.core import zarr_reader
from annzarro.server.core import create_app
from annzarro.tests.server.rich_store import N_OBS, N_VAR, make_rich_store


@pytest.fixture
def get(tmp_path):
    path = make_rich_store(tmp_path / "rich.zarr")
    zarr_reader.clear_cache()
    client = create_app({"TESTING": True, "data_dir": str(tmp_path),
                         "log_file": str(tmp_path / "l.log")}).test_client()

    def _get(url, **query):
        query.setdefault("dataset_path", path)
        return client.get(url, query_string=query)
    yield _get
    zarr_reader.clear_cache()


@pytest.mark.parametrize("url,query", [
    ("/api/v1/data/layer/nope", {"cols": "1"}),
    ("/api/v1/data/obsm/nope", {}),
    ("/api/v1/data/varm/nope", {}),
    ("/api/v1/data/obsp/nope", {"rows": "1"}),
    ("/api/v1/data/varp/nope", {}),
    ("/api/v1/data/uns/nope", {}),
    ("/api/v1/data/obs", {"columns": "nope"}),
    ("/api/v1/data/var", {"columns": "gene_name,nope"}),
])
def test_missing_key_is_404(get, url, query):
    resp = get(url, **query)
    assert resp.status_code == 404, resp.get_data(as_text=True)
    assert resp.get_json()["reason"] == "key_not_found"


@pytest.mark.parametrize("url,query", [
    ("/api/v1/data/X", {"cols": "99999999"}),
    ("/api/v1/data/X", {"rows": str(N_OBS)}),
    ("/api/v1/data/layer/counts", {"cols": str(N_VAR)}),
    ("/api/v1/data/obs", {"rows": "500", "columns": "leiden"}),
    ("/api/v1/data/var", {"cols": str(N_VAR)}),
    ("/api/v1/data/obsm/X_umap", {"rows": "0", "cols": "2"}),
    ("/api/v1/data/obsp/conn", {"rows": "0", "cols": str(N_OBS)}),
    ("/api/v1/data/varp/corr", {"rows": str(N_VAR)}),
])
def test_index_past_the_end_is_400(get, url, query):
    resp = get(url, **query)
    assert resp.status_code == 400, resp.get_data(as_text=True)
    assert resp.get_json()["reason"] == "index_out_of_range"


@pytest.mark.parametrize("url,query", [
    ("/api/v1/data/X", {"rows": "0,1", "cols": "0"}),
    ("/api/v1/data/X", {"cols": str(N_VAR - 1)}),
    ("/api/v1/data/layer/counts", {"rows": "1", "cols": "0"}),
    ("/api/v1/data/obs", {"rows": str(N_OBS - 1), "columns": "leiden"}),
    ("/api/v1/data/var", {"columns": "gene_name"}),
    ("/api/v1/data/obsm/X_umap", {"rows": "0", "cols": "1"}),
    ("/api/v1/data/obsp/conn", {"rows": "1", "cols": "1"}),
    ("/api/v1/data/varp/corr", {"rows": "2"}),
])
def test_valid_requests_still_answer(get, url, query):
    resp = get(url, **query)
    assert resp.status_code == 200, resp.get_data(as_text=True)
    assert resp.get_json()["data"] not in ([], {}, None)


def test_values_are_right(get):
    assert get("/api/v1/data/layer/counts", rows="0,1", cols="0").get_json()["data"] == [[0.0], [20.0]]
    assert get("/api/v1/data/obsp/conn", rows="3", cols="3,4").get_json()["data"] == [[1.0, 0.0]]


def test_unparseable_indices_are_400_not_the_whole_axis(get):
    resp = get("/api/v1/data/X", cols="abc")
    assert resp.status_code == 400 and resp.get_json()["reason"] == "bad_indices"


def test_json_index_lists_still_parse(get):
    assert get("/api/v1/data/X", rows="[0,1]", cols="[0]").status_code == 200


@pytest.mark.parametrize("url,query", [
    ("/api/v1/data/obsp/conn", {"rows": "-1", "cols": "0,1"}),
    ("/api/v1/data/X", {"cols": "-1"}),
    ("/api/v1/data/obs", {"rows": "0,-2", "columns": "leiden"}),
    ("/api/v1/data/X", {"rows": "[-1]"}),
])
def test_negative_indices_are_refused_not_wrapped(get, url, query):
    """numpy indexing wrapped -1 to the last row and answered 200."""
    resp = get(url, **query)
    assert resp.status_code == 400 and resp.get_json()["reason"] == "bad_indices"
