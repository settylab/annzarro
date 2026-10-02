"""Wire format of dataset slices: binary vectors, compact JSON, size guard,
ETag revalidation and gzip (``core/array_response.py``, ``server/http_cache.py``).
"""
import gzip
import json
import os

import numpy as np
import pytest
import scipy.sparse as sp
import zarr

from annzarro.server.core import create_app

N_OBS, N_VAR = 40, 6


def _array(group, name, values, chunks=None):
    z = group.create_array(name, shape=values.shape, dtype=values.dtype,
                           chunks=chunks or values.shape)
    z[:] = values
    z.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    return z


def _sparse(group, name, mat, encoding):
    g = group.create_group(name)
    g.attrs.update({"encoding-type": encoding, "encoding-version": "0.1.0",
                    "shape": list(mat.shape)})
    for comp in ("data", "indices", "indptr"):
        arr = getattr(mat, comp)
        group_arr = g.create_array(comp, shape=arr.shape, dtype=arr.dtype)
        group_arr[:] = arr
    return g


def _dataframe(group, name, index, columns):
    g = group.create_group(name)
    g.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0",
                    "_index": "_index", "column-order": list(columns)})
    idx = g.create_array("_index", shape=(len(index),), dtype=str)
    idx[:] = np.array(index)
    for col, values in columns.items():
        _array(g, col, values)
    return g


@pytest.fixture
def ds(tmp_path):
    rng = np.random.default_rng(3)
    path = str(tmp_path / "data" / "fast.zarr")
    root = zarr.open_group(path, mode="w", zarr_format=2)
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    X = rng.standard_normal((N_OBS, N_VAR)).astype(np.float32)
    X[0, 0] = 0.1
    X[1, 0] = np.nan
    _array(root, "X", X, chunks=(16, 4))
    layers = root.create_group("layers")
    counts = rng.integers(0, 5, size=(N_OBS, N_VAR)).astype(np.int32)
    _array(layers, "counts", counts)
    dense = np.zeros((N_OBS, N_OBS), dtype=np.float32)
    for i in range(N_OBS):
        nbrs = rng.choice(N_OBS, size=3, replace=False)
        dense[i, nbrs] = rng.random(3).astype(np.float32) + 0.01
    obsp = root.create_group("obsp")
    _sparse(obsp, "connectivities", sp.csr_matrix(dense), "csr_matrix")
    obsm = root.create_group("obsm")
    umap = rng.standard_normal((N_OBS, 2)).astype(np.float32)
    _array(obsm, "X_umap", umap)
    pvals = np.full(N_OBS, 1e-60)
    pvals[::2] = 0.5
    _dataframe(root, "obs", [f"c{i}" for i in range(N_OBS)],
               {"pval": pvals, "score": rng.random(N_OBS).astype(np.float32),
                "flag": np.arange(N_OBS) % 2 == 0})
    _dataframe(root, "var", [f"g{i}" for i in range(N_VAR)],
               {"mean": rng.random(N_VAR)})
    return {"path": path, "X": X, "counts": counts, "knn": dense, "umap": umap,
            "pvals": pvals, "tmp": tmp_path}


def _client(tmp_path, **extra):
    config = {"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"),
              "log_file": str(tmp_path / "t.log"), "auth_enabled": False}
    config.update(extra)
    return create_app(config).test_client()


@pytest.fixture
def client(ds):
    return _client(ds["tmp"])


def decode(resp):
    """Reference decoder for the binary protocol (mirrors data-manager.js)."""
    assert resp.mimetype == "application/octet-stream"
    shape = tuple(int(d) for d in resp.headers["X-Annzarro-Shape"].split(","))
    dtype = {"float32": "<f4", "float64": "<f8"}[resp.headers["X-Annzarro-Dtype"]]
    n = int(np.prod(shape))
    body = resp.data
    if resp.headers["X-Annzarro-Encoding"] == "sparse":
        nnz = int(resp.headers["X-Annzarro-Nnz"])
        width = np.dtype(dtype).itemsize
        assert len(body) == nnz * (width + 4)
        out = np.zeros(n, dtype)
        out[np.frombuffer(body[nnz * width:], "<u4")] = np.frombuffer(body[:nnz * width], dtype)
    else:
        assert len(body) == n * np.dtype(dtype).itemsize
        out = np.frombuffer(body, dtype)
    return out.reshape(shape)


def get(client, route, ds, **q):
    return client.get(f"/api/v1/data/{route}", query_string={"dataset_path": ds["path"], **q})


# --- binary --------------------------------------------------------------------

def test_gene_column_binary_is_float32_and_keeps_nan(client, ds):
    r = get(client, "X", ds, cols="0", format="f32")
    assert r.status_code == 200
    assert r.headers["X-Annzarro-Dtype"] == "float32"
    assert r.headers["X-Annzarro-Shape"] == f"{N_OBS},1"
    got = decode(r)
    np.testing.assert_array_equal(got[:, 0], ds["X"][:, 0])  # bit-exact, NaN included
    assert len(r.data) == N_OBS * 4


def test_cell_row_and_obsm_column_binary(client, ds):
    np.testing.assert_array_equal(decode(get(client, "X", ds, rows="3", format="f32"))[0], ds["X"][3])
    r = get(client, "obsm/X_umap", ds, column_name="1", format="f32")
    np.testing.assert_array_equal(decode(r), ds["umap"][:, 1])


def test_integer_layer_goes_as_exact_float32(client, ds):
    r = get(client, "layer/counts", ds, cols="2", format="f32")
    assert r.headers["X-Annzarro-Dtype"] == "float32"
    np.testing.assert_array_equal(decode(r)[:, 0], ds["counts"][:, 2])


def test_knn_row_is_sent_sparse(client, ds):
    r = get(client, "obsp/connectivities", ds, rows="5", format="f32")
    assert r.headers["X-Annzarro-Encoding"] == "sparse"
    assert int(r.headers["X-Annzarro-Nnz"]) == 3
    assert len(r.data) == 3 * 8  # vs 4 * N_OBS dense
    np.testing.assert_array_equal(decode(r)[0], ds["knn"][5])


def test_float64_that_float32_cannot_hold_stays_float64(client, ds):
    r = get(client, "obs", ds, columns="pval", format="f32")
    assert r.headers["X-Annzarro-Dtype"] == "float64"
    np.testing.assert_array_equal(decode(r), ds["pvals"])  # 1e-60 is not flushed to 0


def test_numeric_obs_column_binary_but_boolean_stays_json(client, ds):
    r = get(client, "obs", ds, columns="score", format="f32")
    assert r.headers["X-Annzarro-Dtype"] == "float32"
    assert decode(r).shape == (N_OBS,)
    r = get(client, "obs", ds, columns="flag", format="f32")
    assert r.mimetype == "application/json"
    assert r.get_json()["data"]["flag"][:2] == [True, False]


def test_missing_key_binary_is_empty(client, ds):
    r = get(client, "layer/nope", ds, cols="0", format="f32")
    assert r.status_code == 200
    assert decode(r).size == 0


# --- JSON ----------------------------------------------------------------------

def test_json_keeps_shape_and_writes_float32_shortest(client, ds):
    r = get(client, "X", ds, cols="0")
    assert r.mimetype == "application/json"
    text = r.get_data(as_text=True)
    assert "[[0.1],[null]," in text           # not 0.10000000149011612, not NaN
    body = json.loads(text)
    assert len(body["data"]) == N_OBS and all(len(row) == 1 for row in body["data"])
    assert body["dataset_path"] == ds["path"]
    got = np.array([np.nan if v[0] is None else v[0] for v in body["data"]], dtype=np.float32)
    np.testing.assert_array_equal(got, ds["X"][:, 0])  # shortest repr round-trips exactly


def test_json_obsp_row_matches_dense(client, ds):
    body = get(client, "obsp/connectivities", ds, rows="5").get_json()
    assert body["obsp_key"] == "connectivities"
    np.testing.assert_array_equal(np.array(body["data"], dtype=np.float32)[0], ds["knn"][5])


