(tut-line-select)=
# Cut away part of a plot with a line

A plot often shows a part you want gone: a group of cells at one edge, an arm of the UMAP you
are not interested in. There is no label to filter by, but you can see where to cut. The
**Line filter** tool of a cell table lets you draw that cut on the plot. The table filters
itself by it, and every plot linked to the table greys out what was cut away. One or two lines
are usually enough. Many lines make an area ({ref}`further down <tut-ls-area>`).

## What you need

- AnnZarro running locally ({doc}`../getting-started/quickstart`) with `bm_aging_annzarro.zarr` in its
  data directory (8,090 cells).
- A **Cell Table** with the columns `Age` and `highres_celltype`, and a **Cell Plot** of
  `obsm` `X_umap` 0 against 1, coloured by `highres_celltype`. Open the table's controls to tick
  the columns, then close them again.

The tool works from the table and draws on plots of its own rows: a cell table on plots of cells, a gene table on plots of genes ({doc}`../user-guide/tables-and-filters`).

## 1. Arm the tool

Click **Line filter**, the button before the table's search box (marked 1 below; on a narrow
table only its icon shows, and its tooltip gives the name). The tool is on while three things are red: the button, a frame round the table the lines will go to, and a badge **Line filter on: Cells** in the bar under the header. Hover over the badge for what to do. Click it, press **Esc** or click the button again to stop. The UMAP shows a short hint.

```{figure} ../_static/screens/tutorials/line-select-armed.png
:class: screenshot
:alt: A cell table with a red frame and a UMAP. The Line filter button before the search box is boxed in red and numbered 1; a red badge "Line filter on: Cells" sits in the dataset bar; the UMAP shows the hint "Drag to draw a line. The right side is filtered out. Shift: 45 degrees. Esc: stop."

The Line filter button (1), armed: the table has a red frame, the badge in the dataset bar says which table the lines go to, and the plot shows a hint.
```

## 2. Draw the cut

Press the mouse where the line starts, drag, and release where it ends. While you hold the button the
tool shows the line and shades the side that will be **filtered out**: the side on your **right**
as you look from the press towards the release. Here the line runs left to right under the cells
we want to keep, so the group of cells below it goes. Hold **Shift** to snap the line to multiples of 45°.

```{figure} ../_static/screens/tutorials/line-select-preview.png
:class: screenshot
:alt: The UMAP with a red line drawn from the left edge to the right edge below the main cloud and the area under it shaded red.

Dragging a line from left to right. The shaded side, under the line, is what will be filtered out.
```

Release. The cells under the line turn grey in the plot, and the table keeps 6,482 of the 8,090.

```{figure} ../_static/screens/tutorials/line-select-one.png
:class: screenshot
:alt: Advanced Search with one condition on "X_umap:1 minus 0.0586207 times X_umap:0", the UMAP with the cells below the line grey, and the table with the new columns.

One line, one condition. The tool linked the plot to the table, so the cut cells are grey.
```

What the table did for you:

- It added the two axis columns, `X_umap:0` and `X_umap:1`, if it had not got them.
- It added a third column computed from them, `X_umap:1 − 0.0586207·X_umap:0` (that is
  `y − m·x` for the slope `m` of your line).
- It added one condition on that column, **Greater Than Equal To −2.13103**, the line's
  intercept, to Advanced Search.
- If the plot had no table selected in its **Table** control, the tool selected this one.

## 3. A second line

The tool stays armed, so draw the next cut at once. Drawn from top to bottom, a line removes what is
on your right, which is the left of the screen: a vertical line at x = 1.5 takes away the arm at
the left. A vertical or horizontal line needs no computed column. The condition goes directly on the
axis column.

```{figure} ../_static/screens/tutorials/line-select-two.png
:class: screenshot
:alt: The table with two conditions, one on the computed column and one on X_umap:0, and the UMAP in which only the middle and the upper right of the cloud keep their colour.

Two lines: 4,968 of the 8,090 cells are left. The Line filter button (1) is no longer armed.
```

Press **Esc** to leave the tool (clicking **Line filter** again does the same). Each line is an
ordinary condition: change its number, or remove it with its **Delete** button, and the table and
the plot follow. When no condition uses a computed column any more (you deleted its line, or used **Clear All**), the table drops that column too; the two axis columns stay.

```{figure} ../_static/screens/tutorials/line-select-conditions.png
:class: screenshot
:width: 60%
:alt: Advanced Search with two conditions joined by AND: "X_umap:1 − 0.0586207·X_umap:0 Greater Than Equal To −2.13103" and "X_umap:0 Greater Than Equal To 1.5".

The two conditions in Advanced Search, joined by AND.
```

Nothing about the plot is stored: the conditions are on the table's own columns. If you change the
plot's axes afterwards, the table does not change, and a new line on the plot adds the columns of
its new axes. The columns, the conditions and the link to the plot are kept in panel sets,
sessions and share links ({doc}`../user-guide/panel-sets`).

(tut-ls-area)=
## Select an area with many lines

Each line is one condition joined to the others by AND, so a closed shape of lines keeps what lies
inside all of them. Draw it counter-clockwise around a group of cells: its inside is then on your
left and the outside on your right. Four lines around the lobe in the middle of the UMAP leave
1,841 cells after three lines and 1,369 after the fourth.

```{figure} ../_static/screens/tutorials/line-select-area.png
:class: screenshot
:alt: Advanced Search with four conditions joined by AND, each on a computed column, and the UMAP with only the cells of one lobe coloured and all others grey.

Four lines around a lobe, four conditions joined by AND. Only the cells inside keep their colour.
```

```{figure} ../_static/screens/tutorials/line-select-table.png
:class: screenshot
:width: 60%
:alt: The four conditions, for example "X_umap:1 − 0.1875·X_umap:0 Greater Than Equal To −3.78125".

The four conditions in Advanced Search.
```

### Cut the area out instead

Draw the same four lines **clockwise**. Now the inside is on your right, so each line filters out
the inner side. Joined by AND the conditions leave nothing (0 cells): a cell would have to be outside
all four lines at once. Click the **AND** bar of the filter to switch it to **OR**
({doc}`../user-guide/tables-and-filters`). A cell stays if it is outside any of the lines, which means
outside the lobe: 6,721 cells, and 6,721 + 1,369 = 8,090.

```{figure} ../_static/screens/tutorials/line-select-or.png
:class: screenshot
:alt: The UMAP with the lobe grey and all other cells coloured, and Advanced Search with the same four conditions, reversed, joined by OR.

The same four lines drawn the other way, with the outer AND switched to OR: the lobe is out.
```

```{figure} ../_static/screens/tutorials/line-select-or-conditions.png
:class: screenshot
:width: 60%
:alt: Advanced Search with four conditions, the comparisons reversed, joined by OR.

The conditions of the clockwise lines, with the outer logic on OR.
```

## Plots the tool does not use

The tool works on 2D plots with numeric axes. Over a 3D plot, a plot in large-plot mode or a plot of the other kind (a gene plot beside a cell table) it does nothing at all: there is no layer, and rotating, zooming, hovering and clicking work as usual. Over a 2D plot with a text or date axis a small tooltip follows the cursor and says why; the plot still takes the mouse.

```{figure} ../_static/screens/tutorials/line-select-warning.png
:class: screenshot
:alt: A second plot with cell types on its x axis; a small dark tooltip near the cursor reads "This plot's x axis (highres_celltype) is not numeric."

The tooltip over a plot with a text axis.
```

The screenshots are made by `docs/_tools/shoot_line_select.py`, which draws the lines with the
mouse as this page says and prints every count quoted here.
