"""core/binning.py: edges and assignment, the only implementation (SHR-14 to SHR-18, SHR-45, SHR-46, CMP-4)."""
from __future__ import annotations

import time
import zlib

import numpy as np
import pytest

from annzarro.core import binning
from annzarro.core.binning import Binning, BinningError, Counts, NO_LEVEL

# ---------------------------------------------------------------------------------------------------------------
# helpers


def slabs_of(x, size=None):
    """A callable giving a fresh pass over ``x`` in slabs of ``size`` values."""
    x = np.asarray(x)
    size = size or max(1, x.size)

    def fresh():
        for i in range(0, x.size, size):
            yield x[i:i + size]

    return fresh


def make(method, **kw):
    return binning.parse({"method": method, **kw}, numeric=True)


def column(kind, n, seed):
    """Seeded columns that exercise ties, non-finite values, zeros and huge dynamic range."""
    r = np.random.default_rng(seed)
    if kind == "normal":
        return r.normal(size=n)
    if kind == "lognormal":
        return r.lognormal(0, 3, size=n)
    if kind == "ties":
        return r.integers(0, 7, size=n).astype(np.float64)
    if kind == "zeros":
        x = r.exponential(size=n)
        x[r.random(n) < 0.6] = 0.0
        return x
    if kind == "nonfinite":
        x = r.normal(size=n)
        x[r.random(n) < 0.05] = np.nan
        x[r.random(n) < 0.01] = np.inf
        x[r.random(n) < 0.01] = -np.inf
        return x
    if kind == "narrow":
        return 1.0 + r.random(n) * 1e-9
    if kind == "outlier":
        x = 1.0 + r.random(n) * 1e-3
        x[0] = 1e9
        return x
    raise AssertionError(kind)


KINDS = ["normal", "lognormal", "ties", "zeros", "nonfinite", "narrow", "outlier"]


def finite(x, zero_bin=False):
    v = np.asarray(x, dtype=np.float64)
    v = v[np.isfinite(v)]
    return v[v != 0] if zero_bin else v


# ---------------------------------------------------------------------------------------------------------------
# the exact select: bit-identical to numpy.quantile


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("dtype", [np.float32, np.float64])
@pytest.mark.parametrize("zero_bin", [False, True])
def test_equal_count_edges_are_numpy_quantile_bit_for_bit(kind, dtype, zero_bin):
    n = 20_011
    x = column(kind, n, seed=zlib.crc32(kind.encode()) % 1000).astype(dtype)
    if zero_bin and (finite(x) < 0).any():
        with pytest.raises(BinningError):                     # the zero bin is offered only without negatives
            binning.edges(slabs_of(x), make("equal_count", bins=4, zero_bin=True))
        x = np.abs(x)
    v = finite(x, zero_bin)
    for k in list(range(2, 41)) + [100, 999, 1000]:
        # a slab size that does not divide n, so the chunk boundary moves with k
        e = binning.edges(slabs_of(x, 977 + k), make("equal_count", bins=k, zero_bin=zero_bin))
        want = np.quantile(v.astype(np.float64), np.arange(k + 1) / k)
        merged = want[np.concatenate(([True], want[1:] != want[:-1]))]
        if merged.size < 2:
            assert e.degenerate
            continue
        assert not e.degenerate
        assert e.edges.dtype == np.float64
        assert np.array_equal(e.edges, merged), (kind, dtype, zero_bin, k)
        assert e.n_bins == merged.size - 1 and e.bins_asked == k


def test_equal_count_slab_layout_does_not_matter():
    x = column("lognormal", 5003, 1)
    ref = binning.edges(slabs_of(x), make("equal_count", bins=9)).edges
    for size in (1, 2, 7, 64, 1024, 5003, 99999):
        assert np.array_equal(binning.edges(slabs_of(x, size), make("equal_count", bins=9)).edges, ref)


def test_select_paths_with_tiny_buckets_and_caps(monkeypatch):
    # few buckets and a tiny collect cap force the split of a crowded bucket and the batching of small ones
    monkeypatch.setattr(binning, "SELECT_BUCKETS", 64)
    monkeypatch.setattr(binning, "SELECT_COLLECT_CAP", 500)
    for kind in ("outlier", "narrow", "normal", "ties", "zeros"):
        x = column(kind, 6000, 3)
        v = finite(x)
        for k in (2, 4, 10, 50):
            e = binning.edges(slabs_of(x, 700), make("equal_count", bins=k))
            want = np.quantile(v, np.arange(k + 1) / k)
            want = want[np.concatenate(([True], want[1:] != want[:-1]))]
            assert np.array_equal(e.edges, want), (kind, k)


def test_select_with_a_huge_run_of_one_value(monkeypatch):
    monkeypatch.setattr(binning, "SELECT_COLLECT_CAP", 100)
    depths = []
    real = binning._select
    monkeypatch.setattr(binning, "_select", lambda *a: depths.append(a[-1]) or real(*a))
    x = np.concatenate((np.full(5000, 3.5), np.linspace(0, 10, 500)))
    np.random.default_rng(0).shuffle(x)
    e = binning.edges(slabs_of(x, 333), make("equal_count", bins=5))
    want = np.quantile(x, np.arange(6) / 5)
    assert np.array_equal(e.edges, want[np.concatenate(([True], want[1:] != want[:-1]))])
    assert max(depths) >= 1                                   # the crowded bucket was split again


def test_equal_edges_are_merged_and_bins_made_is_reported():
    x = np.concatenate((np.zeros(900), np.arange(1, 101)))
    e = binning.edges(slabs_of(x), make("equal_count", bins=4))
    assert e.bins_asked == 4 and e.n_bins < 4
    assert np.all(np.diff(e.edges) > 0)
    assert binning.level_ids(e) == [f"bin:{i}" for i in range(e.n_bins)]
    assert e.to_reply()["bins_made"] == e.n_bins


# ---------------------------------------------------------------------------------------------------------------
# equal width, log, manual, categories


@pytest.mark.parametrize("kind", ["normal", "ties", "nonfinite", "zeros"])
@pytest.mark.parametrize("zero_bin", [False, True])
def test_equal_width_matches_histogram_bin_edges(kind, zero_bin):
    x = column(kind, 4000, 5)
    if zero_bin:
        x = np.abs(x)
    v = finite(x, zero_bin)
    for k in (2, 3, 10, 57, 1000):
        e = binning.edges(slabs_of(x, 311), make("equal_width", bins=k, zero_bin=zero_bin))
        assert np.array_equal(e.edges, np.histogram_bin_edges(v, bins=k)), (kind, k)


def test_equal_width_with_a_stored_range():
    x = column("normal", 3000, 2)
    e = binning.edges(slabs_of(x), make("equal_width", bins=8, range=[-1.0, 1.0]))
    assert np.array_equal(e.edges, np.histogram_bin_edges([0.0], bins=8, range=(-1.0, 1.0)))
    assert e.range_stored


def test_log_spaced_edges():
    x = np.concatenate(([0.0, -5.0, np.nan], np.geomspace(0.01, 100, 500)))
    e = binning.edges(slabs_of(x), make("log", bins=4))
    assert e.edges[0] == 0.01 and e.edges[-1] == 100.0
    assert np.allclose(e.edges, [0.01, 0.1, 1, 10, 100])
    codes = binning.assign(x, e)
    assert codes[0] == NO_LEVEL and codes[1] == NO_LEVEL and codes[2] == NO_LEVEL      # 0, negative, NaN
    c = Counts()
    binning.assign(x, e, c)
    assert c.n_no_value == 3
    # with the zero bin, exact zeros get @zero; the negative stays without a value but the zero bin is then refused
    z = np.concatenate(([0.0, 0.0], np.geomspace(0.01, 100, 50)))
    ez = binning.edges(slabs_of(z), make("log", bins=4, zero_bin=True))
    assert binning.level_ids(ez)[0] == "@zero"
    assert binning.assign(z, ez)[0] == 0
    assert ez.edges[0] == 0.01


def test_manual_thresholds_are_sorted_deduplicated_and_open_ended():
    b = binning.parse({"method": "manual", "thresholds": [5, 1, 5, 3]}, numeric=True)
    assert b.thresholds == (1.0, 3.0, 5.0)
    calls = []

    def slabs():
        calls.append(1)
        return iter([np.zeros(3)])

    e = binning.edges(slabs, b)
    assert calls == [] and e.n_bins == 4
    codes = binning.assign(np.array([-9, 0.999, 1, 2.9, 3, 4.999, 5, 1e9, np.nan]), e)
    assert codes.tolist() == [0, 0, 1, 1, 2, 2, 3, 3, NO_LEVEL]
    assert binning.level_bounds(e) == [(None, 1.0), (1.0, 3.0), (3.0, 5.0), (5.0, None)]


def test_categories_method_splits_an_integer_column_by_value():
    x = np.array([3, 1, 3, 7, 1, 1, np.nan, 7.0, -0.0, 0.0])
    e = binning.edges(slabs_of(x), binning.parse({"method": "categories"}, numeric=True))
    assert e.edges.tolist() == [0.0, 1.0, 3.0, 7.0] and e.n_bins == 4
    assert binning.level_ids(e) == ["bin:0", "bin:1", "bin:2", "bin:3"]
    assert binning.assign(x, e).tolist() == [2, 1, 2, 3, 1, 1, NO_LEVEL, 3, 0, 0]
    c = Counts()
    binning.assign(np.array([2.0, 3.0]), e, c)             # 2 is not a category of these edges
    assert c.n_unmatched == 1


def test_categories_refuses_more_levels_than_a_uint16_code_holds(monkeypatch):
    monkeypatch.setattr(binning, "MAX_CATEGORY_LEVELS", 50)
    with pytest.raises(BinningError) as err:
        binning.edges(slabs_of(np.arange(200.0), 30), binning.parse({"method": "categories"}, numeric=True))
    assert err.value.reason == "too_many_levels"


# ---------------------------------------------------------------------------------------------------------------
# assignment: [lo, hi), the zero bin, clamp and exclude


def test_bins_are_closed_below_open_above_and_the_last_is_closed():
    x = np.arange(0.0, 11.0)
    e = binning.edges(slabs_of(x), make("equal_width", bins=5))      # 0 2 4 6 8 10
    codes = binning.assign(x, e)
    assert codes.dtype == np.uint16
    assert codes.tolist() == [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4]       # 10 is in the last bin


def test_assign_matches_numpy_digitize_over_a_sweep():
    r = np.random.default_rng(11)
    for k in (2, 5, 33, 200):
        x = np.round(r.normal(size=3000), 1)                           # many values exactly on an edge
        e = binning.edges(slabs_of(x), make("equal_width", bins=k))
        want = np.minimum(np.digitize(x, e.edges, right=False) - 1, k - 1)
        assert np.array_equal(binning.assign(x, e), want.astype(np.uint16))


def test_zero_bin_shifts_bins_and_takes_only_exact_zeros():
    x = np.array([0.0, -0.0, 0.5, 1.5, 3.0, np.nan, 0.0])
    e = binning.edges(slabs_of(x), make("equal_width", bins=2, zero_bin=True))     # edges 0.5 1.75 3
    assert binning.level_ids(e) == ["@zero", "bin:0", "bin:1"]
    assert e.edges.tolist() == [0.5, 1.75, 3.0]
    c = Counts()
    assert binning.assign(x, e, c).tolist() == [0, 0, 1, 1, 2, NO_LEVEL, 0]
    assert c.n_zero == 3 and c.n_no_value == 1
    assert e.n_zero == 3


def test_zero_bin_is_refused_when_the_source_has_a_negative_value():
    with pytest.raises(BinningError) as err:
        binning.edges(slabs_of(np.array([-1.0, 0.0, 1.0])), make("equal_count", bins=2, zero_bin=True))
    assert err.value.reason == "zero_bin_negative"


def test_clamp_and_exclude_outside_a_stored_range_with_counts():
    x = np.array([-5.0, 0.0, 0.5, 1.0, 9.0, np.nan])
    for outside, want in (("clamp", [0, 0, 1, 1, 1, NO_LEVEL]), ("exclude", [NO_LEVEL, 0, 1, 1, NO_LEVEL, NO_LEVEL])):
        e = binning.edges(slabs_of(x), make("equal_width", bins=2, range=[0.0, 1.0], outside=outside))
        c = Counts()
        assert binning.assign(x, e, c).tolist() == want
        assert c.n_outside == [1, 1] and c.n_no_value == 1
        assert e.range_stored


def test_assign_works_across_chunk_and_slab_boundaries(monkeypatch):
    monkeypatch.setattr(binning, "CHUNK", 64)
    x = column("nonfinite", 1000, 8)
    e = binning.edges(slabs_of(x, 100), make("equal_count", bins=6))
    whole = binning.assign(x, e)
    monkeypatch.setattr(binning, "CHUNK", 1 << 20)
    assert np.array_equal(whole, binning.assign(x, e))
    # float32 input is widened, not compared in float32
    x32 = x.astype(np.float32)
    e32 = binning.edges(slabs_of(x32, 100), make("equal_count", bins=6))
    assert np.array_equal(binning.assign(x32, e32), binning.assign(x32.astype(np.float64), e32))


def test_every_finite_value_gets_a_level_when_clamping():
    for kind in KINDS:
        x = column(kind, 5000, 4)
        e = binning.edges(slabs_of(x, 500), make("equal_count", bins=7))
        codes = binning.assign(x, e)
        assert np.array_equal(codes == NO_LEVEL, ~np.isfinite(x))
        used = codes[codes != NO_LEVEL]
        assert used.max() < e.n_levels


# ---------------------------------------------------------------------------------------------------------------
# degenerate data


@pytest.mark.parametrize("method", ["equal_width", "equal_count", "log"])
def test_degenerate_data_is_one_level(method):
    x = np.array([1.2, 1.2, 1.2, np.nan])
    e = binning.edges(slabs_of(x), make(method, bins=4))
    assert e.degenerate and e.degenerate_value == 1.2 and e.n_bins == 1
    assert binning.level_ids(e) == ["bin:0"]
    assert binning.assign(x, e).tolist() == [0, 0, 0, NO_LEVEL]
    assert e.to_reply()["degenerate"] is True and e.to_reply()["value"] == 1.2


def test_degenerate_with_zero_bin_and_with_nothing_to_bin():
    e = binning.edges(slabs_of(np.array([0.0, 0.0, 2.0, 2.0])), make("equal_count", bins=3, zero_bin=True))
    assert e.degenerate and binning.level_ids(e) == ["@zero", "bin:0"]
    assert binning.assign(np.array([0.0, 2.0]), e).tolist() == [0, 1]
    e0 = binning.edges(slabs_of(np.array([np.nan, np.nan])), make("equal_width", bins=3))
    assert e0.degenerate and e0.degenerate_value is None and binning.level_ids(e0) == ["bin:0"]
    assert binning.assign(np.array([np.nan, 1.0]), e0).tolist() == [NO_LEVEL, 0]
    # equal edges after merging are degenerate data too
    ed = binning.edges(slabs_of(np.full(50, 4.0)), make("equal_count", bins=4))
    assert ed.degenerate


# ---------------------------------------------------------------------------------------------------------------
# slabs that can be read only once, or that change


def test_a_one_shot_generator_is_refused_with_a_clear_error():
    gen = (x for x in [np.arange(10.0)])
    with pytest.raises(BinningError) as err:
        binning.edges(gen, make("equal_count", bins=4))
    assert err.value.reason == "slabs_not_replayable" and "fresh pass" in err.value.message
    # a callable that hands back the same generator every time is one-shot too
    gen2 = (x for x in [np.arange(10.0)])
    with pytest.raises(BinningError) as err:
        binning.edges(lambda: gen2, make("equal_count", bins=4))
    assert err.value.reason == "slabs_not_replayable"
    with pytest.raises(BinningError):
        binning.preview(gen)
    with pytest.raises(BinningError):
        binning.edges(iter([np.arange(5.0)]), make("equal_width", bins=2))


def test_slabs_that_change_between_passes_are_refused():
    state = {"n": 0}

    def shrinking():
        state["n"] += 1
        yield np.arange(1000.0 if state["n"] == 1 else 900.0)

    with pytest.raises(BinningError) as err:
        binning.edges(shrinking, make("equal_count", bins=4))
    assert err.value.reason == "slabs_changed"


def test_equal_count_makes_three_passes_and_the_other_methods_one():
    for method, passes in (("equal_count", 3), ("equal_width", 1), ("log", 1)):
        calls = []

        def slabs():
            calls.append(1)
            yield np.linspace(1, 100, 1000)

        binning.edges(slabs, make(method, bins=4))
        assert len(calls) == passes, method


# ---------------------------------------------------------------------------------------------------------------
# preview


def test_preview_histogram_and_the_zero_bin_default():
    x = np.concatenate((np.zeros(300), np.linspace(0.01, 10, 700), [np.nan]))
    p = binning.preview(slabs_of(x, 200), bins=100)
    assert p["n"] == 1000 and p["n_no_value"] == 1 and p["n_zero"] == 300
    assert p["zero_share"] == pytest.approx(0.3) and p["zero_bin_default"] is True
    assert sum(p["counts"]) == 1000 and len(p["counts"]) == 100
    want, _ = np.histogram(x[np.isfinite(x)], bins=100)
    assert p["counts"] == want.tolist() and p["lo"] == 0.0 and p["hi"] == 10.0
    neg = binning.preview(slabs_of(np.array([-1.0, 0.0, 0.0, 0.0])))
    assert neg["has_negative"] and not neg["zero_bin_default"]
    assert not binning.preview(slabs_of(np.linspace(0, 1, 100)))["zero_bin_default"]
    d = binning.preview(slabs_of(np.full(5, 2.0)))
    assert d["degenerate"] and d["counts"] == [5]


def test_the_zero_bin_defaults_on_at_exactly_25_percent_zeros():
    x = np.concatenate((np.zeros(25), np.arange(1.0, 76.0)))
    assert binning.preview(slabs_of(x))["zero_bin_default"] is True
    x = np.concatenate((np.zeros(24), np.arange(1.0, 77.0)))
    assert binning.preview(slabs_of(x))["zero_bin_default"] is False


# ---------------------------------------------------------------------------------------------------------------
# the recipe


def test_parse_defaults_and_canonical_form():
    assert binning.parse(None, numeric=True).to_dict() == {"method": "equal_count", "bins": 4, "outside": "clamp", "edges_from": "shown"}
    assert binning.parse({"method": "equal_width"}, numeric=True).bins == 10
    assert binning.parse({"method": "log"}, numeric=True).bins == 10
    assert binning.parse(None, numeric=False).method == "categories"
    b = binning.parse({"method": "manual", "thresholds": [2, 1], "bins": 9, "range": [0, 1], "edges_from": "all"}, numeric=True)
    assert b.to_dict() == {"method": "manual", "thresholds": [1.0, 2.0]}          # fields of other methods are dropped
    b = binning.parse({"method": "equal_width", "bins": 5, "zero_bin": True, "range": [0, 4], "outside": "exclude",
                       "edges_from": "all"}, numeric=True)
    assert b.to_dict() == {"method": "equal_width", "bins": 5, "zero_bin": True, "range": [0.0, 4.0],
                           "outside": "exclude", "edges_from": "all"}


@pytest.mark.parametrize("raw,reason", [
    ({"method": "nope"}, "bad_method"),
    ({"method": "equal_count", "bins": 1}, "bad_bins"),
    ({"method": "equal_count", "bins": 1001}, "bad_bins"),
    ({"method": "equal_count", "bins": 2.5}, "bad_bins"),
    ({"method": "equal_count", "bins": True}, "bad_bins"),
    ({"method": "equal_count", "bins": "4"}, "bad_bins"),
    ({"method": "manual"}, "bad_thresholds"),
    ({"method": "manual", "thresholds": []}, "bad_thresholds"),
    ({"method": "manual", "thresholds": [1, float("nan")]}, "bad_number"),
    ({"method": "manual", "thresholds": [1, float("inf")]}, "bad_number"),
    ({"method": "equal_width", "range": [1, 1]}, "bad_range"),
    ({"method": "equal_width", "range": [2, 1]}, "bad_range"),
    ({"method": "equal_width", "range": [1]}, "bad_range"),
    ({"method": "log", "range": [0, 5]}, "bad_range"),
    ({"method": "equal_width", "outside": "wrap"}, "bad_outside"),
    ({"method": "equal_width", "edges_from": "some"}, "bad_edges_from"),
    ({"method": "equal_width", "zero_bin": "yes"}, "bad_zero_bin"),
    ({"method": "equal_width", "colour": 1}, "unknown_field"),
])
def test_parse_refuses_bad_recipes(raw, reason):
    with pytest.raises(BinningError) as err:
        binning.parse(raw, numeric=True)
    assert err.value.reason == reason


def test_parse_refuses_binning_a_categorical_source_and_a_non_object():
    with pytest.raises(BinningError) as err:
        binning.parse({"method": "equal_width"}, numeric=False)
    assert err.value.reason == "not_numeric"
    with pytest.raises(BinningError):
        binning.parse([1, 2], numeric=True)
    assert binning.parse({"method": "categories", "zero_bin": True}, numeric=True).zero_bin is False


def test_thresholds_limit_keeps_bins_within_1000():
    with pytest.raises(BinningError):
        binning.parse({"method": "manual", "thresholds": list(range(1000))}, numeric=True)
    assert binning.parse({"method": "manual", "thresholds": list(range(999))}, numeric=True)


# ---------------------------------------------------------------------------------------------------------------
# the one intended difference from pandas.cut


def test_pandas_cut_puts_an_edge_value_in_the_lower_bin_and_we_put_it_in_the_upper():
    pd = pytest.importorskip("pandas")
    x = np.array([0.0, 1.0, 2.0, 3.0, 4.0])
    e = binning.edges(slabs_of(x), make("equal_width", bins=2))        # edges 0 2 4
    ours = binning.assign(x, e)
    theirs = pd.cut(x, e.edges, labels=False, include_lowest=True)     # (a, b], first bin closed on the left
    assert ours.tolist() == [0, 0, 1, 1, 1]
    assert theirs.tolist() == [0, 0, 0, 1, 1]                          # 2.0 sits in the lower bin there
    interior = x[(x == e.edges[1])]
    assert (ours[x == 2.0] != np.asarray(theirs)[x == 2.0]).all() and interior.size == 1
    # away from an edge the two agree
    y = np.array([0.5, 1.5, 2.5, 3.5])
    assert binning.assign(y, e).tolist() == pd.cut(y, e.edges, labels=False).tolist()


# ---------------------------------------------------------------------------------------------------------------
# the report fields


def test_to_reply_and_level_bounds():
    x = np.concatenate((np.zeros(10), np.arange(1.0, 21.0)))
    e = binning.edges(slabs_of(x), make("equal_width", bins=4, zero_bin=True, edges_from="all"))
    r = e.to_reply()
    assert r["edges_from"] == "all" and r["edges_n"] == 30 and r["bins_asked"] == 4 and r["bins_made"] == 4
    assert r["edges"] == [1.0, 5.75, 10.5, 15.25, 20.0] and r["outside"] == "clamp"
    assert binning.level_bounds(e)[0] == (0.0, 0.0) and len(binning.level_bounds(e)) == 5


# ---------------------------------------------------------------------------------------------------------------
# scaling


def test_edges_time_grows_no_faster_than_the_data():
    def best(n):
        x = np.random.default_rng(0).normal(size=n).astype(np.float32)
        t = []
        for _ in range(3):
            t0 = time.process_time()
            binning.edges(slabs_of(x, 1 << 20), make("equal_count", bins=4))
            t.append(time.process_time() - t0)
        return min(t)

    assert best(5_000_000) <= 15 * best(500_000)
