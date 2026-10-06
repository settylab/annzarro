# Pairwise matrices

`obsp` (cells × cells) and `varp` (genes × genes) drive the two views no other single-cell
browser offers: colour every cell by its relation to the focused cell, and every gene by its
relation to the focused gene (paper figures {doc}`../paper/cell-by-cell` and
{doc}`../paper/gene-by-gene`). AnnZarro reads one row per click, so the matrix can
be far larger than memory. Building it is your job, in Python, before writing the store.

## Size first

A dense float32 matrix over *n* items costs **4n² bytes**. One row costs 4n bytes.

| n | Dense matrix | One row | Example |
|---|---|---|---|
| 8,090 cells | 0.26 GB | 32 kB | demonstration `obsp/diffusion_walk_t5` |
| 16,285 genes | 1.06 GB | 65 kB | demonstration `varp/spearman_*` |
| 32,000 cells | 4.1 GB | 128 kB | |
| 75,000 cells | 22.5 GB | 300 kB | browsed on the lab deployment, one row per click |
| 100,000 cells | 40 GB | 400 kB | |
| 200,000 cells | 160 GB | 800 kB | HPC benchmark: 0.23 s per row cold (provisional) |

The server never holds the matrix: on the paper's HPC benchmark, peak server memory stayed at
85-117 MiB while serving rows of 10-160 GB matrices ({doc}`../reference/performance`). The limits
are disk and the time to compute the matrix, not AnnZarro.

### Sparse or dense

| | Dense float32 | Sparse CSR |
|---|---|---|
| Disk | 4n², compresses poorly | about 8 bytes per stored entry (float32 + int32 index) |
| Read one row | the chunks of that row: chunk rows by whole rows | `data[indptr[i]:indptr[i+1]]`, lazy; CSR only |
| Wire | dense, or sparse when fewer than half the values are non-zero | sparse when that is smaller (a kNN row: 15 of 8,090 values, 120 bytes) |
| Good for | diffusion walks, correlations, distances to all cells | kNN graphs, kernels, thresholded walks |

Store **cells × cells matrices as CSR** (rows are what a click reads) or dense with whole-row
chunks. Above roughly 30,000 cells, keep obsp sparse unless you have the disk for 4n².

## Cells × cells: a diffusion walk

A kNN kernel row covers few cells: in the demonstration data a row of the diffusion kernel
has a median effective support (1/Σp²) of 33 cells and shows as a speck on the embedding.
A few steps of the diffusion random walk T spread each row over a cell-state neighbourhood.
Effective support of rows of Tᵗ in the demonstration data:

| t | 1 | 2 | 4 | 8 | 16 | 32 |
|---|---|---|---|---|---|---|
| cells | 33 | 134 | 282 | 474 | 735 | 1,123 |

The Procedure stores T⁵ (the smallest t with support ≥ 300) as `obsp/diffusion_walk_t5`.
Palantir's `run_diffusion_maps` {cite:p}`setty2019` writes the kernel (`DM_Kernel`) and its
row-normalised transition matrix (`DM_Similarity`) to `obsp`.

```python
import numpy as np, scipy.sparse as sp

K = sp.csr_matrix(adata.obsp["DM_Kernel"], dtype=np.float64)
T = sp.diags(1 / np.asarray(K.sum(1)).ravel()) @ K      # row-stochastic
W = T.toarray(); M = W.copy()
for _ in range(4):                                     # T^5
    M = M @ W
adata.obsp["diffusion_walk_t5"] = M.astype(np.float32)
```

6.8 s and 262 MB at 8,090 cells. From the example haematopoietic stem cell, 90.7 % of the walk's
mass stays among stem cells.

**Sparse alternative for large n.** Multiply sparse and drop tiny entries after each step:

```python
M = T.copy()
for _ in range(4):
    M = (M @ T).tocsr()
    M.data[M.data < 1e-5] = 0
    M.eliminate_zeros()
adata.obsp["diffusion_walk_t5"] = M.astype(np.float32)
```

On the demonstration data this takes 1.7 s, keeps 1,153 entries per row instead of 3,175
non-zeros in the dense T⁵, keeps 99.7 % of each row's mass (median), and differs from the dense
result by at most 2.3 × 10⁻⁵. Stored as CSR it is about 75 MB against 262 MB dense
(`docs/_tools/measure_sparse_walk.py`).

Any other cells × cells quantity works the same way: kNN `connectivities` and `distances`
from scanpy {cite:p}`wolf2018`, a kernel at another bandwidth, spatial neighbourhoods. A view
can colour by any obsp row, so duplicating a Cell Plot and switching its colour from
`diffusion_walk_t5` to `DM_Kernel` or `distances` compares neighbourhood definitions for the
same cell.

## Genes × genes: Spearman correlation

Correlation over cells answers "which genes behave like the focused gene". What you correlate
decides the answer:

- **Smoothed expression** recovers **cell-type programs**. For S100a8 there are 45 genes with
  ρ > 0.8, the neutrophil granule program.
- **Kompot fold changes** ask which genes' **age effect** varies the same way across cell
  states, and recover co-regulated responses: H2-Q7 with H2-Q6, Tapbpl, H2-D1 and B2m (MHC
  class I); H2-Aa with H2-Eb1, H2-Ab1, Ciita and Cd74 (MHC class II).

The Procedure stores both. Spearman is Pearson on ranks, computed for all pairs with one
matrix product:

```python
import numpy as np
from scipy.stats import rankdata

def spearman_columns(S):
    """Spearman correlation between the columns (genes) of S (rows = cells)."""
    R = rankdata(S, axis=0).astype(np.float32)
    sd = R.std(0)
    R -= R.mean(0); R /= np.where(sd == 0, 1.0, sd)    # constant genes -> 0, not NaN
    C = (R.T @ R) / np.float32(R.shape[0])
    return np.clip(C, -1, 1)                          # float32 sums reach 1 + 1e-7

adata.varp["spearman_fold_change"] = spearman_columns(
    np.asarray(adata.layers[FC_KEY], np.float32))
adata.varp["spearman_smoothed"] = spearman_columns(
    np.vstack([adata.layers[k] for k in SMOOTH_KEYS]).astype(np.float32))
```

`FC_KEY` and `SMOOTH_KEYS` come from the Kompot run record ({doc}`kompot`). The smoothed version
stacks both conditions' layers, so one matrix captures co-variation along the manifold and with
age.

Cost for 16,285 genes: 30.5 s for both matrices (`rankdata` dominates: 18.4 s for the stacked
16,180 × 16,285 input), about 4 GB of RAM, and 968 MB and 985 MB on disk because correlations
barely compress. To keep varp small, restrict to highly variable or differentially expressed
genes. **varp must still be n_genes × n_genes**, because the focused gene's index in `var` is
the row AnnZarro reads. Compute the correlation over the subset and write it into a full matrix
filled with NaN, which compresses to almost nothing on disk:

```python
idx = np.flatnonzero(adata.var["highly_variable"])
full = np.full((adata.n_vars, adata.n_vars), np.nan, dtype=np.float32)
full[np.ix_(idx, idx)] = spearman_columns(np.asarray(adata.layers[FC_KEY][:, idx], np.float32))
adata.varp["spearman_fold_change_hvg"] = full
```

Genes outside the subset then have no value. Focusing one of them leaves the whole Gene Plot
without colour (the paper's Troubleshooting: "Volcano all grey"), so pick the focused gene from
the subset.

Other genes × genes matrices that fit the same view: Pearson or proportionality on expression,
WGCNA adjacency {cite:p}`langfelder2008`, Hotspot local correlation {cite:p}`detomaso2021`, or
gene-embedding similarities.

## Wire cost per click

Measured through the server on the demonstration store (binary transfer, page cache warm,
new row each request, median of 10; `docs/_tools/bench_api.py`):

| Row of | Stored | Sent | Time |
|---|---|---|---|
| `obsp/connectivities` (kNN) | CSR float32 | sparse, 144 B | 9 ms |
| `obsp/diffusion_walk_t5` | dense float32, (1024, 1024) chunks | sparse, 28 kB | 13 ms |
| `varp/spearman_fold_change` | dense float32, (1024, 1024) chunks | dense, 65 kB | 17 ms |
