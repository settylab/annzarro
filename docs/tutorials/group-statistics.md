(tut-group-statistics)=
# Do cell types respond to age in the same way? Gene statistics over groups of cells

Kompot {cite:p}`otto2025kompot` estimates, for every cell and every gene, how expression changes from young to old mice.
Its paper reports that most age-altered genes in this bone marrow show only a subtle change in aggregate, of two kinds:
the direction of the change varies across cell types, or the change is confined to haematopoietic stem cells (HSCs)
{cite:p}`otto2025kompot`. This tutorial checks both kinds in the stored result, for whole cell types at once: each
gene's mean fold change over the cells of a cell type, as the axis of a gene plot, a column of a gene table and the
colour of a heatmap, computed by AnnZarro on request.

The tutorial {doc}`cells-and-genes` compares the same fold changes for **two single cells**, an old HSC and a monocyte.
Here the comparison is between groups of cells, and any group can take part: a cell type, a finer cell state, or the
cells that pass a cell table's filter.

## What you need

- AnnZarro 0.8.0 or later, running locally ({doc}`../getting-started/quickstart`), with `bm_aging_annzarro.zarr` in its
  data directory ({doc}`../data/demo-data`).
- About 25 minutes.
- These fields:

| Slot | Key | Used for |
|---|---|---|
| `obs` | `midres_celltype`, `highres_celltype` | the groups: 19 cell types, then 31 finer states |
| `obs` | `Age` | the cell tables of section 6 |
| `layers` | `kompot_de_Young_to_Old_fold_change` | the statistic: Old minus Young smoothed expression, per cell and gene |
| `layers` | `logged_counts` | the measured expression, in sections 6 and 7 |
| `var` | `kompot_de_Young_to_Old_is_de`, `kompot_de_Young_to_Old_mahalanobis` | the genes the stored run calls (190), and its significance |
| `var` | `hsc_fold_change` | one old HSC's row of the fold-change layer (section 2) |
| `varm` | `mean_by_celltype` | per-cell-type means of `logged_counts`, computed in Python when the store was built |

The store holds no per-cell-type statistic of the fold-change layer. Every statistic below is computed by AnnZarro when
a panel asks for it: one request returns the mean, the fraction of cells and the other statistics of every gene over
the group's cells. At 8,090 cells each takes a moment.

The counts of called genes below are those of the run stored in `bm_aging_annzarro.zarr`, whose
`kompot_de_Young_to_Old_is_de` marks 190 genes. The paper's own classification of the comparison (up, down and subtle
genes) is in its Figure 3D {cite:p}`otto2025kompot`.

(tut-gstat-axes)=
## 1. Two cell types as the axes of a gene plot

::::{dropdown} Start here: mean fold change in HSCs against monocytes
```{literalinclude} ../_static/panelsets/tutorials/tut-gstat-hsc-monocyte.url.txt
:language: text
```
Panel set file: {download}`tut-gstat-hsc-monocyte.json <../_static/panelsets/tutorials/tut-gstat-hsc-monocyte.json>`.
The link is ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

1. Add a **Cell Grouping**. **Add factor ▾**, **Column…**, then `obs` and `midres_celltype`, and **Add**. The group
   list shows 19 groups, from HSC (319 cells) to ILC (13). Rename the panel "Cell types" (click its title).
2. Add a **Gene Plot**. Each point is a gene.
3. Set **X** to `layer`, then the layer `kompot_de_Young_to_Old_fold_change`. In the next list, under **Cell
   groupings**, choose "Cell types"; a list of its groups follows; choose `HSC`. The button at the end of the row shows
   **x̄**: the statistic is the mean. Each gene's x is now its mean fold change over the 319 HSCs.
4. Set **Y** the same way, with the group `Monocyte`.
5. Set **Color** to `var`, `kompot_de_Young_to_Old_is_de`: the 190 called genes of the stored run are one colour.

```{figure} ../_static/screens/tutorials/gstat-axis-row.png
:class: screenshot
:alt: The controls of a gene plot. X reads layer, kompot..., Cell types, HSC and a button with x-bar; Y reads the same with Monocyte; Color reads var, kompot_de_Young_to_Old_is_de.

The X and Y rows: the layer, the grouping, the group, and the statistic's button (x̄, the mean).
```

```{figure} ../_static/screens/tutorials/gstat-hsc-monocyte-plot.png
:class: screenshot
:alt: A scatter of 16,285 genes, the mean fold change in HSCs on x from about -1.2 to 1, in monocytes on y from about -0.35 to 0.35. Called genes are cyan, the rest red. Apoe, circled, sits at the lower right.

Mean fold change in HSCs (x) against monocytes (y). Most of the spread is along x: the stem cells change more.
Apoe, the focused gene, is circled at the lower right.
```

Read the quadrants. Hover a point for its gene and both values.

- **Upper right, a shared response.** H2-Q7 is +0.76 in HSCs and +0.30 in monocytes.
- **Lower right, opposite directions.** Apoe rises in HSCs (+0.81) and falls in monocytes (−0.32).
- **Far along x only, stem cells only.** S100a9 is −1.20 in HSCs and −0.04 in monocytes.

Of the 190 called genes, 125 change in the same direction in both cell types and 65 in opposite directions.

In monocytes, the paper finds the genes that fall with age enriched for defence response, and those that rise enriched
for antigen processing and presentation, driven by MHC class II genes; it recovers H2-Aa, H2-Ab1, H2-Eb1, Cd74 and
AW112010, which an earlier study identified as the top dysregulated genes in ageing monocytes {cite:p}`otto2025kompot`.
The paper reads the rise of MHC class II genes as a general feature of haematopoietic ageing {cite:p}`otto2025kompot`.
In the stored all-cell run, the mean fold change of these genes over all monocytes is positive: AW112010 +0.35, H2-Ab1
+0.19, H2-Aa +0.13, H2-Eb1 +0.08, Cd74 +0.08; over the HSCs it is larger (H2-Aa +0.48, H2-Eb1 +0.42).

(tut-gstat-diagonal)=
## 2. One cell or the whole cell type?

::::{dropdown} Start here: one old HSC against the mean of all HSCs
```{literalinclude} ../_static/panelsets/tutorials/tut-gstat-diagonal.url.txt
:language: text
```
Panel set file: {download}`tut-gstat-diagonal.json <../_static/panelsets/tutorials/tut-gstat-diagonal.json>`.
::::

`var/hsc_fold_change` is the row of the fold-change layer for one old HSC, the cell {doc}`cells-and-genes` locks. Set
**X** to `var`, `hsc_fold_change`, and keep **Y** on the HSC mean.

```{figure} ../_static/screens/tutorials/gstat-diagonal-plot.png
:class: screenshot
:alt: A tight diagonal line of genes from the lower left to the upper right: one HSC's fold change on x, the mean over all HSCs on y.

One old HSC (x) against the mean of all 319 HSCs (y): the points lie on the diagonal.
```

The two agree closely (over the 16,285 genes, r = 0.999), because the fold change is smooth across similar cells. The
single cell is a little more extreme: Apoe +0.94 for the cell against +0.81 for the cell type, S100a9 −1.35 against
−1.20. So the two-cell comparison of {doc}`cells-and-genes` holds for the cell types; now it can be made for any pair.

(tut-gstat-stem)=
## 3. Changes confined to stem cells

::::{dropdown} Start here: called genes that fall in HSCs, with their means in two later stages
```{literalinclude} ../_static/panelsets/tutorials/tut-gstat-granulocyte.url.txt
:language: text
```
Panel set file: {download}`tut-gstat-granulocyte.json <../_static/panelsets/tutorials/tut-gstat-granulocyte.json>`.
::::

The paper finds that genes associated with granulocyte function lose expression in old HSCs, and that along the
neutrophil lineage their expression is back near young levels as soon as cells leave the stem cell state (its
Fig. 3H–J) {cite:p}`otto2025kompot`. A gene table can show this for every called gene at once.

1. Add a **Gene Table**. In its column chooser, on the `var` tab, tick `kompot_de_Young_to_Old_is_de` and
   `kompot_de_Young_to_Old_mahalanobis`.
2. Open the **Cell groupings** tab. Its add row reads `[group ▾] [layer ▾] [x̄]` and **Add column**. Choose `HSC`, the
   layer `kompot_de_Young_to_Old_fold_change`, keep **x̄**, and press **Add column**. Do the same for `Myelo P` (myelocyte
   progenitors, the next stage of the lineage) and `Neutrophil`. Press **Apply Changes**. Each new column fills in once
   its statistic has come.

```{figure} ../_static/screens/tutorials/gstat-table-tab.png
:class: screenshot
:alt: The Cell groupings tab of a gene table's column chooser: under the heading Cell types, three ticked columns, each starting with x-bar, for HSC, Myelo P and Neutrophil; below them the add row with a group select, a layer select, an x-bar button and Add column.

The **Cell groupings** tab: one column per group, layer and statistic, and the add row for the next.
```

3. Filter: open **Advanced Search**, **Add Condition**: `kompot_de_Young_to_Old_is_de` **Equals** **Yes**; **Add
   Condition**: `HSC: mean · kompot_de_Young_to_Old_fold_change` **Less Than** `-0.5`.

```{figure} ../_static/screens/tutorials/gstat-granulocyte-table.png
:class: screenshot
:alt: A gene table with the two conditions of Advanced Search and 20 rows: Anxa2, Camp, Cd37, Cd52 and others, each with an HSC mean below -0.5 and Myelo P and Neutrophil means near zero.

The 20 called genes whose mean fold change in HSCs is below −0.5.
```

The table keeps 20 genes. All 20 fall by more than half a log unit in HSCs and lie within 0.13 of zero in myelocyte
progenitors and neutrophils. Among them are the granulocyte genes S100a8 (−1.16 in HSCs, −0.04 in Myelo P, +0.06 in
neutrophils). Nine of the 20 (Camp, Cd52, Fcer1g, Hp, Lcn2, Ncf1, S100a8, S100a9 and Wfdc21) are among the 20
granulocyte-associated genes of the paper's Figure 3H–J, which were chosen differently {cite:p}`otto2025kompot`. Their aggregate change over all cells is small for that reason: of 8,090
cells, 319 are HSCs.

(tut-gstat-opposite)=
## 4. Opposite directions in related cell states

::::{dropdown} Start here: naive against memory B cells
```{literalinclude} ../_static/panelsets/tutorials/tut-gstat-naive-memory.url.txt
:language: text
```
Panel set file: {download}`tut-gstat-naive-memory.json <../_static/panelsets/tutorials/tut-gstat-naive-memory.json>`.
::::

The paper reports genes involved in B cell differentiation that change in opposite directions in naive and memory B
cells, so that their change largely cancels in aggregate {cite:p}`otto2025kompot`. `midres_celltype` has one group for
mature B cells; `highres_celltype` separates the naive and the memory state.

1. Go back to the gene plot of section 1. In the **Cell Grouping**, add the factor `highres_celltype` (**Add factor ▾**,
   **Column…**), then remove `midres_celltype` with **Remove** in the **⋯** menu of its card. The grouping now has 31
   groups.
2. HSC and Monocyte exist under the new factor too, so the plot keeps them. A group that no longer exists is said over
   the plot, with **Choose another**:

```{figure} ../_static/screens/tutorials/gstat-group-changed.png
:class: screenshot
:alt: A gene plot whose X row lists "Mature B cell (no longer a group)"; over the plot a notice reads 'Mature B cell' is no longer a group of 'Cell types'. with the link Choose another.

An axis on `Mature B cell` after the factor changed to `highres_celltype`, which has no such group.
```

3. Choose `Mature Naive B cell` for **X** and `Memory B cell` for **Y**.

```{figure} ../_static/screens/tutorials/gstat-naive-memory-plot.png
:class: screenshot
:alt: Mean fold change in naive B cells on x against memory B cells on y. A group of cyan called genes sits at the upper left, x between -0.7 and -0.4 and y between 0.6 and 1.5; Cd79a is circled among them.

Naive (x) against memory B cells (y). The genes at the upper left fall with age in naive B cells and rise in memory B
cells. Cd79a is circled.
```

The genes at the upper left are B cell genes: Cd79a (−0.55 in naive, +1.04 in memory B cells), Cd79b (−0.46, +0.84),
Ms4a1 (−0.53, +0.74), Ighm (−0.48, +0.82), and with the largest change Igkc (−0.72, +1.36) and Cd74 (−0.68, +1.46).
Of the 190 called genes, 32 fall by more than 0.2 in naive and rise by more than 0.2 in memory B cells.

(tut-gstat-heatmap)=
## 5. The opposing genes across every cell state

::::{dropdown} Start here: the 32 opposing genes as a heatmap by fine cell type
```{literalinclude} ../_static/panelsets/tutorials/tut-gstat-divergent.url.txt
:language: text
```
Panel set file: {download}`tut-gstat-divergent.json <../_static/panelsets/tutorials/tut-gstat-divergent.json>`.
::::

A filtered gene table is a gene list that the other panels can use.

1. In the gene table of section 3, replace the HSC, Myelo P and Neutrophil columns with `Mature Naive B cell` and
   `Memory B cell` (the same add row; the grouping is now the fine one). Set the conditions to `is_de` **Equals**
   **Yes**, naive **Less Than** `-0.2`, memory **Greater Than** `0.2`. The table keeps 32 genes. Rename it "Opposite
   in naive and memory B cells".
2. Add a **Cell-Gene Plot**. **Groups**: **Cell Grouping**, the grouping. **Add genes ▾**: the table.
3. Set **Mode** to **Heatmap** and the **Color** layer to `kompot_de_Young_to_Old_fold_change`; its button shows
   **x̄**. In **Color ▾**, choose the colour scale `RdBu` and set **Center** to 0.

```{figure} ../_static/screens/tutorials/gstat-divergent-heatmap.png
:class: screenshot
:alt: A heatmap of 32 genes (columns) by 31 cell states (rows), coloured by mean fold change on a blue-white-red scale centred on 0. The Mature Naive B cell row is blue across almost every gene, the Memory B cell row and the Plasma cell row are red; the HSC row is mixed; most other rows are pale.

The 32 genes by the 31 cell states: blue in naive B cells, red in memory B cells and plasma cells.
```

The reversal is between the B cell states; most other states are pale. Several of the same genes also move in opposite
directions between naive CD8 T cells and CD8 effector memory T cells. The heatmap's **Download CSV** (in **Plot
Options**) gives the cell state by gene table of mean fold changes, which the store does not hold.

(tut-gstat-tables)=
## 6. A cell table's cells as a group

::::{dropdown} Start here: Mid against Old HSCs on logged counts
```{literalinclude} ../_static/panelsets/tutorials/tut-gstat-cell-tables.url.txt
:language: text
```
Panel set file: {download}`tut-gstat-cell-tables.json <../_static/panelsets/tutorials/tut-gstat-cell-tables.json>`.
::::

A cell table's filtered rows are a group as well. The paper compares mid-aged with old HSCs, because the young mice
have few of them {cite:p}`otto2025kompot`. Do the same on the measured expression.

1. Add a **Cell Table** with the `obs` columns `midres_celltype` and `Age`. **Advanced Search**: `midres_celltype`
   **Equals** `HSC`, `Age` **Equals** `Mid`. It keeps 71 cells. Rename it "Mid HSCs".
2. A second **Cell Table**, the same with `Age` **Equals** `Old`: 241 cells. Rename it "Old HSCs".
3. In a **Gene Plot**, set **X** to `layer`, `logged_counts`, and under **Cell tables** choose "Mid HSCs". **Y**: the
   same with "Old HSCs".

```{figure} ../_static/screens/tutorials/gstat-cell-tables.png
:class: screenshot
:alt: A gene plot of the mean of logged_counts in Mid HSCs on x against Old HSCs on y, a narrow band along the diagonal from 0 to about 3.4; Cd74 is circled above the band near x = 0.4. Below it two cell tables, Mid HSCs and Old HSCs, with their Advanced Search conditions.

Mean `logged_counts` in Mid (x) against Old HSCs (y). Each axis follows its table: change a condition and the axis is
asked again.
```

The two means agree for most genes. Above the diagonal sit the MHC class II genes: Cd74 (0.36 in Mid, 0.96 in Old
HSCs), H2-Aa (0.40, 0.85) and H2-Eb1 (0.29, 0.73). They rise in old HSCs here as in the
fold-change layer of section 1. These are raw means of two groups of 71 and 241 cells, with no model of their noise;
Kompot's fold change is the modelled version of the same question.

Edit a condition, for example `Age` **Equals** `Young`: the axis follows the table and asks again.

(tut-gstat-layout)=
## 7. Where the store's layout sets a limit

Open the statistic's button (**x̄**) on an axis that reads `logged_counts`:

```{figure} ../_static/screens/tutorials/gstat-agg-greyed.png
:class: screenshot
:alt: The open list of a gene plot axis's statistic button over logged_counts: Z-score mean greyed out with a two-line reason under it, then Mean (ticked), Fraction of cells, Mean of expressing cells, Sum and SD.

The statistics of a group on `logged_counts`. **Z-score mean** is greyed out, with the reason under it.
```

**Z-score mean** scales each gene over all cells before averaging over the group, so it needs a read of the whole
layer. `logged_counts` is stored by cell (CSR) in the demonstration store, so it is greyed out here; on a layer stored
by gene (CSC), such as `X` in this store, it is offered. {doc}`../data/preparing-a-store` explains the two layouts.

## Check the numbers

| Statement | How to check it in AnnZarro | Result |
|---|---|---|
| H2-Q7 +0.76 in HSCs, +0.30 in monocytes | hover H2-Q7 in the plot of section 1 | +0.76, +0.30 |
| 125 called genes the same direction, 65 opposite | colour by `is_de`; or a gene table with the two group columns, filtered by sign | 125, 65 |
| one HSC against all HSCs | section 2: the points lie on the diagonal; hover Apoe | +0.94, +0.81 |
| 20 called genes below −0.5 in HSCs | the filtered table of section 3 | 20 entries |
| 32 opposing genes in naive and memory B cells | the filtered table of section 5 | 32 entries |
| 71 Mid and 241 Old HSCs | the two cell tables of section 6 | 71, 241 entries |
| the live mean equals the stored one | X `varm` `mean_by_celltype` `HSC`, Y the HSC group's mean of `logged_counts`; hover Apoe | 1.98 on both axes |

The last row checks the computation itself: `varm/mean_by_celltype` was computed in Python when the store was built,
and the group mean AnnZarro computes lies on the diagonal with it, for every gene.

::::{dropdown} Start here: the stored per-cell-type mean against the live one
```{literalinclude} ../_static/panelsets/tutorials/tut-gstat-stored-check.url.txt
:language: text
```
Panel set file: {download}`tut-gstat-stored-check.json <../_static/panelsets/tutorials/tut-gstat-stored-check.json>`.
::::

(tut-gstat-views)=
## Open the views

Each view is also in the **Start here** box of its section. They are ready for a local server with
`bm_aging_annzarro.zarr` in its data directory; {ref}`tut-start-links` says which part to change for another server or
store location. As panel set files: {download}`hsc-monocyte <../_static/panelsets/tutorials/tut-gstat-hsc-monocyte.json>`,
{download}`diagonal <../_static/panelsets/tutorials/tut-gstat-diagonal.json>`,
{download}`granulocyte <../_static/panelsets/tutorials/tut-gstat-granulocyte.json>`,
{download}`naive-memory <../_static/panelsets/tutorials/tut-gstat-naive-memory.json>`,
{download}`divergent <../_static/panelsets/tutorials/tut-gstat-divergent.json>`,
{download}`cell-tables <../_static/panelsets/tutorials/tut-gstat-cell-tables.json>`,
{download}`stored-check <../_static/panelsets/tutorials/tut-gstat-stored-check.json>`. **Load Panel Set**, upload, then
**Load** opens one ({doc}`../user-guide/panel-sets`).

## What you learned

- Any group of cells gives a statistic for every gene on request: as a gene plot's axis or colour, or as a gene table's
  column, from any layer, including a stored model output such as Kompot's fold change.
- A comparison of two cells generalises to two cell types, and the finer annotation separates states that move in
  opposite directions.
- A filtered gene table is a gene list: a Cell-Gene Plot draws it by cell type.
- A cell table's filtered cells are a group too, and the axis follows the filter.
- The layer's storage layout decides whether Z-score mean of a group can be computed.

The statistics are defined in {doc}`../user-guide/cell-and-gene-plots` (a gene plot by a group of cells) and
{doc}`../user-guide/cell-gene-plot`. Previous: {doc}`cells-and-genes`.
