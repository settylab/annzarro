# Cell plots and gene plots

A **cell plot** draws one point per cell; a **gene plot** draws one point per gene. Each has an
x axis, a y axis, an optional z axis and a colour, and each of them can come from any slot of the
AnnData store that holds one number (or one category) per point. This page lists every source,
shows how to set it, and covers the display controls. The slot map in
{doc}`../data/slot-map` shows the same sources as a diagram.

## The controls

Open a panel's controls with the chevron in its tile header.

```{figure} ../_static/screens/user-guide/plots-cell-controls.png
:class: screenshot
:alt: Cell plot controls with ten numbered parts: X-Axis type, key and column drop-downs; the Color row; 3D Plot; Highlight Focused Cell; Plot Options; Filter by Table; Size and Opacity sliders; Color Palette.

Cell plot controls, coloured by a categorical obs column.
```

1. **Type**: the AnnData slot the axis reads from.
2. **Key**: the column or matrix in that slot.
3. **Column**: which column of the matrix, or which focused row or column (see the tables below).
   For obs and var it reads "N/A".
4. **Color**: the same three drop-downs for the colour, plus **None (constant)**.
5. **3D Plot** adds a **Z-Axis (3D)** row and draws the plot in 3D. Click it again for 2D.
6. **Highlight Focused Cell** (in gene plots, **Highlight Focused Gene**) draws the focused point
   as a red dot with a black ring. On by default.
   **Refresh**, next to it, reloads the panel's data and redraws it.
7. **Plot Options** opens appearance and export settings ({doc}`export`).
8. **Filter by Table** links the plot to a table ({doc}`tables-and-filters`).
9. **Size** (0.1 to 20) and **Opacity** (0.01 to 1) of the points.
10. **Color Palette** (categorical colour) or **Color Map** and range controls (numerical colour,
    {doc}`colour-scales`).

Every change redraws the panel straight away.

## Sources for a cell plot

| Type | Key | Column | One value per cell is |
|---|---|---|---|
| `obs` | any obs column | N/A | that column |
| `obsm` | any obsm matrix (embedding, PCA, spatial positions, protein counts…) | a column name or index | that column |
| `obsp` | any obsp matrix | "Focused cell to *name*" | the focused cell's row: its value to every cell |
| `layer` | any layer | "Focused gene *name*" | the focused gene's column of the layer |

## Sources for a gene plot

| Type | Key | Column | One value per gene is |
|---|---|---|---|
| `var` | any var column | N/A | that column |
| `varm` | any varm matrix (PC loadings, per-group means…) | a column name or index | that column |
| `varp` | any varp matrix | "Focused gene to *name*" | the focused gene's row: its value to every gene |
| `layer` | any layer | "Focused cell *name*" | the focused cell's row of the layer |

All four types are available for x, y, z and colour alike. An axis that reads `obsp`, `varp` or a
`layer` follows the focus and gets the lock and refocus buttons ({doc}`focus-and-lock`); for
example, x = the focused cell's row of a UMAP distance matrix and y = its row of a diffusion
distance matrix plots every cell's distance to the focused cell in both spaces, as in
{ref}`tut-cell-distance-axes` of the tutorial {doc}`../tutorials/cell-similarity`.

```{note}
`X` itself is not offered as a source. To plot expression, store it (or a normalised copy) as a
layer, which is what {doc}`../data/preparing-a-store` does. Columns of obsm and varm with more than
ten entries are listed alphabetically.
```

## Defaults of a new panel

- A new **cell plot** uses `obsm/X_umap` (else a key starting with `X_umap`, else `X_pca`, else the
  first obsm matrix) columns 0 and 1. If that matrix has a third column the plot opens in 3D. The
  colour is `obs/leiden`, `obs/louvain` or the first obs column with "cluster" in its name, if one
  exists.
- A new **gene plot** uses the first varm matrix in the same way (on `bm_aging.zarr`, `varm/PCs`
  columns 0, 1 and 2, so it opens in 3D) and colours by `var/highly_variable` if present.
- Without obsm or varm, both fall back to two numeric annotation columns (for example
  `total_counts` and `n_genes_by_counts`).

## Examples on `bm_aging.zarr`

The four cell plots below come from the view
{download}`userguide-cell-sources.json <../_tools/views/userguide-cell-sources.json>`.

```{figure} ../_static/screens/user-guide/plots-cell-sources.png
:class: screenshot
:alt: Four cell plots. Top left, PCA 0 versus 1 coloured by total_counts. Top right, CD150 versus CD48 antibody counts coloured by MAGIC-imputed H2-Q7. Bottom left, n_genes_by_counts versus pct_counts_mt coloured by Age. Bottom right, a 3D PCA coloured by cell type.

Cell plots from four kinds of source.
```

- **Top left**: x and y = `obsm` → `X_pca` → `0` and `1`; colour = `obs` → `total_counts`
  (numerical, Viridis).
- **Top right**: x and y = `obsm` → `AbCapture` → `CD150_TotalSeqB` and `CD48_TotalSeqB` (the
  antibody counts stored as a named obsm data frame); colour = `layer` → `MAGIC_imputed_data` →
  focused gene (H2-Q7).
- **Bottom left**: both axes from `obs` (`n_genes_by_counts`, `pct_counts_mt`); colour = `obs` →
  `Age` (categorical, colours from `uns/Age_colors`).
- **Bottom right**: x, y and z = `obsm` → `X_pca` → `0`, `1`, `2`. Drag to rotate, scroll to zoom.

Gene plots work the same way. The view
{download}`userguide-gene-sources.json <../_tools/views/userguide-gene-sources.json>` has two:

```{figure} ../_static/screens/user-guide/plots-gene-sources.png
:class: screenshot
:alt: Left, a volcano plot of Kompot mean log fold change versus Mahalanobis distance coloured by Spearman correlation with H2-Q7, H2-Q7 marked at the top right. Right, genes on varm PCs 0 versus 1 coloured by the HSC's row of the fold-change layer.

Left: var × var, colour = varp row of the focused gene. Right: varm × varm, colour = layer row of
the focused cell.
```

- **Left**: x = `var` → `kompot_de_Young_to_Old_mean_lfc`, y = `var` →
  `kompot_de_Young_to_Old_mahalanobis` (a volcano plot); colour = `varp` → `spearman_fold_change`
  → focused gene (H2-Q7, the red dot at the top right).
- **Right**: x and y = `varm` → `PCs` → `0` and `1`; colour = `layer` →
  `kompot_de_Young_to_Old_fold_change` → focused cell (the HSC): each gene's fold change in that one
  cell.

## Categorical and numerical colour

AnnZarro decides per colour source whether it is categorical or numerical by looking at its first
100 values: if at least 80 % are numbers it is numerical, otherwise (strings, booleans, mostly
missing values) it is categorical.

- **Categorical**: one trace per category with a legend. **Color Palette** offers "As stored in
  adata.uns if available" (uses `uns/<key>_colors`, as scanpy writes them; the default),
  **hue** (evenly spaced hues), discrete palettes (Accent, Dark2, Paired, Pastel1, Pastel2, Set1,
  Set2, Set3, tab10, tab20, tab20b, tab20c, RetroMetro, DutchField, RiverNights, SpringPastels,
  Tableau10, Plotly), continuous palettes sampled into discrete colours (89 maps from Blues to winter,
  among them RdBu and viridis) and the ColorBrewer palettes (prefixed `chroma:`). Click a legend entry to hide that
  category; double-click it to show only that category.
- **Numerical**: a colour bar and the colour-map and range controls of {doc}`colour-scales`.

```{figure} ../_static/screens/user-guide/plots-categorical.png
:class: screenshot
:alt: A UMAP coloured by obs highres_celltype with a scrollable legend listing HSC, LMPP, GMP, Myelo P, Neutrophil and further cell types in their stored colours.

Categorical colour: `obs/highres_celltype` with the colours stored in `uns/highres_celltype_colors`.
The legend scrolls when it has more entries than fit.
```

```{warning}
A numeric column whose first 100 values are mostly missing is treated as categorical, with one
legend entry per distinct value. For example `var/fig4c_rank_H2-Q7` in
`bm_aging_showcase.zarr` (189 values, NaN for the other 16,096 genes) draws as 190 categories.
Until this is fixed, sort such a column so that values come first, or fill the missing values
before writing the store.
```

## Hover

Hovering a point shows its name, its x and y (and z) values, and for numerical colour its value
`c`; for categorical colour the category. These fields are fixed: the `hoverInfo` list stored in a
panel's settings is not used yet. To read other values for a set of points, use a table
({doc}`tables-and-filters`).

## Zoom, pan and click

The toolbar at the top right of a plot (it appears when the pointer is over the plot) has, from
left to right: download as PNG ({doc}`export`), zoom, pan, zoom in, zoom out and reset axes. 3D plots
have orbit and turntable rotation instead of pan. Drag in a 2D plot to zoom into a rectangle;
double-click to zoom out to all points. The current zoom range (or 3D camera) is stored in
the panel's settings.

A single click on a point focuses that cell or gene ({doc}`focus-and-lock`).

```{admonition} What happens on the server
:class: note
Each axis and the colour is one request for one vector: an obs or var column, one column of an
obsm or varm matrix, one row of an obsp or varp matrix, or one row or column of a layer. A cell
plot of 8,090 cells therefore needs at most four vectors of 8,090 values, however large the
store is. Changing point size, opacity, palette or colour map sends nothing; changing a type, key
or column sends one request for the new vector.
```
