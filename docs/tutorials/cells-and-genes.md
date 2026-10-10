(tut-cells-and-genes)=
# Where does a gene change, and how do two cells differ?

Kompot {cite:p}`otto2025kompot` estimates a fold change for every cell and every gene: a cells x
genes layer. Summarised per gene, it gives a volcano. But a gene with a mean change near zero can
still change strongly in one cell state, and two cells can carry different sets of changes. To see
either, read the layer itself: a gene's **column** over the cells, and a cell's **row** over the
genes.

This tutorial follows S100a9. Its mean log2 fold change is −0.05, so a volcano calls it
unchanged, yet it drops in haematopoietic stem cells (HSCs). You then lock one HSC and compare its
fold changes, gene by gene, with those of a monocyte, and you check which differences clear
Kompot's own uncertainty.

The two cells are the paper's examples (`data_prep/demo_panelsets/examples.json` in the paper
repository): the HSC `HSPC_Old_1#GAAGCCCGTGGCTCTG-1` and the monocyte
`Mature_Young_2#TCAATTCAGTGAGGCT-1`. The results are the panels of the AnnZarro paper's cells-and-genes
figure ({doc}`../paper/cells-and-genes`).

## What you need

- AnnZarro running locally ({doc}`../getting-started/quickstart`) with
  `bm_aging_annzarro.zarr` in its data directory ({doc}`../data/demo-data`). Steps 1 and 2 and
  the axes of step 3 also work on `bm_aging_annzarro.zarr`.
- These fields:

| Slot | Key | Used for |
|---|---|---|
| `layers` | `kompot_de_Young_to_Old_fold_change` | colour in step 1 (a gene's column); both axes in step 3 (a cell's row) |
| `layers` | `kompot_de_Young_smoothed`, `kompot_de_Old_smoothed` | colour in step 2 |
| `obsm` | `X_umap` | UMAP axes |
| `var` | `kompot_de_Young_to_Old_mahalanobis` | DE genes have a value above 5.82 |
| `var` | `hsc_vs_monocyte_direction` | colour in step 3 (precomputed for the two example cells) |
| `layers` | `kompot_de_Young_to_Old_fold_change_zscores` | the noise level in step 3 |

The fold change is Old minus Young smoothed log2 expression, per cell and gene. The layers are
dense 8,090 x 16,285 float32 arrays. A gene's column and a cell's row are each one request.

The colours and axes below are **live**: they read a column or row of a layer when the focus
changes. Only `hsc_vs_monocyte_direction` is precomputed, for the two example cells.

(tut-cg-column)=
## 1. Where does a gene change? Read its column

::::{dropdown} Start here: cells with an S100a9 fold change below −0.5, and the masked UMAP
```{literalinclude} ../_static/panelsets/paper/cells-and-genes-a-cells.url.txt
:language: text
```
Panel set file: {download}`cells-and-genes-a-cells.json <../_static/panelsets/paper/cells-and-genes-a-cells.json>`. The link is
ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

1. Open `bm_aging_annzarro.zarr` from **Dataset** and set **Focused Gene** to `S100a9`.
2. Set **Focused Cell** to `HSPC_Old_1#GAAGCCCGTGGCTCTG-1` (type `GAAGCCCGTGGCTCTG` and pick it).
   This is the HSC you will lock in step 3.
3. Add a cell plot. Open its controls. Set **X** and **Y** to `obsm`, `X_umap`, columns
   `0` and `1`.
4. Set **Color** to `layer`, `kompot_de_Young_to_Old_fold_change`, "Focused gene …".
5. Choose **Map** `RdBu` and press **Center at 0**, so blue is a loss and red a gain.
6. Make sure **Highlight Focused Cell** is on. The focused HSC gets a dark marker.

```{figure} ../_static/screens/paper/fig5a-fc.png
:class: screenshot
:alt: UMAP coloured by S100a9's fold change; a blue cluster of HSCs at the lower right, with the focused HSC marked.

The deep blue cluster at the lower right is the HSCs; the marked cell is
the focused HSC (fold change −1.35).
```

The mean log2 fold change of S100a9 is −0.05 (a volcano puts it near zero), but per cell it
ranges from −1.46 to +0.31. A cell table shows where the loss is:

1. Add a cell table with the columns `highres_celltype` (tab `obs`) and the `layer`
   `kompot_de_Young_to_Old_fold_change` column for the focused gene.
2. **Add Condition**: the fold-change column, **Less Than**, `-0.5`. The table keeps 317 of
   8,090 cells.
3. In the cell plot, set **Table** to this table. Cells outside the table turn grey.

```{figure} ../_static/screens/paper/fig5a-cells-page.png
:class: screenshot
:alt: A cell table filtered to S100a9 fold change below -0.5 (317 entries) beside a UMAP where only those cells are coloured.

The 317 cells with an S100a9 fold change below −0.5 are almost all in the HSC cluster.
```

4. **Add Condition**: `highres_celltype`, **Equals**, `HSC`. The table reads 288 entries: 288 of
   the 317 cells are HSCs (the rest are 24 LMPPs and 5 MKPs). The data contain 319 HSCs.

:::{note}
**Paper, cells and genes, panel a.** The fold-change UMAP of step 1 is panel a of the paper figure.
:::

(tut-cg-shared-scale)=
## 2. Compare Young and Old on one colour scale

::::{dropdown} Start here: the fold change, Young and Old on a shared scale
```{literalinclude} ../_static/panelsets/paper/cells-and-genes-abc.url.txt
:language: text
```
Panel set file: {download}`cells-and-genes-abc.json <../_static/panelsets/paper/cells-and-genes-abc.json>`. The link is
ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

Each plot scales its colours to its own data by default. To compare two plots, give them the
same range and lock it ({doc}`../user-guide/colour-scales`).

1. Add two more cell plots with the UMAP axes. Colour the first by `layer`,
   `kompot_de_Young_smoothed`, "Focused gene …", the second by `kompot_de_Old_smoothed`.
2. In each, choose **Map** `Viridis`, type `0` in **Min** and `3.77` in **Max**, and press
   **Lock Range**. 3.77 is the larger of the two maxima (Young 3.77, Old 3.72).

```{figure} ../_static/screens/paper/fig5b-range-controls.png
:class: screenshot
:alt: Colour controls with Min 0, Max 3.77 and Lock Range pressed.

The colour controls of the Young plot. With **Lock Range** on, a new focused gene keeps the range.
```

```{figure} ../_static/screens/paper/fig5abc-page.png
:class: screenshot
:alt: Three UMAPs side by side: S100a9 fold change, Young smoothed and Old smoothed on one 0 to 3.77 scale.

On the shared scale the HSC cluster (lower right, marked cell) is
teal in Young and dark purple in Old; neutrophils (top) stay yellow in both.
```

Without the lock, a focus change rescales each plot to the new gene's range, and the two plots
drift apart again.

:::{note}
**Paper, cells and genes, panels b and c.** The Young and Old plots on the 0 to 3.77 scale are panels b and c.
:::

(tut-cg-rows)=
## 3. How do two cells differ? Read their rows

::::{dropdown} Start here: the locked HSC against the focused monocyte, with the AND/OR table
```{literalinclude} ../_static/panelsets/paper/cells-and-genes-d.url.txt
:language: text
```
Panel set file: {download}`cells-and-genes-d.json <../_static/panelsets/paper/cells-and-genes-d.json>`. The link is
ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

A gene plot can use a cell's row of a layer as an axis. One axis stays on a locked cell; the other
follows the focus.

1. Keep the HSC focused. Add a gene plot and open its controls.
2. Set **X** to `layer`, `kompot_de_Young_to_Old_fold_change`, "Focused cell …". Press the
   lock button to the right of the axis (title "Lock (keep current selection)"). It turns blue: the
   x axis now stays on this HSC.
3. Set **Y** to the same layer, "Focused cell …", and leave its lock open.
4. Set **Color** to `var`, `hsc_vs_monocyte_direction`. Its palette is stored with the data:
   purple for the same direction, amber for opposite directions, grey for non-DE genes.
5. Set **Focused Cell** to the monocyte `Mature_Young_2#TCAATTCAGTGAGGCT-1`, or click it in a UMAP.
   The y axis reloads with the monocyte's row; the x axis stays on the HSC.

```{figure} ../_static/screens/paper/fig5d-controls.png
:class: screenshot
:alt: Gene plot controls: x axis on the locked HSC with a blue lock, y axis following the focused monocyte.

The controls after step 5: x locked (blue) to the HSC, y following the focused monocyte.
```

Once the focus has moved, the locked x axis reads "Locked cell HSPC_Old_1#…" in its third box
and the crosshair button appears beside its lock; the y axis reads "Focused cell
Mature_Young_2#…".

```{figure} ../_static/screens/paper/fig5d-plot.png
:class: screenshot
:alt: Scatter of every gene's fold change in the locked HSC (x) against the focused monocyte (y), coloured by direction.

The red marker is the focused gene, S100a9: −1.35 in the HSC, −0.02 in the
monocyte.
```

Same-direction genes fall in the lower left and upper right quadrants, opposite-direction genes
in the other two. The HSC's changes are far larger: over DE genes, the median |fold change| is
0.41 in the HSC and 0.07 in the monocyte. Hover over the amber point at (0.94, −0.35): it is Apoe,
up in the HSC and down in the monocyte.

```{figure} ../_static/screens/paper/fig5d-hover-apoe.png
:class: screenshot
:alt: Hover label on Apoe at x 0.937 and y -0.348, DE opposite direction.

Apoe, the strongest opposite-direction change.
```

:::{note}
**Paper, cells and genes, panel d.** This scatter is panel d of the paper figure.
:::

6. The paper's Worked example 4 (Step 26) colours the same scatter by the focused gene's row of
   the gene-gene correlation instead. Set **Color** to `varp` · `spearman_fold_change`, and the
   row selector to "Focused gene S100a9". This works on `bm_aging_annzarro.zarr` as well.

```{figure} ../_static/screens/tutorials/we4-spearman-controls.png
:class: screenshot
:alt: The Color row of the gene plot's controls: varp, spearman_fold_change, Focused gene, with an open lock.
:width: 60%

**Color** on the focused gene's row of `spearman_fold_change`.
```

```{figure} ../_static/screens/tutorials/we4-spearman.png
:class: screenshot
:alt: The same scatter of fold change in the locked HSC (x) against the focused monocyte (y), now coloured by Spearman correlation with S100a9 from −0.8 (blue) to 1 (red); genes left of zero in x are mostly yellow to red, genes right of zero mostly blue; S100a9 is the red marker at x −1.35.
:width: 80%

Coloured by correlation with S100a9. Genes whose fold change correlates with S100a9's across
cells (warm) sit mostly where the HSC's change is negative, like S100a9's own.
```

Now each gene's colour says how it co-varies with the focused gene, while its position says how
it changes in the two cells. Click a gene, or pick one in **Focused Gene**: the colour follows,
the axes do not.

(tut-cg-andor)=
### Count the directions with AND/OR

`hsc_vs_monocyte_direction` is precomputed for these two cells. A gene table recounts it from the two rows
themselves, so the count also works for any other pair of cells:

1. Add a gene table with the columns `kompot_de_Young_to_Old_mahalanobis` (tab `var`) and, from
   tab `layer`, the fold-change columns for the locked HSC and for the focused cell.
2. Build this filter in **Advanced Search**: `kompot_de_Young_to_Old_mahalanobis` **Greater
   Than** `5.82` AND a group joined by OR, which holds two AND groups:
   (HSC column **Greater Than** `0` AND focused-cell column **Less Than** `0`) and
   (HSC column **Less Than** `0` AND focused-cell column **Greater Than** `0`). To nest a group, use
   the arrow button next to a condition.
3. The table reads "Showing 1 to 25 of 61 entries".

```{figure} ../_static/screens/paper/fig5d-table.png
:class: screenshot
:alt: Gene table with a nested AND/OR filter, 61 entries.

DE AND ((HSC up AND monocyte down) OR (HSC down AND monocyte up)): 61 genes.
```

(tut-cg-noise)=
### Which changes clear Kompot's uncertainty?

::::{dropdown} Start here: coloured by z-score, with the noise filter
```{literalinclude} ../_static/panelsets/paper/cells-and-genes-d-noise.url.txt
:language: text
```
Panel set file: {download}`cells-and-genes-d-noise.json <../_static/panelsets/paper/cells-and-genes-d-noise.json>`. The link is
ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

The store holds Kompot's fold-change z-score layer, the fold change divided by its
posterior standard deviation. Kompot's variance here is shared by all genes of a cell
(0.153 for the HSC, 0.121 for the monocyte), so |z| > 1.96 is a band of ±0.30 on the x axis and
±0.24 on the y axis.

1. Colour the scatter by `layer`, `kompot_de_Young_to_Old_fold_change_zscores`, "Focused
   cell …", with **Map** `RdBu`, Min `-4`, Max `4` and **Lock Range**. Because the variance
   is per cell, this colour repeats the y position scaled by 1/0.121; it marks which genes clear
   the noise in the monocyte.
2. In the gene table, use the z-score layer's columns for the two cells and the filter
   `hsc_vs_monocyte_direction` **Not** `not DE` AND HSC z **Not Between** `-1.96` and `1.96` AND focused-cell
   z **Not Between** `-1.96` and `1.96`.
3. The table keeps 11 genes: Apoe (opposite) and 10 genes changing in the same direction
   (AW112010, Chil3, Fam111a, Fosb, H2-Q7, Jund, Pbx1, Pim1, Prtn3, Psmb9).

```{figure} ../_static/screens/paper/fig5d-noise-page.png
:class: screenshot
:alt: The scatter coloured by the monocyte's fold-change z-score next to a table of the 11 DE genes beyond 1.96 standard deviations in both cells.

Only Apoe changes in opposite directions beyond the noise level in both cells.
```

(tut-cg-check)=
## Check the numbers

| Statement | How to check it in AnnZarro | Result |
|---|---|---|
| S100a9 mean log2 fold change −0.05 | gene table, `kompot_de_Young_to_Old_mean_lfc`; or hover S100a9 in a volcano | −0.0513 |
| it drops in HSCs | cell table, fold change < −0.5 AND cell type = HSC | 288 of 317 cells (measured above) |
| HSC median −1.35, Young 1.74, Old 0.39 | not computed in the app; hover over HSCs for single values, or compute the median in Python | from `figures/numbers/fig4.json` |
| 129 same, 61 opposite | the nested AND/OR filter | 61 entries (measured above) |
| only Apoe opposite beyond 1.96 s.d., 10 same | the z-score filter | 11 entries (measured above) |
| Spearman ρ = 0.53 over DE genes | not computed in the app | from `figures/numbers/fig4.json` |

(tut-cg-views)=
## Open the views

The views of this tutorial, each also in the **Start here** box of its section. They are ready
for a local server with `bm_aging_annzarro.zarr` in its data directory; {ref}`tut-start-links`
says which part to change for another server address or store location.

::::{dropdown} Steps 1 and 2: S100a9 fold change, Young and Old on a shared scale (HSC focused)
```{literalinclude} ../_static/panelsets/paper/cells-and-genes-abc.url.txt
:language: text
```
::::

::::{dropdown} Step 1: cells with S100a9 fold change below −0.5, and the masked UMAP
```{literalinclude} ../_static/panelsets/paper/cells-and-genes-a-cells.url.txt
:language: text
```
::::

::::{dropdown} Step 3: locked HSC against the focused monocyte, with the AND/OR table
```{literalinclude} ../_static/panelsets/paper/cells-and-genes-d.url.txt
:language: text
```
::::

::::{dropdown} Step 3: coloured by z-score, with the noise filter
```{literalinclude} ../_static/panelsets/paper/cells-and-genes-d-noise.url.txt
:language: text
```
::::

The same panels as panel-set files:
{download}`cells-and-genes-abc.json <../_static/panelsets/paper/cells-and-genes-abc.json>`,
{download}`cells-and-genes-a-cells.json <../_static/panelsets/paper/cells-and-genes-a-cells.json>`,
{download}`cells-and-genes-d.json <../_static/panelsets/paper/cells-and-genes-d.json>`,
{download}`cells-and-genes-d-noise.json <../_static/panelsets/paper/cells-and-genes-d-noise.json>`. **Load Panel Set** >
upload, then **Load**, opens the panels in their layout with the dataset and focus (or use the links above)
({ref}`tut-tour-load-file`, {doc}`../user-guide/panel-sets`).

## What you learned

- A layer is read by columns (one gene over all cells, as a colour) and by rows (one cell over all
  genes, as an axis of a gene plot).
- **Lock Range** with a typed Min and Max puts two plots on one colour scale.
- A locked axis stays on one cell while the other axis follows the focus.
- Nested AND/OR filters in a table count genes from live rows, for any pair of cells.

Previous: {doc}`gene-similarity` reads a gene x gene matrix one row at a time.
