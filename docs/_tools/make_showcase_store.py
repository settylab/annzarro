#!/usr/bin/env python
# Copyright (c) 2025-2026 Dominik J. Otto, Siddharth Baasri, Manu Setty
# SPDX-License-Identifier: MIT  (see LICENSE in the annzarro repository)
"""Build the AnnZarro showcase store: bm_aging.zarr plus the fields behind the paper figures.

    python docs/_tools/make_showcase_store.py --src bm_aging.zarr --dst bm_aging_showcase.zarr

Needs only bm_aging.zarr (built by docs/_tools/datasets/bm_aging.py) and anndata, zarr, scipy,
scikit-learn and pandas. Every added field is computed with the same code as the paper's figure
scripts (copied here: the store loader, the HSC-to-monocyte trajectory, the rank percentiles
and the colours) and checked against the numbers the paper reports, which are in EXPECTED
below. The script stops with an AssertionError if a number does not reproduce.

Added fields (details in docs/data/showcase-store.md):
  obsp  diffusion_distance, umap_distance              dense float32, chunked by whole rows
  obsm  X_diffusion                                    Palantir multiscale diffusion space
  obs   fig3_plasma_groups, fig3_plasma_focus, fig3_umap_dist_to_plasma,
        fig3_diffusion_dist_to_plasma, fig3a_path_cell, fig3a_path_step, fig3a_focus_cells
  var   fig4_module_k3, rho_fc_H2-Q7, rho_fc_H2-Aa, rho_fc_S100a9, rho_smoothed_H2-Q7,
        fig4c_rank_H2-Q7, fig4c_rank_S100a9, fig4d_class,
        fig5d_fc_locked_HSC, fig5d_fc_focused_monocyte, fig5d_z_locked_HSC,
        fig5d_z_focused_monocyte, fig5d_direction
  layers kompot_de_Young_to_Old_fold_change_zscores    fold change / Kompot per-cell s.d.
  varm  mean_by_celltype                               genes x highres_celltype, DataFrame
  uns   <categorical>_colors, mean_by_celltype_categories, showcase_README
The fig3/fig4/fig5 prefixes are the cell-by-cell, gene-by-gene and cells-and-genes figures in an
earlier numbering of the paper; links and panel sets refer to these names.

Existing arrays are cloned unchanged (copy-on-write on APFS). New dense arrays follow the
chunk aspect rule: cells x genes chunks with rows/cols ~ n_obs/n_vars at ~5e5 values;
obsp/varp chunks hold whole rows.
"""
import argparse
import json
import shutil
import subprocess
import time
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
# Keys, example cells, thresholds and colours of the paper's figure code, and the numbers it
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
def fig3_fields(s, ver):
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
    ver["fig3"] = dict(plasma_cell=names[f], rho=round(float(spearmanr(du, dm)[0]), 4),
                       nA=int(A.sum()), nB=int(B.sum()),
                       walk_mass_A=round(float(W[f][A].sum()), 5), walk_mass_B=round(float(W[f][B].sum()), 5),
                       path_cells=[names[i] for i in picks])

    labels_ab = ["near in UMAP, far in diffusion", "far in UMAP, near in diffusion", "other"]
    grp = np.full(n, labels_ab[2], dtype=object)
    grp[A], grp[B] = labels_ab[0], labels_ab[1]
    obs_new = {
        "fig3_plasma_groups": pd.Categorical(grp, categories=labels_ab),
        "fig3_plasma_focus": np.arange(n) == f,
        "fig3_umap_dist_to_plasma": du.astype(np.float32),
        "fig3_diffusion_dist_to_plasma": dm.astype(np.float32),
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
    obs_new.update({"fig3a_path_cell": on_path, "fig3a_path_step": step_,
                    "fig3a_focus_cells": pd.Categorical(fc, categories=focus_labels)})
    colors = {"fig3_plasma_groups": [CAT[1], CAT[0], NEUTRAL],
              "fig3a_focus_cells": [CAT[0], CAT[1], CAT[2], CAT[3], "#52514e", NEUTRAL]}
    tick("fig3_fields", t0)
    return obs_new, colors, DU, DM, M.astype(np.float32)


# --------------------------------------------------------------------------- paper Fig 4
def fig4_fields(s, ver):
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
    var_new["fig4_module_k3"] = pd.Categorical(mod, categories=["module 1", "module 2", "module 3"])
    for focus in ("H2-Q7", "S100a9"):
        j = list(dg).index(focus)
        r = C[j]
        keep = np.arange(len(dg)) != j
        idx = np.where(keep)[0][np.argsort(-r[keep])]
        rank = np.full(len(genes), np.nan, np.float32)
        rank[de[idx]] = np.arange(1, len(idx) + 1)
        var_new[f"fig4c_rank_{focus}"] = rank
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
    var_new["fig4d_class"] = pd.Categorical(cls, categories=labels_d)
    ver["fig4"] = dict(k=int(k_best), module_sizes=sizes, n_cell_state_only=int(lin.sum()), n_age=int(age.sum()),
                       h2q7_top5=[(genes[i], round(float(b[i]), 2)) for i in np.argsort(-b)[1:6]])
    colors = {"fig4_module_k3": [CAT[6], CAT[5], CAT[3]], "fig4d_class": [CAT[6], CAT[3], NEUTRAL]}
    tick("fig4_fields", t0)
    return var_new, colors


# --------------------------------------------------------------------------- paper Fig 5
def fig5_fields(s, ver):
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
    var_new = {"fig5d_fc_locked_HSC": a.astype(np.float32), "fig5d_fc_focused_monocyte": b.astype(np.float32),
               "fig5d_z_locked_HSC": zh.astype(np.float32), "fig5d_z_focused_monocyte": zm.astype(np.float32),
               "fig5d_direction": pd.Categorical(d, categories=labels)}
    ver["fig5"] = dict(n_opposite=int(opp.sum()), n_hsc_196=int((de & (np.abs(zh) > 1.96)).sum()),
                       n_mono_196=int((de & (np.abs(zm) > 1.96)).sum()),
                       opposite_both=[genes[i] for i in np.where(opp_z)[0]],
                       apoe=(round(float(a[s.gi('Apoe')]), 3), round(float(b[s.gi('Apoe')]), 3)),
                       z_abs_max=float(np.abs(Zl).max()))
    tick("fig5_fields", t0)
    return Zl, var_new, {"fig5d_direction": [CAT[6], CAT[3], NEUTRAL]}


def mean_by_celltype(s):
    """varm DataFrame: mean logged_counts per highres_celltype (columns in category order)."""
    t0 = time.perf_counter()
    X = ad.io.read_elem(s.g["layers/logged_counts"]).tocsr()
    cat = s.obs["highres_celltype"]
    cats = list(cat.cat.categories)
    codes = cat.cat.codes.to_numpy()
    G = sp.csr_matrix((np.ones(len(codes)), (codes, np.arange(len(codes)))), shape=(len(cats), len(codes)))
    sizes = np.asarray(G.sum(1)).ravel()
    Mn = np.asarray((G @ X).todense()) / sizes[:, None]
    df = pd.DataFrame(Mn.T.astype(np.float32), index=s.var.index, columns=cats)
    tick("mean_by_celltype", t0)
    return df, cats


def write_dense(group, key, arr, chunks):
    ad.io.write_elem(group, key, np.ascontiguousarray(arr), dataset_kwargs={"chunks": chunks})
    log(f"  wrote {group.path}/{key} {arr.shape} {arr.dtype} chunks={chunks}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default="bm_aging.zarr")
    ap.add_argument("--dst", default="bm_aging_showcase.zarr")
    ap.add_argument("--report", default=None, help="write verification numbers and timings as JSON")
    args = ap.parse_args()
    T = time.perf_counter()
    ad.settings.zarr_write_format = 2
    ver = {}

    s = Store(args.src)
    obs3, col3, DU, DM, Mspace = fig3_fields(s, ver)
    var4, col4 = fig4_fields(s, ver)
    Zl, var5, col5 = fig5_fields(s, ver)
    mbc, cats = mean_by_celltype(s)

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
    ad.io.write_elem(g["varm"], "mean_by_celltype", mbc)
    log(f"  wrote varm/mean_by_celltype DataFrame {mbc.shape}")
    obs = s.obs.copy()
    for k, v in obs3.items():
        obs[k] = v
    var = s.var.copy()
    for k, v in {**var4, **var5}.items():
        var[k] = v
    ad.io.write_elem(g, "obs", obs)
    ad.io.write_elem(g, "var", var)
    uns = g["uns"]
    for k, v in {**col3, **col4, **col5}.items():
        ad.io.write_elem(uns, f"{k}_colors", np.array(v, dtype=object))
    ad.io.write_elem(uns, "mean_by_celltype_categories", np.array(cats, dtype=object))
    ad.io.write_elem(uns, "showcase_README", (
        "AnnZarro showcase store: bm_aging.zarr plus fields that rebuild the paper figures "
        "(Figures 3-5) inside AnnZarro. Built by docs/_tools/make_showcase_store.py in the "
        "annzarro repository; field list in bm_aging_showcase.FIELDS.md."))
    zarr.consolidate_metadata(str(dst))
    tick("write_fields", t0)

    # round trip: every added field reads back through anndata
    t0 = time.perf_counter()
    r = zarr.open_group(str(dst), mode="r")
    o2 = ad.io.read_elem(r["obs"])
    v2 = ad.io.read_elem(r["var"])
    assert list(o2["fig3_plasma_groups"].value_counts().sort_index()) == list(obs["fig3_plasma_groups"].value_counts().sort_index())
    assert np.array_equal(v2["fig4_module_k3"].astype(str), var["fig4_module_k3"].astype(str))
    assert np.allclose(r["obsp/diffusion_distance"][123], DM[123])
    assert np.allclose(r[f"layers/{ZKEY}"][:, 2551], Zl[:, 2551])
    assert list(ad.io.read_elem(r["varm/mean_by_celltype"]).columns) == cats
    tick("verify_readback", t0)
    TIMINGS["total"] = round(time.perf_counter() - T, 1)
    log(f"done: {json.dumps(TIMINGS)}")
    out = {"verification": ver, "timings_s": TIMINGS}
    print(json.dumps(out, indent=1, default=str))
    if args.report:
        Path(args.report).write_text(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    main()
