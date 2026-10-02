"""
The cell subset: which cells a (seed, n, filter, balance) spec names.

The selection is a contract, not an implementation detail: a share link or a
figure that says "100,000 cells, seed 0" must name the same cells on every
machine, numpy version and AnnZarro release. ``test_selection_is_frozen``
pins it; if that test fails, existing links and panel sets now show other
cells than when they were made.
"""
import json

import numpy as np
import pytest

from annzarro.core import subset as cs
from annzarro.core.subset import SubsetError, SubsetSpec, parse_spec, select_indices


def _no_columns(name):
    raise AssertionError(f"read column {name} unexpectedly")


def _select(n_obs, spec, columns=None):
    columns = columns or {}
    return select_indices(n_obs, spec, lambda name: columns[name])


# -- uniform selection --------------------------------------------------------

def test_same_seed_same_cells_and_different_seed_different_cells():
    a, _ = _select(10_000, SubsetSpec(n=1000, seed=0))
    b, _ = _select(10_000, SubsetSpec(n=1000, seed=0))
    c, _ = _select(10_000, SubsetSpec(n=1000, seed=1))
    assert np.array_equal(a, b)
    assert not np.array_equal(a, c)
    # different seeds overlap about as two random draws do (10 %), not more
    assert len(np.intersect1d(a, c)) < 200


@pytest.mark.parametrize("n_obs,n", [(10, 3), (1000, 999), (1000, 1000), (5, 50), (1, 1)])
def test_sorted_in_range_unique_and_sized(n_obs, n):
    idx, info = _select(n_obs, SubsetSpec(n=n, seed=7))
    assert len(idx) == min(n, n_obs) == info["n"]
    assert np.all(np.diff(idx) > 0)
    assert idx.min() >= 0 and idx.max() < n_obs
    assert info["n_total"] == n_obs and info["n_eligible"] == n_obs


def test_larger_n_keeps_every_cell_of_a_smaller_one():
    """Going from 50k to 100k cells adds cells; it never swaps the ones shown."""
    small, _ = _select(100_000, SubsetSpec(n=5_000, seed=3))
    large, _ = _select(100_000, SubsetSpec(n=20_000, seed=3))
    assert np.isin(small, large).all()


def test_selection_is_roughly_uniform():
    idx, _ = _select(100_000, SubsetSpec(n=10_000, seed=0))
    counts = np.bincount(idx // 10_000, minlength=10)
    assert counts.min() > 850 and counts.max() < 1150


def test_selection_is_frozen():
    """Pinned: these exact cells are what seed 0 and seed 42 mean. Changing
    them silently changes every saved link and panel set."""
    idx, _ = _select(1000, SubsetSpec(n=8, seed=0))
    assert idx.tolist() == FROZEN_SEED0
    idx, _ = _select(1000, SubsetSpec(n=8, seed=42))
    assert idx.tolist() == FROZEN_SEED42


FROZEN_SEED0 = [233, 250, 286, 453, 509, 728, 781, 844]
FROZEN_SEED42 = [53, 652, 660, 686, 742, 821, 837, 843]


def _splitmix64_reference(x):
    """splitmix64's output function on a Python int, as published."""
    mask = (1 << 64) - 1
    z = (x + 0x9E3779B97F4A7C15) & mask
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & mask
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & mask
    return z ^ (z >> 31)


def test_rank_keys_are_splitmix64_of_seed_and_row():
    """The rule written out with Python integers, independent of numpy, so it
    can be reimplemented elsewhere (a notebook, another client)."""
    for seed in (0, 1, 42, 2**32 - 1):
        salt = _splitmix64_reference(seed)
        expected = [_splitmix64_reference(row ^ salt) for row in range(50)]
        assert cs.rank_keys(50, seed).tolist() == expected


def test_rank_keys_are_distinct():
    keys = cs.rank_keys(200_000, 5)
    assert len(np.unique(keys)) == len(keys)


# -- filter ------------------------------------------------------------------

def test_where_in_keeps_only_matching_cells_and_samples_among_them():
    labels = ["a", "b", "c", None] * 250
    spec = parse_spec({"n": 100, "seed": 0, "where": [{"col": "t", "op": "in", "values": ["a", "c"]}]})
    idx, info = _select(1000, spec, {"t": labels})
    assert info["n_eligible"] == 500 and len(idx) == 100
    assert {labels[i] for i in idx} <= {"a", "c"}


def test_where_without_n_keeps_every_passing_cell():
    values = list(range(100))
    spec = parse_spec({"n": None, "where": [{"col": "x", "op": "between", "value": [10, 19]}]})
    idx, _ = _select(100, spec, {"x": values})
    assert idx.tolist() == list(range(10, 20))


def test_missing_values_pass_no_condition():
    values = [1.0, float("nan"), None, 3.0]
    for cond in ({"op": "!=", "value": 2}, {"op": ">", "value": 0},
                 {"op": "not_in", "values": ["7"]}, {"op": "in", "values": ["1", "nan", "None"]}):
        spec = parse_spec({"n": None, "where": [dict(cond, col="x")]})
        idx, _ = _select(4, spec, {"x": values})
        assert 1 not in idx and 2 not in idx, cond


def test_numeric_ops():
    x = list(range(10))
    cases = {">": [6, 7, 8, 9], ">=": [5, 6, 7, 8, 9], "<": [0, 1, 2, 3, 4],
             "<=": [0, 1, 2, 3, 4, 5], "==": [5], "!=": [0, 1, 2, 3, 4, 6, 7, 8, 9]}
    for op, expected in cases.items():
        spec = parse_spec({"n": None, "where": [{"col": "x", "op": op, "value": 5}]})
        assert _select(10, spec, {"x": x})[0].tolist() == expected, op


def test_text_match_of_numbers_and_booleans():
    spec = parse_spec({"n": None, "where": [{"col": "b", "op": "in", "values": [True]}]})
    assert _select(3, spec, {"b": [True, False, True]})[0].tolist() == [0, 2]
    spec = parse_spec({"n": None, "where": [{"col": "k", "op": "in", "values": [3]}]})
    assert _select(3, spec, {"k": [3, 3.0, "3"]})[0].tolist() == [0, 1, 2]


def test_conditions_are_anded():
    spec = parse_spec({"n": None, "where": [
        {"col": "t", "op": "in", "values": ["a"]}, {"col": "x", "op": ">=", "value": 2}]})
    idx, _ = _select(4, spec, {"t": ["a", "a", "a", "b"], "x": [1, 2, 3, 4]})
    assert idx.tolist() == [1, 2]


def test_filter_then_sample_is_the_smallest_keys_among_eligible():
    """The filtered subset is the same rule applied to the passing cells, so
    a filter and its sample are both reproducible."""
    keep = np.arange(10_000) % 3 == 0
    spec = parse_spec({"n": 500, "seed": 9, "where": [{"col": "k", "op": "in", "values": ["true"]}]})
    idx, _ = _select(10_000, spec, {"k": keep.tolist()})
    keys = cs.rank_keys(10_000, 9)
    eligible = np.flatnonzero(keep)
    expected = np.sort(eligible[np.argsort(keys[eligible])[:500]])
    assert np.array_equal(idx, expected)


# -- balanced ----------------------------------------------------------------

def test_balanced_quota_water_fills():
    assert cs.balanced_quota([500, 50, 10], 90).tolist() == [40, 40, 10]
    assert cs.balanced_quota([500, 50, 10], 30).tolist() == [10, 10, 10]
    assert cs.balanced_quota([500, 50, 10], 1000).tolist() == [500, 50, 10]
    assert cs.balanced_quota([5, 5, 5], 10).tolist() == [4, 3, 3]
    assert cs.balanced_quota([], 10).tolist() == []


def test_balanced_subset_equalises_groups_and_keeps_small_ones_whole():
    labels = ["A"] * 50_000 + ["B"] * 5_000 + ["C"] * 500 + [None] * 100
    spec = parse_spec({"n": 3_000, "seed": 0, "balance": "g"})
    idx, info = _select(len(labels), spec, {"g": labels})
    shown = {k: v["shown"] for k, v in info["groups"].items()}
    assert len(idx) == 3_000
    assert shown == {"A": 1200, "B": 1200, "C": 500, cs.MISSING_GROUP: 100}
    assert sum(1 for i in idx if labels[i] == "C") == 500


def test_balanced_selection_within_a_group_is_its_smallest_keys():
    labels = ["A"] * 1000 + ["B"] * 1000
    spec = parse_spec({"n": 100, "seed": 4, "balance": "g"})
    idx, _ = _select(2000, spec, {"g": labels})
    keys = cs.rank_keys(2000, 4)
    expected_a = np.sort(np.argsort(keys[:1000])[:50])
    assert np.array_equal(idx[idx < 1000], expected_a)


# -- parsing -----------------------------------------------------------------

def test_canonical_key_ignores_input_order_and_value_order():
    a = parse_spec('{"seed": 1, "n": 10, "where": [{"op": "in", "col": "t", "values": ["b", "a", "b"]}]}')
    b = parse_spec({"n": 10.0, "seed": 1, "where": [{"col": "t", "op": "in", "values": ["a", "b"]}]})
    assert a == b and a.key() == b.key()
    assert json.loads(a.key()) == {"n": 10, "seed": 1,
                                   "where": [{"col": "t", "op": "in", "values": ["a", "b"]}]}


@pytest.mark.parametrize("raw", [None, "", "all", "null"])
def test_all_cells(raw):
    assert parse_spec(raw) is None


@pytest.mark.parametrize("raw", [
    "{", "[1]", '{"n": 0}', '{"n": -1}', '{"n": 1.5}', '{"n": true}', '{"n": 10, "seed": -1}',
    '{"n": 10, "seed": 4294967296}', '{"n": 10, "bogus": 1}', '{"n": 10, "where": {}}',
    '{"n": 10, "where": [{"col": "x", "op": "~", "value": 1}]}',
    '{"n": 10, "where": [{"col": "x", "op": ">", "value": "a"}]}',
    '{"n": 10, "where": [{"col": "x", "op": "in", "values": []}]}',
    '{"n": 10, "where": [{"col": "x", "op": "between", "value": [1]}]}',
    '{"n": null, "balance": "g"}', '{"n": 10, "balance": ""}', "auto",
])
def test_bad_specs_are_refused(raw):
    with pytest.raises(SubsetError):
        parse_spec(raw)


def test_resolve_keeps_small_datasets_whole():
    class Reader:
        def get_metadata(self, path):
            return {"shape": (1000, 5), "obs_columns": []}
    assert cs.resolve(Reader(), "/x", "auto", {"ui_subset_threshold": 2000}) is None
    assert cs.resolve(Reader(), "/x", '{"n": 1000, "seed": 3}') is None
    assert cs.resolve(Reader(), "/x", '{"n": 5000}') is None
    assert cs.auto_spec(5000, {"ui_subset_threshold": 2000, "ui_subset_size": 100,
                               "ui_subset_seed": 6}) == SubsetSpec(n=100, seed=6)


def test_threshold_zero_subsets_every_dataset():
    assert cs.defaults({"ui_subset_threshold": 0})["threshold"] == 0
    assert cs.auto_spec(10, {"ui_subset_threshold": 0, "ui_subset_size": 5}) == SubsetSpec(n=5, seed=0)
    assert cs.defaults(None) == {"threshold": cs.DEFAULT_THRESHOLD, "size": cs.DEFAULT_SIZE,
                                 "seed": cs.DEFAULT_SEED}
