"""Filtered and balanced subsets are computed on categorical codes, and pick
exactly the cells they picked before.

``where`` and ``balance`` subsets asked every cell's value in Python
(np.fromiter over values; a list of group labels built row by row): 1.2 s at
1M cells for a balanced subset, about two minutes extrapolated to Tahoe-100M,
with a 95.6M-element list in memory. A categorical column is now read as its
codes and each question is asked once per category. The reference below is
the previous algorithm, kept verbatim, and every spec must select the same
rows and report the same groups.
"""
import json

import numpy as np
import pytest

from annzarro.core import subset as cs
from annzarro.core.subset import (MISSING_GROUP, _condition_mask, _is_missing, _smallest,
                                  balanced_quota, parse_spec, rank_keys, select_indices, value_text)


def reference(n_obs, spec, read_column):
    """select_indices before the codes rewrite (per-cell Python)."""
    eligible = np.ones(n_obs, dtype=bool)
    for cond in spec.where:
        eligible &= _condition_mask(cond, read_column(cond.col))
    rows = np.flatnonzero(eligible)
    n_eligible = int(len(rows))
    want = n_eligible if spec.n is None else min(spec.n, n_eligible)
    info = {"n_total": int(n_obs), "n_eligible": n_eligible}
    if want >= n_eligible:
        chosen = rows
    else:
        keys = rank_keys(n_obs, spec.seed)[rows]
        if spec.balance is None:
            chosen = rows[_smallest(keys, want)]
        else:
            labels = read_column(spec.balance)
            text = [MISSING_GROUP if _is_missing(labels[i]) else value_text(labels[i]) for i in rows]
            names, codes = np.unique(np.asarray(text, dtype=object), return_inverse=True)
            codes = codes.reshape(-1)
            sizes = np.bincount(codes, minlength=len(names))
            quota = balanced_quota(sizes, want)
            order = np.lexsort((keys, codes))
            starts = np.concatenate([[0], np.cumsum(sizes)[:-1]])
            pos = np.arange(len(order)) - starts[codes[order]]
            chosen = rows[order[pos < quota[codes[order]]]]
            info["groups"] = {str(name): {"total": int(s), "shown": int(q)}
                              for name, s, q in zip(names, sizes, quota)}
    indices = np.sort(chosen)
    info["n"] = int(len(indices))
    return indices, info


N = 30_011


@pytest.fixture(scope="module")
def columns():
    rng = np.random.default_rng(2)
    # skewed groups: one huge, several tiny, one empty category, missing codes
    p = np.array([0.80, 0.12, 0.05, 0.02, 0.005, 0.004, 0.001, 0.0])
    cats = ["big", "mid", "small", "é漢", "a,b", "#7", "rare", "never"]
    codes = rng.choice(len(cats), size=N, p=p).astype(np.int8)
    codes[rng.random(N) < 0.03] = -1
    num_cats = [10, 20.5, 30, 1]                       # numeric categories
    num_codes = rng.integers(-1, 4, N).astype(np.int8)
    clash_cats = [1, "1", "x"]                         # two categories, one group text
    clash_codes = rng.integers(0, 3, N).astype(np.int16)
    score = rng.random(N)
    score[rng.random(N) < 0.01] = np.nan
    coded = {"kind": (codes, cats), "level": (num_codes, num_cats), "clash": (clash_codes, clash_cats)}

    def values(c, k):
        return [None if x < 0 else k[x] for x in c.tolist()]
    plain = {name: values(c, k) for name, (c, k) in coded.items()}
    plain["score"] = score.tolist()
    plain["label"] = [None if np.isnan(x) else f"L{int(x * 7)}" for x in score.tolist()]  # not categorical
    return coded, plain


SPECS = [
    {"n": 100, "seed": 0, "balance": "kind"},
    {"n": 5000, "seed": 3, "balance": "kind"},
    {"n": 25000, "seed": 1, "balance": "kind"},
    {"n": 300, "seed": 9, "balance": "clash"},
    {"n": 400, "seed": 4, "balance": "level"},
    {"n": 200, "seed": 5, "balance": "label"},
    {"n": 1000, "seed": 2, "where": [{"col": "kind", "op": "in", "values": ["small", "rare", "é漢"]}]},
    {"n": 1000, "seed": 2, "where": [{"col": "kind", "op": "not_in", "values": ["big"]}]},
    {"n": None, "seed": 0, "where": [{"col": "level", "op": ">=", "value": 20}]},
    {"n": 700, "seed": 6, "where": [{"col": "level", "op": "between", "value": [5, 25]},
                                    {"col": "score", "op": "<", "value": 0.7}]},
    {"n": 800, "seed": 8, "where": [{"col": "level", "op": "!=", "value": 30}], "balance": "kind"},
    {"n": 600, "seed": 1, "where": [{"col": "clash", "op": "in", "values": ["1"]}], "balance": "clash"},
    {"n": 50, "seed": 7, "where": [{"col": "kind", "op": "in", "values": ["never"]}]},
    {"n": 123, "seed": 11},
]


@pytest.mark.parametrize("raw", SPECS, ids=[json.dumps(s, ensure_ascii=False)[:60] for s in SPECS])
@pytest.mark.parametrize("block", [cs._KEY_BLOCK, 997])
def test_same_cells_as_the_per_cell_algorithm(columns, raw, block, monkeypatch):
    coded, plain = columns
    monkeypatch.setattr(cs, "_KEY_BLOCK", block)
    spec = parse_spec(json.dumps(raw))
    want_idx, want_info = reference(N, spec, plain.__getitem__)
    for read_codes in (lambda name: coded.get(name), None):
        got_idx, got_info = select_indices(N, spec, plain.__getitem__, read_codes)
        assert got_idx.tolist() == want_idx.tolist()
        assert got_info == want_info


def test_codes_are_used_not_values(columns):
    coded, plain = columns
    spec = parse_spec(json.dumps({"n": 100, "seed": 0, "balance": "kind",
                                  "where": [{"col": "kind", "op": "not_in", "values": ["mid"]}]}))

    def no_values(name):
        raise AssertionError(f"read every value of {name}")
    select_indices(N, spec, no_values, lambda name: coded.get(name))


def test_per_group_thresholds_that_miss_are_raised_until_exact():
    rng = np.random.default_rng(1)
    n = 20_000
    groups = rng.integers(0, 5, n)
    quota = np.array([10, 0, 300, 2, 4000])
    eligible = rng.random(n) < 0.9
    keys = rank_keys(n, 3)
    expected = []
    for g in range(5):
        rows = np.flatnonzero(eligible & (groups == g))
        expected += rows[np.argsort(keys[rows])[:quota[g]]].tolist()
    # sizes 1000x too large: every first threshold is far too low
    got = cs._rows_with_smallest_keys_per_group(n, eligible, lambda part, sl: groups[part], 3,
                                                np.full(5, 1e7), quota, block=777)
    assert sorted(got.tolist()) == sorted(expected)
