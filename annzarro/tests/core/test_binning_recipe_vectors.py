"""The binning recipe vectors (tests/data/binning_recipe_vectors.json) are what core/binning.py writes today.

The browser's tests read the file (tests/js/binning-model.test.mjs). If the engine changes, this fails until the file
is regenerated with ``python -m annzarro.tests.core.binning_vectors`` and the browser's model has been brought along.
"""
import json

from annzarro.tests.core import binning_vectors as V


def test_the_vector_file_is_not_stale():
    with open(V.PATH, encoding="utf-8") as fh:
        on_disk = json.load(fh)
    assert on_disk == json.loads(json.dumps(V.build())), (
        "tests/data/binning_recipe_vectors.json is out of date: run python -m annzarro.tests.core.binning_vectors")


def test_the_vectors_cover_every_method_and_both_outcomes():
    doc = V.build()
    ok = [r for r in doc["recipes"] if r["ok"]]
    assert {r["effective"]["method"] for r in ok} == set(V.B.METHODS)
    assert {r["reason"] for r in doc["recipes"] if not r["ok"]} >= {
        "bad_method", "bad_bins", "bad_range", "bad_thresholds", "bad_number", "bad_outside", "bad_edges_from", "bad_zero_bin"}
    assert any(d["reply"]["degenerate"] for d in doc["data"])
    assert any(d["ids"][0] == "@zero" for d in doc["data"])
