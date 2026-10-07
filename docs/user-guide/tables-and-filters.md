# Tables and filters

A **cell table** lists cells and a **gene table** lists genes, with any columns you choose. You
can sort them, search them, and filter them with conditions joined by AND and OR in groups nested
as deep as you need. A plot linked to a table greys out (or removes) every point the filter
excludes, so a table works as a selection tool for plots.

This page builds a gene table next to the volcano plot of {doc}`cell-and-gene-plots` on
`bm_aging.zarr` and filters it to the genes with Mahalanobis distance above 5 and an absolute mean
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

3. **Available Columns** (1) has one tab per source: `var`, `varm`, `varp` and `layers` for a gene
   table; `obs`, `obsm`, `obsp` and `layers` for a cell table. Each tab has a search field.
   On the `var` tab, tick `kompot_de_Young_to_Old_mean_lfc` and
   `kompot_de_Young_to_Old_mahalanobis`. On the `varp` tab, tick
   `spearman_fold_change: H2-Q7 (focused)` (2): each gene's Spearman correlation with H2-Q7. The
   choices appear under **Selected Columns** (3); the red **×** removes one (hover over a
   shortened name to read it in full).
4. Click **Apply Changes** (4). The table reloads with the new columns.
5. **Show entries** sets the number of rows per page (25 by default).

The `obsp`, `varp` and `layers` tabs list one choice per matrix and cell or gene, labelled
"*matrix*: *name* (*where it comes from*)":

| Label ends in | Meaning |
|---|---|
| `(focused)` | the focused cell or gene |
| `(fixed in *plot title*)` | a cell or gene some plot is locked to ({doc}`focus-and-lock`) |
| `(in this table)` | a column the table already holds, so it can be removed |

A cell table offers obsp rows and layer columns (genes); a gene table offers varp rows and layer
rows (cells). A column keeps the cell or gene it was added for: picking `H2-Q7 (focused)` and then
focusing Cd74 leaves the column `spearman_fold_change: H2-Q7`, and the table is not rebuilt. To
add Cd74's row, pick it on the tab while Cd74 is focused. A link, panel set or session that names
a column only as "the focused gene" (or cell) instead of by name gets that column pinned when it
opens: to the gene or cell the view itself focuses, with the filter conditions on it kept. If the
view focuses none, the column is removed with its conditions and a notice says so. No table
column follows the focus.

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

Groups nest further: the **>** of a condition inside a group makes a group inside that group.
**<** moves a condition one level out, **Delete** removes it, the **×** at the lower left of a group
removes that group and **Clear All** removes every condition. Numeric columns offer Equals, Not,
Less Than, Less Than Equal To, Greater Than Equal To, Greater Than, Between, Not Between, Empty and
Not Empty; text columns offer the text conditions (Equals, Contains, Starts With, …).

Equals and Not on a text column list its distinct values to pick from. A column with more than
10,000 distinct values among the table's rows, such as a barcode, takes a typed value instead,
and a note under the Advanced Search box says so: "Cell ID, barcode: more than 10,000 distinct values,
so Equals and Not take a typed value instead of a list." Listing a million barcodes took seconds
and made the dropdown unusable.

The 159 can be checked in Python:

```python
import zarr
g = zarr.open_group("bm_aging.zarr", mode="r")
m = g["var/kompot_de_Young_to_Old_mahalanobis"][:]
l = g["var/kompot_de_Young_to_Old_mean_lfc"][:]
print(((m > 5) & ((l > 0.05) | (l < -0.05))).sum())   # 159
```

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

```{note}
The grey of excluded points (`rgb(180, 180, 180)`) is close to the middle of RdBu, so with a
diverging map, genes with a value near 0 and genes outside the table look alike. Use the eye
toggle, or a colour map without grey, when that matters ({doc}`colour-scales`).
```

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
