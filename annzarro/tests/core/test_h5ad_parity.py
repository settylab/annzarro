""".h5ad answers every data route as the same dataset in zarr does (#4).

The h5ad twin of a zarr store (same tree, written with h5py) is asked what
the frontend asks, and the bodies must be identical. Then the h5ad reader's
own machinery: partial sparse reads along both axes against scipy, the
bounded scan behind a gene column of a CSR matrix, selections in any order
with repeats (h5py's point selection refuses those), and the column
encodings anndata writes to h5ad.
"""
import h5py
import numpy as np
import pytest
import scipy.sparse as sp

from annzarro.core import h5ad_reader as hr
from annzarro.core.h5ad_reader import h5adReader
from annzarro.tests.core.h5ad_twin import h5ad_twin
from annzarro.tests.core.test_process_file_cache import _add_sparse
from annzarro.tests.server.rich_store import make_rich_store


# --------------------------------------------------------------------------
# route parity on twin stores
# --------------------------------------------------------------------------

@pytest.fixture(scope="module")
def twins(tmp_path_factory):
    d = tmp_path_factory.mktemp("twins")
    zpath = make_rich_store(d / "rich.zarr")
    _add_sparse(zpath)
    return zpath, h5ad_twin(zpath, d / "rich.h5ad")


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    from annzarro.server.core import create_app
    d = tmp_path_factory.mktemp("app")
    app = create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(d),
                      "log_file": str(d / "t.log"), "auth_enabled": False})
    return app.test_client()


ROUTES = [
    ("cells", {}), ("genes", {}),
    ("names", {"entity": "genes", "q": "gene_1"}),
    ("obs", {"columns": "leiden"}), ("obs", {"columns": "total_counts", "rows": "9,2,2,0"}),
    ("obs", {}), ("var", {"columns": "gene_name", "cols": "3,1"}),
    ("obsm/X_umap", {}), ("obsm/X_umap", {"column_name": "1"}),
    ("obsm/X_umap", {"rows": "5,1,5", "cols": "1,0"}), ("obsm/X_umap", {"cols": "0"}),
    ("varm/PCs", {"column_name": "0"}), ("varm/PCs", {"rows": "4"}),
    ("X", {"cols": "4"}), ("X", {"rows": "7"}), ("X", {"cols": "4,1,4"}),
    ("X", {"rows": "9,3,9", "cols": "2,0"}), ("X", {"rows": "199,0"}),
    ("layer/X", {"cols": "4"}),
    ("layer/counts", {"cols": "2"}), ("layer/counts", {"rows": "150,3,150"}),
    ("layer/counts", {"rows": "1,2", "cols": "19,0"}),
    ("obsp/knn", {"rows": "9"}), ("obsp/knn", {"rows": "9,1,9", "cols": "12,10"}),
    ("obsp/conn", {"rows": "9"}), ("varp/corr", {"rows": "3,0"}),
    ("uns/run", {}), ("uns/run/n", {}), ("uns/title", {}), ("uns/vec", {}), ("uns/names", {}),
    # refusals must agree too
    ("uns/nope", {}), ("layer/nope", {"cols": "0"}), ("X", {"cols": "20"}),
    ("obs", {"columns": "nope"}),
]


@pytest.mark.parametrize("route,query", ROUTES, ids=[f"{r}?{q}" for r, q in ROUTES])
def test_route_answers_match_zarr(twins, client, route, query):
    zpath, hpath = twins
    z = client.get(f"/api/v1/data/{route}", query_string=dict(query, dataset_path=zpath))
    h = client.get(f"/api/v1/data/{route}", query_string=dict(query, dataset_path=hpath))
    assert z.status_code == h.status_code, (z.get_json(), h.get_json())
    zb, hb = z.get_json(), h.get_json()
    for body in (zb, hb):
        body.pop("dataset_path", None)
    assert zb == hb


def test_dataset_structure_matches_zarr(twins, client):
    zpath, hpath = twins
    z, h = (client.get("/api/v1/data/dataset_structure", query_string={"dataset_path": p}).get_json()
            for p in twins)

    def canon(x):
        if isinstance(x, dict):
            if x.get("type") in ("object", "StringDType()") or str(x.get("type")).startswith("<U"):
                x = dict(x, type="string")  # how a string dtype prints depends on the library
            return {k: canon(v) for k, v in x.items() if k not in ("path", "name")}
        if isinstance(x, list) and all(isinstance(v, str) for v in x):
            return sorted(x)  # h5py lists members by name, zarr by store listing
        return x
    assert canon(z) == canon(h)


# --------------------------------------------------------------------------
# sparse selections, against scipy
# --------------------------------------------------------------------------

def _write_sparse(f, name, m):
    g = f.create_group(name)
    g.attrs["encoding-type"] = "csr_matrix" if sp.isspmatrix_csr(m) else "csc_matrix"
    g.attrs["shape"] = m.shape
    for part in ("data", "indices", "indptr"):
        g.create_dataset(part, data=getattr(m, part), maxshape=(None,))
    return g


@pytest.fixture
def sparse_file(tmp_path):
    rng = np.random.default_rng(0)
    dense = rng.random((40, 30)).astype(np.float32)
    dense[dense < 0.7] = 0
    dense[:, 5] = 0  # an empty column
    dense[6] = 0     # an empty row
    path = tmp_path / "s.h5ad"
    with h5py.File(path, "w") as f:
        _write_sparse(f, "csr", sp.csr_matrix(dense))
        _write_sparse(f, "csc", sp.csc_matrix(dense))
        f.create_dataset("dense", data=dense)
    return path, dense


SELECTIONS = [
    (None, None), ([3], None), (None, [7]), ([6], None), (None, [5]),
    ([9, 2, 9, 0], None), (None, [29, 1, 1, 14]), ([4, 1, 4], [3, 0, 3]),
    (list(range(40)), None), (None, list(range(29, -1, -1))), ([], None), (None, []),
]


@pytest.mark.parametrize("fmt", ["csr", "csc", "dense"])
@pytest.mark.parametrize("rows,cols", SELECTIONS)
@pytest.mark.parametrize("block,gap,span", [(7, 0, 0), (1 << 22, 1 << 16, 8 << 20)])
def test_selection_matches_full_matrix(sparse_file, monkeypatch, fmt, rows, cols, block, gap, span):
    """Tiny blocks and gaps force the multi-block scan and per-range reads;
    a zero span forces h5py point selection on dense data."""
    monkeypatch.setattr(hr, "_SCAN_BLOCK", block)
    monkeypatch.setattr(hr, "_COALESCE_GAP", gap)
    monkeypatch.setattr(hr, "_SPAN_BYTES", span)
    path, dense = sparse_file
    expected = dense
    if rows is not None:
        expected = expected[rows, :]
    if cols is not None:
        expected = expected[:, cols]
    with h5py.File(path, "r") as f:
        got = hr._matrix(f[fmt], rows, cols)
    assert got.shape == expected.shape
    np.testing.assert_array_equal(got, expected)


def test_out_of_range_is_refused(sparse_file):
    path, _ = sparse_file
    with h5py.File(path, "r") as f:
        for fmt in ("csr", "csc", "dense"):
            for rows, cols in (([40], None), (None, [30]), ([0], [30]), ([-1], None)):
                with pytest.raises(IndexError):
                    hr._matrix(f[fmt], rows, cols)


@pytest.fixture
def reads(monkeypatch):
    """(dataset name, elements) for every read from an h5py Dataset."""
    log = []
    real = h5py.Dataset.__getitem__

    def recording(self, sel):
        out = real(self, sel)
        log.append((self.name.rsplit("/", 1)[-1], int(np.size(out))))
        return out

    monkeypatch.setattr(h5py.Dataset, "__getitem__", recording)
    return log


def test_major_axis_reads_only_the_selected_ranges(sparse_file, reads):
    """A gene column of a CSC matrix (a cell row of CSR) reads its own
    entries and indptr: never the whole data array."""
    path, dense = sparse_file
    with h5py.File(path, "r") as f:
        hr._matrix(f["csc"], None, [7])
        hr._matrix(f["csr"], [3], None)
    data_reads = [n for name, n in reads if name == "data"]
    assert data_reads == [np.count_nonzero(dense[:, 7]), np.count_nonzero(dense[3])]


def test_minor_axis_scan_is_bounded(sparse_file, reads, monkeypatch):
    """A gene column of a CSR matrix has to look at every stored index, but
    never more than one block at a time (it used to load the whole matrix)."""
    monkeypatch.setattr(hr, "_SCAN_BLOCK", 50)
    path, dense = sparse_file
    with h5py.File(path, "r") as f:
        nnz = f["csr"]["data"].shape[0]
        got = hr._matrix(f["csr"], None, [7])
    np.testing.assert_array_equal(got[:, 0], dense[:, 7])
    assert max(n for name, n in reads if name in ("data", "indices")) <= 50
    assert sum(n for name, n in reads if name == "indices") == nnz


def test_dense_column_reads_one_column(sparse_file, reads):
    path, dense = sparse_file
    with h5py.File(path, "r") as f:
        hr._matrix(f["dense"], None, [7])
    assert reads == [("dense", dense.shape[0])]


# --------------------------------------------------------------------------
# column encodings anndata writes to h5ad
# --------------------------------------------------------------------------

def _str(group, name, values):
    return group.create_dataset(name, data=np.array(values, dtype=object), dtype=h5py.string_dtype())


@pytest.fixture
def encoded(tmp_path):
    n = 6
    path = tmp_path / "enc.h5ad"
    with h5py.File(path, "w") as f:
        obs = f.create_group("obs")
        obs.attrs.update({"encoding-type": "dataframe", "_index": "barcode"})
        _str(obs, "barcode", [f"c{i}" for i in range(n)])
        cat = obs.create_group("cat")
        cat.attrs["encoding-type"] = "categorical"
        _str(cat, "categories", ["a", "b"])
        cat.create_dataset("codes", data=np.array([0, 1, -1, 1, 0, 0], dtype=np.int8))
        for name, values, mask in (
                ("nint", np.arange(n, dtype=np.int64), [0, 1, 0, 0, 0, 1]),
                ("nbool", np.array([1, 0, 1, 0, 1, 0], dtype=bool), [1, 0, 0, 0, 0, 0])):
            g = obs.create_group(name)
            g.attrs["encoding-type"] = f"nullable-{'integer' if name == 'nint' else 'boolean'}"
            g.create_dataset("values", data=values)
            g.create_dataset("mask", data=np.array(mask, dtype=bool))
        nstr = obs.create_group("nstr")
        nstr.attrs["encoding-type"] = "nullable-string-array"
        _str(nstr, "values", ["x", "", "z", "w", "", "v"])
        nstr.create_dataset("mask", data=np.array([0, 1, 0, 0, 1, 0], dtype=bool))
        # anndata 0.7: codes as a dataset, categories referenced from __categories
        cats = obs.create_group("__categories")
        old = _str(cats, "old", ["lo", "hi"])
        codes = obs.create_dataset("old", data=np.array([1, 0, 1, 1, 0, -1], dtype=np.int8))
        codes.attrs["categories"] = old.ref
        var = f.create_group("var")
        var.attrs["_index"] = "_index"
        _str(var, "_index", ["g0", "g1"])
        f.create_dataset("X", data=np.zeros((n, 2), dtype=np.float32))
    return str(path)


def test_column_encodings(encoded):
    reader = h5adReader()
    got = reader.get_obs_var("cells", dataset_path=encoded)
    assert got["data"] == {
        "_index": [f"c{i}" for i in range(6)],
        "cat": ["a", "b", None, "b", "a", "a"],
        "nint": [0, None, 2, 3, 4, None],
        "nbool": [None, False, True, False, True, False],
        "nstr": ["x", None, "z", "w", None, "v"],
        "old": ["hi", "lo", "hi", "hi", "lo", None],
    }
    assert got["categories"] == {"cat": ["a", "b"], "old": ["lo", "hi"]}
    some = reader.get_obs_var("cells", dataset_path=encoded, column_names=["nint", "old"], indices=[5, 1, 5])
    assert some["data"] == {"nint": [None, None, None], "old": [None, "lo", None]}


def test_named_index_and_metadata(encoded):
    reader = h5adReader()
    assert reader.get_cell_gene_names(encoded, "cells") == [f"c{i}" for i in range(6)]
    meta = reader.get_metadata(encoded)
    assert "__categories" not in meta["obs_columns"]
    info = meta["obs_columns_info"]
    assert "barcode" not in info
    assert info["cat"]["type"] == info["old"]["type"] == "categorical"
    assert info["nint"]["type"] == "nullable-integer"


def test_pre_07_h5ad_is_refused_with_the_fix(tmp_path, client):
    path = tmp_path / "old.h5ad"
    with h5py.File(path, "w") as f:
        f.create_dataset("obs", data=np.array([(b"c0", 1.0)], dtype=[("index", "S2"), ("n", "f8")]))
        f.create_dataset("var", data=np.array([(b"g0",)], dtype=[("index", "S2")]))
        f.create_dataset("X", data=np.zeros((1, 1)))
    r = client.get("/api/v1/data/dataset_structure", query_string={"dataset_path": str(path)})
    assert r.status_code == 400
    assert "anndata older than 0.7" in r.get_json()["message"]


def test_open_retries_without_file_locking(tmp_path, monkeypatch):
    """Lustre/NFS without flock refuse HDF5's lock; a reader does not need it."""
    path = tmp_path / "l.h5ad"
    with h5py.File(path, "w") as f:
        f.create_dataset("X", data=np.ones((2, 2)))
    real = h5py.File
    calls = []

    def locking_fs(name, mode="r", **kw):
        calls.append(kw.get("locking"))
        if kw.get("locking") is not False:
            raise OSError("Unable to synchronously open file (unable to lock file, errno = 38)")
        return real(name, mode, **kw)

    monkeypatch.setattr(hr.h5py, "File", locking_fs)
    np.testing.assert_array_equal(h5adReader().get_X(str(path)), np.ones((2, 2)))
    assert calls == [None, False]
