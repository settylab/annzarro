# Fig. 1 · Focus model, slot map and comparison

```{figure} ../_static/figures/paper/fig1.png
:alt: Three panels. a, the focus model: the focused cell selects its row of cells x cells (obsp) and of cells x genes (X and layers), the focused gene its column of cells x genes and its row of genes x genes (varp); each colours a cell or gene scatter, and the server reads only the chunks of that row or column. b, the AnnData slot map with the focused cell as a blue row and the focused gene as an orange column through every cell- or gene-indexed array. c, a feature table comparing AnnZarro with CELLxGENE, Vitessce, Cirrocumulus, iSEE, UCSC Cell Browser, ShinyCell and Scanpy or Seurat code.
:width: 100%

Fig. 1 of the AnnZarro paper (Otto, Baasri and Setty, in preparation): **a**, the focus model;
**b**, the AnnData slots behind it; **c**, AnnZarro compared with other viewers
(`manuscript/figures/fig1_overview.pdf` in the paper repository).
```

(fig1a-focus-model)=
## a · The focus model

The focused cell selects rows of the cells × cells and cells × genes matrices; the focused gene
selects a column of cells × genes and a row of genes × genes. Each scatter is coloured by the
selected vector, and clicking a point moves the focus. The figure is a diagram; the tutorial
{doc}`../tutorials/tour` builds it as a live 2 × 2 layout on `bm_aging.zarr`, one panel per
arrow that ends in a scatter, and moves the focus through it.

| Part of the diagram | In AnnZarro | Tutorial section |
|---|---|---|
| focused cell → cells × cells (obsp) → cell scatter | live: `obsp/diffusion_walk_t5` row as colour | {ref}`tut-tour-cell-row` |
| focused cell → cells × genes → gene scatter | live: the cell's row of `layers/kompot_de_Young_to_Old_fold_change` | {ref}`tut-tour-four-arrows` |
| focused gene → cells × genes → cell scatter | live: the gene's column of the same layer | {ref}`tut-tour-four-arrows` |
| focused gene → genes × genes (varp) → gene scatter | live: `varp/spearman_fold_change` row as colour | {ref}`tut-tour-four-arrows` |
| clicking a point moves the focus | live | {ref}`tut-tour-clicks`, {ref}`tut-tour-four-arrows` |
| (not drawn) lock one panel while the focus moves | live | {ref}`tut-tour-lock` |
| server reads only the chunks of that row or column | not shown in the app | {doc}`fig7-performance` |

### Differences from panel a

- **The server band** ("reads only the chunks holding that row or column") has no on-screen
  counterpart. Each click costs one request per recoloured panel, visible in the browser's
  developer tools (Network tab); {doc}`fig7-performance` measures bytes and time per click.
- **Spatial coordinates.** The diagram's cell scatter says "embedding, spatial"; the tutorial uses
  the UMAP. Any obsm matrix, including spatial positions, works as axes the same way
  ({doc}`../user-guide/spatial-coordinates`).
- **Lock** is not in the diagram but is part of the same model: a locked panel keeps its slice
  while the focus moves on.

### Views

The links are ready for a local server with the store in its data directory; to use another
server address or a store elsewhere, see {ref}`tut-start-links`.

::::{dropdown} The four panels of the focus model
```{literalinclude} ../_static/panelsets/paper/fig1-focus-model.url.txt
:language: text
```
::::

Panel set: {download}`fig1-focus-model.json <../_static/panelsets/paper/fig1-focus-model.json>`;
view JSON: {download}`fig1-focus-model.view.json <../_tools/views/fig1-focus-model.json>`.
Loading it restores the dataset, the focus and the split layout, like the link
({ref}`tut-tour-load-file`).

(fig1b-slot-map)=
## b · The slot map

Every view reads one AnnData slot, and each click reads one slice of it. What to store in
each slot, and what the demonstration store contains, is in {doc}`../data/slot-map`. Choosing
a slot for a plot's axes or colour (the type, key and column dropdowns) is in
{doc}`../user-guide/cell-and-gene-plots`. The `layer` type lists `X` first, then the arrays
under `layers/`, so the main matrix is a source like any layer.

The panels below put each slot on screen once on `bm_aging.zarr`, with the focused cell
`HSPC_Old_1#GAAGCCCGTGGCTCTG-1` and the focused gene `H2-Q7`. The settings of each are in
`docs/_tools/views/fig7-slot-*.json` and `docs/_tools/shoot_figs79.py` (both named after the
slot map's earlier figure number).

::::{grid} 1 2 2 2
:gutter: 2

:::{grid-item}
```{figure} ../_static/screens/paper/slot-obsm-obs.png
:class: screenshot
:alt: UMAP coloured by cell type with the stored category colours.

**obsm, obs, uns.** X/Y `obsm` `X_umap`; Color `obs` `highres_celltype`, colours from
`uns['highres_celltype_colors']`.
```
:::

:::{grid-item}
```{figure} ../_static/screens/paper/slot-obs-axes.png
:class: screenshot
:alt: Cells plotted by their young and old Kompot log density, coloured by log fold change.

**obs as axes.** X `obs` `kompot_da_Young_log_density`, Y `obs` `kompot_da_Old_log_density`;
Color `obs` `kompot_da_Young_to_Old_lfc`.
```
:::

:::{grid-item}
```{figure} ../_static/screens/paper/slot-obsp.png
:class: screenshot
:alt: UMAP in grey with a blue patch around the focused stem cell.

**obsp row.** Color `obsp` `diffusion_walk_t5`, "Focused cell …": the focused cell's row.
```
:::

:::{grid-item}
```{figure} ../_static/screens/paper/slot-layer-gene.png
:class: screenshot
:alt: UMAP coloured by the Young to Old fold change of H2-Q7.

**layer column.** Cell Plot, Color `layer` `kompot_de_Young_to_Old_fold_change`, "Focused
gene H2-Q7".
```
:::

:::{grid-item}
```{figure} ../_static/screens/paper/slot-layer-cell.png
:class: screenshot
:alt: Kompot volcano coloured by each gene's fold change in the focused cell.

**layer row, var axes.** Gene Plot, X/Y `var` Kompot mean LFC and Mahalanobis distance;
Color `layer` fold change, "Focused cell …".
```
:::

:::{grid-item}
```{figure} ../_static/screens/paper/slot-varm.png
:class: screenshot
:alt: Genes plotted by their PC1 and PC2 loadings.

**varm.** X/Y `varm` `PCs` `0` and `1`; Color `var` Mahalanobis distance. The 12,214 genes
outside the PCA have zero loadings and sit at the origin.
```
:::

:::{grid-item}
```{figure} ../_static/screens/paper/slot-varp.png
:class: screenshot
:alt: Kompot volcano coloured by Spearman correlation to H2-Q7.

**varp row.** Color `varp` `spearman_fold_change`, "Focused gene H2-Q7", range locked at
−1 to 1.
```
:::
::::

(fig1c-comparison)=
## c · Comparison with other viewers

Panel c compares AnnZarro with CELLxGENE, Vitessce, Cirrocumulus, iSEE, UCSC Cell Browser,
ShinyCell and analysis code in Scanpy or Seurat, one column per capability, grouped into
relationships, data, work, sharing and deployment. The shaded relationship columns are what
AnnZarro adds: a stored cells × cells or genes × genes matrix becomes a colour or an axis, and
the focused cell or gene picks which row every linked panel shows. The table also records what
AnnZarro does not do: annotation editing, differential expression on the fly, tissue image
underlays and a static-site mode. It is not an AnnZarro view and has no walkthrough here. The
source behind every cell of the table is listed in the paper's companion repository
(`figures/COMPARISON_NOTES.md` in settylab/annzarro-paper, checked October 2026).
