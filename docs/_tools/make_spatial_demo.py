#!/usr/bin/env python
"""Build spatial_demo.zarr: a small public Visium dataset prepared for AnnZarro.

    python docs/_tools/make_spatial_demo.py [--out spatial_demo.zarr] [--download-dir _downloads]

Source: 10x Genomics, "Mouse Brain Serial Section 1 (Sagittal-Anterior)", Visium Spatial Gene
Expression, Space Ranger 1.1.0, sample V1_Mouse_Brain_Sagittal_Anterior. Licence: Creative
Commons Attribution 4.0 International (CC BY 4.0).
Dataset page: https://www.10xgenomics.com/datasets/mouse-brain-serial-section-1-sagittal-anterior-1-standard-1-1-0
Files: https://cf.10xgenomics.com/samples/spatial-exp/1.1.0/V1_Mouse_Brain_Sagittal_Anterior/
(downloaded with scanpy.datasets.visium_sge).

Processing (scanpy): spots with >= 500 counts, genes in >= 10 spots; library-size
normalisation to 1e4 and log1p; 2,000 highly variable genes (Seurat flavour) kept as the
gene set; PCA (30), kNN graph (15 neighbours), UMAP, Leiden (igraph, resolution 0.8).

Stored for AnnZarro (Zarr v2, consolidated, float32 dense, chunks by the aspect rule):
  X                 log-normalised expression of the 2,000 HVGs (dense)
  layers/log_normalized  the same values as X, as a layer (written when the plot menus
                    listed layers only; they now list X first under the layer source)
  layers/counts     raw UMI counts of those genes (CSR)
  obsm/spatial      spot centres in full-resolution image pixels (Space Ranger convention:
                    y grows downwards)
  obsm/spatial_upright  (x, -y): the same positions with the tissue upright in a plot
  obsm/X_umap, obsm/X_pca, obs/leiden (+ uns/leiden_colors)
  obsp/connectivities, obsp/distances  expression kNN graph (CSR)
  obsp/spatial_kernel   dense Gaussian kernel on spot distance, sigma = 2 spot pitches,
                        zero beyond 3 sigma, rows normalised to sum 1
  obsp/spatial_distance dense Euclidean spot distance in micrometres
  varp/spearman_hvg     Spearman correlation between the 2,000 HVGs across spots
  uns/source            dict of one-element string arrays: source URL, licence, citation, processing summary
"""
import argparse
import json
import shutil
import time
from pathlib import Path

import anndata as ad
import numpy as np
import scanpy as sc
import scipy.sparse as sp
import zarr
from scipy.spatial.distance import cdist
from scipy.stats import rankdata

SAMPLE = "V1_Mouse_Brain_Sagittal_Anterior"
SOURCE = {
    "dataset": "Mouse Brain Serial Section 1 (Sagittal-Anterior), Visium Spatial Gene Expression, Space Ranger 1.1.0",
    "provider": "10x Genomics",
    "page": "https://www.10xgenomics.com/datasets/mouse-brain-serial-section-1-sagittal-anterior-1-standard-1-1-0",
    "files": f"https://cf.10xgenomics.com/samples/spatial-exp/1.1.0/{SAMPLE}/",
    "licence": "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
    "citation": "10x Genomics. Mouse Brain Serial Section 1 (Sagittal-Anterior), Spatial Gene Expression "
                "dataset analysed with Space Ranger 1.1.0. 10x Genomics, 2020.",
    "built_by": "docs/_tools/make_spatial_demo.py (annzarro repository)",
}
SPOT_PITCH_UM = 100.0     # Visium centre-to-centre distance
TARGET = 5e5


def matrix_chunks(n_rows, n_cols):
    c = int(round(np.sqrt(TARGET * n_cols / n_rows)))
    return min(int(round(TARGET / c)), n_rows), min(c, n_cols)


def row_chunks(n_rows, n_cols):
    return max(1, min(n_rows, int(round(TARGET / n_cols)))), n_cols


def spearman_columns(S):
    """Spearman correlation between columns of a dense matrix (as data_prep does)."""
    R = rankdata(S, axis=0).astype(np.float32)
    sd = R.std(0)
    R -= R.mean(0)
    R /= np.where(sd == 0, 1.0, sd)
    C = (R.T @ R) / np.float32(R.shape[0])
    return np.clip(C, -1, 1).astype(np.float32)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="spatial_demo.zarr")
    ap.add_argument("--download-dir", default="_downloads")
    args = ap.parse_args()
    t0 = time.perf_counter()
    sc.settings.datasetdir = Path(args.download_dir)
    sc.settings.datasetdir.mkdir(parents=True, exist_ok=True)

    a = sc.datasets.visium_sge(SAMPLE)
    a.var_names_make_unique()
    sf = a.uns["spatial"][SAMPLE]["scalefactors"]
    print(a, "\nscalefactors:", sf)
    sc.pp.filter_cells(a, min_counts=500)
    sc.pp.filter_genes(a, min_cells=10)
    a.layers["counts"] = a.X.copy()
    sc.pp.normalize_total(a, target_sum=1e4)
    sc.pp.log1p(a)
    sc.pp.highly_variable_genes(a, n_top_genes=2000, flavor="seurat")
    a = a[:, a.var["highly_variable"]].copy()
    sc.pp.pca(a, n_comps=30)
    sc.pp.neighbors(a, n_neighbors=15)
    sc.tl.umap(a, random_state=0)
    sc.tl.leiden(a, resolution=0.8, flavor="igraph", n_iterations=2, directed=False, random_state=0)
    sc.pl._utils._set_default_colors_for_categorical_obs(a, "leiden")

    xy = np.asarray(a.obsm["spatial"], dtype=np.float64)
    # Scale pixels to micrometres with the 100 um spot pitch (median nearest-spot distance);
    # spot_diameter_fullres in the 1.1.0 scale factors does not give the 100 um pitch.
    Dpx = cdist(xy, xy)
    np.fill_diagonal(Dpx, np.inf)
    um_per_px = SPOT_PITCH_UM / float(np.median(Dpx.min(1)))
    np.fill_diagonal(Dpx, 0)
    D = (Dpx * um_per_px).astype(np.float32)
    sigma = 2 * SPOT_PITCH_UM
    K = np.exp(-(D.astype(np.float64) ** 2) / (2 * sigma ** 2))
    K[D > 3 * sigma] = 0
    K = (K / K.sum(1, keepdims=True)).astype(np.float32)
    X = np.asarray(a.X.todense() if sp.issparse(a.X) else a.X, dtype=np.float32)
    C = spearman_columns(X)

    out = ad.AnnData(X=X, obs=a.obs[["in_tissue", "array_row", "array_col", "n_counts", "leiden"]].copy(),
                     var=a.var[["gene_ids", "n_cells", "means", "dispersions", "dispersions_norm"]].copy())
    out.layers["log_normalized"] = X
    out.layers["counts"] = sp.csr_matrix(a.layers["counts"]).astype(np.float32)
    out.obsm["spatial"] = xy.astype(np.float32)
    out.obsm["spatial_upright"] = np.c_[xy[:, 0], -xy[:, 1]].astype(np.float32)
    out.obsm["X_umap"] = a.obsm["X_umap"].astype(np.float32)
    out.obsm["X_pca"] = a.obsm["X_pca"].astype(np.float32)
    out.obsp["connectivities"] = sp.csr_matrix(a.obsp["connectivities"], dtype=np.float32)
    out.obsp["distances"] = sp.csr_matrix(a.obsp["distances"], dtype=np.float32)
    out.obsp["spatial_kernel"] = K
    out.obsp["spatial_distance"] = D
    out.varp["spearman_hvg"] = C
    out.uns["leiden_colors"] = np.array(a.uns["leiden_colors"], dtype=object)
    proc = {"min_counts": 500, "min_cells": 10, "normalize_total": 1e4, "log1p": True, "n_hvg": 2000,
            "hvg_flavor": "seurat", "n_pcs": 30, "n_neighbors": 15, "leiden_resolution": 0.8,
            "spatial_kernel": f"Gaussian, sigma = {sigma:g} um, cut at 3 sigma, rows sum to 1",
            "um_per_fullres_px": um_per_px, "scanpy": sc.__version__}
    # one-element string arrays: AnnZarro's uns reader slices with [:] and returns null for
    # 0-d (scalar) string arrays
    out.uns["source"] = {k: np.array([str(v)], dtype=object) for k, v in
                         {**SOURCE, "processing": json.dumps(proc)}.items()}

    dst = Path(args.out)
    if dst.exists():
        shutil.rmtree(dst)
    ad.settings.zarr_write_format = 2
    out.write_zarr(dst)
    g = zarr.open_group(str(dst), mode="r+", use_consolidated=False)
    n, m = out.shape
    ad.io.write_elem(g, "X", X, dataset_kwargs={"chunks": matrix_chunks(n, m)})
    ad.io.write_elem(g["layers"], "log_normalized", X, dataset_kwargs={"chunks": matrix_chunks(n, m)})
    for key, arr in (("spatial_kernel", K), ("spatial_distance", D)):
        ad.io.write_elem(g["obsp"], key, arr, dataset_kwargs={"chunks": row_chunks(n, n)})
    ad.io.write_elem(g["varp"], "spearman_hvg", C, dataset_kwargs={"chunks": row_chunks(m, m)})
    zarr.consolidate_metadata(str(dst))
    b = ad.read_zarr(dst)
    assert b.shape == out.shape and np.allclose(b.obsp["spatial_kernel"][7], K[7])
    size = sum(f.stat().st_size for f in dst.rglob("*") if f.is_file())
    summary = {"shape": list(out.shape), "n_leiden": int(out.obs["leiden"].nunique()),
               "kernel_nnz_per_row_median": float(np.median((K > 0).sum(1))),
               "um_per_px": um_per_px, "bytes": size, "seconds": round(time.perf_counter() - t0, 1)}
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
