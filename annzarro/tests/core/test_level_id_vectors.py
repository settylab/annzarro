"""The canonical text of a category (plan 1.6, S3), pinned by tests/data/level_id_vectors.json.

The same file is run by ``tests/js/level-id-vectors.test.mjs`` against ``canonLabel``. Three layers:

* the vector file itself is checked against an independent implementation here (``ref_label``) and the group-key
  JSON against ``json.dumps``, so a wrong vector cannot pin a wrong rule;
* ``canonical_label`` in ``annzarro/core/cell_groups.py`` is checked against every vector. Until E3 creates that
  module the test is skipped; once the module exists and lacks the function, it FAILS.
"""
import importlib.util
import json
import os

import numpy as np
import pytest

from annzarro.tests.core.grouping_store import ecma_number_text, ref_label

VECTORS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "level_id_vectors.json")
with open(VECTORS, encoding="utf-8") as fh:
    DOC = json.load(fh)
CATEGORIES = DOC["categories"]


def decode(v):
    kind, value = v["kind"], v["value"]
    if kind == "int":
        return int(value)
    if kind == "float32":
        return np.float32(value)
    if kind == "float":
        return float(value) if isinstance(value, str) else value
    return value


def ids(vectors):
    return [v["name"] for v in vectors]


def test_the_table_of_1_6_is_all_there():
    assert len(CATEGORIES) == 25
    assert len({v["name"] for v in CATEGORIES}) == len(CATEGORIES)
    assert {v["id"] for v in CATEGORIES} >= {"c:true", "c:false", "c:3", "c:-12", "c:0", "c:0.1", "c:1e+21", "c:0.000001",
                                              "c:1e-7", "c:5e-324", "c:Infinity", "c:-Infinity", "@na", "c:", "c:other"}


@pytest.mark.parametrize("vector", CATEGORIES, ids=ids(CATEGORIES))
def test_vector_matches_the_independent_reference(vector):
    assert ref_label(decode(vector)) == vector["id"]


def test_two_unicode_forms_of_e_acute_stay_two_ids():
    by_name = {v["name"]: v for v in CATEGORIES}
    a, b = by_name["e acute U+00E9"], by_name["e + combining acute U+0065 U+0301"]
    assert (len(a["value"]), len(b["value"])) == (1, 2)
    assert a["id"] != b["id"]


@pytest.mark.parametrize("value,text", [(1e21, "1e+21"), (1e-7, "1e-7"), (123456789.125, "123456789.125"), (-2.5e-10, "-2.5e-10"),
                                        (1.5e300, "1.5e+300"), (100.0, "100"), (0.000123, "0.000123"), (12345678901234567890.0, "12345678901234567000")])
def test_ecma_number_text_matches_javascript(value, text):
    assert ecma_number_text(value) == text


@pytest.mark.parametrize("vector", DOC["group_keys"], ids=ids(DOC["group_keys"]))
def test_group_key_json(vector):
    assert json.dumps(vector["key"], separators=(",", ":"), ensure_ascii=False) == vector["json"]
    assert json.loads(vector["json"]) == vector["key"]


def _canonical_label():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "core", "cell_groups.py")
    if not os.path.isfile(path):
        pytest.skip("core/cell_groups.py does not exist yet (E3 adds canonical_label)")
    spec = importlib.util.find_spec("annzarro.core.cell_groups")
    assert spec is not None
    module = importlib.import_module("annzarro.core.cell_groups")
    assert hasattr(module, "canonical_label"), "core/cell_groups.py exists but has no canonical_label (plan 1.6, S3)"
    return module.canonical_label


@pytest.mark.parametrize("vector", CATEGORIES, ids=ids(CATEGORIES))
def test_canonical_label_matches_the_vectors(vector):
    assert _canonical_label()(decode(vector)) == vector["id"]
