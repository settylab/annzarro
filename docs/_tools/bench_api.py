"""Time the requests one click makes on the demo store, JSON against binary.

    .venv-docs/bin/python docs/_tools/bench_api.py --port 8812

Needs a running server (``annzarro start --host 127.0.0.1 --port <port> --no-browser
--auth-disabled --data-dir <dir holding bm_aging.zarr>``). Each request uses a new
random index, so the server's result cache and HTTP revalidation do not answer it;
the OS page cache is warm. Client wall time from request to the last byte, with
``requests`` on localhost. Writes docs/_tools/data/api_bm_aging.csv.
"""
from __future__ import annotations

import os
import argparse
import csv
import statistics
import time
from pathlib import Path

import numpy as np
import requests

HERE = Path(__file__).resolve().parent
STORE = str(Path(os.environ.get("ANNZARRO_DOCS_DATA", Path.home() / "annzarro-data")) / "bm_aging.zarr")
N_CELLS, N_GENES = 8090, 16285
REPS = 10

# (label, route, index parameter, axis length, extra params)
REQUESTS = [
    ("gene column, dense layer (fold change)", "layer/kompot_de_Young_to_Old_fold_change", "cols", N_GENES, {}),
    ("gene column, X (CSC)", "X", "cols", N_GENES, {}),
    ("gene column, CSR layer (logged_counts)", "layer/logged_counts", "cols", N_GENES, {}),
    ("cell row, dense layer (fold change)", "layer/kompot_de_Young_to_Old_fold_change", "rows", N_CELLS, {}),
    ("cell row, X (CSC)", "X", "rows", N_CELLS, {}),
    ("obsp row, dense (diffusion_walk_t5)", "obsp/diffusion_walk_t5", "rows", N_CELLS, {}),
    ("obsp row, sparse kNN (connectivities)", "obsp/connectivities", "rows", N_CELLS, {}),
    ("varp row, dense (spearman_fold_change)", "varp/spearman_fold_change", "rows", N_GENES, {}),
    ("obsm column (X_umap)", "obsm/X_umap", "cols", 2, {}),
    ("obs column (DA z-score)", "obs", None, None, {"columns": "kompot_da_Young_to_Old_lfc_zscore"}),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8812)
    args = ap.parse_args()
    base = f"http://127.0.0.1:{args.port}/api/v1/data"
    s = requests.Session()
    s.get(f"{base}/dataset_structure", params={"dataset_path": STORE})
    rng = np.random.default_rng(1)
    rows = []
    for label, route, axis, n, extra in REQUESTS:
        for fmt in ("json", "f32"):
            times, sizes = [], []
            # obsm and obs have only a few distinct requests; those repeat the same URL
            # with the server's result cache warm, which the label says.
            idx = rng.choice(n, REPS, replace=n < REPS) if axis else [None] * REPS
            for i in idx:
                params = {"dataset_path": STORE, **extra}
                if axis:
                    params[axis] = int(i)
                if fmt == "f32":
                    params["format"] = "f32"
                t0 = time.perf_counter()
                r = s.get(f"{base}/{route}", params=params)
                r.content
                times.append(time.perf_counter() - t0)
                sizes.append(len(r.content))
                assert r.status_code == 200, (route, r.status_code, r.text[:200])
            rows.append(dict(request=label, format=fmt, median_ms=round(statistics.median(times) * 1e3, 1),
                             bytes=int(statistics.median(sizes)),
                             encoding=r.headers.get("X-Annzarro-Encoding", "json"),
                             dtype=r.headers.get("X-Annzarro-Dtype", ""), n=REPS))
            print(rows[-1], flush=True)
    out = HERE / "data" / "api_bm_aging.csv"
    out.parent.mkdir(exist_ok=True)
    with out.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print("wrote", out)


if __name__ == "__main__":
    main()
