(tut-millions)=
# Millions of cells: subsets, parts and every cell

Above 200,000 cells AnnZarro does not send every cell to the browser. A dataset opens on a
subset of 100,000 cells, and you step through the rest in parts, change the subset, or switch
it off and draw every cell. This tutorial does each of these on Tahoe-100M, 95,624,334 cells.
It is Worked example 6 of the AnnZarro paper (Steps 32 to 36), and the views are those of the
paper's scale figure ({doc}`../paper/scale`).

The steps work on **any store above 200,000 cells**; only the counts differ. On a smaller store
the subset dialog offers fewer sizes, and every cell stays in the regular plot up to
1 million points. {doc}`../user-guide/subsets` is the reference for everything shown here.

## What you need

- AnnZarro v0.4.0 or later.
- A store above 200,000 cells in the server's data directory. The screenshots use the paper's
  Tahoe-100M store `tahoe_panel_95.6M_plot.zarr`. It has no public download yet;
  {ref}`paper-scale-store` says how to build it from the public Tahoe-100M release (CC0).
  Elsewhere read `cell_line_id` as your own grouping column in `obs`.
- These fields:

| Slot | Key | What it is |
|---|---|---|
| `obsm` | `X_umap` | cell axes |
| `obs` | `cell_line_id` | 50 cell lines, the grouping used for a balanced subset |
| `X` | `FN1` | counts of the focused gene (any gene works) |

::::{dropdown} Start here: one UMAP by cell line, on the default subset
```{literalinclude} ../_static/panelsets/paper/scale-default-subset.url.txt
:language: text
```
Panel set file: {download}`scale-default-subset.json <../_static/panelsets/paper/scale-default-subset.json>`. The link is
ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

(tut-millions-open)=
## 1. Open the dataset on its default subset

1. Choose the store in **Dataset**. Add a **Cell Plot** with **X** `obsm` · `X_umap` · `0`,
   **Y** `obsm` · `X_umap` · `1` and **Color** `obs` · `cell_line_id`.

The statistics bar reads "Cells: 100,000 of 95,624,334" with the badge **Subset · seed 0**,
and the part controls below it read "Part 1 of 957". The line under the plot counts what it
draws: "100,000 of 95.6M cells shown · 95.5M not in part 1 of 957".

```{figure} ../_static/screens/tutorials/millions-badge.png
:class: screenshot
:alt: Statistics bar reading "Cells: 100,000 of 95,624,334" with a yellow badge "Subset · seed 0", and below it a Part box holding 1 "of 957" with previous and next arrows.
:width: 60%

The badge and the part controls.
```

```{figure} ../_static/screens/tutorials/millions-open.png
:class: screenshot
:alt: AnnZarro with the Tahoe store open: a UMAP of 100,000 cells coloured by cell line, about fifty separate islands, and under it the status line "100,000 of 95.6M cells shown, 95.5M not in part 1 of 957".
:width: 100%

The default subset. Every panel and table you open shows these same 100,000 cells.
```

The subset is fixed by the seed and each cell's row: the same seed gives the same cells on every
machine, and a larger subset with the same seed contains the smaller one. All of the earlier
tutorials work on a subset unchanged.

(tut-millions-dialog)=
## 2. Change the subset

2. Click the badge **Subset · seed 0**. The **Cell subset** dialog opens with
   **Show a subset of the cells** on. It offers the number of cells (a size card, or type it in
   **Cells**), the **Seed** (**New seed** draws one), the **Sampling**, and a **Filter**:
   conditions on obs columns joined by AND (**Add condition**), or a cell table's filter (pick
   the table, then **Use**).
3. Set **Sampling** to **Balanced across cell_line_id**. Each cell line now gets an equal share,
   so small lines are no longer swamped by large ones. The preview line states what will be
   shown: "100,000 of 95,624,334 cells will be shown. These are part 1 of 957; the parts together
   show every cell once", then per group "CVCL_0023 2,000/2,567,838, …", 2,000 cells from each
   of the 50 lines.

```{figure} ../_static/screens/tutorials/millions-dialog.png
:class: screenshot
:alt: The Cell subset dialog. Show a subset of the cells is on; size cards from 1k to All with parts and load-time estimates, 100k selected (957 parts); Cells 100000; Seed 0 with New seed; Sampling "Balanced across cell_line_id"; Filter with Add condition, a cell table picker and Use; the preview lists 2,000 cells per cell line; Cancel and Apply at the bottom.
:width: 80%

The dialog with a balanced subset. Each size card shows its number of parts and an estimated
load time; sizes above the dashed line switch the plot to large-plot mode.
```

4. Click **Apply**. Every panel reloads on the new cells; the badge's tooltip now says the subset
   is balanced by `cell_line_id`. The paper measured 3.1 s for opening the dialog, choosing the
   balance and applying it on Tahoe-100M on a laptop.

(tut-millions-parts)=
## 3. Step through the parts

5. Click the next-part arrow (**›**, "Next part") right of the part box. The plot redraws on part 2; layout,
   colours, zoom and locks stay as they are.
6. Type `250` into the part box and press Enter. The status line reads "100,000 of 95.6M cells
   shown · 95.5M not in part 250 of 957".

```{figure} ../_static/screens/tutorials/millions-part-controls.png
:class: screenshot
:alt: The statistics bar with "Part 250 of 957", the UMAP of part 250 by cell line, and the status line "100,000 of 95.6M cells shown, 95.5M not in part 250 of 957".
:width: 100%

Part 250 of the balanced subset. The islands are the same as in part 1: each part is a sample
of the whole.
```

The parts are disjoint and together hold every cell that passes the conditions once, so
stepping from 1 to 957 shows all 95.6 million cells, 100,000 at a time. The paper measured
1.8 s per step on Tahoe-100M. The status line under each plot always says why cells are not
drawn: not in this part, or hidden by a table filter (cells a filter only greys out still count
as shown); click **details** for the breakdown.

(tut-millions-outside)=
## 4. Focus a cell outside the part

The focused cell does not have to be among the cells shown.

7. Click **Focused Cell** and type the name of a cell that is not in part 250, here
   `71_101_135-lib_1398` (a cell of part 1). The picker lists it tagged **not shown**: cells
   outside the subset follow the subset's cells in the list.

```{figure} ../_static/screens/tutorials/millions-picker.png
:class: screenshot
:alt: The Focused Cell picker with the typed name, a list "1 match" with the cell 71_101_135-lib_1398 tagged "not shown", and beside the box a grey badge "not in part 250 of 957".
:width: 55%

A cell outside the part, found by name.
```

8. Press Enter. The cell becomes the focused cell, and a badge beside **Focused Cell** reads
   "not in part 250 of 957".

```{figure} ../_static/screens/tutorials/millions-outside.png
:class: screenshot
:alt: The Focused Cell box with the history arrows and the badge "not in part 250 of 957".
:width: 50%

The focused cell is marked as not in this part.
```

A focused or locked cell stays focused when you step to another part: its rows of obsp matrices
and layers are still read and painted over the part's cells. Share links and panel sets record
the part and the focus, and reopen both.

:::{note}
**The first name search builds an index.** On tens of millions of cells the server builds its
index of cell names on the first search; the paper measured 6.3 to 6.4 s at 50 million cells. In
v0.4.0 the picker answers "No cell matches" until the index is built, rather than waiting. If it
does, wait a few seconds and type the name again. This happens once per server process.
:::

(tut-millions-every)=
## 5. Draw every cell

9. Click the badge again and switch off **Show a subset of the cells**. The preview reads
   "All 95,624,334 cells. Drawing this many points can make the browser slow or unresponsive."
   Click **Apply**.

Above 1 million points a cell plot switches to large-plot mode. The badge reads **All cells**,
and the status line under the plot reads "95.6M cells" and, at the right, **Large plot: no
hover/click**.

```{figure} ../_static/screens/tutorials/millions-large.png
:class: screenshot
:alt: All 95,624,334 cells of Tahoe-100M on the UMAP coloured by cell line, dense solid islands; the statistics bar reads "Cells: 95,624,334" with an "All cells" badge, and the status line reads "95.6M cells" and "Large plot: no hover/click".
:width: 100%

Every cell, in large-plot mode, at the automatic point size and opacity.
```

In large-plot mode hover, click to focus, the focused-cell marker, table filters, obsp axes and
colours and 3D are off; pan, zoom, point size, opacity and colour by an obs column or a gene
remain. Point size and opacity follow the number of points until you set them by hand: point
size 1 and opacity 0.2 show density instead of a solid shape, as in panel a of
{doc}`../paper/scale`. The paper measured 5 to 6 s to draw every cell of Tahoe-100M on a laptop;
the tab then used 9.2 GiB of memory, against 0.5 GiB with the default subset
({ref}`browser-memory`).

10. To get hover and focus back, switch **Show a subset of the cells** on again in the badge
    dialog and step through parts (section 3).

## Check the numbers

Each statement was read from the app (v0.4.0) on the Tahoe-100M store.

| Statement | Where it shows |
|---|---|
| 100,000 of 95,624,334 cells, seed 0 | statistics bar and badge, step 1 |
| 957 parts of 100,000 | part controls; the 100k size card |
| 2,000 cells from each of the 50 cell lines | preview line of the dialog, step 3 |
| 95.5M cells not in part 250 | status line, step 6 |
| the typed cell is not in part 250 | the badge beside **Focused Cell**, step 8 |
| every cell switches to large-plot mode | status line, step 9 |

The times are the paper's benchmark (median of cold runs on an Apple M3 Max laptop,
{doc}`../reference/performance`); the screenshots here were not timed, and on your machine the
times depend on the disk, the browser and the GPU.

(tut-millions-views)=
## Open the views

The views of the paper's scale figure, including every cell, the next part and the balanced
subset, are in {ref}`paper-scale-views`. A share link records the subset and the part, so each
reopens the same cells.

## What you learned

- Above 200,000 cells a dataset opens on a reproducible 100,000-cell subset, and every panel and
  table shows the same cells.
- The parts are disjoint and together cover every cell; step through them by arrow or number.
- A balanced subset gives each group an equal share; a filter restricts the cells first.
- The focused cell can lie outside the part, and stays focused across parts.
- Every cell can be drawn, at the cost of hover and focus, in large-plot mode.

The screenshots are made by `docs/_tools/shoot_millions.py`, which does each step through the
app's controls.
