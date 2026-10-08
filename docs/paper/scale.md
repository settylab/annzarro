# Scale: Tahoe-100M

```{figure} ../_static/figures/paper/scale.png
:alt: Seven panels. a, every one of 95.6 million Tahoe-100M cells on a UMAP coloured by cell line, one island per cell line, with a small box marked. b, the same cells coloured by FN1 counts. c, a zoom into the box where each dot is one cell. d, part 1 of 957 of the default 100,000-cell subset. e, browser time against dataset size for opening, recolouring, a balanced subset and a part step. f, time to the first plot with every cell, with the large-plot threshold at 1 million points and the point where the memory guard declines at 250 million. g, peak JavaScript heap at the first plot against the tab's heap limit of 4.1 GiB, for every cell and for the default subset.
:width: 100%

*Tahoe-100M on a laptop: every cell in one plot, and a subset that stays interactive*, a figure
of the AnnZarro paper (Otto, Baasri and Setty, in preparation). Panels a to d are the plot areas
of app screenshots; e to g are browser measurements.
```

All 95,624,334 cells of Tahoe-100M {cite:p}`zhang2025tahoe`, on a UMAP fitted to 999,073
reference cells and extended to every other cell by nearest-neighbour placement, in headless
Chromium on an Apple M3 Max laptop (128 GiB RAM). **a**, Every cell coloured by cell line in
large-plot mode, point size 1 and opacity 0.2, drawn 6.8 s after the page was opened. **b**, The
same cells coloured by FN1 counts, the colour scale capped at 30, the 99th percentile over all
cells. **c**, A zoom into one cell line's island, every cell at point size 5 and opacity 1: each dot
is one cell. **d**, The default subset, part 1 of 957 (100,000 cells), in the regular plot with
hover and focus. **e** to **g**, Time and memory against dataset size, from 1 million cells
(prefixes of Tahoe-100M) to all 95.6 million: the default subset stays interactive. In **f** and
**g** the series for every cell continue to larger stores, out to 150 million cells
(described in the paper's Supplementary Note 1). The dotted rule at 1 million points marks the
large-plot threshold, and the rule at 250 million marks where the memory guard declines the
first plot at default settings, so larger stores are not shown. **g** shows the peak JavaScript
(V8) heap at the first plot against the tab's heap limit under default Chromium flags (4.1 GiB,
dashed line): the regular plot fills the heap fastest, large-plot mode keeps the positions off
the heap (0.03 GiB at 150 million cells), and the default subset stays flat. The steps behind each view are in
{doc}`../user-guide/subsets`; the paper's Procedure covers them as Worked example 6, and
{doc}`../tutorials/millions` carries it out step by step.

| Panel | In AnnZarro | View |
|---|---|---|
| a | live: subset off, colour `obs/cell_line_id`, size 1, opacity 0.2 | {ref}`paper-scale-views`, every cell by cell line |
| b | live: colour FN1 from `X`, range 0 to 30 | every cell by FN1 |
| c | live: subset off, zoomed to the box of a, size 5, opacity 1 | every cell, zoomed |
| d | live: the default subset, part 1 | default subset |
| e, part step | live: the next part of the default subset | default subset, part 2 |
| e, balanced subset | live: 100,000 cells balanced across the 50 cell lines | balanced subset |
| e to g, times and memory | measured by the paper's browser benchmark, not a view | ({ref}`paper-companion`) |

## Differences from the paper figure

- **Large-plot mode is not a link setting.** A link that shows every cell of a dataset above
  1 million points opens in large-plot mode, as in a and b, because the app switches by the
  number of points. In that mode hover, click to focus, the focused-cell marker and table
  filters are off; the panel's status strip says "Large plot: no hover/click". Switch the subset
  back on to recover them.
- **Panel c is a crop of the linked zoom.** The link opens the box marked in a (0.33 × 0.35 UMAP
  units, x 14 to 14.33, y 7.8 to 8.15). The paper shows the centre 0.11 × 0.12 of it; zoom in once
  more with the mouse to match.
- **The box and the panel labels** in a are drawn on the figure, not in the app.
- **Panels e to g** are measured, not drawn: medians over 3 cold runs per dataset size, from
  the paper's benchmark results ({ref}`paper-companion`). They have no view. On your own machine, the
  times depend on the disk, the browser and the GPU.
- **Times are the paper's.** The views were not timed for this page; on a 95.6-million-cell store
  expect several seconds per every-cell view. The paper's benchmark drew every cell in 5 to 6 s;
  its screenshots of panels a, b and c were drawn 6.8, 7.1 and 6.5 s after the page was opened.

(paper-scale-views)=
## Views

The links are ready for a local server with the Tahoe-100M store `tahoe_panel_95.6M_plot.zarr`
in its data directory ({ref}`paper-scale-store`); to use another server address, another store
name or a store elsewhere, see {ref}`tut-start-links`. A share link records the cell subset and
the part, so each link reopens the same cells.

::::{dropdown} Panel a: every cell by cell line (subset off)
```{literalinclude} ../_static/panelsets/paper/scale-every-cell-by-cell-line.url.txt
:language: text
```
::::

::::{dropdown} Panel b: every cell by FN1, colour scale capped at 30
```{literalinclude} ../_static/panelsets/paper/scale-every-cell-by-fn1.url.txt
:language: text
```
::::

::::{dropdown} Panel c: every cell, zoomed into the box of panel a
```{literalinclude} ../_static/panelsets/paper/scale-every-cell-zoom.url.txt
:language: text
```
::::

::::{dropdown} Panel d: the default subset, part 1 of 957
```{literalinclude} ../_static/panelsets/paper/scale-default-subset.url.txt
:language: text
```
::::

::::{dropdown} Part step: the default subset, part 2 of 957
```{literalinclude} ../_static/panelsets/paper/scale-next-part.url.txt
:language: text
```
::::

::::{dropdown} Balanced subset: 100,000 cells balanced across the cell lines
```{literalinclude} ../_static/panelsets/paper/scale-balanced-subset.url.txt
:language: text
```
::::

Panel sets: {download}`scale-every-cell-by-cell-line.json <../_static/panelsets/paper/scale-every-cell-by-cell-line.json>`,
{download}`scale-every-cell-by-fn1.json <../_static/panelsets/paper/scale-every-cell-by-fn1.json>`,
{download}`scale-every-cell-zoom.json <../_static/panelsets/paper/scale-every-cell-zoom.json>`,
{download}`scale-default-subset.json <../_static/panelsets/paper/scale-default-subset.json>`,
{download}`scale-next-part.json <../_static/panelsets/paper/scale-next-part.json>`,
{download}`scale-balanced-subset.json <../_static/panelsets/paper/scale-balanced-subset.json>`.
Loading one restores the dataset, the subset, the focus and the layout, like the links
({doc}`../user-guide/panel-sets`).

The views are written by `docs/_tools/start_links.py scale` from the view files of the paper's
v0.4.1 screenshots (`figures/scale/*.view.json` in the paper's companion repository,
{ref}`paper-companion`). The script adds what
the screenshot script set through the app: the subset, the part, and the zoom and point size of
panel c.

(paper-scale-store)=
## The Tahoe-100M store

The views need an AnnZarro store of all 95,624,334 cells of Tahoe-100M with a UMAP. The paper's
store `tahoe_panel_95.6M_plot.zarr` holds:

- `X`: raw counts, CSC, with values for a 200-gene panel (FN1 among them); `var` lists 5,000 genes;
- `obsm/X_umap`: the UMAP of the figure;
- `obs`: per-cell metadata of the release, including `cell_line_id` (50 cell lines) and `plate`.

```{important}
**Placeholder: no public download yet.** The store, or the UMAP coordinates needed to rebuild it,
will be linked here when they are deposited. Until then, build the store yourself as below.
```

**Download the data.** Tahoe-100M is public on Hugging Face as the dataset `tahoebio/Tahoe-100M`
(CC0 1.0) {cite:p}`zhang2025tahoe`: 3,388 parquet shards of about 28,000 cells each, one record per
cell with its gene tokens, raw counts and metadata, and the gene vocabulary in
`metadata/gene_metadata.parquet`. With the Hugging Face command line tool:

```bash
pip install -U huggingface_hub
huggingface-cli download tahoebio/Tahoe-100M --repo-type dataset --local-dir tahoe-100m
```

**Build the store.** The script that turns the shards into this store will be published with the
paper; it is not public yet, and this page will link it then. What it does, so that you can
reproduce the store with your own code in the meantime:

1. Per-cell metadata (`obs`) from the shards, in shard order.
2. A reference set of 999,073 cells, the same number from every plate × cell line stratum (at
   most 1,430, seed 0).
3. PCA (50 components) of normalised, log-transformed counts, fitted on the reference cells; every
   cell projected exactly. The counts are written as a chunked zarr store (CSC `X`) over the 5,000
   genes of highest variance.
4. A UMAP (umap-learn, 15 neighbours, `min_dist` 0.3, seed 0) fitted on the reference cells'
   PCs; every other cell placed at the distance-weighted mean of its 15 nearest reference cells
   in PC space (faiss; recall 0.997 against exact search), written to `obsm/X_umap`.
5. For the figure, a slim copy (16 GB) with values for 200 panel genes and no layers.

The full build ran on an HPC cluster. A smaller store of the first N cells shows the same views
with fewer parts: the subset links work on any store above 200,000 cells, and every-cell links
switch to large-plot mode above 1 million.

If you build the store under another name, change `dataset_path=` in the links
({ref}`tut-start-links`).
