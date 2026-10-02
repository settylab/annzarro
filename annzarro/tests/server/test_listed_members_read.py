"""
A member the dataset LISTS either reads or answers with a reason; it is never
served as ``200`` with an empty list.

- settylab/annzarro#41: ``get_obs_var`` caught every per-column exception and
  set the column to ``[]``, one frame above the swallow #31 removed, so its
  ``UnsupportedEncodingError`` never reached ``_reader_error_response``. Two
  obs columns of a served dataset (zarr groups with no ``encoding-type`` and one
  child) answered ``200, n=0``.
- settylab/annzarro#42: 15 obsm keys across 10 served datasets were listed by
  ``dataset_structure`` and then answered ``[]``: a sparse ``X_cnv`` and
  cell2location DataFrames reached ``_get_dense_array``, whose ``size == 0``
  test is true for any zarr group.

The store below reproduces each shape.
"""
import os

import numpy as np
import pytest
import scipy.sparse as sp
import zarr

from annzarro.core import zarr_reader
from annzarro.server.core import create_app
from annzarro.tests.server.rich_store import N_OBS, _encode, make_rich_store

DF_COLUMNS = ["meanscell_abundance_w_sf_B", "meanscell_abundance_w_sf_T"]
CNV = sp.random(N_OBS, 30, density=0.2, format="csr", dtype="float32", random_state=0)


def _sparse(parent, name, matrix, kind):
    g = parent.create_group(name)
    g.attrs.update({"encoding-type": kind, "encoding-version": "0.1.0",
                    "shape": list(matrix.shape)})
    g.create_array("data", data=matrix.data)
    g.create_array("indices", data=matrix.indices.astype("int32"))
    g.create_array("indptr", data=matrix.indptr.astype("int32"))


def _store(tmp_path):
    path = make_rich_store(tmp_path / "listed.zarr")
    root = zarr.open_group(path, mode="a")
    _sparse(root["obsm"], "X_cnv", CNV, "csr_matrix")
    _sparse(root["obsm"], "X_cnv_csc", CNV.tocsc(), "csc_matrix")
    df = root["obsm"].create_group("means_cell_abundance_w_sf")
    df.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0",
                     "_index": "_index", "column-order": DF_COLUMNS})
    _encode(df.create_array("_index", shape=(N_OBS,), dtype=str), "string-array")
    _encode(df.create_array(DF_COLUMNS[0], data=np.linspace(0, 1, N_OBS)), "array")
    _encode(df.create_array(DF_COLUMNS[1], data=np.linspace(1, 2, N_OBS)), "array")
    odd = root["obsm"].create_group("X_odd")
    odd.attrs.update({"encoding-type": "awkward-array"})
    odd.create_array("x", data=np.ones(N_OBS))
    # visiumHD 'Nucleus': a group with no encoding-type and a single child.
    root["obs"].create_group("Nucleus").create_array("Cell area ratio", data=np.ones(N_OBS))
    zarr.consolidate_metadata(path)
    return path


@pytest.fixture
def get(tmp_path):
    path = _store(tmp_path)
    zarr_reader.clear_cache()
    client = create_app({"TESTING": True, "data_dir": str(tmp_path),
                         "log_file": str(tmp_path / "l.log")}).test_client()

    def _get(url, **query):
        query.setdefault("dataset_path", path)
        return client.get(url, query_string=query)
    _get.path = path
    yield _get
    zarr_reader.clear_cache()


# --- #41 -------------------------------------------------------------------

def test_unreadable_obs_column_is_400_unsupported_type(get):
    resp = get("/api/v1/data/obs", columns="Nucleus")
    assert resp.status_code == 400, resp.get_data(as_text=True)
    body = resp.get_json()
    assert body["reason"] == "unsupported_type"
    assert "obs column 'Nucleus'" in body["error"]
    assert "Unsupported dataset type" not in body["error"], "the dataset is fine; one column is not"


def test_failed_obs_column_read_is_500_read_failed(get):
    # Corrupt the one chunk of a healthy numeric column: the read now raises.
    root = zarr.open_group(get.path, mode="r")
    col = next(c for c in root["obs"].keys()
               if hasattr(root["obs"][c], "dtype") and root["obs"][c].dtype.kind == "f")
    chunk_dir = os.path.join(get.path, "obs", col)
    chunks = [os.path.join(d, f) for d, _, fs in os.walk(chunk_dir) for f in fs
              if not f.startswith((".z", "zarr.json"))]
    assert chunks, f"no chunk files under {chunk_dir}"
    for c in chunks:
        with open(c, "wb") as fh:
            fh.write(b"not a chunk")
    zarr_reader.clear_cache()
    resp = get("/api/v1/data/obs", columns=col)
    assert resp.status_code == 500, resp.get_data(as_text=True)
    assert resp.get_json()["reason"] == "read_failed"


def test_listing_every_obs_column_names_the_unreadable_one(get):
    # No column named: one bad column must not sink the rest, but it is
    # reported, not passed off as legitimately empty.
    resp = get("/api/v1/data/obs")
    assert resp.status_code == 200, resp.get_data(as_text=True)
    body = resp.get_json()
    assert body["data"]["Nucleus"] == []
    assert body["errors"]["Nucleus"]["reason"] == "unsupported_type"
    assert len(body["data"]["leiden"]) == N_OBS
    assert "leiden" not in body["errors"]


def test_healthy_obs_column_unchanged(get):
    resp = get("/api/v1/data/obs", columns="leiden")
    assert resp.status_code == 200
    body = resp.get_json()
    assert len(body["data"]["leiden"]) == N_OBS
    assert "errors" not in body


# --- #42 -------------------------------------------------------------------

def test_listed_obsm_keys_are_listed(get):
    keys = get("/api/v1/data/dataset_structure").get_json()
    assert all(k in str(keys) for k in ("X_cnv", "means_cell_abundance_w_sf"))


@pytest.mark.parametrize("key", ["X_cnv", "X_cnv_csc"])
def test_sparse_obsm_column_reads(get, key):
    resp = get(f"/api/v1/data/obsm/{key}", column_name="3")
    assert resp.status_code == 200, resp.get_data(as_text=True)
    np.testing.assert_allclose(resp.get_json()["data"], CNV[:, 3].toarray().ravel(), rtol=1e-6)


def test_sparse_obsm_whole_and_by_cols(get):
    whole = get("/api/v1/data/obsm/X_cnv").get_json()["data"]
    assert np.asarray(whole).shape == (N_OBS, 30)
    two = get("/api/v1/data/obsm/X_cnv", cols="0,5").get_json()["data"]
    np.testing.assert_allclose(two, CNV[:, [0, 5]].toarray(), rtol=1e-6)


def test_dataframe_obsm_by_name_by_position_and_whole(get):
    url = "/api/v1/data/obsm/means_cell_abundance_w_sf"
    by_name = get(url, column_name=DF_COLUMNS[1]).get_json()["data"]
    by_position = get(url, column_name="1").get_json()["data"]
    np.testing.assert_allclose(by_name, np.linspace(1, 2, N_OBS))
    assert by_position == by_name
    whole = get(url).get_json()["data"]
    assert np.asarray(whole).shape == (N_OBS, 2)


@pytest.mark.parametrize("key,column", [
    ("means_cell_abundance_w_sf", "nope"),
    ("means_cell_abundance_w_sf", "7"),
    ("X_cnv", "30"),
    ("X_umap", "9"),
])
def test_missing_column_of_a_listed_key_is_404(get, key, column):
    resp = get(f"/api/v1/data/obsm/{key}", column_name=column)
    assert resp.status_code == 404, resp.get_data(as_text=True)
    assert resp.get_json()["reason"] == "key_not_found"


def test_unreadable_encoding_is_400_not_empty(get):
    resp = get("/api/v1/data/obsm/X_odd")
    assert resp.status_code == 400, resp.get_data(as_text=True)
    body = resp.get_json()
    assert body["reason"] == "unsupported_type"
    assert "X_odd" in body["error"] and "awkward-array" in body["error"]


def test_dense_obsm_column_unchanged(get):
    full = np.asarray(get("/api/v1/data/obsm/X_umap").get_json()["data"])
    col = get("/api/v1/data/obsm/X_umap", column_name="1").get_json()["data"]
    np.testing.assert_allclose(col, full[:, 1])
