---
orphan: true
---

(tut-signature)=
# Is the stem cell ageing signature kept as cells differentiate? The paper's gene sets as signatures

The Kompot paper reports that many genes change with age only in haematopoietic stem cells (HSCs), so that the change
over all cells stays small. It sorts such genes by their fold change in HSCs, finds that its HSClo genes are "enriched for
processes related to differentiated granulocyte function", and follows 20 of them along the neutrophil lineage. It
reports that "expression levels in older mice returned to near those in younger mice immediately as cells exited the HSC
state and entered differentiation, rather than gradually across the lineage" {cite:p}`otto2025kompot`.

Here you put the paper's own gene lists into **Gene Signature** panels: the 20 granulocyte genes of its Fig. 3H and 3J, and
the genes it labels as up and down in Fig. 3D and 3E. You score them on every cell, per cell type and age, and follow the
granulocyte genes along the same lineage in the stored fold change. See "How this differs from the paper" at the end
for what the store holds differently.

## What you need

- AnnZarro 0.8.0 or later running locally ({doc}`../getting-started/quickstart`) with `bm_aging_annzarro.zarr` in its
  data directory.
- These fields:

| Slot | Key | Used for |
|---|---|---|
| `obs` | `midres_celltype`, `highres_celltype`, `Age` | the groups: 19 and 31 cell types, and Young, Mid and Old |
| `layers` | `logged_counts` | the scores of a signature on every cell |
| `layers` | `kompot_de_Young_to_Old_fold_change` | Kompot's Old minus Young fold change per cell and gene |
| `var` | `kompot_de_Young_to_Old_is_de`, `kompot_de_Young_to_Old_mean_lfc`, `kompot_de_Young_to_Old_mahalanobis` | the 190 genes Kompot calls, and the volcano |

Every number below was read from the application on the store as deposited, by `docs/_tools/shoot_tut_signature.py`, which
performs the steps in a headless browser.

::::{dropdown} Start here: the fold change along the lineage (step 5), with the signatures closed
```{literalinclude} ../_static/panelsets/tutorials/tut-signature-lineage.url.txt
:language: text
```
Panel set file: {download}`tut-signature-lineage.json <../_static/panelsets/tutorials/tut-signature-lineage.json>`.
The link is ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

(tut-sig-paste)=
## 1. The paper's 20 granulocyte genes, pasted

The legend of the paper's Fig. 3J names the genes of its granulocyte set: Cd52, Ncf1, Vim, Ltf, Lcn2, S100a8, Wfdc21,
Hmgb2, Pygl, Hp, Lilrb4a, Fcer1g, Lyz2, Slpi, Camp, Plac8, S100a9, Mgst1, Syk and Ncf2.

1. Add a **Gene Signature** panel and rename it **Granulocyte genes**.
2. Press **Paste or upload**, paste the 20 names (any separator works) and press **Preview**. The preview says "20 will be
   added".
3. Press **Add 20 genes**. The status line reads "Ready, 20 of 20 genes in this dataset."

```{figure} ../_static/screens/tutorials/sig-paste-preview.png
:class: screenshot
:alt: The Gene Signature panel's paste preview with the 20 granulocyte genes and the count that will be added.

The paste preview counts what will be added before anything is.
```

A signature is a recipe, a list of genes. It becomes a colour, an axis or a section of a plot by choosing it where a plot
asks for a source.

4. Add a **Cell Plot**. In its **Color** row choose **layer**, then the layer `logged_counts`, then **Granulocyte genes**
   in the item list (under **Gene signatures**). The button after the list shows `z̄`: the score is the z-score mean, the
   default.
5. Press that button. It lists the six ways to score a signature, each with its symbol: **Z-score mean** (`z̄`), **Mean**
   (`x̄`), **Sum** (`Σ`), **Control-adjusted** (`Δ`), **Fraction of genes** (`g⁺`) and **% of total** (`%`). Two carry a
   note: Control-adjusted "Reads the whole matrix once.", and % of total on `logged_counts` is "compressed by the log: it
   is usually read from counts."

```{figure} ../_static/screens/tutorials/sig-agg-button.png
:class: screenshot
:alt: A Cell Plot coloured by the granulocyte score with the aggregation list open over it, showing six methods and their symbols.

The aggregation button lists every way to score a signature.
```

```{figure} ../_static/screens/tutorials/sig-umap.png
:class: screenshot
:alt: A UMAP coloured by the z-score mean of the 20 granulocyte genes. The neutrophil lineage is at the high end.

The score of the 20 genes on every cell, from -1.14 to 1.35.
```

6. Add a **Cell Grouping** with one factor, `midres_celltype` (**Add factor ▾** ▸ **Column…**), and rename it **Cell type**.
   Add a **Cell-Gene Plot** with **Groups** **Cell Grouping** ▸ **Cell type**, add the signature with **Add genes ▾**, set
   the section to **One row** and the **Color** button to **Z-score mean**. One row stands for the whole list.

The score per cell type: Neutrophil 0.99, Monocyte 0.49, MBE 0.06, Mono P 0.02, cDC 0.00 and Myelo P -0.08 at the top, HSC
-0.79 and T cell -0.59 below. The genes are those of mature granulocytes and monocytes, and stem cells score lowest.

(tut-sig-signed)=
## 2. A signature with two sides: the genes the paper labels up and down

Fig. 3D and 3E label ten genes as up-regulated and ten as down-regulated from Young to Old: H2-Q7, AW112010, H2-Q6, Cirbp,
Gm47283, H2-K1, Ifi27, Fosb, Psmb9 and Fos (up); Dynll1, Banp, Fkbp5, Gm43305, Macf1, Fam111a, Lgals1, Crispld2,
9930111J21Rik2 and Lyn (down).

1. Add a **Gene Signature**, rename it **Up and down in Fig. 3E**, and press **Up/Down**.
2. **Paste or upload** the ten up genes, **Preview**, check that **Add as** reads **Up**, and press **Add 10 genes**.
3. Paste the ten down genes, choose **Down** in **Add as**, and press **Add 10 as down**. The panel reads "Selected 20: 10
   up, 10 down".

```{figure} ../_static/screens/tutorials/sig-panel.png
:class: screenshot
:alt: The Up and down in Fig. 3E signature panel with the Up and Down choice and the count of 10 up and 10 down genes.

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

5. In a **Cell-Gene Plot** grouped by **Cell type by age** add both signatures, set both sections to **One row**,
   **Color** to **Z-score mean**, **Mode** to **Heatmap**, and press **Swap axes** so that the 57 groups run along the x
   axis.

```{figure} ../_static/screens/tutorials/sig-age-rows.png
:class: screenshot
:alt: A Cell-Gene Plot with one row for the granulocyte genes and one for the up and down signature over cell type by age groups.

One row per signature over the 57 groups.
```

| Group | Up and down | Granulocyte genes |
|---|---|---|
| HSC, Young / Mid / Old | 0.31 / 0.43 / 0.58 | -0.74 / -0.77 / -0.80 |
| LMPP, Young / Old | 0.16 / 0.39 | -0.46 / -0.47 |
| Neutrophil, Young / Old | -0.39 / -0.21 | 0.96 / 1.00 |
| T cell, Young / Old | 0.15 / 0.43 | -0.63 / -0.55 |

The score of the genes the paper labels rises from Young to Old in every cell type listed, and averaged over all cell
types it goes from -0.06 to +0.10 to +0.19: these are genes chosen for changing with age over all cells. The granulocyte
genes hardly move with age in any cell type. Read the HSCs with care: "HSC, Young" has 7 cells.

(tut-sig-column)=
## 3. A column of your own, and how many of the paper's genes it finds

Kompot stores a fold change for every cell and gene. The mean of that layer over the HSCs says how much a gene moves in
stem cells, and the Gene Table can show it as a column computed live.

1. Add a **Gene Table**. On its `var` tab tick `kompot_de_Young_to_Old_is_de`.
2. Open its **Cell groupings** tab. For the grouping **Cell type** choose the group `HSC` and the layer
   `kompot_de_Young_to_Old_fold_change`; the button holds `x̄`. Press **Add column**, then **Apply Changes**. The column
   is named "HSC: mean · kompot_de_Young_to_Old_fold_change".
3. In **Advanced Search** add `kompot_de_Young_to_Old_is_de` **Equals** `Yes`, and the new column **Less Than** `-0.3`. The
   strip reads "Showing 1 to 25 of 51 entries". Rename the table **HSC fold change below -0.3**.

```{figure} ../_static/screens/tutorials/sig-table-lo.png
:class: screenshot
:alt: A gene table with the called flag and the HSC mean fold change as columns, two conditions in Advanced Search, and 51 genes.

51 called genes with a mean fold change below -0.3 in HSCs. The column is computed from the layer, live.
```

4. Add a **Gene Signature** **Check**, paste the 20 granulocyte genes, and choose **Add from ▾** ▸ **HSC fold change below
   -0.3 · 51 genes**. The panel says "Added 32 genes from HSC fold change below -0.3. 19 were already selected."

Nineteen of the paper's 20 granulocyte genes pass this cut-off. The twentieth, `Lyz2`, has a mean of -0.26 in HSCs. The
cut-off of -0.3 is this tutorial's own; the paper sorts genes into HSChi, HSCneutral and HSClo sets in its Supplementary
Fig. 11B, and those thresholds are not reproduced here.

```{figure} ../_static/screens/tutorials/sig-add-from.png
:class: screenshot
:alt: The Check signature after Add from, with the message that 32 genes were added and 19 were already selected.

Add from copies the table's genes and says how many were new.
```

(tut-sig-lineage)=
## 4. Along the lineage

The paper follows the neutrophil lineage HSC, LMPP, GMP, Myelo P and Neutrophil. A Cell Grouping can hold just those.

1. Add a **Cell Grouping** with one factor, `highres_celltype`, and rename it **Stage**. Press its **Edit ▾**, **Tick
   none**, tick `HSC`, `LMPP`, `GMP`, `Myelo P` and `Neutrophil`, and for the unticked levels choose **Leave out of all
   groups**. The panel reads "5 groups · 3,864 of 8,090 cells in a group" and "4,226 in no group".
2. Add a **Gene Signature** **Selp** with the single gene `Selp` (type it in **Search genes**, press **Enter**). The paper
   names Selp, from the Hematopoietic Aging Atlas {cite:p}`flohrsvendsen2021`, as "the most consistently deregulated gene
   in aging HSCs", and reports it up-regulated in its mid-to-old comparison. The store holds the Young-to-Old run only,
   in which `Selp` is not among the 190 called genes (its Mahalanobis rank is 231).
3. Add a **Cell-Gene Plot**: **Groups** **Cell Grouping**, **Stage**; **Color** the layer
   `kompot_de_Young_to_Old_fold_change`, **Mean**. **Add genes ▾**: **Granulocyte genes** and **Selp**. In **Color ▾** choose
   **RdBu** and type `0` into **Center**.

```{figure} ../_static/screens/tutorials/sig-lineage-dots.png
:class: screenshot
:alt: A dot plot of the 20 granulocyte genes and Selp over HSC, LMPP, GMP, Myelo P and Neutrophil, coloured by the mean fold change on a diverging scale. The HSC row is blue for the granulocyte genes and red for Selp; the other rows are pale.

The mean fold change of each gene at each stage. Dot size is the fraction of cells with a count above zero.
```

Read from the plot's **Download CSV**, the mean fold change over the 20 genes is -0.568 in HSC, -0.032 in LMPP, +0.007 in
GMP, +0.014 in Myelo P and +0.035 in Neutrophil. Gene by gene: in HSC the lowest are `S100a9` (-1.20), `S100a8` (-1.16)
and `Cd52` (-1.03); in LMPP no gene is below -0.14; in Neutrophil the highest is +0.18. These are the values the paper's
Fig. 3J draws as lines per gene, with its y axis running from about -1.2 to +0.2: a change in HSCs that is gone as soon as
the cells leave the HSC state.

`Selp` goes the other way, +0.636 in HSC, and +0.160 in LMPP, +0.136 in GMP, +0.037 in Myelo P and +0.034 in Neutrophil.

## 5. The same genes on the volcano

Add a **Gene Plot** (it opens in 3D: press **3D** to turn that off, and set **Color** to **None (constant)**). **X** `var`
`kompot_de_Young_to_Old_mean_lfc`, **Y** `var` `kompot_de_Young_to_Old_mahalanobis`, and in **Table** choose **Granulocyte
genes**: its genes are drawn in colour, as in the paper's Fig. 3H.

```{figure} ../_static/screens/tutorials/sig-volcano.png
:class: screenshot
:alt: The Young-to-Old volcano with the 20 granulocyte genes in colour, close to a fold change of zero.

The 20 granulocyte genes on the Young-to-Old volcano.
```

All 20 are among the 190 genes the store marks as called, and over all cells their mean fold change lies between -0.057
and +0.061. `S100a9` is -0.051 over all cells and -1.20 in HSCs. The paper describes such genes as "genes with subtle
aggregate fold change that were nonetheless significant by Mahalanobis distance", and traces part of that signal to
changes "confined to HSCs".

(tut-sig-views)=
## How this differs from the paper

- The gene lists were read from the paper's figures by eye: the legend of Fig. 3J for the granulocyte genes, and the
  labels of Fig. 3D and 3E for the up and down genes. A supplementary table, if the paper has one, is the authority.
- The store's Young-to-Old run calls 190 genes; the paper reports 55 up, 12 down and 125 subtle genes (192) for
  Young-to-Old. This page uses the 190 the store marks.
- The paper's Selp result is a Mid-to-Old comparison within HSCs. The store holds only the Young-to-Old comparison, so
  the Selp numbers above are that contrast's.
- The cut-off of step 3 is the tutorial's. The paper's HSChi, HSCneutral and HSClo sets are in its Supplementary Fig. 11B.

## Check the numbers

- "Selected 20: 10 up, 10 down"; "Added 32 genes from HSC fold change below -0.3. 19 were already selected."
- The grouping **Stage** has 5 groups and 3,864 cells; "HSC | Young" in **Cell type by age** has 7 cells.
- The mean fold change of the 20 granulocyte genes: -0.568 in HSC and -0.032 in LMPP.

## What you learned

- A signature is a recipe: pasted from a list, typed, or copied from a gene table, with or without a down side.
- The six scores, which of them a signed signature allows, and the symbols that name them.
- One row per signature turns a gene set into one number per group, comparable across cell types, ages and the stages
  of a lineage.
- A gene table can compute a column from a group of cells and a layer, and its genes can be added to a signature in one
  step, with a count of what was new.
- A statistic over all cells (the volcano) and a statistic by cell type can tell different stories about the same gene.

Next: {doc}`group-statistics` takes the per-group statistics further, as plot axes and table columns.
