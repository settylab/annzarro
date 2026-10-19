(tut-line-select)=
# Select an area with lines

Some groups of cells have no label to filter by. They are a region of the UMAP that you can see
and point at. The line-selection tool turns a line drawn on a plot into a filter on the cell
table, and several lines make an area. Drawn one way, the lines keep the area. Drawn the other
way, with the outer AND of the filter switched to OR, they leave everything except the area.

## What you need

- AnnZarro running locally ({doc}`../getting-started/quickstart`) with `bm_aging_annzarro.zarr` in its
  data directory (8,090 cells).
- A **Cell Table** with the columns `Age` and `highres_celltype`, and a **Cell Plot** of
  `obsm` `X_umap` 0 against 1, coloured by `highres_celltype`. Open the table's controls to tick
  the columns, then close them again.

The line tool works from the table. It draws on a plot of the same kind of entity: a cell table
uses cell plots, a gene table gene plots ({doc}`../user-guide/tables-and-filters`).

## 1. Arm the tool

Click **Line filter**, the button before the table's search box (on a narrow table only its slanted-line icon shows; hover for the name). It turns red, and every
cell plot is covered by a transparent layer. Hover over the UMAP: the hint says what a drag does.

```{figure} ../_static/screens/tutorials/line-select-armed.png
:class: screenshot
:alt: The cell table with its red Line filter button armed and the UMAP showing the hint "Drag to draw a line: the side to its right is filtered out. Shift snaps to 45 degrees, Esc stops."

The Line filter button is armed (red). The hint appears over the plot.
```

## 2. Draw the first line

Press the mouse where the line starts, drag, and release where it ends. While you hold the button
the tool shows the line and shades the side that will be **filtered out**: the side on your
**right** as you look from the point where you pressed towards the point where you release.
Hold **Shift** to snap the line to multiples of 45°.

```{figure} ../_static/screens/tutorials/line-select-preview.png
:class: screenshot
:alt: The UMAP with a red line drawn from lower left to upper right below the cell cluster, the area below it shaded red, and the table showing all cells.

Dragging a line along the bottom of a lobe, from left to right. The shaded side, below the
line, is the side that will be filtered out.
```

Release. The table adds the columns of both axes, `X_umap:0` and `X_umap:1`, and a third column
computed from them, `X_umap:1 − 0.1875·X_umap:0`, which is `y − m·x` for the slope `m` of your
line. It adds one condition on that column: the line's intercept, `≥ −3.78125`. The table keeps
6,615 of the 8,090 cells, and the plot, which the tool linked to the table because it had no
table filter, greys the others.

## 3. Close the area

The tool stays armed, so you can draw the next line at once. Go counter-clockwise around the
lobe, so that its inside is always on your left and the outside on your right: up the right
side, back along the top, down the left side. After each line the table shrinks (5,929, then
1,841, then 1,369 cells). Press **Esc** when you are done: it leaves the tool.

```{figure} ../_static/screens/tutorials/line-select-area.png
:class: screenshot
:alt: Advanced Search with four conditions joined by AND, each on a derived column, and the UMAP with only the cells of one lobe coloured and all others grey.

Four lines, four conditions joined by AND. Only the cells inside the lobe keep their colour.
```

Every line is one condition in **Advanced Search**, joined to the others by an outer **AND**.
Nothing about the plot is stored: the conditions are on the table's own columns, so they stay
exact if you later change the plot's axes. A new line on the plot with other axes adds the
columns it needs. Delete a line with the **Delete** button of its condition.

```{figure} ../_static/screens/tutorials/line-select-table.png
:class: screenshot
:width: 60%
:alt: The four conditions, for example "X_umap:1 − 0.1875·X_umap:0 Greater Than Equal To −3.78125", above the table, which now has the columns X_umap:0, X_umap:1 and four derived columns.

The four conditions and the columns the lines added.
```

## 4. Filter an area out instead

Start again (**Clear All** in Advanced Search) and draw the same four lines **clockwise**. Now the
inside of the lobe is on your right, so every line filters out the inner side. Joined by AND the
conditions keep nothing (0 cells): a cell would have to be outside all four lines at once. Click the
**AND** bar of the filter to switch it to **OR**. A cell now stays if it is outside any of the
lines, which means outside the lobe: 6,721 cells, and 6,721 + 1,369 = 8,090.

```{figure} ../_static/screens/tutorials/line-select-or.png
:class: screenshot
:alt: The same four conditions with the outer logic switched to OR, and the UMAP with the lobe grey and all other cells coloured.

The same lines drawn the other way, with the outer AND switched to OR: the lobe is out.
```

## When the tool says no

A plot can take a line only if both of its axes are numerical, it is 2D, and the axes are columns the table can hold. Over any other plot the layer shows why, before you click:

```{figure} ../_static/screens/tutorials/line-select-warning.png
:class: screenshot
:alt: A second plot with cell types on its x axis is dimmed and shows "The x axis (highres_celltype) is not numerical. Line selection needs a numerical x and y axis."

A plot with a text axis refuses the tool, and says why.
```

The panels, the filter and the derived columns are kept in panel sets, sessions and share links
like any other table setting ({doc}`../user-guide/panel-sets`).

The screenshots are made by `docs/_tools/shoot_line_select.py`, which draws the lines with the
mouse as this page says and prints every count quoted here.
