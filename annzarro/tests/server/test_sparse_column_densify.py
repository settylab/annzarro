"""A gene column of a sparse X or layer is densified by scatter, with the same bytes.

At 95.6M cells a CSC gene column took 0.45 s on the server, of which scipy's
toarray (CSC converted to CSR first, then filled) was 0.24 s. A few stored
columns (CSC) or rows (CSR) are now written into a zero array directly
(zarr_reader.densify). What must hold: the client receives exactly the bytes
it did through toarray, for CSC and CSR, float32 and float64, a column with
no stored values, with and without a cell subset; and densify equals toarray
for any matrix, including duplicate or unsorted entries it leaves to scipy.
"""
import json
import sys

import numpy as np
import pytest
import scipy.sparse as sp

from annzarro.core import subset as cell_subset
from annzarro.core import zarr_reader
from annzarro.server.core import create_app
from annzarro.tests.zarr_compat import open_group, write_array, write_strings

ZR = sys.modules["annzarro.core.zarr_reader"]
N_OBS, N_VAR = 4000, 12


def _sparse_group(parent, name, m, fmt):
    g = parent.create_group(name)
    g.attrs.update({"encoding-type": fmt, "encoding-version": "0.1.0", "shape": list(m.shape)})
    write_array(g, "data", m.data)
    write_array(g, "indices", m.indices.astype(np.int32))
    write_array(g, "indptr", m.indptr.astype(np.int64))
    return g


@pytest.fixture
def store(tmp_path):
    zarr_reader.clear_cache()
    cell_subset.clear()
    rng = np.random.default_rng(0)
    dense = rng.random((N_OBS, N_VAR)) * (rng.random((N_OBS, N_VAR)) < 0.2)
    dense[:, 5] = 0.0                                 # a gene with no stored value
    data = tmp_path / "data"
    data.mkdir()
    path = str(data / "s.zarr")
    root = open_group(path)
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    _sparse_group(root, "X", sp.csc_matrix(dense.astype(np.float32)), "csc_matrix")
    layers = root.create_group("layers")
    _sparse_group(layers, "csr32", sp.csr_matrix(dense.astype(np.float32)), "csr_matrix")
    _sparse_group(layers, "csc64", sp.csc_matrix(dense * np.pi), "csc_matrix")
    _sparse_group(layers, "csr64", sp.csr_matrix(dense * np.pi), "csr_matrix")
    for name, n in (("obs", N_OBS), ("var", N_VAR)):
        g = root.create_group(name)
        g.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0", "_index": "_index",
                        "column-order": []})
        write_strings(g, "_index", [f"{name}{i}" for i in range(n)])
    client = create_app({"TESTING": True, "data_dir": str(data), "log_file": str(tmp_path / "t.log"),
                         "auth_enabled": False}).test_client()
    yield client, path
    zarr_reader.clear_cache()
    cell_subset.clear()


def _get(client, url, q):
    r = client.get(url, query_string=q)
    return r.status_code, {k: v for k, v in r.headers.items() if k.lower().startswith("x-")}, r.get_data()


REQUESTS = [("/api/v1/data/X", {"cols": c}) for c in ("0", "5", "0,3,5")]
REQUESTS += [(f"/api/v1/data/layer/{layer}", {"cols": c}) for layer in ("X", "csr32", "csc64", "csr64")
             for c in ("2", "5")]
REQUESTS += [("/api/v1/data/X", {"rows": "7"}), ("/api/v1/data/layer/csr32", {"rows": "7,8"})]


@pytest.mark.parametrize("subset", [None, {"n": 700, "seed": 4}], ids=["all", "subset"])
def test_the_bytes_are_those_of_toarray(store, monkeypatch, subset):
    client, path = store
    def run():
        out = {}
        for url, q in REQUESTS:
            params = {"dataset_path": path, "format": "f32", **q}
            if subset:
                params["subset"] = json.dumps(subset)
            out[(url, tuple(q.items()))] = _get(client, url, params)
        return out
    fast = run()
    monkeypatch.setattr(ZR, "densify", lambda m: m.toarray())
    monkeypatch.setattr(sys.modules["annzarro.core.h5ad_reader"], "densify", lambda m: m.toarray())
    zarr_reader.clear_cache()
    slow = run()
    for key, (status, headers, body) in fast.items():
        assert status == 200, (key, body[:200])
        assert (status, headers, body) == slow[key], key
    empty = fast[("/api/v1/data/layer/csr32", (("cols", "5"),))]
    assert empty[1].get("X-Annzarro-Encoding") == "sparse" and empty[1].get("X-Annzarro-Nnz") == "0"


@pytest.mark.parametrize("fmt", ["csc", "csr"])
@pytest.mark.parametrize("dtype", [np.float32, np.float64, np.int32])
def test_densify_equals_toarray(fmt, dtype):
    rng = np.random.default_rng(1)
    for major in (1, 3, ZR.SCATTER_MAX_MAJOR + 1):
        shape = (500, major) if fmt == "csc" else (major, 500)
        m = sp.random(*shape, density=0.1, format=fmt, random_state=2, dtype=np.float64)
        m = m.astype(dtype)
        assert np.array_equal(ZR.densify(m), m.toarray())
        assert ZR.densify(m).dtype == m.toarray().dtype
    # duplicate and unsorted entries: toarray sums them, and densify gives the same
    data = np.array([1, 2, 3], dtype=dtype)
    idx = np.array([4, 1, 4])
    ptr = np.array([0, 3])
    m = (sp.csc_matrix((data, idx, ptr), shape=(6, 1)) if fmt == "csc"
         else sp.csr_matrix((data, idx, ptr), shape=(1, 6)))
    assert np.array_equal(ZR.densify(m), m.toarray())
    # an empty column / row
    m = sp.csc_matrix((5, 1), dtype=dtype) if fmt == "csc" else sp.csr_matrix((1, 5), dtype=dtype)
    assert np.array_equal(ZR.densify(m), m.toarray())
