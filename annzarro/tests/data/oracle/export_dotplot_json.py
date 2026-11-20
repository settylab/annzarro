"""Writes ``dotplot_matrixplot.json`` beside ``dotplot_matrixplot.npz``: the oracle as Node tests can read it (X2a).

Needs numpy and pandas only (the repo venv is fine; scanpy is NOT involved, the scanpy values are read from the .npz).
Run from anywhere:  python export_dotplot_json.py        (``--check`` compares instead of writing, exit 1 if stale)

For every layer and groupby of the oracle the file holds the grouping's sizes and, per detection threshold (the
oracle's ``expression_cutoff``), the moments ``[n, sum, sumsq, n_above, sum_above]`` of each of the 12 genes in each
group, in float64, exactly as the server's group features write them (``grouping_store.moments``). Beside them it holds
scanpy's own answers (colour, size, matrix), so a test derives the statistic from the moments and compares.

JSON writes a float with the shortest digits that round-trip, so a number read back is the number written. The
tests/core/test_oracle_dotplot_json.py test regenerates the content from the .npz and the fixture and requires it equal
to this file.
"""
import importlib.util
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
NPZ = os.path.join(HERE, "dotplot_matrixplot.npz")
OUT = os.path.join(HERE, "dotplot_matrixplot.json")
LAYERS = ["X", "logged", "counts"]
GROUPBYS = ["cell_type", "condition", "score_bin", "tiny"]
CUTOFFS = [0.0, 0.5]
SCALES = ["none", "var", "group"]


def _common():
    spec = importlib.util.spec_from_file_location("oracle_common", os.path.join(HERE, "_common.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _moments(values, above):
    v = np.asarray(values, dtype=np.float64)
    v = v[np.isfinite(v)]
    hi = v[v > above]
    return [int(len(v)), float(v.sum()), float((v * v).sum()), int(len(hi)), float(hi.sum())]


def _codes(groupby, data, npz):
    """Per-cell group index in the order of ``groups__<groupby>``."""
    n = len(data.obs)
    if groupby == "score_bin":
        return npz["score_bin_codes"].astype(np.int64)
    if groupby == "tiny":
        return np.where(np.arange(n) < 2, 0, np.where(np.arange(n) < 5, 1, 2))
    return data.obs[groupby].cat.codes.to_numpy(np.int64)


def build():
    npz = np.load(NPZ, allow_pickle=False)
    data, _sets, names = _common().load_fixture()
    genes = [str(g) for g in npz["genes"]]
    cols = [names.index(g) for g in genes]
    out = {"genes": genes, "layers": LAYERS, "groupbys": GROUPBYS, "cutoffs": CUTOFFS, "scales": SCALES,
           "fixture_digest": str(npz["fixture_digest"]), "groupby": {}, "dot": {}, "matrix": {}}
    for g in GROUPBYS:
        out["groupby"][g] = {"groups": [str(x) for x in npz[f"groups__{g}"]],
                             "n_cells": [int(x) for x in npz[f"n_cells__{g}"]]}
    layer_values = {"X": data.x, "logged": data.logged, "counts": data.counts}
    for layer in LAYERS:
        full = layer_values[layer].astype(np.float64)
        for g in GROUPBYS:
            codes = _codes(g, data, npz)
            n_groups = len(out["groupby"][g]["groups"])
            assert [int((codes == i).sum()) for i in range(n_groups)] == out["groupby"][g]["n_cells"]
            for cut in CUTOFFS:
                key = f"{layer}__{g}__cut{cut}"
                out.setdefault("moments", {})[key] = [
                    [_moments(full[codes == i, c], cut) for i in range(n_groups)] for c in cols]
            for ss in SCALES:
                out["matrix"][f"{layer}__{g}__ss{ss}"] = npz[f"matrix__{layer}__{g}__ss{ss}"].tolist()
                for cut in CUTOFFS:
                    for mo in (0, 1):
                        k = f"dot__{layer}__{g}__cut{cut}__mo{mo}__ss{ss}"
                        out["dot"][f"{layer}__{g}__cut{cut}__mo{mo}__ss{ss}"] = {
                            "color": npz[k + "__color"].tolist(), "size": npz[k + "__size"].tolist()}
    return out


def render(content):
    return json.dumps(content, separators=(",", ":"), sort_keys=True) + "\n"


if __name__ == "__main__":
    text = render(build())
    if "--check" in sys.argv:
        with open(OUT, encoding="utf-8") as f:
            sys.exit(0 if f.read() == text else 1)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print(OUT, len(text), "bytes")
