"""Up and down genes (annzarro/core/gene_score.py, design section 4.1): score = side(up) - side(down), each side
scored on its own, against dense references on every layout of both backends, with the edge cases: one side
empty, a side with no usable gene, genes absent from the dataset, a gene on both sides, the cells shown, and the
control-adjusted score where each side subtracts its own controls.
"""
import itertools

import numpy as np
import pytest

from annzarro.core import gene_score as gs
from annzarro.core import get_reader
from annzarro.tests.core.gene_score_store import (BACKENDS, LAYOUTS, gene, make_matrix, make_store, reference,
                                                  wide_matrix, wide_names)

TOL = dict(rtol=3e-6, atol=3e-6)
UP = [0, 1, 6, 8]
DOWN = [9, 10, 4]                      # gene 4 holds NaNs: a cell's side averages the genes it has


def run(path, recipe, rows=None):
    reader = get_reader(path)
    p = gs.plan(reader, path, gs.parse_recipe(recipe))
    result = None
    for kind, payload in gs.compute(p, rows):
        if kind == "result":
            result = payload
    return p, result


@pytest.fixture(scope="module")
def matrix():
    return make_matrix()


@pytest.fixture(scope="module")
def stores(tmp_path_factory, matrix):
    base = tmp_path_factory.mktemp("gsd")
    out = {}
    for backend, layout in itertools.product(BACKENDS, LAYOUTS):
        suffix = "zarr" if backend == "zarr" else "h5ad"
        out[backend, layout] = make_store(base / f"{layout}_{backend}.{suffix}", matrix, layout, backend)
    return out


def signed(x, up, down, method):
    """The definition on the dense matrix: the mean of the up side less the mean of the down side."""
    u = reference(x, up, method)[0] if up else None
    d = reference(x, down, method)[0] if down else None
    if u is not None and d is not None:
        return u - d
    return u if u is not None else -d


def names(cols):
    return [gene(i) for i in cols]


# --- the two means, on every layout -----------------------------------------------------------------------

@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
@pytest.mark.parametrize("method", ["zscore_mean", "mean"])
def test_the_score_is_the_up_mean_less_the_down_mean(stores, matrix, backend, layout, method):
    _, result = run(stores[backend, layout], {"genes": names(UP), "down": names(DOWN), "method": method, "down_weight": "side"})
    np.testing.assert_allclose(result.values, signed(matrix, UP, DOWN, method), equal_nan=True, **TOL)
    assert (result.n_used_up, result.n_used_down, result.n_used) == (4, 3, 7)


@pytest.mark.parametrize("method", ["zscore_mean", "mean"])
def test_only_down_genes_give_the_negated_score(stores, matrix, method):
    path = stores["zarr", "csc"]
    _, only_down = run(path, {"genes": [], "down": names(DOWN), "method": method})
    _, as_up = run(path, {"genes": names(DOWN), "method": method})
    np.testing.assert_allclose(only_down.values, -as_up.values, equal_nan=True, **TOL)
    np.testing.assert_allclose(only_down.values, signed(matrix, [], DOWN, method), equal_nan=True, **TOL)
    assert (only_down.n_used_up, only_down.n_used_down) == (0, 3)


def test_only_up_genes_are_unchanged_by_the_feature(stores, matrix):
    _, result = run(stores["zarr", "csc"], {"genes": names(UP)})
    np.testing.assert_allclose(result.values, reference(matrix, UP)[0], equal_nan=True, **TOL)
    assert all(g.direction == "up" for g in result.genes) and result.n_used_down == 0


def test_swapping_the_sides_negates_the_score(stores):
    path = stores["zarr", "csc"]
    a = run(path, {"genes": names(UP), "down": names(DOWN)})[1].values
    b = run(path, {"genes": names(DOWN), "down": names(UP)})[1].values
    np.testing.assert_allclose(a, -b, equal_nan=True, **TOL)


def test_each_gene_reports_its_direction(stores):
    _, result = run(stores["zarr", "csc"], {"genes": names(UP), "down": names(DOWN)})
    by = {g.name: g.direction for g in result.genes}
    assert {n: by[n] for n in names(UP)} == {n: "up" for n in names(UP)}
    assert {n: by[n] for n in names(DOWN)} == {n: "down" for n in names(DOWN)}


def test_a_down_gene_changes_the_score_and_only_by_its_own_contribution(stores, matrix):
    path = stores["zarr", "csc"]
    base = run(path, {"genes": [gene(0), gene(8)]})[1].values
    one = run(path, {"genes": [gene(0)], "down": [gene(8)], "down_weight": "side"})[1].values
    z0 = reference(matrix, [0])[0]
    z8 = reference(matrix, [8])[0]
    np.testing.assert_allclose(one, z0 - z8, **TOL)
    assert not np.allclose(base, one)


# --- the cells shown ---------------------------------------------------------------------------------------

def test_the_cells_shown_get_the_same_values_as_the_whole_dataset(stores):
    path = stores["zarr", "csc"]
    full = run(path, {"genes": names(UP), "down": names(DOWN)})[1].values
    rows = np.array([3, 17, 90, 150, 199])
    part = run(path, {"genes": names(UP), "down": names(DOWN)}, rows)[1].values
    np.testing.assert_allclose(part, full[rows], equal_nan=True, **TOL)


# --- one side with nothing to score -----------------------------------------------------------------------

def test_a_down_gene_absent_from_the_dataset_leaves_the_up_score(stores, matrix):
    path = stores["zarr", "csc"]
    p, result = run(path, {"genes": names(UP), "down": ["NOT_A_GENE"]})
    np.testing.assert_allclose(result.values, reference(matrix, UP)[0], equal_nan=True, **TOL)
    assert p.missing == ["NOT_A_GENE"] and p.missing_down == ["NOT_A_GENE"]
    assert result.n_used_down == 0


def test_an_up_gene_absent_from_the_dataset_leaves_the_negated_down_score(stores, matrix):
    path = stores["zarr", "csc"]
    p, result = run(path, {"genes": ["NOT_A_GENE"], "down": names(DOWN)})
    np.testing.assert_allclose(result.values, -reference(matrix, DOWN)[0], equal_nan=True, **TOL)
    assert p.missing == ["NOT_A_GENE"] and p.missing_down == []


def test_a_constant_down_gene_is_left_out_of_the_z_score_mean_but_not_of_the_mean(stores, matrix):
    path = stores["zarr", "csc"]
    z = run(path, {"genes": names(UP), "down": [gene(2)]})[1]            # gene 2 holds 3.0 everywhere
    np.testing.assert_allclose(z.values, reference(matrix, UP)[0], equal_nan=True, **TOL)
    assert z.n_used_down == 0 and [g.status for g in z.genes if g.name == gene(2)] == ["constant"]
    m = run(path, {"genes": names(UP), "down": [gene(2)], "method": "mean", "down_weight": "side"})[1]
    np.testing.assert_allclose(m.values, reference(matrix, UP, "mean")[0] - 3.0, equal_nan=True, **TOL)


def test_no_usable_gene_on_either_side_gives_no_score(stores):
    path = stores["zarr", "csc"]
    _, result = run(path, {"genes": [gene(2)], "down": [gene(5)]})        # constant, and all NaN
    assert result.values is None and result.reason == "no_usable_gene"
    _, result = run(path, {"genes": ["X_NO"], "down": ["Y_NO"]})
    assert result.values is None and result.reason == "no_gene_present"
    _, result = run(path, {"genes": [], "down": []})
    assert result.values is None and result.reason == "empty_signature"


# --- a gene on both sides ----------------------------------------------------------------------------------

def test_a_gene_named_on_both_sides_counts_as_up_and_is_reported():
    r = gs.parse_recipe({"genes": ["A", "B"], "down": ["B", "C"]})
    assert r.genes == ("A", "B") and r.down == ("C",) and r.overlap == ("B",)


def test_a_gene_on_both_sides_scores_as_if_down_never_named_it(stores):
    path = stores["zarr", "csc"]
    a = run(path, {"genes": names([0, 1]), "down": names([1, 9])})[1].values
    b = run(path, {"genes": names([0, 1]), "down": names([9])})[1].values
    np.testing.assert_array_equal(a, b)


# --- the methods that have no signed version ---------------------------------------------------------------

@pytest.mark.parametrize("method", ["sum", "fraction_of_genes", "fraction_of_total"])
def test_methods_without_a_signed_meaning_refuse_down_genes(method):
    with pytest.raises(gs.ScoreError) as caught:
        gs.parse_recipe({"genes": ["A"], "down": ["B"], "method": method})
    assert (caught.value.status, caught.value.reason) == (400, "method_no_down")
    assert gs.parse_recipe({"genes": ["A"], "method": method}).method == method        # still fine without down


@pytest.mark.parametrize("method", list(gs.DOWN_METHODS))
def test_the_signed_methods_accept_down_genes(method):
    assert gs.parse_recipe({"genes": ["A"], "down": ["B"], "method": method}).down == ("B",)
    assert gs.parse_recipe({"genes": [], "down": ["B"], "method": method}).genes == ()


def test_down_must_be_a_list_of_text():
    for bad in ("B", [1], [None]):
        with pytest.raises(gs.ScoreError) as caught:
            gs.parse_recipe({"genes": ["A"], "down": bad})
        assert caught.value.reason == "bad_recipe"


def test_describe_and_estimate_count_the_down_genes(stores):
    p, _ = run(stores["zarr", "csc"], {"genes": names(UP), "down": names(DOWN)})
    assert p.recipe.describe()["down"] == 3
    est = p.estimate()
    assert est["genes_requested"] == 7 and est["down_requested"] == 3 and est["genes"] == 7


# --- control-adjusted: each side subtracts its own controls ------------------------------------------------

@pytest.fixture(scope="module")
def wide(tmp_path_factory):
    x = wide_matrix()
    return x, make_store(tmp_path_factory.mktemp("wided") / "w.zarr", x, "csc", var_names=wide_names())


def wnames(cols):
    return [wide_names()[c] for c in cols]


UP_W, DOWN_W = list(range(10, 22)), list(range(300, 312))


def test_control_adjusted_subtracts_each_sides_own_controls(wide):
    x, path = wide
    x = x.astype(np.float64)
    p, result = run(path, {"genes": wnames(UP_W), "down": wnames(DOWN_W), "method": "control_adjusted", "seed": 5})
    assert p.controls and p.down_controls
    assert not set(p.controls) & set(UP_W) and not set(p.down_controls) & set(DOWN_W)
    up = x[:, UP_W].mean(axis=1) - x[:, p.controls].mean(axis=1)
    down = x[:, DOWN_W].mean(axis=1) - x[:, p.down_controls].mean(axis=1)
    np.testing.assert_allclose(result.values, up - down, **TOL)
    assert result.n_used_up == 12 and result.n_used_down == 12


def test_control_adjusted_down_only_is_the_negated_up_only_score(wide):
    _, path = wide
    a = run(path, {"genes": [], "down": wnames(DOWN_W), "method": "control_adjusted", "seed": 5})[1]
    b = run(path, {"genes": wnames(DOWN_W), "method": "control_adjusted", "seed": 5})[1]
    np.testing.assert_allclose(a.values, -b.values, **TOL)


def test_control_adjusted_sides_equal_the_two_scanpy_style_calls(wide):
    """up - down is the difference of two single-side scores that use the same seed."""
    _, path = wide
    both = run(path, {"genes": wnames(UP_W), "down": wnames(DOWN_W), "method": "control_adjusted", "seed": 2})[1].values
    up = run(path, {"genes": wnames(UP_W), "method": "control_adjusted", "seed": 2})[1].values
    down = run(path, {"genes": wnames(DOWN_W), "method": "control_adjusted", "seed": 2})[1].values
    np.testing.assert_allclose(both, up - down, **TOL)


def test_control_adjusted_a_side_with_no_gene_present_is_left_out(wide):
    _, path = wide
    a = run(path, {"genes": wnames(UP_W), "down": ["NOPE"], "method": "control_adjusted"})[1].values
    b = run(path, {"genes": wnames(UP_W), "method": "control_adjusted"})[1].values
    np.testing.assert_array_equal(a, b)


def test_control_adjusted_the_seed_follows_for_both_sides(wide):
    _, path = wide
    def go(seed):
        return run(path, {"genes": wnames(UP_W), "down": wnames(DOWN_W), "method": "control_adjusted", "seed": seed})[1].values
    np.testing.assert_array_equal(go(1), go(1))
    assert not np.array_equal(go(1), go(2))


def test_the_estimate_reads_both_sides_controls(wide):
    _, path = wide
    one = gs.plan(get_reader(path), path, gs.parse_recipe({"genes": wnames(UP_W), "method": "control_adjusted"}))
    two = gs.plan(get_reader(path), path, gs.parse_recipe({"genes": wnames(UP_W), "down": wnames(DOWN_W),
                                                           "method": "control_adjusted"}))
    assert two.entries > one.entries and two.vectors == 2 * one.vectors


# --- how down genes weigh: each gene equally (default) or each side equally ---------------------------------

def gene_weighted(x, up, down, method):
    """(sum of the up genes' values less the down genes') / (genes with a value), per cell, on the dense matrix."""
    x = np.asarray(x, dtype=np.float64)
    total = np.zeros(x.shape[0])
    count = np.zeros(x.shape[0])
    for cols, sign in ((up, 1.0), (down, -1.0)):
        for j in cols:
            col = x[:, j]
            ok = np.isfinite(col)
            if not ok.any():
                continue
            if method == "zscore_mean":
                if col[ok].min() == col[ok].max():
                    continue
                t = np.clip((col - col[ok].mean()) / col[ok].std(), -10.0, 10.0)
            else:
                t = col
            total += sign * np.where(ok, t, 0.0)
            count += ok
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(count > 0, total / np.maximum(count, 1), np.nan)


def test_the_default_weighs_each_gene_equally():
    assert gs.parse_recipe({"genes": ["A"], "down": ["B"]}).down_weight == "gene"
    assert gs.parse_recipe({"genes": ["A"], "down": ["B"], "down_weight": "side"}).down_weight == "side"


@pytest.mark.parametrize("bad", ["", "both", 1, None, True])
def test_a_bad_down_weight_is_refused(bad):
    with pytest.raises(gs.ScoreError) as caught:
        gs.parse_recipe({"genes": ["A"], "down": ["B"], "down_weight": bad})
    assert (caught.value.status, caught.value.reason) == (400, "bad_down_weight")


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
@pytest.mark.parametrize("method", ["zscore_mean", "mean"])
def test_each_gene_weighs_equally_against_a_dense_reference(stores, matrix, backend, layout, method):
    up, down = [0, 1, 6, 8, 11, 12], [9, 4]                    # unequal sides, gene 4 holds NaNs
    _, result = run(stores[backend, layout], {"genes": names(up), "down": names(down), "method": method})
    np.testing.assert_allclose(result.values, gene_weighted(matrix, up, down, method), equal_nan=True, **TOL)
    _, side = run(stores[backend, layout], {"genes": names(up), "down": names(down), "method": method, "down_weight": "side"})
    np.testing.assert_allclose(side.values, signed(matrix, up, down, method), equal_nan=True, **TOL)
    assert not np.allclose(result.values, side.values, equal_nan=True), "unequal sides give two different scores"


def test_forty_up_and_four_down_genes_weigh_by_gene_or_by_side(tmp_path):
    rng = np.random.default_rng(4)
    x = rng.gamma(2.0, 1.0, (200, 44)).astype(np.float32)
    path = make_store(tmp_path / "u.zarr", x, "csc", var_names=[f"U{i:02d}" for i in range(44)])
    up, down = list(range(40)), list(range(40, 44))
    nm = lambda cols: [f"U{i:02d}" for i in cols]
    for method in ("mean", "zscore_mean"):
        gene_ = run(path, {"genes": nm(up), "down": nm(down), "method": method})[1].values
        side = run(path, {"genes": nm(up), "down": nm(down), "method": method, "down_weight": "side"})[1].values
        np.testing.assert_allclose(gene_, gene_weighted(x, up, down, method), **TOL)
        np.testing.assert_allclose(side, signed(x, up, down, method), **TOL)
        mu = reference(x, up, method)[0]
        md = reference(x, down, method)[0]
        # by gene: (40 up - 4 down) / 44; by side: up - down
        np.testing.assert_allclose(gene_, (40 * mu - 4 * md) / 44, **TOL)


def test_equal_sides_make_the_by_side_score_exactly_twice_the_by_gene_score(stores, matrix):
    path = stores["zarr", "csc"]
    for method in ("mean", "zscore_mean"):
        up, down = [0, 8, 10], [6, 9, 11]
        g = run(path, {"genes": names(up), "down": names(down), "method": method})[1].values
        s = run(path, {"genes": names(up), "down": names(down), "method": method, "down_weight": "side"})[1].values
        mask = np.isfinite(g) & np.isfinite(s) & (np.abs(g) > 1e-6)
        np.testing.assert_allclose(s[mask] / g[mask], 2.0, rtol=1e-4)


@pytest.mark.parametrize("weight", ["gene", "side"])
def test_one_empty_side_is_the_same_under_both_weightings(stores, matrix, weight):
    path = stores["zarr", "csc"]
    up_only = run(path, {"genes": names(UP), "down": ["NOT_A_GENE"], "down_weight": weight})[1].values
    np.testing.assert_allclose(up_only, reference(matrix, UP)[0], equal_nan=True, **TOL)
    down_only = run(path, {"genes": [], "down": names(DOWN), "down_weight": weight})[1].values
    np.testing.assert_allclose(down_only, -reference(matrix, DOWN)[0], equal_nan=True, **TOL)
    absent_up = run(path, {"genes": ["NOT_A_GENE"], "down": names(DOWN), "down_weight": weight})[1].values
    np.testing.assert_allclose(absent_up, down_only, equal_nan=True, **TOL)


def test_missing_genes_are_left_out_of_n(stores, matrix):
    path = stores["zarr", "csc"]
    a = run(path, {"genes": names(UP) + ["NOPE"], "down": names(DOWN) + ["NOPE2"]})[1].values
    b = run(path, {"genes": names(UP), "down": names(DOWN)})[1].values
    np.testing.assert_array_equal(a, b)
    # and a constant gene is out of n for the z-score mean
    c = run(path, {"genes": names(UP) + [gene(2)], "down": names(DOWN)})[1].values
    np.testing.assert_allclose(c, b, equal_nan=True, **TOL)


def test_the_weighting_changes_nothing_without_down_genes_or_for_control_adjusted(stores, wide):
    path = stores["zarr", "csc"]
    a = run(path, {"genes": names(UP), "down_weight": "gene"})[1].values
    b = run(path, {"genes": names(UP), "down_weight": "side"})[1].values
    np.testing.assert_array_equal(a, b)
    assert gs.parse_recipe({"genes": ["A"], "down_weight": "side"}).effective_down_weight is None
    assert gs.parse_recipe({"genes": ["A"], "down": ["B"], "method": "control_adjusted", "down_weight": "side"}).effective_down_weight is None
    _, wpath = wide
    ca = {"genes": wnames(UP_W), "down": wnames(DOWN_W), "method": "control_adjusted", "seed": 5}
    g = run(wpath, {**ca, "down_weight": "gene"})[1].values
    s = run(wpath, {**ca, "down_weight": "side"})[1].values
    np.testing.assert_array_equal(g, s)


def test_the_weighting_is_reported_only_where_it_means_something():
    d = lambda **kw: gs.parse_recipe({"genes": ["A"], "down": ["B"], **kw}).describe()["down_weight"]
    assert d() == "gene" and d(method="mean", down_weight="side") == "side"
    assert d(method="control_adjusted") is None
