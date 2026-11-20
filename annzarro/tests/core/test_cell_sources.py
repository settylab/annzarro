"""Per-cell sources (annzarro/core/cell_sources.py): one value per cell for any source setting, in row slabs.

Every source type against the arrays the store was written from: obs (numeric, boolean, nullable, text,
categorical), obsm (dense and sparse), layer (X and a layer, every layout of both backends), obsp (dense, csr
and csc) and a table's bitset; with and without a row subset; with the slab size swept over every boundary of
the 200 cells; and the cost, which charges an obsm column its whole matrix (CMP-13).
"""
import itertools

import numpy as np
import pytest

from annzarro.core import cell_sources as cs
from annzarro.core import gene_score as gs
from annzarro.core import get_reader
from annzarro.tests.core.cell_sources_store import MANY_CATEGORIES, make_cell_store
from annzarro.tests.core.gene_score_store import BACKENDS, LAYOUTS, N_OBS, gene, make_matrix

ROWS = np.arange(3, N_OBS, 4, dtype=np.int64)            # a sorted subset spread over the whole axis
SLABS = (1, 2, 7, 49, 50, 51, 64, 199, 200, 201, 4096)  # around every boundary of 200 cells and of the subset


@pytest.fixture(scope="module")
def stores(tmp_path_factory):
    base = tmp_path_factory.mktemp("cs")
    out = {}
    for backend, layout in itertools.product(BACKENDS, LAYOUTS):
        suffix = "zarr" if backend == "zarr" else "h5ad"
        out[backend, layout] = make_cell_store(base / f"{layout}_{backend}.{suffix}", layout, backend)
    return out


@pytest.fixture(scope="module")
def zarr_csc(stores):
    return stores["zarr", "csc"]


def read(path, source, rows=None, **kw):
    """Every slab of the column, joined; checks that the slabs tile the shown cells in order."""
    slabs = list(cs.column(get_reader(path), path, source, rows, **kw))
    want = N_OBS if rows is None else len(rows)
    at = 0
    for slab in slabs:
        assert slab.start == at
        assert len(slab.values) > 0
        at += len(slab.values)
    assert at == want
    values = np.concatenate([s.values for s in slabs]) if slabs else np.empty(0)
    return values, slabs


def pick(values, rows):
    return values if rows is None else values[rows]


# ---------------------------------------------------------------------------- obs

@pytest.mark.parametrize("backend", BACKENDS)
@pytest.mark.parametrize("rows", [None, ROWS], ids=["all", "subset"])
def test_obs_numeric_columns(stores, backend, rows):
    path, e = stores[backend, "csc"]
    for key, want in (("depth", e["depth"]), ("pseudotime", e["pseudotime"]), ("total_counts", None)):
        values, slabs = read(path, {"type": "obs", "key": key}, rows)
        assert {s.kind for s in slabs} == {"number"}
        if want is not None:
            np.testing.assert_array_equal(values, pick(want, rows))
    assert values.dtype.kind == "f"


@pytest.mark.parametrize("backend", BACKENDS)
def test_obs_nullable_integer_has_nan_where_missing(stores, backend):
    path, e = stores[backend, "csc"]
    values, slabs = read(path, {"type": "obs", "key": "nullable"})
    want = np.where(e["nullable_mask"], np.nan, e["nullable"].astype(np.float64))
    np.testing.assert_array_equal(values, want)
    assert {s.kind for s in slabs} == {"number"}


@pytest.mark.parametrize("backend", BACKENDS)
@pytest.mark.parametrize("rows", [None, ROWS], ids=["all", "subset"])
def test_obs_boolean_and_text(stores, backend, rows):
    path, e = stores[backend, "csc"]
    values, slabs = read(path, {"type": "obs", "key": "flag"}, rows)
    assert {s.kind for s in slabs} == {"bool"}
    assert values.dtype == bool
    np.testing.assert_array_equal(values, pick(e["flag"], rows))
    values, slabs = read(path, {"type": "obs", "key": "note"}, rows)
    assert {s.kind for s in slabs} == {"text"}
    assert list(values) == list(pick(e["note"], rows))


@pytest.mark.parametrize("backend", BACKENDS)
@pytest.mark.parametrize("rows", [None, ROWS], ids=["all", "subset"])
def test_obs_categorical_codes_index_one_category_list(stores, backend, rows):
    path, e = stores[backend, "csc"]
    values, slabs = read(path, {"type": "obs", "key": "ctype"}, rows)
    assert {s.kind for s in slabs} == {"category"}
    assert all(s.categories == e["ctype"] for s in slabs)
    np.testing.assert_array_equal(values, pick(e["ctype_codes"], rows))
    assert (values == -1).sum() == (pick(e["ctype_codes"], rows) == -1).sum()


@pytest.mark.parametrize("slab", SLABS)
def test_slab_size_never_changes_the_values(zarr_csc, monkeypatch, slab):
    path, e = zarr_csc
    monkeypatch.setattr(cs, "SLAB_ROWS", slab)
    for source, want in (({"type": "obs", "key": "depth"}, e["depth"]),
                         ({"type": "obs", "key": "ctype"}, e["ctype_codes"]),
                         ({"type": "obsm", "key": "wide", "column": "7"}, e["wide"][:, 7]),
                         ({"type": "layer", "key": "X", "column": gene(0)}, make_matrix()[:, 0])):
        for rows in (None, ROWS):
            values, slabs = read(path, source, rows)
            np.testing.assert_array_equal(values, pick(want, rows))
            assert len(slabs) == -(-len(values) // slab)


@pytest.mark.parametrize("backend", BACKENDS)
def test_a_column_past_the_category_limit_is_refused_with_its_count(stores, backend):
    path, _ = stores[backend, "csc"]
    with pytest.raises(cs.CellSourceError) as err:
        list(cs.column(get_reader(path), path, {"type": "obs", "key": "many"}, None))
    assert err.value.reason == "too_many_categories"
    assert err.value.extra["count"] == MANY_CATEGORIES
    assert err.value.extra["limit"] == 65_536


def test_a_missing_obs_column_is_key_not_found(zarr_csc):
    path, _ = zarr_csc
    with pytest.raises(cs.CellSourceError) as err:
        list(cs.column(get_reader(path), path, {"type": "obs", "key": "nope"}, None))
    assert (err.value.status, err.value.reason) == (404, "key_not_found")


# ---------------------------------------------------------------------------- obsm

@pytest.mark.parametrize("backend", BACKENDS)
@pytest.mark.parametrize("rows", [None, ROWS], ids=["all", "subset"])
def test_obsm_columns(stores, backend, rows):
    path, e = stores[backend, "csc"]
    for column in (0, 7, 49):
        values, _ = read(path, {"type": "obsm", "key": "wide", "column": str(column)}, rows)
        np.testing.assert_array_equal(values, pick(e["wide"][:, column], rows))
    values, _ = read(path, {"type": "obsm", "key": "X_umap", "column": "1"}, rows)
    assert values.shape == (N_OBS if rows is None else len(rows),)
    dense = e["sparse_m"].toarray()
    values, _ = read(path, {"type": "obsm", "key": "sparse_m", "column": "3"}, rows)
    np.testing.assert_array_equal(values, pick(dense[:, 3], rows))


def test_an_obsm_column_out_of_range_is_key_not_found(zarr_csc):
    path, _ = zarr_csc
    with pytest.raises(cs.CellSourceError) as err:
        list(cs.column(get_reader(path), path, {"type": "obsm", "key": "wide", "column": "50"}, None))
    assert (err.value.status, err.value.reason) == (404, "key_not_found")
    with pytest.raises(cs.CellSourceError) as err:
        list(cs.column(get_reader(path), path, {"type": "obsm", "key": "absent", "column": "0"}, None))
    assert (err.value.status, err.value.reason) == (404, "key_not_found")


# ---------------------------------------------------------------------------- layer

@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
@pytest.mark.parametrize("rows", [None, ROWS], ids=["all", "subset"])
def test_layer_columns_match_the_matrix(stores, backend, layout, rows):
    path, _ = stores[backend, layout]
    x = make_matrix()
    counts = np.round(x * 2).astype(np.float32)
    for j in (0, 1, 2, 3, 4, 5, 6, 7, 11):                 # common, rare, constant, all zero, NaNs, all NaN, inf
        values, _ = read(path, {"type": "layer", "key": "X", "column": gene(j)}, rows)
        np.testing.assert_array_equal(values, pick(x[:, j], rows))
        values, _ = read(path, {"type": "layer", "key": "counts", "column": gene(j)}, rows)
        np.testing.assert_array_equal(values, pick(counts[:, j], rows))


def test_an_empty_key_reads_x(zarr_csc):
    path, _ = zarr_csc
    values, _ = read(path, {"type": "layer", "key": "", "column": gene(0)})
    np.testing.assert_array_equal(values, make_matrix()[:, 0])


def test_a_missing_gene_or_layer_is_key_not_found(zarr_csc):
    path, _ = zarr_csc
    for source in ({"type": "layer", "key": "X", "column": "NOPE"}, {"type": "layer", "key": "nolayer", "column": gene(0)}):
        with pytest.raises(Exception) as err:
            list(cs.column(get_reader(path), path, source, None))
        assert (err.value.status, err.value.reason) == (404, "key_not_found")


# ---------------------------------------------------------------------------- obsp

@pytest.mark.parametrize("backend", BACKENDS)
@pytest.mark.parametrize("rows", [None, ROWS], ids=["all", "subset"])
def test_obsp_is_the_row_of_a_cell_over_the_cells_shown(stores, backend, rows):
    path, e = stores[backend, "csc"]
    names = get_reader(path).get_cell_gene_names(path, "cells")
    dense = {"dense_p": e["dense_p"], "knn_csr": e["knn"].toarray(), "knn_csc": e["knn"].toarray()}
    for key, matrix in dense.items():
        for cell in (0, 41, N_OBS - 1):
            values, _ = read(path, {"type": "obsp", "key": key, "column": names[cell]}, rows)
            np.testing.assert_array_equal(values, pick(matrix[cell], rows))
    values, _ = read(path, {"type": "obsp", "key": "dense_p", "column": "41"})
    if names[41] != "41":                                  # a column that is no cell name is a dataset row
        np.testing.assert_array_equal(values, e["dense_p"][41])


def test_an_obsp_cell_that_is_not_in_the_dataset_is_key_not_found(zarr_csc):
    path, _ = zarr_csc
    with pytest.raises(cs.CellSourceError) as err:
        list(cs.column(get_reader(path), path, {"type": "obsp", "key": "dense_p", "column": "no such cell"}, None))
    assert (err.value.status, err.value.reason) == (404, "key_not_found")


# ---------------------------------------------------------------------------- table, and what is not a stored column

def test_a_table_is_its_bitset_over_the_cells_shown(zarr_csc):
    path, _ = zarr_csc
    member = np.arange(len(ROWS)) % 3 == 0
    values, slabs = read(path, {"type": "table", "ref": "s0"}, ROWS, sets={"s0": member})
    assert {s.kind for s in slabs} == {"set"}
    np.testing.assert_array_equal(values, member)
    with pytest.raises(cs.CellSourceError) as err:
        list(cs.column(get_reader(path), path, {"type": "table", "ref": "s0"}, ROWS, sets={"s0": member[:-1]}))
    assert err.value.reason == "set_length"
    with pytest.raises(cs.CellSourceError) as err:
        list(cs.column(get_reader(path), path, {"type": "table", "ref": "s1"}, ROWS, sets={"s0": member}))
    assert err.value.reason == "set_missing"


@pytest.mark.parametrize("kind", ["gene-score", "cell-group", "mystery"])
def test_a_source_that_is_not_a_stored_column_is_refused(zarr_csc, kind):
    path, _ = zarr_csc
    with pytest.raises(cs.CellSourceError) as err:
        list(cs.column(get_reader(path), path, {"type": kind, "key": "p1"}, None))
    assert err.value.status == 400
    assert err.value.reason == ("unknown_source_type" if kind == "mystery" else "not_a_stored_column")


def test_the_gene_side_only_has_its_parameter(zarr_csc):
    path, _ = zarr_csc
    with pytest.raises(cs.NotBuilt):
        list(cs.column(get_reader(path), path, {"type": "obs", "key": "depth"}, None, axis="var"))
    with pytest.raises(cs.NotBuilt):
        cs.cost(get_reader(path), path, {"type": "obs", "key": "depth"}, axis="var")


@pytest.mark.parametrize("rows", [[5, 3], [1, 1], [0, N_OBS], [-1]])
def test_rows_must_be_sorted_unique_and_inside_the_dataset(zarr_csc, rows):
    path, _ = zarr_csc
    with pytest.raises(cs.CellSourceError) as err:
        list(cs.column(get_reader(path), path, {"type": "obs", "key": "depth"}, np.array(rows)))
    assert err.value.reason == "rows_invalid"


def test_should_stop_ends_the_read_between_slabs(zarr_csc, monkeypatch):
    path, _ = zarr_csc
    monkeypatch.setattr(cs, "SLAB_ROWS", 50)
    seen = []
    it = cs.column(get_reader(path), path, {"type": "obs", "key": "depth"}, None, should_stop=lambda: len(seen) >= 1)
    with pytest.raises(gs.ScoreCancelled):
        for slab in it:
            seen.append(slab)
    assert len(seen) == 1


def test_closing_the_iterator_closes_the_matrix(zarr_csc, monkeypatch):
    path, _ = zarr_csc
    opened = []
    real = gs.open_source

    def spy(*a, **k):
        o = real(*a, **k)
        opened.append(o)
        closes = []
        original = o._closer
        o._closer = lambda: (closes.append(1), original and original())
        o.closes = closes
        return o
    monkeypatch.setattr(gs, "open_source", spy)
    monkeypatch.setattr(cs, "SLAB_ROWS", 50)
    it = cs.column(get_reader(path), path, {"type": "layer", "key": "X", "column": gene(0)}, None)
    next(it)
    it.close()
    assert opened and all(o.closes == [1] for o in opened)


# ---------------------------------------------------------------------------- cost

def test_an_obsm_column_is_charged_its_whole_matrix(stores):
    path, e = stores["zarr", "csc"]
    reader = get_reader(path)
    wide = cs.cost(reader, path, {"type": "obsm", "key": "wide", "column": "7"})
    assert wide.entries == N_OBS * 50
    assert wide.n_cells == N_OBS
    assert cs.cost(reader, path, {"type": "obsm", "key": "wide", "column": "0"}).entries == wide.entries
    assert cs.cost(reader, path, {"type": "obsm", "key": "X_umap", "column": "0"}).entries == N_OBS * 2
    assert cs.cost(reader, path, {"type": "obsm", "key": "sparse_m", "column": "0"}).entries == e["sparse_m"].nnz


def test_cost_of_obs_obsp_set_and_layers(stores):
    path, e = stores["zarr", "csc"]
    reader = get_reader(path)
    assert cs.cost(reader, path, {"type": "obs", "key": "depth"}).entries == N_OBS
    assert cs.cost(reader, path, {"type": "table", "ref": "s0"}).entries == 0
    assert cs.cost(reader, path, {"type": "obsp", "key": "dense_p", "column": "0"}).entries == N_OBS * N_OBS
    assert cs.cost(reader, path, {"type": "obsp", "key": "knn_csr", "column": "0"}).entries == e["knn"].nnz
    x = make_matrix()
    for backend, layout in itertools.product(BACKENDS, LAYOUTS):
        path, _ = stores[backend, layout]
        c = cs.cost(get_reader(path), path, {"type": "layer", "key": "X", "column": gene(0)})
        assert c.layout == layout
        want = {"csc": np.count_nonzero(x[:, 0]),
                "csr": np.count_nonzero(x), "dense": N_OBS * x.shape[1]}[layout]
        assert c.entries >= (want if layout != "dense" else N_OBS)
        if layout == "csc":
            assert c.entries == want


def test_cost_of_a_slow_source_is_known_before_any_read(zarr_csc, monkeypatch):
    path, _ = zarr_csc
    reader = get_reader(path)
    monkeypatch.setattr(cs, "SLAB_ROWS", 1)

    def boom(*a, **k):
        raise AssertionError("cost read a column")
    for name in ("get_obs_var_codes", "get_obs_var_numeric", "get_obsm_varm", "get_obsp_varp", "get_obs_var"):
        monkeypatch.setattr(reader, name, boom)
    for source in ({"type": "obs", "key": "depth"}, {"type": "obsm", "key": "wide", "column": "1"},
                   {"type": "obsp", "key": "dense_p", "column": "0"}):
        assert cs.cost(reader, path, source).entries > 0
