"""Text conditions in a subset's ``where``: the cell table's SearchBuilder
string conditions (contains, starts with, ends with, their negations, empty,
not empty), case-insensitive as SearchBuilder compares (it lower-cases both
sides), on categorical columns (asked once per category) and plain string
columns (tested a block at a time), joined by AND/OR in nested groups.

The oracle is the SearchBuilder rule written out per cell: a missing value is
empty text, "does not contain" keeps it.
"""
import numpy as np
import pytest

from annzarro.core import subset as cs
from annzarro.core.subset import SubsetError, parse_spec, select_indices

WORDS = ["Cisplatin", "carboplatin", "DOXORUBICIN", "Paclitaxel", "taxol-X", "", "PLATINUM", "é-Ünï", None]
N = 5_003
rng = np.random.default_rng(7)
IDX = rng.integers(0, len(WORDS), N)
TEXT = [WORDS[i] for i in IDX]                                   # plain column, None = missing
SCORE = rng.random(N)


def _cat_reader():
    cats = [w for w in WORDS if w is not None]
    codes = np.array([-1 if t is None else cats.index(t) for t in TEXT], dtype=np.int16)
    return {"cat": (codes, cats)}


def _select(where, kind, n=None):
    """Rows chosen by ``where`` on the column read as "str" (plain) or "cat"."""
    spec = parse_spec({"n": n, "seed": 0, "where": where})
    coded = _cat_reader() if kind == "cat" else {}
    plain = {"drug": TEXT, "cat": TEXT, "score": SCORE.tolist(), "other": TEXT}
    codes = lambda name: coded.get(name)                         # noqa: E731
    rows, info = select_indices(N, spec, lambda name: plain[name], codes)
    return rows


def _expect(pred):
    return np.array([i for i, t in enumerate(TEXT) if pred("" if t is None else t.lower())])


ORACLE = {
    "contains": lambda t, s: s in t, "not_contains": lambda t, s: s not in t,
    "starts_with": lambda t, s: t.startswith(s), "not_starts_with": lambda t, s: not t.startswith(s),
    "ends_with": lambda t, s: t.endswith(s), "not_ends_with": lambda t, s: not t.endswith(s),
}


@pytest.mark.parametrize("kind", ["str", "cat"])
@pytest.mark.parametrize("op", sorted(ORACLE))
@pytest.mark.parametrize("needle", ["PLAT", "taxol", "ÜN", "x", "zzz"])
def test_string_ops_ignore_case(kind, op, needle):
    col = "cat" if kind == "cat" else "drug"
    got = _select([{"col": col, "op": op, "value": needle}], kind)
    want = _expect(lambda t: ORACLE[op](t, needle.lower()))
    assert np.array_equal(got, want), (op, needle)
    if op == "contains" and needle != "zzz":
        assert len(want) > 0           # the data holds each of these words


@pytest.mark.parametrize("kind", ["str", "cat"])
def test_empty_and_not_empty(kind):
    col = "cat" if kind == "cat" else "drug"
    empty = _select([{"col": col, "op": "empty"}], kind)
    full = _select([{"col": col, "op": "not_empty"}], kind)
    assert np.array_equal(empty, _expect(lambda t: t == ""))
    assert len(empty) and len(empty) + len(full) == N
    assert not set(empty) & set(full)


@pytest.mark.parametrize("kind", ["str", "cat"])
def test_nested_and_or(kind):
    col = "cat" if kind == "cat" else "drug"
    where = [
        {"any": [{"col": col, "op": "contains", "value": "platin"},
                 {"all": [{"col": col, "op": "starts_with", "value": "TAX"},
                          {"col": "score", "op": ">", "value": 0.5}]}]},
        {"col": col, "op": "not_ends_with", "value": "m"},
    ]
    got = _select(where, kind)
    want = np.array([i for i, t in enumerate(TEXT)
                     if (("platin" in (t or "").lower())
                         or ((t or "").lower().startswith("tax") and SCORE[i] > 0.5))
                     and not (t or "").lower().endswith("m")])
    assert np.array_equal(got, want) and len(want)


def test_categorical_and_plain_agree_and_codes_path_is_per_category(monkeypatch):
    where = [{"any": [{"col": "cat", "op": "contains", "value": "I"},
                      {"col": "cat", "op": "empty"}]}]
    assert np.array_equal(_select(where, "cat"), _select(where, "str"))

    # on a categorical column the text of a cell is never asked: only the categories
    seen = []
    real = cs._text_test

    def spy(cond):
        test = real(cond)
        return lambda t: (seen.append(t), test(t))[1]

    monkeypatch.setattr(cs, "_text_test", spy)
    _select([{"col": "cat", "op": "contains", "value": "plat"}], "cat")
    assert len(seen) == len(WORDS)       # categories (8) plus the missing slot


def test_plain_column_is_tested_in_blocks(monkeypatch):
    monkeypatch.setattr(cs, "_KEY_BLOCK", 97)
    got = _select([{"col": "drug", "op": "contains", "value": "plat"}], "str")
    assert np.array_equal(got, _expect(lambda t: "plat" in t))


def test_groups_and_values_are_validated():
    ok = {"n": None, "where": [{"any": [{"col": "a", "op": "contains", "value": "x"},
                                        {"all": [{"col": "b", "op": "empty"}]}]}]}
    spec = parse_spec(ok)
    assert spec.canonical()["where"] == ok["where"]
    assert spec.columns() == ["a", "b"]
    deep = {"all": [{"all": [{"all": [{"col": "a", "op": "empty"}]}]}]}
    with pytest.raises(SubsetError, match="nest at most 2"):
        parse_spec({"n": None, "where": [deep]})
    for bad in ({"col": "a", "op": "contains"}, {"col": "a", "op": "contains", "value": ""},
                {"col": "a", "op": "starts_with", "value": 3}, {"any": []}, {"any": 3},
                {"any": [{"col": "a", "op": "empty"}], "all": []}):
        with pytest.raises(SubsetError):
            parse_spec({"n": None, "where": [bad]})
    many = {"any": [{"col": "a", "op": "empty"}] * 10}
    with pytest.raises(SubsetError, match="more than"):
        parse_spec({"n": None, "where": [many, many]})
