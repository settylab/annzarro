"""The recipe vectors that tie ``static/js/utils/binning.js`` to ``core/binning.py`` (G6).

One file, ``tests/data/binning_recipe_vectors.json``, written here from the engine itself and read by
``tests/js/binning-model.test.mjs``. It holds three things:

* ``recipes``: a raw binning and what ``parse`` makes of it, as ``Binning.to_dict()`` (the canonical, defaults-filled
  form), or the ``reason`` it is refused. The browser's ``effectiveBinning(normalizeBinning(raw))`` must equal the
  ``effective`` form, and must report a problem exactly for the refused ones.
* ``edges``: a binning the browser can lay out without data (manual thresholds, a stored range) with the engine's own
  ``edges``, ``bins_made``, ``level_ids`` and ``level_bounds``.
* ``data_edges``: a binning with the values it was run on and the engine's reply (``to_reply`` and ``level_ids``), so a
  label test starts from a reply the engine really wrote.

Regenerate with ``python -m annzarro.tests.core.binning_vectors``.
"""
import json
import os

import numpy as np

from annzarro.core import binning as B

PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "binning_recipe_vectors.json")

RECIPES = [
    {"method": "equal_count"},
    {"method": "equal_count", "bins": 7},
    {"method": "equal_count", "bins": 4, "zero_bin": True},
    {"method": "equal_count", "edges_from": "all"},
    {"method": "equal_width"},
    {"method": "equal_width", "bins": 3, "range": [0, 6]},
    {"method": "equal_width", "bins": 3, "range": [0, 6], "outside": "exclude"},
    {"method": "equal_width", "bins": 1000, "zero_bin": True, "edges_from": "all"},
    {"method": "log"},
    {"method": "log", "bins": 5, "range": [0.5, 500]},
    {"method": "manual", "thresholds": [2, 0.5, 1.75, 2]},
    {"method": "manual", "thresholds": [1], "zero_bin": True},
    {"method": "manual", "thresholds": [1], "bins": 9, "range": [0, 5], "edges_from": "all"},
    {"method": "categories"},
    {"method": "categories", "zero_bin": True, "outside": "exclude"},
    {"method": "equal_count", "range": [0, 1]},
    {"method": "bogus"},
    {"method": "equal_count", "bins": 1},
    {"method": "equal_count", "bins": 1001},
    {"method": "equal_count", "bins": 2.5},
    {"method": "equal_count", "bins": "4"},
    {"method": "equal_width", "range": [3, 3]},
    {"method": "equal_width", "range": [4, 3]},
    {"method": "log", "range": [0, 10]},
    {"method": "log", "range": [-1, 10]},
    {"method": "manual"},
    {"method": "manual", "thresholds": []},
    {"method": "manual", "thresholds": [1, "x"]},
    {"method": "equal_count", "outside": "drop"},
    {"method": "equal_count", "edges_from": "everything"},
    {"method": "equal_count", "zero_bin": "yes"},
    {"method": "equal_count", "mystery": 1},
]

EDGES = [
    {"method": "manual", "thresholds": [0.5, 1.75]},
    {"method": "manual", "thresholds": [3]},
    {"method": "manual", "thresholds": [0.5, 1.75], "zero_bin": True},
    {"method": "equal_width", "bins": 3, "range": [0, 6]},
    {"method": "equal_width", "bins": 4, "range": [-2.5, 2.5]},
    {"method": "equal_width", "bins": 7, "range": [0.1, 0.9], "zero_bin": True},
    {"method": "equal_width", "bins": 10, "range": [0, 1], "outside": "exclude"},
    {"method": "log", "bins": 3, "range": [1, 1000]},
    {"method": "log", "bins": 4, "range": [0.5, 500]},
    {"method": "log", "bins": 6, "range": [1e-3, 1e3], "zero_bin": True},
]

#: (binning, values): run through the real engine; the values are small so the vector file stays small
DATA = [
    ({"method": "equal_count", "bins": 4}, [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.2, 1.6, 2.0]),
    ({"method": "equal_count", "bins": 4, "zero_bin": True}, [0] * 10 + [0.5, 0.9, 1.1, 1.6, 2.2, 3.1, 4.4, 5.0]),
    ({"method": "equal_width", "bins": 4}, [0.0, 0.25, 0.5, 0.75, 1.0, 0.3, 0.6]),
    ({"method": "equal_width", "bins": 4, "zero_bin": True}, [0, 0, 0, 0, 1, 2, 3, 4, 5]),
    ({"method": "equal_width", "bins": 3, "range": [0, 6], "outside": "clamp"}, [-1, 0, 1, 2, 3, 4, 5, 6, 9]),
    ({"method": "equal_width", "bins": 3, "range": [0, 6], "outside": "exclude"}, [-1, 0, 1, 2, 3, 4, 5, 6, 9]),
    ({"method": "log", "bins": 3}, [1, 3, 10, 30, 100, 300, 1000]),
    ({"method": "equal_count", "bins": 4}, [1.2, 1.2, 1.2]),
    ({"method": "equal_count", "bins": 4, "zero_bin": True}, [0, 0, 2.5, 2.5]),
    ({"method": "equal_count", "bins": 4}, [float("nan"), float("inf")]),
    ({"method": "equal_count", "bins": 8}, [1, 1, 1, 1, 1, 1, 2, 3]),
    ({"method": "categories"}, [3, 1, 2, 3, 12, 7]),
]


def _flat(x):
    """JSON-safe: floats are floats, nan and inf are refused (the engine's replies never hold them)."""
    return json.loads(json.dumps(x, allow_nan=False))


def _recipe(raw):
    try:
        return {"raw": raw, "ok": True, "effective": _flat(B.parse(raw, numeric=True).to_dict())}
    except B.BinningError as e:
        return {"raw": raw, "ok": False, "reason": e.reason}


def _edges(raw):
    b = B.parse(raw, numeric=True)
    e = B.edges(lambda: [np.asarray([0.0])], b)        # these recipes read no data
    return {"binning": raw, "reply": _flat(e.to_reply()), "ids": B.level_ids(e),
            "bounds": _flat([list(t) for t in B.level_bounds(e)])}


def _data(raw, values):
    b = B.parse(raw, numeric=True)
    vals = np.asarray(values, dtype=np.float64)
    e = B.edges(lambda: [vals], b)
    return {"binning": raw, "values": _flat([None if not np.isfinite(v) else float(v) for v in vals]),
            "reply": _flat(e.to_reply()), "ids": B.level_ids(e), "codes": _flat([int(c) for c in B.assign(vals, e)]),
            "bounds": _flat([list(t) for t in B.level_bounds(e)])}


def build():
    return {
        "comment": "Written by annzarro/tests/core/binning_vectors.py from core/binning.py; read by tests/js/binning-model.test.mjs. "
                   "Do not edit by hand.",
        "recipes": [_recipe(r) for r in RECIPES],
        "edges": [_edges(r) for r in EDGES],
        "data": [_data(r, v) for r, v in DATA],
    }


if __name__ == "__main__":
    with open(PATH, "w", encoding="utf-8") as fh:
        json.dump(build(), fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print("wrote", PATH)
