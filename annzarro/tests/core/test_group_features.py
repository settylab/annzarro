"""Features and measures per group (annzarro/core/group_features.py): SHR-19 to SHR-21, CMP-2, CMP-16.

The moments ``[n, sum, sumsq, n_above, sum_above]`` per group are checked against F0's dense reference
(``grouping_store.reference_groups``, the named recipes of ``tests/data/grouping_expected.json``) in every layout and
backend, against a seeded sweep of recipes, features and cells shown, and against R2's scanpy oracle
(``tests/data/oracle/dotplot_matrixplot.npz``): every statistic scanpy's ``DotPlot`` and ``MatrixPlot`` write is
derived from the moments and must agree within 1e-9 relative. By hand: non-finite values, negative thresholds, score
features and measures, measures per grid cell up to the limit, a read shared by the features that want one gene,
the pause between batches, the segments of one gene, the lane and the estimate, and the reply.
"""
import base64
import itertools
import json
import os
import threading
import tracemalloc

import numpy as np
import pytest

from annzarro.core import cell_groups as cg
from annzarro.core import gene_score as gsc
from annzarro.core import get_reader
from annzarro.core import group_features as gf      # fails on the base: the module does not exist
from annzarro.tests.core import grouping_store as gs


EXPECTED = json.load(open(gs.EXPECTED_PATH, encoding="utf-8"))
LAYOUT_BACKEND = list(itertools.product(gs.LAYOUTS, gs.BACKENDS))
ORACLE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "oracle")
ORACLE = np.load(os.path.join(ORACLE_DIR, "dotplot_matrixplot.npz"), allow_pickle=False)
RTOL = 1e-9


@pytest.fixture(scope="module")
def data():
    return gs.make_data()


@pytest.fixture(scope="module")
def stores(tmp_path_factory):
    base = tmp_path_factory.mktemp("gf")
    return {(lay, be): gs.make_store(base / f"{lay}_{be}.{'zarr' if be == 'zarr' else 'h5ad'}", lay, be)
            for lay, be in LAYOUT_BACKEND}


@pytest.fixture(scope="module")
def store(stores):
    return stores["csc", "zarr"]


def body(parts, features=(), measures=(), **kw):
    out = {"shape": "grouping", "partitionings": parts}
    if features:
        out["features"] = list(features)
    if measures:
        out["measures"] = list(measures)
    out.update(kw)
    return out


def plan(path, parts, features=(), measures=(), **kw):
    return gf.plan(get_reader(path), path, cg.parse_request(body(parts, features, measures, **kw)))


def run(path, parts, features=(), measures=(), rows=None, codes=None, should_stop=None, pause=None,
        on_entries=None, **kw):
    p = plan(path, parts, features, measures, **kw)
    events = list(gf.compute(p, rows, codes=codes, should_stop=should_stop, pause=pause, on_entries=on_entries))
    kinds = [e for e, _ in events]
    assert kinds[-1] == "result" and set(kinds[:-1]) <= {"progress"}
    return events[-1][1]


def gene_feature(fid, name, layer="X", detect_above=None):
    f = {"id": fid, "kind": "gene", "name": name, "layer": layer}
    if detect_above is not None:
        f["detect_above"] = detect_above
    return f


def bitset(mask):
    mask = np.asarray(mask, dtype=bool)
    return {"encoding": "bitset-base64", "length": int(mask.size),
            "data": base64.b64encode(np.packbits(mask, bitorder="little").tobytes()).decode()}


def ref_moments(values, cell_group, n_groups, above):
    """The moments of ``values`` (one per cell shown) per group, by definition."""
    return np.array([gs.moments(values[cell_group == g], above) for g in range(n_groups)], dtype=np.float64)


def group_of_cells(res):
    """Per cell shown: the group index, -1 when in none."""
    codes = res.grouping.codes.astype(np.int64)
    codes[codes == (0xFF if res.grouping.codes.dtype == np.uint8 else 0xFFFF)] = -1
    return codes


def close(mine, want, rtol=RTOL):
    np.testing.assert_allclose(np.asarray(mine, dtype=np.float64), np.asarray(want, dtype=np.float64),
                               rtol=rtol, atol=1e-12)


# --------------------------------------------------------------------------------------------- the dense reference

NAMED = [n for n, r in EXPECTED["grouping"].items() if "refused" not in r]


@pytest.mark.parametrize("layout,backend", LAYOUT_BACKEND)
@pytest.mark.parametrize("name", NAMED)
def test_named_recipes_give_the_reference_moments(stores, layout, backend, name):
    entry = EXPECTED["grouping"][name]
    recipe = entry["recipe"]
    feats = [gene_feature(f["id"], f["name"], f["layer"], f["detect_above"]) for f in EXPECTED["features"]]
    res = run(stores[layout, backend], recipe["partitionings"], feats, rows=gs.recipe_rows(recipe),
              small=recipe.get("small"))
    assert res.refused is None
    assert [g["key"] for g in res.grouping.groups] == [g["key"] for g in entry["groups"]]
    assert res.feature_moments.shape == (len(feats), len(entry["groups"]), 5)
    for i, f in enumerate(EXPECTED["features"]):
        close(res.feature_moments[i], np.asarray(entry["moments"][f["id"]], dtype=np.float64).reshape(-1, 5),
              rtol=1e-12)
    assert [s["status"] for s in res.features] == ["ok"] * len(feats)


SWEEP_PARTS = [
    [{"source": {"type": "obs", "key": "cell_type"}}],
    [{"source": {"type": "obs", "key": "cell_type"}}, {"source": {"type": "obs", "key": "condition"}}],
    [{"source": {"type": "obs", "key": "sample"}}],
    [{"source": {"type": "obs", "key": "pseudotime"}, "binning": {"method": "equal_count", "bins": 5}}],
    [{"source": {"type": "obs", "key": "cell_type"}, "levels": ["c:NK cell", "c:B cell"], "rest": "exclude"}],
    [{"source": {"type": "obs", "key": "cell_type"}}, {"source": {"type": "obs", "key": "sample"}}],
]


@pytest.mark.parametrize("seed", range(24))
def test_seeded_features_match_the_dense_reference(stores, data, seed):
    rng = np.random.default_rng(seed)
    layout, backend = LAYOUT_BACKEND[seed % len(LAYOUT_BACKEND)]
    parts = SWEEP_PARTS[seed % len(SWEEP_PARTS)]
    small = [None, {"threshold": 10, "mode": "collect"}, {"threshold": 10, "mode": "hide"}][seed % 3]
    rows = None if seed % 2 else np.sort(rng.choice(gs.N_OBS, int(rng.integers(1, gs.N_OBS)), replace=False))
    feats = []
    for i in range(int(rng.integers(1, 9))):
        layer = ["X", "logged", "counts"][int(rng.integers(3))]
        t = float(rng.choice([0.0, 0.5, 1.0, -0.5, 2.0]))
        feats.append(gene_feature(f"f{i}", gs.gene(int(rng.integers(gs.N_VAR))), layer, t))
    res = run(stores[layout, backend], parts, feats, rows=rows, small=small)
    cell_group = group_of_cells(res)
    shown = np.arange(gs.N_OBS) if rows is None else rows
    k = len(res.grouping.groups)
    for i, f in enumerate(feats):
        col = data.layer(f["layer"])[shown, data.var_names.index(f["name"])].astype(np.float64)
        close(res.feature_moments[i], ref_moments(col, cell_group, k, f["detect_above"]))


# --------------------------------------------------------------------------------------------- R2's scanpy oracle

def _oracle_grouping(groupby):
    """Partitionings (and sets) that give the oracle's groupby, groups in the oracle's order."""
    if groupby in ("cell_type", "condition"):
        return [{"source": {"type": "obs", "key": groupby}}], {}
    if groupby == "score_bin":
        return [{"source": {"type": "obs", "key": "score"}, "binning": {"method": "equal_width", "bins": 4}}], {}
    first2, first5 = np.zeros(gs.N_OBS, bool), np.zeros(gs.N_OBS, bool)
    first2[:2], first5[:5] = True, True
    return ([{"source": {"type": "table", "ref": "a"}}, {"source": {"type": "table", "ref": "b"}}],
            {"a": bitset(first2), "b": bitset(first5)})


def _scaled(df, how):
    """scanpy's ``standard_scale``: per gene (``var``) or per group (``group``), minus the minimum, over the maximum;
    a 0/0 is 0 (``fillna(0)``)."""
    if how == "none":
        return df
    axis = 0 if how == "var" else 1
    out = df - np.nanmin(df, axis=axis, keepdims=True)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = out / np.nanmax(out, axis=axis, keepdims=True)
    return np.nan_to_num(out, nan=0.0)


@pytest.mark.parametrize("layout,backend", [("csc", "zarr"), ("csr", "h5ad"), ("dense", "zarr")])
@pytest.mark.parametrize("layer", ["X", "logged", "counts"])
@pytest.mark.parametrize("groupby", ["cell_type", "condition", "score_bin", "tiny"])
def test_scanpy_oracle_within_1e9_relative(stores, layout, backend, layer, groupby):
    genes = [str(g) for g in ORACLE["genes"]]
    parts, sets = _oracle_grouping(groupby)
    path = stores[layout, backend]
    for cut in (0.0, 0.5):
        feats = [gene_feature(f"g{j}", g, layer, cut) for j, g in enumerate(genes)]
        res = run(path, parts, feats, sets=sets, want={"codes": True})
        assert [g["n"] for g in res.grouping.groups] == ORACLE[f"n_cells__{groupby}"].tolist()
        if groupby == "score_bin":
            assert group_of_cells(res).tolist() == ORACLE["score_bin_codes"].astype(int).tolist()
        m = res.feature_moments.transpose(1, 0, 2)                      # groups x genes x 5
        n, s, n_above, s_above = m[..., 0], m[..., 1], m[..., 3], m[..., 4]
        mean = s / n
        fraction = n_above / n
        with np.errstate(invalid="ignore", divide="ignore"):
            mean_expressing = np.where(n_above > 0, s_above / np.maximum(n_above, 1), 0.0)    # P3: 0, as scanpy
        for ss in ("none", "var", "group"):
            key = f"dot__{layer}__{groupby}__cut{cut}"
            close(_scaled(mean, ss), ORACLE[f"{key}__mo0__ss{ss}__color"])
            close(_scaled(mean_expressing, ss), ORACLE[f"{key}__mo1__ss{ss}__color"])
            close(fraction, ORACLE[f"{key}__mo0__ss{ss}__size"])
            close(fraction, ORACLE[f"{key}__mo1__ss{ss}__size"])
            if cut == 0.0:
                close(_scaled(mean, ss), ORACLE[f"matrix__{layer}__{groupby}__ss{ss}"])


def test_a_group_with_no_expressing_cell_has_cells_and_no_value_above(store):
    """P3 is the browser's rule; the server's part is that such a group has n > 0 and n_above = sum_above = 0."""
    parts, sets = _oracle_grouping("tiny")
    res = run(store, parts, [gene_feature("f", gs.gene(3), "logged")], sets=sets)
    m = res.feature_moments[0]
    assert (m[:, 0] > 0).all() and (m[:, 3] == 0).all() and (m[:, 4] == 0).all()


# --------------------------------------------------------------------------------------------- non-finite values

def _with_non_finite(data):
    x, logged = data.x.copy(), data.logged.copy()
    rng = np.random.default_rng(4)
    for arr in (x, logged):
        idx = rng.choice(arr.size, 600, replace=False)
        arr.flat[idx[:300]] = np.nan
        arr.flat[idx[300:450]] = np.inf
        arr.flat[idx[450:]] = -np.inf
    x[:, 7] = np.nan                                               # a gene with no finite value at all
    return gs.GroupingData(data.obs, x, logged, data.counts, data.obsm, data.obsp)


@pytest.mark.parametrize("layout,backend", LAYOUT_BACKEND)
def test_non_finite_values_are_left_out_of_every_moment(tmp_path, data, layout, backend):
    nf = _with_non_finite(data)
    path = gs.make_store(tmp_path / f"nf.{'zarr' if backend == 'zarr' else 'h5ad'}", layout, backend, data=nf)
    feats = [gene_feature("a", gs.gene(1), "X", 0.0), gene_feature("b", gs.gene(2), "logged", 0.5),
             gene_feature("c", gs.gene(2), "X", -0.5), gene_feature("d", gs.gene(7), "X", -1.0)]
    rows = np.arange(0, gs.N_OBS, 2)
    res = run(path, [{"source": {"type": "obs", "key": "cell_type"}}], feats, rows=rows)
    cell_group = group_of_cells(res)
    k = len(res.grouping.groups)
    for i, f in enumerate(feats):
        col = nf.layer(f["layer"])[rows, nf.var_names.index(f["name"])].astype(np.float64)
        close(res.feature_moments[i], ref_moments(col, cell_group, k, f["detect_above"]))
    assert (res.feature_moments[3] == 0).all()                    # no finite value: n is 0, so the browser shows none


@pytest.mark.parametrize("layout", gs.LAYOUTS)
def test_a_negative_threshold_counts_the_zeros_a_sparse_store_does_not_hold(stores, data, layout):
    feats = [gene_feature("f", gs.gene(9), "counts", -1.0), gene_feature("g", gs.gene(9), "X", -0.25)]
    res = run(stores[layout, "zarr"], [{"source": {"type": "obs", "key": "condition"}}], feats)
    cg_ = group_of_cells(res)
    for i, f in enumerate(feats):
        col = data.layer(f["layer"])[:, 9].astype(np.float64)
        close(res.feature_moments[i], ref_moments(col, cg_, 2, f["detect_above"]))
    assert (res.feature_moments[0][:, 3] == res.feature_moments[0][:, 0]).all()     # every counts value is above -1


# --------------------------------------------------------------------------------------------- one read per gene

class ReadCounter:
    """Counts the genes each matrix read delivers, and the reads running at once."""

    def __init__(self, monkeypatch):
        self.genes = []
        self.running = 0
        self.lock = threading.Lock()
        original = gsc.open_source
        counter = self

        class Wrapped:
            def __init__(self, inner):
                self.inner = inner

            def __enter__(self):
                source = self.inner.__enter__()
                tasks = source.tasks

                def counted(cols):
                    out = []
                    for t in tasks(cols):
                        def read(t=t):
                            with counter.lock:
                                counter.running += 1
                            try:
                                got = t.read()
                            finally:
                                with counter.lock:
                                    counter.running -= 1
                            counter.genes.extend(c for c, _, _ in got)
                            return got
                        out.append(gsc._Task(t.cols, t.entries, read))
                    return out
                source.tasks = counted
                return source

            def __exit__(self, *exc):
                return self.inner.__exit__(*exc)

        monkeypatch.setattr(gsc, "open_source", lambda *a, **k: Wrapped(original(*a, **k)))


def test_a_gene_wanted_by_several_features_is_read_once(store, data, monkeypatch):
    """OD 15: colour and size may both want a gene, at different thresholds; it is read once per layer."""
    counter = ReadCounter(monkeypatch)
    feats = [gene_feature("color", gs.gene(4), "logged", 0.0), gene_feature("size", gs.gene(4), "logged", 1.0),
             gene_feature("again", gs.gene(4), "logged", 0.0), gene_feature("other_layer", gs.gene(4), "counts", 0.0)]
    res = run(store, [{"source": {"type": "obs", "key": "cell_type"}}], feats)
    assert sorted(counter.genes) == [4, 4]                        # once from logged, once from counts
    close(res.feature_moments[0], res.feature_moments[2], rtol=0)
    cell_group = group_of_cells(res)
    for i, f in enumerate(feats):
        col = data.layer(f["layer"])[:, 4].astype(np.float64)
        close(res.feature_moments[i], ref_moments(col, cell_group, 6, f["detect_above"]))


def test_a_gene_not_in_the_dataset_is_missing_and_has_no_cells(store):
    feats = [gene_feature("a", "NOGENE1"), gene_feature("b", gs.gene(0))]
    p = plan(store, [{"source": {"type": "obs", "key": "cell_type"}}], feats)
    assert p.missing == {"genes": ["NOGENE1"]}
    res = run(store, [{"source": {"type": "obs", "key": "cell_type"}}], feats)
    assert res.features == [{"id": "a", "status": "missing"}, {"id": "b", "status": "ok"}]
    assert (res.feature_moments[0] == 0).all()


# --------------------------------------------------------------------------------------------- scores and measures

SIG = {"genes": gs.GENE_SETS["b_markers"], "method": "mean", "input": "logged"}


def _score_values(path, recipe, rows):
    p = gsc.plan(get_reader(path), path, gsc.parse_recipe(recipe))
    return [r for e, r in gsc.compute(p, rows) if e == "result"][0].values.astype(np.float64)


@pytest.mark.parametrize("rows", [None, gs.SHOWN_THIRD], ids=["all", "third"])
def test_a_score_feature_is_the_score_engines_values_per_group(store, rows):
    feats = [{"id": "s", "kind": "score", "recipe": SIG, "above": 1.5},
             {"id": "z", "kind": "score", "recipe": {"genes": gs.GENE_SETS["t_markers"]}, "column": "zscore_mean",
              "layer": "logged"}]
    rows_ = None if rows is None else np.asarray(rows)
    res = run(store, [{"source": {"type": "obs", "key": "cell_type"}}], feats, rows=rows_)
    cell_group = group_of_cells(res)
    k = len(res.grouping.groups)
    close(res.feature_moments[0], ref_moments(_score_values(store, SIG, rows_), cell_group, k, 1.5))
    zrec = {"genes": gs.GENE_SETS["t_markers"], "method": "zscore_mean", "input": "logged"}
    close(res.feature_moments[1], ref_moments(_score_values(store, zrec, rows_), cell_group, k, 0.0))
    assert [s["status"] for s in res.features] == ["ok", "ok"]


def test_one_score_serves_every_threshold_and_measure_that_asks_for_it(store, monkeypatch):
    """Colour 'score_mean' and size 'score_pct_above' are one score: it is computed once."""
    calls = []
    original = gsc.compute

    def counted(*a, **k):
        calls.append(1)
        return original(*a, **k)
    monkeypatch.setattr(gsc, "compute", counted)
    feats = [{"id": "c", "kind": "score", "recipe": SIG}, {"id": "s", "kind": "score", "recipe": SIG, "above": 2.0}]
    measures = [{"id": "m", "source": {"type": "gene-score", "key": "sig-1", "column": "mean", "layer": "logged",
                                       "recipe": {"genes": SIG["genes"]}}, "above": 1.0}]
    res = run(store, [{"source": {"type": "obs", "key": "condition"}}], feats, measures)
    assert len(calls) == 1
    close(res.feature_moments[0][:, :3], res.feature_moments[1][:, :3], rtol=0)
    close(res.measure_moments[0][:, :3], res.feature_moments[0][:, :3], rtol=0)


def test_a_score_without_a_usable_gene_says_why(store):
    feats = [{"id": "s", "kind": "score", "recipe": {"genes": ["NOGENE1"]}}]
    res = run(store, [{"source": {"type": "obs", "key": "condition"}}], feats)
    assert res.features == [{"id": "s", "status": "no_score", "reason": "no_gene_present"}]
    assert (res.feature_moments[0] == 0).all()


@pytest.mark.parametrize("rows", [None, gs.SHOWN_THIRD], ids=["all", "third"])
def test_measures_of_every_source_type(stores, data, rows):
    path = stores["csr", "h5ad"]
    rows_ = None if rows is None else np.asarray(rows)
    shown = np.arange(gs.N_OBS) if rows is None else rows_
    measures = [{"id": "score", "source": {"type": "obs", "key": "score"}, "above": 5.0},
                {"id": "pt", "source": {"type": "obs", "key": "pseudotime"}},
                {"id": "umap", "source": {"type": "obsm", "key": "X_umap", "column": "1"}, "above": -0.5},
                {"id": "gene", "source": {"type": "layer", "key": "logged", "column": gs.gene(6)}, "above": 0.0},
                {"id": "nbr", "source": {"type": "obsp", "key": "connectivities", "column": gs.cell(3)}}]
    res = run(path, [{"source": {"type": "obs", "key": "cell_type"}}], measures=measures, rows=rows_)
    cell_group = group_of_cells(res)
    want = [data.obs["score"].to_numpy()[shown], data.obs["pseudotime"].to_numpy()[shown],
            data.obsm["X_umap"][shown, 1], data.logged[shown, 6], data.obsp[3, shown]]
    for i, (m, w) in enumerate(zip(measures, want)):
        close(res.measure_moments[i], ref_moments(np.asarray(w, dtype=np.float64), cell_group, 6, m.get("above", 0)))
    assert res.measures == [{"id": m["id"], "status": "ok"} for m in measures]
    assert res.feature_moments is None


@pytest.mark.parametrize("source,reason", [
    ({"type": "obs", "key": "cell_type"}, "not_numeric"),
    ({"type": "obs", "key": "is_doublet"}, "not_numeric"),
    ({"type": "table", "ref": "s0"}, "not_numeric"),
    ({"type": "cell-group", "recipe": {"partitionings": [{"source": {"type": "obs", "key": "condition"}}]}},
     "not_numeric"),
    ({"type": "obs", "key": "nope"}, "key_not_found"),
])
def test_a_measure_must_be_a_numeric_per_cell_source(store, source, reason):
    sets = {"s0": bitset(np.ones(gs.N_OBS, bool))}
    with pytest.raises(gsc.ScoreError) as e:
        plan(store, [{"source": {"type": "obs", "key": "condition"}}], measures=[{"id": "m", "source": source}],
             sets=sets)
    assert e.value.reason == reason


# --------------------------------------------------------------------------------------------- grid cells

def test_measures_per_grid_cell_up_to_the_limit(store, data):
    """A grid passes one code per cell shown (its mixed-radix cell); every grid cell up to the limit has its moments."""
    n_codes = gf.MAX_GRID_MEASURE_CELLS
    rng = np.random.default_rng(2)
    codes = rng.integers(0, n_codes, gs.N_OBS).astype(np.uint32)
    codes[:7] = n_codes                                            # a cell outside the grid is not counted
    codes[7:9] = n_codes - 1                                       # the last grid cell
    work = gf.plan_work(get_reader(store), store, measures=gf.parse_measures(
        [{"id": "m", "source": {"type": "obs", "key": "depth"}, "above": 1.0}]))
    events = list(gf.accumulate(work, get_reader(store), store, None, codes, n_codes))
    got = events[-1][1]
    assert got.measures.shape == (1, n_codes, 5)
    depth = data.obs["depth"].to_numpy()
    occupied = np.unique(codes[codes < n_codes])
    want = np.array([gs.moments(depth[codes == c], 1.0) for c in occupied])
    close(got.measures[0][occupied], want)
    empty = np.ones(n_codes, bool)
    empty[occupied] = False
    assert (got.measures[0][empty] == 0).all()
    assert got.measure_status == [{"id": "m", "status": "ok"}]


def test_more_grid_cells_than_the_limit_are_refused(store):
    work = gf.plan_work(get_reader(store), store, measures=gf.parse_measures(
        [{"id": "m", "source": {"type": "obs", "key": "depth"}}]))
    codes = np.zeros(gs.N_OBS, dtype=np.uint32)
    with pytest.raises(cg.GroupError) as e:
        list(gf.accumulate(work, get_reader(store), store, None, codes, gf.MAX_GRID_MEASURE_CELLS + 1))
    assert e.value.reason == "grid_too_large"


# --------------------------------------------------------------------------------------------- giving way

class Pause:
    """Wants a pause every ``every`` asks; on ``wait()`` records the matrix reads still running."""

    def __init__(self, every, counter=None):
        self.every, self.counter = every, counter
        self.asked = 0
        self.waits = []

    def wanted(self):
        self.asked += 1
        return self.asked % self.every == 0

    def wait(self):
        self.waits.append(self.counter.running if self.counter else 0)


@pytest.mark.parametrize("layout", gs.LAYOUTS)
def test_give_way_between_batches_with_nothing_in_flight_and_the_same_result(stores, monkeypatch, layout):
    monkeypatch.setattr(gsc, "MAX_GROUP_ENTRIES", 1)              # one gene per read, so there are many batches
    monkeypatch.setattr(gsc, "MAX_BATCH_GENES", 2)
    monkeypatch.setattr(gf.cs, "SLAB_ROWS", 256)
    path = stores[layout, "zarr"]
    feats = [gene_feature(f"f{i}", gs.gene(i), "logged", 0.5) for i in range(30)] + \
        [{"id": "s", "kind": "score", "recipe": SIG}]
    measures = [{"id": "m", "source": {"type": "obs", "key": "score"}}]
    parts = [{"source": {"type": "obs", "key": "cell_type"}}]
    plain = run(path, parts, feats, measures)
    counter = ReadCounter(monkeypatch)
    pause = Pause(3, counter)
    paused = run(path, parts, feats, measures, pause=pause)
    assert len(pause.waits) >= 5 and all(n == 0 for n in pause.waits)
    assert np.array_equal(plain.feature_moments, paused.feature_moments)
    assert np.array_equal(plain.measure_moments, paused.measure_moments)
    assert sorted(counter.genes) == list(range(30))                 # each gene read once: SIG's ride on the score's


def test_should_stop_cancels_between_reads(store, monkeypatch):
    monkeypatch.setattr(gsc, "MAX_GROUP_ENTRIES", 1)              # one gene per read
    asked = []

    def stop():
        asked.append(1)
        return len(asked) > 4
    with pytest.raises(gsc.ScoreCancelled):
        run(store, [{"source": {"type": "obs", "key": "cell_type"}}],
            [gene_feature(f"f{i}", gs.gene(i)) for i in range(40)], should_stop=stop)


# --------------------------------------------------------------------------------------------- segments (CMP-2)

def test_one_gene_is_accumulated_in_segments(monkeypatch):
    """A gene stored for every cell: temporaries are a segment long, not the gene's length."""
    n = 6_000_000
    rows = np.arange(n, dtype=np.int32)
    values = np.ones(n, dtype=np.float32)
    values[::7] = 3.0
    codes = (np.arange(n) % 50).astype(np.uint8)
    monkeypatch.setattr(gsc, "SEGMENT_ENTRIES", 1 << 18)
    bins = gf._Bins(codes, 50, None, n)
    sizes = np.bincount(codes, minlength=50)
    out = [np.empty((50, 5)), np.empty((50, 5))]
    tracemalloc.start()
    try:
        gf._gene_moments(bins, sizes, rows, values, [0.0, 2.0], [[out[0]], [out[1]]])
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert peak < 16 * 2 ** 20, f"peak {peak / 2 ** 20:.1f} MiB for a {n}-entry gene"
    ref0 = np.array([gs.moments(values[codes == g], 0.0) for g in range(50)])
    ref2 = np.array([gs.moments(values[codes == g], 2.0) for g in range(50)])
    close(out[0], ref0)
    close(out[1], ref2)
    monkeypatch.setattr(gsc, "SEGMENT_ENTRIES", 1 << 30)
    whole = np.empty((50, 5))
    gf._gene_moments(bins, sizes, rows, values, [0.0], [[whole]])
    close(whole, out[0])


@pytest.mark.parametrize("segment", [1, 7, 1 << 10])
def test_segment_size_does_not_change_the_moments(store, data, monkeypatch, segment):
    feats = [gene_feature("a", gs.gene(5), "logged", 0.5), gene_feature("b", gs.gene(8), "X", 0.0)]
    parts = [{"source": {"type": "obs", "key": "cell_type"}}, {"source": {"type": "obs", "key": "condition"}}]
    want = run(store, parts, feats).feature_moments
    monkeypatch.setattr(gsc, "SEGMENT_ENTRIES", segment)
    close(run(store, parts, feats).feature_moments, want, rtol=1e-13)


def test_more_than_255_groups_use_wide_codes(store, data):
    parts = [{"source": {"type": "obs", "key": "sample"}}, {"source": {"type": "obs", "key": "cell_type"}},
             {"source": {"type": "obs", "key": "condition"}}]
    res = run(store, parts, [gene_feature("a", gs.gene(2), "counts", 1.0)], rows=np.arange(0, gs.N_OBS, 1))
    assert res.grouping.codes.dtype == np.uint16 and len(res.grouping.groups) > 255
    close(res.feature_moments[0], ref_moments(data.counts[:, 2].astype(np.float64), group_of_cells(res),
                                              len(res.grouping.groups), 1.0))


# --------------------------------------------------------------------------------------------- plan, lane, estimate

@pytest.mark.parametrize("layout,lane", [("csc", "light"), ("csr", "heavy"), ("dense", "heavy")])
def test_feature_reads_enter_the_estimate_and_the_lane(stores, layout, lane):
    path = stores[layout, "zarr"]
    parts = [{"source": {"type": "obs", "key": "cell_type"}}]
    names = [gs.gene(i) for i in range(10)]
    base = cg.plan(get_reader(path), path, cg.parse_request(body(parts)))
    p = plan(path, parts, [gene_feature(f"f{i}", g, "logged") for i, g in enumerate(names)])
    with gsc.open_source(get_reader(path), path, "logged") as source:
        entries = source.entries(list(range(10)))
    assert base.lane == "light"
    assert p.groups.entries == base.entries + entries
    assert p.groups.seconds == pytest.approx(base.seconds + entries / gsc.RATES[layout])
    assert p.groups.lane == lane and p.estimate()["lane"] == lane
    assert p.estimate()["entries"] == base.entries + entries
    assert p.groups.cache_key == base.cache_key                     # the codes do not depend on the features


def test_a_score_feature_or_a_whole_matrix_measure_takes_the_heavy_lane(stores):
    parts = [{"source": {"type": "obs", "key": "cell_type"}}]
    csc = stores["csc", "zarr"]
    assert plan(csc, parts, [{"id": "s", "kind": "score", "recipe": SIG}]).groups.lane == "heavy"
    assert plan(csc, parts, measures=[{"id": "m", "source": {"type": "obs", "key": "score"}}]).groups.lane == "light"
    gene_measure = [{"id": "m", "source": {"type": "layer", "key": "logged", "column": gs.gene(1)}}]
    assert plan(csc, parts, measures=gene_measure).groups.lane == "light"
    assert plan(stores["csr", "zarr"], parts, measures=gene_measure).groups.lane == "heavy"


def test_a_score_feature_costs_its_score(store):
    parts = [{"source": {"type": "obs", "key": "cell_type"}}]
    base = cg.plan(get_reader(store), store, cg.parse_request(body(parts)))
    sp = gsc.plan(get_reader(store), store, gsc.parse_recipe(SIG))
    p = plan(store, parts, [{"id": "s", "kind": "score", "recipe": SIG}, {"id": "t", "kind": "score", "recipe": SIG}])
    assert p.groups.entries == base.entries + sp.entries                # one score, though two features use it
    assert p.groups.seconds == pytest.approx(base.seconds + sp.seconds - gsc.BASE_SECONDS
                                             + cg.RESOLVE_SECONDS_PER_MCELL * gs.N_OBS / 1e6)


def test_the_tier_follows_the_whole_request(store, monkeypatch):
    monkeypatch.setitem(gsc.RATES, "csc", 1.0)                        # one entry a second: the reads decide the tier
    p = plan(store, [{"source": {"type": "obs", "key": "cell_type"}}], [gene_feature("a", gs.gene(0), "logged")])
    assert p.groups.tier == gsc.tier_of(p.groups.seconds) and p.groups.tier != "auto"
    assert p.groups.lane == "heavy"


@pytest.mark.parametrize("features,reason", [
    ([{"id": "a", "kind": "gene", "name": "GENE000", "colour": 1}], "unknown_field"),
    ([{"id": "a", "kind": "pathway", "name": "GENE000"}], "bad_feature"),
    ([{"id": "a", "kind": "gene"}], "bad_feature"),
    ([{"kind": "gene", "name": "GENE000"}], "bad_feature"),
    ([{"id": "a", "kind": "gene", "name": "GENE000"}, {"id": "a", "kind": "gene", "name": "GENE001"}], "duplicate_id"),
    ([{"id": "a", "kind": "gene", "name": "GENE000", "detect_above": "0"}], "bad_threshold"),
    ([{"id": "a", "kind": "gene", "name": "GENE000", "detect_above": float("inf")}], "bad_threshold"),
    ([{"id": "a", "kind": "gene", "name": "GENE000", "detect_above": True}], "bad_threshold"),
    ([{"id": "a", "kind": "gene", "name": "GENE000", "above": 1}], "unknown_field"),
    ([{"id": "a", "kind": "score", "recipe": {"genes": ["GENE000"]}, "detect_above": 1}], "unknown_field"),
    ([{"id": "a", "kind": "score"}], "bad_feature"),
    ([{"id": "a", "kind": "score", "recipe": {"genes": ["GENE000"], "method": "nope"}}], "bad_method"),
    ("GENE000", "bad_feature"),
])
def test_bad_features_are_refused_with_a_reason(store, features, reason):
    with pytest.raises(gsc.ScoreError) as e:
        gf.parse_features(features)
    assert e.value.reason == reason and e.value.status == 400


@pytest.mark.parametrize("measures,reason", [
    ([{"id": "m", "source": {"type": "obs", "key": "score"}, "detect_above": 0}], "unknown_field"),
    ([{"id": "m"}], "bad_request"),
    ([{"id": "m", "source": {"type": "obs", "key": "score"}}, {"id": "m", "source": {"type": "obs", "key": "depth"}}],
     "duplicate_id"),
    ([{"id": "m", "source": {"type": "obs", "key": "score"}, "above": "1"}], "bad_threshold"),
])
def test_bad_measures_are_refused_with_a_reason(measures, reason):
    with pytest.raises(gsc.ScoreError) as e:
        gf.parse_measures(measures)
    assert e.value.reason == reason


def test_more_values_than_the_cell_gene_limit_are_refused_after_the_groups(store, monkeypatch, cost_limit):
    """CXG-17's 400,000 values (groups x features) bound the accumulators; the browser never asks for more."""
    cost_limit(matrix_values=6 * 3 - 1)
    res = run(store, [{"source": {"type": "obs", "key": "cell_type"}}],
              [gene_feature(f"f{i}", gs.gene(i)) for i in range(3)])
    assert res.refused == {"reason": "too_many_values", "count": 18, "limit": 17}
    head, blocks = res.to_reply(False)
    assert head["refused"]["reason"] == "too_many_values" and blocks == [] and "blocks" not in head


# --------------------------------------------------------------------------------------------- compute and reply

def test_the_reply_lists_the_blocks_in_order(store):
    feats = [gene_feature("f0", gs.gene(0), "logged"), gene_feature("f1", "NOGENE1")]
    measures = [{"id": "m0", "source": {"type": "obs", "key": "score"}, "above": 5}]
    res = run(store, [{"source": {"type": "obs", "key": "cell_type"}}], feats, measures, want={"codes": True})
    head, blocks = res.to_reply(True)
    assert head["type"] == "result" and head["shape"] == "grouping"
    assert head["moments"] == ["n", "sum", "sumsq", "n_above", "sum_above"]
    assert head["features"] == [{"id": "f0", "status": "ok"}, {"id": "f1", "status": "missing"}]
    assert head["measures"] == [{"id": "m0", "status": "ok"}]
    assert head["blocks"] == [{"name": "codes", "dtype": "uint8", "length": gs.N_OBS},
                              {"name": "feature_moments", "dtype": "float64", "shape": [2, 6, 5]},
                              {"name": "measure_moments", "dtype": "float64", "shape": [1, 6, 5]}]
    assert [b[0] for b in blocks] == ["codes", "feature_moments", "measure_moments"]
    for b, arr in zip(head["blocks"][1:], [a for _, a in blocks[1:]]):
        assert arr.dtype == np.float64 and list(arr.shape) == b["shape"] and arr.flags.c_contiguous
    head2, blocks2 = res.to_reply(False)
    assert [b["name"] for b in head2["blocks"]] == ["feature_moments", "measure_moments"]


def test_a_request_without_features_replies_as_the_grouping(store):
    res = run(store, [{"source": {"type": "obs", "key": "cell_type"}}])
    head, blocks = res.to_reply(False)
    plain, _ = res.grouping.to_reply(False)
    assert head == plain and blocks == []


def test_the_code_cache_answers_the_groups_and_the_features_are_read(store, data, monkeypatch):
    parts = [{"source": {"type": "obs", "key": "cell_type"}}]
    feats = [gene_feature("a", gs.gene(1), "logged")]
    first = run(store, parts, feats)

    def no_resolve(*a, **k):
        raise AssertionError("the code cache was given: nothing is resolved")
    monkeypatch.setattr(cg, "_resolving", no_resolve)
    again = run(store, parts, feats, codes=first.grouping)
    assert again.grouping is first.grouping
    assert np.array_equal(again.feature_moments, first.feature_moments)


def test_a_refused_grouping_reads_no_feature(store, monkeypatch):
    counter = ReadCounter(monkeypatch)
    every = [f"c:m{i:04d}" for i in range(gs.N_MANY)]                 # 2,001 kept levels: over the limit
    res = run(store, [{"source": {"type": "obs", "key": "many"}, "levels": every}], [gene_feature("a", gs.gene(1))])
    assert res.refused["reason"] == "too_many_levels" and counter.genes == []
    head, blocks = res.to_reply(False)
    assert blocks == [] and head["refused"]["reason"] == "too_many_levels"


def test_progress_and_entries_add_up_to_the_estimate(stores):
    path = stores["csc", "zarr"]
    parts = [{"source": {"type": "obs", "key": "cell_type"}},
             {"source": {"type": "layer", "key": "logged", "column": gs.gene(3)}, "binning": {"method": "equal_width",
                                                                                          "bins": 2}}]
    feats = [gene_feature(f"f{i}", gs.gene(i), "logged") for i in range(12)] + \
        [{"id": "s", "kind": "score", "recipe": SIG}]
    measures = [{"id": "m", "source": {"type": "layer", "key": "counts", "column": gs.gene(2)}}]
    p = plan(path, parts, feats, measures)
    told = []
    events = list(gf.compute(p, None, on_entries=told.append))
    progress = [e for k, e in events if k == "progress" and e["stage"] == "features"]
    assert progress and progress[0]["done"] == 0
    assert [e["done"] for e in progress] == sorted(e["done"] for e in progress)
    assert progress[-1]["done"] == progress[-1]["total"]
    assert progress[-1]["entries_done"] == progress[-1]["entries_total"] == p.work.entries
    assert sum(told) == p.groups.entries


def test_moments_are_float64_and_ids_keep_the_request_order(store):
    feats = [gene_feature("z", gs.gene(9)), gene_feature("a", gs.gene(1)), {"id": "s", "kind": "score", "recipe": SIG},
             gene_feature("m", gs.gene(5), "counts")]
    res = run(store, [{"source": {"type": "obs", "key": "condition"}}], feats)
    assert [f["id"] for f in res.features] == ["z", "a", "s", "m"]
    assert res.feature_moments.dtype == np.float64
    single = run(store, [{"source": {"type": "obs", "key": "condition"}}], [gene_feature("a", gs.gene(1))])
    close(res.feature_moments[1], single.feature_moments[0], rtol=0)


def test_gene_reads_run_ahead_by_the_feature_read_ahead_only(store, monkeypatch):
    """CMP-2: the reads in flight are bounded, whatever the number of genes (2,000 genes hold what 200 do)."""
    monkeypatch.setattr(gsc, "MAX_GROUP_ENTRIES", 1)
    monkeypatch.setattr(gf, "READ_AHEAD_ENTRIES", 1500)
    budgets, peaks = [], []
    original = gsc.pipeline

    def watched(tasks, threads, budget, pause=None):
        budgets.append(budget)
        for task, result, peak in original(tasks, threads, budget, pause):
            peaks.append(peak)
            yield task, result, peak
    monkeypatch.setattr(gsc, "pipeline", watched)
    run(store, [{"source": {"type": "obs", "key": "cell_type"}}], [gene_feature(f"f{i}", gs.gene(i)) for i in range(40)])
    assert budgets == [1500]
    largest = max(int(np.count_nonzero(gs.make_data().x[:, i])) for i in range(40))
    assert max(peaks) <= 1500 + largest


def test_the_feature_read_ahead_is_within_the_score_engines():
    assert 0 < gf.READ_AHEAD_ENTRIES <= gsc.READ_AHEAD_ENTRIES


# --------------------------------------------------------------------------------------------- one read for score and genes

ROW = [{"source": {"type": "obs", "key": "cell_type"}}]
B_GENES = [gs.gene(i) for i in range(12)]                          # SIG's genes


def _mixed(recipe, threshold=0.5, extra=(gs.gene(20),)):
    """A row whose colour is a score and whose size is its genes' summary (OD 15): the score and the same genes."""
    genes = [gene_feature(f"g{i}", name, recipe.get("input", "X"), threshold) for i, name in enumerate(B_GENES)]
    genes += [gene_feature(f"x{i}", name, recipe.get("input", "X"), threshold) for i, name in enumerate(extra)]
    return genes + [{"id": "score", "kind": "score", "recipe": recipe, "above": 0.25}]


def _apart(path, feats, rows=None, parts=ROW, **kw):
    """The same features without the shared read: the genes alone, and the score alone."""
    genes = run(path, parts, [f for f in feats if f["kind"] == "gene"], rows=rows, **kw)
    score = run(path, parts, [f for f in feats if f["kind"] == "score"], rows=rows, **kw)
    return genes.feature_moments, score.feature_moments


METHOD_RECIPES = {
    "zscore_mean": {"genes": B_GENES, "method": "zscore_mean", "input": "logged"},
    "zscore_clip": {"genes": B_GENES, "method": "zscore_mean", "input": "X", "clip": 0.5},
    "mean": {"genes": B_GENES[:8], "down": B_GENES[8:], "method": "mean", "input": "logged"},
    "sum": {"genes": B_GENES, "method": "sum", "input": "counts"},
    "control_adjusted": {"genes": B_GENES[:6], "method": "control_adjusted", "input": "logged", "bins": 4,
                         "controls": 3},
    "detected": {"genes": B_GENES, "method": "detected", "input": "counts", "detect_above": 1},
    "fraction_of_total": {"genes": B_GENES, "method": "fraction_of_total", "input": "counts"},
}


@pytest.mark.parametrize("layout,backend", [("csc", "zarr"), ("csr", "zarr"), ("dense", "zarr"), ("csc", "h5ad")])
@pytest.mark.parametrize("method", sorted(METHOD_RECIPES))
def test_the_shared_read_gives_bit_identical_results(stores, layout, backend, method):
    """(a) the genes reach the features as stored, before any transform of the score (clip, z-score, threshold)."""
    path = stores[layout, backend]
    feats = _mixed(METHOD_RECIPES[method])
    together = run(path, ROW, feats)
    genes, score = _apart(path, feats)
    assert np.array_equal(together.feature_moments[:-1], genes)
    assert np.array_equal(together.feature_moments[-1:], score)
    assert [f["status"] for f in together.features] == ["ok"] * len(feats)


@pytest.mark.parametrize("case", ["subset", "excluded", "subset_and_excluded"])
def test_the_shared_read_counts_the_grouped_cells_only(store, data, case):
    """(b) the score reads the cells shown; the features take the grouped cells of those, by their codes."""
    rows = np.sort(np.random.default_rng(3).choice(gs.N_OBS, 700, replace=False)) if "subset" in case else None
    parts = [{"source": {"type": "obs", "key": "cell_type"}, "levels": ["c:T cell", "c:B cell"], "rest": "exclude"}] \
        if "excluded" in case else ROW
    feats = _mixed(METHOD_RECIPES["zscore_mean"])
    together = run(store, parts, feats, rows=rows, small={"threshold": 10, "mode": "hide"})
    genes, score = _apart(store, feats, rows=rows, parts=parts, small={"threshold": 10, "mode": "hide"})
    assert np.array_equal(together.feature_moments[:-1], genes)
    assert np.array_equal(together.feature_moments[-1:], score)
    cell_group = group_of_cells(together)
    shown = np.arange(gs.N_OBS) if rows is None else rows
    k = len(together.grouping.groups)
    for i, name in enumerate(B_GENES):
        col = data.logged[shown, data.var_names.index(name)].astype(np.float64)
        close(together.feature_moments[i], ref_moments(col, cell_group, k, 0.5))


@pytest.mark.parametrize("layout", gs.LAYOUTS)
def test_a_mixed_row_reads_each_gene_exactly_once(stores, monkeypatch, layout):
    counter = ReadCounter(monkeypatch)
    feats = _mixed(METHOD_RECIPES["zscore_mean"])
    run(stores[layout, "zarr"], ROW, feats)
    want = sorted(gs.make_data().var_names.index(n) for n in B_GENES + [gs.gene(20)])
    assert sorted(counter.genes) == want


@pytest.mark.parametrize("layout", gs.LAYOUTS)
def test_a_shared_gene_is_counted_once_in_the_estimate_and_the_entries(stores, layout):
    path = stores[layout, "zarr"]
    feats = _mixed(METHOD_RECIPES["zscore_mean"])
    p = plan(path, ROW, feats)
    sp = gsc.plan(get_reader(path), path, gsc.parse_recipe(METHOD_RECIPES["zscore_mean"]))
    with gsc.open_source(get_reader(path), path, "logged") as source:
        own = source.entries([20])                                   # the one gene the score does not read
    assert p.work.entries == sp.entries + own
    told = []
    events = list(gf.compute(p, None, on_entries=told.append))
    last = [e for k, e in events if k == "progress" and e["stage"] == "features"][-1]
    assert last["entries_done"] == last["entries_total"]          # what was read, once
    assert last["done"] == last["total"]
    assert sum(told) == last["entries_done"] + (p.groups.entries - p.work.entries)


def test_a_score_that_stops_before_reading_leaves_the_genes_to_their_own_read(store, monkeypatch):
    """A score with no control gene to draw reads nothing: the features read their genes after it."""
    every = [gs.gene(i) for i in range(gs.N_VAR)]
    recipe = {"genes": every, "method": "control_adjusted", "input": "logged"}
    feats = [gene_feature(f"g{i}", n, "logged", 0.5) for i, n in enumerate(B_GENES)] + \
        [{"id": "score", "kind": "score", "recipe": recipe}]
    counter = ReadCounter(monkeypatch)
    p = plan(store, ROW, feats)
    events = list(gf.compute(p, None))
    res = events[-1][1]
    assert res.features[-1] == {"id": "score", "status": "no_score", "reason": "no_control_genes"}
    assert sorted(counter.genes) == list(range(12))
    genes = run(store, ROW, feats[:-1])
    assert np.array_equal(res.feature_moments[:-1], genes.feature_moments)
    last = [e for k, e in events if k == "progress" and e["stage"] == "features"][-1]
    assert last["entries_done"] == last["entries_total"] and last["done"] == last["total"]


@pytest.mark.parametrize("layout", gs.LAYOUTS)
def test_pause_and_cancel_midway_through_a_shared_read(stores, monkeypatch, layout):
    monkeypatch.setattr(gsc, "MAX_GROUP_ENTRIES", 1)
    monkeypatch.setattr(gsc, "MAX_BATCH_GENES", 2)
    path = stores[layout, "zarr"]
    feats = _mixed(METHOD_RECIPES["zscore_mean"])
    plain = run(path, ROW, feats)
    counter = ReadCounter(monkeypatch)
    pause = Pause(2, counter)
    paused = run(path, ROW, feats, pause=pause)
    assert pause.waits and all(n == 0 for n in pause.waits)
    assert np.array_equal(plain.feature_moments, paused.feature_moments)
    asked = []

    def stop():
        asked.append(1)
        return len(asked) > 6
    with pytest.raises(gsc.ScoreCancelled):
        run(path, ROW, feats, should_stop=stop)


def test_the_score_engine_hands_each_read_over_once_as_stored(store):
    """The hook itself: every read of the score, every column, once, the arrays as the matrix holds them."""
    recipe = METHOD_RECIPES["zscore_clip"]
    p = gsc.plan(get_reader(store), store, gsc.parse_recipe(recipe))
    seen = []
    told = []
    with_hook = [r for e, r in gsc.compute(p, None, on_entries=told.append, on_read=seen.extend) if e == "result"][0]
    without = [r for e, r in gsc.compute(p, None) if e == "result"][0]
    assert np.array_equal(with_hook.values, without.values) and sum(told) == with_hook.entries_done
    assert sorted(c for c, _, _ in seen) == sorted(p.columns)
    x = gs.make_data().x
    for col, rows, values in seen:
        dense = np.zeros(gs.N_OBS, dtype=np.float32)
        dense[rows] = values
        assert np.array_equal(dense, x[:, col])


def test_an_exception_in_the_shared_read_ends_the_request_and_frees_everything(store, monkeypatch):
    """(c) A consumer that raises mid-stream: the lane, the ledger and the read guard are all given back."""
    from annzarro.core import read_guard
    from annzarro.server.routes import compute_stream as cst
    lanes, ledger = cst.Lanes(), cst.Ledger(1 << 30)
    inner = gf._gene_moments
    calls = []

    def raising(*a, **k):
        calls.append(1)
        if len(calls) == 4:
            raise RuntimeError("a consumer fails")
        return inner(*a, **k)

    def request(feats):
        p = plan(store, ROW, feats)

        def work(job):
            try:
                for event, payload in gf.compute(p, None, pause=job):
                    if event == "result":
                        yield cst.frame({"type": "result"})
            except RuntimeError as exc:
                yield cst.frame({"type": "error", "reason": "failed", "message": str(exc)})

        def admit():
            admitted = read_guard.admit(1 << 20)
            admitted.__enter__()
            return lambda: admitted.__exit__(None, None, None)
        response = cst.respond("heavy", nbytes=1 << 20, keep_bytes=1 << 10, what="features", wait_s=5.0,
                               admit=admit, work=work, queued_frame=lambda job: {"type": "progress", "queue": {}},
                               mimetype="application/x-test", lanes=lanes, ledger=ledger)
        try:
            return b"".join(response.response)
        finally:
            response.close()
    before = read_guard.in_flight_bytes()
    monkeypatch.setattr(gf, "_gene_moments", raising)
    failed = request(_mixed(METHOD_RECIPES["zscore_mean"]))
    assert b'"error"' in failed and len(calls) == 4
    assert ledger.held() == 0 and read_guard.in_flight_bytes() == before
    monkeypatch.setattr(gf, "_gene_moments", inner)
    job = lanes.enter("heavy")
    assert job.running                                              # the lane is free again
    job.leave()
    assert b'"result"' in request(_mixed(METHOD_RECIPES["zscore_mean"]))
    assert ledger.held() == 0 and read_guard.in_flight_bytes() == before
