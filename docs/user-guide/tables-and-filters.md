# Tables and filters

A **cell table** lists cells and a **gene table** lists genes, with any columns you choose. You
can sort them, search them, and filter them with conditions joined by AND and OR in groups nested
as deep as you need. A plot linked to a table greys out (or removes) every point the filter
excludes, so a table works as a selection tool for plots.

This page builds a gene table next to the volcano plot of {doc}`cell-and-gene-plots` on
`bm_aging_annzarro.zarr` and filters it to the genes with Mahalanobis distance above 5 and an absolute mean
log fold change above 0.05.

## Choose the columns

1. Add a **Gene Table** panel (here to the right of the volcano plot, with **Split side by side**).
   A new table has one column, **Gene ID** (a cell table: **Cell ID**).
2. Open the table's controls with the chevron in its tile header.

   ```{figure} ../_static/screens/user-guide/tables-columns.png
   :class: screenshot
   :alt: Table controls on the varp tab (1) with "spearman_fold_change: H2-Q7 (focused)" ticked (2); Selected Columns (3) listing two var columns and the varp column; Apply Changes (4); Export CSV (5); Show entries.

   Table controls of a gene table.
   ```

3. **Available Columns** (1) has one tab per source. A gene table has `var`, `varm`, `varp`, `layers` and
   **Cell groupings**; a cell table has `obs`, `obsm`, `obsp`, `layers`, **Gene score** and **Cell groupings**.
   The `obs`, `obsm`, `var` and `varm` tabs list their columns and have a search field.
   On the `var` tab, tick `kompot_de_Young_to_Old_mean_lfc` and
   `kompot_de_Young_to_Old_mahalanobis`. On the `varp` tab, add
   `spearman_fold_change: H2-Q7 (focused)` (2): each gene's Spearman correlation with H2-Q7. The
   choices appear under **Selected Columns** (3); the red **×** removes one (hover over a
   shortened name to read it in full).
4. Click **Apply Changes** (4). The table reloads with the new columns.
5. **Show entries** sets the number of rows per page (25 by default).

There are three kinds of tab.

- **Annotation and matrix tabs** (`obs`, `obsm`, `var`, `varm`) list every column, with a search field.
- **Single-item tabs** (`layers`, `obsp`, `varp`) list the columns the table already holds, then one **add row**:
  `[item ▾] [layer or matrix ▾] [Add column]`. The item select lists the focused cell or gene first, then those locked
  in plots ({doc}`focus-and-lock`), then those already in the table, each once:

  | Item ends in | Meaning |
  |---|---|
  | `(focused)` | the focused cell or gene |
  | `(fixed in *plot title*)` | a cell or gene some plot is locked to |
  | `(in this table)` | a column the table already holds, so it can be removed |

  A cell table offers obsp rows and layer columns (genes); a gene table offers varp rows and layer rows (cells).
  A column keeps the cell or gene it was added for: adding `H2-Q7 (focused)` and then focusing Cd74 leaves the column
  `spearman_fold_change: H2-Q7`, and the table is not rebuilt. To add Cd74's row, choose it in the add row while Cd74 is
  focused. A link, panel set or session that names a column only as "the focused gene" (or cell) instead of by name gets
  that column pinned when it opens: to the gene or cell the view itself focuses, with the filter conditions on it kept.
  If the view focuses none, the column is removed with its conditions and a notice says so. No table column follows the
  focus.
- **Source tabs** (**Gene score**, **Cell groupings**) list every signature, gene table or grouping, open or closed, by
  its title. Under each are the table's columns from it, then an add row with a layer, an **aggregation button** and
  **Add column**. The button shows the aggregation's symbol and opens the list of aggregations with their names; one that
  cannot be computed on the layer is greyed out, and its tooltip says why. A column from these tabs is shown with its
  symbol before its name.

  | Symbol | Aggregation |
  |---|---|
  | z̄ | z-score mean |
  | x̄ | mean |
  | c⁺ | fraction of cells |
  | % | % of total (a score) |
  | x̄⁺ | mean of expressing cells |
  | Σ | sum |
  | σ | SD |
  | Δ | control-adjusted |
  | g⁺ | fraction of genes (a score) |

  The tabs for layers, obsp, varp, Gene score and Cell groupings have no search field: they list only what the table holds.
  An add row keeps your choices when the chooser is rebuilt, for example when a panel is renamed.

### Cell groupings in a gene table

On a gene table, the **Cell groupings** tab adds a column holding one number per gene: a statistic over the cells of one
group of a Cell Grouping ({doc}`cell-grouping`). The add row is `[group ▾] [layer ▾] [aggregation] [Add column]`. The
group list shows the groups by the names you gave them. The statistics are those of a Gene Plot coloured by a cell group,
and each gene gets the same number. A column is named *group*: *statistic* · *layer*, for example
`B cell: mean · logged`, and an export names the grouping too (`Cell types › B cell: mean · logged`).

- The column follows the cells shown, so a change of the cell subset recomputes it, and its header says `(computing)`
  until the numbers arrive. It can be sorted and exported like any other.
- A second statistic of the same group and layer is read from the numbers already held and asks the server for nothing.
  Z-score mean is a request of its own. It is available when the layer is stored by columns (CSC) and greyed out, with the
  reason, otherwise.
- Renaming the grouping updates the heading and the export name. If the group has changed since you added the column it
  still draws, and a notice offers **Keep**; if the group or the grouping is gone the notice offers **Remove column**.
- A grouping that is built from the table can be shown in it but not filtered on, and its heading says so.

## Undo a change to the table

**Undo** in the table's controls (beside **Methods ▾** and **Export CSV**) takes back the last change to the table's
settings: the columns, the filter, the search and its options, the rows per page, **Methods ▾** (a Cell Table), and **Score
methods ▾** (a Gene Table). Its title says what it undoes ("Undo: change the filter"), and it is disabled when there is
nothing to undo. Changes of one kind made close together, such as typing in the search box, are one step, and a table keeps
its last 50 steps. The table is built again from the settings it had, as a link would build it.

The sort order is not a step: it is not part of what a table saves (a link does not carry it either), so Undo leaves it as
it is. Nor are the page shown and the scroll position. A change that comes from outside the table (a line drawn
on a plot, a panel set, a link) starts the steps afresh, so Undo never goes back to a state unrelated to what is on screen.
**Back** and **Forward** of the browser are separate and keep working: they rebuild the table from the view they step to,
which also starts its steps afresh, and an undo is recorded in the address like any other change.

## Sort and search

- Click a column header to sort ascending; click again for descending. Here, two clicks on
  `kompot_de_Young_to_Old_mahalanobis` put H2-Q7 (15.2217) first.
- The search box above the table filters rows by text in any column. The buttons next to it
  switch on regular expressions (`.*`), smart search (the wand; on by default) and case
  sensitivity (`Aa`). Smart search finds rows holding every word typed, in any order; it does not
  apply to a regular expression, which is searched as written: `Mid|Old` finds rows with either
  (the wand is greyed out while `.*` is on). A plot filtered by the table and **Export CSV** use
  the same rows.
- Click a **Gene ID** (or **Cell ID**) to make it the focused gene (cell). The focus history and
  every focus-dependent panel follow ({doc}`focus-and-lock`).

## Filter with AND, OR and nested groups

The **Advanced Search** box above the table builds conditions on any column.

1. Click **Add Condition**. Choose the column `kompot_de_Young_to_Old_mahalanobis`, the condition
   **Greater Than** and type `5`. The table shows 369 of 16,285 genes.
2. Click **Add Condition** again: `kompot_de_Young_to_Old_mean_lfc`, **Greater Than**, `0.05`.
   Both conditions are joined by **AND**: 109 genes.
3. Click the **>** button of the second condition. It moves into a new sub-group, drawn indented
   with its own **Add Condition** button.
4. In the sub-group, click **Add Condition**: `kompot_de_Young_to_Old_mean_lfc`, **Less Than**,
   `-0.05`.
5. Click the sub-group's logic bar (it reads **AND**) to switch it to **OR**.

The filter now reads mahalanobis > 5 AND (mean_lfc > 0.05 OR mean_lfc < −0.05), and the table
shows 159 of 16,285 genes.

```{figure} ../_static/screens/user-guide/tables-searchbuilder.png
:class: screenshot
:alt: The Advanced Search box: a condition mahalanobis greater than 5 (1), and an indented OR group (3) with mean_lfc greater than 0.05 and mean_lfc less than -0.05; the sub-group's outdent button (2); the info line "Showing 1 to 25 of 159 entries (filtered from 16,285 total entries)" (4).

A condition (1), a nested OR group (3) with the button that moves a condition out of it again (2),
and the resulting count (4).
```

To select an area of a plot rather than type numbers, draw lines on the plot: each becomes a
condition, and the AND/OR bar then decides whether the lines keep the area or cut it out
({doc}`../tutorials/line-select`, {ref}`tut-ls-area`).

Groups nest further: the **>** of a condition inside a group makes a group inside that group.
**<** moves a condition one level out, **Delete** removes it, the **×** at the lower left of a group
removes that group and **Clear All** removes every condition. Numeric columns offer Equals, Not,
Less Than, Less Than Equal To, Greater Than Equal To, Greater Than, Between, Not Between, Empty and
Not Empty; text columns offer the text conditions (Equals, Contains, Starts With, …).

Equals and Not on a text column list its distinct values to pick from. A column with more than
10,000 distinct values among the table's rows, such as a barcode, takes a typed value instead:
listing a million barcodes took seconds and made the dropdown unusable.

The 159 can be checked in Python:

```python
import zarr
g = zarr.open_group("bm_aging_annzarro.zarr", mode="r")
m = g["var/kompot_de_Young_to_Old_mahalanobis"][:]
l = g["var/kompot_de_Young_to_Old_mean_lfc"][:]
print(((m > 5) & ((l > 0.05) | (l < -0.05))).sum())   # 159
```

## Filter with a line drawn on a plot

The **Line filter** button before the table's search box (icon only on a narrow table) lets you draw a line on a
plot of its own rows (a cell table: plots of cells; a gene table: plots of genes). The side to the
**right** of the line, looking from where you press the mouse towards where you release it, is
filtered out of the table. The tutorial {doc}`../tutorials/line-select` shows it on a UMAP.

- While the tool is on, the table has a red frame and a red badge **Line filter on: *table*** shows in the dataset bar; hover over it for the help, click it to stop. Closing the table, Close all, loading a panel set or link and opening another dataset also stop the tool.
- While you drag, the line and the shaded side that will be filtered out are drawn. **Shift** snaps
  the line to multiples of 45°. **Esc** stops: a line being drawn is dropped, and the tool is left.
  The tool stays armed after a line, so several lines make an area. Click the button again to leave it.
- On release the table gets the columns of the plot's x and y axes (if it has none of them yet), a
  derived column `y − m·x` named after them, such as `X_umap:1 − 0.1875·X_umap:0`, and one
  condition on that column, joined to the filter by an outer AND. The slope and the intercept are rounded
  to six significant digits, before the preview is drawn and the condition made, so the condition is
  the line you saw. A condition keeps the points on the line.
- A horizontal or vertical line needs no derived column: the condition is on the y or the x column.
- A plot that is not yet linked to a table is linked to this one.
- The side is the one you see on the screen, also when an axis is reversed.
- The columns and conditions are fixed expressions of the original variables: changing the plot's axes
  afterwards changes nothing in the table, and a new line on the plot adds the columns of its new axes.
  A derived column appears in **Selected Columns** and can be removed there. An identical one is
  reused. Delete a line by deleting its condition: a derived column that no condition uses any more is removed from the table with it (the axis columns stay).
- The tool leaves 3D plots, plots in large-plot mode (a table cannot list so many cells) and plots of
  the other kind alone: they get no layer and the mouse works as usual. A plot with a text, date or
  logarithmic axis, or one whose axis is not something the table has columns of, shows a small tooltip
  near the cursor that says why, and still takes the mouse.

Lines drawn counter-clockwise around an area keep it. Drawn clockwise, and with the outer AND switched
to OR, they filter it out.

## Link a plot to a table

1. Open the volcano plot's controls.
2. In **Table** (1), choose **Gene table**. The list offers every gene table on the
   canvas (for a cell plot, every cell table).

   ```{figure} ../_static/screens/user-guide/tables-filter-select.png
   :class: screenshot
   :width: 60%
   :alt: The Table filter row with the drop-down set to "Gene table" (1) and the eye toggle (2).

   Table filter (1) and the remove toggle (2).
   ```

3. Genes outside the table's filter turn flat grey; the 159 genes in it keep their colour.

   ```{figure} ../_static/screens/user-guide/tables-linked.png
   :class: screenshot
   :alt: Left, the volcano plot with most genes grey and 159 genes coloured by Spearman correlation with H2-Q7. Right, the gene table with its nested filter and 159 entries.

   The volcano plot linked to the filtered gene table.
   ```

4. Click the eye toggle (2) to remove the excluded genes instead of greying them. The plot then
   says how many points it shows (159 of 16,285 genes) and why, and zooms to the remaining genes.

   ```{figure} ../_static/screens/user-guide/tables-linked-removed.png
   :class: screenshot
   :width: 70%
   :alt: The volcano plot showing only the 159 genes of the table, with the status line "159 of 16,285 genes shown · 16,126 table filter".

   With the eye toggle on, only the table's genes are drawn.
   ```

The link is live: change a condition, and the plot follows. The tutorial
{doc}`../tutorials/cells-and-genes` uses an AND/OR table filter in an analysis ({ref}`tut-cg-andor`). Several plots can follow the same table,
and a cell plot can follow a cell table the same way.

The grey points have no legend entry. Their size follows their own count (a few chosen rows are
not drawn as a solid grey backdrop), and **Plot Options > Points > Not in table** sets a size
scale, opacity and colour for them ({doc}`plot-options`).

```{note}
The grey of excluded points (`rgb(180, 180, 180)` by default) is close to the middle of RdBu, so with a
diverging map, genes with a value near 0 and genes outside the table look alike. Use the eye
toggle, or a colour map without grey, when that matters ({doc}`colour-scales`).
```

## Statistics over a table's cells

A Cell Table has **Methods ▾** beside **Export CSV**. It sets how statistics over the table's cells (the rows that pass
its filter) are computed, on every layer, as a Cell Grouping's **Methods ▾** does for its groups
({doc}`cell-grouping`): it lists **Mean**, **Fraction of cells**, **Mean of expressing cells**, **Sum** and **SD** with their
definitions, and **Expressed above** (0 by default), the value above which a cell counts as expressing. Plots choose the
statistic and the layer; nothing here limits what they can pick. The setting is kept with the table in panel sets and
share links (only when it is not the default), **Reset to defaults** puts it back, and a dot on the button shows that
it is changed. A plot that reads a table's cells this way is a later addition; until then the setting changes no plot.

## Export a table

Click **Export CSV** in the table's controls. The file, named after the table title and the date
(here `Gene_table_2026-10-02.csv`), contains the rows that pass the current filter in the current
sort order, with every displayed column: 160 lines here, a header and 159 genes. Values are
written at full precision (`15.22166232974675`), not as displayed (`15.2217`). With a
{doc}`cell subset <subsets>`, a cell table and its CSV hold the subset's cells only.

The whole filtered view, including the nested conditions, is kept in panel sets and share links;
the view file is
{download}`userguide-gene-table-filtered.json <../_tools/views/userguide-gene-table-filtered.json>`.

```{admonition} What happens on the server
:class: note
A table reads each of its columns once, as one vector each (here two var columns of 16,285
values). Sorting, searching and filtering run in the browser on those vectors and send nothing.
Linking a plot sends nothing either: the plot already holds its vectors and only applies the
table's row set as a mask. A column from `obsp`, `varp` or `layers` is one row or column of that
matrix, read once when it is added.
```

## Score the genes a gene table passes

A gene table can also be the **source of a score** for every cell: the rows that pass its filter are the genes, and
each cell gets one number from them, to colour a plot by or to rank cells in a Cell Table. The table's controls
have **Score methods ▾**, the settings of each score method in a pop-over, and **Distribution**, which opens a Count
Plot of the score. It works exactly as a Gene Signature
does, with the filter in place of ticked genes: see {ref}`gene-table-score`.
