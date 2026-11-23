(cell-grouping)=
# Cell groupings

A **Cell Grouping** divides the cells shown into groups by rule, once, so that every other panel can use the same
groups: to colour a plot, as a column of a cell table, as the groups of a {doc}`cell-gene-plot`, and as an input of a
{doc}`cell-count-plot`. It is the cell-side twin of a {doc}`gene-signature`: a named recipe that is kept in links and
panel sets, never a stored list of cells.

The words the panel uses:

| Word | Means | Example |
|---|---|---|
| **factor** | One rule that gives every cell shown one level | `cell_type`, `Cd3e` in 4 bins, `in Table 1` |
| **level** | One value of a factor | `B cell`, `Cd3e 0.41 to 0.93`, `not in Table 1` |
| **group** | A combination of one level of each factor that holds at least one cell | `B cell \| Old` |
| **grouping** | The panel and its recipe: its factors, in order | `Grouping 1` |

With one factor the groups are its levels. With two, they are the combinations that hold cells: `cell_type` by `age`
gives `B cell | Old`, `B cell | Young` and so on, and a combination with no cell is not a group. Every cell shown is in
exactly one group, or in none when a rule leaves it out (see *Cells in no group*).

Everything is computed on the server, over every cell shown, at any size: grouping a 95-million-cell dataset by three
factors takes a few seconds. The browser holds the group of each cell only while a plot or a table shows it cell by
cell.

## Make a grouping

1. Add a **Cell Grouping** panel (**Create New Panel** → **Cell Grouping**, or **New grouping…** at the end of any
   list of groupings). It opens as `Grouping 1`, with no factor: "Add a factor to divide the cells into groups."
2. Click **Add factor ▾** and choose what to divide by. A row of the usual selects opens in place:

   | Entry | What you choose | The factor it makes |
   |---|---|---|
   | **Column…** | an obs column or an obsm column, as in a Cell Plot | A categorical column gives one level per category at once; a numeric column gives 4 equal-count bins |
   | **Cell names** | nothing more: the obs index | One group per cell, while at most 2,000 cells are shown (see {ref}`per-cell-views`) |
   | **Gene…** | a layer and a gene name; **Use focused gene** fills the box | 4 equal-count bins of the gene's values |
   | **Score…** | a signature or gene table, and one of its offered scores | 4 equal-count bins of the score |
   | **Cell table…** | an open or closed Cell Table | `in Table 1` and `not in Table 1` |
   | **Neighbors of a cell…** | an obsp matrix and a cell name; **Use focused cell** fills the box | 4 equal-count bins of that cell's row |

   The obs column list ends with the other groupings, under **Groupings**: a grouping can be a factor of another
   (up to 4 deep), and its groups are then the levels.
3. Add more factors the same way, up to 8. The groups are counted and listed as soon as the server has them.

A gene or a cell is stored by name. It never follows the focus: "Use focused gene" fills the box once, and the factor
then keeps that gene when the focus moves on.

The panel title is the grouping's name, as with any panel: rename it in the tile's header, and every plot, legend,
table header and export that uses the grouping says the new name.

## Factors

Each factor is a card of one line: its position, its name, its kind and level count, and the first levels with their
cells. **Edit ▾** (or a click on the card) opens the factor's levels or bins in a pop-over beside the panel, so nothing in
the panel grows, moves or scrolls while you edit. The pop-over stays open while you work: every change applies at once
and is one undo step. **Escape**, the **×** in its header, **Edit ▾** again, or a click outside closes it; Escape and
the button put the focus back on **Edit ▾**. Only one pop-over is open at a time. **⋯** offers **Move up**, **Move
down**, **Duplicate**, **Rename levels…** and **Remove**. Drag a card by **≡**, or move the focused card with **Alt+Up**
and **Alt+Down**. The order of the factors is the order of the names and of the groups: the first factor varies slowest.

The toolbar above the cards holds **Add factor ▾**, **Methods ▾**, **Settings** and **Undo**. The list of groups takes
the rest of the panel and is the only part that grows with it.

**A categorical factor** lists its levels with their cells and a box for each:

- Untick a level to stop it being a group of its own. **Unticked levels** go into one level, **Group as 'cell_type
  other'**, or are left out: **Leave out of all groups** puts their cells in no group.
- Drag ticked levels to change their order. **Tick all**, **Tick none** and **Sort by cells** help with long lists.
- **✎** renames a level. The new name is used everywhere the grouping is shown; hovering the level shows what it was.
  A rename never changes which cells are in the group, and never makes the server compute anything.
- A boolean column's levels are the column's name and `not` the name, for example `is_doublet` and `not is_doublet`.
- A column with more than 2,000 levels that hold a cell is refused: "cell_id has 8,090 levels; a factor holds up to
  2,000. Tick the levels to keep, use a subset, or bin a numeric value."

**A table factor** has the levels `in Table 1` and `not in Table 1`. Untick **Keep cells not in Table 1 as a level**
to keep only the cells that pass the table's filter, and put the rest in no group. The factor follows the table: when
its filter changes, the grouping is computed again. **Open table** opens it. A closed table is built in the
background, as a Cell Table would build it; a table cannot list more than 1,000,000 cells, so a table factor needs a
subset of up to 1M cells shown.

(grouping-bins)=
## Bins

A numeric factor (a numeric column, a gene, a score, a cell's row of an obsp matrix) is divided into bins. Its **Edit ▾**
pop-over shows the distribution of the values with the edges drawn on it, and one chip per bin with its name and its
cells. A factor you have just added opens it for you:

| Control | What it does |
|---|---|
| **Method** | **Equal count**: about the same cells per bin. **Equal width**: bins of equal range. **Log-spaced**: equal ratios, for values spanning orders of magnitude. **Manual thresholds**: your thresholds |
| **Bins** | A whole number from 2 to 1,000 |
| **Zero as its own bin** | Cells at exactly 0 form one bin; the method divides the rest. Offered only when no value is negative, and on from the start when at least 25% of the values are 0 (most genes, every row of a neighbour graph) |
| **Edges from** | **cells shown**: the edges follow the subset. **all cells**: the same edges for every subset (hidden for manual thresholds) |
| **Thresholds** | Numbers separated by commas, sorted for you. Drag a line on the chart to move one, or focus it and use the arrow keys |
| **Range** | For equal width and log-spaced bins: a side left on **auto** is taken from the data. Values outside go into the first or last bin, labelled ≤ and ≥ |
| **Freeze thresholds** | Turns today's edges into manual thresholds, so the bins no longer move |

Bins include their lower edge and not their upper one, except the last, which includes both. Edges are computed
exactly over every value, never estimated from a sample. Bin names give the source's short name and the range to three
significant digits: `Cd3e < 0.41`, `Cd3e 0.41 to 0.93`, `Cd3e ≥ 1.6`, and with the zero bin `Cd3e = 0` and
`0 < Cd3e < 0.41`.

The line under the chips names the population the edges came from, "Edges from the 8,090 cells shown." or "Edges from
all 8,090 cells of the dataset.", and says what happened to the data:

- "4 bins asked, 3 made: many cells share the same value, so edges merged." Equal-count edges that coincide merge.
- "312 cells at or below 0 have no bin. Turn on Zero as its own bin to keep them." (log-spaced bins)
- "All cells share one value." The factor then has one level, named for that value, and no edge is invented.
- "41 cells outside the range are in the end bins."

(grouping-subset-changes)=
### When the subset changes

With **Edges from: cells shown**, the default, the edges are computed from the cells shown, so a new subset moves them
and renames the bins. The pop-over says so once, "Edges now come from the 2,431 cells shown.", with **Freeze thresholds**
beside it. Two ways keep the bins where they are, whatever the subset:

- **Freeze thresholds** keeps the current edges as manual thresholds, in one step you can undo. The method then reads
  **Manual thresholds**, and the pop-over says what they were frozen from ("Frozen from equal count on the cells shown.").
- **Edges from: all cells** takes the edges from every cell of the dataset, which no subset changes.

A plot that names **one group** of the grouping by its bin (a set "Group of a grouping" in a Venn or UpSet) notices
when that group's name changes. It keeps drawing the same bin and says "This group has changed: was 'Cd3e 0.5 to
1.75', now 'Cd3e 0.62 to 1.9'.", with **Keep** and **Choose another** (see {ref}`count-group-sets`). With edges from
the cells shown, switching a subset on and off moves such a group between the two names each time, so "Group changed"
can come and go as you toggle. It says the sentence only the first time a name is seen and clears silently when the
name returns; **Keep** makes the set follow its bin from then on. Freeze thresholds, or edges from all cells, ends it
for good: the names stop moving.

## Groups

The status line at the top counts what came out: "28 groups · 8,012 of 8,090 cells in a group", with the cells in no
group and, when the grouping is used, which panels use it. **78 in no group** is a button that lists the reasons
("78 have no value for Cd3e").

The **Groups** list shows each group's colour, name, cells and share of the cells shown. A group under the
small-group threshold carries **small** ("Under 10 cells: statistics are unreliable"). **Search groups** filters the
list. With exactly two factors, **Cross-table** shows the first factor's levels down and the second's across, with
the cells of each combination; an empty combination is a muted 0, because it is not a group.

**The focused gene.** The list also gives the focused gene's mean and % expressing per group, on X. They are
computed only while the panel is visible and the computation would take under 5 seconds; otherwise the column header is a button, **Show Mrpl15**, and a new focus asks nothing until you press it.
A group with no value for the gene shows "—", never 0.

**Export CSV** downloads the list (key, name, cells, share and the focused gene's columns), or the cross-table.
**Export cells** downloads every cell shown with its group, up to 1,000,000 cells.

**Settings** (a button in the toolbar; its pop-over holds):

- **Separator** between the level names of a group, `|` by default (`B cell | Old`).
- **Small groups under** 10 cells: **Keep** them (the default; they are marked), **Collect** them into one group
  "Small groups (under 10 cells)", or **Hide** them (their cells go in no group).

**Methods ▾** (a button in the toolbar) sets how the statistics over a group's cells are computed, for every plot
that reads the grouping and on every layer. Plots still choose the statistic and the layer themselves; nothing here
limits what they can pick. The pop-over lists each statistic with its definition: **Mean**, **% expressing**, **Mean of
expressing cells**, **Sum** and **SD**. Under the two that count expressing cells sits their one parameter:

- **Expressed above** (0 by default, any number from 0 up): a cell counts as expressing when its value is above it.
  Type a number and press **Enter**, or leave the box; a value that is not a number from 0 up is refused with the
  reason and the box goes back to the value in force.

Each change is one step that **Undo** takes back. The groups stay as they are (the threshold is not part of what makes
them), and every Cell-Gene Plot on the grouping reads its genes again at the new threshold, unless a measure of that
plot sets its own ({doc}`cell-gene-plot`). The foot of the pop-over says which plots read the grouping and with what
("Used by: Cell-Gene Plot 1 (mean · logged, % expressing · counts)"), and **Reset to defaults** puts every parameter
back. While a parameter is not at its default the button carries a dot and its tooltip names the setting
("expressed above 2"). **Escape**, the **×** or a click outside closes the pop-over; opening it moves nothing in the
panel.

Names are made in the browser from the levels and their renames; two groups that end up with the same name get
`(2)`, `(3)`. Colours: a grouping of one categorical column takes that column's colours, so it matches a plot coloured
by the column; any other grouping takes the palette in group order. One grouping has the same colours in every panel,
but its colours can change when a new subset changes which groups exist.

### Cells in no group

A cell is in no group when a rule leaves it out: a level unticked with **Leave out of all groups**, a table factor
without its `not in` level, a hidden small group, or no value under a rule that leaves those out. A cell without a
value otherwise gets the level `<name> no value` (a missing category, a NaN, a value at or below 0 under log-spaced
bins without the zero bin). Cells in no group are drawn as missing ("Not in any group") wherever the grouping colours
a plot, and enter no statistic.

## Use a grouping

| Where | How |
|---|---|
| **Cell Plot** colour, x, y, z and hover | Choose **Cell Grouping** in the type list (beside obs, obsm, obsp, layer and **Gene score**), or a grouping at the end of the obs column list, under **Groupings**; **New grouping…** ends the list. Colour draws one legend entry per group, in group order, with the grouping's colours, and every categorical legend option applies. The hover reads `Grouping 1: B cell \| Old` |
| **Cell Table** | The column chooser has a **Cell Grouping** tab. The column shows each cell's group, sorts in group order and filters with **Equals** like a categorical column |
| **Cell-Gene Plot** | As **Groups** ({doc}`cell-gene-plot`) |
| **Cell Count Plot** | As X, Y or **Color by**, and one group of it as a set ({doc}`cell-count-plot`) |
| **Another grouping** | As a factor: its groups become the levels |

A grouping chooses no statistics for the plots built on it: each plot lists every statistic and every layer itself
({doc}`cell-gene-plot`). The grouping sets how they are computed, in **Methods ▾**: a Cell-Gene Plot built on it reads
its **Expressed above** unless a measure sets its own. A link saved by an earlier 0.8.0 build may still carry a
grouping's own list of statistics and layers: it loads without a message, changes nothing, and the grouping's next
edit drops it.

From any of them, **Open grouping** opens the grouping's panel beside it.

**Large plots.** In large-plot mode (more than 1 million cells drawn) a grouping can colour the plot, as a categorical
column can, but not be an axis. The browser holds one byte per cell for up to 255 groups (two above), counted by the
memory guard like a categorical column; a plot whose groups would not fit is refused before anything is asked.

**Loops.** A grouping built from a table that filters on that same grouping would depend on itself. Menus mark such a
choice and say why; a loop that arrives in a link computes nothing and names the panels involved, and one made by your
last edit offers **Undo** in the grouping. A table may still *show* a grouping column built from it, with a note, but
cannot filter on it.

## Computing, waiting and limits

Edits follow the cost tiers of scores. Under 5 seconds they apply as you make them. Longer, they are collected:
"2 changes not applied. About 40 s. **Update groups**", and plots using the grouping keep the previous groups until
you update. Past a minute the panel asks first ("Grouping 95.6M cells will take about 2 minutes."), and past 10
minutes it refuses, saying why. While the grouping computes, its factors stay editable and the plots keep their
previous drawing. Grouping by obs columns is fast at any size; a gene of a layer stored by cell (CSR), a wide obsm
column and a score cost more, and the estimate counts them.

| Limit | Value | What happens |
|---|---|---|
| Factors | 8 | **Add factor** is disabled: "A grouping holds up to 8 factors. Remove one first." |
| Levels of a factor | 2,000 holding a cell | Refused with the count; tick levels, bin, or use a subset |
| Groups | 2,000 | Nothing is computed: "6,840 groups: a grouping holds up to 2,000. Nothing was computed.", with a button to choose the levels of the largest factor |
| One group per cell | 2,000 cells shown | "One group per cell needs at most 2,000 cells shown; 8,090 are shown. Use a subset, or bin a numeric value instead." |
| Table factor | 1,000,000 cells shown | The table cannot be built |
| Neighbors of a cell | 1,000,000 cells shown | Refused, as an obsp row is in a Cell Plot |
| Bins | 1,000 per factor | Checked where you type |
| Groupings inside groupings | 4 deep | "Groupings can use groupings at most 4 deep. Use a column of a deeper grouping instead." |

A source the dataset does not have (after switching datasets, or in a link from another dataset) is kept and marked
"(not in this dataset)", and nothing is computed until you replace or remove it.

## Close, reopen, share

A grouping outlives its panel exactly as a signature does: close the panel and the grouping is still listed, closed,
and still used. **Open grouping** or the panel chooser reopens it. Deleting a grouping that plots or tables use says
how many, and asks a second press. **Duplicate** in the panel chooser makes an independent copy.

Links, panel sets and history hold the recipe only: the factors, their bins and kept levels, renames, the separator,
and the small-group rule. No group, edge computed from data or count is ever stored, so a link
recomputes the same groups from the same data. Edges taken from the cells shown follow the subset of whoever opens
the link; freeze them to send fixed bins.
