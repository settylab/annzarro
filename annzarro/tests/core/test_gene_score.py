"""The gene score engine (annzarro/core/gene_score.py) against a dense float64 reference.

Every layout (csc, csr, dense) of both backends (zarr, h5ad), each method, several clip values and
the clip switched off; the edge cases of section 4.2 of the design; the recipe's validation; the
bounded read-ahead; and that the numbers do not depend on how the reading was scheduled.
"""
import itertools

import numpy as np
import pytest

from annzarro.core import gene_score as gs
from annzarro.core import get_reader
from annzarro.tests.core.gene_score_store import (BACKENDS, LAYOUTS, N_OBS, N_VAR, gene, make_matrix, make_store,
                                                  reference)

# float32 output, float64 arithmetic: differences are a few float32 ulps of values up to 10
TOL = dict(rtol=2e-6, atol=2e-6)


def run(path, recipe, rows=None, should_stop=None):
    """Plan and compute; returns (plan, result, [progress events])."""
    reader = get_reader(path)
    p = gs.plan(reader, path, gs.parse_recipe(recipe))
    progress, result = [], None
    for kind, payload in gs.compute(p, rows, should_stop):
        if kind == "progress":
            progress.append(payload)
        else:
            result = payload
    return p, result, progress


@pytest.fixture(scope="module")
def matrix():
    return make_matrix()


@pytest.fixture(scope="module")
def stores(tmp_path_factory, matrix):
    """One store per (backend, layout); module scope: they are only read."""
    base = tmp_path_factory.mktemp("gs")
    out = {}
    for backend, layout in itertools.product(BACKENDS, LAYOUTS):
        suffix = "zarr" if backend == "zarr" else "h5ad"
        out[backend, layout] = make_store(base / f"{layout}_{backend}.{suffix}", matrix, layout, backend,
                                          layer=np.round(matrix * 2).astype(np.float32))
    return out


GENES = [0, 1, 4, 6, 8, 9, 10, 15]          # common, rare+huge, NaNs, rare, random
KEEP = [gene(i) for i in GENES]


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
@pytest.mark.parametrize("method,clip", [("zscore_mean", 10), ("zscore_mean", 3.5), ("zscore_mean", None),
                                         ("zscore_mean", 0.25), ("mean", 10), ("mean", None)])
def test_matches_the_dense_reference(stores, matrix, backend, layout, method, clip):
    _, result, _ = run(stores[backend, layout], {"genes": KEEP, "method": method, "clip": clip})
    want, used = reference(matrix, GENES, method, clip)
    assert result.values.dtype == np.float32 and result.values.shape == (N_OBS,)
    np.testing.assert_allclose(result.values, want, **TOL)
    assert result.n_used == len(used)


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
def test_clip_changes_the_score_only_where_a_z_score_is_beyond_it(stores, backend, layout):
    path = stores[backend, layout]
    _, tight, _ = run(path, {"genes": KEEP, "clip": 2})
    _, loose, _ = run(path, {"genes": KEEP, "clip": None})
    assert not np.allclose(tight.values, loose.values)
    clipped = {g.name: g.clipped for g in tight.genes}
    assert clipped[gene(1)] > 0                   # the rare gene with one huge value
    assert all(g.clipped is None for g in loose.genes)


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
@pytest.mark.parametrize("clip", [10, 0.05, None])
def test_gene_figures_are_those_of_the_whole_dataset(stores, matrix, backend, layout, clip):
    """Mean, SD, detection and the share of cells beyond the clip, over every cell, zeros included."""
    cols = [0, 1, 4, 6, 8]
    _, result, _ = run(stores[backend, layout], {"genes": [gene(c) for c in cols], "clip": clip},
                       rows=np.array([1, 2, 3]))
    by_name = {g.name: g for g in result.genes}
    for c in cols:
        col = matrix[:, c].astype(np.float64)
        ok = np.isfinite(col)
        mean, sd = col[ok].mean(), col[ok].std()
        stat = by_name[gene(c)]
        assert stat.status == "used"
        assert stat.mean == pytest.approx(mean, rel=1e-9) and stat.sd == pytest.approx(sd, rel=1e-9)
        assert stat.detected == pytest.approx(np.count_nonzero(col[ok]) / N_OBS)
        if clip is None:
            assert stat.clipped is None
        else:
            assert stat.clipped == pytest.approx((np.abs((col[ok] - mean) / sd) > clip).sum() / N_OBS)


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
def test_the_cells_shown_get_scores_over_the_whole_dataset(stores, matrix, backend, layout):
    """Mean and SD come from every cell: a subset's score is the full score at its rows."""
    rows = np.array([0, 3, 17, 18, 40, 41, 90, 199])
    _, full, _ = run(stores[backend, layout], {"genes": KEEP})
    _, sub, _ = run(stores[backend, layout], {"genes": KEEP}, rows=rows)
    assert sub.values.shape == (len(rows),) and sub.n_shown == len(rows) and sub.n_cells == N_OBS
    np.testing.assert_array_equal(sub.values, full.values[rows])
    want, _ = reference(matrix, GENES)
    np.testing.assert_allclose(sub.values, want[rows], **TOL)


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
def test_an_empty_subset_scores_no_cells(stores, backend, layout):
    _, result, _ = run(stores[backend, layout], {"genes": KEEP}, rows=np.array([], dtype=np.int64))
    assert result.values.shape == (0,)


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
def test_a_layer_is_scored_like_x(stores, matrix, backend, layout):
    counts = np.round(matrix * 2).astype(np.float32)
    _, result, _ = run(stores[backend, layout], {"genes": KEEP, "input": "counts"})
    want, _ = reference(counts, GENES)
    np.testing.assert_allclose(result.values, want, **TOL)


def test_a_missing_layer_is_a_key_error(stores):
    with pytest.raises(gs.ScoreError) as caught:
        run(stores["zarr", "csc"], {"genes": KEEP, "input": "nope"})
    assert (caught.value.status, caught.value.reason) == (404, "key_not_found")


# --- edge cases (design 4.2) ------------------------------------------------------------------

@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
def test_constant_genes_leave_the_z_score_mean_and_are_listed(stores, matrix, backend, layout):
    genes = [gene(0), gene(2), gene(3), gene(8)]        # common, constant 3.0, all zero, random
    _, result, _ = run(stores[backend, layout], {"genes": genes})
    status = {g.name: g.status for g in result.genes}
    assert status == {gene(0): "used", gene(2): "constant", gene(3): "constant", gene(8): "used"}
    want, used = reference(matrix, [0, 2, 3, 8])
    assert used == [0, 8]
    np.testing.assert_allclose(result.values, want, **TOL)
    assert result.n_used == 2


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
def test_the_mean_keeps_constant_genes(stores, matrix, backend, layout):
    genes = [gene(0), gene(2), gene(3)]
    _, result, _ = run(stores[backend, layout], {"genes": genes, "method": "mean"})
    want, used = reference(matrix, [0, 2, 3], "mean")
    assert used == [0, 2, 3]
    np.testing.assert_allclose(result.values, want, **TOL)


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
def test_genes_missing_from_the_dataset_are_listed_and_ignored(stores, matrix, backend, layout):
    plan_, result, _ = run(stores[backend, layout], {"genes": [gene(0), "NOT_A_GENE", gene(8), "gene000"]})
    assert plan_.missing == ["NOT_A_GENE", "gene000"]        # names match exactly: case is the caller's concern
    want, _ = reference(matrix, [0, 8])
    np.testing.assert_allclose(result.values, want, **TOL)
    assert [g.name for g in result.genes] == [gene(0), gene(8)]


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
def test_nan_is_ignored_per_gene_and_a_cell_averages_the_genes_it_has(stores, matrix, backend, layout):
    genes = [4, 8, 9]
    _, result, _ = run(stores[backend, layout], {"genes": [gene(g) for g in genes]})
    want, _ = reference(matrix, genes)
    np.testing.assert_allclose(result.values, want, **TOL)
    assert np.isfinite(result.values).all()
    # the cells with a NaN in gene 4 score from the other two genes alone
    only_rest, _ = reference(matrix, [8, 9])
    np.testing.assert_allclose(result.values[[5, 40]], only_rest[[5, 40]], **TOL)
    _, shown, _ = run(stores[backend, layout], {"genes": [gene(g) for g in genes]}, rows=np.array([5, 40, 41]))
    np.testing.assert_allclose(shown.values, want[[5, 40, 41]], **TOL)


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
def test_a_cell_with_no_finite_gene_scores_nan(stores, matrix, backend, layout):
    """Gene 7 holds +inf in cell 60 and gene 4 NaN in cell 40: a signature of those two leaves cell 60 and
    cell 40 each with one gene; a cell missing every gene is NaN."""
    both = np.array(matrix)
    both[[40, 60], 4] = np.nan
    both[[40, 60], 7] = np.nan
    path = stores[backend, layout].replace(".zarr", "_nan.zarr").replace(".h5ad", "_nan.h5ad")
    make_store(path, both, layout, backend)
    _, result, _ = run(path, {"genes": [gene(4), gene(7)]})
    assert np.isnan(result.values[[40, 60]]).all()
    want, _ = reference(both, [4, 7])
    np.testing.assert_allclose(result.values, want, equal_nan=True, **TOL)


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
def test_infinity_is_a_missing_value(stores, matrix, backend, layout):
    _, result, _ = run(stores[backend, layout], {"genes": [gene(7), gene(8)]})
    want, _ = reference(matrix, [7, 8])
    np.testing.assert_allclose(result.values, want, **TOL)
    assert np.isfinite(result.values[60])             # cell 60 has +inf in gene 7 and still scores from gene 8


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
def test_a_gene_with_no_values_is_excluded_and_listed(stores, matrix, backend, layout):
    _, result, _ = run(stores[backend, layout], {"genes": [gene(5), gene(8)]})
    assert {g.name: g.status for g in result.genes} == {gene(5): "no_values", gene(8): "used"}
    want, _ = reference(matrix, [5, 8])
    np.testing.assert_allclose(result.values, want, **TOL)


@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
@pytest.mark.parametrize("genes,reason", [
    ([], "empty_signature"),
    (["X1", "X2"], "no_gene_present"),                    # all missing
    ([gene(2), gene(3)], "no_usable_gene"),               # all constant
    ([gene(5)], "no_usable_gene"),                        # all NaN
])
def test_no_score_says_why_and_is_never_zeros(stores, backend, layout, genes, reason):
    _, result, progress = run(stores[backend, layout], {"genes": genes})
    assert result.values is None and result.reason == reason
    assert reason in gs.NO_SCORE_MESSAGES


@pytest.mark.parametrize("backend", BACKENDS)
@pytest.mark.parametrize("layout", LAYOUTS)
def test_a_repeated_name_in_var_uses_the_first(tmp_path, matrix, backend, layout):
    names = [gene(i) for i in range(N_VAR)]
    names[12] = names[8]                                   # GENE008 twice: columns 8 and 12
    path = make_store(tmp_path / f"d.{'zarr' if backend == 'zarr' else 'h5ad'}", matrix, layout, backend,
                      var_names=names)
    plan_, result, _ = run(path, {"genes": [gene(8), gene(9)]})
    assert plan_.duplicated == [gene(8)]
    assert plan_.columns == [8, 9]
    want, _ = reference(matrix, [8, 9])
    np.testing.assert_allclose(result.values, want, **TOL)


def test_a_repeated_name_in_the_request_counts_once(stores):
    _, once, _ = run(stores["zarr", "csc"], {"genes": [gene(8), gene(9)]})
    plan_, twice, _ = run(stores["zarr", "csc"], {"genes": [gene(8), gene(9), gene(8)]})
    np.testing.assert_array_equal(once.values, twice.values)
    assert plan_.recipe.genes == (gene(8), gene(9))


def test_stored_zero_entries_and_unsorted_repeated_rows_are_read_as_scipy_does():
    rows, vals = gs._canonical(np.array([5, 2, 5, 9]), np.array([1.0, 2.0, 3.0, 4.0]))
    assert rows.tolist() == [2, 5, 9] and vals.tolist() == [2.0, 4.0, 4.0]
    same = np.array([1, 4, 8])
    got, _ = gs._canonical(same, np.array([1.0, 2.0, 3.0]))
    assert got is same


# --- the numbers do not depend on the schedule -----------------------------------------------------

@pytest.mark.parametrize("backend,layout", list(itertools.product(BACKENDS, LAYOUTS)))
def test_the_score_is_the_same_whatever_the_threads_and_read_ahead(stores, monkeypatch, backend, layout):
    """Same recipe, same bits: threads, read-ahead and batching change only the schedule. (The seed is
    carried for control-adjusted scoring and does not change a method that draws nothing.)"""
    path = stores[backend, layout]
    recipe = {"genes": KEEP, "seed": 7}
    _, base, _ = run(path, recipe)
    _, again, _ = run(path, recipe)
    np.testing.assert_array_equal(base.values, again.values)
    _, other_seed, _ = run(path, {**recipe, "seed": 123456789})
    np.testing.assert_array_equal(base.values, other_seed.values)
    monkeypatch.setattr(gs, "READ_THREADS", 1)
    monkeypatch.setattr(gs, "READ_AHEAD_ENTRIES", 1)
    monkeypatch.setattr(gs, "MAX_BATCH_GENES", 1)
    monkeypatch.setattr(gs, "GROUP_GAP_ENTRIES", 0)
    _, serial, _ = run(path, recipe)
    np.testing.assert_array_equal(base.values, serial.values)
    monkeypatch.setattr(gs, "READ_THREADS", 8)
    monkeypatch.setattr(gs, "READ_AHEAD_ENTRIES", 10 ** 9)
    monkeypatch.setattr(gs, "MAX_BATCH_GENES", 64)
    _, wide, _ = run(path, recipe)
    np.testing.assert_array_equal(base.values, wide.values)


@pytest.mark.parametrize("layout", LAYOUTS)
def test_a_float32_sum_agrees_with_float64(stores, monkeypatch, matrix, layout):
    monkeypatch.setattr(gs, "FLOAT64_CELLS", 0)
    _, result, _ = run(stores["zarr", layout], {"genes": KEEP})
    want, _ = reference(matrix, GENES)
    np.testing.assert_allclose(result.values, want, rtol=1e-5, atol=1e-5)


def test_read_ahead_is_bounded(stores, monkeypatch):
    path = stores["zarr", "csc"]
    monkeypatch.setattr(gs, "GROUP_GAP_ENTRIES", 0)
    monkeypatch.setattr(gs, "READ_THREADS", 8)
    reader = get_reader(path)
    p = gs.plan(reader, path, gs.parse_recipe({"genes": [gene(i) for i in range(N_VAR)]}))
    with gs.open_source(reader, path, "X") as source:
        sizes = sorted(t.entries for t in source.tasks(p.columns))
    biggest = sizes[-1]
    budget = biggest + 5
    monkeypatch.setattr(gs, "READ_AHEAD_ENTRIES", budget)
    _, result, _ = run(path, {"genes": [gene(i) for i in range(N_VAR)]})
    assert 0 < result.max_in_flight_entries <= budget
    monkeypatch.setattr(gs, "READ_AHEAD_ENTRIES", 1)       # smaller than any gene: one read at a time
    _, one, _ = run(path, {"genes": [gene(i) for i in range(N_VAR)]})
    assert one.max_in_flight_entries <= biggest
    np.testing.assert_array_equal(one.values, result.values)


def test_progress_runs_from_zero_to_the_gene_count(stores):
    _, _, progress = run(stores["zarr", "csc"], {"genes": KEEP})
    assert progress[0] == (0, len(KEEP)) and progress[-1] == (len(KEEP), len(KEEP))
    done = [d for d, _ in progress]
    assert done == sorted(done)


def test_stopping_between_reads_raises_and_closing_stops_the_work(stores, monkeypatch):
    monkeypatch.setattr(gs, "MAX_BATCH_GENES", 1)
    monkeypatch.setattr(gs, "GROUP_GAP_ENTRIES", 0)
    path = stores["zarr", "csc"]
    calls = []

    def stop():
        calls.append(1)
        return len(calls) > 2
    with pytest.raises(gs.ScoreCancelled):
        run(path, {"genes": KEEP}, should_stop=stop)
    assert len(calls) == 3
    p = gs.plan(get_reader(path), path, gs.parse_recipe({"genes": KEEP}))
    events = gs.compute(p)
    assert next(events)[0] == "progress"
    events.close()                                         # a closed connection: no error, no more work


# --- the plan and its estimate ----------------------------------------------------------------------

def test_csc_entries_are_the_stored_entries_of_the_genes(stores, matrix):
    p = gs.plan(get_reader(stores["zarr", "csc"]), stores["zarr", "csc"], gs.parse_recipe({"genes": KEEP}))
    assert p.layout == "csc" and p.entries == int(np.count_nonzero(matrix[:, GENES]))
    assert p.n_obs == N_OBS and p.columns == sorted(GENES)


def test_csr_entries_count_one_scan_of_the_whole_matrix_per_batch(stores, matrix, monkeypatch):
    path = stores["zarr", "csr"]
    recipe = gs.parse_recipe({"genes": KEEP})
    p = gs.plan(get_reader(path), path, recipe)
    nnz = int(np.count_nonzero(matrix))
    assert p.layout == "csr" and p.entries == nnz          # all eight genes fit one batch
    monkeypatch.setattr(gs, "MAX_BATCH_GENES", 3)
    p = gs.plan(get_reader(path), path, recipe)
    assert p.entries == 3 * nnz                            # ceil(8 / 3) scans


def test_dense_entries_count_the_chunks_read(stores):
    p = gs.plan(get_reader(stores["zarr", "dense"]), stores["zarr", "dense"], gs.parse_recipe({"genes": KEEP}))
    assert p.layout == "dense" and p.entries == N_OBS * N_VAR     # chunks span every gene of a row block


def test_the_tiers_follow_the_estimated_seconds(stores, monkeypatch):
    path = stores["zarr", "csc"]
    recipe = gs.parse_recipe({"genes": KEEP})
    p = gs.plan(get_reader(path), path, recipe)
    assert p.tier == "auto" and p.estimate()["tier"] == "auto"
    for rate, tier in ((p.entries / 100.0, "confirm"), (p.entries / 5000.0, "refused")):
        monkeypatch.setitem(gs.RATES, "csc", rate)
        assert gs.plan(get_reader(path), path, recipe).tier == tier
    assert gs.tier_of(gs.AUTO_MAX_S) == "auto" and gs.tier_of(gs.AUTO_MAX_S + 0.01) == "confirm"
    assert gs.tier_of(gs.CONFIRM_MAX_S) == "confirm" and gs.tier_of(gs.CONFIRM_MAX_S + 0.01) == "refused"


def test_a_remote_store_is_estimated_slower():
    assert gs.estimate_seconds("csc", 10 ** 8, True) > 5 * gs.estimate_seconds("csc", 10 ** 8, False)


# --- the recipe --------------------------------------------------------------------------------------

def test_defaults_and_effective_clip():
    r = gs.parse_recipe({"genes": ["A", "B", "A"]})
    assert (r.genes, r.down, r.input, r.method, r.clip, r.seed, r.version) == \
        (("A", "B"), (), "X", "zscore_mean", 10.0, None, gs.ALGORITHM_VERSION)
    assert r.effective_clip == 10.0
    assert gs.parse_recipe({"genes": ["A"], "method": "mean", "clip": 4}).effective_clip is None
    assert gs.parse_recipe({"genes": ["A"], "clip": None}).clip is None
    assert gs.parse_recipe({"genes": ["A"], "clip": 2}).clip == 2.0 and gs.parse_recipe({"genes": ["A"], "title": "t"})


@pytest.mark.parametrize("clip", [0, -1, -0.001, True, False, "10", [], {}, float("nan"), float("inf"), float("-inf")])
def test_a_clip_must_be_a_positive_finite_number_or_null(clip):
    with pytest.raises(gs.ScoreError) as caught:
        gs.parse_recipe({"genes": ["A"], "clip": clip})
    assert (caught.value.status, caught.value.reason) == (400, "bad_clip")
    assert "above 0" in caught.value.message


@pytest.mark.parametrize("clip", [0.001, 1, 2.5, 10, 1e9])
def test_any_positive_clip_is_accepted(clip):
    assert gs.parse_recipe({"genes": ["A"], "clip": clip}).clip == float(clip)


@pytest.mark.parametrize("recipe,status,reason", [
    (None, 400, "bad_recipe"), ([], 400, "bad_recipe"), ({}, 400, "bad_recipe"),
    ({"genes": "A"}, 400, "bad_recipe"), ({"genes": [1]}, 400, "bad_recipe"), ({"genes": [None]}, 400, "bad_recipe"),
    ({"genes": ["x" * 1001]}, 400, "bad_recipe"), ({"genes": ["A"], "extra": 1}, 400, "bad_recipe"),
    ({"genes": ["A"], "input": ""}, 400, "bad_recipe"), ({"genes": ["A"], "input": 3}, 400, "bad_recipe"),
    ({"genes": ["A"], "method": "median"}, 400, "bad_method"),
    ({"genes": ["A"], "method": "control_adjusted"}, 400, "method_not_available"),
    ({"genes": ["A"], "down": ["B"]}, 400, "down_not_available"),
    ({"genes": ["A"], "down": "B"}, 400, "bad_recipe"),
    ({"genes": ["A"], "seed": -1}, 400, "bad_seed"), ({"genes": ["A"], "seed": 1.5}, 400, "bad_seed"),
    ({"genes": ["A"], "seed": True}, 400, "bad_seed"), ({"genes": ["A"], "seed": 2 ** 63}, 400, "bad_seed"),
    ({"genes": ["A"], "version": 2}, 400, "unsupported_version"),
    ({"genes": ["A"], "version": "1"}, 400, "unsupported_version"),
])
def test_a_bad_recipe_is_refused_with_a_reason(recipe, status, reason):
    with pytest.raises(gs.ScoreError) as caught:
        gs.parse_recipe(recipe)
    assert (caught.value.status, caught.value.reason) == (status, reason)


def test_the_gene_limit_counts_distinct_names():
    gs.parse_recipe({"genes": [f"G{i}" for i in range(gs.MAX_GENES)]})
    gs.parse_recipe({"genes": [f"G{i}" for i in range(gs.MAX_GENES)] * 3})      # the same names again cost nothing
    with pytest.raises(gs.ScoreError) as caught:
        gs.parse_recipe({"genes": [f"G{i}" for i in range(gs.MAX_GENES + 1)]})
    assert (caught.value.status, caught.value.reason) == (413, "too_many_genes")
    assert caught.value.extra == {"limit": 2000, "requested": 2001}


def test_a_seed_is_part_of_the_format_and_kept():
    assert gs.parse_recipe({"genes": ["A"], "seed": 42}).seed == 42
