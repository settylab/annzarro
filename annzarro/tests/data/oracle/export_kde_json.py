"""Writes ``kde.json`` beside ``kde.npz``: the density oracle as Node tests can read it (V3).

Needs numpy and pandas only (the repo venv is fine; scanpy is NOT involved, the KDE values are read from the .npz).
Run from anywhere:  python export_kde_json.py        (``--check`` compares instead of writing, exit 1 if stale)

For each oracle case (1D ``score``, ``signed``, ``depth``, ``pseudotime``; 2D ``umap``, ``corr``, ``score_depth``; adjust
0.5, 1, 2) the file holds what the engine's grid reply holds and the oracle's answer. The reply is the cells binned into
``grid`` equal-width cells per axis (512 in 1D, 256 in 2D: the grids the count plot asks for, count-plot-model.js
DENSITY_BINS) over the oracle's range, a value on ``hi`` in the last cell, with ``n``, ``sigma`` and the range. The counts
are stored sparsely (``cells``: the cell index, x slowest; ``counts``). The oracle's answer is its density on its own
``bins`` per axis (512 in 1D, 64 in 2D) by direct summation, with the bandwidth floored at 1.5 of ITS grid steps
(``density``; ``h_floor``); a test smooths the engine's counts at the grid of the product and compares at the oracle's
centres. Why not at the oracle's own 64 x 64: a value is moved to its cell's centre, which on zero-inflated columns shifts
a spike of cells by up to half a step, 5 to 10% of the peak at 64 and a quarter of that at 256. ``density_binned`` is the same
definition by direct summation over the values snapped to the grid's centres (the like-for-like reference for the
smoothing; the 2% bound is asserted against it everywhere). Densities are rounded to 3 significant digits, the rest to 9.
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


def _round(a, digits=9):
    return [float(f"{x:.{digits}g}") for x in np.asarray(a, dtype=np.float64).ravel()]


def _counts(cols, lo, hi, grid):
    """The engine's grid: ``grid`` equal cells per axis over [lo, hi]; returns the non-empty cells and their counts."""
    V = np.column_stack(cols).astype(np.float64)
    V = V[np.all(np.isfinite(V), axis=1)]
    inside = np.all((V >= lo) & (V <= hi), axis=1)
    W = V[inside]
    idx = np.minimum(np.floor((W - lo) / ((hi - lo) / grid)).astype(np.int64), grid - 1)
    flat = idx[:, 0] if W.shape[1] == 1 else idx[:, 0] * grid + idx[:, 1]
    cells, counts = np.unique(flat, return_counts=True)
    return cells, counts, lo + (idx + 0.5) * ((hi - lo) / grid)


def _binned_density(snapped, lo, hi, bins, h):
    """The oracle's definition (direct summation, diagonal bandwidth ``h``, centres of its ``bins``) over the values
    SNAPPED to the engine's grid centres: what counts alone can carry. numpy only, no smoothing code shared with the app."""
    dim = snapped.shape[1]
    step = (hi - lo) / bins
    per_dim = []
    for d in range(dim):
        centres = lo[d] + (np.arange(bins) + 0.5) * step[d]
        u = (centres[:, None] - snapped[None, :, d]) / h[d]
        per_dim.append(np.exp(-0.5 * u * u) / (h[d] * np.sqrt(2 * np.pi)))
    if dim == 1:
        return per_dim[0].mean(axis=1)
    return np.einsum("im,jm->ij", per_dim[0], per_dim[1]) / snapped.shape[0]


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
            grid = 512 if name in ONE else 256
            cells, counts, snapped = _counts(cols[name], lo, hi, grid)
            binned = _binned_density(snapped, lo, hi, bins, npz[k + "h_floor"])
            out["cases"][f"{name}__{tag}"] = {
                "dims": 1 if name in ONE else 2, "bins": bins, "grid": grid, "adjust": a,
                "n": int(npz[k + "n"]), "n_in": int(npz[k + "n_in"]), "n_out": int(npz[k + "n_out"]),
                "sigma": _round(npz[k + "sigma"]), "lo": _round(lo), "hi": _round(hi), "step": _round(step),
                "h": _round(npz[k + "h"]), "h_floor": _round(npz[k + "h_floor"]),
                "cells": cells.astype(int).tolist(), "counts": counts.astype(int).tolist(), "density": _round(npz[k + "density_floor"], 3),
                "density_binned": _round(binned, 3)}
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
