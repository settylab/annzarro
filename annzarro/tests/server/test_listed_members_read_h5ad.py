"""The listed-members contract (#41, #42) for .h5ad: every test of
test_listed_members_read, run on the h5ad twin of the same store.

A member the dataset lists reads or answers with a reason (404 for a missing
column, 400 for an encoding the reader cannot read), never 200 []; a sparse
obsm is listed and read as a matrix; a DataFrame's _index is not a column.
"""
import pytest

from annzarro.tests.core.h5ad_twin import h5ad_twin
from annzarro.tests.server import test_listed_members_read as zarr_side
from annzarro.tests.server.test_listed_members_read import *  # noqa: F401,F403

# Corrupting a zarr chunk file has no h5ad counterpart.
del test_failed_obs_column_read_is_500_read_failed  # noqa: F821


@pytest.fixture
def get(tmp_path):
    from annzarro.server.core import create_app
    import annzarro.core as core

    path = h5ad_twin(zarr_side._store(tmp_path), tmp_path / "listed.h5ad")
    client = create_app({"TESTING": True, "data_dir": str(tmp_path),
                         "log_file": str(tmp_path / "l.log")}).test_client()

    def _get(url, **query):
        query.setdefault("dataset_path", path)
        return client.get(url, query_string=query)
    _get.path = path
    yield _get
    core.h5ad_reader_obj.clear_cache()


def test_obsm_listing_matches_zarr(get, tmp_path):
    """Same obsm keys, info and offered columns as the zarr store it twins."""
    zpath = zarr_side._store(tmp_path / "z")
    z = get("/api/v1/data/dataset_structure", dataset_path=zpath).get_json()["obsm"]
    h = get("/api/v1/data/dataset_structure").get_json()["obsm"]
    assert sorted(z["keys"]) == sorted(h["keys"])
    assert z["info"] == h["info"]
    offered = lambda o: {k: sorted(v["columns"]) for k, v in o["dataframes"].items()}  # noqa: E731
    assert offered(z) == offered(h)
    assert {k: v.get("sparse") for k, v in z["dataframes"].items()} == \
        {k: v.get("sparse") for k, v in h["dataframes"].items()}


def test_data_info_reads_h5ad(get, tmp_path):
    """/data/info answered 500 for every .h5ad: it opened the path with the
    zarr reader only. It now answers with the same summary as the zarr twin."""
    zpath = zarr_side._store(tmp_path / "z")
    r = get("/api/v1/data/info")
    assert r.status_code == 200, r.get_data(as_text=True)
    h = r.get_json()
    z = get("/api/v1/data/info", dataset_path=zpath).get_json()
    for key in ("shape", "n_obs", "n_vars", "has_obs", "has_var", "has_obsm"):
        assert h[key] == z[key], key
    assert sorted(h["obs_columns"]) == sorted(z["obs_columns"])
