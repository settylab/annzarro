"""A contiguous run of cells is read with a slice, and gives exactly what the index path gives (every source type,
layout and backend), including the slab boundaries of a full read and of a subset that is one run."""
import itertools

import numpy as np
import pytest

from annzarro.core import cell_sources as cs
from annzarro.core import get_reader
from annzarro.tests.core.cell_sources_store import make_cell_store
from annzarro.tests.core.gene_score_store import BACKENDS, LAYOUTS, N_OBS, gene

SOURCES = [{"type": "obs", "key": k} for k in ("depth", "pseudotime", "flag", "ctype", "nullable", "note", "total_counts")] + [
    {"type": "obsm", "key": "wide", "column": "7"}, {"type": "obsm", "key": "X_umap", "column": "1"},
    {"type": "obsm", "key": "sparse_m", "column": "3"},
    {"type": "obsp", "key": "dense_p", "column": "41"}, {"type": "obsp", "key": "knn_csr", "column": "41"},
    {"type": "layer", "key": "X", "column": gene(0)}, {"type": "layer", "key": "counts", "column": gene(4)}]
ROWS = {"all": None, "run": np.arange(37, 163, dtype=np.int64), "scattered": np.arange(3, N_OBS, 4, dtype=np.int64),
        "run_of_one": np.array([99], dtype=np.int64)}


@pytest.fixture(scope="module")
def stores(tmp_path_factory):
    base = tmp_path_factory.mktemp("slices")
    return {(b, l): make_cell_store(base / f"{l}_{b}.{'zarr' if b == 'zarr' else 'h5ad'}", l, b)[0]
            for b, l in itertools.product(BACKENDS, LAYOUTS)}


def read(path, source, rows, slices):
    cs.USE_SLICES = slices
    try:
        slabs = list(cs.column(get_reader(path), path, source, rows))
    finally:
        cs.USE_SLICES = True
    values = np.concatenate([s.values for s in slabs])
    return values, [(s.start, s.kind, s.categories) for s in slabs]


@pytest.mark.parametrize("slab", [7, 64, 4096])
@pytest.mark.parametrize("rows", list(ROWS), ids=list(ROWS))
@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
def test_the_slice_and_the_index_path_agree(stores, monkeypatch, backend, layout, rows, slab):
    monkeypatch.setattr(cs, "SLAB_ROWS", slab)
    path = stores[backend, layout]
    for source in SOURCES:
        a, meta_a = read(path, source, ROWS[rows], True)
        b, meta_b = read(path, source, ROWS[rows], False)
        assert a.dtype == b.dtype, source
        assert meta_a == meta_b, source
        np.testing.assert_array_equal(a, b)


@pytest.mark.parametrize("source", [s for s in SOURCES if s["type"] in ("obs", "obsm", "obsp")][:10],
                         ids=lambda s: f"{s['type']}-{s['key']}")
def test_a_run_of_cells_does_not_go_through_the_index_readers(stores, source):
    """The zarr readers' index paths are not called for an all-cells read of a plain column (the point of the slice)."""
    path = stores["zarr", "csc"]
    reader = get_reader(path)
    plain = {("obs", "depth"), ("obs", "pseudotime"), ("obs", "flag"), ("obs", "total_counts"), ("obs", "ctype"),
             ("obsm", "wide"), ("obsm", "X_umap"), ("obsp", "dense_p")}
    if (source["type"], source["key"]) not in plain:
        pytest.skip("not a plain array: it keeps the reader's path")
    calls = []
    for name in ("get_obs_var_numeric", "get_obs_var", "get_obsm_varm", "get_obsp_varp"):
        real = getattr(reader, name)
        setattr(reader, name, lambda *a, _r=real, _n=name, **k: (calls.append((_n, k.get("indices"))), _r(*a, **k))[1])
    list(cs.column(reader, path, source, None))
    assert [c for c in calls if c[1] is not None and len(c[1]) > 1] == []
