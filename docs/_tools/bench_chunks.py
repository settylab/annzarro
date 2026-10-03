"""Measure how chunk shape sets the cost of a gene column and a cell row, through AnnZarro.

    .venv-docs/bin/python docs/_tools/bench_chunks.py --port 8812 --work /some/scratch/dir

Writes one synthetic AnnData zarr store (format 2) per chunk shape of a dense
n_cells x n_genes float32 layer, then asks a running AnnZarro server
(``annzarro start --host 127.0.0.1 --port <port> --no-browser --auth-disabled``) for
gene columns and cell rows of that layer in the binary encoding (``format=f32``).
Every request uses a new random index, so neither the server's result cache nor the
browser-style 304 can answer it; the OS page cache is warm (macOS cannot drop it
without root). Results go to docs/_tools/data/chunk_sweep.csv; make_chunk_figure.py
plots them.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import time
import urllib.request
from pathlib import Path

import anndata as ad
import numpy as np
import pandas as pd
import zarr

HERE = Path(__file__).resolve().parent
N_CELLS, N_GENES = 200_000, 2_000
REPS = 15


def layer_chunks(n_obs, n_vars, target=5e5):
    """The aspect rule from the docs (Preparing data > Chunking)."""
    rows = 2 ** round(math.log2(math.sqrt(target * n_obs / n_vars)))
    cols = 2 ** round(math.log2(target / rows))
    return min(rows, n_obs), min(cols, n_vars)


def write_store(path: Path, layer: np.ndarray, chunks) -> tuple[int, int]:
    adata = ad.AnnData(
        obs=pd.DataFrame(index=[f"c{i}" for i in range(layer.shape[0])]),
        var=pd.DataFrame(index=[f"g{j}" for j in range(layer.shape[1])]),
    )
    ad.settings.zarr_write_format = 2
    if chunks is None:                       # anndata's own choice
        adata.layers["dense"] = layer
        adata.write_zarr(path)
    else:
        adata.write_zarr(path)
        g = zarr.open_group(path, mode="r+", use_consolidated=False)
        ad.io.write_elem(g["layers"], "dense", layer, dataset_kwargs={"chunks": chunks})
        zarr.consolidate_metadata(path)
    arr = zarr.open_group(path, mode="r")["layers/dense"]
    return tuple(int(c) for c in arr.chunks)


def timed_get(url: str) -> tuple[float, int]:
    t0 = time.perf_counter()
    with urllib.request.urlopen(url) as r:
        body = r.read()
    return time.perf_counter() - t0, len(body)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8812)
    ap.add_argument("--work", type=Path, required=True, help="scratch directory for the stores")
    ap.add_argument("--keep", action="store_true", help="keep the stores afterwards")
    args = ap.parse_args()
    base = f"http://127.0.0.1:{args.port}/api/v1/data/layer/dense"

    rng = np.random.default_rng(0)
    layer = rng.standard_normal((N_CELLS, N_GENES), dtype=np.float32)
    rule = layer_chunks(N_CELLS, N_GENES)
    shapes = {
        "whole-gene": (N_CELLS, 8),
        "aspect rule": rule,
        "anndata default": None,
        "square": (1024, 1024),
        "whole-cell": (256, N_GENES),
    }
    rows = []
    for name, chunks in shapes.items():
        store = args.work / f"chunks_{name.replace(' ', '_')}.zarr"
        actual = write_store(store, layer, chunks)
        print(f"{name}: chunks {actual}", flush=True)
        query = f"dataset_path={urllib.parse.quote(str(store))}&format=f32"
        timed_get(f"{base}?{query}&cols=0")          # open the store once
        for interaction, axis, n in (("gene column", "cols", N_GENES), ("cell row", "rows", N_CELLS)):
            idx = rng.choice(n, REPS, replace=False)
            times = []
            for i in idx:
                t, nbytes = timed_get(f"{base}?{query}&{axis}={int(i)}")
                times.append(t)
            rows.append(dict(shape=name, chunks=f"{actual[0]}x{actual[1]}", interaction=interaction,
                             median_s=round(statistics.median(times), 4),
                             q25_s=round(np.quantile(times, 0.25), 4),
                             q75_s=round(np.quantile(times, 0.75), 4),
                             bytes=nbytes, n=REPS))
            print(f"  {interaction}: {statistics.median(times) * 1000:.0f} ms", flush=True)
        if not args.keep:
            import shutil
            shutil.rmtree(store)

    out = HERE / "data" / "chunk_sweep.csv"
    out.parent.mkdir(exist_ok=True)
    with out.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    meta = dict(n_cells=N_CELLS, n_genes=N_GENES, dtype="float32", data="standard normal (incompressible)",
                reps=REPS, anndata=ad.__version__ if hasattr(ad, "__version__") else "",
                zarr=zarr.__version__, transfer="binary format=f32, localhost",
                cache="new random index per request; OS page cache warm")
    (HERE / "data" / "chunk_sweep.json").write_text(json.dumps(meta, indent=1))
    print("wrote", out)


if __name__ == "__main__":
    main()
