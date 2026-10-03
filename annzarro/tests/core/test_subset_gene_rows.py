"""A subset's gene column reads only the subset's rows of a sparse column.

On a 50-million-cell CSC store every gene of the 100,000-cell subset was read
as the whole 50-million-row column (200 MB dense, then cached), and cut to the
subset afterwards. Now the column's stored entries are scanned a block at a
time and only the subset's rows are kept. The result must be what slicing the
full matrix gives, for CSC and CSR, any row order and repeats.
"""
import json

import numpy as np
import pytest
import scipy.sparse as sp

from annzarro.core import subset as cell_subset
from annzarro.core import zarr_reader
from annzarro.core.zarr_reader import ZarrReader
from annzarro.server.core import create_app
from annzarro.tests.zarr_compat import open_group, write_array, write_strings

N_OBS, N_VAR = 5000, 7


def _matrix():
    rng = np.random.default_rng(0)
    m = sp.random(N_OBS, N_VAR, density=0.3, format="csc", dtype=np.float32, random_state=rng)
    m.data[:] = rng.integers(1, 100, m.nnz)
    return m


def _write(group, name, mat, fmt):
    m = mat.asformat(fmt)
    g = group.create_group(name)
    g.attrs.update({"encoding-type": f"{fmt}_matrix", "encoding-version": "0.1.0", "shape": list(m.shape)})
    for comp in ("data", "indices", "indptr"):
        write_array(g, comp, getattr(m, comp), chunks=(97,))
    return g


@pytest.mark.parametrize("fmt", ["csc", "csr"])
def test_rows_of_columns_equal_slicing_the_full_matrix(tmp_path, fmt, monkeypatch):
    mat = _matrix()
    g = open_group(tmp_path / "m.zarr")
    _write(g, "X", mat, fmt)
    reader = ZarrReader(enable_caching=False)
    monkeypatch.setattr(ZarrReader, "_SELECT_BLOCK", 53)       # many blocks per column
    rng = np.random.default_rng(1)
    shape = (N_OBS, N_VAR)
    dense = mat.toarray()
    for rows in (np.sort(rng.choice(N_OBS, 700, replace=False)), rng.integers(0, N_OBS, 300),
                 np.array([0, N_OBS - 1, 0]), np.array([], dtype=int)):
        for cols in ([3], [6, 0, 6]):
            if fmt == "csc":    # columns are the compressed axis
                got = reader._rows_of_major_slices(g["X"], shape, cols, rows, axis="col")
            else:               # rows are: the same call with the axes swapped
                got = reader._rows_of_major_slices(g["X"], shape, list(rows), cols, axis="row")
            want = dense[np.ix_(rows, cols)]
            assert got.shape == want.shape
            assert np.array_equal(got.toarray(), want)
    with pytest.raises(IndexError):
        reader._rows_of_major_slices(g["X"], shape, [0], [N_OBS], axis="col")


@pytest.fixture
def client(tmp_path):
    path = str(tmp_path / "data" / "csc.zarr")
    root = open_group(path)
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    for name, names in (("obs", [f"c{i}" for i in range(N_OBS)]), ("var", [f"g{i}" for i in range(N_VAR)])):
        grp = root.create_group(name)
        grp.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0",
                          "_index": "_index", "column-order": []})
        write_strings(grp, "_index", names)
    _write(root, "X", _matrix(), "csc")
    zarr_reader.clear_cache()
    cell_subset.clear()
    app = create_app({"TESTING": True, "data_dir": str(tmp_path / "data"),
                      "log_file": str(tmp_path / "t.log"), "auth_enabled": False})
    yield app.test_client(), path
    zarr_reader.clear_cache()
    cell_subset.clear()


def test_subset_gene_column_does_not_build_the_whole_column(client, monkeypatch):
    test_client, path = client
    spec = json.dumps({"n": 400, "seed": 2})
    full = np.array(test_client.get("/api/v1/data/X", query_string={
        "dataset_path": path, "cols": "4"}).get_json()["data"]).ravel()
    rows, _ = cell_subset.select_indices(N_OBS, cell_subset.parse_spec(spec), None)

    def whole_column(*a, **k):
        raise AssertionError("built the whole column for a subset")
    monkeypatch.setattr(ZarrReader, "_lazy_sparse_slice", whole_column)
    for fmt in ({}, {"format": "f32"}):
        resp = test_client.get("/api/v1/data/X", query_string={
            "dataset_path": path, "cols": "4", "subset": spec, **fmt})
        assert resp.status_code == 200, resp.get_data(as_text=True)
        if fmt:
            got = np.frombuffer(resp.data, dtype="<f4") if resp.headers["X-Annzarro-Encoding"] == "dense" else None
            if got is None:
                nnz = int(resp.headers["X-Annzarro-Nnz"])
                vals = np.frombuffer(resp.data, "<f4", nnz)
                pos = np.frombuffer(resp.data, "<u4", nnz, offset=4 * nnz)
                got = np.zeros(len(rows), np.float32)
                got[pos] = vals
        else:
            got = np.array(resp.get_json()["data"]).ravel()
        assert got.tolist() == full[rows].tolist()
