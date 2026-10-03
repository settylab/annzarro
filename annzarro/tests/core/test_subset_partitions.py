"""A subset is one part of a partition: stepping through the parts shows
every cell once.

Part j of {n, seed, balance?, where?} holds the eligible cells of rank-key
rank [j*n, (j+1)*n); balanced, it is the balanced selection of n cells from
the cells not in parts 0..j-1. These tests compute the parts the slow,
obvious way (sort every key; select, remove, select again) and require the
server's parts to be the same cells.
"""
import json

import numpy as np
import pytest

from annzarro.core import subset as cs
from annzarro.core.subset import (MISSING_GROUP, SubsetError, _condition_mask, _is_missing,
                                  balanced_quota, parse_spec, rank_keys, select_indices, value_text)
from annzarro.tests.core.test_subset_codes import N, columns, reference  # noqa: F401  (fixture)


def naive_parts(n_obs, spec, read_column):
    """Every part, by brute force."""
    eligible = np.ones(n_obs, dtype=bool)
    for cond in spec.where:
        eligible &= _condition_mask(cond, read_column(cond.col))
    rows = np.flatnonzero(eligible)
    keys = rank_keys(n_obs, spec.seed)[rows]
    n = spec.n or len(rows)
    if spec.balance is None:
        ordered = rows[np.argsort(keys)]
        return [np.sort(ordered[i:i + n]) for i in range(0, max(len(rows), 1), n)]
    labels = read_column(spec.balance)
    text = np.array([MISSING_GROUP if _is_missing(labels[i]) else value_text(labels[i]) for i in rows], dtype=object)
    names = np.unique(text)
    per_group = {g: list(rows[text == g][np.argsort(keys[text == g])]) for g in names}
    parts = []
    while any(per_group.values()):
        sizes = [len(per_group[g]) for g in names]
        quota = balanced_quota(sizes, n)
        part = []
        for g, q in zip(names, quota):
            part += per_group[g][:q]
            per_group[g] = per_group[g][q:]
        parts.append(np.sort(np.array(part, dtype=np.int64)))
    return parts


SPECS = [
    {"n": 7000, "seed": 0},
    {"n": 9999, "seed": 4},
    {"n": 7000, "seed": 1, "balance": "kind"},
    {"n": 2500, "seed": 2, "balance": "clash"},
    {"n": 3000, "seed": 3, "where": [{"col": "kind", "op": "not_in", "values": ["mid"]}], "balance": "kind"},
    {"n": 4000, "seed": 5, "where": [{"col": "level", "op": ">", "value": 15}]},
]


@pytest.mark.parametrize("raw", SPECS, ids=[json.dumps(s)[:50] for s in SPECS])
def test_parts_are_disjoint_cover_and_match_brute_force(columns, raw):  # noqa: F811
    coded, plain = columns
    expected = naive_parts(N, parse_spec(json.dumps(raw)), plain.__getitem__)
    seen = np.zeros(N, dtype=np.int64)
    for j, want in enumerate(expected):
        spec = parse_spec(json.dumps({**raw, "part": j}))
        got, info = select_indices(N, spec, plain.__getitem__, coded.get)
        assert got.tolist() == want.tolist(), f"part {j}"
        assert info["part"] == j and info["parts"] == len(expected) and info["n"] == len(want)
        if "groups" in info:
            assert sum(c["shown"] for c in info["groups"].values()) == len(want)
        seen[got] += 1
    assert seen.max() == 1, "parts overlap"
    eligible = np.zeros(N, dtype=bool)
    eligible[np.concatenate(expected)] = True
    assert ((seen == 1) == eligible).all(), "the parts do not cover every eligible cell"
    # part 0 is the subset as it was before parts existed
    spec = parse_spec(json.dumps(raw))
    assert "part" not in spec.key()
    assert select_indices(N, spec, plain.__getitem__, coded.get)[0].tolist() == \
        reference(N, spec, plain.__getitem__)[0].tolist()
    with pytest.raises(SubsetError) as err:
        select_indices(N, parse_spec(json.dumps({**raw, "part": len(expected)})), plain.__getitem__, coded.get)
    assert err.value.reason == "part_out_of_range"


def test_balanced_parts_keep_balance_while_groups_last(columns):  # noqa: F811
    coded, plain = columns
    raw = {"n": 3000, "seed": 9, "balance": "kind"}
    first = select_indices(N, parse_spec(json.dumps(raw)), plain.__getitem__, coded.get)[1]
    shown = {g: c["shown"] for g, c in first["groups"].items()}
    small = [g for g, c in first["groups"].items() if c["shown"] == c["total"]]
    assert small, "the fixture has groups smaller than their share"
    second = select_indices(N, parse_spec(json.dumps({**raw, "part": 1})), plain.__getitem__, coded.get)[1]
    for g in small:
        assert second["groups"][g]["shown"] == 0 and second["groups"][g]["before"] == shown[g]


def test_part_spec_round_trip():
    assert parse_spec('{"n":5,"seed":1}').key() == '{"n":5,"seed":1}'
    assert parse_spec('{"n":5,"seed":1,"part":0}').key() == '{"n":5,"seed":1}'
    assert parse_spec('{"n":5,"seed":1,"part":3}').key() == '{"n":5,"seed":1,"part":3}'
    for bad in ('{"n":5,"part":-1}', '{"n":5,"part":1.5}', '{"n":5,"part":"2"}'):
        with pytest.raises(SubsetError):
            parse_spec(bad)


def test_partition_quotas_is_repeated_water_filling():
    sizes = np.array([1, 5, 50, 500])
    remaining, first = sizes.copy(), np.zeros(4, int)
    for part in range(30):
        f, q = cs.partition_quotas(sizes, 40, part)
        assert f.tolist() == first.tolist()
        assert q.tolist() == balanced_quota(remaining, 40).tolist()
        first += q
        remaining -= q
    assert remaining.sum() == 0


def _quota_loop(sizes, budget):
    """balanced_quota as it was written first (a loop), the reference."""
    sizes = np.asarray(sizes, dtype=np.int64)
    quota = np.zeros(len(sizes), dtype=np.int64)
    budget = int(min(budget, sizes.sum())) if len(sizes) else 0
    open_groups = list(np.argsort(sizes, kind="stable"))
    while open_groups:
        share = budget // len(open_groups)
        smallest = open_groups[0]
        if sizes[smallest] <= share:
            quota[smallest] = sizes[smallest]
            budget -= int(sizes[smallest])
            open_groups.pop(0)
            continue
        rest = sorted(open_groups)
        quota[rest] = share
        for g in rest[: budget - share * len(rest)]:
            quota[g] += 1
        break
    return quota


def test_vectorised_water_filling_equals_the_loop():
    rng = np.random.default_rng(3)
    for _ in range(2000):
        g = int(rng.integers(0, 12))
        sizes = rng.integers(0, 50, g) * rng.integers(0, 2, g) + rng.integers(0, 3, g)
        budget = int(rng.integers(0, 400))
        assert balanced_quota(sizes, budget).tolist() == _quota_loop(sizes, budget).tolist()
