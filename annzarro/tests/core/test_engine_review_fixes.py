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


def test_h1_measures_count_in_the_value_limit(store, monkeypatch):
    monkeypatch.setattr(gf, "MAX_FEATURE_CELLS", 4 * N_CELL_TYPES)
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


def test_h1_accumulate_holds_at_most_one_grids_moments(store, monkeypatch):
    monkeypatch.setattr(gf, "MAX_GRID_MEASURE_CELLS", 100)
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


def test_m8_a_grouping_over_the_limit_with_no_way_out_reads_no_further(store, monkeypatch):
    monkeypatch.setitem(cg.GROUPING_LIMITS, "groups", 100)
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
