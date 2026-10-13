"""A subset filter on a numeric column reads it as the array it is stored as.

It used to read every numeric column as a Python list (get_obs_var: 32 bytes a cell,
3 GB at 95.6M cells) and make a float64 array of that: a numeric filter of the Tahoe
store held 5 GB (53 B a cell, measured). The array is compared as it is; the same
cells must come out, in the same order, whichever way the column arrives.
"""
import numpy as np
import pytest

from annzarro.core import subset as cs
from annzarro.core.subset import SubsetSpec, parse_spec, select_indices

N = 5000
RNG = np.random.default_rng(11)
COLUMNS = {
    "f32": np.where(RNG.random(N) < 0.1, np.nan, RNG.normal(100, 30, N)).astype("float32"),
    "f64": RNG.normal(0, 1, N),
    "i64": RNG.integers(0, 50, N).astype("int64"),
    "u8": RNG.integers(0, 4, N).astype("uint8"),
    "ints_over_f32": (16_777_216 + RNG.integers(0, 5, N)).astype("int64"),   # f32 would merge these
    "inf": np.where(RNG.random(N) < 0.05, np.inf, RNG.random(N)),
}


def _spec(*where, **kw):
    return parse_spec({"n": 700, "seed": 5, "where": list(where), **kw})


def _both(spec):
    as_array = select_indices(N, spec, lambda name: COLUMNS[name])
    as_list = select_indices(N, spec, lambda name: COLUMNS[name].tolist())
    return as_array, as_list


FILTERS = [
    {"col": "f32", "op": ">", "value": 100}, {"col": "f32", "op": ">=", "value": 100.5},
    {"col": "f32", "op": "<", "value": 90}, {"col": "f32", "op": "<=", "value": 70.25},
    {"col": "f32", "op": "==", "value": float(COLUMNS["f32"][np.flatnonzero(~np.isnan(COLUMNS["f32"]))[0]])}, {"col": "f32", "op": "!=", "value": 100},
    {"col": "f32", "op": "between", "value": [80, 120]}, {"col": "f64", "op": ">", "value": 0.3},
    {"col": "f64", "op": "between", "value": [-0.5, 0.5]}, {"col": "i64", "op": "==", "value": 7},
    {"col": "i64", "op": "!=", "value": 7}, {"col": "i64", "op": "<", "value": 10},
    {"col": "u8", "op": ">=", "value": 2}, {"col": "ints_over_f32", "op": "==", "value": 16_777_217},
    {"col": "ints_over_f32", "op": ">", "value": 16_777_216}, {"col": "inf", "op": "<", "value": 0.5},
    {"col": "inf", "op": ">", "value": 1e9},
]


@pytest.mark.parametrize("cond", FILTERS, ids=lambda c: f"{c['col']}{c['op']}{c['value']}")
def test_a_filter_names_the_same_cells_from_an_array_as_from_a_list(cond):
    (a_idx, a_info), (l_idx, l_info) = _both(_spec(cond))
    assert np.array_equal(a_idx, l_idx)
    assert a_info == l_info


def test_nan_cells_pass_no_numeric_condition():
    (idx, info), _ = _both(_spec({"col": "f32", "op": "!=", "value": 0}))
    nan_rows = set(np.flatnonzero(np.isnan(COLUMNS["f32"])).tolist())
    assert not nan_rows & set(idx.tolist()) and info["n_eligible"] == N - len(nan_rows)


def test_integers_beyond_float32_are_kept_apart():
    (idx, info), _ = _both(_spec({"col": "ints_over_f32", "op": "==", "value": 16_777_217}))
    assert info["n_eligible"] == int((COLUMNS["ints_over_f32"] == 16_777_217).sum()) > 0


def test_filters_combined_and_text_and_balance_on_a_numeric_column_are_unchanged():
    both = _spec({"col": "f32", "op": ">", "value": 90}, {"col": "i64", "op": "<", "value": 30})
    text = _spec({"col": "i64", "op": "in", "values": [3, 4, 5]})
    startswith = _spec({"col": "i64", "op": "starts_with", "value": "1"})
    balanced = parse_spec({"n": 400, "seed": 2, "balance": "u8"})
    for spec in (both, text, startswith, balanced):
        (a_idx, a_info), (l_idx, l_info) = _both(spec)
        assert np.array_equal(a_idx, l_idx) and a_info == l_info


def test_a_numeric_filter_never_builds_the_python_list():
    column = cs._Values(COLUMNS["f64"])
    cond = cs.Condition("f64", ">", (0.3,))
    assert column.mask(cond).sum() > 0 and column._list is None
    assert len(column) == N and column._list is None
    column.mask(cs.Condition("f64", "in", ("0",)))          # a text condition does
    assert column._list is not None


class _Reader:
    """A reader whose numeric route is counted; ``numeric`` None means it answers None."""

    def __init__(self, numeric=True):
        self.numeric_calls, self.list_calls, self.numeric = [], [], numeric

    def get_obs_var_numeric(self, entity, dataset_path, column_name):
        self.numeric_calls.append(column_name)
        return COLUMNS[column_name] if self.numeric else None

    def get_obs_var(self, entity, dataset_path, column_names, include_categories):
        self.list_calls.append(column_names[0])
        return {"data": {column_names[0]: COLUMNS[column_names[0]].tolist()}}


def test_the_reader_is_asked_for_the_array_first_and_the_list_only_when_it_has_none():
    reader = _Reader()
    read_column, _ = cs._readers(reader, "d")
    assert isinstance(read_column("f64"), np.ndarray)
    assert reader.numeric_calls == ["f64"] and reader.list_calls == []
    reader = _Reader(numeric=False)                     # a string, categorical or nullable column
    read_column, _ = cs._readers(reader, "d")
    assert isinstance(read_column("f64"), list)
    assert reader.numeric_calls == ["f64"] and reader.list_calls == ["f64"]
