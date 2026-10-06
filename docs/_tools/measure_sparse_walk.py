"""Numbers quoted in data/pairwise-matrices.md: a pruned sparse T^5 against the dense one.

    .venv-docs/bin/python docs/_tools/measure_sparse_walk.py

Reads obsp/DM_Kernel of the demo store, builds the row-stochastic T, and computes T^5
twice: dense (as in the Procedure) and sparse with entries below 1e-5 dropped after
each step.
"""
import os
import time
from pathlib import Path

import anndata as ad
import numpy as np
import scipy.sparse as sp
import zarr

STORE = Path(os.environ.get("ANNZARRO_DOCS_DATA", Path.home() / "annzarro-data")) / "bm_aging.zarr"
EPS = 1e-5

K = sp.csr_matrix(ad.io.read_elem(zarr.open_group(STORE, mode="r")["obsp/DM_Kernel"]), dtype=np.float64)
T = sp.diags(1 / np.asarray(K.sum(1)).ravel()) @ K
print(f"kernel: {K.nnz / K.shape[0]:.1f} stored entries per row")

t0 = time.perf_counter()
M = T.copy()
for _ in range(4):
    M = (M @ T).tocsr()
    M.data[M.data < EPS] = 0
    M.eliminate_zeros()
print(f"sparse T^5: {time.perf_counter() - t0:.1f} s, {M.nnz / M.shape[0]:.0f} entries per row, "
      f"median row mass kept {np.median(np.asarray(M.sum(1)).ravel()):.4f}, "
      f"{M.nnz * 8 / 1e6:.0f} MB as float32 + int32 indices")

W = T.toarray()
D = W.copy()
for _ in range(4):
    D = D @ W
print(f"dense T^5: {(D > 0).sum() / D.shape[0]:.0f} non-zero per row, "
      f"{D.astype(np.float32).nbytes / 1e6:.0f} MB as float32; "
      f"largest difference to the sparse one {np.abs(M.toarray() - D).max():.1e}")
