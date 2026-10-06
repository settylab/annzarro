(tut-cell-similarity)=
# How similar are these cells really?

A UMAP invites you to read distance as similarity: cells drawn close together look alike,
cells far apart look different. UMAP keeps local neighbourhoods only approximately and can place
small, isolated populations between clusters arbitrarily {cite:p}`chari2023`. The similarity your analysis
actually uses (a kNN graph, a diffusion kernel, a pseudotime distance) is a cells × cells
matrix, and it can be stored in `obsp` with the data.

This tutorial reads such matrices one row at a time. The focused cell picks its row, and the
row colours, or places, every cell. First you follow a diffusion walk from a stem cell to a
monocyte; then you plot, for one plasma cell, its UMAP distance to every cell against its
diffusion distance, and find the cells where the two disagree.

The results are the panels of the AnnZarro paper's cell-by-cell figure ({doc}`../paper/cell-by-cell`).
If you have not used AnnZarro before, {doc}`tour` introduces the focus and the controls.

## What you need

- AnnZarro with `bm_aging_showcase.zarr` in its data directory ({doc}`../data/showcase-store`).
  Section 1 also works on `bm_aging.zarr` without the path table.
- These fields:

| Slot | Key | What it is | Live or precomputed |
|---|---|---|---|
| `obsm` | `X_umap` | cell axes | |
| `obsp` | `diffusion_walk_t5` | dense 8,090 × 8,090 five-step walk, T⁵ with T the row-normalised `DM_Kernel` | **live**: the focused cell's row |
| `obsp` | `umap_distance` | dense Euclidean distance on `X_umap` | **live** |
| `obsp` | `diffusion_distance` | dense Euclidean distance in Palantir's multiscale diffusion space (`obsm/X_diffusion`, 39 components) {cite:p}`setty2019` | **live** |
| `obs` | `fig3a_path_cell`, `fig3a_path_step`, `fig3a_focus_cells` | the 13 cells on the shortest diffusion path from the HSC to the monocyte, their order 0 to 12, and four labelled stops | precomputed by the paper's figure code |
| `obs` | `fig3_plasma_groups` | the plasma cell's two discordant groups (below), with colours in `uns/fig3_plasma_groups_colors` | precomputed for one plasma cell |
| `obs` | `highres_celltype` | 31 cell types | |

- Cells: HSC `HSPC_Old_1#GAAGCCCGTGGCTCTG-1`, LMPP `HSPC_Old_2#ACTCTCGCAAACCGGA-1`, GMP
  `HSPC_Old_3#ATTTCACTCGTAGTGT-1`, monocyte `Mature_Young_2#TCAATTCAGTGAGGCT-1`, plasma cell
  `Mature_Mid_1#GCCATGGAGTATGATG-1`.

Every row of these matrices is 8,090 float32 values; a focus change reads one row per panel,
never the whole matrix ({doc}`../data/pairwise-matrices`).

(tut-cell-walk)=
## 1. Follow a diffusion walk from a stem cell to a monocyte

::::{dropdown} Start here: the walk and the path table
```{literalinclude} ../_static/panelsets/paper/cell-by-cell-walk.url.txt
:language: text
```
Panel set file: {download}`cell-by-cell-walk.json <../_static/panelsets/paper/cell-by-cell-walk.json>`. The link is
ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

A row of the walk matrix says where a five-step random walk on the diffusion kernel, started at
the focused cell, ends up. It is a similarity that respects the data's manifold. Walking the focus
along a trajectory shows how far each cell state reaches.

1. Choose `bm_aging_showcase.zarr` in **Dataset**. Set **Focused Cell** to
   `HSPC_Old_1#GAAGCCCGTGGCTCTG-1` (click the box, type, Enter, Esc).
2. In the Welcome tile click **Cell Plot**. **X** `obsm` · `X_umap` · `0`, **Y**
   `obsm` · `X_umap` · `1`, **Color** `obsp` · `diffusion_walk_t5`. The third dropdown reads
   "Focused cell HSPC_Old_1#…". **Map** `Blues`, **Reverse** on.
3. Click "Split Horizontally" in the tile header and choose **Cell Table**. In its controls,
   under "Available Columns" on the `obs` tab, tick `fig3a_path_step`, `fig3a_focus_cells` and
   `highres_celltype`, and click **Apply Changes**.
4. In "Advanced Search" click **Add Condition** and set `fig3a_focus_cells` · `Not` ·
   `not on path`. The footer reads "Showing 1 to 13 of 13 entries (filtered from 8,090 total
   entries)". Click the `fig3a_path_step` header to sort the path from 0 (the HSC) to 12 (the
   monocyte). Close both panels' controls.

```{figure} ../_static/screens/paper/fig3-a-page.png
:class: screenshot
:alt: Left, the walk UMAP from the HSC, a small blue patch at the lower right. Right, a table of the 13 path cells sorted by fig3a_path_step, with HSC (start), LMPP (1/3 of path) and GMP (2/3 of path) labelled.
:width: 100%

The walk from the HSC beside the 13 path cells (2 HSC, 4 LMPP, 5 GMP, 2 monocytes). The cell
ID in each row is a link: clicking it focuses that cell.
```

5. In the table, click the cell ID in the row `LMPP (1/3 of path)`
   (`HSPC_Old_2#ACTCTCGCAAACCGGA-1`), then `GMP (2/3 of path)`, then the monocyte (path step 12).
   In a small tile the last rows sit below the visible part of the table; scroll it, or type
   `Mature_Young_2#TCAATTCAGTGAGGCT-1` into **Focused Cell**.

::::{grid} 2 2 4 4
:gutter: 2

:::{grid-item}
```{figure} ../_static/screens/paper/fig3-a-1-HSC.png
:class: screenshot
:alt: Walk from the HSC, confined to the HSC cluster.

HSC (start)
```
:::
:::{grid-item}
```{figure} ../_static/screens/paper/fig3-a-2-LMPP.png
:class: screenshot
:alt: Walk from the LMPP, spread over the lower half of the central cluster.

LMPP (1/3 of path)
```
:::
:::{grid-item}
```{figure} ../_static/screens/paper/fig3-a-3-GMP.png
:class: screenshot
:alt: Walk from the GMP, spread over the middle of the central cluster.

GMP (2/3 of path)
```
:::
:::{grid-item}
```{figure} ../_static/screens/paper/fig3-a-4-Monocyte.png
:class: screenshot
:alt: Walk from the monocyte, concentrated in the monocyte cluster at the top of the central cluster.

Monocyte (end)
```
:::
::::

6. Step back along the path with the history arrows left of **Focused Cell**: the left arrow
   ("Previous cell") returns to the previous focused cell (the GMP, then the LMPP, then the HSC),
   and the right arrow ("Next cell") goes forward again.
   Each step re-reads one row, so the walk panel follows.

```{figure} ../_static/screens/tutorials/we1-history.png
:class: screenshot
:alt: The Focused Cell box with its back and forward arrows, holding HSPC_Old_1#GAAGCCC… after two steps back.
:width: 45%

Two steps back from the GMP: the HSC is focused again.
```

The walk spreads as it leaves the stem cell and contracts again in the monocytes. The row maxima
are 0.0126 (HSC), 0.0078 (LMPP), 0.0063 (GMP) and 0.0099 (monocyte). The HSC keeps 90.7% of
its walk mass among HSCs and the monocyte 88.6% among monocytes, while the GMP keeps only 24.3%
among GMPs (`figures/NOTES.md` of the paper): a progenitor is similar to many states at once.

7. To compare the four rows on one scale, focus the HSC first, open the walk panel's controls and
   click **Lock Range**. The colour range stays at the HSC's, 0 to 0.0126, which is also the
   largest value in the four rows. Click **Lock Range** again to let each row scale itself.

:::{note}
**Paper, cell by cell, panel a.** The four frames are panel a of the paper figure, there drawn with a log colour
scale and the path as a line ({ref}`differences <cell-by-cell-differences>`).
:::

8. (Optional) Compare neighbourhood definitions for the same cell. Click **Split side by side**
   in the walk panel's header and, in the new pane under **Duplicate or Reopen Panel**, click the
   card "5-step diffusion walk from the focused cell". A copy opens beside it. In the copy's
   controls set **Color** to `obsp` · `DM_Kernel` (the diffusion kernel the walk is built from;
   `distances`, the kNN distance graph, works the same way). The row selector reads "Focused
   cell"; both panels follow the focus.

```{figure} ../_static/screens/tutorials/we1-duplicate.png
:class: screenshot
:alt: Two UMAPs side by side for the GMP HSPC_Old_3#ATTTCACTCGTAGTGT-1. Left, the five-step walk, a broad blue band through the middle of the central cluster, maximum 0.006. Right, the copy coloured by DM_Kernel, a few dozen blue cells next to the focused cell, maximum 0.8.
:width: 90%

The GMP's five-step walk (left) and its row of `DM_Kernel` (right): the kernel reaches only the
cell's nearest neighbours; five steps of the walk spread over the central cluster.
```

Along this trajectory the UMAP is a fair guide: the walk from each stop lands on its UMAP
neighbours. The next section finds where that fails.

(tut-cell-distance-axes)=
## 2. Plot UMAP distance against diffusion distance

::::{dropdown} Start here: distances as axes, groups on the UMAP (sections 2 and 3)
```{literalinclude} ../_static/panelsets/paper/cell-by-cell-umap-vs-diffusion.url.txt
:language: text
```
Panel set file: {download}`cell-by-cell-umap-vs-diffusion.json <../_static/panelsets/paper/cell-by-cell-umap-vs-diffusion.json>`. The link is
ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

A cell plot can take a row of obsp as an axis, not only as a colour. With the focus on one cell,
each point is another cell, at x = its UMAP distance to the focus and y = its diffusion distance.
Where the two agree the points fall on a rising band; where they disagree they leave it.

9. Set **Focused Cell** to the plasma cell `Mature_Mid_1#GCCATGGAGTATGATG-1`.
10. Add a **Cell Plot** (split a tile). Set **X** `obsp` · `umap_distance` and **Y**
   `obsp` · `diffusion_distance`. The third dropdown of each reads "Focused cell
   Mature_Mid_1#…". Set **Color** `obs` · `fig3_plasma_groups` and leave **Palette** at
   "As stored in adata.uns".

```{figure} ../_static/screens/paper/fig3-controls-axes.png
:class: screenshot
:alt: Cell plot controls with X obsp umap_distance "Focused cell Mature_Mi..." and Y obsp diffusion_distance "Focused cell Mature_Mi...", each with an open padlock; Color obs fig3_plasma_groups with Palette "As stored in adata.uns".
:width: 70%

Both axes are rows of obsp that follow the focused cell. Each has its own padlock.
```

The colour marks two groups that the paper's figure code computed from the plasma cell's rank
percentiles. Orange, "near in UMAP, far in diffusion": among its 5% nearest cells on the UMAP
but outside its 20% nearest in diffusion space. Blue, "far in UMAP, near in diffusion": the
reverse.

(tut-cell-groups-umap)=
## 3. Find the disagreeing cells on the UMAP

::::{dropdown} Start here: the view of sections 2 and 3
```{literalinclude} ../_static/panelsets/paper/cell-by-cell-umap-vs-diffusion.url.txt
:language: text
```
Panel set file: {download}`cell-by-cell-umap-vs-diffusion.json <../_static/panelsets/paper/cell-by-cell-umap-vs-diffusion.json>`. The link is
ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

11. Add a second **Cell Plot** with UMAP axes and **Color** `obs` · `fig3_plasma_groups`.

```{figure} ../_static/screens/paper/fig3-bc.png
:class: screenshot
:alt: Left, a scatter of UMAP distance (x) against diffusion distance (y) from the plasma cell, with an orange band at small UMAP distance and diffusion distance about 33, and a blue band at UMAP distance 9 to 13 and diffusion distance about 4. Right, the UMAP with blue naive and memory B cells at the left, orange clusters to the right of and below the focused plasma cell.
:width: 100%

Left: orange, 265 cells, near the plasma cell on the UMAP (x from 3.3 to 6.0) but far in
diffusion space (y from 32.4 to 36.6); blue, 392 cells, far on the UMAP (x from 9.0 to 12.8)
but among its nearest in diffusion space (y from 2.6 to 5.0). Right: the blue cells are naive
and memory B cells at the far left of the UMAP; the orange clusters sit next to the plasma cell
(dark dot).
```

:::{note}
**Paper, cell by cell, panels b and c.** The two panels are panels b and c of the paper figure.
:::

The UMAP places the plasma cell beside pDCs, NK cells, basophils and T cells, but its diffusion
neighbours are B cells, its developmental relatives. In the walk matrix the orange cells receive
0.09% of the plasma cell's walk mass and the blue cells 59.2% (paper numbers, computed offline).
The plasma cells are a small population that UMAP placed between clusters; across all 8,090
cells the UMAP keeps the global rank order of diffusion distances well (median per-cell Spearman
ρ 0.85) but not local neighbourhoods (median 14 of 30 nearest neighbours shared).

12. Click any other cell in the right-hand panel. The left panel redraws as that cell's
    distances, because both axes follow the focus; the colours stay the plasma cell's groups,
    since `fig3_plasma_groups` is a fixed obs column. Lock both axes (their padlocks) first to
    keep the plasma cell's distances while you explore.

(tut-cell-check)=
## Check the numbers

Table filters count the groups. Add a **Cell Table** with the columns `highres_celltype` and
`fig3_plasma_groups` and set "Advanced Search" as below. Each count was read from the app.

| Statement | Advanced Search (AND) | Table footer |
|---|---|---|
| 265 cells near in UMAP, far in diffusion | `fig3_plasma_groups` Equals `near in UMAP, far in diffusion` | 265 entries |
| 392 cells far in UMAP, near in diffusion | `fig3_plasma_groups` Equals `far in UMAP, near in diffusion` | 392 entries |
| 92 of the orange cells are pDCs, 66 NK cells | add `highres_celltype` Equals `pDC` (or `NK`) | 92 (66) entries |
| 274 of the blue cells are naive B cells, 111 memory B cells | add `highres_celltype` Equals `Mature Naive B cell` (or `Memory B cell`) | 274 (111) entries |
| The path has 13 cells | `fig3a_focus_cells` Not `not on path` | 13 entries |

The Spearman ρ between the plasma cell's two rows (0.62), the walk masses and the dataset-wide
medians are not computed by AnnZarro; they come from `figures/fig2_cell_by_cell.py` in the
paper repository and were checked when the showcase store was built ({doc}`../data/showcase-store`).

(tut-cell-views)=
## Open the views

The views of this tutorial, each also in the **Start here** box of its section. They are ready
for a local server with `bm_aging_showcase.zarr` in its data directory; {ref}`tut-start-links`
says which part to change for another server address or store location.

::::{dropdown} Section 1: walk and path table
```{literalinclude} ../_static/panelsets/paper/cell-by-cell-walk.url.txt
:language: text
```
::::

::::{dropdown} Sections 2 and 3: distances as axes, groups on the UMAP
```{literalinclude} ../_static/panelsets/paper/cell-by-cell-umap-vs-diffusion.url.txt
:language: text
```
::::

The same panels as panel set files ({ref}`tut-tour-load-file`):
{download}`cell-by-cell-walk.json <../_static/panelsets/paper/cell-by-cell-walk.json>`,
{download}`cell-by-cell-umap-vs-diffusion.json <../_static/panelsets/paper/cell-by-cell-umap-vs-diffusion.json>`.

## Your own data

Any cells × cells matrix in `obsp` works the same way: a kNN graph (`connectivities`,
`distances`, sparse), a diffusion kernel, Palantir or Mellon kernels, or a dense distance you
compute. Dense rows are cheapest to read when each chunk holds whole rows; see
{doc}`../data/pairwise-matrices` for sizes and chunking. To store the two distances used here:

```python
from scipy.spatial.distance import cdist
adata.obsp["umap_distance"] = cdist(adata.obsm["X_umap"], adata.obsm["X_umap"]).astype("float32")
adata.obsp["diffusion_distance"] = cdist(adata.obsm["X_diffusion"], adata.obsm["X_diffusion"]).astype("float32")
```

A dense 8,090 × 8,090 float32 matrix is 262 MB uncompressed; at a million cells a dense matrix
is not practical, and a sparse kNN or kernel matrix is the better choice.

## What you learned

- A row of an obsp matrix shows what one cell is similar to, by the measure you stored, not by
  the UMAP.
- Walking the focus along a trajectory shows how each state's neighbourhood widens and narrows.
- Two obsp rows as axes compare two notions of distance for one cell, and the disagreeing cells
  can be marked and found on the UMAP.

Next: {doc}`gene-similarity` reads a genes × genes matrix the same way.
