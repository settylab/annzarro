# Demo data

The tutorials, examples and paper-figure pages in this documentation use one dataset, the
AnnZarro showcase store `bm_aging_annzarro.zarr`. It holds murine bone marrow across ageing
{cite:p}`zenodo_bm_aging`, processed with Kompot as in Kompot's getting-started tutorial
{cite:p}`otto2025kompot`, written as an AnnZarro-ready Zarr store, and extended with everything
that helps to show what AnnZarro does: a 3-D UMAP, cell-cell and gene-gene similarity, per-cell-type
and per-age gene statistics, and the precomputed fields behind the figures of the paper. It is also
a worked example of the main idea behind AnnZarro: compute once in Python, then explore without code.

| | |
|---|---|
| Cells | 8,090: Young 2,917, Mid 2,057, Old 3,116. Kompot compares Young with Old; the Mid cells stay in the store. |
| Genes | 16,285 |
| Cell types | 31 levels of `obs/highres_celltype`, from HSC to plasma cell |
| Comparison | Kompot 0.8 differential expression and abundance, Young to Old: 190 differentially expressed genes (FDR 5%, Mahalanobis threshold 5.82) |
| Embeddings | `X_umap` (2-D) and `X_umap_3d` (3-D, same graph, same a and b), `X_diffusion`, PCA, Harmony PCA, force-directed layout |
| Format | Zarr v2, consolidated metadata, Blosc lz4, dense arrays float32 |
| Size | 5,741,994,795 bytes in 4,243 files (5.3 GiB); 5.7 GB as one zip |

AnnZarro never computes anything. It shows what is stored. Some panels of the paper figures
depend on numbers that the figure scripts compute in Python: the distance from one cell to all
others, gene modules, the classes in a scatter. To rebuild those panels inside AnnZarro, the
numbers have to be in the store, so this one store holds them next to the data they come from.

## Get the store

**Download.** The store is deposited on Zenodo as one zip, `bm_aging_annzarro.zarr.zip`
(5.7 GB), at [doi:ZENODO_DOI_TBD](https://doi.org/ZENODO_DOI_TBD). The record cites the source
data below and carries the same CC BY 4.0 licence. Unzip it into your data directory
({doc}`../getting-started/quickstart`); the result is the directory `bm_aging_annzarro.zarr`.
The record's `SHA256SUMS` checks the download, and `FIELDS.md` is the field list of this page,
generated from the store.

**Build it.** Two scripts in this repository's `docs/_tools/` rebuild it from the public raw data,
described below: `datasets/bm_aging.py` makes the Kompot-processed base store
`bm_aging.zarr`, and `make_annzarro_store.py` adds the fields.

## Where it comes from

The raw data are the CITE-seq ageing atlas on Zenodo,
[doi:10.5281/zenodo.15587768](https://doi.org/10.5281/zenodo.15587768) (CC BY 4.0). The file is
`murine_bone_marrow_aging.h5ad`, 2,439,076,864 bytes, MD5 `3e346c91e029e5fde551a9ebf9ecee78`.
One script in this repository turns it into the base store `bm_aging.zarr`:
{download}`bm_aging.py <../_tools/datasets/bm_aging.py>` (in `docs/_tools/datasets/`). It
runs the paper's Procedure, Steps 3 to 10:

1. **Download** the h5ad from Zenodo in parallel range requests and check its MD5.
2. **Kompot**, as in the Kompot getting-started tutorial: Palantir diffusion maps
   {cite:p}`setty2019` on `X_pca_harmony` (40 components), then `kompot.da` and `kompot.de`
   (Young to Old, `logged_counts`, `DM_EigenVectors`). Unlike the tutorial it does **not** call
   `kompot.cleanup()`, so the smoothed and fold-change layers that AnnZarro shows are kept. It
   writes `bm_aging_processed.h5ad` (5.6 GB).
3. **The store**: a dense five-step diffusion walk in `obsp`; two gene × gene Spearman
   correlations in `varp`; dense arrays as float32; X and `logged_counts` as CSC; zarr format 2;
   chunks by the aspect rule ({doc}`chunking`), then the metadata consolidated again.

{doc}`preparing-a-store` explains each step.

## Regenerate it

Install the versions the paper validated; Kompot's numbers change between versions:

```bash
pip install kompot==0.8.0 palantir==1.4.5 mellon==1.7.1 anndata==0.12.19 zarr==3.1.6 \
    numpy==2.4.6 scipy==1.17.1 scanpy==1.11.5 umap-learn==0.5.12 scikit-learn pandas
python docs/_tools/datasets/bm_aging.py --workdir bm_aging     # writes bm_aging/bm_aging.zarr
python docs/_tools/make_annzarro_store.py --src bm_aging/bm_aging.zarr --dst bm_aging_annzarro.zarr
```

It needs curl, the 2.4 GB download, about 30 GB of RAM (the Kompot layers are float64 in
memory) and about 13 GB of disk for the download (2.4 GB), the processed h5ad (5.6 GB) and the store (4.8 GB). On an Apple
M3 Max laptop (16 cores, 128 GB) the whole run took 3 min 51 s, 2 min of it the download, with
a peak of 30.0 GB. Each stage reuses the previous stage's file if it is there; `--from store`
rebuilds only the store from the processed h5ad. The base store is 4,782,754,971 bytes in 3,837 files. The second script needs only that store and takes about 25 seconds
(see "How the added fields are built" below); move its output into your server's data directory.

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

The base store `bm_aging.zarr` behind this documentation gives `b0d150cf4161887febefafe460b0a4b4`, and the
showcase store `bm_aging_annzarro.zarr` gives `36a9b6c06a419205af348503ff380ef6`.

```{note}
The checksum identifies one build, not the recipe. A rebuild of the base store with `bm_aging.py` differs from
the published one in its chunk shapes (the store behind these docs has (1024, 1024) chunks and a CSR
`logged_counts`; the script follows the current Procedure) and by about 1e-6 in Kompot's
float outputs, so it hashes differently. The published showcase store was made from the published base store, so
it contains its bytes unchanged. The numbers the docs quote do not change: the same 190
DE genes, Mahalanobis threshold 5.82, and every value the views read agrees to within 2.2e-6.
```


## What is in it

First what `bm_aging.py` writes, then what `make_annzarro_store.py` adds.

### From the base store

#### Cells x genes

| Key | Encoding | What it holds |
|---|---|---|
| `X` | CSC sparse | expression as stored in the source h5ad |
| `layers/kompot_de_Young_smoothed`, `layers/kompot_de_Old_smoothed` | dense, chunks (1024, 1024) | Kompot's smoothed log2 expression per condition, at every cell |
| `layers/kompot_de_Young_to_Old_fold_change` | dense | Old minus Young smoothed expression, per cell and gene |
| `layers/MAGIC_imputed_data` | dense | MAGIC imputation from the source data |
| `layers/logged_counts` | CSR sparse | log2(x + 0.1) - log2(0.1) of the counts. This is Kompot's input. |
| `layers/raw_counts`, `layers/normalized_counts`, `layers/cc_counts` | CSR sparse | counts from the source data |

#### Cells x cells and genes x genes

| Key | Encoding | What it holds |
|---|---|---|
| `obsp/diffusion_walk_t5` | dense 8,090², chunks (1024, 1024) | T⁵, the 5-step random walk on the row-normalised diffusion kernel. Row *i* is where a walk from cell *i* lands. |
| `obsp/DM_Kernel`, `obsp/DM_Similarity` | CSR sparse | Palantir's diffusion kernel and its normalised form |
| `obsp/connectivities`, `obsp/distances` | CSR sparse | scanpy kNN graph |
| `varp/spearman_smoothed` | dense 16,285², chunks (1024, 1024) | Spearman correlation of genes across cells, on both smoothed layers stacked. Shared cell-state patterns. |
| `varp/spearman_fold_change` | dense 16,285² | Spearman correlation of genes on the fold-change layer. Shared age responses. |

{doc}`pairwise-matrices` explains why both gene x gene matrices exist.

#### Annotations and embeddings

| Key | What it holds |
|---|---|
| `obs/highres_celltype`, `obs/midres_celltype`, `obs/Age`, `obs/Sample`, `obs/leiden`, ... | cell annotations, with colours in `uns/<column>_colors` |
| `obs/kompot_da_Young_to_Old_lfc`, `..._lfc_zscore`, `..._lfc_direction`, `obs/kompot_da_{Young,Old}_log_density` | Kompot differential abundance per cell |
| `obs/kompot_de_Young_std`, `obs/kompot_de_Old_std` | Kompot's per-cell posterior standard deviation (shared by all genes) |
| `var/kompot_de_Young_to_Old_mean_lfc`, `..._mahalanobis`, `..._mahalanobis_local_fdr`, `..._is_de` | Kompot differential expression per gene |
| `obsm/X_umap`, `obsm/X_draw_graph_fa`, `obsm/X_pca`, `obsm/X_pca_harmony`, `obsm/DM_EigenVectors` | embeddings; any two columns can be plot axes |
| `uns/DM_EigenValues` | diffusion eigenvalues (for the multiscale diffusion space) |

#### Example cells and genes

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

### Added by `make_annzarro_store.py`

Fields are named for what they hold, not for a figure of the paper. The full table, with shapes, dtypes, chunking and
colours, is `FIELDS.md` next to the store (in the Zenodo record), and is also stored in `uns/README`.

#### Cell x cell

Used in {doc}`../tutorials/cell-similarity`; paper figure: {doc}`../paper/cell-by-cell`.

| Slot and key | What it is | Use in the app | Checked against the paper |
|---|---|---|---|
| `obsp/diffusion_distance` | Dense 8,090 x 8,090 Euclidean distance in Palantir's multiscale diffusion space {cite:p}`setty2019` | Focused cell's row as a colour, or as an axis (cell by cell, b) | Plasma cell row vs `umap_distance` row: Spearman ρ = 0.62 |
| `obsp/umap_distance` | Dense Euclidean distance on `X_umap` | x axis of cell by cell, b | |
| `obsm/X_diffusion` | The multiscale diffusion space itself, 39 components: `DM_EigenVectors[:, 1:40]` scaled by λ/(1 − λ) | Alternative coordinates | |
| `obs/plasma_groups` | The focused plasma cell's discordant groups: near in UMAP but far in diffusion (265 cells), and the reverse (392 cells) | Colour (cell by cell, b and c) | 265 / 392 cells. Walk mass 0.09% / 59.2%. |
| `obs/plasma_focus` | The plasma cell `Mature_Mid_1#GCCATGGAGTATGATG-1` | Filter, or find the cell | |
| `obs/umap_dist_to_plasma`, `obs/diffusion_dist_to_plasma` | That cell's two distance rows as columns | Axes, where an obsp row cannot be chosen | |
| `obs/trajectory_path_cell`, `obs/trajectory_path_step`, `obs/trajectory_focus_cells` | The 13 cells of the HSC to monocyte path, their order, and the four focus cells (HSC, LMPP, GMP, monocyte) | Find and focus the cells of cell by cell, a | Same four cells and path cell types |

The kNN graph (`obsp/connectivities`, `obsp/distances`) and Palantir's kernel were already sparse
CSR matrices in the original store, so they serve as the sparse examples.

#### Gene x gene

Used in {doc}`../tutorials/gene-similarity`; paper figure: {doc}`../paper/gene-by-gene`.

| Slot and key | What it is | Use in the app | Checked against the paper |
|---|---|---|---|
| `var/rho_fc_H2-Q7`, `var/rho_fc_H2-Aa`, `var/rho_fc_S100a9` | That gene's row of `varp/spearman_fold_change`, as a column | Gene-plot axis (the varp row itself already works as a colour) | H2-Q7's top partners: H2-Q6 0.82, Tapbpl 0.73, H2-D1 0.66, Fxyd5 0.65, Sec62 0.63 |
| `var/rho_smoothed_H2-Q7` | H2-Q7's row of `varp/spearman_smoothed` | x axis of gene by gene, d | |
| `var/gene_module_k3` | Average-linkage modules on 1 − ρ for the 190 DE genes, k = 3 (silhouette maximum); NA for other genes | Colour (gene by gene, c) | Modules of 87, 68 and 35 genes |
| `var/rho_rank_H2-Q7`, `var/rho_rank_S100a9` | Rank of each DE gene by ρ with the focus gene | x axis of the ranked strips in gene by gene, c | H2-Q7 in-module median ρ 0.16 |
| `var/h2q7_correlation_class` | Shares the age response (fold-change ρ > 0.5), shares the cell-state pattern only (smoothed ρ > 0.7, fold-change ρ < 0.5), or other | Colour (gene by gene, d) | 35 and 192 genes |

#### Cells and genes

Used in {doc}`../tutorials/cells-and-genes`; paper figure: {doc}`../paper/cells-and-genes`.

| Slot and key | What it is | Use in the app | Checked against the paper |
|---|---|---|---|
| `layers/kompot_de_Young_to_Old_fold_change_zscores` | Fold change divided by Kompot's per-cell standard deviation, sqrt(σ²_Young + σ²_Old) {cite:p}`otto2025kompot` | Colour any gene by signal over noise; \|z\| > 1.96 as the noise level of cells and genes, d | 120 DE genes beyond 1.96 in the HSC, 13 in the monocyte. Apoe is the only opposite-direction gene beyond it in both. |
| `var/hsc_fold_change`, `var/monocyte_fold_change` | The two cells' rows of the fold-change layer | Axes of cells and genes, d | Apoe +0.94 / −0.35 |
| `var/hsc_fold_change_z`, `var/monocyte_fold_change_z` | The same rows of the z-score layer | Filter the gene table by noise level | |
| `var/hsc_vs_monocyte_direction` | DE genes with the same or opposite sign in the two cells | Colour (cells and genes, d) | 129 same, 61 opposite |

The z-score layer is not new to Kompot. It is the layer Kompot writes when it is run with
`StorageSettings(store_additional_stats=True)`. The demo run did not store it. The build script
recomputes it from the stored fold change and per-cell standard deviations, without
rerunning Kompot. A Kompot rerun with that setting confirmed the values to float32 precision.

#### Gene statistics and 3-D UMAP

Used in gene plots wherever a panel needs "this gene in that cell type" or "this gene in that age
group" as a number. The fractions are taken from `layers/raw_counts`; the build checks that the same entries are non-zero
in `layers/logged_counts`.

| Slot and key | What it is | Use in the app |
|---|---|---|
| `obsm/X_umap_3d` | 3-D UMAP of the stored kNN graph: `scanpy.tl.umap(n_components=3, min_dist=0.5, spread=1.0, random_state=42)` on `obsp/connectivities`, the same `a` and `b` as `X_umap` (checked in the build). Parameters and package versions are in `uns/umap_3d`. | Cell plot with **3D Plot**, or X, Y and Z from `obsm`; opens in 3D by itself when chosen as the plot's coordinates |
| `varm/mean_by_celltype` | Mean `logged_counts` per gene in each of the 31 `highres_celltype` levels. Stored as a DataFrame whose columns are the cell-type names, in category order (also in `uns/mean_by_celltype_categories`). | Gene plot with one cell type per axis, e.g. HSC vs neutrophil |
| `varm/fraction_expressing_by_celltype` | Fraction of cells with a raw count > 0, per gene and `highres_celltype` level. Same columns and order (`uns/fraction_expressing_by_celltype_categories`). | Gene plot axes or colour: how widely a gene is expressed in each type |
| `varm/mean_by_age`, `varm/fraction_expressing_by_age` | The same two statistics per `obs/Age` group: Young, Mid, Old (`uns/mean_by_age_categories`, `uns/fraction_expressing_by_age_categories`) | Gene plot with Young against Old |
| `var/detection_rate` | Fraction of all cells with a raw count > 0 | Filter or axis in the gene table |
| `var/variance_logged` | Variance of `layers/logged_counts` over all cells (ddof = 1) | Filter or axis in the gene table |

```{note}
`var/n_cells_by_counts`, `mean_counts` and `pct_dropout_by_counts` come from the source h5ad and
were computed before cells were filtered: `n_cells_by_counts` reaches 8,139 although the store
has 8,090 cells. `var/detection_rate` is computed from the cells in the store.
```

New categorical columns get colours in `uns/<column>_colors`, taken from the paper's palette.

The added fields look like this in the app:

```{figure} ../_static/screens/data/showcase-plasma.png
:class: screenshot
:alt: Two cell plots. Left, x is obsp umap_distance and y is obsp diffusion_distance for the focused plasma cell, points coloured by plasma_groups. Right, X_umap coloured by the same groups.

Panels b and c of the paper's cell-by-cell figure, rebuilt from the store. Left: the focused plasma cell's rows of
`obsp/umap_distance` (x) and `obsp/diffusion_distance` (y), chosen as axes. Right: `X_umap`.
Both are coloured by `obs/plasma_groups` with the colours stored in `uns`. Orange: near in
UMAP, far in diffusion (265 cells). Blue: the reverse (392 cells).
```

## How the added fields are built

{download}`make_annzarro_store.py <../_tools/make_annzarro_store.py>` (in this repository's
`docs/_tools/`) reads `bm_aging.zarr` and needs anndata, zarr, scipy, scikit-learn, pandas and
scanpy (with umap-learn, for the 3-D UMAP):

```bash
python docs/_tools/make_annzarro_store.py --src bm_aging.zarr --dst bm_aging_annzarro.zarr
```

- **Exact copies of the paper's analysis.** Each figure field is computed with the code of the
  paper's figure scripts, copied into the build script, which checks the paper's numbers: counts
  and gene lists exactly, decimals to the precision the paper prints them, since the last digits
  differ between platforms. If any one does not reproduce, the build stops and prints the value
  it got.
- **The base store is untouched.** Its arrays are cloned unchanged. Only `obs`, `var`, `uns` and
  the consolidated metadata are rewritten, with the new columns appended, and the new arrays are
  added.
- **The field list is written into the store.** The script generates `FIELDS.md` next to the
  store, with shapes, dtypes and chunking read back from the store, and appends it to `uns/README`
  after the original dataset note.

It runs in about 25 seconds on an Apple-silicon laptop. The two 8,090² distance matrices and the
3-D UMAP take most of that. The store comes to 5,741,994,795 bytes: 0.96 GB more than
`bm_aging.zarr`. Most of that is the z-score layer (493 MB) and the two distance matrices
(about 210 MB each).

The new dense arrays follow the chunk rule from {doc}`chunking`:

- cells x genes chunks of (499, 1003), aspect about n_obs/n_vars at about 5 x 10⁵ values;
- `obsp` chunks of whole rows (62, 8090), so one focused cell's row is one or two chunk reads.

The arrays copied from `bm_aging.zarr` keep their (1024, 1024) chunks.

On macOS the copy is an APFS clone, so it takes no extra space until the copy changes.

## Spatial demo

The bone-marrow data have no spatial coordinates, and we do not make any up. To show spatial
positions as plot axes (see {doc}`../user-guide/spatial-coordinates`), a second small store,
`spatial_demo.zarr`, holds a public 10x Genomics Visium section of the anterior sagittal
mouse brain {cite:p}`tenx_visium_mouse_brain_anterior`. It is processed with scanpy
{cite:p}`wolf2018`.

| | |
|---|---|
| Source | 10x Genomics, Mouse Brain Serial Section 1 (Sagittal-Anterior), Space Ranger 1.1.0, sample `V1_Mouse_Brain_Sagittal_Anterior` ([dataset page](https://www.10xgenomics.com/datasets/mouse-brain-serial-section-1-sagittal-anterior-1-standard-1-1-0)) |
| Licence | CC BY 4.0. Reuse requires attribution to 10x Genomics. |
| Spots x genes | 2,693 spots (of 2,695; those with ≥ 500 counts) x 2,000 highly variable genes |
| Size | 76 MB |

Processing: genes detected in ≥ 10 spots; normalised to 10⁴ counts per spot and log1p; 2,000
highly variable genes (Seurat flavour); 30 principal components; 15-nearest-neighbour graph;
UMAP; Leiden clustering (resolution 0.8, 20 clusters).

| Slot and key | What it holds |
|---|---|
| `obsm/spatial` | Spot centres in full-resolution image pixels. This is the Space Ranger convention: y grows downwards. |
| `obsm/spatial_upright` | (x, −y), so the section appears upright in a plot |
| `obsm/X_umap`, `obsm/X_pca`, `obs/leiden` | Embeddings and clusters (colours in `uns/leiden_colors`) |
| `X`, `layers/log_normalized` | Log-normalised expression, dense. The layer copy exists because AnnZarro's plot sources list layers, not `X`. |
| `layers/counts` | Raw UMI counts, CSR sparse |
| `obsp/spatial_kernel` | Dense Gaussian kernel on spot distance. σ = 200 µm (two spot pitches), zero beyond 3σ, rows sum to 1. A median of 120 spots are non-zero per row. |
| `obsp/spatial_distance` | Dense spot-to-spot distance in µm. The pixel scale is calibrated on the 100 µm spot pitch. |
| `obsp/connectivities`, `obsp/distances` | Expression kNN graph, CSR sparse |
| `varp/spearman_hvg` | Spearman correlation of the 2,000 genes across spots, dense 2,000² |
| `uns/source` | Source URL, licence, citation and processing parameters |

```{figure} ../_static/screens/data/spatial-demo.png
:class: screenshot
:alt: Three cell plots of the spatial demo with spatial_upright as axes, coloured by Leiden cluster, by Penk expression, and by the spatial_kernel row of the focused spot.

The spatial demo with `obsm/spatial_upright` as both axes. Left: Leiden clusters. Middle: Penk,
a striatal marker, from `layers/log_normalized`. Right: the focused spot's row of
`obsp/spatial_kernel`. The focused spot is ringed in all three.
```

```{figure} ../_static/screens/data/spatial-kernel-umap.png
:class: screenshot
:alt: Left, the spatial_kernel row on spatial coordinates; right, the same row on the UMAP of the spots.

The same kernel row on the section (left) and on the expression UMAP (right). The spots around
the focused spot in the tissue fall in one region of the UMAP, but not all of them next to it.
```

```{note}
Cell plots fill their tile and do not keep equal x and y scales. Spatial positions therefore
stretch with the tile's shape. Make the tile roughly square, as in these screenshots, to keep
the section's proportions.
```

Build it (the download is 28 MB and is cached in the `--download-dir`):

```bash
python docs/_tools/make_spatial_demo.py --out spatial_demo.zarr --download-dir _downloads
```

The build takes about 10 seconds after the download.

## Regenerate the screenshots

```bash
.venv-docs/bin/python docs/_tools/shoot_showcase.py --port 8813
```

The views are in `docs/_tools/views/showcase-*.json`. Each is a deep-link `view` object
({doc}`../reference/deep-links`).
