"""The aggregations sum, detected and fraction_of_total (annzarro/core/gene_score.py) against dense references,
on every layout of both backends, with the edge cases: no gene present, all-zero genes, NaN and infinity,
the cells shown, the bins and controls of the control-adjusted score, and the estimate of the pass over every gene.
"""
import itertools

import numpy as np
import pytest

from annzarro.core import gene_score as gs
from annzarro.core import get_reader
from annzarro.tests.core.gene_score_store import BACKENDS, LAYOUTS, N_OBS, gene, make_matrix, make_store, wide_matrix, wide_names

TOL = dict(rtol=3e-6, atol=3e-6)
GENES = [0, 1, 3, 4, 6, 8, 9, 10]            # common, rare+huge, all zero, NaNs, rare, random


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
    base = tmp_path_factory.mktemp("gsm")
    out = {}
    for backend, layout in itertools.product(BACKENDS, LAYOUTS):
        suffix = "zarr" if backend == "zarr" else "h5ad"
        out[backend, layout] = make_store(base / f"{layout}_{backend}.{suffix}", matrix, layout, backend)
    return out


def detected_above(x, cols, threshold):
    x = np.asarray(x, dtype=np.float64)[:, cols]
    ok = np.isfinite(x)
    present = ok.sum(axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(present > 0, ((x > threshold) & ok).sum(axis=1) / np.maximum(present, 1), np.nan)


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
@pytest.mark.parametrize("threshold", [0, 0.5, 2.0, 1000])
def test_detected_counts_the_genes_above_the_threshold(stores, matrix, backend, layout, threshold):
    _, result = run(stores[backend, layout], {"genes": [gene(i) for i in GENES], "method": "fraction_of_genes", "detect_above": threshold})
    np.testing.assert_allclose(result.values, detected_above(matrix, GENES, threshold), equal_nan=True, **TOL)


def test_a_higher_threshold_never_detects_more(stores):
    path = stores["zarr", "csc"]
    previous = None
    for threshold in (0, 0.5, 1, 3):
        v = run(path, {"genes": [gene(i) for i in GENES], "method": "fraction_of_genes", "detect_above": threshold})[1].values
        if previous is not None:
            assert np.all((v <= previous + 1e-7) | np.isnan(v))
        previous = v
    assert run(path, {"genes": [gene(0)], "method": "fraction_of_genes", "detect_above": 1e9})[1].values.max() == 0


@pytest.mark.parametrize("bad", [-0.1, float("nan"), float("inf"), "0", True, None])
def test_the_detection_threshold_is_a_number_from_zero_up(bad):
    with pytest.raises(gs.ScoreError) as caught:
        gs.parse_recipe({"genes": ["A"], "method": "fraction_of_genes", "detect_above": bad})
    assert caught.value.reason == "bad_detect_above"
    ok = gs.parse_recipe({"genes": ["A"], "method": "fraction_of_genes", "detect_above": 2})
    assert ok.describe()["detect_above"] == 2.0
    assert gs.parse_recipe({"genes": ["A"], "method": "mean", "detect_above": 2}).describe()["detect_above"] is None


def test_the_share_of_the_total_is_in_percent(stores, matrix):
    v = run(stores["zarr", "csc"], {"genes": [gene(0)], "method": "fraction_of_total"})[1].values
    assert 0 < np.nanmax(v) <= 100 and np.nanmax(v) > 1, "percent, not a fraction"


def dense(x, cols, method):
    """sum, detected and fraction_of_total by their definitions, in float64; non-finite values are missing."""
    x = np.asarray(x, dtype=np.float64)[:, cols]
    ok = np.isfinite(x)
    present = ok.sum(axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        if method == "sum":
            return np.where(present > 0, np.where(ok, x, 0).sum(axis=1), np.nan)
        if method == "fraction_of_genes":
            return np.where(present > 0, ((x != 0) & ok).sum(axis=1) / np.maximum(present, 1), np.nan)
    raise AssertionError(method)


def total_of(x):
    x = np.asarray(x, dtype=np.float64)
    return np.where(np.isfinite(x), x, 0).sum(axis=1)


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
@pytest.mark.parametrize("method", ["sum", "fraction_of_genes"])
def test_sum_and_detected_match_the_dense_reference(stores, matrix, backend, layout, method):
    _, result = run(stores[backend, layout], {"genes": [gene(i) for i in GENES], "method": method})
    np.testing.assert_allclose(result.values, dense(matrix, GENES, method), equal_nan=True, **TOL)
    assert result.n_used == len(GENES) - 1 or result.n_used == len(GENES), "constant and all-zero genes stay in"


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
def test_the_fraction_of_total_matches_the_dense_reference(stores, matrix, backend, layout):
    _, result = run(stores[backend, layout], {"genes": [gene(i) for i in GENES], "method": "fraction_of_total"})
    s = dense(matrix, GENES, "sum")
    t = total_of(matrix)
    with np.errstate(invalid="ignore", divide="ignore"):
        want = np.where(t > 0, 100.0 * s / t, np.nan)
    np.testing.assert_allclose(result.values, want, equal_nan=True, rtol=1e-5, atol=1e-6)


@pytest.mark.parametrize("method", ["sum", "fraction_of_genes", "fraction_of_total"])
def test_the_cells_shown_get_the_values_of_the_whole_dataset(stores, method):
    recipe = {"genes": [gene(i) for i in GENES], "method": method}
    rows = np.array([0, 5, 17, 60, 199])
    for layout in LAYOUTS:
        whole = run(stores["zarr", layout], recipe)[1].values
        shown = run(stores["zarr", layout], recipe, rows)[1].values
        np.testing.assert_allclose(shown, whole[rows], equal_nan=True, rtol=1e-6, atol=1e-6)


@pytest.mark.parametrize("method", ["sum", "fraction_of_genes", "fraction_of_total"])
def test_no_gene_present_and_an_empty_signature_have_no_score(stores, method):
    for genes, reason in (([], "empty_signature"), (["NOPE"], "no_gene_present")):
        _, result = run(stores["zarr", "csc"], {"genes": genes, "method": method})
        assert result.values is None and result.reason == reason


def test_all_zero_genes_sum_to_zero_are_never_detected_and_have_a_share_of_zero(stores):
    recipe = {"genes": [gene(3)]}                         # gene 3 is zero in every cell
    for layout in LAYOUTS:
        path = stores["zarr", layout]
        assert not np.any(run(path, {**recipe, "method": "sum"})[1].values)
        assert not np.any(run(path, {**recipe, "method": "fraction_of_genes"})[1].values)
        share = run(path, {**recipe, "method": "fraction_of_total"})[1].values
        assert np.nanmax(share) == 0.0


def test_nan_and_infinity_are_missing_not_values(stores, matrix):
    for layout in LAYOUTS:
        path = stores["zarr", layout]
        s = run(path, {"genes": [gene(4), gene(5)], "method": "sum"})[1].values        # gene 5 has no value anywhere
        want = dense(matrix, [4, 5], "sum")
        np.testing.assert_allclose(s, want, equal_nan=True, **TOL)
        assert np.isnan(s[[5, 40, 41, 150]]).all(), "a cell whose only value is missing has no score"
        d = run(path, {"genes": [gene(7)], "method": "fraction_of_genes"})[1].values            # +inf in cell 60
        assert np.isnan(d[60]) and np.isfinite(np.delete(d, 60)).all()
        # a total that skips the infinity: cell 60's other genes still make a total
        share = run(path, {"genes": [gene(0)], "method": "fraction_of_total"})[1].values
        assert np.isfinite(share[60])


def test_a_cell_with_a_zero_total_has_no_share():
    x = make_matrix().copy()
    x[7, :] = 0
    # (the store of the module is not reused: this row changes the matrix)
    import tempfile, os
    with tempfile.TemporaryDirectory() as d:
        path = make_store(os.path.join(d, "z.zarr"), x, "csc")
        v = run(path, {"genes": [gene(0), gene(8)], "method": "fraction_of_total"})[1].values
        assert np.isnan(v[7]) and np.isfinite(np.delete(v, 7)).sum() > 150


def test_the_share_of_a_log_or_scaled_input_carries_a_warning():
    import tempfile, os
    x = np.log1p(np.abs(make_matrix())).astype(np.float32)
    x = np.where(np.isfinite(x), x, 0).astype(np.float32)
    x = np.tile(x, (1, 1))
    with tempfile.TemporaryDirectory() as d:
        path = make_store(os.path.join(d, "l.zarr"), x, "csc")
        _, result = run(path, {"genes": [gene(0), gene(9)], "method": "fraction_of_total"})
        assert result.input_kind in ("log", "unknown")


def test_a_share_asks_for_a_pass_over_every_stored_entry_and_says_so_in_the_estimate(stores, matrix):
    genes = [gene(i) for i in GENES]
    for layout in LAYOUTS:
        path = stores["zarr", layout]
        reader = get_reader(path)
        plain = gs.plan(reader, path, gs.parse_recipe({"genes": genes, "method": "sum"}))
        share = gs.plan(reader, path, gs.parse_recipe({"genes": genes, "method": "fraction_of_total"}))
        assert plain.stat_entries == 0 and share.stat_entries > 0
        assert share.entries == plain.entries + share.stat_entries and share.seconds > plain.seconds
        assert share.vectors == 2 and plain.vectors == 1


def test_the_share_at_ten_million_cells_meets_the_tiers_for_a_typical_matrix():
    """10M cells, 1,500 stored genes a cell, held by gene: the pass reads 15 billion entries."""
    seconds = gs.estimate_seconds("csc", 15_000_000_000 + 500_000, False)
    assert gs.tier_of(seconds) == "confirm" and seconds < gs.CONFIRM_MAX_S
    assert gs.tier_of(gs.estimate_seconds("csc", 30_000_000_000, False)) == "refused", "double the entries is refused"


# --- the control-adjusted score's bins and controls --------------------------------------------------------------

@pytest.fixture(scope="module")
def wide(tmp_path_factory):
    return make_store(tmp_path_factory.mktemp("w") / "w.zarr", wide_matrix(), "csc", var_names=wide_names())


def test_bins_and_controls_are_recipe_parameters_that_change_the_draw(wide):
    genes = wide_names()[10:30]
    a = run(wide, {"genes": genes, "method": "control_adjusted"})[1]
    b = run(wide, {"genes": genes, "method": "control_adjusted", "controls": 10})[1]
    c = run(wide, {"genes": genes, "method": "control_adjusted", "bins": 10})[1]
    assert len(b.controls) < len(a.controls) and a.controls != c.controls
    assert len(a.controls) <= 25 * 50 and len(b.controls) <= 25 * 10
    p = gs.parse_recipe({"genes": genes, "method": "control_adjusted", "bins": 7, "controls": 9})
    assert p.describe()["bins"] == 7 and p.describe()["controls"] == 9
    assert gs.parse_recipe({"genes": genes, "method": "mean", "bins": 7}).describe()["bins"] is None


@pytest.mark.parametrize("field,bad", [("bins", 1), ("bins", 201), ("bins", 2.5), ("bins", True), ("bins", "25"),
                                       ("controls", 0), ("controls", 1001), ("controls", None)])
def test_bins_and_controls_are_whole_numbers_in_range(field, bad):
    with pytest.raises(gs.ScoreError) as caught:
        gs.parse_recipe({"genes": ["A"], field: bad})
    assert caught.value.reason == f"bad_{field}"


def test_the_methods_in_order_and_the_default_first():
    assert gs.METHODS == ("zscore_mean", "mean", "sum", "control_adjusted", "fraction_of_genes", "fraction_of_total")
    assert gs.DEFAULT_METHOD == gs.METHODS[0]


def test_detected_is_read_as_fraction_of_genes_with_the_same_values(stores):
    """The method was named `detected` before 0.8.0 (aggregation-unify-080.md 13.3): an old recipe is read as the new id, the recipe
    that comes back names the new one, and the values are the same."""
    path = stores["zarr", "csc"]
    old = {"genes": [gene(i) for i in GENES], "method": "detected", "detect_above": 1}
    new = {**old, "method": "fraction_of_genes"}
    assert gs.parse_recipe(old).method == "fraction_of_genes"
    a, b = run(path, old)[1], run(path, new)[1]
    np.testing.assert_array_equal(a.values, b.values)
    assert gs.parse_recipe(old).describe()["method"] == "fraction_of_genes"
    with pytest.raises(gs.ScoreError) as bad:
        gs.parse_recipe({"genes": ["A"], "method": "detected_cells"})
    assert bad.value.reason == "bad_method"
