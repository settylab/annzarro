"""Scanpy score_genes reference values for tests/core/test_gene_score_control.py.

Run in an environment with scanpy (scanpy 1.13, anndata 0.13); writes the matrix and scanpy's scores to an
.npz so the test needs no scanpy.  Controls are every other gene of the signature's bins (ctrl_size above the
bin sizes), which leaves nothing to chance, so engine and scanpy must agree exactly when both bin by the mean.
"""
import sys
import numpy as np
import scanpy as sc
import anndata as ad
import scipy.sparse as sp

out = sys.argv[1]
rng = np.random.default_rng(11)
n_obs, n_var = 200, 150
rate = np.concatenate([rng.uniform(0.01, 0.9, n_var - 10), np.zeros(5), np.full(5, 0.5)])
scale = rng.uniform(0.5, 4.0, n_var)
x = rng.gamma(2.0, 1.0, (n_obs, n_var)) * scale * (rng.random((n_obs, n_var)) < rate)
x = np.round(x, 2).astype(np.float32)
x[:, n_var - 5:] = 0.0                      # five genes never seen: tied at the bottom of the ranking
names = [f"G{i:03d}" for i in range(n_var)]
signatures = {
    "common": [3, 7, 20, 41, 58, 60, 99, 120],
    "mixed": [0, 1, 2, 75, 76, 140, 146],     # includes a never-seen gene (146 >= 145)
    "single": [33],
}
result = {"x": x}
for label, cols in signatures.items():
    a = ad.AnnData(sp.csr_matrix(x), var=None)
    a.var_names = names
    sc.tl.score_genes(a, [names[c] for c in cols], ctrl_size=10_000, n_bins=25, ctrl_as_ref=True, score_name="s")
    result[f"{label}_cols"] = np.array(cols)
    result[f"{label}_scanpy"] = a.obs["s"].to_numpy(np.float64)
    a2 = ad.AnnData(sp.csr_matrix(x))
    a2.var_names = names
    sc.tl.score_genes(a2, [names[c] for c in cols], ctrl_size=10_000, n_bins=10, ctrl_as_ref=True, score_name="s")
    result[f"{label}_scanpy_bins10"] = a2.obs["s"].to_numpy(np.float64)
np.savez_compressed(out, **result)
print({k: v.shape for k, v in result.items()})
