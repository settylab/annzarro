"""Oracle: Gaussian KDE with a DIAGONAL bandwidth, by direct summation over the cells (CNT-10, V3).

Writes ``kde.npz``. Not ``scipy.stats.gaussian_kde`` (that uses the full covariance); scipy is pinned only because
the version check covers all five packages.

Pinned versions (must match VERSIONS.json; the script refuses to run otherwise):
    scanpy 1.12.6, anndata 0.13.4, scipy 1.18.1, numpy 2.5.5, pandas 3.1.1

Run ONLY in the throwaway venv: ``<venv>/bin/python make_kde.py``.

Definition (requirements CNT-10): over the finite values, n their count and sigma_d the sample SD (ddof=1) per
dimension d, ``h_d = adjust * sigma_d * n**(-1/(dim+4))``. Range per dimension: 0.1st to 99.9th percentile of the
finite values (numpy linear interpolation), padded by 3 h_d on both sides. The grid has ``bins`` equal cells per
dimension; the density is evaluated at the cell CENTRES, ``lo + (i + 0.5) * step``. Cells inside the range are
summed directly (no binning): ``f(x) = 1/m * sum_i prod_d phi((x_d - v_id)/h_d)/h_d`` with m the cells in range
(``n_in``; the others are ``n_out``, excluded and counted as SHR-45 asks). The ``floor`` variant uses
``h_d' = max(h_d, 1.5 * step_d)`` (the engine's floor, grid steps of the same range); the range stays that of the
unfloored h. 2D densities are stored as float32. 2D keys hold arrays of shape (bins_x, bins_y), x first.

Cases and keys (``<case>__<name>``; names: ``lo``, ``hi``, ``step``, ``h``, ``h_floor``, ``n``, ``n_in``, ``n_out``,
``sigma``, ``density``, ``density_floor``; ``adjust`` is in the case name as ``a0.5``, ``a1``, ``a2``):
  1D, 512 bins:   ``score`` (normal), ``signed``, ``depth`` (60% zeros, so a spike), ``pseudotime`` (ties, NaN dropped)
  2D, 64 x 64:    ``umap`` (X_umap columns 0, 1; independent), ``corr`` (logged GENE000 x GENE006: positively
                  correlated through cell type), ``score_depth``
The 2D ``corr`` case is where the diagonal bandwidth and scipy's full covariance disagree.
"""
import os
import sys

import numpy as np

PINS = {"scanpy": "1.12.6", "anndata": "0.13.4", "scipy": "1.18.1", "numpy": "2.5.5", "pandas": "3.1.1"}
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

_common.check_versions(PINS)

ADJUST = [0.5, 1.0, 2.0]
BINS_1D, BINS_2D = 512, 64


def kde(cols, bins, adjust):
    """cols: list of 1D arrays (same length, NaN allowed: those cells are dropped)."""
    V = np.column_stack(cols).astype(np.float64)
    V = V[np.all(np.isfinite(V), axis=1)]
    n, dim = V.shape
    sigma = V.std(axis=0, ddof=1)
    h = adjust * sigma * n ** (-1.0 / (dim + 4))
    lo = np.percentile(V, 0.1, axis=0) - 3 * h
    hi = np.percentile(V, 99.9, axis=0) + 3 * h
    step = (hi - lo) / bins
    inside = np.all((V >= lo) & (V <= hi), axis=1)
    W = V[inside]

    def density(hh):
        axes = [lo[d] + (np.arange(bins) + 0.5) * step[d] for d in range(dim)]
        per_dim = []
        for d in range(dim):
            u = (axes[d][:, None] - W[None, :, d]) / hh[d]               # (bins, m)
            per_dim.append(np.exp(-0.5 * u * u) / (hh[d] * np.sqrt(2 * np.pi)))
        if dim == 1:
            return per_dim[0].mean(axis=1)
        return np.einsum("im,jm->ij", per_dim[0], per_dim[1]) / W.shape[0]

    h_floor = np.maximum(h, 1.5 * step)
    return {"lo": lo, "hi": hi, "step": step, "h": h, "h_floor": h_floor, "sigma": sigma,
            "n": np.array(n), "n_in": np.array(W.shape[0]), "n_out": np.array(n - W.shape[0]),
            "density": density(h), "density_floor": density(h_floor)}


def main(out):
    data, _, _ = _common.load_fixture()
    o = data.obs
    one = {k: [o[k].to_numpy(np.float64)] for k in ("score", "signed", "depth", "pseudotime")}
    two = {"umap": [data.obsm["X_umap"][:, 0], data.obsm["X_umap"][:, 1]],
           "corr": [data.logged[:, 0], data.logged[:, 6]],
           "score_depth": [o["score"].to_numpy(np.float64), o["depth"].to_numpy(np.float64)]}
    res = {}
    for name, cols in {**one, **two}.items():
        bins = BINS_1D if name in one else BINS_2D
        for a in ADJUST:
            tag = f"a{a:g}"
            for k, v in kde(cols, bins, a).items():
                if name in two and k.startswith("density"):
                    v = v.astype(np.float32)                    # file size; the test tolerance is 2% of the peak
                res[f"{name}__{tag}__{k}"] = v
    res["fixture_digest"] = np.array(_common.fixture_digest(data))
    np.savez_compressed(out, **res)
    print(out, len(res), "arrays")


if __name__ == "__main__":
    main(os.path.join(os.path.dirname(os.path.abspath(__file__)), "kde.npz"))
