"""Equal-width bins by arithmetic (core/binning._equal_width_index) are the search's bins, to the bit.

The search, ``numpy.searchsorted(ed[1:-1], v, side="right")``, is the definition; the arithmetic index with its
correction is the fast path ``assign`` takes for ``equal_width``. Both are run on the same finite float64 values
(float32 data are widened first, as the engine does) over edges made as the engine makes them (``numpy.linspace``).
The search is replaced by a function that fails, and the corrections are capped at one, so every case also shows
that a single correction step always suffices and the fallback is never taken.
"""
import numpy as np
import pytest

from annzarro.core import binning


@pytest.fixture(autouse=True)
def one_correction_and_no_search(monkeypatch):
    def refuse(v, ed):
        raise AssertionError(f"the arithmetic index needed the search for {v.size} values")
    monkeypatch.setattr(binning, "_CORRECTIONS", 1)
    monkeypatch.setattr(binning, "_search_index", refuse)


def search(v, ed):
    return np.searchsorted(ed[1:-1], v, side="right")


def on_and_beside_every_edge(ed):
    return np.concatenate([ed, np.nextafter(ed, -np.inf), np.nextafter(ed, np.inf)])


def check(v, lo, hi, k):
    ed = np.linspace(lo, hi, k + 1, endpoint=True)
    v = np.asarray(v, dtype=np.float64)
    got = binning._equal_width_index(v, ed)
    want = search(v, ed)
    assert np.array_equal(got, want), (lo, hi, k, v[got != want][:5])


def test_every_bin_count_from_1_to_2000_over_seeded_values_and_every_edge():
    rng = np.random.default_rng(2000)
    for k in range(1, 2001):
        lo = float(rng.normal(0, 10))
        hi = lo + float(rng.uniform(1e-3, 100))
        ed = np.linspace(lo, hi, k + 1)
        width = hi - lo
        inside = rng.uniform(lo, hi, 64)
        beyond = rng.uniform(lo - width, hi + width, 16)
        check(np.concatenate([inside, beyond, on_and_beside_every_edge(ed)]), lo, hi, k)


@pytest.mark.parametrize("lo,hi", [
    (-1e307, 1e307), (1e-300, 3e-300), (1.0, 1.0 + 1e-12), (-50.0, -3.0), (-7.25, -7.0),
    (0.0, 1.0), (-1.0, 1.0), (3.0, 7.5), (1e15, 1e15 + 4096), (-2.0 ** 52, 2.0 ** 52),
])
@pytest.mark.parametrize("k", [1, 2, 3, 7, 10, 50, 100, 255, 256, 511, 512, 1000, 1999, 2000])
def test_huge_tiny_and_negative_ranges(lo, hi, k):
    rng = np.random.default_rng(k)
    ed = np.linspace(lo, hi, k + 1)
    check(np.concatenate([rng.uniform(lo, hi, 500), on_and_beside_every_edge(ed)]), lo, hi, k)


@pytest.mark.parametrize("k", [2, 10, 100, 512, 2000])
def test_float32_data_widened_as_the_engine_does(k):
    rng = np.random.default_rng(32)
    x = rng.normal(0, 3, 20_000).astype(np.float32)
    lo, hi = float(x.min()), float(x.max())
    ed32 = np.linspace(lo, hi, k + 1).astype(np.float32)          # float32 values that sit on the edges
    check(np.concatenate([x, ed32]).astype(np.float64), lo, hi, k)


@pytest.mark.parametrize("k", [1, 2, 512, 2000])
@pytest.mark.parametrize("value", [-5.0, 0.0, 0.3, 1.0, 9.0])
def test_a_single_value(k, value):
    check([value], 0.0, 1.0, k)


def test_assign_takes_the_fast_path_for_equal_width_and_agrees_with_histogram():
    rng = np.random.default_rng(5)
    x = rng.normal(size=100_000)
    b = binning.parse({"method": "equal_width", "bins": 512, "range": [-3, 3], "outside": "exclude"}, numeric=True)
    e = binning.edges(lambda: iter([x]), b)
    lv = binning.assign(x, e)
    want, _ = np.histogram(x, bins=e.edges)
    assert np.array_equal(np.bincount(lv[lv != binning.NO_LEVEL], minlength=512), want)


def test_a_wider_bin_limit_is_the_callers():
    assert binning.parse({"method": "equal_width", "bins": 2000}, numeric=True, max_bins=2000).bins == 2000
    with pytest.raises(binning.BinningError) as e:
        binning.parse({"method": "equal_width", "bins": 1001}, numeric=True)
    assert e.value.reason == "bad_bins" and e.value.extra["maximum"] == binning.BINS_MAX
    with pytest.raises(binning.BinningError) as e:
        binning.parse({"method": "equal_width", "bins": 513}, numeric=True, max_bins=512)
    assert e.value.extra["maximum"] == 512
    t = list(range(1999))
    assert len(binning.parse({"method": "manual", "thresholds": t}, numeric=True, max_bins=2000).thresholds) == 1999
