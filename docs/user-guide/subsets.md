# Cell subsets

A browser can draw a few hundred thousand points; a dataset with millions of cells would make
every plot slow and every focus change a large download. AnnZarro therefore shows large datasets
through a **cell subset**: a reproducible sample of the cells that every panel, table, share link
and panel set uses. The subset is decided on the server from a short description (number of cells,
seed, optional balancing and filter), so the same description names the same cells on every
machine and in every release.

## The default

A dataset with more than **200,000** cells opens on a subset of **100,000** cells with seed **0**.
At or below 200,000 cells every cell is shown and nothing changes. The three numbers are server
settings: `ui.defaults.subset_threshold`, `subset_size` and `subset_seed`
({doc}`../reference/configuration`).

The statistics bar under the header says which cells are shown:

```{figure} ../_static/screens/user-guide/subsets-badge-all.png
:class: screenshot
:width: 25%
:alt: The statistics bar reading Cells 8,090 with the badge All cells (1).

Every cell is shown: the badge reads **All cells**.
```

```{figure} ../_static/screens/user-guide/subsets-badge.png
:class: screenshot
:width: 35%
:alt: The statistics bar reading Cells 3,000 of 8,090 with the yellow badge Subset · seed 0 (1).

A subset is active: **Cells: 3,000 of 8,090** and the badge **Subset · seed 0**.
```

Hover over the badge for the details, for example "Showing 3,000 of 8,090 cells (seed 0, balanced by
Age, n_genes_by_counts ≥ 1000). 8,063 cells pass the filter. Every panel shows these same cells.
Click to change the subset."

## Choose a subset

`bm_aging.zarr` has 8,090 cells, so it opens on all of them; the subset below is chosen by hand to
show the dialog. On a large dataset the steps are the same.

1. Click the badge (**All cells** or **Subset · seed …**). The **Cell subset** dialog opens.

   ```{figure} ../_static/screens/user-guide/subsets-dialog.png
   :class: screenshot
   :width: 80%
   :alt: The Cell subset dialog: "Show a subset of the cells" switched on, Cells 3000, Seed 0 with a New seed button, Sampling "Balanced across Age", one filter condition "n_genes_by_counts ≥ 1000", the cell table filter import, and the preview "3,000 of 8,090 cells will be shown. 8,063 pass the filter. Per group: Mid 1,000/2,052, Old 1,000/3,106, Young 1,000/2,905".

   A balanced, filtered subset of 3,000 cells.
   ```

2. Switch on **Show a subset of the cells** (switch it off to show every cell).
3. **Cells**: how many cells to show, here `3000`. Tick **every cell passing the filter** to keep
   all cells that pass the conditions below instead of a fixed number.
4. **Seed**: any whole number from 0 to 4,294,967,295. **New seed** draws another one. The same
   seed always selects the same cells, and more cells with the same seed keep every cell of fewer:
   going from 50,000 to 100,000 cells adds cells and does not swap the ones on screen.
5. **Sampling**: **Uniform**, or **Balanced across** an obs column. Balanced sampling gives each
   group of that column an equal share where the group sizes allow; a group smaller than its share
   is taken whole and the rest is spread over the others. Here, **Balanced across Age** takes
   1,000 cells from each of Mid, Old and Young.
6. **Filter (optional): only cells where**: click **Add condition** and choose an obs column, an
   operator and a value. Text columns offer "is one of" and "is not one of" (values comma
   separated); numeric columns offer >, ≥, <, ≤, =, ≠ and "between". Conditions are joined by AND;
   a cell with a missing value passes no condition. Here, `n_genes_by_counts ≥ 1000`.
   **Use filter** copies the filter of an open cell table instead (a top-level AND of conditions
   on obs columns; anything else is reported as not copied). Unlike the table, which only holds
   the cells already loaded, the subset applies the conditions to every cell of the dataset.
7. The preview line under the form says how many cells will be shown, how many pass the filter
   and, for balanced sampling, how many are taken per group. It warns when the subset is so large
   that drawing it can make the browser slow.
8. Click **Apply**. Every panel reloads with the subset's cells.

```{figure} ../_static/screens/user-guide/subsets-applied.png
:class: screenshot
:alt: The app with the subset applied: "Cells: 3,000 of 8,090" and the badge "Subset · seed 0" in the statistics bar, a UMAP with fewer points coloured by cell type and a Removed Datapoints box "Total 5,090 (63%)", and a cell table "Showing 1 to 25 of 3,000 entries".

After **Apply**: the UMAP and the cell table show the same 3,000 cells. View before the subset:
{download}`userguide-subset-start.json <../_tools/views/userguide-subset-start.json>`.
```

## What a subset changes

- **Cell plots** draw only the subset's cells. The **Removed Datapoints** box counts the other
  cells as not in the cell subset (here 5,090, 63 % of 8,090), so its total always accounts for
  every cell of the dataset. Gene plots draw every gene as before.
- **Cell tables** hold the subset's cells (here 3,000 rows), and **Export CSV** writes those
  rows.
- **The Focused Cell picker** only finds cells in the subset.
- **Share links, panel sets and the autosaved view** store the subset's description, so they
  reopen on the same cells (a link to the subset above is 1,351 characters). A view saved with
  every cell of a large dataset records that and reopens with every cell; a view without a subset
  entry, such as an older link, opens with the server's default.

### Every cell of a very large dataset: large-plot mode

A Cell Plot with more than 5 million points (the default of `ui.defaults.large_plot_points`,
{doc}`../reference/configuration`) is drawn in **large-plot mode**. That only happens with the
subset removed, or one larger than that. The panel then says so above the plot:

> Large-plot mode (95.6M points): hover, click and table filters are off; use a subset for them

In this mode:

- **No hover or click on points.** Clicking a point does not focus a cell, and the focused cell
  is not marked.
- **No table filter**, and no 3D. A panel with either keeps the regular drawing, which runs out of
  browser memory a little above 5 million points.
- **A gene's colour is drawn in 64 steps** of the colour scale, the strongest values on top. Every
  change, such as another gene or another colour range, redraws the panel.

Pan, zoom, colour by a category or a gene, point size and opacity work as usual. To hover over,
click or filter cells, apply a subset (above). Why the mode exists and what it costs are in
{doc}`../reference/performance`.

The exact rule (a fixed hash of seed and row, so a notebook can reproduce the selection), the
balancing algorithm and the request format are in {doc}`../design/subsetting`.

## Measured on a large store

On a synthetic store of 1,160,000 cells (Apple M3 Max, Chromium, two UMAP panels, one coloured by
a gene), measured when the subset was introduced:

| | Every cell | Default subset (100,000 cells) |
|---|---|---|
| Open the view | 17 s | 2 s |
| JavaScript heap | 874 MB | 94 MB |
| Recolour by another gene | 21 s | 1.3 s |

Most of the remaining 1.3 s is Plotly redrawing 100,000 coloured points.

```{admonition} What happens on the server
:class: note
Every request on the cell axis (cell names, obs columns, obsm columns, obsp rows, a gene's column of
a layer)
carries the subset's description, a few dozen characters of JSON. The server turns it into the
list of rows once (about 30 ms at 1.16 million cells for a uniform subset), keeps the result in a
small cache, and reads only those rows. Here 8 of the 10 data requests after **Apply** carried the
subset. Gene-axis requests (var columns, varp rows) are unchanged.
```
