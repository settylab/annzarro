#!/usr/bin/env python
"""Harmonize the D3 / scPLM pan-cancer liver-metastasis atlas (Tong/Wang 2024,
DOI 10.34133/research.1208) into the AnnZarro served schema, then CSC-encode to
zarr for fast gene-wise coloring.

scPLM is a *published, pre-integrated* atlas (read-only; deliberately NOT
re-QC'd / re-clustered by this project — it is a validation-only backbone). So
this is a thin, transparent re-shape, NOT a re-processing:

  * X is scPLM's own log-normalized matrix (values ~2.5-3.2, confirmed log) — we
    expose it unchanged as both X and a `logcounts` layer so the standard
    deep-link `layer:logcounts` path works uniformly with the 16 GSE datasets.
  * `obs['cell_type']` is aliased from scPLM's native `01.Major_cell_types`
    (19 labels) so AnnZarro's cell-type coloring keys on the same column name as
    every other served dataset. ALL native scPLM `0x.*` columns are preserved.
  * `obsm['X_umap']` is scPLM's published embedding, kept as-is.
  * `raw` (integer counts) is dropped from the served store to keep it lean —
    the served use is browsing log expression on the UMAP; counts remain in the
    source object at data/raw/scPLM/scPLM.h5ad if ever needed.

No values are recomputed. Usage: harmonize_scplm.py <in.h5ad> <out.zarr> [chunk]
"""
import sys
import time
import os
import shutil
import numpy as np
import scipy.sparse as sp
import anndata as ad

CHUNK = 1 << 16  # 65536: a single gene's column slice touches ~1-2 chunks


def to_csc(m):
    if sp.issparse(m):
        return m.tocsc()
    return m


def main():
    src, dst = sys.argv[1], sys.argv[2]
    chunk = int(sys.argv[3]) if len(sys.argv) > 3 else CHUNK
    t0 = time.time()
    print(f"[harmonize] reading {src}", flush=True)
    adata = ad.read_h5ad(src)
    print(f"[harmonize] shape={adata.shape} read in {time.time()-t0:.1f}s", flush=True)

    # Drop raw (integer counts) from the served store — validation-only browse
    # needs only log expression; counts stay in the source h5ad.
    if adata.raw is not None:
        adata.raw = None

    # Canonical cell_type handle, aliased from scPLM's native major labels.
    if "01.Major_cell_types" in adata.obs.columns:
        adata.obs["cell_type"] = adata.obs["01.Major_cell_types"].values
        print(f"[harmonize] cell_type aliased from 01.Major_cell_types "
              f"({adata.obs['cell_type'].nunique()} labels)", flush=True)
    else:
        raise SystemExit("[harmonize] FATAL: 01.Major_cell_types missing")

    # Expose the log-normalized X as a `logcounts` layer for uniform deep-links.
    adata.layers["logcounts"] = adata.X
    print(f"[harmonize] logcounts layer = X (log-normalized, already)", flush=True)

    # Re-encode expression matrices as CSC for fast column (gene) access.
    if sp.issparse(adata.X):
        adata.X = to_csc(adata.X)
    for k in list(adata.layers.keys()):
        adata.layers[k] = to_csc(adata.layers[k])

    if os.path.exists(dst):
        shutil.rmtree(dst)

    t1 = time.time()
    adata.write_zarr(dst, chunks=(chunk,))
    print(f"[harmonize] wrote {dst} in {time.time()-t1:.1f}s", flush=True)

    def du(path):
        total = 0
        for root, _, files in os.walk(path):
            for f in files:
                fp = os.path.join(root, f)
                if not os.path.islink(fp):
                    total += os.path.getsize(fp)
        return total

    in_sz = os.path.getsize(os.path.realpath(src))
    out_sz = du(dst)
    print(f"[harmonize] h5ad={in_sz/1e9:.3f}GB zarr={out_sz/1e9:.3f}GB "
          f"mult={out_sz/in_sz:.2f}x total={time.time()-t0:.1f}s", flush=True)


if __name__ == "__main__":
    main()
