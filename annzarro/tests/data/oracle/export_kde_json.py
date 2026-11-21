"""Writes ``kde.json`` beside ``kde.npz``: the density oracle as Node tests can read it (V3).

Needs numpy and pandas only (the repo venv is fine; scanpy is NOT involved, the KDE values are read from the .npz).
Run from anywhere:  python export_kde_json.py        (``--check`` compares instead of writing, exit 1 if stale)

For each oracle case (1D ``score``, ``signed``, ``depth``, ``pseudotime``; 2D ``umap``, ``corr``, ``score_depth``; adjust
0.5, 1, 2) the file holds what the engine's grid reply holds (the cells binned into ``bins`` equal-width cells over the
oracle's range, ``lo + i * step``, a value on ``hi`` in the last cell; ``n``, ``sigma``; the range) and the oracle's
answer: the density by direct summation over the cells, with the bandwidth floored at 1.5 grid steps
(``density_floor``; it equals the unfloored density where the floor does not apply). A test smooths the counts and
compares. Counts are integers; the densities are rounded to 9 significant digits (the tolerance is 2% of the peak).
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import _common  # noqa: E402

NPZ = os.path.join(HERE, "kde.npz")
OUT = os.path.join(HERE, "kde.json")
ONE = ("score", "signed", "depth", "pseudotime")
TWO = ("umap", "corr", "score_depth")
ADJUST = (0.5, 1.0, 2.0)


def _columns(data):
    o = data.obs
    cols = {k: [o[k].to_numpy(np.float64)] for k in ONE}
    cols["umap"] = [data.obsm["X_umap"][:, 0], data.obsm["X_umap"][:, 1]]
    cols["corr"] = [data.logged[:, 0], data.logged[:, 6]]
    cols["score_depth"] = [o["score"].to_numpy(np.float64), o["depth"].to_numpy(np.float64)]
    return cols


def _round(a):
    return [float(f"{x:.9g}") for x in np.asarray(a, dtype=np.float64).ravel()]


def _counts(cols, lo, hi, step, bins):
    V = np.column_stack(cols).astype(np.float64)
    V = V[np.all(np.isfinite(V), axis=1)]
    inside = np.all((V >= lo) & (V <= hi), axis=1)
    W = V[inside]
    idx = np.minimum(np.floor((W - lo) / step).astype(np.int64), bins - 1)
    if W.shape[1] == 1:
        return np.bincount(idx[:, 0], minlength=bins)
    return np.bincount(idx[:, 0] * bins + idx[:, 1], minlength=bins * bins)


def build():
    data, _, _ = _common.load_fixture()
    cols = _columns(data)
    npz = np.load(NPZ)
    out = {"fixture_digest": str(npz["fixture_digest"]), "cases": {}}
    for name in ONE + TWO:
        for a in ADJUST:
            tag = f"a{a:g}"
            k = f"{name}__{tag}__"
            lo, hi, step = npz[k + "lo"], npz[k + "hi"], npz[k + "step"]
            bins = 512 if name in ONE else 64
            counts = _counts(cols[name], lo, hi, step, bins)
            out["cases"][f"{name}__{tag}"] = {
                "dims": 1 if name in ONE else 2, "bins": bins, "adjust": a,
                "n": int(npz[k + "n"]), "n_in": int(npz[k + "n_in"]), "n_out": int(npz[k + "n_out"]),
                "sigma": _round(npz[k + "sigma"]), "lo": _round(lo), "hi": _round(hi), "step": _round(step),
                "h": _round(npz[k + "h"]), "h_floor": _round(npz[k + "h_floor"]),
                "counts": counts.astype(int).tolist(), "density": _round(npz[k + "density_floor"])}
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
