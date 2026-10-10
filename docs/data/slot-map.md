# Slot map: which stored array drives which view

AnnZarro computes nothing. Every number on screen is a slice of an array that is already in
the AnnData store, and every click fetches exactly one slice per panel: one **row** for the
focused cell, one **column** for the focused gene. Deciding what to store is therefore the
whole of the experimental design. This page maps each AnnData slot to the views it feeds.

```{figure} ../_static/figures/slot-map.svg
:alt: An AnnData object laid out around its cells x genes matrix. The focused cell is a blue horizontal band through obsp, obsm, obs and X/layers; the focused gene is an orange vertical band through X/layers, var, varm and varp. Their crossing in X/layers is one value.
:width: 100%
:target: ../_static/figures/slot-map.svg

**Which stored array drives which view** (paper overview figure, panel b; {ref}`overview-slot-map`). A click on a cell selects one row
(blue) of every cell-indexed array; a click on a gene selects one column (orange) of every
gene-indexed array. AnnZarro fetches only these slices. The notes name the paper
figures that use each slot: {doc}`../paper/cell-by-cell`, {doc}`../paper/gene-by-gene` and
{doc}`../paper/cells-and-genes`.
```

## The two focus rules

- **Focused cell = a row.** It selects row *i* of every array indexed by cells first: a row of
  each `obsp` matrix (cells × cells) and a row of `X` or a layer (cells × genes).
- **Focused gene = a column, or a row of varp.** It selects column *j* of `X` or a layer and
  row *j* of each `varp` matrix (genes × genes).

The rest (`obs`, `obsm`, `var`, `varm`) does not depend on the focus. Those columns are read
once per panel and reused while you click.

## Slot by slot

| Slot | Shape | What AnnZarro reads | Drives | Typical content |
|---|---|---|---|---|
| `obsm[key]` | cells × k | one column per axis | Cell Plot X, Y, Z; colour; hover | `X_umap`, diffusion components, spatial positions |
| `obs[col]` | cells | the whole column | Cell Plot colour and hover; Cell Table columns and filters | cell type, condition, Kompot DA z-score |
| `obsp[key]` | cells × cells | **row of the focused cell** | Cell Plot colour (or an axis) | kNN `connectivities`, `distances`, diffusion kernel, a dense walk |
| `layers[key]` | cells × genes | **column of the focused gene** in a Cell Plot; **row of the focused cell** in a Gene Plot | expression or fold change on the embedding; a cell's profile over genes | `logged_counts`, Kompot `*_fold_change`, `*_smoothed` |
| `var[col]` | genes | the whole column | Gene Plot axes and colour; Gene Table | Kompot `mean_lfc`, `mahalanobis`, `is_de` |
| `varm[key]` | genes × k | one column per axis | Gene Plot axes; Gene Table | per-group statistics, gene embeddings |
| `varp[key]` | genes × genes | **row of the focused gene** | Gene Plot colour (or an axis) | Spearman correlation of fold changes or smoothed expression |
| `uns['{col}_colors']` | categories | the whole list | category colours for `obs[col]` | written by scanpy plotting functions |

```{important}
**Store what you want to colour by in `X` or `layers`.** Both are offered in both plot types,
for gene columns and cell rows: the **layer** source lists `X` first, then the layers (Cell Plot
sources: obs, obsm, obsp, layer; Gene Plot sources: var, varm, varp, layer; the same for every
axis and the colour). If the store also has a layer named `X`, that layer is listed instead of
the matrix `X`.
```

## Required and optional

A store opens in AnnZarro when it is a valid AnnData zarr store (or a local `.h5ad`) with
`obs` and `var`. Everything else is optional; a slot that is absent simply does not appear in
the source menus.

| Needed for | Store |
|---|---|
| any Cell Plot | at least one 2-column array in `obsm` (or two numeric `obs` columns) |
| any Gene Plot | numeric columns in `var` (the Gene Plot's default source is varm; switch it to var when the store has no varm) |
| colouring cells by a gene | a cells × genes matrix in `layers` |
| colouring cells by a cell | a cells × cells matrix in `obsp` |
| colouring genes by a gene | a genes × genes matrix in `varp` |
| colouring genes by a cell | a cells × genes matrix in `layers` (read by row) |
| fixed category colours | `uns['{col}_colors']`, one colour per category, in category order |

## Data types

What the server sends depends on the stored dtype, never on a guess:

| Stored | Sent to the browser | Notes |
|---|---|---|
| float32 | float32 | the recommended dtype for every dense array |
| float64 | float32 when every value survives the round trip, otherwise float64 | `obs` z-scores from Kompot stay float64; counts stored as float64 travel as float32 |
| integers below 2²⁴ | float32 | larger integers go as float64 |
| categorical, string, boolean `obs`/`var` columns | JSON, with a `categories` list for categoricals | used for colours, hover text and table filters |
| sparse CSR / CSC (`encoding-type` `csr_matrix` / `csc_matrix`) | the requested row or column, densified, then sent sparse when that is smaller | see {doc}`chunking` for which direction is cheap |
| dataframe-valued `obsm` / `varm` | one column at a time | e.g. CITE-seq `obsm/AbCapture` |

The exact byte layout is in {doc}`../reference/wire-format`.

## What the demonstration store contains

`bm_aging_annzarro.zarr` (8,090 cells × 16,285 genes; {doc}`demo-data`) fills every slot that matters:

- `obsm`: `X_umap` and `X_umap_3d`, `X_diffusion`, `X_draw_graph_fa`, `DM_EigenVectors`, three PCA
  variants, and the dataframe-valued `AbCapture` and `HTO`.
- `obs`: cell types (`highres_celltype`, `midres_celltype`), `Age`, Kompot differential
  abundance columns ({doc}`kompot`), and the precomputed cell columns of {doc}`demo-data`.
- `obsp`: the sparse `connectivities`, `distances`, `DM_Kernel`, `DM_Similarity`, and the dense
  `diffusion_walk_t5` added in {doc}`pairwise-matrices`, plus the dense `diffusion_distance` and
  `umap_distance`.
- `layers`: dense float32 `kompot_de_Young_to_Old_fold_change`, its z-score version
  `kompot_de_Young_to_Old_fold_change_zscores`, `kompot_de_Young_smoothed`,
  `kompot_de_Old_smoothed`, `MAGIC_imputed_data`; sparse `logged_counts`, `normalized_counts`,
  `raw_counts`, `cc_counts`.
- `var`: Kompot differential expression statistics, `detection_rate`, `variance_logged` and the
  precomputed gene columns of {doc}`demo-data`.
- `varm`: DataFrames of per-cell-type and per-age statistics: `mean_by_celltype`,
  `fraction_expressing_by_celltype`, `mean_by_age`, `fraction_expressing_by_age`; and `PCs`.
- `varp`: `spearman_fold_change` and `spearman_smoothed` (16,285 × 16,285, dense float32).
- `X`: scaled expression (z-scores) stored as CSC, offered as **X** under the layer source (see above).

You can list the same thing for any store with the structure endpoint:

```console
$ curl -s "http://127.0.0.1:8812/api/v1/data/dataset_structure?dataset_path=$PWD/bm_aging_annzarro.zarr" \
    | python -c "import json,sys; d=json.load(sys.stdin); print({k: d[k].get('keys') for k in ('layers','obsp','varp')})"
{'layers': ['cc_counts', 'kompot_de_Old_smoothed', 'kompot_de_Young_smoothed', 'kompot_de_Young_to_Old_fold_change', 'kompot_de_Young_to_Old_fold_change_zscores', 'logged_counts', 'MAGIC_imputed_data', 'normalized_counts', 'raw_counts'], 'obsp': ['connectivities', 'diffusion_distance', 'diffusion_walk_t5', 'distances', 'DM_Kernel', 'DM_Similarity', 'umap_distance'], 'varp': ['spearman_fold_change', 'spearman_smoothed']}
```

## In the app

Each source menu in a plot's controls has the same three parts: the **slot** (obs, obsm,
obsp, layer, var, varm, varp), the **key** in it, and the **column** or row. For obsp, varp
and layer the third menu follows the focus ("Focused gene …", "Focused cell …") unless the
lock next to it pins one cell or gene. Shown on `bm_aging_annzarro.zarr`:

::::{grid} 1 1 2 2
:gutter: 2

:::{grid-item}
```{figure} ../_static/screens/paper/slot-obsp.png
:class: screenshot
:alt: UMAP with all cells grey except a blue neighbourhood around the focused stem cell, coloured by its row of obsp/diffusion_walk_t5.

**obsp row.** Colour = obsp `diffusion_walk_t5`, row of the focused stem cell.
```
:::

:::{grid-item}
```{figure} ../_static/screens/paper/slot-layer-gene.png
:class: screenshot
:alt: UMAP coloured by the fold change of H2-Q7, mostly red (up with age), blue in one small cluster.

**Layer column.** Colour = layer `kompot_de_Young_to_Old_fold_change`, column of the focused
gene H2-Q7.
```
:::

:::{grid-item}
```{figure} ../_static/screens/paper/slot-varp.png
:class: screenshot
:alt: Volcano of Kompot mean log fold change against Mahalanobis distance, genes coloured by Spearman correlation with H2-Q7.

**varp row.** Gene Plot with var axes (the volcano), colour = varp `spearman_fold_change`, row
of the focused gene H2-Q7.
```
:::

:::{grid-item}
```{figure} ../_static/screens/paper/slot-varp-controls.png
:class: screenshot
:alt: Plot controls: X var kompot_de_Young..., Y var kompot_de_Young..., Color varp spearman_fold_change "Focused gene to H2-Q7" with a lock button, colour map RdBu, min -1, max 1, Lock Range on.

**The controls of that plot.** Slot, key, and "Focused gene" with its lock.
```
:::
::::

The screenshots are regenerated by `docs/_tools/shoot_figs79.py` (views in
`docs/_tools/views/fig7-*.json`), which also shoots obs, obsm, varm and cell-row layer views.

```{note}
`varm/PCs` in the demonstration store is a 16,285 × 50 loading matrix in which 12,214 genes
have all-zero loadings (genes outside the PCA's gene set). Plotted as Gene Plot axes, those
genes all sit at the origin.
```

Next: {doc}`preparing-a-store` turns an h5ad into a store laid out this way.
