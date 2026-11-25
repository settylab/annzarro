---
orphan: true
---

(tut-dotplot)=
# Where does each gene change with age? Kompot's result as a cell type by gene plot

Kompot scores how each gene responds to age in every single cell, and stores that as a layer
{cite:p}`otto2025kompot`. The tutorial {doc}`cells-and-genes` reads that layer one gene or one cell at a time. Here you
read all of it at once: first a marker dot plot of expression, to learn the panel and to check the annotation, then the
same kind of plot for Kompot's fold change, genes by cell types.

The panel is the **Cell-Gene Plot**: the dot plot and the group heatmap of scanpy, computed on the server over every cell
of each group ({doc}`../user-guide/cell-gene-plot`).

The paper shows this result as a dot plot in its Fig. 3E: "Young-to-Old mean log fold change per cell type for genes
selected from (D). Dot size encodes the fraction of cells expressing the gene." Part 2 builds that plot for every gene the
store marks as called, 190 of them, from the stored layer. The paper reports that "genes ranked highly by Mahalanobis
distance but with subtle fold change exhibited divergent expression patterns across cell types, with upregulation in
some and downregulation in others", and that for many genes the change was "confined to HSCs such that the aggregate
change across the full population of cells remained subtle". Both patterns are visible in step 9.

## What you need

- AnnZarro 0.8.0 or later running locally ({doc}`../getting-started/quickstart`) with `bm_aging_annzarro.zarr` in its
  data directory.
- These fields. The first two layers are stored by cell; the third is Kompot's result:

| Slot | Key | Used for |
|---|---|---|
| `obs` | `midres_celltype` | the 19 cell types, as the groups of the plot |
| `obs` | `highres_celltype` | the 31 finer cell types of step 11 |
| `layers` | `logged_counts`, `raw_counts` | the markers: colour from the log values, dot size from the counts |
| `layers` | `kompot_de_Young_to_Old_fold_change` | Kompot's fold change (Old minus Young) per cell and gene, signed |
| `var` | `kompot_de_Young_to_Old_is_de`, `kompot_de_Young_to_Old_mahalanobis`, `kompot_de_Young_to_Old_mean_lfc` | the 190 genes Kompot calls, and the volcano's two axes |
| `var` | `gene_module_k3` | three gene modules of those 190 genes |

Every number below was read from the application on the store as deposited, by `docs/_tools/shoot_tut_dotplot.py`, which
performs the steps in a headless browser.

::::{dropdown} Start here: the marker plot of part 1, built
```{literalinclude} ../_static/panelsets/tutorials/tut-dotplot-markers.url.txt
:language: text
```
Panel set file: {download}`tut-dotplot-markers.json <../_static/panelsets/tutorials/tut-dotplot-markers.json>`.
The link is ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

(tut-dotplot-markers)=
## Part 1. A dot plot of marker genes

### 1. A signature of the stem cell genes

1. Add a **Gene Signature** panel. Rename it **Stem and progenitor** (click the title in its header).
2. In **Search genes** type `Hlf` and press **Enter**. The gene is ticked and the box clears. Do the same for `Mecom`,
   `Procr` and `Mpl`. The status line reads "Ready, 4 of 4 genes in this dataset."

A signature is a named list of genes, and the Cell-Gene Plot takes any of them as a section
({doc}`../user-guide/gene-signature`).

### 2. The plot

1. Add a **Cell-Gene Plot**. It shows what it still needs as a checklist: **Choose groups** and **Add genes**.

```{figure} ../_static/screens/tutorials/dotplot-checklist.png
:class: screenshot
:alt: The new Cell-Gene Plot with its control row and the two checklist items, Choose groups and Add genes.

A new Cell-Gene Plot asks for two things.
```

2. **Groups**: choose **obs**, then `midres_celltype`. The first item is ticked.
3. **Add genes ▾**: choose **Stem and progenitor**. It becomes a section of the plot, and the plot draws.
4. A new plot starts with **Color** on the layer `cc_counts` and **Size** on `raw_counts`. For the usual dot plot set the
   **Color** layer to `logged_counts`: the colour is then the mean of the log-normalised values, and the dot size the
   fraction of cells with a count above zero.

The control row has one line per measure: `Color [layer ▾] [x̄]` and `Size [layer ▾] [c⁺]`. The symbol button holds the
statistic; step 4 opens it.

### 3. The other lineages

Add one signature per lineage the same way, now with **Paste or upload**: press it, paste the genes into the box, press
**Preview**, then the **Add** button of the preview (it says how many genes it adds). Name each signature and add it to the plot with **Add genes ▾**.

| Signature | Genes |
|---|---|
| Megakaryocyte | `Pf4, Itga2b, Gp9` |
| Erythroid | `Klf1, Gata1, Car1` |
| Myeloid | `Elane, Mpo, Ngp, Ltf, S100a8` |
| Monocyte | `Csf1r, Ccr2, Ly6c2, Irf8` |
| pDC | `Siglech` |
| B cell | `Ebf1, Vpreb1, Cd79a, Cd19, Ms4a1` |
| T cell | `Cd3e, Cd8a, Foxp3` |

Each signature is a section: a card of one line with its position, title and genes, and a bracket over its columns in the
plot. The strip below the plot reads "19 groups × 28 rows".

```{figure} ../_static/screens/tutorials/dotplot-sections.png
:class: screenshot
:alt: A Cell-Gene Plot of eight marker sections over 19 cell types. The section cards are above the plot, the colour bar and size legend with their titles to its right.

Eight sections, 19 cell types. Each lineage lights up in its own cell types.
```

Read the diagonal. The stem cell genes are brightest in HSC (`Hlf` 1.569, `Mecom` 1.294, `Procr` 1.039 on the
colour scale of `logged_counts`), `Pf4` in the megakaryocyte progenitors MKP (1.871), `Car1` and `Klf1` in Ery P (2.033
and 1.057), `Elane` and `Mpo` in Myelo P (2.973 and 2.879), `Ngp` and `Ltf` in Neutrophil (2.76 and 1.978), `Csf1r`
and `Ccr2` in Monocyte (1.553 and 2.099), `Siglech` in pDC (2.542), `Ebf1` and `Cd79a` in Pre-B cell (2.683 and 2.413),
`Cd3e` in T cell (1.767) and `Foxp3` in Treg (1.258). The annotation and the genes agree.

### 4. The size button, and a gene that is everywhere

One column breaks the diagonal: `S100a8` has a dot in every mature cell type. Its mean is 4.236 in Neutrophil but 2.017
in Mature B cell and 1.969 in T cell, and the share of cells with any count is 0.986 and 0.990. A likely reason is ambient RNA from the many neutrophils in the sample rather than expression in those cells; the
threshold below separates the two.

1. Press the **c⁺** button of **Size**. It opens a list of statistics, each with its symbol: Z-score mean (greyed: "Z-score
   mean is signed; dot size cannot show a sign. Use it for Color."), Mean, Fraction of cells, Mean of expressing cells,
   Sum, SD and Cell count. Under the list is the box **Expressed above**.
2. Type `5` into **Expressed above** and press **Enter**. A cell now counts as expressing a gene only with more than five counts.
   Close the list with **Escape** (twice: the first leaves the box).

```{figure} ../_static/screens/tutorials/dotplot-size-button.png
:class: screenshot
:alt: The Size button's list open over the plot: seven statistics with their symbols, Z-score mean greyed with its reason, and the box above under them.

The Size button holds the statistic and the threshold. Z-score mean is greyed here with the reason.
```

The dot of `S100a8` shrinks in every type but Neutrophil, where nearly every cell is above five counts (0.999):

| Cell type | Share of cells above 0 counts | Above 5 counts |
|---|---|---|
| Neutrophil | 1 | 0.999 |
| T cell | 0.99 | 0.448 |
| Mature B cell | 0.986 | 0.415 |
| HSC | 0.113 | 0.013 |

```{figure} ../_static/screens/tutorials/dotplot-s100a8.png
:class: screenshot
:alt: The myeloid section with the group names, at a threshold of 0 on the left and 5 on the right. S100a8's dots outside Neutrophil are smaller on the right.

The myeloid section at a threshold of 0 (left) and 5 (right). Only the Neutrophil dot stays large.
```

Set **Expressed above** back to `0` when you have looked; the button keeps showing the value you typed as `>0`.

### 5. Scale, the z-score mean, and clustering

1. **Scale**: choose **0 to 1 per gene**. Each gene is stretched from its lowest to its highest cell type, so every
   column reaches 1 somewhere (`Hlf` in HSC, `S100a8` in Neutrophil). What is lost is the size of the mean: a gene that
   is barely expressed looks like a strong marker. The colour bar says "scaled 0 to 1 per gene". Set **Scale** back to
   **None**.
2. Press the **x̄** button of **Color** and choose **Z-score mean**. Colour is now each gene's z-score, averaged over
   the group's cells: `Hlf` in HSC is 2.263 SD, `S100a8` in Neutrophil 1.4 SD. The two z-score choices of **Scale**
   are now greyed ("Color is already a z-score."). Choose **Mean** again.
3. **Cluster ▾** opens a pop-over over the plot. Under **Cluster groups** choose **All**. Set **Scale** to **0 to 1 per
   gene**. The cell types are reordered by the similarity of their rows, and a dendrogram is drawn.

```{figure} ../_static/screens/tutorials/dotplot-cluster-menu.png
:class: screenshot
:alt: The Cluster pop-over over the plot, with Cluster genes and Cluster groups, the linkage and distance selects, and the dendrogram check boxes.

The Cluster pop-over. The default is complete linkage on the Pearson correlation of the values as displayed.
```

```{figure} ../_static/screens/tutorials/dotplot-clustered.png
:class: screenshot
:alt: The marker plot with its groups clustered, scaled 0 to 1 per gene, and a dendrogram at its right.

Groups clustered, scaled 0 to 1 per gene. The B cell stages sit together, as do T cell and Treg.
```

The three B cell stages (Pre-B cell, Immature B cell, Mature B cell) end up next to each other, as do T cell and Treg,
Myelo P and Mono P, and Monocyte and cDC.

### 6. Check against scanpy

**Plot Options** has a **Download CSV** in its **Export** section. It holds every number of the plot, one row per
section, gene and group, with the colour and size statistics. The numbers are scanpy's
({ref}`scanpy-differences`): to compare, set **Scale** to **None**, download the CSV and run

```python
import scanpy as sc
adata.X = adata.layers["logged_counts"]
dp = sc.pl.DotPlot(adata, genes, groupby="midres_celltype", use_raw=False)
dp.dot_color_df          # the colour: mean of logged_counts per group
raw = anndata.AnnData(adata.layers["raw_counts"], obs=adata.obs, var=adata.var)
sc.pl.DotPlot(raw, genes, groupby="midres_celltype", use_raw=False).dot_size_df   # the size: fraction of cells above 0
```

with `genes` the 28 genes of the table above. The two agree with the CSV to 3e-7 for the colour and to rounding for the
size (checked here with scanpy 1.11.5).

## Part 2. The same plot for Kompot's fold change

::::{dropdown} Start here: the gene table of the 190 called genes and the fold-change heatmap
```{literalinclude} ../_static/panelsets/tutorials/tut-dotplot-fold-change.url.txt
:language: text
```
Panel set file: {download}`tut-dotplot-fold-change.json <../_static/panelsets/tutorials/tut-dotplot-fold-change.json>`.
::::

(tut-dotplot-fc)=
### 7. The genes Kompot calls, as a table

1. Add a **Gene Table**. On its `var` tab tick `kompot_de_Young_to_Old_is_de`,
   `kompot_de_Young_to_Old_mahalanobis` and `kompot_de_Young_to_Old_mean_lfc`, then press **Apply Changes**.
2. In **Advanced Search** add the condition `kompot_de_Young_to_Old_is_de` **Equals** `Yes`. The strip reads "Showing
   1 to 25 of 190 entries (filtered from 16,285 total entries)". Rename the panel **Kompot DE genes**.

```{figure} ../_static/screens/tutorials/dotplot-de-table.png
:class: screenshot
:alt: A gene table filtered to the 190 genes Kompot calls, with the three var columns and the strip with the count.

The 190 genes Kompot calls, as a gene table.
```

A gene table is a gene list, and every panel that takes genes takes it.

### 8. A second Cell-Gene Plot of the fold change

1. Add a second **Cell-Gene Plot**, **Groups** **obs** `midres_celltype`, and **Add genes ▾** **Kompot DE genes**.
2. Set the **Color** layer to `kompot_de_Young_to_Old_fold_change`. The colour is now the mean fold change of each gene
   in each cell type.
3. Press the **x̄** button. **Fraction of cells** and **Mean of expressing cells** are greyed: "Fraction of cells cannot be
   computed on 'kompot_de_Young_to_Old_fold_change': it has negative values. Choose a layer." The layer is signed, so
   a share above zero means nothing.

```{figure} ../_static/screens/tutorials/dotplot-fc-layer-greyed.png
:class: screenshot
:alt: The Color button's list on the fold-change layer, with Fraction of cells and Mean of expressing cells greyed and the reason printed under each.

On a signed layer the statistics that count cells above zero are greyed, each with its reason.
```

4. **Mode** **Dots**, the default, is the paper's Fig. 3E: colour is the mean fold change, dot size the fraction of cells
   with a count above zero (the **Size** layer stays `raw_counts`). For 190 genes the dots are small; set **Mode** to
   **Heatmap**. In **Color ▾** choose the colour scale **RdBu** and type `0` into **Center**, so that zero is the pale
   middle and gains are red.

(tut-dotplot-fc-read)=
### 9. Read it

```{figure} ../_static/screens/tutorials/dotplot-fc-heatmap.png
:class: screenshot
:alt: A heatmap of 190 genes by 19 cell types in a red and blue diverging scale centred on zero. The HSC row carries the strongest colours.

Kompot's mean fold change, 190 genes by 19 cell types.
```

HSC carries the most colour. Of the 190 genes, 126 have a mean fold change beyond 0.25 in absolute value in HSC, against
9 in Monocyte, 14 in T cell, 12 in Mature B cell and 2 in Neutrophil. The mean absolute fold change is 0.39 in HSC, and
0.06 to 0.11 in most others. Treg (97 genes beyond 0.25, 55 cells) and ILC (57 genes, 13 cells) also stand out; they are
small groups, so their means rest on few cells.

Three genes show what a summary over all cells misses (the last column is the gene's `var` column of that name):

| Gene | HSC | Monocyte | Neutrophil | `mean_lfc` over all cells |
|---|---|---|---|---|
| `H2-Q7` | +0.76 | +0.30 | +0.24 | +0.372 |
| `S100a9` | -1.20 | -0.04 | +0.05 | -0.051 |
| `Apoe` | +0.81 | -0.32 | -0.05 | -0.039 |

`H2-Q7` is red in nearly every cell type: a response everywhere (the paper's Fig. 3E lists it first among the
up-regulated genes). `S100a9` and `S100a8` (-1.16 in HSC) are deep blue in
HSC and white elsewhere, so over all cells their mean is close to zero (-0.051), though they are among the strongest
changes in stem cells. `Apoe` is red in HSC and blue in Monocyte: the same gene changes in opposite directions in two
cell types, and the all-cell mean (-0.039) hides both. `Apoe`, `S100a9` and `S100a8` are among the genes the paper's
Fig. 3E labels as subtle. The most positive HSC value is `Ifitm1` (+0.99), the most
negative `S100a9`.

### 10. Cluster the genes: modules

1. **Cluster ▾**, **Cluster genes** **Within sections**. Genes with similar profiles across cell types move together.

```{figure} ../_static/screens/tutorials/dotplot-fc-clustered.png
:class: screenshot
:alt: The fold-change heatmap with its genes clustered and a dendrogram below the genes.

The genes clustered within their one section.
```

2. The store has three modules of these genes, `gene_module_k3`, made in Python. Add one **Gene Table** per module (the
   column `gene_module_k3` and the condition **Equals** `module 1`, `module 2`, `module 3`), name them **Module 1** to
   **Module 3**, and add them as three sections of a third Cell-Gene Plot with the same layer, colours and
   **Cluster genes** **Within sections**. The tables hold 87, 68 and 35 genes.

```{figure} ../_static/screens/tutorials/dotplot-fc-modules.png
:class: screenshot
:alt: Three heatmap sections, Module 1, Module 2 and Module 3, of the fold-change layer over 19 cell types, each clustered inside itself. Module 1 is red in HSC, modules 2 and 3 blue.

The three stored modules. Module 1 is red in HSC; modules 2 and 3 are blue.
```

::::{dropdown} Start here: the three module tables and their plot (step 10)
```{literalinclude} ../_static/panelsets/tutorials/tut-dotplot-modules.url.txt
:language: text
```
Panel set file: {download}`tut-dotplot-modules.json <../_static/panelsets/tutorials/tut-dotplot-modules.json>`.
::::

The modules behave as blocks. In HSC the mean fold change is +0.46 for module 1, -0.30 for module 2 and -0.34 for
module 3; in Monocyte it is +0.08, -0.02 and -0.01. The modules say which genes go up or down together in stem cells,
and that the rest of the cell types hardly move.

### 11. Finer groups

Set **Groups** to `highres_celltype` (31 cell types). The naive and memory states of the B and T cells are now separate
rows.

```{figure} ../_static/screens/tutorials/dotplot-fc-highres.png
:class: screenshot
:alt: The fold-change heatmap with 31 finer cell types as rows.

The same plot over 31 cell types.
```

Use **Plot Options** for the paper figure: the preset **Publication**, the format **SVG**, and **Download CSV** for the
cell type by gene table of mean fold changes, which the store does not hold. Each change of the plot is a step of
**Undo**.

(tut-dotplot-check)=
## Check the numbers

- The marker plot has 19 groups and 28 rows. `Hlf` in HSC: colour 1.569, size 0.95 (hover over the dot).
- `S100a8`: 4.236 in Neutrophil, 2.017 in Mature B cell; at a threshold of 5 the shares are 0.999 and 0.415.
- The gene table of step 7 shows 190 genes. In the fold-change plot, `Apoe` is +0.81 in HSC and -0.32 in Monocyte, and
  the **Download CSV** has 3,610 rows: 190 genes times 19 cell types.
- The modules hold 87, 68 and 35 genes; module 1 averages +0.46 in HSC.

## What you learned

- A Cell-Gene Plot needs groups and genes. Genes come in sections, from a signature or a gene table, and each section
  has its title.
- **Color** and **Size** each read a layer and a statistic. Fraction of cells is a share from 0 to 1 and is scanpy's
  number; the threshold belongs to the statistic.
- Any layer of cells by genes can be summarised, not only expression: Kompot's fold change by cell type is a heatmap
  with a diverging scale centred on zero.
- A gene table is a gene list, and a statistic over all cells can hide a change that happens in one cell type.

Next: {doc}`signature-score` scores a published signature on these cells and compares it with Kompot's genes.
