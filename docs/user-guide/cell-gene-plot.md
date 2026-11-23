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

1. Add a **Cell-Gene Plot** panel. It shows what it still needs as a checklist, **Choose groups** and **Add genes**,
   each ticked when done.
2. **Groups**: choose **obs** and a categorical column, such as `cell_type`, or **Cell Grouping** and a grouping. The grouping list ends with
   **New grouping…**, which opens a Cell Grouping beside the plot.
3. **Add genes ▾**: choose a gene signature or a gene table (they are listed under their own headings, then **New
   signature…**). It becomes a section showing its genes.
4. Add more sections the same way. The plot draws once the groups and the genes are known.

The plot asks the server once for the groups and every gene together. Adding a gene to a signature asks for that gene
alone, and a gene shown in two sections, or by colour and size on one layer, is read once.

## The controls

| Group | Controls |
|---|---|
| What | **Groups** · **Mode** (**Dots** or **Heatmap**) · **Genes**: the section list and **Add genes ▾** |
| Values | **Color** · **Scale** · **Size** (dots only) · **Height** (3D only) |
| Layout | **Swap axes** · **3D** · **Cluster ▾** · **Color ▾** · **Plot Options** |

**Color** and **Size** each read their own statistic from their own layer, in one row:
`Color [Mean ▾] of [logged ▾]` and `Size [% expressing ▾] of [counts ▾] above [0]`. A common dot plot is exactly this:
the colour from the mean of the log-normalised layer, the size from the share of cells expressing in the raw counts.

- **The statistic select** lists all five statistics, then **Cell count** (which reads no layer, so the layer select
  hides).
- **The layer select** lists every layer of the dataset. A statistic a layer cannot give is greyed out there, with the
  reason as its tooltip; one that can be computed but misleads (a mean of raw counts follows sequencing depth) carries
  the warning as its tooltip. Choosing a statistic the current layer cannot give moves the layer to the first one that
  can, and the status line says so once ("Layer changed to logged: % expressing is not available on X.").
- **The threshold** appears beside a statistic that counts expressing cells (% expressing, mean of expressing cells).
  A cell counts as expressing above it. Left alone, it is the grouping's threshold ({doc}`cell-grouping`), else 0;
  a value typed here is that measure's own, for Color, Size and Height each.

The lists are the same whether the groups are a grouping or an obs column: nothing has to be offered first. A choice
stored in a link that the layer cannot give (% expressing on a scaled X) stays selected, marked "(not available)", and
draws nothing until you choose another layer.

**A new plot** starts with Color as the mean of the log-normalised layer and Size as % expressing in the raw counts,
above 0, when the dataset has both kinds of layer (judged from the stored values, never from layer names); otherwise
both read X. This holds with a grouping as the groups too, so such a plot may read two layers. The statistics, over the cells of a
group that have a value:

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
Choose a layer.", the strip says **No size**, and the Size layer select marks X "(not available)" and lists the
layers that work.

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
has no cells of its own to pool, so under the last scaling it is z-scored across its own groups; **Color ▾** says so.

The colour bar names the statistic, the layer and the scaling ("Mean · X", "scaled 0 to 1 per gene"); the size legend
names its statistic, threshold and layer ("% expressing (> 0) · logged_counts").

**Cluster ▾**, **Color ▾** and **Plot Options** each open a pop-over over the plot. Opening one leaves the panel's
layout as it is. A change applies at once and is one step of **Undo**. A pop-over closes with its button, its **×**,
Escape (from anywhere on the page) or a click outside it; Escape and **×** return the focus to the button. One
pop-over is open at a time.

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

**One row** stands for the whole list. Its **Color** and **Size** open from the row's summary button, and each first
chooses a kind, in two parts:

| Kind | Is |
|---|---|
| *From the genes* | |
| Mean of the genes' means | Each gene's mean in the group, averaged over the genes. Reads the genes once. |
| Sum of the genes' means | Each gene's mean in the group, added up. |
| Mean of the genes' z-scores | Each gene's group mean as a z-score against all grouped cells, averaged. |
| Mean of the genes' % expressing | Each gene's % expressing in the group, averaged; 0 to 100. |
| *From the score* | |
| Score, averaged | The signature's score for each cell, averaged over the group, as a cell plot colored by it would average. Computes the score. |
| % of cells with score above | Share of the group's cells whose score is above the threshold; 0 to 100. |

A score kind then reads `[method ▾] of [layer ▾]`, and the share above a threshold adds `above [0]`. Both selects list
every score method and every layer; a pair the source cannot score is greyed out with the reason, and choosing a
method the layer cannot give moves the layer and says so. A new score starts on z-score mean of X. The method's
parameters are the source's ({ref}`gene-signature-scoring`).
The defaults are "Mean of the genes' means" and "Mean of the genes' % expressing", which need no score: choosing only
"From the genes" entries asks for no score at all. A one-row section whose values are not on the gene rows' scale (a
score, or a size that is not 0 to 100) gets its own colour bar or size legend, titled with the section.

## Clustering and order

**Cluster ▾** orders genes, groups or both by hierarchical clustering:

- **Cluster genes**: **Off** or **Within sections**. Sections never mix or change order; one-row sections are not
  clustered.
- **Cluster groups**: **Off**, **All**, or, for a grouping of two or more factors, **Within cell_type** (the first
  factor), which keeps that factor's blocks together.
- **Sort groups by size**, shown while **Cluster groups** is **Off**: the groups in order of their number of cells.
- **Linkage** and **Distance**: **complete** linkage and **Pearson correlation** by default, as scanpy's
  `sc.tl.dendrogram`; **average** and **Ward (Euclidean distance only)** are offered, and Euclidean distance.
  Choosing Ward while correlation is set switches Distance to Euclidean and says so, with **Undo**.
- **Dendrograms**: **Genes** and **Groups**, each shown or hidden on its own; both are on by default.

Clustering runs in the browser, off the page's main thread, **on the colour values as displayed**, after scaling.
Two rows are compared over the columns where both have a value. A row with too few values in common with the others,
or a constant row under correlation, is not clustered and goes last ("3 rows not clustered: too few values in common,
or constant. They are at the end."). A block of more than 2,000 rows is not clustered, with the reason. The order is
worked out again from the settings each time and is never stored. A dendrogram is drawn for each clustered block,
unless its **Dendrograms** box is cleared.

**Swap axes** puts the genes on the other axis; brackets, strips and dendrograms follow.

## 3D

**3D** draws the matrix as bars standing on a floor of genes by groups, so a value can be read from its height as well
as its colour. It is a view, not a mode: the groups, sections, statistics, scaling, order and clustering stay as they
are, and pressing **3D** again returns to the 2D plot. Turning it on or off is one step of **Undo**.

- **Height** appears under **Size** while 3D is on. **Same as Color**, the default, draws the colour's numbers: its
  statistic, layer, threshold and scaling, so a z-score hangs bars below 0. Any other choice is a statistic of its own,
  picked as **Color** and **Size** are (statistic, layer, threshold) and drawn unscaled. A height on a layer or
  threshold that Color and Size do not read reads each gene once more, and counts towards the limit of values. The
  choice is kept when 3D is off.
- **In dots**, the footprint of each bar is its Size: the bar's area grows with the value, as a dot's does. A heatmap's
  bars all have one footprint.
- **The hover** names the gene, the group and its cells, then Color, Size and Height.
- **Left out.** 3D does not draw dendrograms, colour strips, section brackets, totals or printed values; the status
  strip says so (**3D**). A missing value or a value of 0 has no bar. Above 60 genes or groups their labels are hidden
  and the hover names each bar.
- **The camera.** Turn, zoom and pan with the mouse. The view is kept with the plot (in links and panel sets) without a
  step of **Undo**; **Reset camera** in the plot's toolbar goes back to the default view.
- **Limit.** 3D draws at most 40,000 bars (genes × groups). Above that **3D** is greyed out and says why ("Use fewer
  genes or groups."); a plot saved in 3D that has grown past it is drawn in 2D, and the strip says **2D** with the
  reason.
- **Export.** PNG, JPEG and WEBP work as in 2D. SVG is greyed out in 3D: a 3D scene can only be saved as an image.
  **Download CSV** gains a Height column when Height is not **Same as Color**.

## Color and Plot Options

**Color ▾** holds what sets how the values read:

| Section | Controls |
|---|---|
| Colors | **Color scale**, **Reverse**, **Min**, **Max**, **Center** (for a diverging scale); **Print values in cells** (heatmap); the scaling's help line |
| Dots | **Smallest and largest dot**; **% at the smallest dot** and **% at the largest dot** (scanpy's `dot_min`, `dot_max`). Size's threshold sits beside **Size** in the control grid |

**Reset** puts all of these back to their defaults in one step.

**Plot Options** holds the rest of the figure. It is the same pop-over as the Cell Count Plot's, with this plot's own
defaults and sections:

| Section | Controls |
|---|---|
| Presets | **Default** (the session default, or the built-in look), **Publication** (white, black text and lines, Arial 16), **Bare** (no grid, axis lines or legends) |
| Text | **Font**, **Font size**, **Text color** (**Auto** follows the app theme), **Plot title**, **Title size** |
| Background | **Background** (**Auto** follows the app theme) |
| Axes | **Grid lines** (off by default; on the matrix only), **Grid color**, **Grid width**, **Axis lines**, **Axis color**, **Axis line width**, **Tick marks**; **Gene labels**, **Group labels** |
| Dots | **Dot outline color** and **Dot outline width** (a black 0.5 px ring by default; 0 draws none; heatmap cells have none) |
| Sections | **Gap between sections** (0 to 3 cells); **Show section titles** |
| Legend | **Space** (the legend column's share of the width; empty lets the figure decide), **Columns** and **Entries, at most** (20) of the strip legends; **Color bar**, **Size legend**, **Strip legend**; **Color bar title**, **Size legend title** |
| Totals | **Cells per group** (a bar along the group axis) |
| Margins | Room added on each side, in px, to the room the labels take |
| Export | **PNG**, **SVG** (not in 3D), **JPEG**, **WEBP**; **Width** and **Height** (empty: the size on screen), **2x resolution**; **Download CSV** |
| Apply | **Apply to other Cell-Gene plots**; **Make this the session default**, **Back to built-in** |

Presets, Text, Legend, Export and the plot's own sections start open; the others unfold with a click, and each keeps its state
while the page is open. **Reset** under a section puts its fields back to their defaults. A strip legend with more
levels than **Entries, at most** lists the first ones and a last line "+ 12 more"; one that does not fit its slot is
cut the same way, and two columns hold twice as many. **Apply to other Cell-Gene plots** gives every other Cell-Gene
Plot this plot's look (not its titles), after a question. A plot made from the panel chooser starts on the session
default and follows it until you change its look; see {doc}`plot-options`.

The colour scale is **Reds** by default. Under a z-score scaling the default is **RdBu**, centred at 0, so that
values above and below the mean read as opposite colours. A scale you pick yourself is kept, whatever the scaling.

The group axis carries a colour strip in the grouping's colours, one per factor; small groups get "small" after their
label. Gene and group labels thin out when they would overlap, and the hover always names the group, the gene (or the
section and its entry), each value with its statistic and layer, and the group's cells.

**Download CSV** (Plot Options ▸ Export) gives the plotted values in long form, one row per group and row, with
one column per statistic and headers that name the statistic, its threshold where it has one, the layer and the
scaling ("% expressing (> 1) · counts · not scaled"), so two thresholds stay two columns apart. The image buttons
beside it, and the camera button in the plot's toolbar, save the figure as an image, with its brackets, strips, legends
and dendrograms.

## Waiting, asking first, refusals

The panel follows the cost tiers of scores: under 5 seconds it draws as you edit, up to a minute it computes without
asking, up to 10 minutes it asks first, and beyond it refuses with the reason. While it waits, the previous drawing
stays.

| State | What the plot says |
|---|---|
| Computing | "Reading 200 genes: 120 of 200", with **Cancel**; after 10% of the work and 5 s, the time left ("about 3 minutes left") |
| Queued | "Waiting for Cell-Gene Plot 2 to finish." when the job ahead is one of this page's, else "Waiting for the server: 1 computation ahead.", or "Sharing the server with 1 other computation." while two long jobs take turns. "Groupings and counts keep working." |
| Out of date | "Showing the previous plot. 2 changes not applied.", with **Update** |
| Asks first | "Reading 200 genes over 95.6M cells: up to about 6 minutes (10.5 billion stored values).", with **Compute** and **Fewer genes** |
| Refused, cost | "Would take about 25 minutes, so it was not run. Use fewer genes, a smaller subset, or a layer stored by gene (CSC)." |
| Refused, layout | "logged_counts is stored by cell (CSR), so 200 genes mean reading the whole matrix: …" A copy of the layer stored by gene (CSC) makes this fast: see {doc}`../data/preparing-a-store` |
| Too large | "28 groups × 15,000 rows = 420,000 cells of the matrix; the limit is 400,000. Remove a section or use fewer groups." |
| Too many values | "12 groups × 40,000 values per group = 480,000 values; the limit is 400,000. Color and Size read different layers, so each gene is read twice." |
| One cell per group | "One cell per group: % expressing is 0 or 100.", with **Show as Heatmap** |

When Color and Size read different layers, or one layer at two thresholds, each gene is read twice: the request
still goes out once, the notices say so ("Reading 40 genes on 2 layers"), the estimate and the progress count both
reads, and reading takes about twice as long. Switching back and forth costs nothing once both are held.

The estimate counts the stored values to read, which the store's index gives before anything is read; time left is
taken from the values read, not from the genes done, because one well-expressed gene can hold a hundred times the
values of a sparse one. The estimate is an upper bound: measured on a 95.6-million-cell dataset stored by gene, 200
well-expressed genes read 10.5 billion stored values in about 3 minutes, against an estimate of about 6.

| Limit | Value |
|---|---|
| Cells of the matrix (groups × rows) | 400,000 |
| Values the server gathers (groups × each gene once per layer and threshold) | 400,000 |
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

**What is equal.** For the same matrix and the same groups, the numbers of the plot are scanpy's: the CSV of a
Cell-Gene Plot equals `sc.pl.DotPlot`'s `dot_color_df` and `dot_size_df`, and `sc.pl.MatrixPlot`'s `values_df`, within
one part in a billion. This is tested against scanpy 1.12 through the plot's own **Download CSV**, on X, on a log layer
and on a counts layer, with groups from obs columns and from equal-width bins, with an expression cutoff of 0 and 0.5,
with `mean_only_expressed` off and on, and with `standard_scale` none, `var` and `group`, as dots and as a heatmap.

How scanpy's options map onto the plot:

| scanpy | Here |
|---|---|
| `dot_color_df` (`mean_only_expressed=False`) | **Color**: Mean. The cutoff does not enter, in either |
| `dot_color_df` with `mean_only_expressed=True`, `expression_cutoff=t` | **Color**: Mean of expressing cells, threshold `t` |
| `dot_size_df` with `expression_cutoff=t` | **Size**: % expressing, threshold `t` (a value counts when it is above `t`, as in scanpy) |
| `layer` | The layer of **Color**; **Size** can read another |
| `standard_scale='var'` | **Scale**: 0 to 1 per gene |
| `standard_scale='group'` (`'obs'` in a heatmap) | **Scale**: 0 to 1 per group |
| `var_names` as a list, or as a mapping of titles to lists (`var_group_positions`, `var_group_labels`) | One section per list, its title drawn as a bracket |
| `groupby`, one key or several | **Groups**: an obs column, or a grouping whose factors are the keys |
| `categories_order` | The level order in the grouping (tick and drag levels) |
| `num_categories` | Equal-width bins of a grouping's factor (see below) |
| `cmap`, `vmin`, `vmax`, `vcenter` | **Color scale**, **Min**, **Max**, **Center** |
| `dot_min`, `dot_max`, `smallest_dot`, `largest_dot` | **% at the smallest dot**, **% at the largest dot**, **Smallest and largest dot** |
| `swap_axes` | **Swap axes** |
| `add_totals` | **Cells per group** and **Sort groups by size** |
| `dendrogram`, `add_dendrogram` (`sc.tl.dendrogram`'s defaults) | **Cluster ▾** and **Dendrograms**: complete linkage and Pearson correlation by default (see below for the input) |
| `title`, `colorbar_title`, `size_title`; `legend(show_size_legend, show_colorbar)` | **Plot title**, **Color bar title**, **Size legend title**; **Size legend**, **Color bar** |
| `show_gene_labels` (heatmap) | **Gene labels**; labels also thin out when they would overlap |
| Values printed in the cells (`matrixplot`) | **Print values in cells** |
| A heatmap with one row per cell | No mode: see {ref}`per-cell-views` |
| `dot_color_df`, `dot_size_df` as your own matrices | Not offered: Color and Size each pick a statistic and a layer |
| `var_group_rotation`, `log`, `norm`, `size_exponent`, `color_on`, `dot_edge_color`, `grid`, `gene_symbols` | Not offered |

Two differences of notation, not of value: **Color** and **Size** each have their own threshold where scanpy has one
`expression_cutoff` for both, and the CSV gives the colour statistic as computed and, when a scaling is on, also as
displayed.

**The intended differences.** Each is deliberate, and each is tested.

1. **% expressing is a percentage.** scanpy's `dot_size_df` is a fraction from 0 to 1; % expressing here runs from 0
   to 100, so a CSV value is 100 times scanpy's.
2. **Bins of a numeric column (`num_categories`).** Equal-width bins here include their lower edge, `[a, b)`, the last
   bin both edges. scanpy bins with `pandas.cut`, whose bins include their upper edge, `(a, b]`. A cell exactly on an
   inner edge is therefore in the upper bin here and in the lower one in scanpy. On a column whose values sit on round
   numbers, such as a pseudotime in steps, that can move a tenth of the cells or more; on continuous values it moves
   almost none. pandas also widens its lowest edge by 0.1% of the range, which moves no cell.
3. **`use_raw`.** scanpy reads `.raw` by default when the AnnData has one. AnnZarro never offers `raw` as a layer (the
   Structure tab marks it "not shown in plots", and a grouping that lists `raw` among its layers still does not get
   it). The same figure needs the same matrix: call scanpy with `use_raw=False` and the layer chosen here, or store the
   matrix you want as a layer.
4. **A group with no expressing cell.** Mean of expressing cells is then 0, the number scanpy writes. The hover says
   "no expressing cells", and so does the CSV's **Note** column, so that 0 is not read as a measured mean. A measured 0,
   such as a mean of 0, carries no note.
5. **A layer with negative values.** % expressing and mean of expressing cells are not computed on a layer with
   negative values, such as a scaled X: the dots are drawn at one size, the plot says "% expressing is not available
   on X: X has negative values. Choose a layer.", and the CSV has no size column. scanpy computes the share above the
   cutoff on any matrix. The mean on such a layer still equals scanpy's.
6. **A constant gene under scaling.** 0 to 1 per gene gives 0 for a constant gene, as scanpy does, never NaN. The two
   z-score scalings, which scanpy does not have, also give 0. SDs are population SDs (ddof 0), groups with no value are
   skipped, and nothing is clipped.
7. **The dendrogram's input.** The method is `sc.tl.dendrogram`'s by default, complete linkage on Pearson correlation,
   and on the same matrix the order is scipy's leaf order, for groups and for genes alike. The input differs:
   `sc.tl.dendrogram` clusters the groups on their mean of a representation, `X_pca` by default, which involves every
   gene; here groups and genes are clustered on the colour values as displayed, after scaling. So the order depends on
   the genes shown and on the scaling: 0 to 1 per gene can reorder the groups, while 0 to 1 per group cannot (a linear
   change of one group's values leaves its correlations as they were). A constant gene, or one with fewer than two
   values in common with another, cannot be correlated: it is not clustered, is drawn last in its block, and the panel
   counts it. **Cluster ▾** says "on the values as displayed".

Values that are not finite (NaN, infinity) are left out per gene and cell, so a group's mean is over its cells with a
value, and a group with no value for a gene has no statistic, not 0.
