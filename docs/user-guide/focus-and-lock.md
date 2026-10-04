# Focus and lock

AnnZarro keeps one **focused cell** and one **focused gene** for the whole window. A panel can
draw a slice that depends on them: the focused cell's row of a cells × cells matrix (obsp), the
focused gene's column of a cells × genes layer, the focused gene's row of a genes × genes matrix
(varp), or the focused cell's row of a layer in a gene plot. Clicking a point moves the focus,
and every panel that depends on it redraws from one vector. **Locking** a panel freezes its slice,
so you can move the focus on and compare. The tutorial {doc}`../tutorials/tour` uses the same
model in a first analysis.

This page uses two cell plots on `bm_aging.zarr`: on the left, colour = the focused cell's row of
`obsp/diffusion_walk_t5` (where a 5-step diffusion walk from that cell lands); on the right,
colour = the focused gene's column of `layers/kompot_de_Young_to_Old_fold_change`.
The view is {download}`userguide-focus.json <../_tools/views/userguide-focus.json>`.

```{figure} ../_static/screens/user-guide/focus-start.png
:class: screenshot
:alt: Two UMAPs. Left, a diffusion walk from an HSC lights up a small blue patch around the cell. Right, H2-Q7 fold change in red and blue over all cells. A red-ringed dot marks the focused cell in both.

Start: focused cell = the HSC `HSPC_Old_1#GAAGCCCGTGGCTCTG-1`, focused gene = H2-Q7.
```

The focused cell is drawn as a larger red dot with a black ring in every cell plot where
**Highlight Focused Cell** is on (the default); gene plots mark the focused gene the same way.

## Hover, then click to focus

1. Move the pointer over a point in the left plot. A label shows the cell name, its x and y
   values, its colour value `c`, and the columns listed in the panel's hover settings (here
   `highres_celltype` and `Age`). Numbers are shown to 4 significant digits.

   ```{figure} ../_static/screens/user-guide/focus-hover.png
   :class: screenshot
   :width: 70%
   :alt: The diffusion walk UMAP with a hover label over a cell showing its name, x 12.23, y 3.241, c 3.348e-8, highres_celltype GMP and Age Old.

   Hover label in a cell plot.
   ```

2. Click the point. That cell becomes the focused cell: the **Focused Cell** picker in the header
   shows its name, and the left plot redraws with the walk from the new cell. The colour range
   rescales to the new row (here 0 to 0.0046 instead of 0 to 0.012).

   ```{figure} ../_static/screens/user-guide/focus-after-click.png
   :class: screenshot
   :alt: After the click, the left UMAP's walk is centred on a GMP higher up in the embedding; the right UMAP is unchanged except that the red focus dot moved to the clicked cell.

   After clicking a GMP (`HSPC_Old_3#GGGTATTAGGCCGCTT-1`).
   ```

3. The right plot keeps its colours, because the fold change depends on the focused gene, not the
   focused cell; only its focus marker moves.

A click picks the point nearest to the pointer. Where points overlap, clicking the same spot again
steps to the next point under the pointer, so every cell in a dense patch can be reached (here, a
second and third click at the same place focused two other cells). Clicking a point in a **gene
plot** focuses that gene in the same way, and clicking a gene or cell name in a table does too
({doc}`tables-and-filters`).

```{admonition} What happens on the server
:class: note
The click sent exactly one data request: `GET /api/v1/data/obsp/diffusion_walk_t5?rows=2991`
(row 2991 is the clicked cell), answered with 8,090 float32 values. The server read only the
chunks that hold that row. The right plot sent nothing. A row or column that the browser has
already fetched is served from its cache, so stepping back through the history is free.
Measurements of bytes and time per click are in {doc}`../reference/performance`.
```

## Step back with the history arrows

```{figure} ../_static/screens/user-guide/focus-cell-history.png
:class: screenshot
:width: 50%
:alt: The Focused Cell part of the header, with the Previous cell arrow (1) and the picker (2) outlined.

Previous cell (1) and the Focused Cell picker (2).
```

1. Click **Previous cell** (1). The focus returns to the HSC and the walk panel shows its row again.
2. **Next cell** moves forward again. The gene history arrows work the same way for genes.

## Lock a panel

Every axis or colour that follows the focus (types `obsp`, `layer` and `varp`) has two extra
buttons to the right of its third drop-down: a **lock** and, while locked, a **refocus**
crosshair.

1. Open the left panel's controls with its **Toggle Controls** chevron.
2. In the **Color** row, the third drop-down reads "Focused cell HSPC_Old_1#…". Click the open
   padlock (2) to the right of it. It turns blue and closed: the panel is now locked to that cell's
   row. The drop-down then names the locked cell, "Locked cell HSPC_Old_1#…" (in this version the
   new wording appears once the panel is rebuilt, for example when the view is reopened from a
   panel set or share link; right after the click it still reads "Focused cell …").

   ```{figure} ../_static/screens/user-guide/focus-lock-button.png
   :class: screenshot
   :alt: The Color row: obsp, diffusion_walk_t5, the focused-cell drop-down (1) and the closed blue lock button (2).

   Locked: the row is pinned to the HSC.
   ```

3. Click **Next cell** in the header (or click any other cell). The focused cell changes and the
   focus marker moves to the GMP in both panels, but the locked panel keeps the HSC's walk.

   ```{figure} ../_static/screens/user-guide/focus-locked.png
   :class: screenshot
   :alt: Left, the HSC's walk stays near the HSC while the focus marker sits on the GMP above it; right, the fold change UMAP with the focus marker on the GMP.

   The left panel stays on the HSC while the focus is on the GMP.
   ```

4. Because the locked cell and the focused cell now differ, a crosshair button (1) appears next to
   the lock (2).

   ```{figure} ../_static/screens/user-guide/focus-locked-refocus.png
   :class: screenshot
   :alt: The Color row with the crosshair button (1) and the lock (2).

   The crosshair appears while the locked cell differs from the focused cell.
   ```

   Clicking the crosshair makes the **locked** cell the focused cell again (here: back to the HSC);
   the panel stays locked. To make the panel follow the focus again, click the lock to open it;
   the panel then redraws for the current focused cell.

The red focus marker always marks the focused cell, in locked and unlocked panels alike; the
locked cell is named in the drop-down and in the colour bar title.

```{admonition} What happens on the server
:class: note
A locked panel sends nothing when the focus moves. Locking is stored in the panel's settings
(`"locked": true` together with the locked cell or gene), so panel sets and share links reopen it
locked to the same slice.
```

(focus-outside-subset)=
## A focused cell outside the shown cells

On a cell subset ({doc}`subsets`) the focused or a locked cell can be one the subset does not
show: a cell of another part after a step with **›**, one a filter leaves out, or one picked by
name. It stays focused (or locked), and every panel that depends on it still draws its slice
over the cells shown. A focus is replaced only when the dataset does not have the cell at all.

Here `bm_aging.zarr` is shown in parts of 3,000 cells ({download}`userguide-focus-outside.json
<../_tools/views/userguide-focus-outside.json>`). The HSC is in part 2; one click on **›** shows
part 3, which does not hold it:

```{figure} ../_static/screens/user-guide/focus-outside.png
:class: screenshot
:alt: Part 3 of 3. Left, the 5-step diffusion walk from the HSC coloured over part 3's cells, with a small hollow red ring where the HSC lies; right, the same cells by cell type with the ring among the HSCs. Both panels say "Focused cell HSPC_Old_1#GAAGCCCGTGGCTCTG-1 is not among the shown cells".

The walk from the HSC over the cells of part 3, which does not contain the HSC.
```

- **Its slices are read as before.** The left panel is the HSC's row of
  `obsp/diffusion_walk_t5`, restricted to part 3's cells: where a walk from the HSC lands among
  them. A layer row in a gene plot, and table columns that follow the cell, work the same way.
- **A hollow red ring** marks where the cell lies, instead of the filled dot of a shown cell. It
  is drawn when **Highlight Focused Cell** is on and every axis is the cell's own value (an obs
  column, an embedding or a gene); it is not drawn when an axis is an obsp row, nor in
  large-plot mode. It is not one of the plotted cells: it has no colour value and is not counted.
- **In large-plot mode**, which draws no ring, the plot's status line carries a tag "… not
  shown"; its **Go to its part** shows the part that holds the cell.
- **The header marks it** next to the Focused Cell picker (1): "not in part 3 of 3", or "not
  shown" without parts. Axis menus and table column titles that name the cell add "(not shown)".

```{figure} ../_static/screens/user-guide/focus-outside-header.png
:class: screenshot
:alt: The header: the Focused Cell picker showing HSPC_Old_1… and next to it the badge "not in part 3 of 3" (1); below, the statistics bar at Part 3 of 3.

The header after the step.
```

**Picking a cell by name** searches the whole dataset. The shown cells' matches come first;
cells of other parts follow, tagged **not shown**, and can be picked like any other:

```{figure} ../_static/screens/user-guide/focus-outside-picker.png
:class: screenshot
:width: 50%
:alt: The Focused Cell picker with the text "ung_1#AAAGG" typed and two matches: HSPC_Young_1#AAAGGGCGTGTATTG… and, tagged not shown, HSPC_Young_1#AAAGGATT….

Two matches: the first is in part 3, the second in another part.
```

Locks work the same way: a panel locked to a cell keeps that cell's slice through every step,
including the parts that do not hold it. Share links and panel sets reopen with the same focus
and locks, also when their subset does not show those cells.

```{admonition} What happens on the server
:class: note
A shown cell is read by its position among the cells shown (`rows=780`); a cell the subset does
not show is read by its row in the dataset (`dataset_rows=2089`), and an obsp row is then
restricted to the cells shown on the server, so the reply is the same size either way. Before a
step the app notes the dataset rows of the focused and locked cells (one small request), so it
finds them in the next part without searching by name. Share links carry those rows as a hint
(`cellRows`, {doc}`../reference/deep-links`). The requests are in
{ref}`http-outside-cells`.
```

## Compare two genes on one scale

Lock and a fixed colour range together give a side-by-side comparison. The view
{download}`userguide-compare-genes.json <../_tools/views/userguide-compare-genes.json>` has two
copies of the fold-change plot. The left one is locked to H2-Q7; the right one follows the focused
gene, here S100a9. Both use the colour range −1 to 1 with **Lock Range** on, so equal colours mean
equal fold changes ({doc}`colour-scales`).

```{figure} ../_static/screens/user-guide/focus-compare-genes.png
:class: screenshot
:alt: Two fold-change UMAPs on the same RdBu scale from -1 to 1: left H2-Q7, rising with age in most cells; right S100a9, strongly negative in the HSC cluster around the focus marker.

Left: locked to H2-Q7. Right: follows the focused gene (S100a9). Same scale.
```

To build it yourself:

1. Make a cell plot coloured by `layer` → `kompot_de_Young_to_Old_fold_change` → "Focused gene".
2. Click **Split side by side** in its tile header, then click the panel's card under
   **Duplicate or Reopen Panel** in the new pane to make a copy.
3. In the first panel, click the lock in the Color row.
4. In both panels, type `-1` in **Min** and `1` in **Max** and click **Lock Range**.
5. Pick another gene in the header: only the unlocked panel changes.

The same pattern works with a gene plot locked to one cell's row of a layer while the other follows
the focused cell, or with two obsp rows. The tutorial {doc}`../tutorials/cells-and-genes` compares a
locked HSC with a focused monocyte this way ({ref}`tut-cg-rows`).
