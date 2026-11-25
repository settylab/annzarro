"""S4 (aggregation-unify-080.md 10.1a, 10.5): the server contract "% expressing any gene" relies on.

A section with a score step and a % expressing channel asks for the existing ``detected`` score feature::

    {"kind": "score", "recipe": {"genes": <up genes>, "down": [], "method": "detected", "detect_above": t},
     "column": "detected", "layer": L, "above": 0}

and reads the value of a group as ``100 * n_above / n`` of its moments. This file pins that, against a direct count
written with NumPy alone (the engine's code is not used to make the expected numbers):

    expressed(cell) = any gene g of the set with a finite x[cell, g] on L and x[cell, g] > t
    n               = cells of the group with a finite value of at least one gene of the set
    n_above         = cells of the group that are expressed

on CSC, CSR and dense stores (zarr and .h5ad), at t = 0 and t > 0, on a signed layer, with cells that have no finite
value, with a subset shown, with down genes (only the up genes count, and ``detected`` refuses a recipe that has down
genes, so the browser sends none), with a group none of whose cells has a value, and with one read of the set's genes.
"""
import itertools

import numpy as np
import pytest

from annzarro.tests.core import grouping_store as gs
from annzarro.tests.core.test_group_features import ReadCounter, close, group_of_cells, run

LAYOUT_BACKEND = list(itertools.product(gs.LAYOUTS, gs.BACKENDS))
BY_TYPE = [{"source": {"type": "obs", "key": "cell_type"}}]
UP = gs.SIGNATURES["up_and_down"]["up"]            # GENE000 .. GENE007
DOWN = gs.SIGNATURES["up_and_down"]["down"]        # GENE012 .. GENE015, broadly expressed


def feature(genes, layer, t, down=(), fid="any"):
    """The feature the browser plans for "% expressing any gene" (10.1a)."""
    return {"id": fid, "kind": "score",
            "recipe": {"genes": list(genes), "down": list(down), "method": "detected", "detect_above": t},
            "column": "detected", "layer": layer, "above": 0}


def column_of(data, names):
    return [data.var_names.index(n) for n in names]


def any_gene(data, layer, names, t, rows=None):
    """``(has_value, expressed)`` per cell shown, by definition, from the dense matrix alone."""
    x = data.layer(layer)[:, column_of(data, names)].astype(np.float64)
    if rows is not None:
        x = x[np.asarray(rows)]
    finite = np.isfinite(x)
    return finite.any(axis=1), (finite & (x > t)).any(axis=1)


def expected(data, layer, names, t, cell_group, k, rows=None):
    """Per group ``[n, n_above]`` by definition."""
    has_value, expressed = any_gene(data, layer, names, t, rows)
    return np.array([[has_value[cell_group == g].sum(), expressed[cell_group == g].sum()] for g in range(k)])


@pytest.fixture(scope="module")
def data():
    return gs.make_data()


@pytest.fixture(scope="module")
def stores(tmp_path_factory, data):
    base = tmp_path_factory.mktemp("anygene")
    return {(lay, be): gs.make_store(base / f"{lay}_{be}.{'zarr' if be == 'zarr' else 'h5ad'}", lay, be, data=data)
            for lay, be in LAYOUT_BACKEND}


def check(res, data, layer, names, t, rows=None, index=0):
    cell_group = group_of_cells(res)
    k = len(res.grouping.groups)
    want = expected(data, layer, names, t, cell_group, k, rows)
    got = np.asarray(res.feature_moments[index], dtype=np.float64)
    assert got[:, 0].tolist() == want[:, 0].tolist(), "n: cells with a finite value of at least one gene"
    assert got[:, 3].tolist() == want[:, 1].tolist(), "n_above: cells expressing at least one gene"
    with np.errstate(invalid="ignore", divide="ignore"):
        close(100 * got[:, 3] / got[:, 0], 100 * want[:, 1] / want[:, 0])
    return want


# ------------------------------------------------------------------------------------------------ the three layouts

@pytest.mark.parametrize("layout,backend", LAYOUT_BACKEND)
@pytest.mark.parametrize("layer,t", [("logged", 0), ("counts", 0), ("counts", 1), ("counts", 3), ("X", 0), ("X", 1)],
                         ids=["logged-0", "counts-0", "counts-1", "counts-3", "signed-X-0", "signed-X-1"])
def test_pct_expressing_any_gene_is_the_direct_count(stores, data, layout, backend, layer, t):
    """Every group, every layout and backend, thresholds 0 and above, and the signed X (values below 0 are not
    expressed at t = 0)."""
    res = run(stores[layout, backend], BY_TYPE, [feature(UP, layer, t)])
    assert res.features == [{"id": "any", "status": "ok"}]
    want = check(res, data, layer, UP, t)
    assert want[:, 1].sum() > 0 and (want[:, 1] < want[:, 0]).any(), "the fixture has expressing and silent cells"


@pytest.mark.parametrize("layout", gs.LAYOUTS)
def test_a_higher_threshold_never_raises_the_value(stores, data, layout):
    by_t = [np.asarray(run(stores[layout, "zarr"], BY_TYPE, [feature(UP, "counts", t)]).feature_moments[0])[:, 3]
            for t in (0, 1, 3, 6)]
    assert all((a >= b).all() for a, b in zip(by_t, by_t[1:]))
    assert (by_t[0] > by_t[-1]).any()


# ------------------------------------------------------------------------------------------------ down genes

@pytest.mark.parametrize("layout", gs.LAYOUTS)
def test_only_the_up_genes_of_a_set_count(stores, data, layout):
    """The feature carries the up genes and ``down: []``: the value is the up genes' count, and it differs from the
    count over up and down together (the down genes are broadly expressed, so counting them would raise it)."""
    res = run(stores[layout, "zarr"], BY_TYPE, [feature(UP, "counts", 3)])
    check(res, data, "counts", UP, 3)
    with_down = expected(data, "counts", UP + DOWN, 3, group_of_cells(res), len(res.grouping.groups))
    got = np.asarray(res.feature_moments[0])[:, 3]
    assert (with_down[:, 1] > got).any(), "the down genes would have raised the count: the test can tell them apart"


def test_detected_refuses_a_recipe_with_down_genes_so_the_browser_sends_none(stores):
    """``method_no_down``: the contract is "up genes, down: []", not "the server ignores down"."""
    with pytest.raises(Exception) as caught:
        run(stores["csc", "zarr"], BY_TYPE, [feature(UP, "logged", 0, down=DOWN)])
    assert "no meaningful signed version" in str(caught.value)


def test_a_set_of_only_down_genes_is_scored_as_the_up_list_the_browser_sends(stores, data):
    """10.1a: a set with only down genes uses those, sent as the genes of the recipe."""
    res = run(stores["csc", "zarr"], BY_TYPE, [feature(DOWN, "logged", 0)])
    check(res, data, "logged", DOWN, 0)


# ------------------------------------------------------------------------------------------------ non-finite values

def _with_silent_cells(data):
    """Cells 0 to 99 have no finite value in any gene of UP (NaN, +inf and -inf mixed); a few others have some."""
    x, logged, counts = data.x.copy(), data.logged.copy(), data.counts.copy()
    cols = column_of(data, UP)
    for arr in (x, logged, counts):
        arr[np.ix_(np.arange(100), cols)] = np.nan
        arr[np.ix_(np.arange(100, 110), cols[:4])] = np.nan          # half the genes missing: still counted
        arr[np.ix_(np.arange(110, 115), cols[:1])] = np.inf
        arr[np.ix_(np.arange(115, 120), cols[:1])] = -np.inf
    return gs.GroupingData(data.obs, x, logged, counts, data.obsm, data.obsp)


@pytest.mark.parametrize("layout,backend", LAYOUT_BACKEND)
def test_a_cell_without_a_finite_value_is_out_of_the_denominator(tmp_path, data, layout, backend):
    nf = _with_silent_cells(data)
    path = gs.make_store(tmp_path / f"nf.{'zarr' if backend == 'zarr' else 'h5ad'}", layout, backend, data=nf)
    for layer, t in (("logged", 0), ("counts", 2), ("X", 0)):
        res = run(path, BY_TYPE, [feature(UP, layer, t)])
        want = check(res, nf, layer, UP, t)
        sizes = np.bincount(group_of_cells(res)[group_of_cells(res) >= 0], minlength=len(res.grouping.groups))
        assert (want[:, 0] < sizes).any(), "silent cells are not counted in n"
        assert (np.asarray(res.feature_moments[0])[:, 0] <= sizes).all()


def test_a_group_none_of_whose_cells_has_a_value_has_no_cells_and_none_above(tmp_path, data):
    """Every cell of one cell type loses its values for the set: n = 0 and n_above = 0 (the browser shows no value, it
    does not divide)."""
    x, logged, counts = data.x.copy(), data.logged.copy(), data.counts.copy()
    silent = (data.obs["cell_type"] == "Dendritic").to_numpy()
    for arr in (x, logged, counts):
        arr[np.ix_(np.flatnonzero(silent), column_of(data, UP))] = np.nan
    nf = gs.GroupingData(data.obs, x, logged, counts, data.obsm, data.obsp)
    path = gs.make_store(tmp_path / "empty.zarr", "csc", "zarr", data=nf)
    res = run(path, BY_TYPE, [feature(UP, "logged", 0)])
    keys = [g["key"][0] for g in res.grouping.groups]
    row = np.asarray(res.feature_moments[0])[keys.index("c:Dendritic")]
    assert row[0] == 0 and row[3] == 0 and row[1] == 0
    assert res.grouping.groups[keys.index("c:Dendritic")]["n"] == 45, "the group itself still has its cells"
    check(res, nf, "logged", UP, 0)


@pytest.mark.parametrize("layout", gs.LAYOUTS)
def test_a_group_with_no_cell_shown_is_not_in_the_reply(stores, data, layout):
    """Showing only some cell types: the groups of the others are not made, so no value is invented for them."""
    rows = np.flatnonzero(data.obs["cell_type"].isin(["B cell", "NK cell"]).to_numpy())
    res = run(stores[layout, "zarr"], BY_TYPE, [feature(UP, "logged", 0)], rows=rows)
    keys = {g["key"][0] for g in res.grouping.groups}
    assert keys == {"c:B cell", "c:NK cell"}
    check(res, data, "logged", UP, 0, rows=rows)


# ------------------------------------------------------------------------------------------------ a subset shown

@pytest.mark.parametrize("layout,backend", LAYOUT_BACKEND)
def test_the_cells_shown_are_the_cells_counted(stores, data, layout, backend):
    rows = np.asarray(gs.SHOWN_THIRD)
    res = run(stores[layout, backend], BY_TYPE, [feature(UP, "logged", 0)], rows=rows)
    check(res, data, "logged", UP, 0, rows=rows)
    assert int(np.asarray(res.feature_moments[0])[:, 0].sum()) <= len(rows)


# ------------------------------------------------------------------------------------------------ a one-gene set

@pytest.mark.parametrize("layout", gs.LAYOUTS)
@pytest.mark.parametrize("t", [0, 2])
def test_a_one_gene_set_is_that_genes_pct_expressing(stores, layout, t):
    """The gene row's feature (``detect_above``) and the any-gene score of a one-gene set have the same n and the
    same n_above: the section's "any gene" is the gene's % expressing."""
    one = [gs.gene(4)]
    res = run(stores[layout, "zarr"], BY_TYPE,
              [feature(one, "counts", t, fid="s"),
               {"id": "g", "kind": "gene", "name": one[0], "layer": "counts", "detect_above": t}])
    s, g = (np.asarray(res.feature_moments[i]) for i in (0, 1))
    assert s[:, 0].tolist() == g[:, 0].tolist() and s[:, 3].tolist() == g[:, 3].tolist()


# ------------------------------------------------------------------------------------------------ one read

@pytest.mark.parametrize("layout", gs.LAYOUTS)
def test_the_sets_genes_are_read_once(stores, data, layout, monkeypatch):
    counter = ReadCounter(monkeypatch)
    res = run(stores[layout, "zarr"], BY_TYPE, [feature(UP, "logged", 0)])
    assert sorted(counter.genes) == sorted(column_of(data, UP)), "each gene of the set once, none more"
    check(res, data, "logged", UP, 0)


def test_the_same_set_asked_at_two_thresholds_by_one_request_is_two_scores_with_their_own_reads(stores, data,
                                                                                               monkeypatch):
    """Pinned as the design states it (10.1a, Cost): each score reads the set's genes; sharing is a later
    optimisation. A change that shares them should update this test, not break the values."""
    counter = ReadCounter(monkeypatch)
    res = run(stores["csc", "zarr"], BY_TYPE,
              [feature(UP, "logged", 0, fid="a"), feature(UP, "logged", 1, fid="b")])
    assert sorted(counter.genes) == sorted(column_of(data, UP) * 2)
    check(res, data, "logged", UP, 0, index=0)
    check(res, data, "logged", UP, 1, index=1)
