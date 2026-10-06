#!/usr/bin/env python
# Copyright (c) 2025-2026 Dominik J. Otto, Siddharth Baasri, Manu Setty
# SPDX-License-Identifier: MIT  (this script; see LICENSE in the annzarro repository)
"""Build bm_aging.zarr, the demonstration store of the AnnZarro docs and paper, from public data.

The paper's Procedure, Steps 3 to 10, as one script:

  download  murine_bone_marrow_aging.h5ad from Zenodo (doi:10.5281/zenodo.15587768, CC BY 4.0,
            2,439,076,864 bytes), in parallel range requests, then its published md5
  kompot    the Kompot getting-started tutorial: Palantir diffusion maps on X_pca_harmony
            (40 components), kompot.da and kompot.de, Young vs Old. Unlike the tutorial it does
            NOT call kompot.cleanup(), which would delete the smoothed and fold-change layers
            the views need. Writes bm_aging_processed.h5ad (5.6 GB).
  store     Kompot's keys from uns[...]['last_run_info'], a dense five-step diffusion walk in
            obsp, gene x gene Spearman correlations of the fold-change and smoothed layers in
            varp, dense arrays as float32, X and logged_counts as CSC, zarr format 2, then
            chunks by the aspect rule (layers about 5e5 values with the matrix's own aspect;
            obsp and varp in whole rows) and consolidated metadata.

    python bm_aging.py [--workdir bm_aging] [--out bm_aging/bm_aging.zarr] [--from download|kompot|store]

Each stage reuses the previous stage's file if it exists; --from reruns from a stage on.

Requirements, as validated for the paper (pin them; Kompot's numbers change between versions):
    kompot==0.8.0 palantir==1.4.5 mellon==1.7.1 anndata==0.12.19 zarr==3.1.6 numpy==2.4.6
    scipy==1.17.1, Python 3.11, plus curl. Resources: the 2.4 GB download, about 29 GB of RAM
    for the Kompot stage (its layers are float64 in memory) and about 1 to 2 min of compute on
    a 16-core laptop after the download.

The input data are CC BY 4.0 (Fred Hutchinson Cancer Center, Zenodo 2025); this script contains
none of them.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import time
import urllib.request
from importlib import metadata
from pathlib import Path

import numpy as np

URL = "https://zenodo.org/records/15587768/files/murine_bone_marrow_aging.h5ad?download=1"
SIZE = 2_439_076_864
MD5 = "3e346c91e029e5fde551a9ebf9ecee78"
RAW = "murine_bone_marrow_aging.h5ad"
PROCESSED = "bm_aging_processed.h5ad"

VALIDATED = {"kompot": "0.8.0", "palantir": "1.4.5", "mellon": "1.7.1", "anndata": "0.12.19",
             "zarr": "3.1.6", "numpy": "2.4.6", "scipy": "1.17.1"}

# The tutorial's configuration (01_getting_started.ipynb, Kompot 0.8)
GROUPBY, CONDITIONS = "Age", ("Young", "Old")      # the first is the reference
OBSM_KEY, LAYER, PCA_KEY, N_DM = "DM_EigenVectors", "logged_counts", "X_pca_harmony", 40
WALK_STEPS = 5


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def check_versions() -> dict:
    got = {}
    for pkg, want in VALIDATED.items():
        try:
            got[pkg] = metadata.version(pkg)
        except metadata.PackageNotFoundError:
            got[pkg] = None
        if got[pkg] != want:
            log(f"note: {pkg} {got[pkg]} (validated with {want}); numbers may differ")
    return got


# --------------------------------------------------------------------------- Step 3
def md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 24), b""):
            h.update(block)
    return h.hexdigest()


def download(workdir: Path, parts: int = 16) -> Path:
    out = workdir / RAW
    if not out.exists():
        log(f"downloading {URL} ({SIZE / 1e9:.1f} GB, {parts} range requests)")
        tmp = workdir / "_parts"
        tmp.mkdir(parents=True, exist_ok=True)
        step = -(-SIZE // parts)
        procs = []
        for i in range(parts):
            a, b = i * step, min(SIZE, (i + 1) * step) - 1
            procs.append(subprocess.Popen(["curl", "-sfL", "--retry", "5", "-r", f"{a}-{b}",
                                           "-o", str(tmp / f"part_{i:02d}"), URL]))
        if any(p.wait() for p in procs):
            log("parallel download failed; downloading in one request")
            urllib.request.urlretrieve(URL, out)
        else:
            with open(out, "wb") as f:
                for i in range(parts):
                    with open(tmp / f"part_{i:02d}", "rb") as part:
                        shutil.copyfileobj(part, f)
        shutil.rmtree(tmp, ignore_errors=True)
    got = md5(out)
    if got != MD5:
        raise SystemExit(f"md5 mismatch for {out}: {got} != {MD5}; delete it and rerun")
    log(f"md5 OK {got}")
    return out


# --------------------------------------------------------------------------- Step 4
def kompot_fields(adata, kind: str) -> dict:
    """Kompot's output keys. uns[kind]['last_run_info'] is a JSON string in Kompot 0.8."""
    info = adata.uns[kind]["last_run_info"]
    if isinstance(info, (str, bytes)):
        info = json.loads(info)
    return dict(info["field_names"])


def run_kompot(raw: Path, out: Path, seed: int = 0) -> Path:
    import anndata as ad
    import kompot
    import palantir

    np.random.seed(seed)
    t0 = time.perf_counter()
    adata = ad.read_h5ad(raw)
    log(f"loaded {adata.n_obs} cells x {adata.n_vars} genes")
    palantir.utils.run_diffusion_maps(adata, pca_key=PCA_KEY, n_components=N_DM)
    kompot.da(adata, groupby=GROUPBY, condition1=CONDITIONS[0], condition2=CONDITIONS[1],
              obsm_key=OBSM_KEY)
    kompot.de(adata, groupby=GROUPBY, condition1=CONDITIONS[0], condition2=CONDITIONS[1],
              layer=LAYER, obsm_key=OBSM_KEY, gp=kompot.GPSettings(batch_size=0))
    # no kompot.cleanup(adata): the views need the smoothed and fold-change layers
    adata.write_h5ad(out)
    log(f"Kompot done in {time.perf_counter() - t0:.0f} s; wrote {out} ({out.stat().st_size / 1e9:.1f} GB)")
    return out


# --------------------------------------------------------------------------- Steps 5-10
def spearman_columns(S: np.ndarray) -> np.ndarray:
    """Spearman correlation between columns (genes); constant columns correlate 0."""
    from scipy.stats import rankdata
    R = rankdata(S, axis=0).astype(np.float32)
    sd = R.std(0)
    R -= R.mean(0)
    R /= np.where(sd == 0, 1.0, sd)
    C = (R.T @ R) / np.float32(R.shape[0])
    return np.clip(C, -1, 1)


def layer_chunks(n_obs: int, n_vars: int, target: float = 5e5) -> tuple[int, int]:
    rows = 2 ** round(math.log2(math.sqrt(target * n_obs / n_vars)))
    cols = 2 ** round(math.log2(target / rows))
    return min(rows, n_obs), min(cols, n_vars)


def row_chunks(n: int, target: float = 1e6) -> tuple[int, int]:
    return max(1, min(n, int(target // n))), n


def build_store(processed: Path, out: Path) -> dict:
    import anndata as ad
    import scipy.sparse as sp
    import zarr

    adata = ad.read_h5ad(processed)
    de, da = kompot_fields(adata, "kompot_de"), kompot_fields(adata, "kompot_da")
    fc_key, smooth_keys = de["fold_change_key"], [de["smoothed_key_1"], de["smoothed_key_2"]]
    for k in [fc_key, *smooth_keys]:
        assert k in adata.layers, f"layer {k} missing: was kompot.cleanup() run?"
    keys = dict(FC_KEY=fc_key, SMOOTH_KEYS=smooth_keys, LFC_KEY=de["mean_lfc_key"],
                MAHAL_KEY=de["mahalanobis_key"], DA_Z_KEY=da["zscore_key"],
                DA_LFC_KEY=da["lfc_key"], IS_DE_KEY=de.get("is_de_key"),
                WALK_KEY=f"diffusion_walk_t{WALK_STEPS}")
    log(f"Kompot keys: {json.dumps(keys)}")

    # Step 6: a dense T^5 from Palantir's kernel
    K = sp.csr_matrix(adata.obsp["DM_Kernel"], dtype=np.float64)
    T = sp.diags(1 / np.asarray(K.sum(1)).ravel()) @ K      # row-stochastic
    W = T.toarray()
    M = W.copy()
    for _ in range(WALK_STEPS - 1):
        M = M @ W
    adata.obsp[keys["WALK_KEY"]] = M.astype(np.float32)
    del W, M

    # Step 7: gene x gene Spearman correlations
    adata.varp["spearman_fold_change"] = spearman_columns(np.asarray(adata.layers[fc_key], np.float32))
    adata.varp["spearman_smoothed"] = spearman_columns(
        np.vstack([adata.layers[k] for k in smooth_keys]).astype(np.float32))

    # Step 8: float32, CSC for what is read by gene
    for slot in ("layers", "obsp", "varp"):
        for key, arr in getattr(adata, slot).items():
            if not sp.issparse(arr):
                getattr(adata, slot)[key] = np.asarray(arr, np.float32)
    adata.X = sp.csc_matrix(adata.X)
    adata.layers[LAYER] = sp.csc_matrix(adata.layers[LAYER])

    # Step 9: zarr format 2
    if out.exists():
        shutil.rmtree(out)
    ad.settings.zarr_write_format = 2
    adata.write_zarr(out)

    # Step 10: chunks by the aspect rule, then consolidate again
    g = zarr.open_group(str(out), mode="r+", use_consolidated=False)
    chunks = {}
    for slot in ("layers", "obsp", "varp"):
        for key, arr in getattr(adata, slot).items():
            if sp.issparse(arr) or np.ndim(arr) != 2:
                continue
            c = layer_chunks(*arr.shape) if slot == "layers" else row_chunks(arr.shape[1])
            ad.io.write_elem(g[slot], key, arr, dataset_kwargs={"chunks": c})
            chunks[f"{slot}/{key}"] = c
    zarr.consolidate_metadata(str(out))
    log(f"chunks: {json.dumps(chunks)}")

    b = ad.read_zarr(out)
    assert b.layers[fc_key].dtype == np.float32
    n_de = int(b.var[keys["IS_DE_KEY"]].sum()) if keys["IS_DE_KEY"] in b.var else None
    log(f"wrote {out}: {b.n_obs} cells x {b.n_vars} genes, {n_de} DE genes")
    return dict(keys=keys, chunks=chunks, n_de=n_de)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--workdir", type=Path, default=Path("bm_aging"),
                    help="downloads and the processed h5ad go here")
    ap.add_argument("--out", type=Path, default=None, help="the store (default WORKDIR/bm_aging.zarr)")
    ap.add_argument("--from", dest="start", choices=["download", "kompot", "store"], default="download")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    a.workdir.mkdir(parents=True, exist_ok=True)
    out = a.out or a.workdir / "bm_aging.zarr"
    versions = check_versions()
    raw = download(a.workdir)
    processed = a.workdir / PROCESSED
    if a.start in ("download", "kompot") and (a.start == "kompot" or not processed.exists()):
        run_kompot(raw, processed, a.seed)
    report = build_store(processed, out)
    report["versions"] = versions
    (a.workdir / "bm_aging.build.json").write_text(json.dumps(report, indent=1, default=str) + "\n")


if __name__ == "__main__":
    main()
