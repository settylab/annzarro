"""The control-adjusted score (Tirosh et al. 2016) against scanpy's ``score_genes``.

``annzarro/tests/data/gene_score_scanpy_reference.npz`` holds a 200 x 150 matrix and the scores scanpy 1.13
gives it (made by ``make_gene_score_scanpy_reference.py`` beside it; scanpy is not needed here). Scanpy draws
controls with a random generator, which no other program can repeat, so the reference asks for every other
gene of the signature's bins (``ctrl_size`` above the bin sizes). That leaves nothing to chance, and the engine,
binning by the mean as scanpy does, must then agree with scanpy to float32 accuracy on every layout.

The engine's own choice, binning by detection rate and drawing controls by a seeded rank, is checked by what it
must satisfy: the controls lie in the signature's bins, exclude the signature, number ``ctrl_size`` per bin,
repeat for a seed and follow it, and the score is the signature mean less the control mean.
"""
import itertools
import os

import numpy as np
import pytest

from annzarro.core import gene_score as gs
from annzarro.core import get_reader
from annzarro.tests.core.gene_score_store import BACKENDS, LAYOUTS, make_matrix, make_store, wide_matrix, wide_names

REFERENCE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data",
                         "gene_score_scanpy_reference.npz")
TOL = dict(rtol=1e-5, atol=2e-6)


@pytest.fixture(scope="module")
def ref():
    return dict(np.load(REFERENCE))


@pytest.fixture(scope="module")
def names(ref):
    return [f"G{i:03d}" for i in range(ref["x"].shape[1])]


@pytest.fixture(scope="module")
def stores(tmp_path_factory, ref, names):
    base = tmp_path_factory.mktemp("gsc")
    out = {}
    for backend, layout in itertools.product(BACKENDS, LAYOUTS):
        suffix = "zarr" if backend == "zarr" else "h5ad"
        out[backend, layout] = make_store(base / f"{layout}_{backend}.{suffix}", ref["x"], layout, backend,
                                          var_names=names)
    return out


def run(path, recipe, rows=None, binning="detection"):
    reader = get_reader(path)
    p = gs.plan(reader, path, gs.parse_recipe(recipe), binning=binning)
    progress, result = [], None
    for kind, payload in gs.compute(p, rows):
        if kind == "progress":
            progress.append(payload)
        else:
            result = payload
    return p, result, progress


def dense_score(x, signature, controls):
    """The definition: the mean of the signature's columns less the mean of the controls' columns."""
    x = np.asarray(x, dtype=np.float64)
    return x[:, signature].mean(axis=1) - x[:, controls].mean(axis=1)


SIGNATURES = ("common", "mixed", "single")


# --- scanpy -------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
@pytest.mark.parametrize("label", SIGNATURES)
def test_matches_scanpy_score_genes_when_binned_by_the_mean(stores, ref, names, backend, layout, label):
    genes = [names[c] for c in ref[f"{label}_cols"]]
    _, result, _ = run(stores[backend, layout], {"genes": genes, "method": "control_adjusted"}, binning="mean")
    assert result.values.dtype == np.float32
    np.testing.assert_allclose(result.values, ref[f"{label}_scanpy"], **TOL)


@pytest.mark.parametrize("label", SIGNATURES)
def test_ten_bins_agree_with_scanpy_too(ref, label):
    """The binning is scanpy's rank cut for any bin count, not only the default 25."""
    x = ref["x"].astype(np.float64)
    cols = ref[f"{label}_cols"]
    controls = gs.choose_controls(x.mean(axis=0), cols, seed=0, n_bins=10, ctrl_size=10_000)
    np.testing.assert_allclose(dense_score(x, cols, controls), ref[f"{label}_scanpy_bins10"], rtol=1e-6, atol=1e-6)


def test_the_controls_are_the_other_genes_of_the_signatures_bins(ref):
    x = ref["x"].astype(np.float64)
    cols = ref["common_cols"]
    stat = x.mean(axis=0)
    bins = gs.gene_bins(stat)
    controls = gs.choose_controls(stat, cols, seed=0, ctrl_size=10_000)
    expected = [c for c in range(x.shape[1]) if bins[c] in set(bins[cols]) and c not in set(cols)]
    assert list(controls) == expected


# --- the engine's own choice of controls -------------------------------------------------------------------

def test_controls_lie_in_the_signatures_bins_outside_it_and_number_ctrl_size_per_bin(ref):
    stat = (ref["x"] > 0).mean(axis=0)
    cols = ref["common_cols"]
    bins = gs.gene_bins(stat)
    controls = gs.choose_controls(stat, cols, seed=5, ctrl_size=3)
    assert controls.tolist() == sorted(set(controls.tolist())), "ascending, each once"
    assert not set(controls) & set(cols)
    for cut in set(bins[cols]):
        available = [c for c in range(stat.size) if bins[c] == cut and c not in set(cols)]
        drawn = [c for c in controls if bins[c] == cut]
        assert len(drawn) == min(3, len(available))
        assert set(drawn) <= set(available)
    assert set(bins[controls]) <= set(bins[cols]), "no control from a bin without a signature gene"


def test_the_draw_follows_the_seed_and_repeats_for_it(ref):
    stat = (ref["x"] > 0).mean(axis=0)
    cols = ref["common_cols"]
    a = gs.choose_controls(stat, cols, seed=1, ctrl_size=3)
    assert a.tolist() == gs.choose_controls(stat, cols, seed=1, ctrl_size=3).tolist()
    assert a.tolist() != gs.choose_controls(stat, cols, seed=2, ctrl_size=3).tolist()
    # the order the signature is given in does not matter
    assert a.tolist() == gs.choose_controls(stat, cols[::-1], seed=1, ctrl_size=3).tolist()


def test_the_draw_is_pinned_so_a_stored_seed_means_the_same_controls_on_every_machine(ref):
    stat = (ref["x"] > 0).mean(axis=0)
    got = gs.choose_controls(stat, ref["common_cols"], seed=7, ctrl_size=2).tolist()
    assert got == PINNED_SEED_7


PINNED_SEED_7 = [8, 22, 40, 47, 49, 53, 73, 74, 88, 100, 110, 118, 131]


def test_a_gene_is_added_without_moving_the_controls_of_other_bins(ref):
    """A control's key depends on the gene and the seed only, so adding a gene to a bin the signature
    already holds does not change which genes are drawn in the other bins."""
    stat = (ref["x"] > 0).mean(axis=0)
    bins = gs.gene_bins(stat)
    cols = [int(c) for c in ref["common_cols"]]
    base = gs.choose_controls(stat, cols, seed=3, ctrl_size=2)
    twin = next(c for c in range(stat.size) if bins[c] in set(bins[cols]) and c not in cols)
    more = gs.choose_controls(stat, cols + [twin], seed=3, ctrl_size=2)
    other = [c for c in base if bins[c] != bins[twin]]
    assert [c for c in more if bins[c] != bins[twin]] == other


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
def test_the_score_is_the_signature_mean_less_the_control_mean(stores, ref, names, backend, layout):
    genes = [names[c] for c in ref["common_cols"]]
    _, result, progress = run(stores[backend, layout], {"genes": genes, "method": "control_adjusted", "seed": 4})
    assert result.controls and 0 < len(result.controls) <= gs.N_BINS * gs.CTRL_SIZE
    assert not set(result.controls) & set(ref["common_cols"])
    np.testing.assert_allclose(result.values, dense_score(ref["x"], ref["common_cols"], result.controls), **TOL)
    assert result.n_used == len(genes) and result.n_controls_used == len(result.controls)
    assert [g.name for g in result.genes] == genes, "the figures are the signature's, not the controls'"
    assert progress_ok(progress)


def progress_ok(progress):
    return progress[0][0] == 0 and progress[-1][0] == progress[-1][1] and progress[-1][1] > 0


def test_every_layout_draws_the_same_controls(stores, ref, names):
    genes = [names[c] for c in ref["mixed_cols"]]
    drawn = {key: run(path, {"genes": genes, "method": "control_adjusted", "seed": 9})[1].controls
             for key, path in stores.items()}
    assert len({tuple(v) for v in drawn.values()}) == 1


def test_a_csc_store_knows_its_controls_before_reading_and_others_after(stores, ref, names):
    genes = [names[c] for c in ref["common_cols"]]
    recipe = {"genes": genes, "method": "control_adjusted"}
    csc, csr = (get_reader(stores["zarr", k]) for k in ("csc", "csr"))
    p_csc = gs.plan(csc, stores["zarr", "csc"], gs.parse_recipe(recipe))
    p_csr = gs.plan(csr, stores["zarr", "csr"], gs.parse_recipe(recipe))
    assert p_csc.controls is not None and p_csc.stat_entries == 0
    assert p_csr.controls is None and p_csr.stat_entries > 0
    assert p_csc.estimate()["controls"] == len(p_csc.controls) and p_csr.estimate()["controls"] is None
    plain = gs.plan(csr, stores["zarr", "csr"], gs.parse_recipe({"genes": genes, "method": "mean"}))
    assert p_csr.entries > plain.entries, "the pass that bins the genes and the controls are in the estimate"


# --- the seed ------------------------------------------------------------------------------------------------

@pytest.fixture(scope="module")
def wide(tmp_path_factory):
    """Bins larger than the control size, so the seed matters."""
    return make_store(tmp_path_factory.mktemp("wide") / "w.zarr", wide_matrix(), "csc", var_names=wide_names())


def test_a_seed_gives_the_same_score_every_time_and_a_new_seed_a_new_draw(wide):
    path = wide
    genes = wide_names()[10:30]
    a = run(path, {"genes": genes, "method": "control_adjusted", "seed": 11})[1]
    b = run(path, {"genes": genes, "method": "control_adjusted", "seed": 11})[1]
    other = run(path, {"genes": genes, "method": "control_adjusted", "seed": 12})[1]
    np.testing.assert_array_equal(a.values, b.values)
    assert a.controls == b.controls
    assert a.controls != other.controls and not np.array_equal(a.values, other.values)


def test_no_seed_means_seed_zero():
    plain = gs.parse_recipe({"genes": ["A"], "method": "control_adjusted"})
    zero = gs.parse_recipe({"genes": ["A"], "method": "control_adjusted", "seed": 0})
    assert plain.effective_seed == 0 == zero.effective_seed
    assert plain.describe()["seed"] == 0
    assert gs.parse_recipe({"genes": ["A"], "method": "mean", "seed": 5}).effective_seed is None
    assert gs.parse_recipe({"genes": ["A"], "method": "mean", "seed": 5}).describe()["seed"] is None


def test_a_missing_seed_scores_as_seed_zero(stores, ref, names):
    genes = [names[c] for c in ref["common_cols"]]
    a = run(stores["zarr", "csc"], {"genes": genes, "method": "control_adjusted"})[1]
    b = run(stores["zarr", "csc"], {"genes": genes, "method": "control_adjusted", "seed": 0})[1]
    np.testing.assert_array_equal(a.values, b.values)


def test_the_seed_changes_nothing_for_the_other_methods(stores, ref, names):
    genes = [names[c] for c in ref["common_cols"]]
    for method in ("zscore_mean", "mean"):
        a = run(stores["zarr", "csc"], {"genes": genes, "method": method, "seed": 1})[1]
        b = run(stores["zarr", "csc"], {"genes": genes, "method": method, "seed": 2})[1]
        np.testing.assert_array_equal(a.values, b.values)


# --- the cells shown, edge cases -----------------------------------------------------------------------------

@pytest.mark.parametrize("layout", LAYOUTS)
def test_the_cells_shown_get_scores_over_the_whole_dataset(stores, ref, names, layout):
    genes = [names[c] for c in ref["common_cols"]]
    recipe = {"genes": genes, "method": "control_adjusted", "seed": 2}
    whole = run(stores["zarr", layout], recipe)[1]
    rows = np.array([0, 5, 17, 100, 199])
    shown = run(stores["zarr", layout], recipe, rows)[1]
    np.testing.assert_allclose(shown.values, whole.values[rows], rtol=1e-6, atol=1e-6)
    assert shown.n_shown == 5 and shown.n_cells == 200


@pytest.mark.parametrize("layout", LAYOUTS)
def test_a_signature_that_fills_every_bin_has_no_controls(stores, names, layout):
    _, result, _ = run(stores["zarr", layout], {"genes": names, "method": "control_adjusted"})
    assert result.values is None and result.reason == "no_control_genes"
    assert "control genes" in gs.NO_SCORE_MESSAGES["no_control_genes"]


def test_missing_genes_are_left_out_and_listed(stores, ref, names):
    genes = [names[c] for c in ref["common_cols"]] + ["NOT_A_GENE"]
    p, result, _ = run(stores["zarr", "csc"], {"genes": genes, "method": "control_adjusted"})
    assert p.missing == ["NOT_A_GENE"] and result.n_used == len(ref["common_cols"])
    _, none, _ = run(stores["zarr", "csc"], {"genes": ["NOT_A_GENE"], "method": "control_adjusted"})
    assert none.values is None and none.reason == "no_gene_present"


def test_a_constant_gene_stays_in_the_difference_as_it_does_in_the_mean(tmp_path):
    x = wide_matrix()                                                       # gene 2 holds 3.0 everywhere
    path = make_store(tmp_path / "const.zarr", x, "csc", var_names=wide_names())
    _, result, _ = run(path, {"genes": ["W0002", "W0008", "W0009"], "method": "control_adjusted"})
    assert result.n_used == 3 and result.controls
    np.testing.assert_allclose(result.values, dense_score(x, [2, 8, 9], result.controls), **TOL)


# --- what genes are binned by --------------------------------------------------------------------------------

@pytest.mark.parametrize("backend", BACKENDS)
def test_the_detection_rate_of_every_gene_is_the_same_on_every_layout(stores, ref, backend):
    want = (ref["x"] > 0).mean(axis=0)
    for layout in LAYOUTS:
        with gs.open_source(get_reader(stores[backend, layout]), stores[backend, layout], "X") as source:
            np.testing.assert_allclose(source.column_stat("detection"), want, rtol=0, atol=1e-12)


@pytest.mark.parametrize("backend", BACKENDS)
def test_the_mean_of_every_gene_ignores_missing_values_on_every_layout(tmp_path, backend):
    x = make_matrix()
    finite = np.isfinite(x)
    want = np.where(finite.any(axis=0), np.where(finite, x, 0).sum(axis=0) / np.maximum(finite.sum(axis=0), 1), np.nan)
    for layout in LAYOUTS:
        suffix = "zarr" if backend == "zarr" else "h5ad"
        path = make_store(tmp_path / f"m_{layout}.{suffix}", x, layout, backend)
        with gs.open_source(get_reader(path), path, "X") as source:
            np.testing.assert_allclose(source.column_stat("mean"), want, rtol=1e-6, equal_nan=True)


def test_a_wrong_binning_is_refused(stores):
    with pytest.raises(ValueError):
        gs.plan(get_reader(stores["zarr", "csc"]), stores["zarr", "csc"],
                gs.parse_recipe({"genes": ["G000"], "method": "control_adjusted"}), binning="median")
