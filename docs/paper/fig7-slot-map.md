# Fig. 7: which stored array drives which view

```{figure} ../_static/figures/paper/fig7.png
:alt: AnnData slot map with the focused cell as a horizontal band and the focused gene as a vertical band.
:width: 100%

Paper Fig. 7. An AnnData object laid out around its cells × genes matrix. A click on a cell
selects one row (blue) of every cell-indexed array; a click on a gene selects one column
(orange) of every gene-indexed array. AnnZarro fetches only these slices.
```

The figure is a map, not a screenshot, so reproducing it means putting each array on screen
once. For the same map from the data-preparation side (what to store in each slot), see
{doc}`../data/slot-map`. This guide does that on `bm_aging.zarr`: one panel per slot, each with the dropdown
values that produce it. The focused cell is the old haematopoietic stem cell
`HSPC_Old_1#GAAGCCCGTGGCTCTG-1` and the focused gene is `H2-Q7`, as in the rest of the paper.

## The three dropdowns

Every plot axis and the colour of a plot are set with the same row of three dropdowns in the
panel's controls: **type** (the AnnData slot), **key** (the array or column inside it) and
**column** (which slice of that array). Open a panel's controls with the chevron
("Toggle Controls") in its header.

```{figure} ../_static/screens/paper/slot-obsp-controls.png
:class: screenshot
:alt: Controls of a cell plot: X-Axis obsm X_umap 0, Y-Axis obsm X_umap 1, Color obsp diffusion_walk_t5 "Focused cell to HSPC_Old_1#...".
:width: 75%

Controls of a cell plot coloured by a row of obsp. The third Color dropdown is not a list of
columns: it follows the focused cell, and the padlock next to it holds the current one.
```

The type dropdown offers only the slots that a given plot can use:

| Panel | type choices | What the third dropdown means |
|---|---|---|
| Cell Plot | `obs`, `obsm`, `obsp`, `layer` | obs: none (N/A); obsm: one column of the matrix; obsp: "Focused cell to …", the focused cell's row; layer: "Focused gene …", the focused gene's column |
| Gene Plot | `var`, `varm`, `varp`, `layer` | var: none (N/A); varm: one column; varp: "Focused gene to …", the focused gene's row; layer: "Focused cell …", the focused cell's row |

Colour additionally offers "None (constant)". When a dropdown follows the focus, clicking
another point re-reads that one slice and recolours the plot. The padlock button beside it
locks the slice to the current cell or gene, so that panel keeps it while the focus moves on
(see {doc}`../user-guide/focus-and-lock`).

## Slot by slot

To build any of the panels below: choose `bm_aging.zarr` in the **Dataset** dropdown of the
header, click **Cell Plot** or **Gene Plot** in the "add a panel" tile, open the new panel's
controls with its chevron, and set the dropdowns as listed. To set the focus without
clicking, pick the name in the **Focused Gene** or **Focused Cell** dropdown in the header.

### obsm and obs: cell plot axes and colours

1. Add a **Cell Plot**.
2. **X-Axis**: `obsm`, `X_umap`, `0`. **Y-Axis**: `obsm`, `X_umap`, `1`. Any obsm matrix
   works the same way (`X_draw_graph_fa`, `X_pca`, `DM_EigenVectors`, or spatial positions in
   a spatial dataset; see {doc}`../user-guide/spatial-coordinates`).
3. **Color**: `obs`, `highres_celltype`. The third dropdown shows N/A.

You should see the UMAP coloured by cell type, with the focused cell drawn as a black-ringed
dot. A categorical obs column takes its colours from `uns['highres_celltype_colors']`, so
the cell types have the colours the analysis gave them. This is the only use AnnZarro makes
of uns: it reads `uns['{key}_colors']` for category colours and does not display the rest
of uns (run records, parameters).

```{figure} ../_static/screens/paper/slot-obsm-obs.png
:class: screenshot
:alt: UMAP coloured by highres_celltype with the stored category colours.

obsm as axes, obs as colour, uns as the palette.
```

obs columns are axes too. Set **X-Axis** to `obs`, `kompot_da_Young_log_density` and
**Y-Axis** to `obs`, `kompot_da_Old_log_density`, and **Color** to `obs`,
`kompot_da_Young_to_Old_lfc`. Each cell then sits at its Kompot density in young and in old
mice; cells above the diagonal are denser in old mice and carry a positive log fold change.

```{figure} ../_static/screens/paper/slot-obs-axes.png
:class: screenshot
:alt: Cells plotted by their young and old Kompot log density, coloured by differential abundance log fold change.

obs columns as both axes and colour (Color Map RdBu, "Reverse Colormap" and "Center at 0"
on).
```

Cell tables are the other consumer of obs: their filters build the masks that a plot's
**Filter by Table** dropdown applies (see {doc}`../user-guide/tables-and-filters`).

### obsp: the focused cell's row as cell colour

1. Add a **Cell Plot** with the UMAP axes as above.
2. **Color**: `obsp`, `diffusion_walk_t5`. The third dropdown reads "Focused cell to
   HSPC_Old_1#GAAGCCCGTGGCTCTG-1".
3. In **Color Map** choose `Blues` and click **Reverse Colormap** if low values should be
   light.
4. Click any other cell. The colour now shows that cell's row of the matrix.

`bm_aging.zarr` holds five cells × cells matrices: `connectivities` and `distances` (kNN
graph), `DM_Kernel` and `DM_Similarity` (diffusion map), all four sparse, and the dense
`diffusion_walk_t5`, the 5-step diffusion walk drawn in Fig. 3.

```{figure} ../_static/screens/paper/slot-obsp.png
:class: screenshot
:alt: UMAP in grey with a blue patch around the focused stem cell, coloured by its 5-step diffusion walk.

The focused stem cell's row of `obsp/diffusion_walk_t5`: where five diffusion steps from this
cell lead. Walking the focus along a lineage is {doc}`fig3-cell-by-cell`.
```

### layers: a gene column colours cells, a cell row colours genes

A cells × genes layer is read in both directions.

**Gene column as cell colour.**

1. Add a **Cell Plot** with UMAP axes.
2. **Color**: `layer`, `kompot_de_Young_to_Old_fold_change`. The third dropdown reads
   "Focused gene H2-Q7".
3. Choose `RdBu` and click **Center at 0** so zero fold change is the neutral colour.

```{figure} ../_static/screens/paper/slot-layer-gene.png
:class: screenshot
:alt: UMAP coloured by the Young to Old fold change of H2-Q7, positive in most cells and highest around the focused stem cell.

The focused gene's column: H2-Q7 fold change, young to old, in every cell.
```

**Cell row as gene colour.**

1. Add a **Gene Plot**.
2. **X-Axis**: `var`, `kompot_de_Young_to_Old_mean_lfc`. **Y-Axis**: `var`,
   `kompot_de_Young_to_Old_mahalanobis`. This is the Kompot volcano.
3. **Color**: `layer`, `kompot_de_Young_to_Old_fold_change`. The third dropdown reads
   "Focused cell HSPC_Old_1#GAAGCCCGTGGCTCTG-1".
4. Choose `RdBu` and click **Center at 0**.

```{figure} ../_static/screens/paper/slot-layer-cell.png
:class: screenshot
:alt: Kompot volcano with each gene coloured by its fold change in the focused stem cell.

The focused cell's row: every gene's fold change in this one stem cell, over the
population-level volcano. The large red dot is the focused gene, H2-Q7.
```

```{figure} ../_static/screens/paper/slot-layer-cell-controls.png
:class: screenshot
:alt: Gene plot controls: X-Axis var kompot_de_Young..., Y-Axis var kompot_de_Young..., Color layer kompot_de_Young_to_Old_fold_change "Focused cell HSPC_Old_1#...".
:width: 75%

The controls of that panel.
```

`bm_aging.zarr` has eight layers: `kompot_de_Young_to_Old_fold_change`,
`kompot_de_Young_smoothed`, `kompot_de_Old_smoothed`, `MAGIC_imputed_data` (dense) and
`raw_counts`, `normalized_counts`, `logged_counts`, `cc_counts` (sparse). Comparing two cells
gene by gene, with one locked, is {doc}`fig5-cells-and-genes`.

```{important}
**X itself cannot be chosen.** The figure labels the central block "X, layers", but the
`layer` type lists only the arrays under `layers/`. The app has no control that reads X, so
values that exist only in X are not reachable from a plot. In `bm_aging.zarr`, X holds scaled
expression that no layer duplicates. To show it, copy it into a layer before writing the
store, for example `adata.layers["scaled"] = adata.X`, and see
{doc}`../data/preparing-a-store`.
```

### var and varm: gene plot axes

var columns are the volcano axes above. varm matrices give gene plots further axes, one
matrix column per axis:

1. Add a **Gene Plot**.
2. **X-Axis**: `varm`, `PCs`, `0`. **Y-Axis**: `varm`, `PCs`, `1`.
3. **Color**: `var`, `kompot_de_Young_to_Old_mahalanobis`, Color Map `Viridis`.

Each gene sits at its loading on the first two principal components, coloured by its Kompot
Mahalanobis distance. `PCs` has non-zero loadings only for the 4,071 highly variable genes
used in the PCA; the other 12,214 genes have all-zero rows and sit together at the origin.

```{figure} ../_static/screens/paper/slot-varm.png
:class: screenshot
:alt: Genes plotted by their PC1 and PC2 loadings, coloured by Mahalanobis distance.

varm as gene axes: PCA loadings.
```

Per-group statistics, such as mean expression per cell type, are the more common varm
content and the one the paper's figure names. `bm_aging.zarr` has none; this snippet stores
one as a DataFrame so each cell type becomes a named column in the varm dropdown (checked
against the server's `varm_dataframe_columns` route with anndata 0.12):

```python
import numpy as np
import pandas as pd

layer = adata.layers["kompot_de_Young_smoothed"]
cats = adata.obs["highres_celltype"].cat.categories
adata.varm["mean_by_celltype"] = pd.DataFrame(
    {ct: np.asarray(layer[(adata.obs["highres_celltype"] == ct).to_numpy()].mean(axis=0)).ravel()
     for ct in cats},
    index=adata.var_names,
)
```

Then a Gene Plot with **X-Axis** `varm`, `mean_by_celltype`, `HSC` and **Y-Axis** `varm`,
`mean_by_celltype`, `GMP` compares two cell types gene by gene.

### varp: the focused gene's row as gene colour

1. Add a **Gene Plot** with the volcano axes.
2. **Color**: `varp`, `spearman_fold_change`. The third dropdown reads "Focused gene to H2-Q7".
3. Choose `RdBu`, type `-1` and `1` into **Min** and **Max**, and click **Lock Range** so the
   scale stays at −1 to 1 when the focus moves.
4. Click a red gene to move the focus along the module.

```{figure} ../_static/screens/paper/slot-varp.png
:class: screenshot
:alt: Kompot volcano coloured by Spearman correlation of fold change to H2-Q7, from blue -1 to red 1.

The focused gene's row of `varp/spearman_fold_change`: correlation of every gene's fold
change with H2-Q7's.
```

```{figure} ../_static/screens/paper/slot-varp-controls.png
:class: screenshot
:alt: Gene plot controls with Color varp spearman_fold_change "Focused gene to H2-Q7" and Lock Range active.
:width: 75%

The controls of that panel.
```

`bm_aging.zarr` has two genes × genes matrices, `spearman_fold_change` and
`spearman_smoothed`. Using them as a module browser is {doc}`fig4-gene-by-gene`.

## What one click reads

Each panel above reads one slice per focus change, never a whole matrix: a row of obsp or
varp, a column or a row of a layer, or one column of obs, obsm, var or varm. How many bytes
and milliseconds that costs is in {doc}`fig9-performance`. How the chunk layout of each array
decides that cost is in {doc}`../data/chunking`.

## Regenerating the screenshots

The panels on this page are deep-link views saved as `docs/_tools/views/fig7-*.json` in the
AnnZarro repository; `docs/_tools/shoot_figs79.py` opens each one and crops its tile. To open
one yourself, encode it as described in {doc}`../reference/deep-links`.
