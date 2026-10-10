#!/usr/bin/env python
# Copyright (c) 2025-2026 Dominik J. Otto, Siddharth Baasri, Manu Setty
# SPDX-License-Identifier: MIT  (see LICENSE in the annzarro repository)
"""Build the AnnZarro showcase store: bm_aging.zarr plus everything that helps show AnnZarro.

    python docs/_tools/make_annzarro_store.py --src bm_aging.zarr --dst bm_aging_annzarro.zarr

Needs only bm_aging.zarr (built by docs/_tools/datasets/bm_aging.py) and anndata, zarr, scipy,
scikit-learn, pandas and scanpy (with umap-learn, for the 3-D UMAP). Every figure field is
computed with the same code as the paper's figure scripts (copied here: the store loader, the
HSC-to-monocyte trajectory, the rank percentiles and the colors) and checked against the numbers
the paper reports, which are in EXPECTED below. The script stops with an AssertionError if a
number does not reproduce.

Added fields (details in docs/data/demo-data.md; the script also writes them, with shapes, into
uns/README and FIELDS.md next to the store):
  obsp  diffusion_distance, umap_distance              dense float32, chunked by whole rows
  obsm  X_diffusion                                    Palantir multiscale diffusion space
        X_umap_3d                                      3-D UMAP of the stored kNN graph
  obs   plasma_groups, plasma_focus, umap_dist_to_plasma, diffusion_dist_to_plasma,
        trajectory_path_cell, trajectory_path_step, trajectory_focus_cells
  var   gene_module_k3, rho_fc_H2-Q7, rho_fc_H2-Aa, rho_fc_S100a9, rho_smoothed_H2-Q7,
        rho_rank_H2-Q7, rho_rank_S100a9, h2q7_correlation_class,
        hsc_fold_change, monocyte_fold_change, hsc_fold_change_z, monocyte_fold_change_z,
        hsc_vs_monocyte_direction, detection_rate, variance_logged
  layers kompot_de_Young_to_Old_fold_change_zscores    fold change / Kompot per-cell s.d.
  varm  mean_by_celltype, fraction_expressing_by_celltype, mean_by_age, fraction_expressing_by_age
  uns   <categorical>_colors, *_categories of the varm tables, umap_3d (parameters), README
The cell-by-cell, gene-by-gene and cells-and-genes names are the paper's three figure families;
fields carry descriptive names, not figure numbers.

Existing arrays are cloned unchanged (copy-on-write on APFS). New dense arrays follow the
chunk aspect rule: cells x genes chunks with rows/cols ~ n_obs/n_vars at ~5e5 values;
obsp/varp chunks hold whole rows.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
import time
from importlib import metadata
from pathlib import Path

import anndata as ad
import numpy as np
import pandas as pd
import scipy.sparse as sp
import zarr
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.sparse.csgraph import dijkstra
from scipy.spatial.distance import cdist, squareform
from scipy.stats import spearmanr
from sklearn.metrics import silhouette_score

# --------------------------------------------------------------------------- from the paper
# Keys, example cells, thresholds and colors of the paper's figure code, and the numbers it
# reports (its figures/numbers/fig2-4.json), copied so that this script runs on its own.
KEYS = {"FC_KEY": "kompot_de_Young_to_Old_fold_change",
        "SMOOTH_KEYS": ["kompot_de_Young_smoothed", "kompot_de_Old_smoothed"],
        "LFC_KEY": "kompot_de_Young_to_Old_mean_lfc", "MAHAL_KEY": "kompot_de_Young_to_Old_mahalanobis",
        "DA_Z_KEY": "kompot_da_Young_to_Old_lfc_zscore", "DA_LFC_KEY": "kompot_da_Young_to_Old_lfc",
        "IS_DE_KEY": "kompot_de_Young_to_Old_is_de", "WALK_KEY": "diffusion_walk_t5"}
CELLTYPE = "highres_celltype"
HSC_CELL = "HSPC_Old_1#GAAGCCCGTGGCTCTG-1"
MONO_CELL = "Mature_Young_2#TCAATTCAGTGAGGCT-1"
NEAR, FAR = 0.05, 0.20          # rank-percentile thresholds for the discordant groups
CAT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"]
NEUTRAL = "#d9d8d3"
EXPECTED = {
    "fig2": {"trajectory": [{"cell": c} for c in (
                 "HSPC_Old_1#GAAGCCCGTGGCTCTG-1", "HSPC_Old_2#ACTCTCGCAAACCGGA-1",
                 "HSPC_Old_3#ATTTCACTCGTAGTGT-1", "Mature_Young_2#TCAATTCAGTGAGGCT-1")],
             "trajectory_path_celltypes": ["HSC", "HSC", "LMPP", "LMPP", "LMPP", "LMPP", "GMP", "GMP",
                                           "GMP", "GMP", "GMP", "Monocyte", "Monocyte"],
             "focus_bc": {"cell": "Mature_Mid_1#GCCATGGAGTATGATG-1", "nA_near_umap_far_diffusion": 265,
                          "nB_far_umap_near_diffusion": 392,
                          "spearman_umap_vs_diffusion": 0.6168970355222746,
                          "walk_mass_on_A": 0.000860328902490437, "walk_mass_on_B": 0.5916728377342224}},
    "fig3": {"H2-Q7": {"top_fold_change_partners": [[g] for g in ("H2-Q6", "Tapbpl", "H2-D1", "Fxyd5", "Sec62")]},
             "H2-Aa": {"top_fold_change_partners": [[g] for g in ("H2-Eb1", "H2-Ab1", "Ciita", "Cd74", "H2-DMb1")]},
             "clustering": {"k": 3, "module_sizes": {"1": 87, "2": 68, "3": 35}},
             "rank_strips": {"H2-Q7": {"in_module_median_rho": 0.15601231157779694},
                             "S100a9": {"in_module_median_rho": 0.23716677725315094}},
             "panel_d": {"n_lineage_only": 192, "n_age_fc_gt_0.5": 35}},
    "fig4": {"panel_d": {"n_de_opposite_direction": 61, "n_de_beyond_1.96sd_hsc": 120,
                         "n_de_beyond_1.96sd_mono": 13, "de_opposite_beyond_1.96sd_both": ["Apoe"],
                         "n_de_same_beyond_1.96sd_both": 10}},
}


class Store:
    """Reads what the fields need from bm_aging.zarr, by key."""

    def __init__(self, path):
        self.g = zarr.open_group(str(path), mode="r")
        self.obs = ad.io.read_elem(self.g["obs"])
        self.var = ad.io.read_elem(self.g["var"])
        self._ci = {c: i for i, c in enumerate(self.obs.index)}
        self._gi = {c: i for i, c in enumerate(self.var.index)}
        self.umap = np.asarray(self.g["obsm/X_umap"][:], dtype=np.float64)
        self.walk = np.asarray(self.g[f"obsp/{KEYS['WALK_KEY']}"][:])
        self.celltype = self.obs[CELLTYPE].astype(str).to_numpy()
        self.is_de = self.var[KEYS["IS_DE_KEY"]].to_numpy(dtype=bool)

    def ci(self, cell):
        return self._ci[cell]

    def gi(self, gene):
        return self._gi[gene]

    def multiscale_space(self):
        """Palantir's multiscale diffusion space: eigenvectors 1 on, scaled by l / (1 - l)."""
        lam = np.asarray(self.g["uns/DM_EigenValues"][:], dtype=np.float64)[1:]
        V = np.asarray(self.g["obsm/DM_EigenVectors"][:], dtype=np.float64)[:, 1:]
        return V * (lam / (1 - lam))

    def varp_row(self, key, gene):
        return np.asarray(self.g[f"varp/{key}"][self.gi(gene), :], dtype=np.float64)

    def varp_block(self, key, genes_idx):
        """Square sub-matrix varp[key][genes, genes] for a gene index list."""
        genes_idx = np.asarray(genes_idx)
        rows = np.asarray(self.g[f"varp/{key}"].get_orthogonal_selection((genes_idx, slice(None))))
        return rows[:, genes_idx].astype(np.float64)


def trajectory_cells(s, M):
    """HSC -> monocyte geodesic in multiscale diffusion space; return the path and 4 cells."""
    K = ad.io.read_elem(s.g["obsp/DM_Kernel"]).tocoo()
    w = np.linalg.norm(M[K.row] - M[K.col], axis=1)
    G = sp.csr_matrix((w, (K.row, K.col)), shape=K.shape)
    h, m = s.ci(HSC_CELL), s.ci(MONO_CELL)
    dist, pred = dijkstra(G, directed=False, indices=h, return_predecessors=True)
    path = [m]
    while path[-1] != h:
        path.append(pred[path[-1]])
    path = np.array(path[::-1])
    arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(M[path], axis=0), axis=1))]
    frac = arc / arc[-1]
    picks = [path[0], path[np.argmin(abs(frac - 1 / 3))], path[np.argmin(abs(frac - 2 / 3))], path[-1]]
    return path, frac, picks


def rank_pct(D):
    """Row-wise rank percentiles (0 = the cell itself)."""
    return (np.argsort(np.argsort(D, axis=1), axis=1) / D.shape[1]).astype(np.float32)


TARGET = 5e5            # values per chunk
NUMBERS = EXPECTED
ZKEY = "kompot_de_Young_to_Old_fold_change_zscores"   # Kompot 0.8's own key for this layer
KOMPOT_EPS = 1e-8       # kompot.differential.DifferentialExpression default eps
TIMINGS = {}
ANNZARRO_VERSION = "added after v0.4.2"   # where this script is in the annzarro repository


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def tick(name, t0):
    TIMINGS[name] = round(time.perf_counter() - t0, 1)
    log(f"{name}: {TIMINGS[name]} s")


def matrix_chunks(n_rows, n_cols):
    """Cells x genes: chunk aspect rows/cols ~ n_rows/n_cols at ~TARGET values."""
    c = int(round(np.sqrt(TARGET * n_cols / n_rows)))
    r = int(round(TARGET / c))
    return min(r, n_rows), min(c, n_cols)


def row_chunks(n_rows, n_cols):
    """obsp/varp: whole rows, ~TARGET values per chunk."""
    return max(1, min(n_rows, int(round(TARGET / n_cols)))), n_cols


def close(a, b, tol, what):
    """Agreement with the paper at the precision it is printed.

    Floating-point results drift between platforms and BLAS builds in the last digits (a Linux
    x86_64 build gave 0.156055 for a value of 0.156012 on the paper's Apple M3), so each check's
    tolerance is half a unit of the last digit the paper or the docs print, not 1e-6.
    """
    if abs(float(a) - float(b)) > tol:
        import platform
        raise AssertionError(f"{what}: got {float(a)!r}, paper {float(b)!r}, tolerance {tol} "
                             f"({platform.platform()}, {platform.machine()})")
    log(f"  ok  {what}: {float(a):.6g} (paper {float(b):.6g}, tolerance {tol})")


def same(a, b, what):
    if a != b:
        import platform
        raise AssertionError(f"{what}: got {a}, paper {b} ({platform.platform()}, {platform.machine()})")
    log(f"  ok  {what}: {a}")


# --------------------------------------------------------------------------- paper Fig 3
def cell_by_cell_fields(s, ver):
    """Cell x cell (figures/fig2_cell_by_cell.py): distances, plasma groups, trajectory."""
    t0 = time.perf_counter()
    ct = s.celltype
    names = s.obs.index.to_numpy()
    U = s.umap
    M = s.multiscale_space()
    W = s.walk
    n = len(ct)

    path, frac, picks = trajectory_cells(s, M)
    ref = NUMBERS["fig2"]
    same([names[i] for i in picks], [d["cell"] for d in ref["trajectory"]], "Fig 3a trajectory cells")
    same([ct[i] for i in path], ref["trajectory_path_celltypes"], "Fig 3a path cell types")

    DU = cdist(U, U).astype(np.float32)
    DM = cdist(M, M).astype(np.float32)
    RU, RM = rank_pct(DU), rank_pct(DM)
    Am = (RU < NEAR) & (RM > FAR)
    Bm = (RM < NEAR) & (RU > FAR)
    nA, nB = Am.sum(1), Bm.sum(1)
    # focus selection exactly as in fig2_cell_by_cell.main
    mn = np.minimum(nA, nB)
    sizes = pd.Series(ct).value_counts()
    type_score = pd.Series(mn).groupby(ct).median()[sizes[sizes >= 10].index].sort_values(ascending=False)
    best_type = type_score.index[0]
    members = np.where(ct == best_type)[0]
    f = int(members[np.argmin(np.abs(mn[members] - np.median(mn[members])))])
    del RU, RM, Am, Bm
    fb = ref["focus_bc"]
    same(names[f], fb["cell"], "Fig 3b focused plasma cell")
    du, dm = DU[f].astype(float), DM[f].astype(float)
    ru = np.argsort(np.argsort(du)) / n
    rm = np.argsort(np.argsort(dm)) / n
    A = (ru < NEAR) & (rm > FAR)
    B = (rm < NEAR) & (ru > FAR)
    same(int(A.sum()), fb["nA_near_umap_far_diffusion"], "Fig 3b group A size")
    same(int(B.sum()), fb["nB_far_umap_near_diffusion"], "Fig 3b group B size")
    close(spearmanr(du, dm)[0], fb["spearman_umap_vs_diffusion"], 5e-5, "Fig 3b Spearman rho")   # printed 0.6169
    close(W[f][A].sum(), fb["walk_mass_on_A"], 5e-5, "Fig 3b walk mass on A")   # printed 0.09%
    close(W[f][B].sum(), fb["walk_mass_on_B"], 5e-4, "Fig 3b walk mass on B")   # printed 59.2%
    ver["cell_by_cell"] = dict(plasma_cell=names[f], rho=round(float(spearmanr(du, dm)[0]), 4),
                       nA=int(A.sum()), nB=int(B.sum()),
                       walk_mass_A=round(float(W[f][A].sum()), 5), walk_mass_B=round(float(W[f][B].sum()), 5),
                       path_cells=[names[i] for i in picks])

    labels_ab = ["near in UMAP, far in diffusion", "far in UMAP, near in diffusion", "other"]
    grp = np.full(n, labels_ab[2], dtype=object)
    grp[A], grp[B] = labels_ab[0], labels_ab[1]
    obs_new = {
        "plasma_groups": pd.Categorical(grp, categories=labels_ab),
        "plasma_focus": np.arange(n) == f,
        "umap_dist_to_plasma": du.astype(np.float32),
        "diffusion_dist_to_plasma": dm.astype(np.float32),
    }
    on_path = np.zeros(n, bool)
    on_path[path] = True
    step_ = np.full(n, np.nan, np.float32)
    step_[path] = np.arange(len(path))
    focus_labels = ["HSC (start)", "LMPP (1/3 of path)", "GMP (2/3 of path)", "Monocyte (end)", "other path cell", "not on path"]
    fc = np.full(n, focus_labels[5], dtype=object)
    fc[path] = focus_labels[4]
    for lab, i in zip(focus_labels, picks):
        fc[i] = lab
    obs_new.update({"trajectory_path_cell": on_path, "trajectory_path_step": step_,
                    "trajectory_focus_cells": pd.Categorical(fc, categories=focus_labels)})
    colors = {"plasma_groups": [CAT[1], CAT[0], NEUTRAL],
              "trajectory_focus_cells": [CAT[0], CAT[1], CAT[2], CAT[3], "#52514e", NEUTRAL]}
    tick("cell_by_cell_fields", t0)
    return obs_new, colors, DU, DM, M.astype(np.float32)


# --------------------------------------------------------------------------- paper Fig 4
def gene_by_gene_fields(s, ver):
    """Gene x gene (figures/fig3_gene_by_gene.py): modules, rho columns, panel d classes."""
    t0 = time.perf_counter()
    ref = NUMBERS["fig3"]
    genes = s.var.index.to_numpy()
    FC_KEY, SM_KEY = "spearman_fold_change", "spearman_smoothed"
    var_new = {}
    for focus in ("H2-Q7", "H2-Aa", "S100a9"):
        r = s.varp_row(FC_KEY, focus).astype(np.float32)
        var_new[f"rho_fc_{focus}"] = r
        if focus in ref:
            g = s.gi(focus)
            top = [(genes[i], round(float(r[i]), 3)) for i in [j for j in np.argsort(-r) if j != g][:5]]
            same([t[0] for t in top], [t[0] for t in ref[focus]["top_fold_change_partners"][:5]],
                 f"Fig 4 top partners of {focus}")
    var_new["rho_smoothed_H2-Q7"] = s.varp_row(SM_KEY, "H2-Q7").astype(np.float32)

    # (c) modules, verbatim from fig3_gene_by_gene.main
    de = np.where(s.is_de)[0]
    dg = genes[de]
    C = s.varp_block(FC_KEY, de)
    D = 1 - C
    np.fill_diagonal(D, 0)
    D = (D + D.T) / 2
    Z = linkage(squareform(D, checks=False), "average")
    sil = {k: float(silhouette_score(D, fcluster(Z, k, "maxclust"), metric="precomputed")) for k in range(2, 13)}
    k_best = max(sil, key=sil.get)
    lab = fcluster(Z, k_best, "maxclust")
    order = [lab[list(dg).index("H2-Q7")]] + [m for m in np.argsort(-np.bincount(lab))
                                             if m != lab[list(dg).index("H2-Q7")] and m > 0]
    remap = {m: i + 1 for i, m in enumerate(order)}
    lab = np.array([remap[m] for m in lab])
    sizes = {str(int(m)): int((lab == m).sum()) for m in np.unique(lab)}
    same(int(k_best), ref["clustering"]["k"], "Fig 4c k")
    same(sizes, {str(k): v for k, v in ref["clustering"]["module_sizes"].items()}, "Fig 4c module sizes")
    mod = np.full(len(genes), None, dtype=object)
    mod[de] = [f"module {m}" for m in lab]
    var_new["gene_module_k3"] = pd.Categorical(mod, categories=["module 1", "module 2", "module 3"])
    for focus in ("H2-Q7", "S100a9"):
        j = list(dg).index(focus)
        r = C[j]
        keep = np.arange(len(dg)) != j
        idx = np.where(keep)[0][np.argsort(-r[keep])]
        rank = np.full(len(genes), np.nan, np.float32)
        rank[de[idx]] = np.arange(1, len(idx) + 1)
        var_new[f"rho_rank_{focus}"] = rank
        mine = (lab == lab[j]) & keep
        close(np.median(r[mine]), ref["rank_strips"][focus]["in_module_median_rho"], 5e-4,   # printed 0.16 / 0.24
              f"Fig 4c {focus} in-module median rho")
    # (d) classes
    a, b = var_new["rho_smoothed_H2-Q7"].astype(float), var_new["rho_fc_H2-Q7"].astype(float)
    keep = np.arange(len(genes)) != s.gi("H2-Q7")
    lin = keep & (a > 0.7) & (b < 0.5)
    age = keep & (b > 0.5)
    same(int(lin.sum()), ref["panel_d"]["n_lineage_only"], "Fig 4d cell-state pattern only")
    same(int(age.sum()), ref["panel_d"]["n_age_fc_gt_0.5"], "Fig 4d age response")
    labels_d = ["shares age response (fold-change rho > 0.5)",
                "shares cell-state pattern only (smoothed rho > 0.7, fold-change rho < 0.5)", "other"]
    cls = np.full(len(genes), labels_d[2], dtype=object)
    cls[lin], cls[age] = labels_d[1], labels_d[0]
    var_new["h2q7_correlation_class"] = pd.Categorical(cls, categories=labels_d)
    ver["gene_by_gene"] = dict(k=int(k_best), module_sizes=sizes, n_cell_state_only=int(lin.sum()), n_age=int(age.sum()),
                       h2q7_top5=[(genes[i], round(float(b[i]), 2)) for i in np.argsort(-b)[1:6]])
    colors = {"gene_module_k3": [CAT[6], CAT[5], CAT[3]], "h2q7_correlation_class": [CAT[6], CAT[3], NEUTRAL]}
    tick("gene_by_gene_fields", t0)
    return var_new, colors


# --------------------------------------------------------------------------- paper Fig 5
def cells_and_genes_fields(s, ver):
    """Cells <-> genes (figures/fig4_cells_by_genes.py): z-score layer and panel d rows."""
    t0 = time.perf_counter()
    ref = NUMBERS["fig4"]["panel_d"]
    FC = KEYS["FC_KEY"]
    fc = np.asarray(s.g[f"layers/{FC}"][:], dtype=np.float32)
    sdy = s.obs["kompot_de_Young_std"].to_numpy(float)
    sdo = s.obs["kompot_de_Old_std"].to_numpy(float)
    # Kompot 0.8: std_k = sqrt(var_k + eps), z = fc / sqrt(var_Y + var_O + eps)
    denom = np.sqrt(sdy ** 2 + sdo ** 2 - KOMPOT_EPS).astype(np.float32)
    Zl = fc / denom[:, None]
    h, m = s.ci(HSC_CELL), s.ci(MONO_CELL)
    a, b = fc[h].astype(float), fc[m].astype(float)
    zh, zm = Zl[h].astype(float), Zl[m].astype(float)
    de = s.is_de
    opp = de & (a * b < 0)
    same_ = de & (a * b > 0)
    opp_z = opp & (np.abs(zh) > 1.96) & (np.abs(zm) > 1.96)
    genes = s.var.index.to_numpy()
    same(int(opp.sum()), ref["n_de_opposite_direction"], "Fig 5d opposite-direction DE genes")
    same(int((de & (np.abs(zh) > 1.96)).sum()), ref["n_de_beyond_1.96sd_hsc"], "Fig 5d DE beyond 1.96 s.d., HSC")
    same(int((de & (np.abs(zm) > 1.96)).sum()), ref["n_de_beyond_1.96sd_mono"], "Fig 5d DE beyond 1.96 s.d., monocyte")
    same([genes[i] for i in np.where(opp_z)[0]], ref["de_opposite_beyond_1.96sd_both"], "Fig 5d opposite beyond 1.96 s.d. in both")
    same(int((same_ & (np.abs(zh) > 1.96) & (np.abs(zm) > 1.96)).sum()), ref["n_de_same_beyond_1.96sd_both"],
         "Fig 5d same-direction beyond 1.96 s.d. in both")
    labels = ["DE, same direction in both cells", "DE, opposite direction", "not DE"]
    d = np.full(len(genes), labels[2], dtype=object)
    d[same_], d[opp] = labels[0], labels[1]
    var_new = {"hsc_fold_change": a.astype(np.float32), "monocyte_fold_change": b.astype(np.float32),
               "hsc_fold_change_z": zh.astype(np.float32), "monocyte_fold_change_z": zm.astype(np.float32),
               "hsc_vs_monocyte_direction": pd.Categorical(d, categories=labels)}
    ver["cells_and_genes"] = dict(n_opposite=int(opp.sum()), n_hsc_196=int((de & (np.abs(zh) > 1.96)).sum()),
                       n_mono_196=int((de & (np.abs(zm) > 1.96)).sum()),
                       opposite_both=[genes[i] for i in np.where(opp_z)[0]],
                       apoe=(round(float(a[s.gi('Apoe')]), 3), round(float(b[s.gi('Apoe')]), 3)),
                       z_abs_max=float(np.abs(Zl).max()))
    tick("cells_and_genes_fields", t0)
    return Zl, var_new, {"hsc_vs_monocyte_direction": [CAT[6], CAT[3], NEUTRAL]}


AGE_ORDER = ["Young", "Mid", "Old"]
UMAP_SEED, UMAP_MIN_DIST, UMAP_SPREAD = 42, 0.5, 1.0   # the seed of uns/umap; min_dist/spread that give its a and b
README_MARK = "\n\n# AnnZarro showcase store: field list\n"


def group_tables(s, key, cats):
    """Mean logged expression and fraction of cells with a raw count > 0, per level of obs[key].

    Returns two DataFrames, genes x levels (float32, columns in `cats` order). The fraction is
    taken from layers/raw_counts; where logged_counts is non-zero is the same set of entries.
    """
    X = ad.io.read_elem(s.g["layers/logged_counts"]).tocsr()
    R = ad.io.read_elem(s.g["layers/raw_counts"]).tocsr()
    R.data = (R.data > 0).astype(np.float64)
    assert R.nnz == X.nnz, "raw_counts and logged_counts disagree on which entries are non-zero"
    codes = pd.Categorical(s.obs[key].astype(str), categories=cats).codes
    assert (codes >= 0).all(), f"obs/{key} has levels outside {cats}"
    G = sp.csr_matrix((np.ones(len(codes)), (codes, np.arange(len(codes)))), shape=(len(cats), len(codes)))
    sizes = np.asarray(G.sum(1)).ravel()
    mean = np.asarray((G @ X).todense()) / sizes[:, None]
    frac = np.asarray((G @ R).todense()) / sizes[:, None]
    mk = lambda a: pd.DataFrame(a.T.astype(np.float32), index=s.var.index, columns=cats)
    return mk(mean), mk(frac)


def gene_columns(s):
    """var columns: detection rate over all cells, and the variance of logged_counts (ddof = 1)."""
    X = ad.io.read_elem(s.g["layers/logged_counts"]).tocsr()
    R = ad.io.read_elem(s.g["layers/raw_counts"]).tocsr()
    n = X.shape[0]
    det = np.bincount(R.indices[R.data > 0], minlength=X.shape[1]) / n
    s1 = np.asarray(X.sum(0), dtype=np.float64).ravel()
    s2 = np.asarray(X.multiply(X).sum(0), dtype=np.float64).ravel()
    var = (s2 - s1 ** 2 / n) / (n - 1)
    return {"detection_rate": det.astype(np.float32), "variance_logged": np.maximum(var, 0).astype(np.float32)}


def umap_3d(s):
    """3-D UMAP of the stored kNN graph: scanpy.tl.umap(n_components=3), same a and b as X_umap."""
    import scanpy as sc
    t0 = time.perf_counter()
    A = ad.AnnData(np.zeros((s.obs.shape[0], 1), np.float32), obs=pd.DataFrame(index=s.obs.index))
    A.obsp["connectivities"] = ad.io.read_elem(s.g["obsp/connectivities"])
    A.uns["neighbors"] = ad.io.read_elem(s.g["uns/neighbors"])
    rep = A.uns["neighbors"]["params"]["use_rep"]     # scanpy looks the neighbors' representation up
    A.obsm[rep] = np.asarray(s.g[f"obsm/{rep}"][:])
    sc.tl.umap(A, min_dist=UMAP_MIN_DIST, spread=UMAP_SPREAD, n_components=3, random_state=UMAP_SEED)
    p2 = ad.io.read_elem(s.g["uns/umap"])["params"]
    p3 = A.uns["umap"]["params"]
    close(p3["a"], p2["a"], 1e-6, "3-D UMAP a equals X_umap's a")
    close(p3["b"], p2["b"], 1e-6, "3-D UMAP b equals X_umap's b")
    X3 = np.ascontiguousarray(A.obsm["X_umap"], dtype=np.float32)
    assert X3.shape == (s.obs.shape[0], 3) and np.isfinite(X3).all()
    params = {"params": {"n_components": 3, "min_dist": UMAP_MIN_DIST, "spread": UMAP_SPREAD,
                         "a": float(p3["a"]), "b": float(p3["b"]), "random_state": UMAP_SEED,
                         "init_pos": "spectral", "neighbors_key": "neighbors",
                         "graph": "obsp/connectivities",
                         "scanpy": metadata.version("scanpy"), "umap-learn": metadata.version("umap-learn")}}
    tick("umap_3d", t0)
    return X3, params


def new_stats(s):
    """Everything added on top of the figure fields: 3-D UMAP and the gene statistics."""
    t0 = time.perf_counter()
    X3, p3 = umap_3d(s)
    cats = {"celltype": list(s.obs[CELLTYPE].cat.categories), "age": AGE_ORDER}
    mc, fc = group_tables(s, CELLTYPE, cats["celltype"])
    ma, fa = group_tables(s, "Age", cats["age"])
    tables = {"mean_by_celltype": mc, "fraction_expressing_by_celltype": fc,
              "mean_by_age": ma, "fraction_expressing_by_age": fa}
    tick("gene_statistics", t0)
    return X3, p3, tables, cats, gene_columns(s)


def write_dense(group, key, arr, chunks):
    ad.io.write_elem(group, key, np.ascontiguousarray(arr), dataset_kwargs={"chunks": chunks})
    log(f"  wrote {group.path}/{key} {arr.shape} {arr.dtype} chunks={chunks}")


def write_stats(g, X3, p3, tables, cats):
    """obsm/X_umap_3d, the varm tables, and their uns entries. (var columns go with `var`.)"""
    write_dense(g["obsm"], "X_umap_3d", X3, X3.shape)
    ad.io.write_elem(g["uns"], "umap_3d", p3)
    for k, df in tables.items():
        ad.io.write_elem(g["varm"], k, df)
        log(f"  wrote varm/{k} DataFrame {df.shape}")
        ad.io.write_elem(g["uns"], f"{k}_categories",
                         np.array(cats["celltype" if k.endswith("celltype") else "age"], dtype=object))


# --------------------------------------------------------------------------- field list
FIELDS = {
    "obsp/diffusion_distance": ("Euclidean distance in Palantir's multiscale diffusion space (`obsm/X_diffusion`)", "Focused cell's row as color or axis"),
    "obsp/umap_distance": ("Euclidean distance on `obsm/X_umap`", "x axis against `diffusion_distance`"),
    "obsm/X_diffusion": ("Palantir multiscale diffusion space: `DM_EigenVectors[:, 1:40] * lambda / (1 - lambda)` from `uns/DM_EigenValues`", "Alternative coordinates; any two columns are axes"),
    "obsm/X_umap_3d": ("3-D UMAP of the stored kNN graph (`obsp/connectivities`): `scanpy.tl.umap(n_components=3, min_dist=0.5, spread=1.0, random_state=42)`, the same a and b as `X_umap`. Parameters in `uns/umap_3d`.", "Plot with 3-D axes"),
    "obs/plasma_groups": ("Discordant groups for the plasma cell `Mature_Mid_1#GCCATGGAGTATGATG-1`: near in UMAP and far in diffusion (265), the reverse (392), other. Thresholds: 5% / 20% rank percentile. Colors in `uns/plasma_groups_colors`.", "Color"),
    "obs/plasma_focus": ("True for that plasma cell", "Filter, find the cell"),
    "obs/umap_dist_to_plasma": ("That cell's row of `obsp/umap_distance`, as a column", "Axis where a row cannot be chosen"),
    "obs/diffusion_dist_to_plasma": ("That cell's row of `obsp/diffusion_distance`, as a column", "Axis where a row cannot be chosen"),
    "obs/trajectory_path_cell": ("True for the 13 cells on the shortest diffusion path from a HSC to a monocyte (`HSPC_Old_1#GAAGCCCGTGGCTCTG-1` to `Mature_Young_2#TCAATTCAGTGAGGCT-1`)", "Filter"),
    "obs/trajectory_path_step": ("Position on that path, 0 to 12; NaN off the path", "Sort a table, color"),
    "obs/trajectory_focus_cells": ("The four cells at 0, 1/3, 2/3 and 1 of the path (HSC, LMPP, GMP, monocyte), other path cells, not on path. Colors in `uns/trajectory_focus_cells_colors`.", "Color, find the cells"),
    "var/rho_fc_H2-Q7": ("H2-Q7's row of `varp/spearman_fold_change`, as a column", "Gene-plot axis"),
    "var/rho_fc_H2-Aa": ("H2-Aa's row of `varp/spearman_fold_change`", "Gene-plot axis"),
    "var/rho_fc_S100a9": ("S100a9's row of `varp/spearman_fold_change`", "Gene-plot axis"),
    "var/rho_smoothed_H2-Q7": ("H2-Q7's row of `varp/spearman_smoothed`", "Gene-plot axis"),
    "var/gene_module_k3": ("Average-linkage modules on 1 - rho (`spearman_fold_change`) of the 190 DE genes, k = 3 (silhouette maximum over 2..12); module 1 is H2-Q7's. NaN for non-DE genes. Colors in `uns/gene_module_k3_colors`.", "Color"),
    "var/rho_rank_H2-Q7": ("Rank of each DE gene by rho with H2-Q7, descending; NaN for non-DE genes and H2-Q7", "Axis of ranked strips"),
    "var/rho_rank_S100a9": ("The same for S100a9", "Axis of ranked strips"),
    "var/h2q7_correlation_class": ("Relative to H2-Q7: shares the age response (fold-change rho > 0.5), shares the cell-state pattern only (smoothed rho > 0.7, fold-change rho < 0.5), other", "Color"),
    "var/hsc_fold_change": ("The HSC `HSPC_Old_1#GAAGCCCGTGGCTCTG-1` row of `layers/kompot_de_Young_to_Old_fold_change`", "Axis"),
    "var/monocyte_fold_change": ("The monocyte `Mature_Young_2#TCAATTCAGTGAGGCT-1` row of the same layer", "Axis"),
    "var/hsc_fold_change_z": ("That HSC's row of the z-score layer", "Filter by noise level"),
    "var/monocyte_fold_change_z": ("That monocyte's row of the z-score layer", "Filter by noise level"),
    "var/hsc_vs_monocyte_direction": ("DE genes with the same or the opposite fold-change sign in the HSC and the monocyte, or not DE", "Color"),
    "var/detection_rate": ("Fraction of all cells with a raw count > 0", "Filter, axis"),
    "var/variance_logged": ("Variance of `layers/logged_counts` over all cells (ddof = 1)", "Filter, axis"),
    "layers/kompot_de_Young_to_Old_fold_change_zscores": ("Kompot's fold-change z-score: `fold_change / sqrt(sd_Young^2 + sd_Old^2 - eps)`, eps = 1e-8, `sd_*` from `obs/kompot_de_{Young,Old}_std`. Key name is Kompot 0.8's own `fold_change_zscores_key`.", "Color a gene's signal-to-noise; filter by |z| > 1.96"),
    "varm/mean_by_celltype": ("Mean of `layers/logged_counts` per `obs/highres_celltype`; columns in category order (`uns/mean_by_celltype_categories`)", "Gene-plot axes (e.g. HSC mean against Neutrophil mean)"),
    "varm/fraction_expressing_by_celltype": ("Fraction of cells with a raw count > 0, per `obs/highres_celltype`; columns as above (`uns/fraction_expressing_by_celltype_categories`)", "Gene-plot axes or color"),
    "varm/mean_by_age": ("Mean of `layers/logged_counts` per `obs/Age`: Young, Mid, Old (`uns/mean_by_age_categories`)", "Gene-plot axes (Young against Old)"),
    "varm/fraction_expressing_by_age": ("Fraction of cells with a raw count > 0 per `obs/Age` (`uns/fraction_expressing_by_age_categories`)", "Gene-plot axes or color"),
}
KEPT = {"obsp": "connectivities, distances (scanpy kNN, CSR), DM_Kernel, DM_Similarity (Palantir, CSR), diffusion_walk_t5 (dense five-step diffusion walk)",
        "varp": "spearman_fold_change, spearman_smoothed (dense gene x gene Spearman correlations)",
        "layers": "logged_counts, raw_counts, normalized_counts, cc_counts (CSR); kompot_de_Young_smoothed, kompot_de_Old_smoothed, kompot_de_Young_to_Old_fold_change, MAGIC_imputed_data (dense)"}


def store_md5(root):
    """MD5 over every file of a directory store: sorted relative path, then its bytes (docs/data/demo-data.md)."""
    root, h = Path(root), hashlib.md5()
    for p in sorted(f for f in root.rglob("*") if f.is_file()):
        h.update(p.relative_to(root).as_posix().encode())
        h.update(p.read_bytes())
    return h.hexdigest()


def array_info(g, path):
    n = g[path]
    a = n.attrs.asdict()
    et = a.get("encoding-type", "")
    if et.endswith("_matrix"):
        return f"{a['shape'][0]} x {a['shape'][1]} sparse {et[:3].upper()}"
    if et == "dataframe":
        return f"DataFrame {n[a['_index']].shape[0]} x {len(a['column-order'])} {n[a['column-order'][0]].dtype}"
    return f"{' x '.join(map(str, n.shape))} {n.dtype}, chunks {tuple(n.chunks)}"


def fields_markdown(dst, version, src_md5):
    g = zarr.open_group(str(dst), mode="r", use_consolidated=False)
    obs, var = ad.io.read_elem(g["obs"]), ad.io.read_elem(g["var"])
    n_obs, n_vars = len(obs), len(var)

    def col(df, name):
        c = df[name]
        if isinstance(c.dtype, pd.CategoricalDtype):
            vc = c.value_counts(dropna=False)
            lev = ", ".join(f"`{k}` ({v:,})" for k, v in vc.items() if v)
            return f"categorical: {lev}"
        return str(c.dtype)

    L = [f"# bm_aging_annzarro.zarr: field list", "",
         f"The AnnZarro showcase store of the murine bone marrow aging data ({n_obs:,} cells x {n_vars:,} genes; "
         "Kompot 0.8, Young vs Old; source: Zenodo 10.5281/zenodo.15587768, CC BY 4.0). It holds everything "
         "that `bm_aging.zarr` holds, unchanged, plus the fields below. Built by "
         "`docs/_tools/make_annzarro_store.py` in the annzarro repository "
         f"({version}). Source store: `bm_aging.zarr`, store MD5 `{src_md5}` (MD5 over every file of the directory store, "
         "sorted relative path then bytes). Zarr v2, consolidated metadata, Blosc lz4. This list is generated from the store.", "",
         "Unchanged from `bm_aging.zarr`:", ""]
    L += [f"- `{k}`: {v}" for k, v in KEPT.items()]
    L += ["- `X` (CSC), `obs`, `var`, `obsm` (X_umap, X_pca, X_pca_harmony, DM_EigenVectors, ...), `varm/PCs`, `uns`", ""]
    for slot in ("obsp", "obsm", "obs", "var", "layers", "varm"):
        keys = [k for k in FIELDS if k.startswith(slot + "/")]
        L += [f"## Added to {slot}", "", "| name | what | definition | use in AnnZarro |", "|---|---|---|---|"]
        for k in keys:
            name = k.split("/", 1)[1]
            if slot in ("obs", "var"):
                what = col(obs if slot == "obs" else var, name)
            else:
                what = array_info(g, k)
            d, u = FIELDS[k]
            L.append(f"| `{name}` | {what} | {d} | {u} |")
        L.append("")
    L += ["## uns", "",
          "- `<field>_colors` for `plasma_groups`, `trajectory_focus_cells`, `gene_module_k3`, `h2q7_correlation_class`, "
          "`hsc_vs_monocyte_direction`: one color per category, in category order",
          "- `mean_by_celltype_categories`, `fraction_expressing_by_celltype_categories`, `mean_by_age_categories`, "
          "`fraction_expressing_by_age_categories`: the column order of the varm tables",
          "- `umap_3d`: parameters of `obsm/X_umap_3d`",
          "- `README`: the original dataset note, followed by this list", ""]
    return "\n".join(L)


def finalize(dst, fields_md_path, version, src_md5):
    """Write uns/README (original note + field list), drop the old provenance note, consolidate."""
    g = zarr.open_group(str(dst), mode="r+", use_consolidated=False)
    md = fields_markdown(dst, version, src_md5)
    old = str(ad.io.read_elem(g["uns/README"])) if "README" in g["uns"] else ""
    old = old.split(README_MARK)[0]
    ad.io.write_elem(g["uns"], "README", old + README_MARK + "\n" + md)
    if "showcase_README" in g["uns"]:
        del g["uns"]["showcase_README"]
    zarr.consolidate_metadata(str(dst))
    Path(fields_md_path).write_text(md)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default="bm_aging.zarr")
    ap.add_argument("--dst", default="bm_aging_annzarro.zarr")
    ap.add_argument("--fields-md", default=None, help="where to write FIELDS.md (default: next to --dst)")
    ap.add_argument("--report", default=None, help="write verification numbers and timings as JSON")
    args = ap.parse_args()
    T = time.perf_counter()
    ad.settings.zarr_write_format = 2
    ver = {}

    s = Store(args.src)
    obs3, col3, DU, DM, Mspace = cell_by_cell_fields(s, ver)
    var4, col4 = gene_by_gene_fields(s, ver)
    Zl, var5, col5 = cells_and_genes_fields(s, ver)
    X3, p3, tables, cats, gcols = new_stats(s)

    t0 = time.perf_counter()
    dst = Path(args.dst)
    if dst.exists():
        shutil.rmtree(dst)
    # APFS clone (copy-on-write); falls back to a plain copy elsewhere
    if subprocess.run(["cp", "-cR", args.src, str(dst)]).returncode != 0:
        shutil.copytree(args.src, dst)
    tick("copy_store", t0)

    t0 = time.perf_counter()
    g = zarr.open_group(str(dst), mode="r+", use_consolidated=False)
    n_obs, n_vars = s.obs.shape[0], s.var.shape[0]
    write_dense(g["obsp"], "diffusion_distance", DM, row_chunks(n_obs, n_obs))
    write_dense(g["obsp"], "umap_distance", DU, row_chunks(n_obs, n_obs))
    write_dense(g["obsm"], "X_diffusion", Mspace, (n_obs, Mspace.shape[1]))
    write_dense(g["layers"], ZKEY, Zl, matrix_chunks(n_obs, n_vars))
    write_stats(g, X3, p3, tables, cats)
    obs = s.obs.copy()
    for k, v in obs3.items():
        obs[k] = v
    var = s.var.copy()
    for k, v in {**var4, **var5, **gcols}.items():
        var[k] = v
    ad.io.write_elem(g, "obs", obs)
    ad.io.write_elem(g, "var", var)
    uns = g["uns"]
    for k, v in {**col3, **col4, **col5}.items():
        ad.io.write_elem(uns, f"{k}_colors", np.array(v, dtype=object))
    fields_md = args.fields_md or str(dst.parent / "FIELDS.md")
    finalize(dst, fields_md, ANNZARRO_VERSION, store_md5(args.src))
    tick("write_fields", t0)

    # round trip: every added field reads back through anndata
    t0 = time.perf_counter()
    r = zarr.open_group(str(dst), mode="r")
    o2 = ad.io.read_elem(r["obs"])
    v2 = ad.io.read_elem(r["var"])
    assert list(o2["plasma_groups"].value_counts().sort_index()) == list(obs["plasma_groups"].value_counts().sort_index())
    assert np.array_equal(v2["gene_module_k3"].astype(str), var["gene_module_k3"].astype(str))
    assert np.allclose(r["obsp/diffusion_distance"][123], DM[123])
    assert np.allclose(r[f"layers/{ZKEY}"][:, 2551], Zl[:, 2551])
    assert r["obsm/X_umap_3d"].shape == (n_obs, 3)
    for k, df in tables.items():
        assert list(ad.io.read_elem(r[f"varm/{k}"]).columns) == list(df.columns)
    tick("verify_readback", t0)
    TIMINGS["total"] = round(time.perf_counter() - T, 1)
    log(f"done: {json.dumps(TIMINGS)}")
    out = {"verification": ver, "timings_s": TIMINGS}
    print(json.dumps(out, indent=1, default=str))
    if args.report:
        Path(args.report).write_text(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    main()
