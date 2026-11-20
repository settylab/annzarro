"""Oracle: scipy hierarchical clustering (linkage matrix and leaf order) for X1 (``utils/hclust.js``).

Writes ``linkage.npz``.

Pinned versions (must match VERSIONS.json; the script refuses to run otherwise):
    scanpy 1.12.6, anndata 0.13.4, scipy 1.18.1, numpy 2.5.5, pandas 3.1.1

Run ONLY in the throwaway venv: ``<venv>/bin/python make_linkage.py``.

Cases (rows are clustered; the input matrix is stored so a consumer needs no fixture):
  ``means_ct``    6 cell types x 12 genes (b_markers), mean of the ``logged`` layer per group; rows = groups
  ``genes_ct``    the 11 expressed b_markers (GENE003 is constant zero and dropped) x 6 cell types, same means;
                  rows = genes
  ``cells40``    first 40 cells x the 39 genes except GENE003, layer ``X`` (scaled); rows = cells
  ``rand40``      40 x 15 seeded standard-normal values (default_rng(seed), seed the first of 5, 6, ... whose distances have no near ties; stored as ``rand40__seed``)
Linkage: complete, average, ward. Distance: ``correlation`` (1 - Pearson r) and ``euclidean`` through
``scipy.spatial.distance.pdist``; ward only with euclidean (as CXG-21). The script asserts that every
pairwise distance of every case is distinct (relative gap > 3e-7, so a float32 distance matrix cannot reorder them), so the merge order has no ties.
Keys: ``<case>__X`` input, ``<case>__dist_<correlation|euclidean>`` condensed distances,
``<case>__Z_<distance>_<method>`` the (n-1, 4) linkage matrix, ``<case>__leaves_<distance>_<method>`` the leaf order
from ``leaves_list(Z)`` (asserted equal to ``dendrogram(Z, no_plot=True)['leaves']``).
Left-right orientation of a merge is scipy's: the lower-numbered cluster first in Z, leaves in dendrogram order.
"""
import os
import sys

import numpy as np

PINS = {"scanpy": "1.12.6", "anndata": "0.13.4", "scipy": "1.18.1", "numpy": "2.5.5", "pandas": "3.1.1"}
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

_common.check_versions(PINS)
from scipy.cluster.hierarchy import dendrogram, leaves_list, linkage  # noqa: E402
from scipy.spatial.distance import pdist  # noqa: E402

COMBOS = [("correlation", "complete"), ("correlation", "average"),
          ("euclidean", "complete"), ("euclidean", "average"), ("euclidean", "ward")]


def ties_free(X):
    for dist in ("correlation", "euclidean"):
        s = np.sort(pdist(X, metric=dist))
        if not np.all(np.diff(s) > 3e-7 * np.maximum(1.0, s[1:])):
            return False
    return True


def rand40():
    for seed in range(5, 200):
        X = np.random.default_rng(seed).normal(size=(40, 15))
        if ties_free(X):
            return X, seed
    raise SystemExit("no tie-free seed")


def cases(data, gene_sets):
    b = data.logged[:, :12].astype(np.float64)
    ct = data.obs["cell_type"].cat.codes.to_numpy()
    means = np.array([b[ct == g].mean(axis=0) for g in range(6)])
    keep = [j for j in range(40) if j != 3]
    rand, seed = rand40()
    return {
        "rand40__seed": seed,
        "means_ct": means,
        "genes_ct": np.delete(means, 3, axis=1).T.copy(),
        "cells40": data.x[:40][:, keep].astype(np.float64),
        "rand40": rand,
    }


def main(out):
    data, gene_sets, _ = _common.load_fixture()
    res = {}
    for name, X in cases(data, gene_sets).items():
        if name.endswith("__seed"):
            res[name] = np.array(X)
            continue
        res[f"{name}__X"] = X
        for dist in ("correlation", "euclidean"):
            d = pdist(X, metric=dist)
            s = np.sort(d)
            assert np.all(np.diff(s) > 3e-7 * np.maximum(1.0, s[1:])), f"{name}/{dist}: tied distances"
            res[f"{name}__dist_{dist}"] = d
        for dist, method in COMBOS:
            Z = linkage(res[f"{name}__dist_{dist}"], method=method)
            leaves = leaves_list(Z)
            assert list(leaves) == list(dendrogram(Z, no_plot=True)["leaves"])
            res[f"{name}__Z_{dist}_{method}"] = Z
            res[f"{name}__leaves_{dist}_{method}"] = leaves.astype(np.int32)
    res["fixture_digest"] = np.array(_common.fixture_digest(data))
    np.savez_compressed(out, **res)
    print(out, len(res), "arrays")


if __name__ == "__main__":
    main(os.path.join(os.path.dirname(os.path.abspath(__file__)), "linkage.npz"))
