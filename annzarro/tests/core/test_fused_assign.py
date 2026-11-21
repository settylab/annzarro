"""The fused equal-width path of ``binning.assign`` gives the general path's levels and counts, to the bit.

``_assign_equal_width`` takes a chunk only when every value is finite and the binning has no zero bin and is not
degenerate; otherwise it declines and the general path of ``_assign_chunk`` runs. Each case here is assigned twice,
once as the engine does and once with the fast path switched off, and the levels and every count must agree:
NaN and the infinities, values outside a stored range under clamp and under exclude, values on and one ulp beside
every edge, the zero bin, degenerate data, float32 widened, one value, and chunks that cross the 1M-value boundary
so finite and non-finite chunks mix in one column.
"""
import dataclasses

import numpy as np
import pytest

from annzarro.core import binning


def make(**kw):
    return binning.parse({"method": "equal_width", **kw}, numeric=True, max_bins=2000)


def both(x, e):
    """``(levels, counts)`` from the engine and from the general path alone."""
    c_fast, c_slow = binning.Counts(), binning.Counts()
    fast = binning.assign(x, e, c_fast)
    keep = binning._assign_equal_width
    try:
        binning._assign_equal_width = lambda *a: None
        slow = binning.assign(x, e, c_slow)
    finally:
        binning._assign_equal_width = keep
    return (fast, c_fast), (slow, c_slow)


def check(x, e):
    (fast, cf), (slow, cs) = both(np.asarray(x), e)
    assert fast.dtype == slow.dtype == np.uint16
    assert np.array_equal(fast, slow), np.flatnonzero(fast != slow)[:5]
    assert dataclasses.asdict(cf) == dataclasses.asdict(cs)


def edges_of(x, b):
    return binning.edges(lambda: iter([np.asarray(x)]), b)


def with_edges(ed):
    return np.concatenate([ed, np.nextafter(ed, -np.inf), np.nextafter(ed, np.inf)])


@pytest.mark.parametrize("outside", ["clamp", "exclude"])
@pytest.mark.parametrize("bins", [1 + 1, 3, 7, 64, 512, 1999, 2000])
@pytest.mark.parametrize("rng", [None, (-1.0, 1.0), (-0.25, 3.0), (1e-300, 3e-300), (-1e307, 1e307)])
def test_finite_values_inside_and_outside_a_range(outside, bins, rng):
    r = np.random.default_rng(bins)
    x = r.normal(0, 1.5, 20_000)
    kw = {"bins": bins, "outside": outside}
    if rng is not None:
        kw["range"] = list(rng)
        x = np.concatenate([x, r.uniform(rng[0], rng[1], 5_000)])
    e = edges_of(x, make(**kw))
    check(np.concatenate([x, with_edges(e.edges)]), e)


@pytest.mark.parametrize("outside", ["clamp", "exclude"])
@pytest.mark.parametrize("bad", [np.nan, np.inf, -np.inf])
def test_a_chunk_without_a_value_takes_the_general_path_and_agrees(outside, bad):
    x = np.random.default_rng(1).normal(size=5_000)
    e = edges_of(x, make(bins=50, range=[-1.0, 1.0], outside=outside))
    y = x.copy()
    y[::97] = bad
    assert binning._assign_equal_width(y, e, binning.Counts()) is None
    check(y, e)


def test_chunks_that_mix_finite_and_not_across_the_chunk_boundary():
    n = binning.CHUNK * 2 + 1234
    x = np.random.default_rng(2).normal(size=n)
    x[binning.CHUNK + 17] = np.nan                       # only the second chunk has a value missing
    e = edges_of(x, make(bins=512, range=[-2.0, 2.0], outside="exclude"))
    check(x, e)


@pytest.mark.parametrize("outside", ["clamp", "exclude"])
def test_the_zero_bin_takes_the_general_path(outside):
    x = np.abs(np.random.default_rng(3).normal(size=4_000))
    x[::5] = 0.0
    e = edges_of(x, make(bins=10, zero_bin=True, range=[0.1, 2.0], outside=outside))
    assert binning._assign_equal_width(x, e, binning.Counts()) is None
    check(x, e)


def test_degenerate_data_takes_the_general_path():
    x = np.full(1000, 2.5)
    e = edges_of(x, make(bins=10))
    assert e.degenerate and binning._assign_equal_width(x, e, binning.Counts()) is None
    check(x, e)


@pytest.mark.parametrize("bins", [2, 100, 512])
def test_float32_widened_as_the_engine_does(bins):
    x = np.random.default_rng(4).normal(0, 3, 30_000).astype(np.float32)
    e = edges_of(x, make(bins=bins, range=[-4.0, 4.0], outside="exclude"))
    check(np.concatenate([x, np.linspace(-4, 4, bins + 1).astype(np.float32)]), e)


@pytest.mark.parametrize("value", [-5.0, -1.0, 0.0, 0.5, 1.0, 9.0])
def test_a_single_value(value):
    e = edges_of(np.array([-1.0, 1.0]), make(bins=4, range=[-1.0, 1.0], outside="exclude"))
    check([value], e)


def test_the_fast_path_is_taken_for_finite_equal_width_chunks():
    x = np.random.default_rng(5).normal(size=1000)
    e = edges_of(x, make(bins=8))
    assert binning._assign_equal_width(x, e, binning.Counts()) is not None
