(cell-count-plot)=
# Cell Count Plot

The **Cell Count Plot** counts cells: how many fall in each category, bin, rectangle or overlap of sets, or what a
value averages to in each. One panel has nine modes: bar, histogram, pie, 2D histogram, heatmap, density, 2D density,
Venn and UpSet.

Every count is made on the server over every cell shown, and the browser receives only the counts, so the same plot
works at 100 thousand and at 100 million cells, with no large-plot mode of its own.

## Make a plot

1. Add a **Cell Count Plot** panel. It says "Choose X to count cells."
2. **Mode**: what to draw. The list groups the modes: *Counts* (**Bar**, **Histogram**, **Pie**), *Two inputs* (**2D
   histogram**, **Heatmap**), *Smoothed* (**Density**, **2D density**) and *Sets* (**Venn**, **UpSet**).
3. **X** (and **Y** in the two-input modes): any per-cell source a Cell Plot takes, with the same selects: an obs or
   obsm column, a gene of a layer (following the focus, with the lock), a score, a row of an obsp matrix, or a
   {doc}`cell-grouping`.
4. Optionally **Color by**, a further input that divides each bar, curve or slice.

| Control | What it does |
|---|---|
| **Mode** | The kind of plot (below) |
| **X**, **Y** (**Slices** in a pie) | The inputs. A numeric input shows its bins on one line, "Bins: equal width · 50 · auto range", which opens the binning control; a categorical one offers **Choose levels** |
| **Color by** | Divides each bar, curve or slice by a further input: **Stacked**, **Side by side** (**Overlaid** in a histogram) or **100%** |
| **Height** (bar, histogram), **Color** (2D histogram, heatmap, UpSet) | What the bars or rectangles show (below) |
| **Labels** | Printed on bars, cells, slices and regions: **None**, **Count**, **Share** or **Statistic** |
| **Sort by height**, **Reverse**, **Horizontal** | Order and orientation of bars |
| **Plot Options** | **Log count axis**, **Ring** (pie), **Fade by its share** (most frequent level), the density's **Bandwidth adjust**, **Scale curves by level size** and **As an image**, **Save as grouping**, **Show as table** and **Download CSV** |

Switching mode keeps every input: those the new mode uses stay in place, and the others are kept for when you switch
back, listed in one muted line, "Kept for other modes: Y obsm X_umap 1 · Sets: in Table 1, in Table 2".

## Modes

| Mode | Inputs | Counts | Drawn as |
|---|---|---|---|
| **Bar** | X (categorical or binned), Color by | Cells per level, and per level of Color by | Bars, vertical or horizontal |
| **Histogram** | X numeric, Color by | As bar, 50 equal-width bins by default | Bars without gaps, stacked or overlaid |
| **Pie** | Slices (categorical or binned) | Cells per level; the 12 largest are slices and the rest one more | A pie, or a ring |
| **2D histogram** | X and Y numeric | Cells per pair of bins, 100 × 100 by default | Rectangles |
| **Heatmap** | X and Y (categorical or binned) | Cells per pair of levels | Rectangles, with values printed if asked |
| **Density** | X numeric, Color by | 512 bins per level of Color by, smoothed in the browser | Curves |
| **2D density** | X and Y numeric, Color by up to 8 levels | 256 × 256 bins per level, smoothed | Filled contours, or an image |
| **Venn** | 2 or 3 sets | Cells in every region | Circles with counts and shares |
| **UpSet** | 2 to 16 sets | Cells in every exclusive intersection, and each set's size | Intersection bars over a matrix of dots, with set-size bars |

An input the mode cannot use stays selected and the plot says what is missing, with a way out: "Histogram needs a
numeric X. cell_type is categorical." with **Show as Bar**; "Venn shows 2 or 3 sets." with **Show as UpSet**.

## Bins and ranges

A numeric input is binned by the same control as a grouping's factor ({ref}`grouping-bins`), in a compact line that
opens in place. In a count plot the defaults are 50 equal-width bins in a histogram and 100 × 100 in a 2D histogram,
and the limits are 2,000 bins in one dimension and 512 per axis in two, checked where you type ("Enter a whole number
from 2 to 2,000.").

**Values outside a range are left out and counted.** Set a **Range** on an equal-width input and the cells outside it
are not counted, so the tails of a histogram are true; the strip below the plot says how many. (A grouping puts such
cells into its end bins instead, because every cell must be in a group.)

**Bins drawn.** In a histogram and a 2D histogram the binning control has a **Bins drawn** switch for each axis:
**Evenly** draws every bin at the same width, whatever its range, with the ticks at the borders between bins labelled
with the edge values (about twelve labels at most, thinned when there are more bins); **At their values** places each
bin where its values lie, so a wide bin is a wide rectangle. Log, equal-count and manual bins start on Evenly, since
at their values they crowd at one end; equal-width bins start on At their values, where both look the same. Hovering a
bin names its real range ("depth 1.2 to 3.9"), and the zero bin is a slot of its own labelled 0. The switch changes
only how the plot is drawn: the counts, the colour bar, the CSV, the exported figure's data and **Save as grouping** are
the same either way. Pressing **Escape** in the binning control closes it. A density is always drawn at its values.

**Choose levels** on a categorical input keeps the levels you tick, in your order, and either counts the others as one
level or leaves them out.

## Height and colour

| Entry | Shows |
|---|---|
| **Count** | Cells in the bar or rectangle |
| **Share of all cells shown**, **Share within each X**, **Share within each color** | As percent. In a heatmap: **Share of the row**, **Share of the column**, **Share of the total** |
| **Mean of…**, **Sum of…**, **% above…**, **SD of…**, **z-score of…** | A statistic of a per-cell source over the cells of the bar, chosen with a Cell Plot's colour selects; a gene of a layer follows the focus and has the lock. **z-score of…** is the bar's mean against the mean and SD of all counted cells |
| **Most frequent level of…** (2D histogram, heatmap) | Colours each rectangle by its commonest level of a further input, exactly, from the same count; **Fade by its share** fades rectangles where that level is a small majority |

Axis titles name the source and layer ("Mean of Mrpl15 · logged_counts", "% of cells shown").

## Densities

A density is a Gaussian kernel smoothing of the binned counts, with Scott's rule per axis (`h = σ·n^(−1/(d+4))`) times
**Bandwidth adjust** (1 by default, 0.1 to 10). The range runs from the 0.1st to the 99.9th percentile of the values,
padded by three bandwidths, so a few extreme cells do not stretch the curve; cells outside are not counted. The plot
states all of it: "Bandwidth 0.21 (Scott's rule × 1.0), per axis; it ignores correlation between X and Y.", "Range from
the 0.1st to the 99.9th percentile: 82 cells outside are not counted." When very many cells make the bandwidth
narrower than the grid can show, it is raised: "Bandwidth raised to the grid's resolution."

Curves are each scaled to an area of 1 by default; **Scale curves by level size** scales them by their cells instead.
In 2D the bandwidth is per axis and ignores the correlation between X and Y, unlike `scipy.stats.gaussian_kde`.

## Sets: Venn and UpSet

In the *Sets* modes, **Sets** replaces X and Y. **Add set ▾** offers:

| Kind | A cell is in the set when |
|---|---|
| **Cell table…** | It passes the table's filter |
| **Boolean column…** | The column is true |
| **Levels of a column…** | Its category is one of those chosen |
| **Condition on a number…** | Its value of a source is `>`, `≥`, `<` or `≤` a number |
| **Group of a grouping…** | It is in that group of a {doc}`cell-grouping` |

Each set is a row: a letter, its name, its cells, and **⋯** (**Rename**, **Remove**, and the set's own settings). A set
is strictly in or out: a cell without a value (a NaN under a condition, a missing category) is out, and the row says how
many ("312 without a value, counted as out"). Under the list: "Universe: the 8,090 cells shown. 3,402 are in no set."

**Venn** draws 2 or 3 sets as circles, lettered, with each region's count and share of the cells shown; the circles
are not drawn to scale. **UpSet** draws 2 to 16 sets: each bar is an exclusive intersection, so every cell is counted
in exactly one bar. **Sort** (**By size** or **By degree**), **Show top** (40 by default) and **Minimum size** choose
the bars, and the plot states the share of cells in the bars not shown. At 16 sets **Add set** is disabled: "UpSet
shows up to 16 sets."

(count-group-sets)=
### A set that names one group

A set "Group of a grouping" stores the group's key and its name when you chose it. When the grouping changes so that
the same key has another name (most often a bin whose edges moved because the subset changed, see
{ref}`grouping-subset-changes`), the set keeps counting that bin and its row says **Group changed**, with "This group has
changed: was 'Cd3e 0.5 to 1.75', now 'Cd3e 0.62 to 1.9'." and two buttons:

- **Keep** stores the new name and makes the set follow its bin from then on: later moves change the name silently,
  and the row reads "Cd3e 0.62 to 1.9 (follows the bin)".
- **Choose another** opens the set's group menu. Choosing a group again ends following.

The sentence is said once per change. Toggling the subset back to the name you chose clears it silently, and a name
already reported in this session shows only the **Group changed** tag. When several sets change at once, one line says
"3 groups have changed after the subset changed.", with **Keep all** and **Review**. A level you renamed in the grouping
is never a change. A key that is no longer a group says "'Cd3e ≥ 1.75' is no longer a group of 'Grouping 1'.", with
**Choose another**. To stop names moving at all, freeze the grouping's thresholds or take its edges from all cells.

## Limits

Every mode is one request, checked against its limits before anything is read. A plot over a limit says so with the
count and the limit, and offers the fix:

| Mode | Limit | Way out |
|---|---|---|
| Bar, Pie | 200 levels on X: "sample has 380 levels; Bar shows up to 200." | **Bin it**, **Choose levels** |
| Heatmap | 200 × 200 levels | **Bin it**, **Choose levels** |
| Histogram, Density | 2,000 bins; Color by up to 200 levels | **Remove Color by** |
| 2D histogram, 2D density | 512 × 512 bins; Color by up to 8 levels | **Remove Color by** |
| UpSet | 16 sets | |

A set that is a cell table needs at most 1,000,000 cells shown, as a table does. Long counts follow the cost tiers
of scores (Update, asking first, refusing past 10 minutes), with a progress bar after 10 seconds; the previous drawing
stays while a new count runs.

**The strip** below the plot says what was counted: "8,090 cells counted · 78 without a value for total_counts · 41
outside the range".

## Save as grouping, table and CSV

**Save as grouping** (Plot Options, or a click on a bar, slice or rectangle) makes a {doc}`cell-grouping` of the plot's
inputs, X, Y and Color by, so its bars become groups for other plots, tables and the {doc}`cell-gene-plot`. The
dialog states what it makes ("Factors: total_counts (50 bins), age. 214 groups.") and, when the plot left cells out of
a range, that the grouping keeps them: "41 cells outside the range will go into the end bins (a grouping keeps every
cell)." A plot that would make more than 2,000 groups keeps the dialog with **Save** disabled and the reason ("Would
make 6,840 groups; a grouping holds up to 2,000. Use fewer bins first."). Densities and the sets modes have no Save as
grouping.

**Show as table** lists the plotted numbers under the plot; **Download CSV** saves them (levels, cells, share and the
statistic).
