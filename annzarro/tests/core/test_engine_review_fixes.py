"""Fixes from the independent review of the 0.8.0 engine (FX-E): the grouping (core/cell_groups.py), features and
measures (core/group_features.py) and binning (core/binning.py).

Each test names the review item it covers. Each one failed on the base (d6db2c19). Results on valid inputs are
unchanged; the existing reference, oracle and sweep tests check that.

- H1: measures count in the value limit; their number is capped; ``accumulate`` holds at most one grid's moments.
- H2: the distinct thresholds of one gene or one vector are capped; a stop is noticed inside one gene's arithmetic.
- M1: a resolve that computes a score sends progress while it runs, and reports the score's entries as it reads them.
- M2: a nested grouping's codes are mapped one span at a time, not copied whole as int64; the exact select holds
  one copy of a batch.
- M8: when no cell can leave a group, a grouping already over the limit is refused before the next partitioning is read.
- L1: the ids a member wants are checked against one set.
- L2: a range wider than the largest float is refused with its own reason.
"""
import numpy as np
import pytest

from annzarro.core import binning as bn
from annzarro.core import cell_groups as cg
from annzarro.core import gene_score as gsc
from annzarro.core import get_reader
from annzarro.core import group_features as gf
from annzarro.tests import zarr_compat
from annzarro.tests.core import grouping_store as gs

SIG = {"genes": gs.SIGNATURES["up_only"]["up"], "method": "mean", "input": "logged"}


@pytest.fixture(scope="module")
def stores(tmp_path_factory):
    base = tmp_path_factory.mktemp("fxe")
    return {lay: gs.make_store(base / f"{lay}.zarr", lay, "zarr") for lay in gs.LAYOUTS}


@pytest.fixture(scope="module")
def store(stores):
    return stores["csc"]


def body(parts, features=(), measures=(), **kw):
    out = {"shape": "grouping", "partitionings": parts}
    if features:
        out["features"] = list(features)
    if measures:
        out["measures"] = list(measures)
    out.update(kw)
    return out


def gf_plan(path, parts, features=(), measures=()):
    return gf.plan(get_reader(path), path, cg.parse_request(body(parts, features, measures)))


def gf_result(p, **kw):
    return [r for e, r in gf.compute(p, None, **kw) if e == "result"][0]


def gene(fid, name, layer="X", detect_above=0.0):
    return {"id": fid, "kind": "gene", "name": name, "layer": layer, "detect_above": detect_above}


def score_part(binning=None):
    part = {"source": {"type": "gene-score", "key": "sig", "column": "mean", "layer": "logged", "recipe": SIG}}
    if binning is not None:
        part["binning"] = binning
    return part


CELL_TYPE = {"source": {"type": "obs", "key": "cell_type"}}
N_CELL_TYPES = len(gs.CELL_TYPES)


# --------------------------------------------------------------------------------------------- H1


def test_h1_measures_count_in_the_value_limit(store, monkeypatch, cost_limit):
    cost_limit(matrix_values=4 * N_CELL_TYPES)
    feats = [gene("a", gs.gene(1)), gene("b", gs.gene(2))]
    measures = [{"id": "m0", "source": {"type": "obs", "key": "depth"}},
                {"id": "m1", "source": {"type": "obs", "key": "score"}}]
    assert gf_result(gf_plan(store, [CELL_TYPE], feats, measures[:2])).over_limit is None      # 6 x 4: at the limit
    over = gf_result(gf_plan(store, [CELL_TYPE], feats + [gene("c", gs.gene(3))], measures))
    assert over.over_limit == {"reason": "too_many_values", "count": 5 * N_CELL_TYPES, "limit": 4 * N_CELL_TYPES}
    only_measures = gf_result(gf_plan(store, [CELL_TYPE], (), measures * 1 + [
        {"id": f"x{i}", "source": {"type": "obs", "key": "depth"}, "above": float(i % 2)} for i in range(3)]))
    assert only_measures.over_limit["count"] == 5 * N_CELL_TYPES
    head, blocks = over.to_reply(True)
    assert head["refused"]["reason"] == "too_many_values" and blocks == []


def test_h1_more_measures_than_the_cap_are_refused_when_parsed():
    def measures(n):
        return [{"id": f"m{i}", "source": {"type": "obs", "key": "depth"}} for i in range(n)]
    assert len(gf.parse_measures(measures(gf.MAX_MEASURES))) == gf.MAX_MEASURES
    with pytest.raises(cg.GroupError) as e:
        gf.parse_measures(measures(gf.MAX_MEASURES + 1))
    assert e.value.reason == "too_many_measures"
    assert e.value.extra == {"count": gf.MAX_MEASURES + 1, "limit": gf.MAX_MEASURES}


def test_h1_accumulate_holds_at_most_one_grids_moments(store, monkeypatch, cost_limit):
    cost_limit(grid_cells=100)
    reader = get_reader(store)
    depth, score = ({"id": f"m{i}", "source": {"type": "obs", "key": k}} for i, k in enumerate(("depth", "score")))
    work = gf.plan_work(reader, store, measures=gf.parse_measures([depth, score]))
    codes = (np.arange(gs.N_OBS) % 60).astype(np.uint16)
    with pytest.raises(cg.GroupError) as e:
        list(gf.accumulate(work, reader, store, None, codes, 60))                # 60 cells x 2 measures > 100
    assert (e.value.status, e.value.reason) == (422, "too_many_values")
    assert e.value.extra == {"count": 120, "limit": 100}
    one = gf.plan_work(reader, store, measures=gf.parse_measures([depth]))
    events = list(gf.accumulate(one, reader, store, None, codes, 60))
    assert events[-1][0] == "result" and events[-1][1].measures.shape == (1, 60, 5)


# --------------------------------------------------------------------------------------------- H2


def test_h2_distinct_thresholds_of_one_gene_are_capped(store):
    cap = gf.MAX_THRESHOLDS
    at_cap = [gene(f"g{i}", gs.gene(1), "logged", 0.25 * i) for i in range(cap)] + \
        [gene("again", gs.gene(1), "logged", 0.0)]                             # a repeat is no new threshold
    res = gf_result(gf_plan(store, [CELL_TYPE], at_cap))
    for i in range(cap):                                                       # each as if asked alone
        alone = gf_result(gf_plan(store, [CELL_TYPE], [gene("x", gs.gene(1), "logged", 0.25 * i)]))
        np.testing.assert_array_equal(res.feature_moments[i], alone.feature_moments[0])
    with pytest.raises(cg.GroupError) as e:
        gf_plan(store, [CELL_TYPE], at_cap + [gene("over", gs.gene(1), "logged", 9.0)])
    assert (e.value.status, e.value.reason) == (422, "too_many_thresholds")
    assert e.value.extra["count"] == cap + 1 and e.value.extra["limit"] == cap and e.value.extra["id"] == "over"


def test_h2_distinct_thresholds_of_one_vector_are_capped(store):
    cap = gf.MAX_THRESHOLDS
    ms = [{"id": f"m{i}", "source": {"type": "obs", "key": "depth"}, "above": float(i)} for i in range(cap + 1)]
    assert gf_result(gf_plan(store, [CELL_TYPE], (), ms[:cap])).measure_moments.shape == (cap, N_CELL_TYPES, 5)
    with pytest.raises(cg.GroupError) as e:
        gf_plan(store, [CELL_TYPE], (), ms)
    assert e.value.reason == "too_many_thresholds" and e.value.extra["id"] == f"m{cap}"
    scores = [{"id": f"s{i}", "kind": "score", "recipe": SIG, "above": float(i)} for i in range(cap + 1)]
    with pytest.raises(cg.GroupError) as e:
        gf_plan(store, [CELL_TYPE], scores)
    assert e.value.reason == "too_many_thresholds"


@pytest.mark.parametrize("layout", gs.LAYOUTS)
def test_h2_a_stop_is_noticed_inside_one_genes_arithmetic(stores, layout, monkeypatch):
    path = stores[layout]
    reader = get_reader(path)
    work = gf.plan_work(reader, path, features=gf.parse_features([gene("a", gs.gene(1), "logged")]))
    monkeypatch.setattr(gsc, "SEGMENT_ENTRIES", 16)                            # one gene: many segments
    added = []
    real_add = gf._Sums.add
    monkeypatch.setattr(gf._Sums, "add", lambda self, b, v: (added.append(v.size), real_add(self, b, v))[1])
    codes = np.zeros(gs.N_OBS, dtype=np.uint8)
    list(gf.accumulate(work, reader, path, None, codes, 1))
    segments = len(added)
    assert segments > 4
    added.clear()
    asked = []

    def stop():                                    # false when the read is handed out, true from then on
        asked.append(1)
        return len(asked) > 1
    with pytest.raises(gsc.ScoreCancelled):
        list(gf.accumulate(work, reader, path, None, codes, 1, should_stop=stop))
    assert len(added) < segments                                               # it stopped inside the gene


# --------------------------------------------------------------------------------------------- M1


def test_m1_a_score_partitioning_sends_progress_and_entries_while_it_computes(store, monkeypatch):
    monkeypatch.setattr(gsc, "MAX_GROUP_ENTRIES", 1)                          # one read per gene
    req = cg.parse_request(body([CELL_TYPE, score_part({"method": "equal_count", "bins": 3})]))
    p = cg.plan(get_reader(store), store, req)
    told, seen = [], []
    for event, payload in cg.compute(p, None, on_entries=lambda n: (told.append(n), seen.append(("entries", n)))):
        seen.append((event, payload))
    progress = [pl for e, pl in seen if e == "progress"]
    assert all(pl["stage"] == "groups" and pl["total"] == 2 for pl in progress)
    during = [pl for pl in progress if "genes_done" in pl]
    assert during, "no frame while the score computes"
    assert all(pl["done"] == 1 for pl in during)                     # the first partitioning is done, the second runs
    assert during[-1]["genes_done"] == during[-1]["genes_total"] == len(p.top.parts[1].score.columns)
    assert [pl["done"] for pl in progress if "genes_done" not in pl] == [0, 1, 2]
    assert len(told) > 1 and sum(told) == p.entries                  # one call per read, adding up to the plan
    last = next(i for i, (e, pl) in enumerate(seen) if e == "progress" and pl.get("done") == 2)
    assert sum(n for e, n in seen[:last] if e == "entries") == p.entries   # all told before the grouping is done


def test_m1_a_nested_score_sends_progress_too_and_the_codes_are_unchanged(store):
    nested = {"source": {"type": "cell-group", "key": "up", "recipe": {"partitionings": [
        score_part({"method": "equal_count", "bins": 2})]}}}
    req = cg.parse_request(body([CELL_TYPE, nested]))
    p = cg.plan(get_reader(store), store, req)
    told = []
    events = list(cg.compute(p, None, on_entries=told.append))
    assert any("genes_done" in pl for e, pl in events if e == "progress")
    assert sum(told) == p.entries
    res = events[-1][1]
    flat = [r for e, r in cg.compute(cg.plan(get_reader(store), store, cg.parse_request(body(
        [CELL_TYPE, score_part({"method": "equal_count", "bins": 2})]))), None) if e == "result"][0]
    np.testing.assert_array_equal(res.codes, flat.codes)
    assert [g["n"] for g in res.groups] == [g["n"] for g in flat.groups]


def test_m1_group_features_reports_the_groupings_entries_as_they_are_read(store, monkeypatch):
    monkeypatch.setattr(gsc, "MAX_GROUP_ENTRIES", 1)                          # one read per gene
    p = gf_plan(store, [CELL_TYPE, score_part({"method": "equal_count", "bins": 3})], [gene("a", gs.gene(1))])
    told, first_features = [], []
    for event, payload in gf.compute(p, None, on_entries=told.append):
        if event == "progress" and payload["stage"] == "features" and not first_features:
            first_features.append(len(told))
    assert first_features[0] > 1                                     # the score's reads, one by one
    assert sum(told) == p.groups.entries


# --------------------------------------------------------------------------------------------- M2


def _big_store(path, n):
    root = zarr_compat.open_group(path, mode="w")
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    obs = root.create_group("obs")
    obs.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0", "_index": "_index",
                      "column-order": ["c", "d"]})
    zarr_compat.write_array(obs, "_index", np.zeros(n, dtype=np.int8), chunks=(1 << 16,))
    rng = np.random.default_rng(3)
    for name, k in (("c", 10), ("d", 4)):
        g = obs.create_group(name)
        g.attrs.update({"encoding-type": "categorical", "encoding-version": "0.2.0", "ordered": False})
        zarr_compat.write_array(g, "codes", rng.integers(0, k, n).astype(np.int8), chunks=(1 << 16,))
        zarr_compat.write_strings(g, "categories", [f"{name}{i}" for i in range(k)])
    for name in ("var", "obsm", "obsp", "layers"):
        g = root.create_group(name)
        g.attrs.update({"encoding-type": "dict" if name != "var" else "dataframe", "encoding-version": "0.1.0"})
    zarr_compat.consolidate(path)
    return path


def test_m2_a_nested_grouping_is_not_copied_whole_as_int64(tmp_path, monkeypatch):
    import tracemalloc
    n = 1_000_000
    path = _big_store(str(tmp_path / "big.zarr"), n)
    monkeypatch.setattr(cg.cs, "SLAB_ROWS", 1 << 16)
    nested = {"source": {"type": "cell-group", "key": "up", "recipe": {"partitionings": [
        {"source": {"type": "obs", "key": "c"}}]}}}
    req = cg.parse_request(body([{"source": {"type": "obs", "key": "d"}}, nested]))
    reader = get_reader(path)
    reader.enable_caching = False
    p = cg.plan(reader, path, req)
    tracemalloc.start()
    try:
        res = [r for e, r in cg.compute(p) if e == "result"][0]
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert len(res.groups) == 40
    assert peak < 8 * n, f"peak {peak / 1e6:.1f} MB: the nested codes were copied whole as int64 (8 B a cell)"


def test_m2_the_exact_select_holds_one_copy_of_a_batch(monkeypatch):
    import tracemalloc
    monkeypatch.setattr(bn, "SELECT_COLLECT_CAP", 1_000_000)
    x = np.repeat(np.arange(8, dtype=np.float64), 400_000)                     # 8 buckets of 400,000 values
    np.random.default_rng(5).shuffle(x)
    b = bn.parse({"method": "equal_count", "bins": 4}, numeric=True)
    slabs = lambda: iter([x])                                                  # noqa: E731
    monkeypatch.setattr(bn, "CHUNK", 1 << 16)                                  # chunk temporaries out of the way
    tracemalloc.start()
    try:
        e = bn.edges(slabs, b)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    np.testing.assert_array_equal(e.edges, np.unique(np.quantile(x, [0, 0.25, 0.5, 0.75, 1])))
    assert peak < 2.5 * 8 * 1_000_000, f"peak {peak / 1e6:.1f} MB for a batch of at most 8 MB"


# --------------------------------------------------------------------------------------------- M8


def test_m8_a_grouping_over_the_limit_with_no_way_out_reads_no_further(store, monkeypatch, cost_limit):
    cost_limit(groups=100)
    scored = []
    real = cg.gs.compute
    monkeypatch.setattr(cg.gs, "compute", lambda *a, **k: (scored.append(1), real(*a, **k))[1])
    sample = {"source": {"type": "obs", "key": "sample"}}
    req = cg.parse_request(body([sample, CELL_TYPE, score_part({"method": "equal_count", "bins": 3})]))
    res = [r for e, r in cg.compute(cg.plan(get_reader(store), store, req)) if e == "result"][0]
    obs = gs.make_data().obs
    pairs = len(set(zip(obs["sample"], obs["cell_type"])))
    assert pairs > 100
    assert res.refused == {"reason": "too_many_groups", "count": pairs, "limit": 100, "levels": [30, 6]}
    assert scored == [], "the score was computed for a grouping already refused"
    # a partitioning that can leave cells out keeps the old order: everything is read, then counted
    req = cg.parse_request(body([sample, CELL_TYPE, {**score_part({"method": "equal_count", "bins": 3}),
                                                      "rest": "exclude"}]))
    res = [r for e, r in cg.compute(cg.plan(get_reader(store), store, req)) if e == "result"][0]
    assert res.refused["reason"] == "too_many_groups" and scored == [1]


# --------------------------------------------------------------------------------------------- L1


def test_l1_the_ids_a_member_wants_are_checked_against_one_set(store, monkeypatch):
    built = []

    class CountingSet(set):
        def __init__(self, *a):
            super().__init__(*a)
            if len(self) >= 2000:
                built.append(len(self))
    monkeypatch.setattr(cg, "set", CountingSet, raising=False)
    want = [f"c:x{i:05d}" for i in range(5000)] + ["c:m0003"]
    res = [r for e, r in cg.compute(cg.plan(get_reader(store), store, cg.parse_request(body(
        [{"source": {"type": "obs", "key": "many"}, "member": {"levels": want}}])))) if e == "result"][0]
    assert [g["n"] for g in res.groups] == [1, gs.N_OBS - 1]
    assert len(res.partitionings[0]["absent"]) == 5000
    assert len(built) <= 6, f"{len(built)} sets of the categories were built"


# --------------------------------------------------------------------------------------------- L2


@pytest.mark.parametrize("method,values", [
    ("equal_width", [-1e308, 0.0, 1.0, 2.0, 1e308]),
    ("equal_count", [-1e308, 0.0, 1.0, 2.0, 1e308]),
    ("log", [1e-308, 1.0, 1e308]),
], ids=["equal_width", "equal_count", "log"])
def test_l2_a_range_wider_than_the_largest_float_is_refused(method, values):
    x = np.asarray(values, dtype=np.float64)
    with pytest.raises(bn.BinningError) as e:
        bn.edges(lambda: iter([x]), bn.parse({"method": method, "bins": 4}, numeric=True))
    assert e.value.reason == "range_too_wide"
    assert e.value.extra == {"lo": float(x.min()), "hi": float(x.max())}


def test_l2_a_wide_but_finite_range_still_bins():
    x = np.asarray([-1e307, 0.0, 1.0, 1e307])
    e = bn.edges(lambda: iter([x]), bn.parse({"method": "equal_width", "bins": 4}, numeric=True))
    np.testing.assert_array_equal(e.edges, np.histogram_bin_edges(x, 4))


# --------------------------------------------------------------------------------------------- dead code


def test_a_column_of_dates_is_refused_not_factorised_by_hand(store, tmp_path):
    """Plain strings arrive as categories (cell_sources); the hand factorisation of what a reader can only list is
    gone (review O2), so a column of another type (here dates) is refused with a reason."""
    import shutil
    path = str(tmp_path / "dates.zarr")
    shutil.copytree(store, path)
    root = zarr_compat.open_group(path, mode="r+")
    days = np.datetime64("2020-01-01") + (np.arange(gs.N_OBS) % 3).astype("timedelta64[D]")
    zarr_compat.write_array(root["obs"], "when", days, chunks=(512,))
    zarr_compat.consolidate(path)
    req = cg.parse_request(body([{"source": {"type": "obs", "key": "when"}}]))
    with pytest.raises(cg.GroupError) as e:
        list(cg.compute(cg.plan(get_reader(path), path, req)))
    assert (e.value.status, e.value.reason) == (400, "unsupported_column")


# --------------------------------------------------------------------------------------------- M5


def _categories_store(path, n, columns):
    """An obs-only store of ``n`` cells; ``columns`` maps a name to ``(stored, used)``: cell ``i`` holds category
    ``(i % used) * (stored // used)``, so ``used`` categories spread over ``stored`` hold a cell."""
    root = zarr_compat.open_group(path, mode="w")
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    obs = root.create_group("obs")
    obs.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0", "_index": "_index",
                      "column-order": list(columns)})
    zarr_compat.write_array(obs, "_index", np.zeros(n, dtype=np.int8), chunks=(1024,))
    for name, (stored, used) in columns.items():
        g = obs.create_group(name)
        g.attrs.update({"encoding-type": "categorical", "encoding-version": "0.2.0", "ordered": False})
        codes = (np.arange(n) % used) * (stored // used)
        zarr_compat.write_array(g, "codes", codes.astype(np.int16), chunks=(1024,))
        zarr_compat.write_strings(g, "categories", [f"{name}{i:05d}" for i in range(stored)])
    for name in ("var", "obsm", "obsp", "layers"):
        g = root.create_group(name)
        g.attrs.update({"encoding-type": "dict" if name != "var" else "dataframe", "encoding-version": "0.1.0"})
    zarr_compat.consolidate(path)
    return path


@pytest.fixture(scope="module")
def categories_store(tmp_path_factory):
    return _categories_store(str(tmp_path_factory.mktemp("m5") / "cats.zarr"), 3000,
                             {"atlas": (5000, 80), "wide": (2600, 2500), "mid": (300, 80)})


def _group(path, parts, rows=None):
    req = cg.parse_request(body(parts))
    return [r for e, r in cg.compute(cg.plan(get_reader(path), path, req), rows) if e == "result"][0]


def _grid(path, mode, parts, rows=None):
    from annzarro.core import cell_grid as cgr
    p = cgr.plan(get_reader(path), path, cgr.parse_request({"shape": "grid", "mode": mode, "partitionings": parts}))
    return [r for e, r in cgr.compute(p, rows) if e == "result"][0]


def test_m5_stored_categories_past_the_limit_count_only_those_holding_a_cell(categories_store):
    atlas = {"source": {"type": "obs", "key": "atlas"}}
    res = _group(categories_store, [atlas])                       # 5,000 stored, 80 used: grouped, not refused
    assert res.refused is None and len(res.groups) == 80
    assert [g["key"] for g in res.groups] == [[f"c:atlas{i * 62:05d}"] for i in range(80)]
    assert all(g["n"] in (37, 38) for g in res.groups) and res.n_grouped == 3000
    p = res.partitionings[0]
    assert [lv["id"] for lv in p["levels"]] == [g["key"][0] for g in res.groups]
    assert len(p["categories"]) == 5000                           # every stored category is still listed
    grid = _grid(categories_store, "categorical", [atlas])        # the grid's axis agrees
    assert grid.refused is None and grid.axes[0]["levels"] == [g["key"][0] for g in res.groups]


def test_m5_a_subset_counts_the_categories_of_the_cells_shown(categories_store):
    rows = np.arange(0, 3000, 80)                                 # every 80th cell: one category
    res = _group(categories_store, [{"source": {"type": "obs", "key": "wide"}}], rows)
    assert res.refused is None
    assert len(res.groups) == len({int(r) % 2500 for r in rows})


def test_m5_categories_holding_a_cell_past_the_limit_are_refused_with_their_count(categories_store):
    res = _group(categories_store, [{"source": {"type": "obs", "key": "wide"}}])      # 2,600 stored, 2,500 used
    assert res.refused == {"reason": "too_many_levels", "count": 2500, "limit": 2000, "partitioning": 0,
                           "levels": []}
    grid = _grid(categories_store, "categorical", [{"source": {"type": "obs", "key": "mid"}}])   # 300 > 200 stored
    assert grid.refused is None and len(grid.axes[0]["levels"]) == 80
    grid = _grid(categories_store, "categorical", [{"source": {"type": "obs", "key": "atlas"}},
                                                   {"source": {"type": "obs", "key": "wide"}}])
    assert grid.refused["reason"] == "too_many_levels" and grid.refused["count"] == 2500
    assert grid.refused["axis"] == 1


def test_m5_a_grid_axis_of_many_is_counted_after_its_read(store):
    res = _grid(store, "categorical", [{"source": {"type": "obs", "key": "many"}}])
    assert res.refused["reason"] == "too_many_levels"
    assert (res.refused["count"], res.refused["limit"]) == (1200, 200)


def test_m5_within_the_limit_the_column_is_read_once_and_nothing_changes(categories_store, monkeypatch):
    reads = []
    real = cg.cs.column
    monkeypatch.setattr(cg.cs, "column", lambda *a, **k: (reads.append(a[2]["key"]), real(*a, **k))[1])
    res = _group(categories_store, [{"source": {"type": "obs", "key": "mid"}}])        # 300 stored, under 2,000
    assert reads == ["mid"] and len(res.partitionings[0]["levels"]) == 300          # unused levels listed, n 0
    reads.clear()
    _group(categories_store, [{"source": {"type": "obs", "key": "atlas"}}])
    assert reads == ["atlas", "atlas"]                            # past the limit: a counting pass, then the read


# --------------------------------------------------------------------------------------------- M2, cell_sources


def _source_store(path, n, x_csc=None, text=None):
    """An obs + var + X store of ``n`` cells: ``x_csc`` = (indptr, indices, data) of a CSC X, ``text`` an obs
    column of strings (None for a missing value)."""
    root = zarr_compat.open_group(path, mode="w")
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    obs = root.create_group("obs")
    obs.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0", "_index": "_index",
                      "column-order": ["note"] if text is not None else []})
    zarr_compat.write_array(obs, "_index", np.zeros(n, dtype=np.int8), chunks=(1 << 16,))
    if text is not None:
        zarr_compat.write_strings(obs, "note", text, chunks=(1 << 14,))
    var = root.create_group("var")
    n_var = 0 if x_csc is None else len(x_csc[0]) - 1
    var.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0", "_index": "_index",
                      "column-order": []})
    zarr_compat.write_strings(var, "_index", [f"g{i}" for i in range(max(n_var, 1))])
    if x_csc is not None:
        g = root.create_group("X")
        g.attrs.update({"encoding-type": "csc_matrix", "encoding-version": "0.1.0", "shape": [n, n_var]})
        for name, arr in zip(("indptr", "indices", "data"), x_csc):
            zarr_compat.write_array(g, name, np.asarray(arr), chunks=(1 << 16,))
    for name in ("obsm", "obsp", "layers"):
        g = root.create_group(name)
        g.attrs.update({"encoding-type": "dict", "encoding-version": "0.1.0"})
    zarr_compat.consolidate(path)
    return path


def _old_layer_values(at, values, rows, n):
    """The layer path before FX-E (int64 entries, np.diff order test), as the reference."""
    at = np.asarray(at, dtype=np.int64)
    values = np.asarray(values)
    if at.size > 1 and (np.diff(at) <= 0).any():
        order = np.argsort(at, kind="stable")
        at, values = at[order], values[order]
    idx = np.arange(n, dtype=np.int64) if rows is None else np.asarray(rows, dtype=np.int64)
    out = np.zeros(idx.size, dtype=values.dtype)
    pos = np.searchsorted(at, idx)
    hit = (pos < at.size) & (at[np.minimum(pos, at.size - 1)] == idx)
    out[hit] = values[pos[hit]]
    return out


@pytest.mark.parametrize("order", ["sorted", "reversed", "shuffled"])
def test_m2_a_layer_column_is_bit_identical_to_the_int64_path(tmp_path, monkeypatch, order):
    from annzarro.core import cell_sources as cs
    n = 5000
    rng = np.random.default_rng(7)
    at = np.flatnonzero(rng.random(n) < 0.4).astype(np.int32)
    vals = rng.normal(size=at.size).astype(np.float32)
    if order == "reversed":
        at, vals = at[::-1].copy(), vals[::-1].copy()
    elif order == "shuffled":
        p = rng.permutation(at.size)
        at, vals = at[p], vals[p]
    path = _source_store(str(tmp_path / "x.zarr"), n, (np.array([0, at.size]), at, vals))
    monkeypatch.setattr(cs, "SLAB_ROWS", 700)
    for rows in (None, np.arange(1, n, 3), np.array([0, 17, 4999])):
        slabs = list(cs.column(get_reader(path), path, {"type": "layer", "key": "X", "column": "g0"}, rows))
        got = np.concatenate([s.values for s in slabs])
        want = _old_layer_values(at, vals, rows, n)
        assert got.dtype == want.dtype and got.tobytes() == want.tobytes()


def test_m2_a_layer_column_holds_its_entries_as_stored(tmp_path, monkeypatch):
    import tracemalloc
    from annzarro.core import cell_sources as cs
    n = 1_000_000
    at = np.arange(n, dtype=np.int32)                                         # every cell stored
    path = _source_store(str(tmp_path / "x.zarr"), n, (np.array([0, n]), at, np.ones(n, dtype=np.float32)))
    monkeypatch.setattr(cs, "SLAB_ROWS", 1 << 16)
    reader = get_reader(path)
    reader.enable_caching = False
    tracemalloc.start()
    try:
        for _ in cs.column(reader, path, {"type": "layer", "key": "X", "column": "g0"}, None):
            pass
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    # entries as read (4 B) and values (4 B), not an int64 copy and its np.diff (16 B more)
    assert peak < 14 * n, f"peak {peak / 1e6:.1f} MB for {n:,} entries"


def _old_text(values_by_slab):
    """The text path before FX-E (np.unique over a fixed-width copy) as the reference: codes, categories."""
    seen, provisional = {}, []
    for vals in values_by_slab:
        vals = np.asarray(vals, dtype=object)
        missing = np.fromiter((v is None for v in vals), dtype=bool, count=vals.size)
        out = np.full(vals.size, -1, dtype=np.int64)
        if not missing.all():
            distinct, inverse = np.unique(vals[~missing].astype(str), return_inverse=True)
            ids = np.asarray([seen.setdefault(v, len(seen)) for v in distinct.tolist()], dtype=np.int64)
            out[~missing] = ids[inverse.reshape(-1)]
        provisional.append(out)
    order = sorted(seen)
    rank = np.empty(len(order) + 1, dtype=np.int32)
    for r, v in enumerate(order):
        rank[seen[v]] = r
    rank[-1] = -1
    codes = np.concatenate(provisional)
    return rank[np.where(codes < 0, len(order), codes)], order


def test_m2_a_text_column_is_factorised_bit_identically_to_the_fixed_width_path(tmp_path, monkeypatch):
    from annzarro.core import cell_sources as cs
    n = 3000
    rng = np.random.default_rng(9)
    words = ["b", "a", "B", "ä", "a b", "", "z" * 40, "10", "9", "é", "é"]
    text = [words[int(rng.integers(len(words)))] for _ in range(n)]          # a plain string array holds no None
    path = _source_store(str(tmp_path / "t.zarr"), n, text=text)
    monkeypatch.setattr(cs, "SLAB_ROWS", 512)
    for rows in (None, np.arange(0, n, 7)):
        slabs = list(cs.column(get_reader(path), path, {"type": "obs", "key": "note"}, rows))
        got = np.concatenate([s.values for s in slabs])
        shown = list(range(n)) if rows is None else rows.tolist()
        spans = [[text[r] for r in shown[a:a + 512]] for a in range(0, len(shown), 512)]
        want, cats = _old_text(spans)
        assert got.dtype == want.dtype and got.tobytes() == want.tobytes()
        assert slabs[0].categories == cats and all(type(c) is str for c in cats)


def test_m2_one_long_value_does_not_widen_a_text_slab(tmp_path, monkeypatch):
    import tracemalloc
    from annzarro.core import cell_sources as cs
    n = 20_000
    text = [f"t{i % 5}" for i in range(n)]
    text[7] = "x" * 2000                                                       # one long name
    path = _source_store(str(tmp_path / "t.zarr"), n, text=text)
    reader = get_reader(path)
    reader.enable_caching = False
    tracemalloc.start()
    try:
        slabs = list(cs.column(reader, path, {"type": "obs", "key": "note"}, None))
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert len(slabs[0].categories) == 6
    # a fixed-width copy is n x 4 B x 2,000 characters (160 MB); the strings themselves are a few MB
    assert peak < 40_000_000, f"peak {peak / 1e6:.1f} MB"
