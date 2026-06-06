"""Regression tests for ZarrReader's lazy CSC/CSR major-axis slicing.

These exercise the fast path added to ``_load_sparse_matrix`` that extracts a
few columns (CSC) or rows (CSR) without materializing the whole sparse matrix
-- the optimization that makes single-gene UMAP coloring interactive on large
datasets. The stores are built with the live zarr API (not the legacy
``create_dataset(data=...)`` form), so they track the pinned zarr version.

Run: python -m pytest annzarro/tests/core/test_lazy_sparse_slice.py \
         -c /dev/null -o addopts=""
"""
import os
import tempfile

import numpy as np
import scipy.sparse as sp
import zarr

from annzarro.core.zarr_reader import ZarrReader


def _write_sparse_group(parent, name, mat, encoding):
    """Write a scipy CSC/CSR matrix as an AnnData-style sparse zarr group."""
    g = parent.create_group(name)
    g.attrs["encoding-type"] = encoding
    g.attrs["encoding-version"] = "0.1.0"
    g.attrs["shape"] = list(mat.shape)
    for comp in ("data", "indices", "indptr"):
        arr = getattr(mat, comp)
        z = g.create_array(comp, shape=arr.shape, dtype=arr.dtype,
                           chunks=(max(1, min(len(arr), 7)),))
        z[:] = arr
    return g


def _build_store(path, X, layer_csc, layer_csr):
    # zarr_format=2 mirrors what anndata.write_zarr emits today (.zgroup
    # markers), which is what _get_root validates against.
    root = zarr.open_group(path, mode="w", zarr_format=2)
    _write_sparse_group(root, "X", X, "csc_matrix")
    layers = root.create_group("layers")
    _write_sparse_group(layers, "logcounts", layer_csc, "csc_matrix")
    _write_sparse_group(layers, "counts_csr", layer_csr, "csr_matrix")


def test_lazy_csc_columns_match_full_load():
    rng = np.random.default_rng(0)
    dense = rng.random((40, 12)).astype(np.float32)
    dense[dense < 0.6] = 0.0  # make it sparse
    csc = sp.csc_matrix(dense)
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "t.zarr")
        _build_store(path, csc, csc, sp.csr_matrix(dense))
        r = ZarrReader()

        # single column (the gene-coloring hot path)
        for j in (0, 5, 11):
            out = r.get_layer("logcounts", dataset_path=path, col_indices=[j])
            assert out.shape == (40, 1)
            assert np.allclose(out[:, 0], dense[:, j])

        # multiple columns, deliberately unsorted -> order must be preserved
        order = [11, 0, 7, 3]
        out = r.get_layer("logcounts", dataset_path=path, col_indices=order)
        assert out.shape == (40, len(order))
        assert np.allclose(out, dense[:, order])

        # get_X uses the same path
        outX = r.get_X(dataset_path=path, col_indices=[2])
        assert np.allclose(outX[:, 0], dense[:, 2])


def test_lazy_csr_rows_match_full_load():
    rng = np.random.default_rng(1)
    dense = rng.random((30, 18)).astype(np.float32)
    dense[dense < 0.5] = 0.0
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "t.zarr")
        _build_store(path, sp.csc_matrix(dense), sp.csc_matrix(dense),
                     sp.csr_matrix(dense))
        r = ZarrReader()
        order = [5, 0, 29, 13]
        out = r.get_layer("counts_csr", dataset_path=path, row_indices=order)
        assert out.shape == (len(order), 18)
        assert np.allclose(out, dense[order, :])


def test_full_load_still_correct_for_row_and_col():
    # When BOTH axes are requested we fall back to the full-load path; verify it.
    rng = np.random.default_rng(2)
    dense = rng.random((25, 10)).astype(np.float32)
    dense[dense < 0.5] = 0.0
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "t.zarr")
        _build_store(path, sp.csc_matrix(dense), sp.csc_matrix(dense),
                     sp.csr_matrix(dense))
        r = ZarrReader()
        out = r.get_layer("logcounts", dataset_path=path,
                          row_indices=[1, 4, 9], col_indices=[2, 5])
        assert out.shape == (3, 2)
        assert np.allclose(out, dense[np.ix_([1, 4, 9], [2, 5])])
