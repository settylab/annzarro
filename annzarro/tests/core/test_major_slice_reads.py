"""``ZarrReader._rows_of_major_slices`` reads every zarr chunk at most once.

A gene colour on a cell subset of a CSR X read the entries of each selected row on
its own, and each read decoded a whole chunk (~1,366 rows) to return ~174 entries:
10,000 cells took 70-118 s. The selected rows' entry ranges are now merged into
spans separated by at least a chunk, each read once. The result must be what
slicing the full matrix gives (CSR and CSC, any order, repeats, empty rows, chunk
edges), and the chunk reads are pinned so the per-row behaviour cannot return.
"""
import numpy as np
import pytest
import scipy.sparse as sp

from annzarro.core.zarr_reader import ZarrReader
from annzarro.tests.zarr_compat import open_group, write_array

N_MAJOR, N_MINOR, CHUNK, PTR_CHUNK = 600, 300, 64, 11


class _Counted:
    """A zarr array that records the chunks every read decodes."""

    def __init__(self, arr, log):
        self._arr, self._log = arr, log
        self.shape, self.dtype, self.chunks = arr.shape, arr.dtype, arr.chunks

    def __getitem__(self, key):
        assert isinstance(key, slice) and key.step is None, key
        a, b, _ = key.indices(self.shape[0])
        if b > a:
            self._log.append(None)           # one call
            self._log.extend(range(a // self.chunks[0], (b - 1) // self.chunks[0] + 1))
        return self._arr[key]


class _Group:
    def __init__(self, group):
        self.logs = {name: [] for name in ("data", "indices", "indptr")}
        self._group = group

    def __getitem__(self, name):
        return _Counted(self._group[name], self.logs[name])


def _matrix(fmt, seed=0, density=0.04):
    rng = np.random.default_rng(seed)
    shape = (N_MAJOR, N_MINOR) if fmt == "csr" else (N_MINOR, N_MAJOR)
    m = sp.random(*shape, density=density, format=fmt, dtype=np.float32, random_state=rng)
    m.data[:] = rng.integers(1, 100, m.nnz)
    return m


def _store(tmp_path, mat, fmt):
    g = open_group(tmp_path / "m.zarr").create_group("X")
    g.attrs.update({"encoding-type": f"{fmt}_matrix", "encoding-version": "0.1.0", "shape": list(mat.shape)})
    write_array(g, "data", mat.data, chunks=(CHUNK,))
    write_array(g, "indices", mat.indices, chunks=(CHUNK,))
    write_array(g, "indptr", mat.indptr, chunks=(PTR_CHUNK,))
    return g


def _call(reader, g, mat, fmt, major, minor):
    if fmt == "csr":
        return reader._rows_of_major_slices(g, mat.shape, major, minor, axis="row"), mat[major][:, minor]
    return reader._rows_of_major_slices(g, mat.shape, major, minor, axis="col"), mat[:, major][minor]


def _selections():
    rng = np.random.default_rng(1)
    edges = [CHUNK * i for i in range(1, 9)]
    return {
        "single": ([17], [5]),
        "all rows": (np.arange(N_MAJOR), np.arange(N_MINOR)),
        "sorted": (np.sort(rng.choice(N_MAJOR, 150, replace=False)), np.sort(rng.choice(N_MINOR, 40, replace=False))),
        "unsorted": (rng.permutation(N_MAJOR)[:200], rng.permutation(N_MINOR)[:60]),
        "repeats": (rng.integers(0, N_MAJOR, 120), rng.integers(0, N_MINOR, 80)),
        "edges": ([0, N_MAJOR - 1, 0, 1, N_MAJOR - 2] + edges, [0, N_MINOR - 1, 0] + list(range(0, N_MINOR, 7))),
        "contiguous": (np.arange(100, 400), [3, 4, 5]),
        "no rows": ([], [1, 2]),
        "no minor": ([1, 2, 3], []),
        "one minor": (np.sort(rng.choice(N_MAJOR, 90, replace=False)), [7]),
    }


@pytest.mark.parametrize("fmt", ["csr", "csc"])
@pytest.mark.parametrize("density", [0.0, 0.01, 0.2])
@pytest.mark.parametrize("name", list(_selections()))
def test_equals_slicing_the_full_matrix(tmp_path, fmt, density, name, monkeypatch):
    mat = _matrix(fmt, density=density)
    g = _store(tmp_path, mat, fmt)
    major, minor = _selections()[name]
    reader = ZarrReader(enable_caching=False)
    for block, span in ((1 << 24, 4), (3 * CHUNK, 1), (1 << 24, 1000)):    # long rows split; spans of 1 chunk; of the store
        monkeypatch.setattr(ZarrReader, "_SELECT_BLOCK", block)
        monkeypatch.setattr(ZarrReader, "_SPAN_CHUNKS", span)
        got, want = _call(reader, g, mat, fmt, np.asarray(major, dtype=int), np.asarray(minor, dtype=int))
        assert got.shape == want.shape
        assert np.array_equal(got.toarray(), want.toarray())


def test_empty_rows_and_rows_longer_than_a_chunk(tmp_path):
    dense = np.zeros((40, 500), np.float32)
    dense[3, :] = np.arange(1, 501)           # a row of several chunks
    dense[4, 10] = 2
    dense[30, 499] = 5                        # last entry of the store
    mat = sp.csr_matrix(dense)
    g = _store(tmp_path, mat, "csr")
    reader = ZarrReader(enable_caching=False)
    for major in ([3], [0, 1, 2], [29, 30, 31], [4, 3, 30, 3]):
        got, want = _call(reader, g, mat, "csr", np.asarray(major), np.arange(0, 500, 3))
        assert np.array_equal(got.toarray(), want.toarray())


def test_out_of_range(tmp_path):
    mat = _matrix("csr")
    g = _store(tmp_path, mat, "csr")
    reader = ZarrReader(enable_caching=False)
    with pytest.raises(IndexError):
        reader._rows_of_major_slices(g, mat.shape, [N_MAJOR], [0], axis="row")
    with pytest.raises(IndexError):
        reader._rows_of_major_slices(g, mat.shape, [0], [N_MINOR], axis="row")


@pytest.mark.parametrize("fmt", ["csr", "csc"])
@pytest.mark.parametrize("name", ["sorted", "unsorted", "repeats", "edges", "one minor", "single"])
def test_each_chunk_is_read_at_most_once(tmp_path, fmt, name):
    mat = _matrix(fmt, density=0.03)
    g = _Group(_store(tmp_path, mat, fmt))
    major, minor = _selections()[name]
    major, minor = np.asarray(major, dtype=int), np.asarray(minor, dtype=int)
    got, want = _call(ZarrReader(enable_caching=False), g, mat, fmt, major, minor)
    assert np.array_equal(got.toarray(), want.toarray())
    # the chunks that hold an entry of a selected slice
    ptr = mat.indptr
    touched = {c for k in set(major.tolist()) for c in range(ptr[k] // CHUNK, (ptr[k + 1] - 1) // CHUNK + 1)
               if ptr[k + 1] > ptr[k]}
    for part in ("indices", "data"):
        reads = [c for c in g.logs[part] if c is not None]
        assert len(reads) == len(set(reads)), f"{part}: a chunk was decoded twice"
        assert g.logs[part].count(None) <= len(touched), f"{part}: more reads than chunks"
        assert set(reads) <= touched, f"{part}: read a chunk no selected slice touches"
    # a read that ends on a chunk's last value also decodes the next chunk: one repeat per read
    reads = g.logs["indptr"]
    assert len(reads) - reads.count(None) <= len(set(reads) - {None}) + reads.count(None)


def test_ten_thousand_cell_subset_reads_each_chunk_once(tmp_path):
    """The production shape in miniature: a random subset of a CSR, one gene."""
    n = 20000
    rng = np.random.default_rng(3)
    mat = sp.random(n, 50, density=0.2, format="csr", dtype=np.float32, random_state=rng)
    g = _Group(_store(tmp_path, mat, "csr"))
    rows = np.sort(rng.choice(n, 2000, replace=False))
    got = ZarrReader(enable_caching=False)._rows_of_major_slices(g, mat.shape, rows, [7], axis="row")
    assert np.array_equal(got.toarray(), mat[rows][:, [7]].toarray())
    n_chunks = -(-mat.nnz // CHUNK)
    for part in ("indices", "data"):
        reads = [c for c in g.logs[part] if c is not None]
        assert len(reads) == len(set(reads)) <= n_chunks
    assert len(g.logs["indptr"]) - g.logs["indptr"].count(None) <= 2 * -(-(n + 1) // PTR_CHUNK)
