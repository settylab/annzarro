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
:alt: Cell plot controls with twelve numbered parts: X type, key and column drop-downs; the Color row; 3D Plot; Equal aspect; Highlight Focused Cell; Palette; Hide NaN; Size and Opacity sliders; Table filter; Plot Options.

Cell plot controls, coloured by a categorical obs column.
```

1. **Type**: the AnnData slot the axis reads from.
2. **Key**: the column or matrix in that slot.
3. **Column**: which column of the matrix, or which focused row or column (see the tables below).
   obs and var columns have none, and the drop-down is not shown.
4. **Color**: the same three drop-downs for the colour, plus **None (constant)**.
5. **3D Plot** adds a **Z** row and draws the plot in 3D. Click it again for 2D.
6. **Equal aspect** draws one unit on x as long as one unit on y, for spatial coordinates
   ({doc}`spatial-coordinates`).
7. **Highlight Focused Cell** (in gene plots, **Highlight Focused Gene**) draws the focused point
   as a red dot with a black ring. On by default.
8. **Palette** (categorical colour) or **Map** and range controls (numerical colour,
   {doc}`colour-scales`).
9. **Hide NaN** removes the points whose colour value is missing (for a categorical colour, the
   points of the **NA** legend entry). Numerical colours have more buttons next to it
   ({doc}`colour-scales`).
10. **Size** (in px) and **Opacity** (0 to 1) of the points: a slider and a number box each.
    The sliders move on a log scale, so their left half is the small sizes and faint opacities a
    plot of millions of cells needs: size 0.39 to 2.8 and opacity 0.002 to 0.045. WebGL draws 2D
    markers in steps of 100/255 = 0.39 px, so sizes snap to those steps (5 is shown as 5.1, the
    size it is drawn at); the size slider starts at one step and opacity at 0.002, below which a
    point is not drawn at all (8-bit alpha). The boxes take any value, also outside the sliders'
    range.

    Until you set them, both are **automatic**: they follow the number of points drawn (not the
    size of the panel). That is the cells of the subset less the points the plot hides itself:
    those a table link removes (**Remove non-table entries**), **Hide NaN** and **Hide outliers**,
    and less the points a table link greys out: only the points shown in full count, so a table
    search that picks a few rows gives them the larger size of a small plot. The grey points,
    drawn behind, keep the automatic style of all the points drawn (or the size and opacity you
    set), so they stay a quiet backdrop. From the default
    5.1 px and opaque at a few thousand points, the size falls by about half with every tenfold
    in points: 3.5 px / 0.87 at 10,000, 1.96 px / 0.64 at 100,000, 1.18 px / 0.43 at a million,
    and 0.39 px (one step, the smallest WebGL draws) from about 10 million, with opacity 0.28
    there and 0.19 at 95.6 million.
    The curve was set on screenshots of Tahoe-100M UMAPs and checked on 1, 2 and 5 million cells
    at cell-line colours; sizes above 5 million points were not looked at again. An
    automatic value is shown in grey italics and changes when the number of points does, for
    example when you turn the subset off. In a 2D plot it also follows the zoom: once a zoom or
    pan has settled, the count is the points inside the view, so a close view of a dense
    region gets larger, more opaque points; Reset axes (or a double click) goes back to the
    value for every point drawn. In a 3D plot the automatic opacity is always 1: below 1,
    Plotly draws 3D points out of depth order (far points over near ones). An opacity you choose is
    kept in 3D as well; its tooltip warns about the drawing order. Moving a slider or typing a value
    sets it; it then stays
    as set, in saved panel sets and links too. The **auto** button beside each box is highlighted
    while its value is automatic; click it to make that value automatic again.
11. **Table** links the plot to a table ({doc}`tables-and-filters`).
12. **Plot Options** opens appearance and export settings ({doc}`export`). **Refresh**, next to
    it, reloads the panel's data and redraws it: the server first re-checks the dataset against
    the disk, and the panel reads past this browser's copies, so values written to the store since
    it was drawn appear (as with **Refresh dataset**, {doc}`interface`).

A toggle that is on is filled blue and starts with a check mark. The controls rearrange with the
panel's width: side by side in a wide panel, stacked in a narrow one.

Every change redraws the panel straight away.

## Sources for a cell plot

| Type | Key | Column | One value per cell is |
|---|---|---|---|
| `obs` | any obs column | N/A | that column |
| `obsm` | any obsm matrix (embedding, PCA, spatial positions, protein counts…) | a column name or index | that column |
| `obsp` | any obsp matrix | "Focused cell *name*" | the focused cell's row: its value to every cell |
| `layer` | `X` or any layer | "Focused gene *name*" | the focused gene's column of `X` or the layer |

## Sources for a gene plot

| Type | Key | Column | One value per gene is |
|---|---|---|---|
| `var` | any var column | N/A | that column |
| `varm` | any varm matrix (PC loadings, per-group means…) | a column name or index | that column |
| `varp` | any varp matrix | "Focused gene *name*" | the focused gene's row: its value to every gene |
| `layer` | `X` or any layer | "Focused cell *name*" | the focused cell's row of `X` or the layer |

All four types are available for x, y, z and colour alike. An axis that reads `obsp`, `varp` or a
`layer` follows the focus and gets the lock and refocus buttons ({doc}`focus-and-lock`); for
example, x = the focused cell's row of a UMAP distance matrix and y = its row of a diffusion
distance matrix plots every cell's distance to the focused cell in both spaces, as in
{ref}`tut-cell-distance-axes` of the tutorial {doc}`../tutorials/cell-similarity`.

`X` is listed first under the `layer` type. Columns of obsm and varm with more than ten entries are
listed alphabetically. A sparse obsm matrix (for example a copy-number matrix `X_cnv` stored as
CSR) can be an axis or a colour too; its columns are offered by position (0, 1, 2, …).

If a panel names a source the open dataset does not have (a view made for another dataset, or a
column that was removed), the drop-down keeps the name and marks it "(not in this dataset)", and
the plot's status line ({ref}`plot-status-line`) says which source is missing, for example
"obs.not_a_column: not in this dataset (8,090 cells)". A source that exists but cannot be read is
listed as "failed to read", with the reason.

(plot-status-line)=
## What a plot does not show: the status line

Under every plot is one line that says how many points it shows and why the others are missing,
for example

> **28 of 200 cells shown** · 150 not in part 2 of 4 · 21 table filter · 1 NaN hidden · details

Click it for every reason with its exact count and the action that undoes it:

| Reason | Undo |
|---|---|
| not in the cell subset, or not in its current part ({doc}`subsets`) | **Next part**, **Subset…** |
| no x, y or z value | (none; the point has no position) |
| a source that failed to read, is not in this dataset or needs a focused cell | (see the reason) |
| not in the linked table (the eye toggle, {doc}`tables-and-filters`) | **Stop filtering** |
| no colour value, with **Hide NaN** on | **Show NaN** |
| outside the colour range, with **Hide Outliers** on | **Show outliers** |

Each cell is counted once, under the first reason in this order that applies, so the counts add up
to the number not shown. The total is the dataset's, as in the header's "Cells: 50 of 200". Counts
of a million or more are rounded on the line (95.6M) and exact in the list. **Next part** shows
other cells rather than giving these back, as stepping the part in the header does. A colour that
failed to read hides no points; it is listed without a count.

The line keeps its height whatever it says, so the plot does not move when it changes. In a
narrow panel it shortens to "28 of 200 shown · details". Tags at its right state a mode: in
large-plot mode, **Large plot: no hover/click** ({ref}`large-plot-mode`). An exported PNG or SVG
carries the same statement above the plot.

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

AnnZarro decides per colour source whether it is categorical or numerical from up to 1,000 of its
values that are not missing, spread over the whole column: if at least 80 % of them are numbers it
is numerical, otherwise (strings, booleans) it is categorical. A numeric column that is mostly
missing is therefore still numerical.

- **Categorical**: one trace per category with a legend, and every point drawn. Points with a
  missing value are drawn in grey under an **NA** legend entry, and values that are not among the
  column's categories appear as categories of their own. **Palette** offers "As stored in
  adata.uns" (uses `uns/<key>_colors`, as scanpy writes them; the default),
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

```{figure} ../_static/screens/user-guide/plots-categorical-na.png
:class: screenshot
:alt: A volcano plot coloured by var fig4_module_k3: the 190 DE genes in purple, green and yellow for modules 1 to 3, the 16,095 other genes in grey under an NA legend entry.

`var/fig4_module_k3` of `bm_aging_showcase.zarr`: three modules (87, 68 and 35 genes) and 16,095
genes without a module, drawn in grey as **NA**. View:
{download}`userguide-categorical-na.json <../_tools/views/userguide-categorical-na.json>`.
```

(many-categories)=
### Columns with many categories

A categorical column can have as many categories as cells: a barcode or a sample-cell id stored as
a categorical. How it is coloured depends on its number of categories (shown in the dataset
structure):

- **Up to 64**: one colour and one legend entry per category, as above.
- **More than 64**: the categories are ranked by their number of cells over the whole column,
  most frequent first (ties in stored order), and rank *r* is drawn in colour *r* mod 64. The
  legend has one entry per colour, so at most 64. Each names the three most frequent categories
  of its colour among the points shown and counts the rest, for example "S1, S65, S129 +18 more";
  clicking it hides and shows that colour, and double-clicking shows that colour alone. The
  ten most frequent ranks get ten clearly different colours. The colours are drawn one after
  the other, so where categories mix the last colours drawn cover the earlier ones. Hovering a
  point names its own category. "As stored in adata.uns" colours are not used here.

The ranking is computed once per column on the server, over all cells, and kept, so a category
keeps its colour across the parts of a subset ({doc}`subsets`), under a table filter and in every
panel coloured by the same column. Only the points shown change; the colours do not move. Ranking
a column of 95.6 million cells takes under half a second the first time (M3 Max), a few
milliseconds after that.

With more than 500,000 distinct categories among the points of a regular (not large-plot)
panel, for example a barcode column on a million cells, the hover would need one label per
point. Such a plot is coloured at once and starts with its hover off: **No hover** is selected
in its **Hover** list, and no label is read; the legend's names are read on their own (three
per colour). Pick hover columns to turn the hover on: the labels are then read, at any count, if
they fit the browser's memory ({ref}`browser-memory`); if they do not, the hover stays off and
the status line says what they need and what is free. Under a subset of 100,000 cells the hover
is on as usual.

Such a column also works in the hover (the panel's **Hover** list, {ref}`hover-columns`) and as a
table column at any size: AnnZarro reads its labels only for the cells shown, never its whole
category list. In a table, a column with more than 10,000 distinct values is filtered with a typed
value: **Equals** and **Not** take a text box instead of a list of every value
({doc}`tables-and-filters`). Balancing a subset across a column with more than 10,000 categories is not
offered ({doc}`subsets`).

(hover-columns)=
## Hover

Hovering a point shows its name, its x and y (and z) values and its colour value `c` (for a
categorical colour, the category), with numbers to 4 significant digits. Below them it lists the
panel's hover columns. Pick them in the panel's **Hover** list, which offers **No hover**, then the
obs columns (Cell Plot) or var columns (Gene Plot); Ctrl-click or Cmd-click selects several.
**No hover** shows no hover label at all (a click still focuses the point); it is the `hoverOff`
setting, and a plot coloured by a column of very many categories starts with it
({ref}`many-categories`). A change loads
only those columns and relabels the points without redrawing the plot. The choice is the panel's
`hoverInfo` setting, kept in panel sets and share links ({doc}`../reference/deep-links`). In a
view's JSON it can also name other sources, such as a layer column:
`[{"type": "obs", "key": "highres_celltype"}, {"type": "layer", "key": "kompot_de_Young_to_Old_fold_change", "column": "S100a9"}]`;
the **Hover** list keeps such entries when you change its selection. {doc}`focus-and-lock` shows a
hover label with two obs columns.

## Zoom, pan and click

The toolbar at the top right of a plot (it appears when the pointer is over the plot) has, from
left to right: download as PNG ({doc}`export`), zoom, pan, zoom in, zoom out and reset axes. 3D plots
have orbit and turntable rotation instead of pan. Drag in a 2D plot to zoom into a rectangle;
double-click to zoom out to all points. The current zoom range (or 3D camera) is stored in
the panel's settings.

A click focuses the point nearest to the pointer; clicking the same spot again steps through
points that overlap there ({doc}`focus-and-lock`).

```{admonition} What happens on the server
:class: note
Each axis and the colour is one request for one vector: an obs or var column, one column of an
obsm or varm matrix, one row of an obsp or varp matrix, or one row or column of a layer. A cell
plot of 8,090 cells therefore needs at most four vectors of 8,090 values, however large the
store is. Changing point size, opacity, palette or colour map sends nothing; changing a type, key
or column sends one request for the new vector.
```
