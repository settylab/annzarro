# Demo data

The tutorials, examples and paper-figure pages in this documentation use one dataset,
`bm_aging.zarr`. It holds murine bone marrow across ageing {cite:p}`zenodo_bm_aging`, processed
with Kompot as in Kompot's getting-started tutorial {cite:p}`otto2025kompot`, and written as an
AnnZarro-ready Zarr store.

| | |
|---|---|
| Cells | 8,090: Young 2,917, Mid 2,057, Old 3,116. Kompot compares Young with Old; the Mid cells stay in the store. |
| Genes | 16,285 |
| Cell types | 31 levels of `obs/highres_celltype`, from HSC to plasma cell |
| Comparison | Kompot 0.8 differential expression and abundance, Young to Old: 190 differentially expressed genes (FDR 5%, Mahalanobis threshold 5.82) |
| Format | Zarr v2, consolidated metadata, Blosc lz4, dense arrays float32 |
| Size | 4,777,882,540 bytes in 3,301 files (4.5 GiB) |

## Where it comes from

The raw data are the CITE-seq ageing atlas on Zenodo,
[doi:10.5281/zenodo.15587768](https://doi.org/10.5281/zenodo.15587768) (CC BY 4.0). The file is
`murine_bone_marrow_aging.h5ad`, 2,439,076,864 bytes, MD5 `3e346c91e029e5fde551a9ebf9ecee78`.
Three scripts in the paper's companion repository (`settylab/annzarro-paper`, folder `data_prep/`)
turn it into the store. That repository stays private until the paper is published
({ref}`paper-companion`); until then, follow the same steps in Python with
{doc}`preparing-a-store`, {doc}`kompot` and {doc}`pairwise-matrices`.

1. `download_data.sh` downloads the h5ad with parallel range requests and checks the MD5.
2. `run_kompot.py` runs the Kompot tutorial as a script. It computes Palantir diffusion maps
   {cite:p}`setty2019` on `X_pca_harmony` (40 components), then `kompot.da` and `kompot.de`
   (Young to Old, `logged_counts`, `DM_EigenVectors`). Unlike the notebook it does **not**
   call `kompot.cleanup()`, so the smoothed and fold-change layers that AnnZarro shows are kept.
3. `prepare_annzarro_store.py` adds the pairwise matrices and writes the Zarr store:
   - a dense 5-step diffusion walk in `obsp`;
   - two gene x gene Spearman correlations in `varp`;
   - X converted to CSC;
   - every dense array rewritten as float32 with (1024, 1024) chunks, then the metadata
     consolidated again.

   {doc}`preparing-a-store` explains each step.

`data_prep/README.md` and `data_prep/VALIDATION.md` in that repository record the commands,
timings and every correction to the draft procedure.

## Regenerate it

Once the companion repository is public, run from its root with its analysis environment (scanpy, Kompot 0.8,
Palantir). The whole run takes about two minutes after the download and needs about 32 GB
of RAM, because the Kompot layers are float64 in memory.

```bash
PY=.venv/bin/python
N=16 data_prep/download_data.sh data                              # ~5 min, network-bound
$PY data_prep/run_kompot.py --timings data/run_kompot_timings.json   # ~62 s
$PY data_prep/prepare_annzarro_store.py --report data/prepare_report.json   # ~51 s
```

The processed store is not yet available as a download. The paper's data availability
statement says it will be deposited on Zenodo with the release. Until then, build it with the
steps of {doc}`preparing-a-store`.

To check a copy, hash every file of the directory store in a fixed order:

```python
import hashlib
from pathlib import Path

def store_md5(root):
    """MD5 over every file of a directory store: sorted relative path, then its bytes."""
    root, h = Path(root), hashlib.md5()
    for p in sorted(f for f in root.rglob("*") if f.is_file()):
        h.update(p.relative_to(root).as_posix().encode())
        h.update(p.read_bytes())
    return h.hexdigest()
```

The store behind this documentation gives `b0d150cf4161887febefafe460b0a4b4`.

```{note}
The checksum identifies one build, not the recipe. Re-running Kompot gives float differences
of about 4e-7 in the fold-change layer, so a rebuilt store hashes differently. The scientific
numbers do not change. Compare them with `figures/numbers/*.json` in the paper repository instead.
```

## What is in it

### Cells x genes

| Key | Encoding | What it holds |
|---|---|---|
| `X` | CSC sparse | expression as stored in the source h5ad |
| `layers/kompot_de_Young_smoothed`, `layers/kompot_de_Old_smoothed` | dense, chunks (1024, 1024) | Kompot's smoothed log2 expression per condition, at every cell |
| `layers/kompot_de_Young_to_Old_fold_change` | dense | Old minus Young smoothed expression, per cell and gene |
| `layers/MAGIC_imputed_data` | dense | MAGIC imputation from the source data |
| `layers/logged_counts` | CSR sparse | log2(x + 0.1) - log2(0.1) of the counts. This is Kompot's input. |
| `layers/raw_counts`, `layers/normalized_counts`, `layers/cc_counts` | CSR sparse | counts from the source data |

### Cells x cells and genes x genes

| Key | Encoding | What it holds |
|---|---|---|
| `obsp/diffusion_walk_t5` | dense 8,090², chunks (1024, 1024) | T⁵, the 5-step random walk on the row-normalised diffusion kernel. Row *i* is where a walk from cell *i* lands. |
| `obsp/DM_Kernel`, `obsp/DM_Similarity` | CSR sparse | Palantir's diffusion kernel and its normalised form |
| `obsp/connectivities`, `obsp/distances` | CSR sparse | scanpy kNN graph |
| `varp/spearman_smoothed` | dense 16,285², chunks (1024, 1024) | Spearman correlation of genes across cells, on both smoothed layers stacked. Shared cell-state patterns. |
| `varp/spearman_fold_change` | dense 16,285² | Spearman correlation of genes on the fold-change layer. Shared age responses. |

{doc}`pairwise-matrices` explains why both gene x gene matrices exist.

### Annotations and embeddings

| Key | What it holds |
|---|---|
| `obs/highres_celltype`, `obs/midres_celltype`, `obs/Age`, `obs/Sample`, `obs/leiden`, ... | cell annotations, with colours in `uns/<column>_colors` |
| `obs/kompot_da_Young_to_Old_lfc`, `..._lfc_zscore`, `..._lfc_direction`, `obs/kompot_da_{Young,Old}_log_density` | Kompot differential abundance per cell |
| `obs/kompot_de_Young_std`, `obs/kompot_de_Old_std` | Kompot's per-cell posterior standard deviation (shared by all genes) |
| `var/kompot_de_Young_to_Old_mean_lfc`, `..._mahalanobis`, `..._mahalanobis_local_fdr`, `..._is_de` | Kompot differential expression per gene |
| `obsm/X_umap`, `obsm/X_draw_graph_fa`, `obsm/X_pca`, `obsm/X_pca_harmony`, `obsm/DM_EigenVectors` | embeddings; any two columns can be plot axes |
| `uns/DM_EigenValues` | diffusion eigenvalues (for the multiscale diffusion space) |

### Example cells and genes

The paper repository's `data_prep/demo_panelsets/examples.json` records the cells and genes
that the guides and figures focus on. Each was chosen by a rule, not by eye:

- **Focus gene S100a9.** Rank 8 by Mahalanobis distance. Its mean log fold change is -0.051,
  yet in HSCs the median fold change is -1.35.
- **Alternative gene H2-Q7.** Rank 1. It leads the MHC class I age response.
- **Locked HSC `HSPC_Old_1#GAAGCCCGTGGCTCTG-1`** (index 2089) and **focused monocyte
  `Mature_Young_2#TCAATTCAGTGAGGCT-1`** (index 4236).

Cell names contain `#`. Deep links encode it; type it URL-encoded if you build an API query by hand.

Where to see these fields in use:

- `obsp/diffusion_walk_t5`, `obsp/DM_Kernel` and the embeddings: {doc}`../tutorials/cell-similarity`
  (paper figure: {doc}`../paper/cell-by-cell`).
- `varp/spearman_fold_change`, `varp/spearman_smoothed` and the Kompot `var` columns:
  {doc}`../tutorials/gene-similarity` (paper figure: {doc}`../paper/gene-by-gene`).
- The fold-change and smoothed layers: {doc}`../tutorials/cells-and-genes`
  (paper figure: {doc}`../paper/cells-and-genes`).
- All of them together: {doc}`../tutorials/tour`.

A copy with extra precomputed fields, used where a tutorial needs a number the app cannot
compute, is described in {doc}`showcase-store`.
