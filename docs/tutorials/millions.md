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
  Tahoe-100M store `tahoe_panel_95.6M_plot.zarr`. It is not deposited;
  {ref}`paper-scale-store` says how to build it from the public Tahoe-100M release (CC0), the
  UMAP on Zenodo ([doi:10.5281/zenodo.23277102](https://doi.org/10.5281/zenodo.23277102)) and the
  build script in [annzarro-reproducibility](https://github.com/settylab/annzarro-reproducibility).
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

1. Choose the store with the dataset button (left of the bar under the header). Add a **Cell Plot** with **X** `obsm` · `X_umap` · `0`,
   **Y** `obsm` · `X_umap` · `1` and **Color** `obs` · `cell_line_id`.

The dataset bar reads "Cells: 100,000 of 95,624,334" with the badge **Subset · seed 0**,
and the part controls below it read "Part 1 of 957". The line under the plot counts what it
draws: "100,000 of 95.6M cells shown · 95.5M not in part 1 of 957".

```{figure} ../_static/screens/tutorials/millions-badge.png
:class: screenshot
:alt: Dataset bar reading "Cells: 100,000 of 95,624,334" with a yellow badge "Subset · seed 0", and below it a Part box holding 1 "of 957" with previous and next arrows.
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
:alt: The dataset bar with "Part 250 of 957", the UMAP of part 250 by cell line, and the status line "100,000 of 95.6M cells shown, 95.5M not in part 250 of 957".
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
and the status line under the plot reads "95.6M cells" and, at the right, **Large plot**.

```{figure} ../_static/screens/tutorials/millions-large.png
:class: screenshot
:alt: All 95,624,334 cells of Tahoe-100M on the UMAP coloured by cell line, dense solid islands; the dataset bar reads "Cells: 95,624,334" with an "All cells" badge, and the status line reads "95.6M cells" and "Large plot".
:width: 100%

Every cell, in large-plot mode, at the automatic point size and opacity.
```

In large-plot mode table filters, obsp axes and colours, 3D and extra hover columns are off;
pan, zoom, hover, click to focus, the focused-cell marker, point size, opacity and colour by an
obs column or a gene remain. Point size and opacity follow the number of points until you set them by hand: point
size 1 and opacity 0.2 show density instead of a solid shape, as in panel a of
{doc}`../paper/scale`. The paper measured 5 to 6 s to draw every cell of Tahoe-100M on a laptop;
the tab then used 9.2 GiB of memory, against 0.5 GiB with the default subset
({ref}`browser-memory`).

10. To get hover and focus back, switch **Show a subset of the cells** on again in the badge
    dialog and step through parts (section 3).

(tut-millions-080)=
## 6. Groups, counts and a dot plot over every cell

Counting, grouping and summarising need no points in the browser, so these panels work on **every cell** of the store
while the cell plots stay in large-plot mode or on a subset. This section asks the questions you will meet at a
hundred million cells: what does it cost, and what does the app do when the answer would take too long? Keep the subset
switched off (step 9). {doc}`../user-guide/long-computations` is the reference for the limits and the wording.

The numbers below are what the app showed on the Tahoe-100M store; the seconds are estimates the server makes from the
values stored, not measurements. The store's `X` holds values for the **200 genes** of its panel only (the other 4,800
columns are empty), so a request for more genes costs no more than 200.

11. Add a **Cell Count Plot** with **Bar** mode and **X** `cell_line_id`. The status line under the plot reads
    "95.6M cells": the 50 bars count every cell, and appear within a second or two.

```{figure} ../_static/screens/tutorials/millions-080-count.png
:class: screenshot
:alt: A Cell Count Plot of Tahoe-100M with 50 bars, one for each cell line, heights from under a hundred thousand to over six million cells; the dataset bar reads Cells 95,624,334 with an All cells badge and the status line reads 95.6M cells.
:width: 100%

Cells of each cell line, over all 95,624,334 cells.
```

12. Add a **Cell Grouping**, add the factor `cell_line_id` with **Add factor**, then the factor `plate`. The panel reads
    "700 groups · 95,624,334 of 95,624,334 cells in a group": 50 cell lines by 14 plates, each with its cell count and
    share. A factor holds up to 2,000 levels (a column with more is refused, with its count); **Cross-table** shows the same counts as a grid.
    A grouping is the unit the dot plots below summarise over.

```{figure} ../_static/screens/tutorials/millions-080-grouping.png
:class: screenshot
:alt: A Cell Grouping panel of Tahoe-100M with two partitionings, cell_line_id with 50 levels and plate with 14 levels, the summary 700 groups, 95,624,334 of 95,624,334 cells in a group, and the first rows of the group list, each a cell line and a plate with its cell count and share.
:width: 100%

Cell lines by plates: 700 groups over every cell.
```

13. Add a **Cell-Gene Plot** with **Groups** `cell_line_id` (one column for each cell line) and, as rows, a signature of genes (for
    this picture, the first 20 of the panel). Colour is the **Mean** and size the **Fraction of cells**, both read from
    `X`. Reading the genes over 95.6 million cells takes seconds, so the plot shows a bar with the time left and a
    **Cancel** button instead of a blank tile. Five genes are read in about two seconds, too fast for the bar to be worth
    a picture; twenty show it for about ten.

```{figure} ../_static/screens/tutorials/millions-080-progress.png
:class: screenshot
:alt: The progress notice of a Cell-Gene Plot: "Reading 20 genes: 10 of 20 · about 6 seconds left", a half-filled bar, and a Cancel button.
:width: 55%

A read in progress: genes done, the time left (an estimate) and **Cancel**.
```

14. Make the signature the whole panel of 200 genes. Before reading anything the app asks, because the estimate is
    over a minute: "Reading 200 genes over 95.6M cells: up to about 6 minutes (10.5 billion stored values)." It adds
    "Groupings and counts keep working", and offers **Compute**, **Fewer genes** and the box **Don't ask again for this
    panel**. Nothing is read until you choose. The counts and groupings of steps 11 and 12 stay usable meanwhile.

```{figure} ../_static/screens/tutorials/millions-080-asks-first.png
:class: screenshot
:alt: A notice reading "Reading 200 genes over 95.6M cells: up to about 6 minutes (10.5 billion stored values). Groupings and counts keep working." with the links Compute and Fewer genes and the box Don't ask again for this panel.
:width: 55%

The question asked before a long read.
```

    On this store the 200-gene read, run on a laptop with a local disk, finished in under two minutes: the estimate is an
    upper bound for planning, and your time depends on the disk.

15. The server refuses what it estimates at over ten minutes (`limits.refuse_s`, 600 s): "Not run: it is estimated at
    about N minutes (runs over 10 minutes are not started by themselves)." with the way out and **Try anyway**, which
    starts the run that the server allows (it stops by itself after 30 minutes, `limits.try_max_s`). No request this
    store can answer is estimated over ten minutes, because only 200 genes hold values. **The picture below was taken
    with the limit lowered to 300 s** in a scratch site configuration, so that the same 200 genes, estimated at about 6
    minutes, are over it. The sentence is the app's, with "5 minutes" where your server says 10.

```{figure} ../_static/screens/tutorials/millions-080-refused.png
:class: screenshot
:alt: A notice reading "Not run: it is estimated at about 6 minutes (runs over 5 minutes are not started by themselves). Use fewer genes, a smaller subset, or a layer stored by gene (CSC)." with the link Try anyway and the box Don't ask again for this panel.
:width: 55%

A time refusal, with the limit lowered to 300 s for the picture.
```

    The last way out ("a layer stored by gene (CSC)") is for stores kept by cell; `X` here is already stored by gene, so only
    the first two apply. Ticking **Don't ask again for this panel** starts the read, and the strip under the plot then
    carries the tag **Runs without asking**. Its pop-over says "Long computations in this panel start without asking. Each can
    be cancelled and stops by itself after 30 minutes." and has **Ask again**, which brings the question back.

```{figure} ../_static/screens/tutorials/millions-080-runs-without-asking.png
:class: screenshot
:alt: The strip under a Cell-Gene Plot with the tags Runs without asking and 50 groups × 200 rows, and the pop-over of the first tag: "Long computations in this panel start without asking. Each can be cancelled and stops by itself after 30 minutes." with the link Ask again.
:width: 60%

The panel that runs without asking, and the way back.
```

16. A size refusal is a different thing from a time refusal: the plot would be too large to draw, whatever the time.
    Build a matrix of 50 groups and 8,100 rows (for the picture, 40 sections of the 200 genes and one of 100). The notice reads
    "50 groups × 8,100 rows = 405,000 cells of the matrix; the limit is 400,000." and offers no **Try anyway**, since no
    time would help. It offers the edits that would make the plot draw: **Show Panel block 0 as one row** and
    **Remove Panel tail** (your sections' titles go there). Each is one click, and each can be undone with **Undo**.

```{figure} ../_static/screens/tutorials/millions-080-too-large.png
:class: screenshot
:alt: A notice reading "50 groups × 8,100 rows = 405,000 cells of the matrix; the limit is 400,000. Remove a section or use fewer groups." with the buttons Show Panel block 0 as one row and Remove Panel tail.
:width: 55%

A size refusal: the limit, and the edits that would fit it.
```

## Check the numbers

Each statement was read from the app on the Tahoe-100M store (the rows for steps 11 to 16 from v0.8.0).

| Statement | Where it shows |
|---|---|
| 100,000 of 95,624,334 cells, seed 0 | dataset bar and badge, step 1 |
| 957 parts of 100,000 | part controls; the 100k size card |
| 2,000 cells from each of the 50 cell lines | preview line of the dialog, step 3 |
| 95.5M cells not in part 250 | status line, step 6 |
| the typed cell is not in part 250 | the badge beside **Focused Cell**, step 8 |
| every cell switches to large-plot mode | status line, step 9 |
| 95.6M cells counted in 50 bars | status line, step 11 |
| 700 groups · 95,624,334 of 95,624,334 cells in a group | grouping panel, step 12 |
| Reading 20 genes: 10 of 20 · about 6 seconds left | progress notice, step 13 |
| Reading 200 genes over 95.6M cells: up to about 6 minutes (10.5 billion stored values) | question, step 14 |
| Not run: it is estimated at about 6 minutes (runs over 5 minutes are not started by themselves) | time refusal with the limit lowered to 300 s, step 15 |
| 50 groups × 8,100 rows = 405,000 cells of the matrix; the limit is 400,000 | size refusal, step 16 |

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
- Every cell can be drawn in large-plot mode, with hover and click to focus, but without table filters or 3D.
- Counts, groupings and gene summaries work over every cell without drawing a point. A long read shows its progress and time left, is asked first above a minute, and is refused above ten, with **Try anyway** where the server allows it; a plot too large to draw is refused with the edits that fit it.

The screenshots are made by `docs/_tools/shoot_millions.py` (sections 1 to 5) and `docs/_tools/shoot_millions_080.py` (section 6), which do each step through the
app's controls.
