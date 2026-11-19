"""What kind of numbers a matrix holds (annzarro/core/matrix_kind.py, gene_score.matrix_kinds).

The panel warns when the input a signature reads looks like raw counts. The rules were chosen on real matrices
(see the module); here they are pinned on synthetic ones of the same shapes, on every layout and both backends,
and for the layer the warning offers instead.
"""
import itertools

import numpy as np
import pytest

from annzarro.core import gene_score as gs
from annzarro.core import get_reader, matrix_kind as mk
from annzarro.tests import zarr_compat
from annzarro.tests.core.gene_score_store import BACKENDS, LAYOUTS, _write_matrix, make_store

RNG = np.random.default_rng(5)


def counts(shape=(200, 20), rate=3.0):
    """UMI-like counts: mostly zero, whole numbers, a few large."""
    x = RNG.poisson(rate, shape) * (RNG.random(shape) < 0.5)
    x[0, 0] = 120
    return x.astype(np.float32)


def normalise(x):
    return (x / np.maximum(x.sum(axis=1, keepdims=True), 1) * 1e4).astype(np.float32)


RAW = counts()
CP10K = normalise(RAW)
LOG = np.log1p(CP10K).astype(np.float32)
SCALED = ((LOG - LOG.mean(axis=0)) / (LOG.std(axis=0) + 1e-6)).astype(np.float32)


@pytest.mark.parametrize("name,matrix,kind", [
    ("raw counts", RAW, "counts"),
    ("normalised, not logged", CP10K, "normalised"),
    ("log-normalised", LOG, "log"),
    ("scaled", SCALED, "signed"),
])
def test_each_kind_of_matrix_is_told_apart(name, matrix, kind):
    assert mk.classify(matrix.ravel())["kind"] == kind, name


def test_the_figures_are_reported():
    info = mk.classify(RAW.ravel())
    assert info["whole"] == 1.0 and info["negative"] == 0.0 and info["max"] == 120.0 and info["min"] == 1.0
    assert info["n"] == int(np.count_nonzero(RAW))


def test_binary_and_small_whole_numbers_are_not_counts():
    binary = (RAW > 0).astype(np.float32)
    assert mk.classify(binary.ravel())["kind"] == "other"
    ordinal = np.minimum(RAW, 5)
    assert mk.classify(ordinal.ravel())["kind"] == "other"
    just_enough = ordinal.copy()
    just_enough[0, 0] = mk.COUNTS_MIN_MAX
    assert mk.classify(just_enough.ravel())["kind"] == "counts"


def test_a_few_non_whole_values_do_not_stop_counts_being_counts_but_many_do():
    x = RAW.copy().ravel()
    nz = np.flatnonzero(x)
    noisy = x.copy()
    noisy[nz[: int(0.005 * nz.size)]] += 0.5            # half a percent
    assert mk.classify(noisy)["kind"] == "counts"
    noisy[nz[: int(0.05 * nz.size)]] += 0.5             # five percent
    assert mk.classify(noisy)["kind"] != "counts"


def test_the_thresholds_between_log_and_normalised_and_signed():
    base = LOG.ravel().copy()
    assert mk.classify(base)["kind"] == "log"
    big = base.copy()
    big[np.flatnonzero(big)[0]] = mk.LOG_MAX
    assert mk.classify(big)["kind"] == "normalised"
    below = base.copy()
    below[np.flatnonzero(below)[0]] = mk.LOG_MAX - 0.5
    assert mk.classify(below)["kind"] == "log"
    nz = np.flatnonzero(base)
    one_percent = base.copy()
    one_percent[nz[: int(np.ceil(mk.NEGATIVE_SHARE * nz.size)) + 1]] *= -1
    assert mk.classify(one_percent)["kind"] == "signed"
    few = base.copy()
    few[nz[: int(0.002 * nz.size)]] *= -1
    assert mk.classify(few)["kind"] == "log"


def test_zeros_nan_and_infinity_are_not_looked_at_and_a_small_sample_says_nothing():
    padded = np.concatenate([RAW.ravel(), np.zeros(10_000), [np.nan, np.inf, -np.inf]])
    assert mk.classify(padded)["kind"] == "counts"
    assert mk.classify(np.array([1.0, 2.0, 3.0]))["kind"] == "unknown"
    assert mk.classify(np.zeros(1000))["kind"] == "unknown"
    assert mk.classify([])["kind"] == "unknown"


def test_a_layer_is_suggested_only_when_it_looks_log_transformed_and_its_name_says_so():
    assert mk.suggest({"raw_counts": "counts", "logged_counts": "log", "normalized_counts": "normalised"}) == "logged_counts"
    assert mk.suggest({"X_norm": "log", "logcounts": "log"}) == "logcounts", "log before norm"
    assert mk.suggest({"normalized": "log"}) == "normalized"
    assert mk.suggest({"MAGIC_imputed_data": "log", "kompot_de_smoothed": "log", "cc_counts": "log"}) is None, "looks are not enough"
    assert mk.suggest({"logged": "counts"}) is None
    assert mk.suggest({}) is None


def test_the_sample_pieces_are_spread_over_the_whole_array():
    assert mk.piece_starts(100) == [0]
    starts = mk.piece_starts(10_000_000)
    assert len(starts) == mk.SAMPLE_PIECES and starts[0] == 0 and starts[-1] == 10_000_000 - mk.SAMPLE_PIECE
    assert starts == sorted(starts)


# --- on the stores ------------------------------------------------------------------------------------------

@pytest.fixture(scope="module")
def stores(tmp_path_factory):
    base = tmp_path_factory.mktemp("mk")
    out = {}
    for backend, layout in itertools.product(BACKENDS, LAYOUTS):
        suffix = "zarr" if backend == "zarr" else "h5ad"
        out[backend, layout] = make_store(base / f"{layout}_{backend}.{suffix}", RAW, layout, backend, layer=CP10K)
    return out


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
def test_x_and_a_layer_are_read_as_what_they_are(stores, backend, layout):
    path = stores[backend, layout]
    reader = get_reader(path)
    assert gs.kind_of(reader, path, "X")["kind"] == "counts"
    assert gs.kind_of(reader, path, "counts")["kind"] == "normalised"
    assert gs.input_names(reader, path) == ["X", "counts"]


def test_a_missing_layer_is_a_key_error(stores):
    path = stores["zarr", "csc"]
    with pytest.raises(gs.ScoreError) as caught:
        gs.kind_of(get_reader(path), path, "nope")
    assert (caught.value.status, caught.value.reason) == (404, "key_not_found")


def test_counts_get_a_suggestion_when_a_named_layer_looks_log_normalised(tmp_path):
    path = make_store(tmp_path / "s.zarr", RAW, "csr", layer=CP10K)
    root = zarr_compat.open_group(path, mode="r+")
    _write_matrix(root["layers"], "logged_counts", LOG, "csr")
    _write_matrix(root["layers"], "MAGIC_imputed_data", LOG, "dense")
    zarr_compat.consolidate(path)
    reader = get_reader(path)
    got = gs.matrix_kinds(reader, path, "X")
    assert got["kind"] == "counts" and got["suggest"] == "logged_counts"
    assert got["checked"] == {"MAGIC_imputed_data": "log", "counts": "normalised", "logged_counts": "log"}
    assert got["stats"]["max"] == 120.0
    # from a layer, X is among the others
    again = gs.matrix_kinds(reader, path, "counts")
    assert again["kind"] == "normalised" and again["suggest"] == "logged_counts" and again["checked"]["X"] == "counts"
    # a matrix that is fine is not compared with anything
    fine = gs.matrix_kinds(reader, path, "logged_counts")
    assert fine["kind"] == "log" and fine["suggest"] is None and fine["checked"] == {}


def test_counts_without_a_named_layer_have_no_suggestion(stores):
    path = stores["zarr", "csc"]
    got = gs.matrix_kinds(get_reader(path), path, "X")
    assert got["kind"] == "counts" and got["suggest"] is None and got["checked"] == {"counts": "normalised"}
