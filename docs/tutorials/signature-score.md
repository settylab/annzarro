(tut-signature)=
# Is the stem cell ageing response kept as cells differentiate? Gene lists from cut-offs, as signatures

The store holds a fold change for every cell and gene, from Kompot {cite:p}`otto2025kompot`. This page turns thresholds on
that result into gene lists, scores each list on every cell as a **Gene Signature**, and follows the lists along a
lineage. The cut-offs are yours to move; every count below is what the app shows for the cut-off written next to it.

## What you need

- AnnZarro 0.8.0 or later running locally ({doc}`../getting-started/quickstart`) with `bm_aging_annzarro.zarr` in its
  data directory.
- These fields:

| Slot | Key | Used for |
|---|---|---|
| `obs` | `midres_celltype`, `highres_celltype`, `Age` | the groups: 19 and 31 cell types, and Young, Mid and Old |
| `layers` | `logged_counts` | the scores of a signature on every cell |
| `layers` | `kompot_de_Young_to_Old_fold_change` | the fold change (Old minus Young) per cell and gene |
| `var` | `kompot_de_Young_to_Old_is_de`, `kompot_de_Young_to_Old_mean_lfc`, `kompot_de_Young_to_Old_mahalanobis` | the 190 genes the store marks as called, and the volcano |

Every number below was read from the application on the store as deposited, by `docs/_tools/shoot_tut_signature.py`, which
performs the steps in a headless browser.

::::{dropdown} Start here: the fold change along the lineage (step 3), with the signatures closed
```{literalinclude} ../_static/panelsets/tutorials/tut-signature-lineage.url.txt
:language: text
```
Panel set file: {download}`tut-signature-lineage.json <../_static/panelsets/tutorials/tut-signature-lineage.json>`.
The link is ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

(tut-sig-list)=
## 1. A gene list from a cut-off

A gene table can show the mean of a layer over one group of cells as a column, computed live. Here the group is the HSCs
and the layer is the stored fold change, so the column says how much each gene moves in stem cells.

1. Add a **Cell Grouping** with one factor, `midres_celltype` (**Add factor ▾** ▸ **Column…**), and rename it **Cell type**.
2. Add a **Gene Table**. On its `var` tab tick `kompot_de_Young_to_Old_is_de`.
3. Open its **Cell groupings** tab. For the grouping **Cell type** choose the group `HSC` and the layer
   `kompot_de_Young_to_Old_fold_change`; the button holds `x̄`. Press **Add column**, then **Apply Changes**. The column
   is named "HSC: mean · kompot_de_Young_to_Old_fold_change".
4. In **Advanced Search** add `kompot_de_Young_to_Old_is_de` **Equals** `Yes`, and the new column **Less Than** `-0.5`. The
   strip reads "Showing 1 to 20 of 20 entries (filtered from 16,285 total entries)". Rename the table **Falls in HSCs table**.

```{figure} ../_static/screens/tutorials/sig-table-lo.png
:class: screenshot
:alt: A gene table with the called flag and the HSC mean fold change as columns, two conditions in Advanced Search, and 20 genes.

The 20 called genes whose mean fold change in HSCs is below -0.5. The column is computed from the layer, live.
```

5. Add a **Gene Signature**, rename it **Falls in HSCs**, and choose **Add from ▾** ▸ **Falls in HSCs table · 20 genes**. The
   panel says "Added 20 genes from Falls in HSCs table." The genes are copied: later changes to the table do not change
   the signature, and **Add from** always says how many of the genes were new.

```{figure} ../_static/screens/tutorials/sig-add-from.png
:class: screenshot
:alt: The Falls in HSCs signature panel after Add from, with 20 genes selected and the message that 20 genes were added.

Add from copies the table's genes into the signature.
```

6. Make a second table, **Rises in HSCs table**, with the same columns and the same first condition and the HSC column
   **Greater Than** `0.5`: 42 genes. Add its genes to a second signature, **Rises in HSCs**.

Move the cut-off and the lists move: the Gene Table and **Add from** are all it takes.

7. Add a **Cell Plot**. In its **Color** row choose **layer**, then the layer `logged_counts`, then **Falls in HSCs** in the
   item list (under **Gene signatures**). The button after the list shows `z̄`: the score is the z-score mean, the default.
8. Press that button. It lists the six ways to score a signature, each with its symbol: **Z-score mean** (`z̄`), **Mean**
   (`x̄`), **Sum** (`Σ`), **Control-adjusted** (`Δ`), **Fraction of genes** (`g⁺`) and **% of total** (`%`). Two carry a
   note: Control-adjusted "Reads the whole matrix once.", and % of total on `logged_counts` is "compressed by the log: it
   is usually read from counts."

```{figure} ../_static/screens/tutorials/sig-agg-button.png
:class: screenshot
:alt: A Cell Plot coloured by the Falls in HSCs score with the aggregation list open over it, showing six methods and their symbols.

The aggregation button lists every way to score a signature.
```

Choose **Rises in HSCs** as the item and compare the two plots:

```{figure} ../_static/screens/tutorials/sig-umap.png
:class: screenshot
:alt: Two UMAPs side by side coloured by the Falls in HSCs score (left) and the Rises in HSCs score (right).

Falls in HSCs (left, -1.02 to 1.37) and Rises in HSCs (right, -0.68 to 2.18) on every cell.
```

9. Add a **Cell-Gene Plot** with **Groups** **Cell Grouping** ▸ **Cell type**. Add both signatures with **Add genes ▾**, set
   both sections to **One row**, and the **Color** button to **Z-score mean**. One row stands for the whole list.

```{figure} ../_static/screens/tutorials/sig-three-rows.png
:class: screenshot
:alt: A Cell-Gene Plot with one row for each of the Falls in HSCs and Rises in HSCs signatures over 19 cell types.

One dot per cell type for each signature.
```

The two sections sit side by side; to leave empty space between sections, set **Gap between sections (cells)** in **Plot
Options** ▸ **Sections**.

The score per cell type:

| Cell type | Falls in HSCs | Rises in HSCs |
|---|---|---|
| HSC | -0.92 | 1.63 |
| Neutrophil | 1.04 | -0.47 |
| Monocyte | 0.42 | -0.26 |
| T cell | -0.34 | -0.14 |

**Falls in HSCs** is highest in Neutrophil (1.04), Monocyte (0.42), pDC (0.22) and cDC (0.09), and lowest in HSC: the genes
that go down in stem cells are the ones mature granulocytes and monocytes express most. **Rises in HSCs** is highest in
HSC (1.63), then MKP (0.74), LMPP (0.58), CLP (0.37) and Ery P (0.29).

(tut-sig-signed)=
## 2. A signature with two sides

The same two steps give a list over all cells instead of one cell type.

1. Make a **Gene Table** with `kompot_de_Young_to_Old_is_de` and `kompot_de_Young_to_Old_mean_lfc` from the `var` tab, and
   the conditions `kompot_de_Young_to_Old_is_de` **Equals** `Yes` and `kompot_de_Young_to_Old_mean_lfc` **Greater Than**
   `0.05`: 62 genes. Rename it **Rises over all cells table**. A second table with **Less Than** `-0.05` holds 28 genes:
   **Falls over all cells table**.
2. Add a **Gene Signature**, rename it **Response over all cells**, and press **Up/Down**.
3. With **Add as** **Up**, choose **Add from ▾** ▸ **Rises over all cells table**. With **Add as** **Down**, choose
   **Falls over all cells table**. The panel reads "Selected 90: 62 up, 28 down".

```{figure} ../_static/screens/tutorials/sig-panel.png
:class: screenshot
:alt: The Response over all cells signature panel with the Up and Down choice and the count of 62 up and 28 down genes.

A signature with two sides: its score is the up genes minus the down genes.
```

With down genes three of the six scores are greyed in the aggregation button, each with its reason: **Sum** ("Sum cannot
be computed with down genes: a signed sum depends on how many genes each side has."), **Fraction of genes** and **% of
total** (the difference of two fractions, or of two shares, is not a fraction or a share of anything). **Methods ▾** shows
each method's settings, among them **Down genes**: each gene weighs equally, or each side does.

```{figure} ../_static/screens/tutorials/sig-methods.png
:class: screenshot
:alt: The Methods pop-over of the signature with two sides, listing the settings of each scoring method.

The settings of each method, for every layer.
```

4. Add a **Cell Grouping** with two factors, `midres_celltype` and `Age`, and rename it **Cell type by age**. It has 57
   groups; "HSC | Young" has 7 cells and carries the **small** mark.

```{figure} ../_static/screens/tutorials/sig-grouping.png
:class: screenshot
:alt: A Cell Grouping with the factors cell type and age, 57 groups, and the group list with HSC | Young marked small.

Two factors make 57 groups. The three HSC groups have 71, 241 and 7 cells (Mid, Old, Young).
```

5. In a **Cell-Gene Plot** grouped by **Cell type by age** add **Falls in HSCs** and **Response over all cells**, set both
   sections to **One row**, **Color** to **Z-score mean**, **Mode** to **Heatmap**, and press **Swap axes** so that the 57
   groups run along the x axis.

```{figure} ../_static/screens/tutorials/sig-age-rows.png
:class: screenshot
:alt: A Cell-Gene Plot with one row for the Falls in HSCs signature and one for the Response over all cells signature over cell type by age groups.

One row per signature over the 57 groups.
```

| Group | Response over all cells | Falls in HSCs |
|---|---|---|
| HSC, Young / Mid / Old | 0.41 / 0.57 / 0.72 | -0.88 / -0.91 / -0.92 |
| LMPP, Young / Old | 0.12 / 0.29 | -0.63 / -0.63 |
| Neutrophil, Young / Old | -0.28 / -0.15 | 1.04 / 1.05 |
| T cell, Young / Old | -0.11 / 0.05 | -0.34 / -0.32 |

The response score rises from Young to Old in every cell type listed, and averaged over all cell types it goes from -0.04
to +0.05 to +0.10: the two lists were cut over all cells, so this is what they were built to show. **Falls in HSCs** hardly
moves with age in any cell type. "HSC | Young" holds 7 cells, so read Mid against Old for the HSCs.

(tut-sig-lineage)=
## 3. Along the lineage

The neutrophil lineage runs HSC, LMPP, GMP, Myelo P and Neutrophil. A Cell Grouping can hold just those.

1. Add a **Cell Grouping** with one factor, `highres_celltype`, and rename it **Stage**. Press its **Edit ▾**, **Tick
   none**, tick `HSC`, `LMPP`, `GMP`, `Myelo P` and `Neutrophil`, and for the unticked levels choose **Leave out of all
   groups**. The panel reads "5 groups · 3,864 of 8,090 cells in a group" and "4,226 in no group".
2. Add a **Cell-Gene Plot**: **Groups** **Cell Grouping**, **Stage**; **Color** the layer
   `kompot_de_Young_to_Old_fold_change`, **Mean**. **Add genes ▾**: **Falls in HSCs** and **Rises in HSCs**. In **Color ▾**
   choose **RdBu** and type `0` into **Center**.

```{figure} ../_static/screens/tutorials/sig-lineage-dots.png
:class: screenshot
:alt: A dot plot of the Falls in HSCs and Rises in HSCs genes over HSC, LMPP, GMP, Myelo P and Neutrophil, coloured by the mean fold change on a diverging scale. The HSC row is blue for Falls in HSCs and red for Rises in HSCs; the other rows are pale.

The mean fold change of each gene at each stage. Dot size is the fraction of cells with a count above zero.
```

The mean fold change over the genes of each list, read from the plot's **Download CSV**:

| List | HSC | LMPP | GMP | Myelo P | Neutrophil |
|---|---|---|---|---|---|
| Falls in HSCs | -0.678 | -0.049 | +0.008 | +0.011 | +0.020 |
| Rises in HSCs | +0.687 | +0.078 | +0.034 | +0.037 | +0.029 |

Both changes are large in HSC and near zero from LMPP on: the HSC row is the only strongly coloured one.

## 4. The list on the volcano

Add a **Gene Plot** (it opens in 3D: press **3D** to turn that off, and set **Color** to **None (constant)**). **X** `var`
`kompot_de_Young_to_Old_mean_lfc`, **Y** `var` `kompot_de_Young_to_Old_mahalanobis`, and in **Table** choose **Falls in
HSCs**: its genes are drawn in colour.

```{figure} ../_static/screens/tutorials/sig-volcano.png
:class: screenshot
:alt: The Young-to-Old volcano with the Falls in HSCs genes in colour, close to a fold change of zero.

The Falls in HSCs genes on the volcano of the stored call.
```

The genes sit close to a fold change of zero over all cells, though they are among the strongest changes in stem cells:
`S100a9` is -0.051 over all cells and -1.20 in HSCs.

## Check the numbers

- The tables hold 20 (Falls in HSCs), 42 (Rises in HSCs), 62 and 28 genes; **Response over all cells** reads "Selected 90:
  62 up, 28 down"; "Added 20 genes from Falls in HSCs table."
- The grouping **Stage** has 5 groups and 3,864 cells; "HSC | Young" in **Cell type by age** has 7 cells.
- The mean fold change of Falls in HSCs: -0.678 in HSC and -0.049 in LMPP; of Rises in HSCs: +0.687 and +0.078.

## What you learned

- A gene list can come from a cut-off: a table filter, then **Add from**, with a count of what was new.
- The six scores, which of them a signature with two sides allows, and the symbols that name them.
- One row per signature turns a gene list into one number per group, comparable across cell types, ages and the stages
  of a lineage.
- A gene table can compute a column from a group of cells and a layer, and its genes can be added to a signature in one
  step.
- A statistic over all cells (the volcano) and a statistic by cell type can tell different stories about the same gene.

Next: {doc}`group-statistics` takes the per-group statistics further, as plot axes and table columns.
