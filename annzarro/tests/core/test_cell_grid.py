"""The grid shape (annzarro/core/cell_grid.py): a dense count over the product of the count plot's partitionings
(SHR-39, CNT-8 to CNT-13).

Checked against F0's brute-force reference (``grouping_store.reference_grid``) on the named grid recipes of
``tests/data/grouping_expected.json`` in every layout and backend; against ``numpy.histogramdd`` over a sweep of
bin counts and ranges; against a bit-code count for 16 sets; and by hand for what neither covers: values outside
a range (excluded, and counted once, on the first axis whose range they fail), the density pre-pass, the limits of
every mode (refused before any read), measures per grid cell, and the reply the browser's reader takes.
"""
import base64
import itertools
import json
import math
import os
import shutil
import subprocess
import time

import numpy as np
import pytest

from annzarro.core import binning as bn
from annzarro.core import cell_grid as cgr
from annzarro.core import cell_groups as cg
from annzarro.core import cell_sources as cs
from annzarro.core import gene_score as gsc
from annzarro.core import get_reader
from annzarro.tests import zarr_compat
from annzarro.tests.core import grouping_store as gs

EXPECTED = json.load(open(gs.EXPECTED_PATH, encoding="utf-8"))
LAYOUT_BACKEND = list(itertools.product(gs.LAYOUTS, gs.BACKENDS))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
COUNT_MODEL = os.path.join(REPO, "static", "js", "utils", "count-plot-model.js")


@pytest.fixture(scope="module")
def data():
    return gs.make_data()


@pytest.fixture(scope="module")
def stores(tmp_path_factory):
    base = tmp_path_factory.mktemp("grid")
    return {(lay, be): gs.make_store(base / f"{lay}_{be}.{'zarr' if be == 'zarr' else 'h5ad'}", lay, be)
            for lay, be in LAYOUT_BACKEND}


@pytest.fixture(scope="module")
def store(stores):
    return stores["csc", "zarr"]


def body(mode, parts, **kw):
    out = {"shape": "grid", "mode": mode, "partitionings": parts}
    out.update(kw)
    return out


def plan_of(path, mode, parts, **kw):
    return cgr.plan(get_reader(path), path, cgr.parse_request(body(mode, parts, **kw)))


def run(path, mode, parts, rows=None, should_stop=None, pause=None, **kw):
    p = plan_of(path, mode, parts, **kw)
    events = list(cgr.compute(p, rows, should_stop=should_stop, pause=pause))
    kinds = [e for e, _ in events]
    assert kinds[-1] == "result" and set(kinds[:-1]) <= {"progress"}
    return events[-1][1]


def reply(res):
    head, blocks = res.to_reply()
    return head, dict(blocks)


def counts_of(res):
    head, blocks = reply(res)
    assert res.refused is None, res.refused
    return np.asarray(blocks["counts"]).reshape([len(a["levels"]) for a in head["axes"]])


def obs(key, **kw):
    return {"source": {"type": "obs", "key": key}, **kw}


def width(key, bins, rng=None, outside="exclude", **kw):
    b = {"method": "equal_width", "bins": bins, "outside": outside}
    if rng is not None:
        b["range"] = list(rng)
    b.update(kw)
    return obs(key, binning=b)


def bitset(mask):
    return {"encoding": "bitset-base64", "length": int(mask.size),
            "data": base64.b64encode(np.packbits(mask, bitorder="little").tobytes()).decode()}


def table(ref):
    return {"source": {"type": "table", "ref": ref, "key": f"table-{ref}"}}


def values(data, key):
    return data.obs[key].to_numpy(dtype=np.float64)


# --------------------------------------------------------------------------------------------- the reference

MODES_OF_RECIPES = {
    "cell_type_x_condition": "categorical",
    "three_axes": "categorical",
    "pseudotime_x_cell_type": "1d",
    "sample_x_cell_type": "categorical",
    "kept_other_x_condition": "categorical",
    "depth_zero_bin_x_condition": "1d",
}


def test_every_named_grid_recipe_has_a_mode():
    assert set(MODES_OF_RECIPES) == set(EXPECTED["grid"])


@pytest.mark.parametrize("layout,backend", LAYOUT_BACKEND)
@pytest.mark.parametrize("name", sorted(MODES_OF_RECIPES))
def test_named_recipes_match_the_expected_file(stores, layout, backend, name):
    want = EXPECTED["grid"][name]
    recipe = want["recipe"]
    kw = {}
    if recipe.get("measure"):
        kw["measures"] = [{"id": "m0", **recipe["measure"]}]
    res = run(stores[layout, backend], MODES_OF_RECIPES[name], recipe["partitionings"], gs.recipe_rows(recipe), **kw)
    head, blocks = reply(res)
    assert [a["levels"] for a in head["axes"]] == [a["levels"] for a in want["axes"]]
    assert [a["n_outside"] for a in head["axes"]] == [a["n_outside"] for a in want["axes"]]
    assert blocks["counts"].tolist() == want["counts"]
    assert head["n_counted"] == want["n_counted"]
    assert head["n_shown"] == want["n_shown"]
    if "measure" in want:
        got = blocks["measure_moments"]
        assert got.shape == (1, len(want["counts"]), 5)
        assert gs.same(got[0].tolist(), want["measure"], rtol=1e-12)


# --------------------------------------------------------------------------------------------- dense counts

@pytest.mark.parametrize("bins", [(2, 2), (3, 7), (16, 5), (64, 64), (512, 512), (511, 2)])
@pytest.mark.parametrize("rows", [None, gs.SHOWN_THIRD], ids=["all", "third"])
def test_dense_counts_equal_histogramdd(store, data, bins, rows):
    x, y = values(data, "score"), values(data, "signed")
    rx, ry = (3.0, 7.5), (-1.5, 2.0)
    res = run(store, "2d", [width("score", bins[0], rx), width("signed", bins[1], ry), obs("cell_type")], rows)
    counts = counts_of(res)
    head, _ = reply(res)
    shown = np.arange(gs.N_OBS) if rows is None else np.asarray(rows)
    split = data.obs["cell_type"].cat.codes.to_numpy()
    ex, ey = np.asarray(head["axes"][0]["edges"]), np.asarray(head["axes"][1]["edges"])
    np.testing.assert_array_equal(ex, np.histogram_bin_edges(x, bins[0], range=rx))
    np.testing.assert_array_equal(ey, np.histogram_bin_edges(y, bins[1], range=ry))
    want, _ = np.histogramdd(np.stack([x[shown], y[shown], split[shown]], axis=1),
                             bins=[ex, ey, np.arange(7) - 0.5])
    assert counts.shape == want.shape                  # no @na: score and signed have a value everywhere
    np.testing.assert_array_equal(counts, want.astype(np.int64))
    assert head["n_counted"] == int(want.sum())


@pytest.mark.parametrize("bins", [2, 50, 999, 1000, 1001, 2000])
def test_a_one_dimensional_count_takes_up_to_2000_bins(store, data, bins):
    res = run(store, "1d", [width("score", bins)])
    head, blocks = reply(res)
    assert head["axes"][0]["bins_made"] == bins
    want, _ = np.histogram(values(data, "score"), bins=bins)
    np.testing.assert_array_equal(blocks["counts"], want)


def test_first_axis_slowest_and_the_block_types(store, data):
    res = run(store, "categorical", [obs("condition"), obs("cell_type")])
    head, blocks = reply(res)
    assert blocks["counts"].dtype == np.uint32
    assert head["blocks"] == [{"name": "counts", "dtype": "uint32", "length": 12}]
    cond = data.obs["condition"].cat.codes.to_numpy()
    ct = data.obs["cell_type"].cat.codes.to_numpy()
    np.testing.assert_array_equal(blocks["counts"], np.bincount(cond * 6 + ct, minlength=12))


# --------------------------------------------------------------------------------------------- sets

@pytest.mark.parametrize("rows", [None, gs.SHOWN_THIRD], ids=["all", "third"])
def test_sixteen_sets_count_like_a_bit_code(store, rows):
    n = gs.N_OBS if rows is None else len(rows)
    rng = np.random.default_rng(16)
    masks = [rng.random(n) < p for p in np.linspace(0.05, 0.95, 16)]
    sets = {f"s{i}": bitset(m) for i, m in enumerate(masks)}
    res = run(store, "sets", [table(f"s{i}") for i in range(16)], rows, sets=sets)
    head, blocks = reply(res)
    assert [a["levels"] for a in head["axes"]] == [["@in", "@out"]] * 16
    code = np.zeros(n, dtype=np.int64)
    for m in masks:                                     # @in is level 0, @out level 1; the first set slowest
        code = code * 2 + (~m).astype(np.int64)
    np.testing.assert_array_equal(blocks["counts"], np.bincount(code, minlength=1 << 16))
    assert head["n_counted"] == n and head["n_shown"] == n


def test_a_set_is_binary_and_counts_its_cells_without_a_value_as_out(store, data):
    parts = [obs("pseudotime", member={"op": ">", "value": 0.5}),
             obs("cell_type", member={"levels": ["c:B cell", "c:T cell"]})]
    res = run(store, "sets", parts)
    head, blocks = reply(res)
    pt = values(data, "pseudotime")
    a = np.isfinite(pt) & (pt > 0.5)
    b = data.obs["cell_type"].isin(["B cell", "T cell"]).to_numpy()
    want = np.bincount((~a).astype(int) * 2 + (~b).astype(int), minlength=4)
    np.testing.assert_array_equal(blocks["counts"], want)
    assert head["axes"][0]["n_no_value"] == 20                       # counted out, and said so (CNT-5, CNT-22)
    assert head["axes"][0]["kind"] == "member"
    assert head["n_counted"] == gs.N_OBS


@pytest.mark.parametrize("part,reason", [
    (obs("cell_type"), "not_a_set"),
    (width("score", 4), "not_a_set"),
    ({**table("s0"), "rest": "exclude"}, "not_a_set"),
])
def test_only_binary_sets_are_taken_in_sets_mode(store, part, reason):
    sets = {"s0": bitset(np.ones(gs.N_OBS, dtype=bool))}
    with pytest.raises(cg.GroupError) as e:
        plan_of(store, "sets", [table("s0"), part], sets=sets)
    assert e.value.reason == reason and e.value.extra["axis"] == 1


# --------------------------------------------------------------------------------------------- outside a range

def test_excluded_cells_are_counted_once_on_the_first_axis_they_fail(store, data):
    rx, ry = (3.0, 7.0), (-1.0, 1.0)
    res = run(store, "2d", [width("score", 8, rx), width("signed", 8, ry)])
    head, _ = reply(res)
    x, y = values(data, "score"), values(data, "signed")
    x_below, x_above = x < rx[0], x > rx[1]
    x_out = x_below | x_above
    y_below, y_above = (y < ry[0]) & ~x_out, (y > ry[1]) & ~x_out
    assert head["axes"][0]["n_outside"] == [int(x_below.sum()), int(x_above.sum())]
    assert head["axes"][1]["n_outside"] == [int(y_below.sum()), int(y_above.sum())]
    both = x_out & ((y < ry[0]) | (y > ry[1]))
    assert both.any()                                                 # the case is in the data
    outside = sum(sum(a["n_outside"]) for a in head["axes"])
    assert outside == int((x_out | (y < ry[0]) | (y > ry[1])).sum())
    assert head["n_counted"] + outside == head["n_shown"]


def test_an_axis_without_a_range_reports_no_cell_outside(store):
    head, _ = reply(run(store, "categorical", [obs("cell_type"), obs("condition")]))
    assert [a["n_outside"] for a in head["axes"]] == [[0, 0], [0, 0]]


def test_clamp_keeps_the_cells_in_the_end_bins_and_leaves_none_out(store, data):
    res = run(store, "1d", [width("score", 4, (3.0, 7.0), outside="clamp")])
    head, blocks = reply(res)
    x = values(data, "score")
    assert int(blocks["counts"][0]) == int((x < 4).sum()) and int(blocks["counts"][3]) == int((x >= 6).sum())
    assert head["axes"][0]["n_outside"] == [0, 0]                    # cells left out: none (lead notes, C1)
    assert head["n_counted"] == gs.N_OBS


def test_rest_exclude_is_not_outside_and_the_outside_cell_still_counts_on_its_axis(store, data):
    """A cell in no level of a categorical axis (rest: exclude) fails no range there; outside the range of a later
    axis, it is that axis's."""
    parts = [obs("cell_type", levels=["c:B cell"], rest="exclude"), width("score", 4, (3.0, 7.0))]
    head, blocks = reply(run(store, "1d", parts))
    x = values(data, "score")
    b = (data.obs["cell_type"] == "B cell").to_numpy()
    assert head["axes"][0]["n_outside"] == [0, 0]
    assert head["axes"][1]["n_outside"] == [int((x < 3).sum()), int((x > 7).sum())]
    assert head["n_counted"] == int((b & (x >= 3) & (x <= 7)).sum()) == int(blocks["counts"].sum())


def test_a_count_input_may_exclude_while_a_grouping_clamps(store):
    part = width("score", 4, (3.0, 7.0))
    req = cg.parse_request({"shape": "grouping", "partitionings": [part]})
    with pytest.raises(cg.GroupError) as e:
        cg.plan(get_reader(store), store, req)
    assert e.value.reason == "outside_exclude"
    assert run(store, "1d", [part]).refused is None


def test_no_value_is_its_own_level_on_a_binned_axis(store, data):
    head, blocks = reply(run(store, "1d", [width("pseudotime", 4)]))
    assert head["axes"][0]["levels"] == ["bin:0", "bin:1", "bin:2", "bin:3", "@na"]
    assert blocks["counts"][-1] == 20 and head["axes"][0]["n_no_value"] == 20
    with_value = np.flatnonzero(np.isfinite(values(data, "pseudotime")))
    head, blocks = reply(run(store, "1d", [width("pseudotime", 4)], rows=with_value))
    assert head["axes"][0]["levels"] == ["bin:0", "bin:1", "bin:2", "bin:3"]       # no cell without a value: no @na


def test_degenerate_data_has_one_level_and_its_value(store):
    head, blocks = reply(run(store, "1d", [width("constant", 10)]))
    a = head["axes"][0]
    assert a["levels"] == ["bin:0"] and a["degenerate"] is True and a["value"] == 2.5 and a["bins_made"] == 1
    assert blocks["counts"].tolist() == [gs.N_OBS]


# --------------------------------------------------------------------------------------------- the density pre-pass

def _density_range(v, d, stored=(None, None)):
    v = v[np.isfinite(v)]
    n, sigma = v.size, float(np.std(v, ddof=1))
    h = sigma * n ** (-1.0 / (d + 4))
    lo, hi = np.quantile(v, [0.001, 0.999])
    lo, hi = float(lo) - 3 * h, float(hi) + 3 * h
    return n, sigma, h, (lo if stored[0] is None else stored[0], hi if stored[1] is None else stored[1])


def test_the_density_pre_pass_takes_the_range_from_the_tails_padded_by_3h(stores, data):
    path = stores["csr", "h5ad"]
    rows = np.flatnonzero(values(data, "score") < 9.5)              # a tail the 99.9th percentile then cuts
    res = run(path, "1d", [width("score", 512), obs("condition")], rows, density=True)
    head, blocks = reply(res)
    x = values(data, "score")[rows]
    n, sigma, h, (lo, hi) = _density_range(x, 1)
    a = head["axes"][0]
    assert a["density"]["n"] == n
    assert math.isclose(a["density"]["sigma"], sigma, rel_tol=1e-12)
    assert math.isclose(a["density"]["bandwidth"], h, rel_tol=1e-12)
    assert a["density"]["range"] == pytest.approx([lo, hi], rel=1e-12)
    assert a["edges"][0] == a["density"]["range"][0] and a["edges"][-1] == a["density"]["range"][1]
    assert len(a["edges"]) == 513
    outside = int((x < a["edges"][0]).sum()), int((x > a["edges"][-1]).sum())
    assert a["n_outside"] == list(outside)
    assert head["axes"][1]["levels"] == ["c:ctrl", "c:treated"]
    assert int(blocks["counts"].sum()) == rows.size - sum(outside) == head["n_counted"]
    want, _ = np.histogram(x, bins=np.asarray(a["edges"]))
    np.testing.assert_array_equal(blocks["counts"].reshape(512, 2).sum(axis=1), want)


def test_a_two_dimensional_density_uses_d_2_in_scotts_rule(store, data):
    res = run(store, "2d", [width("score", 256), width("signed", 256), obs("condition")], density=True)
    head, _ = reply(res)
    for i, key in enumerate(("score", "signed")):
        n, sigma, h, rng = _density_range(values(data, key), 2)
        assert math.isclose(head["axes"][i]["density"]["bandwidth"], h, rel_tol=1e-12)
        assert head["axes"][i]["density"]["range"] == pytest.approx(list(rng), rel=1e-12)
    assert "density" not in head["axes"][2]


def test_a_stored_side_of_the_range_stands_under_density(store, data):
    head, _ = reply(run(store, "1d", [width("score", 512, (None, 8.0))], density=True))
    x = values(data, "score")
    _, _, _, (lo, _) = _density_range(x, 1)
    assert head["axes"][0]["density"]["range"] == pytest.approx([lo, 8.0], rel=1e-12)
    assert head["axes"][0]["n_outside"] == [int((x < head["axes"][0]["edges"][0]).sum()), int((x > 8.0).sum())]
    assert head["axes"][0]["n_outside"][1] > 0


def test_the_density_quantiles_are_exact(store, data):
    head, _ = reply(run(store, "1d", [width("pseudotime", 512)], density=True))
    v = values(data, "pseudotime")
    v = v[np.isfinite(v)]
    q = np.quantile(v, [0.001, 0.999])
    d = head["axes"][0]["density"]
    assert d["quantiles"] == [float(q[0]), float(q[1])]                  # bit for bit
    assert d["range"] == [d["quantiles"][0] - 3 * d["bandwidth"], d["quantiles"][1] + 3 * d["bandwidth"]]


@pytest.mark.parametrize("mode,parts,reason", [
    ("categorical", [obs("cell_type")], "density_mode"),
    ("1d", [obs("cell_type")], "density_not_numeric"),
    ("1d", [obs("score", binning={"method": "manual", "thresholds": [4.0, 6.0]})], "density_not_numeric"),
    ("2d", [width("score", 64), obs("cell_type")], "density_not_numeric"),
])
def test_a_density_needs_numeric_binned_axes(store, mode, parts, reason):
    with pytest.raises(cg.GroupError) as e:
        plan_of(store, mode, parts, density=True)
    assert e.value.reason == reason


# --------------------------------------------------------------------------------------------- limits

#: Every category kept by name: kept levels count before any read. A column storing more categories than its axis
#: limit counts those holding a cell shown, which only the read tells (SHR-6, SHR-7).
ALL_MANY = [f"c:m{i:04d}" for i in range(gs.N_MANY)]
ALL_SAMPLES = [gs.ref_label(n) for n in gs.sample_names()]


@pytest.fixture
def no_reads(monkeypatch):
    def refuse(*a, **k):
        raise AssertionError("read before the limits were checked")
    monkeypatch.setattr(cs, "column", refuse)
    monkeypatch.setattr(gsc, "compute", refuse)


def _refusal(store, mode, parts, **kw):
    with pytest.raises(cg.GroupError) as e:
        plan_of(store, mode, parts, **kw)
    assert e.value.status == 422
    return e.value


@pytest.mark.parametrize("mode,parts,axis,count,limit,reason", [
    ("1d", [width("score", 50), obs("many", levels=ALL_MANY)], 1, 2001, 200, "too_many_levels"),
    ("2d", [width("score", 4), width("signed", 4), obs("sample", levels=ALL_SAMPLES)], 2, 30, 8, "too_many_levels"),
    ("2d", [width("score", 4, zero_bin=False), width("signed", 4),
            obs("depth", binning={"method": "equal_width", "bins": 8, "zero_bin": True})], 2, 9, 8, "too_many_bins"),
    ("categorical", [obs("many", levels=ALL_MANY)], 0, 2001, 200, "too_many_levels"),
    ("categorical", [obs("cell_type"), obs("many", levels=ALL_MANY)], 1, 2001, 200, "too_many_levels"),
])
def test_every_axis_limit_is_refused_before_any_read(store, no_reads, mode, parts, axis, count, limit, reason):
    e = _refusal(store, mode, parts)
    assert e.reason == reason
    assert (e.extra["axis"], e.extra["count"], e.extra["limit"], e.extra["mode"]) == (axis, count, limit, mode)


@pytest.mark.parametrize("mode,parts,limit,reason", [
    ("1d", [width("score", 2001)], 2000, "bad_bins"),
    ("1d", [width("score", 4), width("signed", 201)], 200, "bad_bins"),
    ("2d", [width("score", 513), width("signed", 4)], 512, "bad_bins"),
    ("2d", [width("score", 4), width("signed", 513)], 512, "bad_bins"),
    ("categorical", [obs("score", binning={"method": "manual", "thresholds": list(range(200))})], 199,
     "bad_thresholds"),
])
def test_a_bin_count_over_its_axis_limit_is_refused_by_the_binning_before_any_read(store, no_reads, mode, parts,
                                                                                  limit, reason):
    with pytest.raises(cg.GroupError) as e:
        plan_of(store, mode, parts)
    assert e.value.status == 400 and e.value.reason == reason
    assert e.value.extra.get("maximum", e.value.extra.get("limit")) == limit


def test_the_limits_are_the_plans():
    assert cgr.GRID_LIMITS == {"2d": (512, 512, 8), "1d": (2000, 200), "categorical": (200, 200), "sets": 16}
    assert cgr.MAX_GRID_MEASURE_CELLS == 2_097_152 == 512 * 512 * 8


@pytest.mark.parametrize("n,reason,limit", [(17, "too_many_sets", 16), (1, "too_few_sets", 2)])
def test_sets_are_two_to_sixteen_before_any_read(store, no_reads, n, reason, limit):
    sets = {f"s{i}": bitset(np.ones(gs.N_OBS, dtype=bool)) for i in range(n)}
    e = _refusal(store, "sets", [table(f"s{i}") for i in range(n)], sets=sets)
    assert e.reason == reason and e.extra["count"] == n and e.extra["limit"] == limit


@pytest.mark.parametrize("mode,parts,reason", [
    ("1d", [width("score", 4), obs("condition"), obs("cell_type")], "too_many_axes"),
    ("2d", [width("score", 4)], "too_few_axes"),
    ("2d", [width("score", 4)] * 4, "too_many_axes"),
    ("categorical", [obs("cell_type")] * 4, "too_many_axes"),
])
def test_the_number_of_axes_is_the_modes(store, no_reads, mode, parts, reason):
    with pytest.raises(cg.GroupError) as e:
        plan_of(store, mode, parts)
    assert e.value.reason == reason


def test_the_cell_cap_is_checked_before_the_axis_limits(store, no_reads):
    # 512 x 512 x 30: the split breaks its limit of 8, but the grid breaks the cap first
    e = _refusal(store, "2d", [width("score", 512), width("signed", 512), obs("sample", levels=ALL_SAMPLES)])
    assert e.reason == "grid_too_large" and e.extra["count"] == 512 * 512 * 30
    assert e.extra["limit"] == cgr.MAX_GRID_MEASURE_CELLS
    # a categorical heatmap's third axis (the factor of top_level) has only the cap
    e = _refusal(store, "categorical", [width("score", 200), width("signed", 200), obs("many", levels=ALL_MANY)])
    assert e.reason == "grid_too_large" and e.extra["count"] == 200 * 200 * 2001


def test_the_cap_itself_is_allowed(store):
    split = obs("depth", binning={"method": "equal_width", "bins": 7, "zero_bin": True})     # @zero and 7 bins
    p = plan_of(store, "2d", [width("score", 512), width("signed", 512), split])
    assert p.estimate()["cells"] == 512 * 512 * 8 == cgr.MAX_GRID_MEASURE_CELLS


def test_the_measure_grid_is_numbered_over_the_listed_levels(store, data):
    """No @na listed: a measure over a grid at the cap is taken, though @na slots would have made it larger."""
    split = obs("depth", binning={"method": "equal_width", "bins": 7, "zero_bin": True})
    m = [{"id": "m0", "source": {"type": "obs", "key": "score"}}]
    res = run(store, "2d", [width("score", 512), width("signed", 512), split], measures=m)
    head, blocks = reply(res)
    assert res.refused is None and blocks["measure_moments"].shape == (1, cgr.MAX_GRID_MEASURE_CELLS, 5)
    assert blocks["measure_moments"][0, :, 0].tolist() == blocks["counts"].tolist()


def test_a_measure_over_a_grid_past_the_cap_once_read_is_refused_in_the_result(store):
    # 512 x 512 x 8 declared; pseudotime's @na makes it 513 x 512 x 8 once read
    split = obs("depth", binning={"method": "equal_width", "bins": 7, "zero_bin": True})
    m = [{"id": "m0", "source": {"type": "obs", "key": "score"}}]
    res = run(store, "2d", [width("pseudotime", 512), width("signed", 512), split], measures=m)
    assert res.refused["reason"] == "grid_too_large" and res.refused["count"] == 513 * 512 * 8
    assert run(store, "2d", [width("pseudotime", 512), width("signed", 512), split]).refused is None


def test_a_level_count_known_only_after_reading_is_refused_in_the_result(store):
    # batch split by its values has 12 levels: over the 2d split limit of 8, known once the column is read
    res = run(store, "2d", [width("score", 4), width("signed", 4), obs("batch", binning={"method": "categories"})])
    assert res.refused["reason"] == "too_many_levels" and res.refused["axis"] == 2
    assert (res.refused["count"], res.refused["limit"]) == (12, 8)
    head, blocks = res.to_reply()
    assert head["refused"] == res.refused and blocks == [] and "blocks" not in head


def test_cell_names_are_refused_past_the_axis_limit(store):
    res = run(store, "categorical", [obs("_index")], rows=np.arange(201))
    assert res.refused["reason"] == "too_many_levels" and res.refused["count"] == 201
    head, blocks = reply(run(store, "categorical", [obs("_index")], rows=np.arange(5)))
    assert head["axes"][0]["levels"] == [f"c:{gs.cell(i)}" for i in range(5)]


# --------------------------------------------------------------------------------------------- measures

@pytest.mark.parametrize("source,above", [
    ({"type": "obs", "key": "pseudotime"}, 0.5),
    ({"type": "layer", "key": "logged", "column": gs.gene(2)}, 0.0),
    ({"type": "obsm", "key": "X_umap", "column": 1}, -0.25),
])
@pytest.mark.parametrize("layout,backend", [("csc", "zarr"), ("csr", "h5ad"), ("dense", "zarr")])
def test_measure_moments_per_grid_cell(stores, data, layout, backend, source, above):
    parts = [obs("cell_type"), width("score", 3, (3.0, 7.0))]
    res = run(stores[layout, backend], "1d", parts, measures=[{"id": "m0", "source": source, "above": above}])
    head, blocks = reply(res)
    assert head["moments"] == ["n", "sum", "sumsq", "n_above", "sum_above"]
    assert head["measures"] == [{"id": "m0", "status": "ok"}]
    got = blocks["measure_moments"]
    assert got.dtype == np.float64 and got.shape == (1, 18, 5)
    if source["type"] == "obs":
        col = values(data, source["key"])
    elif source["type"] == "layer":
        col = data.logged[:, data.var_names.index(source["column"])].astype(np.float64)
    else:
        col = data.obsm["X_umap"][:, 1].astype(np.float64)
    ct = data.obs["cell_type"].cat.codes.to_numpy()
    x = values(data, "score")
    inside = (x >= 3) & (x <= 7)
    xb = np.minimum(np.searchsorted(np.linspace(3, 7, 4)[1:-1], x, side="right"), 2)
    for c in range(6):
        for b in range(3):
            m = inside & (ct == c) & (xb == b)
            assert gs.same(got[0, c * 3 + b].tolist(), gs.moments(col[m], above), rtol=1e-12)


def test_the_measure_moments_sum_to_the_counted_cells(store, data):
    m = [{"id": "m", "source": {"type": "obs", "key": "score"}}]
    res = run(store, "categorical", [obs("condition")], measures=m)
    head, blocks = reply(res)
    m = blocks["measure_moments"][0]
    assert m[:, 0].tolist() == blocks["counts"].tolist()
    assert math.isclose(m[:, 1].sum(), values(data, "score").sum(), rel_tol=1e-12)
    assert m[:, 3].sum() == int((values(data, "score") > 0).sum())          # above defaults to 0


@pytest.mark.parametrize("measures,reason", [
    ({"id": "m0"}, "bad_request"),
    ([{"source": {"type": "obs", "key": "score"}}], "bad_request"),
    ([{"id": "m0", "source": {"type": "obs", "key": "score"}, "above": "1"}], "bad_threshold"),
    ([{"id": "m0", "source": {"type": "obs", "key": "score"}, "stat": "mean"}], "unknown_field"),
    ([{"id": "m0", "source": {"type": "table", "ref": "s0"}}], "not_numeric"),
    ([{"id": "m0", "source": {"type": "obs", "key": "score"}}, {"id": "m1", "source": {"type": "obs", "key": "depth"}}],
     "too_many_measures"),
])
def test_bad_measures_are_refused(measures, reason):
    with pytest.raises(cg.GroupError) as e:
        cgr.parse_request(body("categorical", [obs("cell_type")], measures=measures))
    assert e.value.reason == reason


def test_a_categorical_measure_is_refused_before_reading(store, no_reads):
    with pytest.raises(cg.GroupError) as e:
        plan_of(store, "categorical", [obs("condition")],
                measures=[{"id": "m0", "source": {"type": "obs", "key": "cell_type"}}])
    assert e.value.reason == "not_numeric"


# --------------------------------------------------------------------------------------------- the request

@pytest.mark.parametrize("raw,reason", [
    ({"shape": "grid", "partitionings": [obs("cell_type")]}, "bad_mode"),
    ({"shape": "grid", "mode": "3d", "partitionings": [obs("cell_type")]}, "bad_mode"),
    ({"shape": "grouping", "mode": "1d", "partitionings": [obs("cell_type")]}, "bad_shape"),
    (body("categorical", [obs("cell_type")], small={"threshold": 10, "mode": "keep"}), "unknown_field"),
    (body("categorical", [obs("cell_type")], want={"codes": True}), "unknown_field"),
    (body("categorical", [obs("cell_type")], features=[]), "unknown_field"),
    (body("categorical", [obs("cell_type")], density="yes"), "bad_request"),
    (body("categorical", [{"source": {"type": "obs", "key": "cell_type"}, "colour": "red"}]), "unknown_field"),
    (body("sets", [table("s0"), table("s1")], sets={"s0": bitset(np.ones(8, dtype=bool))}), "set_missing"),
    (body("categorical", []), "bad_request"),
])
def test_bad_requests_are_refused_with_a_reason(raw, reason):
    with pytest.raises(cg.GroupError) as e:
        cgr.parse_request(raw)
    assert e.value.reason == reason


def test_the_estimate_and_the_lane(stores):
    p = plan_of(stores["csc", "zarr"], "1d", [width("score", 50), obs("condition")])
    est = p.estimate()
    assert est["lane"] == "light" and est["tier"] == "auto" and est["cells"] == 100
    assert est["n_cells"] == gs.N_OBS and len(est["parts"]) == 2
    gene = {"source": {"type": "layer", "key": "logged", "column": gs.gene(2)}, "binning": {"method": "equal_width"}}
    assert plan_of(stores["csr", "zarr"], "1d", [gene]).lane == "heavy"            # a gene of a csr matrix
    assert plan_of(stores["csc", "zarr"], "1d", [gene]).lane == "light"
    m = [{"id": "m0", "source": {"type": "layer", "key": "logged", "column": gs.gene(2)}}]
    assert plan_of(stores["csr", "zarr"], "categorical", [obs("condition")], measures=m).lane == "heavy"


def test_should_stop_cancels(store):
    p = plan_of(store, "categorical", [obs("cell_type"), obs("condition")])
    with pytest.raises(gsc.ScoreCancelled):
        list(cgr.compute(p, should_stop=lambda: True))


def test_a_pause_is_waited_on_between_slabs(store, monkeypatch):
    monkeypatch.setattr(cs, "SLAB_ROWS", 256)

    class Pause:
        def __init__(self):
            self.waits = 0

        def wanted(self):
            return self.waits < 3

        def wait(self):
            self.waits += 1
    pause = Pause()
    res = run(store, "1d", [width("score", 8), obs("cell_type")], pause=pause)
    assert pause.waits == 3 and res.refused is None


def test_the_slab_size_does_not_change_the_counts(store, monkeypatch):
    parts = [width("pseudotime", 7, (0.1, 0.9)), width("score", 5, (3.0, 7.0)), obs("cell_type")]
    m = [{"id": "m0", "source": {"type": "obs", "key": "depth"}, "above": 1.0}]
    want = reply(run(store, "2d", parts, measures=m))
    for slab in (97, 512, 1 << 22):
        monkeypatch.setattr(cs, "SLAB_ROWS", slab)
        got = reply(run(store, "2d", parts, measures=m))
        assert got[0] == want[0]
        np.testing.assert_array_equal(got[1]["counts"], want[1]["counts"])
        # the sums are taken slab by slab: their last bit may differ with the slabs
        np.testing.assert_allclose(got[1]["measure_moments"], want[1]["measure_moments"], rtol=1e-13)


def test_progress_counts_axes_and_measures(store):
    p = plan_of(store, "categorical", [obs("cell_type"), obs("condition")],
                measures=[{"id": "m0", "source": {"type": "obs", "key": "score"}}])
    events = list(cgr.compute(p))
    progress = [e for k, e in events if k == "progress"]
    grid = [e for e in progress if e["stage"] == "grid"]
    assert grid[0] == {"stage": "grid", "done": 0, "total": 2} and grid[-1] == {"stage": "grid", "done": 2, "total": 2}
    measured = [e for e in progress if e["stage"] == "features"]               # group_features' own frames
    assert measured and measured[-1]["done"] == measured[-1]["total"] == 1
    assert progress.index(grid[-1]) < progress.index(measured[0])


# --------------------------------------------------------------------------------------------- the browser's reader

def _node():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not on PATH")
    return node


def test_the_reply_is_what_the_browsers_reader_takes(store, tmp_path):
    node = _node()
    cases = [
        ("1d", [width("score", 6, (3.0, 7.0)), obs("condition")], {}),
        ("1d", [width("pseudotime", 4), obs("cell_type")],
         {"measures": [{"id": "m0", "source": {"type": "obs", "key": "score"}}]}),
        ("1d", [width("constant", 4)], {}),
        ("categorical", [obs("cell_type", levels=["c:T cell"]), obs("is_doublet")], {}),
        ("sets", [obs("depth", member={"op": ">", "value": 1.0}),
                  obs("cell_type", member={"levels": ["c:B cell"]})], {}),
    ]
    replies = []
    for mode, parts, kw in cases:
        head, blocks = reply(run(store, mode, parts, **kw))
        value = {"reply": {k: v for k, v in head.items() if k != "blocks"}, "counts": blocks["counts"].tolist(),
                 "measures": None}                     # a group-store handle's values: the frame, its blocks apart
        if "measure_moments" in blocks:
            value["measures"] = blocks["measure_moments"][0].reshape(-1).tolist()
        replies.append(value)
    path = tmp_path / "replies.json"
    path.write_text(json.dumps(replies))
    script = (f"import {{ readGrid }} from {json.dumps('file://' + COUNT_MODEL)};\n"
              f"import {{ readFileSync }} from 'node:fs';\n"
              f"const replies = JSON.parse(readFileSync({json.dumps(str(path))}, 'utf8'));\n"
              "console.log(JSON.stringify(replies.map((r) => { const g = readGrid(r); "
              "return { cells: g.cells, counted: g.counted, shown: g.shown, outside: g.outside }; })));\n")
    result = subprocess.run([node, "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr[-3000:]
    got = json.loads(result.stdout)
    for v, g in zip(replies, got):
        r = v["reply"]
        assert g["cells"] == len(v["counts"]) and g["counted"] == r["n_counted"] and g["shown"] == r["n_shown"]
        assert g["outside"] == sum(sum(a["n_outside"]) for a in r["axes"])


# --------------------------------------------------------------------------------------------- scaling

def _wide_store(path, n):
    """obs only: two float32 columns and an 8-level split, ``n`` cells."""
    root = zarr_compat.open_group(path, mode="w")
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    o = root.create_group("obs")
    o.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0", "_index": "_index",
                    "column-order": ["x", "y", "split"]})
    rng = np.random.default_rng(2)
    zarr_compat.write_array(o, "_index", np.zeros(n, dtype=np.int8), chunks=(1 << 20,))
    zarr_compat.write_array(o, "x", rng.normal(size=n).astype(np.float32), chunks=(1 << 20,))
    zarr_compat.write_array(o, "y", rng.normal(size=n).astype(np.float32), chunks=(1 << 20,))
    g = o.create_group("split")
    g.attrs.update({"encoding-type": "categorical", "encoding-version": "0.2.0", "ordered": False})
    zarr_compat.write_array(g, "codes", rng.integers(0, 8, n).astype(np.int8), chunks=(1 << 20,))
    zarr_compat.write_strings(g, "categories", [f"s{i}" for i in range(8)])
    for name in ("var", "obsm", "obsp", "layers"):
        root.create_group(name).attrs.update({"encoding-type": "dict" if name != "var" else "dataframe",
                                              "encoding-version": "0.1.0"})
    zarr_compat.consolidate(path)
    return path


GRID_512 = [{"source": {"type": "obs", "key": "x"}, "binning": {"method": "equal_width", "bins": 512, "range": [-3, 3],
                                                              "outside": "exclude"}},
            {"source": {"type": "obs", "key": "y"}, "binning": {"method": "equal_width", "bins": 512, "range": [-3, 3],
                                                              "outside": "exclude"}},
            {"source": {"type": "obs", "key": "split"}}]


def test_the_grid_time_grows_no_faster_than_the_cells(tmp_path):
    def best(n):
        path = _wide_store(str(tmp_path / f"w{n}.zarr"), n)
        reader = get_reader(path)
        reader.enable_caching = False
        p = cgr.plan(reader, path, cgr.parse_request(body("2d", GRID_512)))
        t = []
        for _ in range(3):
            t0 = time.process_time()
            res = [r for e, r in cgr.compute(p) if e == "result"][0]
            t.append(time.process_time() - t0)
        assert res.refused is None and int(res.counts.sum()) == res.n_counted
        return min(t)

    assert best(2_000_000) <= 15 * best(200_000)
