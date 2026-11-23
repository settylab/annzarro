(cell-gene-plot)=
# Cell-Gene Plot

The **Cell-Gene Plot** shows many genes across groups of cells: the dot plot and the group heatmap of scanpy. Groups
of cells are on one axis, from a {doc}`cell-grouping` or straight from an obs column; genes are on the other, in
**sections**, one per gene signature or gene table, each under its own title. A section shows its genes one row each,
or one row that stands for the whole list.

The numbers are computed on the server over every cell of each group, at any dataset size. The browser receives a few
sums per group and gene, and works out every statistic and scaling from them, so changing what the colour shows, the
scaling, the order or the style asks the server for nothing.

## Draw a dot plot

1. Add a **Cell-Gene Plot** panel. It shows what it still needs: "1. Choose groups [ Groups ▾ ]  2. Add genes
   [ Add genes ▾ ]", each step ticked when done.
2. **Groups**: choose a categorical obs column, such as `cell_type`, or a grouping. The grouping list ends with
   **New grouping…**, which opens a Cell Grouping beside the plot.
3. **Add genes ▾**: choose a gene signature or a gene table (they are listed under their own headings, then **New
   signature…**). It becomes a section showing its genes.
4. Add more sections the same way. The plot draws once the groups and the genes are known.

The plot asks the server once for the groups and every gene together. Adding a gene to a signature asks for that gene
alone, and a gene shown in two sections, or by colour and size at once, is read once.

## The controls

| Group | Controls |
|---|---|
| What | **Groups** · **Mode** (**Dots** or **Heatmap**) · **Genes**: the section list and **Add genes ▾** |
| Values | **Color** · **Scale** · **Size** (dots only) |
| Layout | **Swap axes** · **Cluster ▾** · **Plot Options** |

**Color** and **Size** each choose a statistic and a layer, written `Mean · X` or `% expressing · logged_counts`. They
list what the grouping offers (its **Statistics offered**, {doc}`cell-grouping`), then **Cell count**. With an obs
column as the groups there is no grouping to offer more, so they list mean and % expressing on X. The defaults are
mean for colour and % expressing for size, on X. The statistics, over the cells of a group that have a value:

| Statistic | Is |
|---|---|
| **Mean** | The average, zeros included |
| **% expressing** | The share of the group's cells above the threshold (0 by default), from 0 to 100 |
| **Mean of expressing cells** | The average over the cells above the threshold. A group with no expressing cell gets 0, as scanpy writes it; the hover then says "no expressing cells" |
| **Sum** | The total over the group's cells |
| **SD** | The spread (population SD) |
| **Cell count** | The cells in the group |

A gene with no value in a group (all of its values missing) has no statistic there: no dot, or the gap colour in a
heatmap, never a 0. The strip below the plot counts them ("12 cells of the matrix have no value").

**Size on a signed layer.** On a layer with negative values, such as a scaled X, % expressing cannot be computed. The
dots are then drawn at one size, the size legend says "% expressing is not available on X: X has negative values.
Choose a layer.", the strip says **No size**, and the Size select lists the layers that work first.

### Scale

| Scale | Each colour value becomes |
|---|---|
| **None** | The statistic as computed |
| **0 to 1 per gene** | Stretched from the gene's lowest to its highest group (scanpy's `standard_scale='var'`) |
| **0 to 1 per group** | Stretched across the group's genes (`standard_scale='group'`) |
| **z-score per gene, across groups** | Centred on the gene's mean over the groups shown, in units of their SD |
| **z-score per gene, against all grouped cells** | The group's mean against the mean and SD of every cell in a group |

Groups with no value are skipped in every minimum, maximum, mean and SD, and a constant gene gives 0, as in scanpy.
"All grouped cells" means the cells that are in a group: cells left out of every group do not count. A one-row section
has no cells of its own to pool, so under the last scaling it is z-scored across its own groups; Plot Options says so.

The colour bar names the statistic, the layer and the scaling ("Mean · X", "scaled 0 to 1 per gene"); the size legend
names its statistic, threshold and layer ("% expressing (> 0) · logged_counts").

## Sections

Each section is a row of the list: its title, the source and its gene count, **Genes** or **One row**, and **⋯**
(**Duplicate**, **Remove**, **Open source**, **Move up**, **Move down**). Drag a section by **≡**, or move it with
**Alt+Up** and **Alt+Down**. Every change is one step of the panel's undo.

- The **title** is edited in place; by default it is the source's title. In the plot it is a bracket over the
  section's rows.
- Genes are in the source's order (a signature's list order, a table's current sort) unless clustering reorders them.
  The same source can appear in any number of sections, and a gene in two sections is drawn in both.
- Genes the dataset does not have are left out and counted on the row: "48 genes · 3 not in this dataset". A section
  with no gene the dataset has says so in the plot.
- A section shows up to 2,000 genes: "DE genes has 5,120 genes; a section shows up to 2,000. Filter the table."

**One row** stands for the whole list. Its **Color** and **Size** each choose from one list, in two parts:

| Entry | Is |
|---|---|
| *From the genes* | |
| Mean of the genes' means | Each gene's mean in the group, averaged over the genes. Reads the genes once. |
| Sum of the genes' means | Each gene's mean in the group, added up. |
| Mean of the genes' z-scores | Each gene's group mean as a z-score against all grouped cells, averaged. |
| Mean of the genes' % expressing | Each gene's % expressing in the group, averaged; 0 to 100. |
| *From the score* | |
| `<score option>`, averaged | The signature's score for each cell, averaged over the group, as a cell plot colored by it would average. Computes the score. |
| % of cells with `<score option>` above | Share of the group's cells whose score is above the threshold; 0 to 100. |

The score entries are the signature's offered scores ({ref}`gene-signature-scoring`), with **Offer other scores…**.
The defaults are "Mean of the genes' means" and "Mean of the genes' % expressing", which need no score: choosing only
"From the genes" entries asks for no score at all. A one-row section whose values are not on the gene rows' scale (a
score, or a size that is not 0 to 100) gets its own colour bar or size legend, titled with the section.

## Clustering and order

**Cluster ▾** orders genes, groups or both by hierarchical clustering:

- **Cluster genes**: **Off** or **Within sections**. Sections never mix or change order; one-row sections are not
  clustered.
- **Cluster groups**: **Off**, **All**, or, for a grouping of two or more factors, **Within cell_type** (the first
  factor), which keeps that factor's blocks together.
- The linkage and distance are in Plot Options: **complete** linkage and **Pearson correlation** by default, as
  scanpy's `sc.tl.dendrogram`; **average** and **Ward (Euclidean distance only)** are offered, and Euclidean distance.
  Choosing Ward while correlation is set switches Distance to Euclidean and says so, with **Undo**.

Clustering runs in the browser, off the page's main thread, **on the colour values as displayed**, after scaling.
Two rows are compared over the columns where both have a value. A row with too few values in common with the others,
or a constant row under correlation, is not clustered and goes last ("3 rows not clustered: too few values in common,
or constant. They are at the end."). A block of more than 2,000 rows is not clustered, with the reason. The order is
worked out again from the settings each time and is never stored. **Dendrograms** (Plot Options) draws one per
clustered block.

**Swap axes** puts the genes on the other axis; brackets, strips and dendrograms follow.

## Plot Options

| Section | Controls |
|---|---|
| Dots | **Smallest and largest dot**; **% at the smallest dot** and **% at the largest dot** (scanpy's `dot_min`, `dot_max`); **Size threshold**, when size should count expressing cells above another value than **Color**'s |
| Colors | **Color scale**, **Min**, **Max**, **Center** (for a diverging scale); **Print values in cells** (heatmap) |
| Sections | **Gap between sections** (0 to 3 cells); **Show section titles** |
| Labels | **Gene labels**, **Group labels**; **Plot title**, **Color bar title**, **Size legend title** |
| Clustering | **Linkage**, **Distance**, **Dendrograms** |
| Legend | **Color bar**, **Size legend**, **Strip legend** |
| Totals | **Cells per group** (a bar along the group axis); **Sort groups by size** |

The group axis carries a colour strip in the grouping's colours, one per factor; small groups get "small" after their
label. Gene and group labels thin out when they would overlap, and the hover always names the group, the gene (or the
section and its entry), each value with its statistic and layer, and the group's cells.

**Show as table** lists the plotted values; **Download CSV** gives them in long form, one row per group and row, with
one column per statistic and headers that name the statistic, the layer and the scaling. The camera button in the
plot's toolbar saves the figure as an image, with its brackets, strips, legends and dendrograms.

## Waiting, asking first, refusals

The panel follows the cost tiers of scores: under 5 seconds it draws as you edit, up to a minute it computes without
asking, up to 10 minutes it asks first, and beyond it refuses with the reason. While it waits, the previous drawing
stays.

| State | What the plot says |
|---|---|
| Computing | "Reading 200 genes: 120 of 200", with **Cancel**; after 10% of the work and 5 s, the time left ("about 3 minutes left") |
| Queued | "Waiting for Cell-Gene Plot 2 to finish." when the job ahead is one of this page's, else "Waiting for the server: 1 computation ahead.", or "Sharing the server with 1 other computation." while two long jobs take turns. "Groupings and counts keep working." |
| Out of date | "Showing the previous plot. 2 changes not applied.", with **Update** |
| Asks first | "Reading 200 genes over 95.6 million cells: up to about 6 minutes (10.5 billion stored values).", with **Compute** and **Fewer genes** |
| Refused, cost | "Would take about 25 minutes, so it was not run. Use fewer genes, a smaller subset, or a layer stored by gene (CSC)." |
| Refused, layout | "logged_counts is stored by cell (CSR), so 200 genes mean reading the whole matrix: …" A copy of the layer stored by gene (CSC) makes this fast: see {doc}`../data/preparing-a-store` |
| Too large | "28 groups × 15,000 rows = 420,000 cells of the matrix; the limit is 400,000. Remove a section or use fewer groups." |
| One cell per group | "One cell per group: % expressing is 0 or 100.", with **Show as Heatmap** |

The estimate counts the stored values to read, which the store's index gives before anything is read; time left is
taken from the values read, not from the genes done, because one well-expressed gene can hold a hundred times the
values of a sparse one. The estimate is an upper bound: measured on a 95.6-million-cell dataset stored by gene, 200
well-expressed genes read 10.5 billion stored values in about 3 minutes, against an estimate of about 6.

| Limit | Value |
|---|---|
| Cells of the matrix (groups × rows) | 400,000 |
| Genes per section | 2,000 |
| Groups | 2,000 (the grouping's limit) |
| Rows clustered per block | 2,000 |

(per-cell-views)=
## One row per cell

There is no separate mode for one row per cell. Two recipes give it:

1. **One group per cell.** In a Cell Grouping, **Add factor ▾** → **Cell names**. Each cell shown is a group, as long
   as at most 2,000 cells are shown: choose a subset of up to 2,000 cells first (the badge in the dataset bar,
   {doc}`subsets`). Use the grouping as **Groups**. With one cell per group, % expressing is 0 or 100, so the panel
   offers **Show as Heatmap**: a heatmap of single cells. The matrix limit then allows 200 genes at 2,000 cells.
2. **An ordered strip at any size.** Bin a numeric value finely: in a Cell Grouping, **Add factor ▾** → **Column…**
   → `pseudotime`, then **Method** Equal count and **Bins** 200. Each group is a slice of 1/200 of the cells, in
   pseudotime order, at any dataset size; leave **Cluster groups** off to keep that order. Up to 2,000 genes fit beside
   200 groups. Many tied values merge edges ("200 bins asked, 180 made"), which the card states.

(scanpy-differences)=
## Differences from scanpy

The plot aims at the numbers of `scanpy.pl.dotplot` and `scanpy.pl.heatmap`: mean, % expressing and mean of expressing
cells per group are those of scanpy's `DotPlot` (`dot_color_df`, `dot_size_df`) for the same matrix and groups. Where
it differs, or where an option maps onto something else:

| scanpy | Here |
|---|---|
| `var_names` as a list, or a mapping of titles to lists (`var_group_positions`, `var_group_labels`) | One section per list, with its title as a bracket |
| `groupby`, one key or several | **Groups**: an obs column, or a grouping whose factors are the keys |
| `categories_order` | The level order in the grouping (tick and drag levels) |
| `num_categories` (bins of a numeric `groupby`) | Equal-width bins in a grouping. scanpy bins with `pandas.cut`, whose bins include their upper edge, `(a, b]`; bins here include their lower edge, `[a, b)`, so a cell exactly on an edge falls in the next bin up |
| `use_raw` | Not offered. scanpy reads `.raw` by default when the AnnData has it; AnnZarro does not show `raw` in plots (the Structure tab marks it "not shown in plots"). The same figure needs the same matrix: compare against scanpy with `use_raw=False` and the layer chosen here, or store that matrix as a layer |
| `layer` | The layer of **Color**; **Size** can read another |
| `expression_cutoff` | The grouping's **Expressed above** threshold (`x > t`, as scanpy), and **Size threshold** in Plot Options |
| `mean_only_expressed` | The statistic **Mean of expressing cells**. A group with no expressing cell is 0, as in scanpy, and the hover says "no expressing cells" |
| `dot_size_df` (a fraction, 0 to 1) | % expressing, 0 to 100 |
| `standard_scale` `var`, `group` | **0 to 1 per gene**, **0 to 1 per group**; a constant row gives 0, as in scanpy. Two z-score scalings are added |
| `dot_color_df`, `dot_size_df` as your own matrices | Not offered; colour and size each pick a statistic and a layer |
| `cmap`, `vmin`, `vmax`, `vcenter` | **Color scale**, **Min**, **Max**, **Center** |
| `dot_min`, `dot_max`, `smallest_dot`, `largest_dot` | **% at the smallest dot**, **% at the largest dot**, **Smallest and largest dot** |
| `swap_axes` | **Swap axes** |
| `add_totals` | **Cells per group** and **Sort groups by size** |
| `dendrogram`, `add_dendrogram` | **Cluster ▾** and **Dendrograms**, with scanpy's defaults (complete linkage, Pearson correlation). **The input differs**: scanpy's `sc.tl.dendrogram` clusters the groups on their mean of a representation, `X_pca` by default, which involves every gene; here the groups and the genes are clustered on the colour values as displayed, so the order depends on the genes shown and the scaling chosen |
| `title`, `colorbar_title`, `size_title`; `legend(show_size_legend, show_colorbar)` | **Plot title**, **Color bar title**, **Size legend title**; **Size legend**, **Color bar** |
| `show_gene_labels` (heatmap) | **Gene labels**; labels also thin out when they would overlap |
| Values printed in the cells (`matrixplot`) | **Print values in cells** |
| A heatmap with one row per cell | No mode: see {ref}`per-cell-views` |
| `var_group_rotation`, `log`, `norm`, `size_exponent`, `color_on`, `dot_edge_color`, `grid`, `gene_symbols` | Not offered |

Values that are not finite (NaN, infinity) are left out per gene and cell, so a group's mean is over the cells with a
value; a group with no value for a gene has no statistic, not 0.
