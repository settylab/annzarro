(tut-composition)=
# Which cell states gain and lose with age? Kompot's differential abundance, counted

Kompot tests differential abundance without clusters: it estimates, for each age, how densely cells occupy each cell
state, and the log ratio of the two densities gives every cell a log fold change of abundance, with a posterior tail
probability as its significance {cite:p}`otto2025kompot`. The paper calls a cell state significant at an absolute log
fold change above 1 and a posterior tail probability below 0.05, and its Figure 6F shows, for each annotated cell type,
the fraction of significantly changing cells by direction {cite:p}`otto2025kompot`. Its reading of the young to old
comparison: B and T cells move from naive to memory states, and haematopoietic stem cells (HSCs) accumulate
{cite:p}`otto2025kompot`.

The store holds that comparison per cell. This tutorial finds which annotated states the called cells are, how many,
how the answer depends on the resolution of the annotation, how the call itself depends on its thresholds, and why a
plain count of cells by age is not the same result.

## What you need

- AnnZarro 0.8.0 or later, running locally ({doc}`../getting-started/quickstart`), with `bm_aging_annzarro.zarr` in its
  data directory ({doc}`../data/demo-data`).
- About 20 minutes.
- These fields, all in `obs`:

| Key | What it is |
|---|---|
| `kompot_da_Young_to_Old_lfc` | the log fold change of cell-state density, Old over Young, per cell |
| `kompot_da_Young_to_Old_neg_log10_lfc_ptp` | −log10 of the posterior tail probability (PTP): the probability that the true change has the opposite sign |
| `kompot_da_Young_to_Old_lfc_direction` | the stored call: `up`, `neutral` or `down` |
| `kompot_da_Young_log_density`, `kompot_da_Old_log_density` | the two densities the fold change compares |
| `midres_celltype`, `highres_celltype` | 19 cell types, and 31 finer states |
| `Age`, `Sample`, `Compartment` | Young, Mid, Old; the 16 samples; the sorted fraction (HSPC or Mature) |

(tut-comp-umap)=
## 1. Where the change is

::::{dropdown} Start here: the log fold change beside the cell types
```{literalinclude} ../_static/panelsets/tutorials/tut-composition-da-umap.url.txt
:language: text
```
Panel set file: {download}`tut-composition-da-umap.json <../_static/panelsets/tutorials/tut-composition-da-umap.json>`.
The link is ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

1. Add a **Cell Plot** on the UMAP (**X** `obsm` `X_umap` 0, **Y** `X_umap` 1). **Color**: `obs`,
   `kompot_da_Young_to_Old_lfc`. In **Plot Options**, choose the colour scale `RdBu` and centre it on 0.
2. Add a second **Cell Plot** on the same axes, coloured by `obs` `midres_celltype`.

```{figure} ../_static/screens/tutorials/comp-da-umap.png
:class: screenshot
:alt: Two UMAPs side by side. Left, cells coloured by the abundance log fold change on a blue-grey-red scale from about -3 to 3: red clusters at the right edge of the progenitor body and in parts of the lower left, deep blue in a cluster at the upper left and in a small one at the lower left. Right, the same cells coloured by 19 cell types.

The abundance change (left; red: more frequent in old mice, blue: less frequent) and the cell types (right).
```

Red regions gain cells with age, blue regions lose them. By their position, the deep red cluster at the right is the
HSCs and the blue one at the upper left the mature B cells; the lower left, the T cells, holds both colours. The next
sections count them.

(tut-comp-count)=
## 2. Count the called cells

::::{dropdown} Start here: the stored direction, split by cell type
```{literalinclude} ../_static/panelsets/tutorials/tut-composition-direction-bars.url.txt
:language: text
```
Panel set file: {download}`tut-composition-direction-bars.json <../_static/panelsets/tutorials/tut-composition-direction-bars.json>`.
::::

1. Add a **Cell Count Plot**. **X**: `obs` `kompot_da_Young_to_Old_lfc_direction`. Three bars: 580 cells `up`, 7,018
   `neutral`, 492 `down`.
2. **Color by**: `obs` `midres_celltype`. Of the 580 `up` cells, 273 are HSCs, 110 mature B cells and 92 T cells; of
   the 492 `down` cells, 387 are mature B cells and 102 T cells.

```{figure} ../_static/screens/tutorials/comp-direction-bars.png
:class: screenshot
:alt: A Cell Count Plot with three stacked bars, up, neutral and down, coloured by 19 cell types. The neutral bar is by far the tallest; the up bar is mostly the HSC colour, the down bar mostly the mature B cell colour.

The stored direction, each bar split by cell type.
```

(tut-comp-filled)=
## 3. Each cell type, filled by direction

::::{dropdown} Start here: cell types filled by direction, progenitor to mature
```{literalinclude} ../_static/panelsets/tutorials/tut-composition-celltype-filled.url.txt
:language: text
```
Panel set file: {download}`tut-composition-celltype-filled.json <../_static/panelsets/tutorials/tut-composition-celltype-filled.json>`.
::::

1. Turn the plot round: **X** `midres_celltype`, **Color by** `kompot_da_Young_to_Old_lfc_direction`.
2. Set the arrangement to **Filled**. Each bar now reaches 1, and its colours are the fractions of the cell type's
   cells called `up`, `neutral` and `down`; the axis reads "Fraction of cells in each bar". Order the bars from
   progenitor to mature with **Choose levels**, as the paper's Figure 6F does {cite:p}`otto2025kompot`, and give the
   three directions their colours there.

```{figure} ../_static/screens/tutorials/comp-celltype-filled.png
:class: screenshot
:alt: A Cell Count Plot of 19 cell types from HSC to NK, each bar filled to 1 and split into up (red), neutral (grey) and down (blue). HSC is mostly red; Mature B cell mostly blue with some red; T cell about a third red, a third grey and a third blue; most other bars are grey.

Each cell type's cells by direction, as fractions of the bar. Mature B cells and T cells hold both directions.
```

| Cell type | Cells | Fraction `up` | Fraction `down` |
|---|---|---|---|
| HSC | 319 | 0.86 | 0 |
| Treg | 55 | 0.96 | 0 |
| Mature B cell | 552 | 0.20 | 0.70 |
| T cell | 308 | 0.30 | 0.33 |
| Neutrophil | 2,221 | 0 | 0 |

T cells are split: about a third called up and a third down.

(tut-comp-fine)=
## 4. Resolve the split with the finer annotation

::::{dropdown} Start here: the fine cell types, filled by direction
```{literalinclude} ../_static/panelsets/tutorials/tut-composition-highres.url.txt
:language: text
```
Panel set file: {download}`tut-composition-highres.json <../_static/panelsets/tutorials/tut-composition-highres.json>`.
::::

Set **X** to `highres_celltype` (31 levels).

```{figure} ../_static/screens/tutorials/comp-highres.png
:class: screenshot
:alt: The same filled bars for 31 fine cell types. Mature Naive B cell and Naive CD8 T cell are almost all blue; Memory B cell, Plasma cell and CD8 TEM mostly red.

The fine cell types: the naive states are blue, the memory states red.
```

| Fine cell type | Cells | Fraction `up` | Fraction `down` |
|---|---|---|---|
| Naive CD8 T cell | 100 | 0 | 0.98 |
| CD8 TEM | 81 | 0.86 | 0 |
| Mature Naive B cell | 423 | 0 | 0.91 |
| Memory B cell | 117 | 0.86 | 0 |
| Plasma cell | 12 | 0.75 | 0 |

Inside the mature lineages the change is a loss of naive and a gain of memory states, as the paper reports
{cite:p}`otto2025kompot`. No neutrophil is called either way; how their expression changes is the subject of
{doc}`group-statistics`. The paper's Figure 6F draws these bars from its own analysis {cite:p}`otto2025kompot`; the
fractions here are those of the call stored in `bm_aging_annzarro.zarr`, and the other cell types are in the table of
section 8.

(tut-comp-mean)=
## 5. A statistic instead of a count

::::{dropdown} Start here: the mean log fold change per fine cell type, sorted
```{literalinclude} ../_static/panelsets/tutorials/tut-composition-mean-lfc.url.txt
:language: text
```
Panel set file: {download}`tut-composition-mean-lfc.json <../_static/panelsets/tutorials/tut-composition-mean-lfc.json>`.
::::

A count needs a threshold; a statistic does not.

1. Remove **Color by** (**None (constant)**). Set **Height** to **Statistic of…**; in the **Of** row choose `obs`
   `kompot_da_Young_to_Old_lfc`. The button at the end of the row shows **x̄**: each bar is the mean over its cells.
2. Press **Sort by height**, and set **Labels** to **Statistic**.

```{figure} ../_static/screens/tutorials/comp-mean-lfc.png
:class: screenshot
:alt: Bars of the mean log fold change for 31 fine cell types, sorted from Memory B cell at 1.784 down to Naive CD8 T cell at -2.317, each labelled with its value; Mature Naive B cell is second lowest at -1.465.

The mean abundance change of each fine cell type, sorted, with no threshold.
```

The ends are the same states as before: Memory B cells highest (+1.78), then Tregs (+1.66); Mature Naive B cells
(−1.47) and Naive CD8 T cells (−2.32) lowest. At the coarser annotation the split T cells average to −0.19, close to
no change at all: a mean over a group hides changes that go both ways inside it.

(tut-comp-hist)=
## 6. The continuum

::::{dropdown} Start here: the log fold change of three cell types, overlaid
```{literalinclude} ../_static/panelsets/tutorials/tut-composition-da-histogram.url.txt
:language: text
```
Panel set file: {download}`tut-composition-da-histogram.json <../_static/panelsets/tutorials/tut-composition-da-histogram.json>`.
::::

**Mode** **Histogram**, **X** `kompot_da_Young_to_Old_lfc`, **Color by** `midres_celltype` limited with **Choose
levels** to HSC, T cell and Mature B cell, and **Overlaid**. The footer counts the cells drawn: 1,179 of 8,090.

```{figure} ../_static/screens/tutorials/comp-da-histogram.png
:class: screenshot
:alt: Overlaid histograms of the abundance log fold change for HSC (pink), T cell (orange) and Mature B cell (green). HSCs form one tall peak between about 1.5 and 1.8; Mature B cells a tall peak near -1.7 with a long tail up to about 2.6; T cells two groups, one near -2.6 and one between about 0.5 and 1.8.

The cells of three cell types along the log fold change.
```

The HSCs form one peak, from −0.32 to 1.71 with most cells near 1.7. The T cells are two groups, one near −2.6 and one
above 0.5: the naive and memory states of section 4. The mature B cells peak near −1.7 and spread up to 2.6.

(tut-comp-call)=
## 7. Rebuild the call, then change it

::::{dropdown} Start here: the call as a Cell Grouping, with the UMAP coloured by it
```{literalinclude} ../_static/panelsets/tutorials/tut-composition-call.url.txt
:language: text
```
Panel set file: {download}`tut-composition-call.json <../_static/panelsets/tutorials/tut-composition-call.json>`.
::::

The stored direction is a fixed call. A **Cell Grouping** makes the same call from the two numbers behind it, with the
thresholds in your hands.

1. Add a **Cell Grouping**. **Add factor ▾**, **Column…**, `obs` `kompot_da_Young_to_Old_lfc`, **Add**. Open the
   factor's **Edit ▾**; under **Bins** set **Method** to **Manual thresholds** and type `-1, 1` in **Thresholds**.

```{figure} ../_static/screens/tutorials/comp-bins.png
:class: screenshot
:alt: The Bins section of a factor's Edit pop-over. Method reads Manual thresholds, Thresholds reads -1, 1; under it a histogram of the log fold change with two blue handles at -1 and 1; below, three bins with their cells, 492 below -1, 7,018 between, 580 at or above 1, each with a colour swatch and a pencil.

The log fold change factor's **Edit ▾**: the distribution, the two thresholds (drag a handle or type), and the three
bins with their cells.
```

2. **Add factor ▾**, **Column…**, `obs` `kompot_da_Young_to_Old_neg_log10_lfc_ptp`. **Manual thresholds**, one
   threshold: `1.301`, which is −log10 of 0.05. A cell above it has a posterior tail probability below 0.05.
3. The grouping now has four groups. Open **Cross-table**: the two factors against each other.

| `..._lfc` | `..._ptp` < 1.3 | `..._ptp` ≥ 1.3 |
|---|---|---|
| < −1 | 0 | 492 |
| −1 to 1 | 3,722 | 3,296 |
| ≥ 1 | 0 | 580 |

Every cell beyond ±1 also passes the tail probability, so in the stored comparison the log fold change alone decides the call;
the probability matters only for the 3,296 cells that change less.

4. Back in **List**, name the two called groups: double-click a name (or the ✎ beside it) and type "gained with age"
   and "lost with age". Click a group's colour swatch to set its colour: red and blue, and two greys for the others.
5. Colour a UMAP by the grouping: **Color**, under **Cell groupings**, "Age call".

```{figure} ../_static/screens/tutorials/comp-call.png
:class: screenshot
:alt: Left, the Cell Grouping "Age call" with its two factors and four groups, lost with age 492 cells, within ±1 not significant 3,722, within ±1 significant 3,296, gained with age 580. Right, the UMAP coloured by these groups, red and blue clusters on grey.

The rebuilt call and the cells it picks. The groups are named and coloured in the grouping; every panel that reads it
shows them the same way.
```

Is it the paper's call, cell for cell? A grouping of the stored direction against the log fold change bins answers it:

::::{dropdown} Start here: your call against the stored one
```{literalinclude} ../_static/panelsets/tutorials/tut-composition-check.url.txt
:language: text
```
Panel set file: {download}`tut-composition-check.json <../_static/panelsets/tutorials/tut-composition-check.json>`.
::::

```{figure} ../_static/screens/tutorials/comp-check.png
:class: screenshot
:alt: A Cell Grouping cross-table: rows up, neutral, down of the stored direction; columns lost, between, gained of the log fold change bins. Only the diagonal holds cells, 580 for up and gained, 7,018 for neutral and between, 492 for down and lost.

The stored direction (rows) against the bins at ±1 (columns, renamed with the ✎ of the factor's **Edit ▾**): every cell
is on the diagonal.
```

Now change the call. Drag the handles to −0.5 and 0.5 and watch the groups follow: 1,137 cells gained and 534 lost now
pass the tail probability as well (64 and 40 more do not). The UMAP follows the grouping: the call of the paper's
Figure 6B to 6D, with the thresholds in your hands {cite:p}`otto2025kompot`.

The store holds the young to old comparison only. The paper separates an early phase (young to middle-aged: the mature
compartment, naive to memory) from a late one (middle-aged to old: the progenitors, most of all the HSCs) with two
more comparisons that are not stored {cite:p}`otto2025kompot`.

(tut-comp-table)=
## 8. The call by cell type, as a table

::::{dropdown} Start here: both annotations against the call
```{literalinclude} ../_static/panelsets/tutorials/tut-composition-by-type.url.txt
:language: text
```
Panel set file: {download}`tut-composition-by-type.json <../_static/panelsets/tutorials/tut-composition-by-type.json>`.
::::

A grouping of two factors is a contingency table. With `midres_celltype` as the first factor and the log fold change
bins as the second, **Cross-table** gives the numbers behind sections 3 and 4, and **Export CSV** saves them.

```{figure} ../_static/screens/tutorials/comp-by-type.png
:class: screenshot
:alt: Two Cell Groupings side by side, each in Cross-table view. Left, 19 cell types against lost, between and gained: HSC 0, 46, 273; Mature B cell 387, 55, 110; T cell 102, 114, 92. Right, the first of the 31 fine types, from HSC to Pre-B II cell; the rest scroll.

Cell types (left) and fine cell types (right) against the call: the counts of the filled bars.
```

(tut-comp-age)=
## 9. Why not just count cells by age?

::::{dropdown} Start here: cells per sample, and the cell types within each fraction and age
```{literalinclude} ../_static/panelsets/tutorials/tut-composition-samples.url.txt
:language: text
```
Panel set file: {download}`tut-composition-samples.json <../_static/panelsets/tutorials/tut-composition-samples.json>`.
::::

1. **X** `midres_celltype`, **Color by** `Age`, **Filled**. By this count most HSCs come from old mice (241 of 319,
   7 from young ones), and neutrophils look unchanged.
2. **X** `Sample`, **Color by** `Compartment`. The 16 samples are two sorted fractions, HSPC and Mature, eight each,
   with 322 to 649 cells per sample. A cell type's share of the whole dataset is set by the sort, not by the mouse.
3. A fairer count compares like with like. Make a second **Cell Grouping** of `Compartment` and `Age`. In a Count
   Plot set **X** to **Cell Grouping** and that grouping, **Color by** `midres_celltype`, **Filled**. Within the HSPC
   fraction, the HSC fraction is 0.006 in young and 0.185 in old mice (6 of 1,086 cells, and 235 of 1,270).

```{figure} ../_static/screens/tutorials/comp-samples.png
:class: screenshot
:alt: Left, cells per sample: eight HSPC samples of about 320 to 430 cells in blue, eight Mature samples of about 580 to 650 cells in orange. Right, six filled bars, HSPC and Mature for Young, Mid and Old, each split by cell type; the HSC share at the bottom of the HSPC bars is a sliver for Young and largest for Old.

Left: every sample is one sorted fraction, with similar cell numbers. Right: the cell types within each fraction and age.
```

For the young to old comparison the store holds, the raw count and Kompot agree for HSCs. A share of sorted cells is not
a density over the cell-state space, though: the density needs no cell types to be defined first, every cell carries its
own uncertainty, and the paper's timing of the HSC expansion (middle-aged to old) comes from comparisons not stored here
{cite:p}`otto2025kompot`.

(tut-comp-limit)=
## 10. A limit, on purpose

::::{dropdown} Start here: the 2D histogram of the two densities, coloured by 31 fine cell types
```{literalinclude} ../_static/panelsets/tutorials/tut-composition-ways-out.url.txt
:language: text
```
Panel set file: {download}`tut-composition-ways-out.json <../_static/panelsets/tutorials/tut-composition-ways-out.json>`.
::::

**Mode** **2D histogram**, **X** `kompot_da_Young_log_density`, **Y** `kompot_da_Old_log_density`, **Color by**
`highres_celltype`. The plot is not drawn, and says why:

```{figure} ../_static/screens/tutorials/comp-ways-out.png
:class: screenshot
:alt: A 2D histogram's controls with Color by highres_celltype; in place of the plot the sentence 'Color by highres_celltype has 31 levels; 2D histogram colors up to 8.' and three buttons, Split by another column, Switch to Bar and Remove Color by.

Too many colours for a 2D histogram: the limit, and the ways out.
```

Take **Split by another column ▾** and choose `kompot_da_Young_to_Old_lfc_direction` (3 levels). For the X and Y
bins to hold enough cells to see, set 40 bins on each in their **Bins** pop-overs.

```{figure} ../_static/screens/tutorials/comp-ways-out-split.png
:class: screenshot
:alt: A 2D histogram of the young log density (x) against the old (y), 40 bins each, coloured by the direction: the grey neutral cells lie along the diagonal; a red block sits above it near x = -0.1, y = 1.5; a blue band lies below it near y = 0.6, x from 1.7 to 2.4.

The two densities, coloured by the stored direction. Red cells are denser in old mice than in young ones, blue the reverse; the neutral cells lie near the diagonal.
```

**Undo** steps back to the refusal.

## 11. Keep the result

- **Save as grouping** turns a Count Plot's bars into a Cell Grouping.
- A grouping's **Export CSV** writes the list or the cross-table it shows.
- A plot's **Download CSV** (in **Plot Options**) writes the numbers it draws.

## Check the numbers

| Statement | How to check it in AnnZarro | Result |
|---|---|---|
| the stored direction | Count Plot of section 2, or a grouping of the direction | 580 up, 7,018 neutral, 492 down |
| the rebuilt call | the grouping of section 7 | 580 gained, 492 lost |
| it is the stored call, cell for cell | the cross-table of section 7 | the diagonal only |
| T cells split | the cross-table of section 8, row T cell | 102 lost, 114 between, 92 gained of 308 |
| HSCs by age | a grouping of `midres_celltype` and `Age`, row HSC | 7 Young, 71 Mid, 241 Old |

Do not read the paper's two phases off these counts: they come from comparisons the store does not hold.

(tut-comp-views)=
## Open the views

Each view is also in the **Start here** box of its section; {ref}`tut-start-links` says which part of a link to change
for another server or store location. As panel set files:
{download}`da-umap <../_static/panelsets/tutorials/tut-composition-da-umap.json>`,
{download}`call <../_static/panelsets/tutorials/tut-composition-call.json>`,
{download}`check <../_static/panelsets/tutorials/tut-composition-check.json>`,
{download}`by-type <../_static/panelsets/tutorials/tut-composition-by-type.json>`,
{download}`direction-bars <../_static/panelsets/tutorials/tut-composition-direction-bars.json>`,
{download}`celltype-filled <../_static/panelsets/tutorials/tut-composition-celltype-filled.json>`,
{download}`highres <../_static/panelsets/tutorials/tut-composition-highres.json>`,
{download}`mean-lfc <../_static/panelsets/tutorials/tut-composition-mean-lfc.json>`,
{download}`da-histogram <../_static/panelsets/tutorials/tut-composition-da-histogram.json>`,
{download}`samples <../_static/panelsets/tutorials/tut-composition-samples.json>`,
{download}`ways-out <../_static/panelsets/tutorials/tut-composition-ways-out.json>`. **Load Panel Set**, upload, then
**Load** opens one ({doc}`../user-guide/panel-sets`).

## What you learned

- A per-cell abundance change can be counted by any annotation, and the finer annotation can turn a split into two
  clear answers.
- A Cell Grouping rebuilds a stored call from the numbers behind it, and its thresholds can be moved.
- A grouping of two factors is a cross-table, and its groups can be named and coloured once for every panel.
- Counts by age depend on how the cells were sampled; compare within a sorted fraction.

Next: {doc}`group-statistics`, the expression changes in the same cell types.
