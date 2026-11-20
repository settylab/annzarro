"""Export ``linkage.npz`` as ``linkage.json`` so the Node tests of ``utils/hclust.js`` need no Python at test time.

Needs numpy only: ``python export_linkage_json.py`` (any environment). ``build()`` is what
``tests/core/test_linkage_json.py`` compares with the committed file, so the JSON cannot go stale when the oracle
is regenerated. Layout: ``{"cases": {<case>: {"rows": n, "cols": m, "X": [[...], ...],
"dist": {<distance>: [condensed]}, "Z": {"<distance>_<method>": [[a, b, height, size], ...]},
"leaves": {"<distance>_<method>": [...]}}}}``. Floats are written as ``repr`` does, which round-trips exactly.
"""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CASES = ("means_ct", "genes_ct", "cells40", "rand40")
COMBOS = ("correlation_complete", "correlation_average", "euclidean_complete", "euclidean_average", "euclidean_ward")


def build(npz_path=None):
    z = np.load(npz_path or os.path.join(HERE, "linkage.npz"), allow_pickle=False)
    cases = {}
    for case in CASES:
        X = z[f"{case}__X"]
        cases[case] = {
            "rows": int(X.shape[0]),
            "cols": int(X.shape[1]),
            "X": X.tolist(),
            "dist": {d: z[f"{case}__dist_{d}"].tolist() for d in ("correlation", "euclidean")},
            "Z": {c: z[f"{case}__Z_{c}"].tolist() for c in COMBOS},
            "leaves": {c: z[f"{case}__leaves_{c}"].astype(int).tolist() for c in COMBOS},
        }
    return {"cases": cases}


if __name__ == "__main__":
    with open(os.path.join(HERE, "linkage.json"), "w") as fh:
        json.dump(build(), fh, separators=(",", ":"))
        fh.write("\n")
