(tut-tour)=
# A first tour: one focused cell, one focused gene

AnnZarro shows big matrices one slice at a time. There is always one **focused cell** and one
**focused gene**. The focused cell picks its row of every cells × cells matrix (obsp) and of
every cells × genes layer; the focused gene picks its column of every layer and its row of every
genes × genes matrix (varp). Each plot is coloured, or placed, by whichever slice its controls
name. Clicking a point moves the focus, and every panel that depends on it fetches its one new
slice.

This tour builds that model in the app, then uses it: it walks a diffusion kernel along
haematopoiesis, filters cells with a two-condition table, and saves and shares the result.
Along the way you rebuild the focus model of the paper's overview figure as a live layout, and
the screenshots of its interface figure ({doc}`../paper/overview`, {doc}`../paper/interface`).

## What you need

- AnnZarro with `bm_aging.zarr` in its data directory ({doc}`../getting-started/quickstart`,
  {doc}`../data/demo-data`). `bm_aging_showcase.zarr` works too; it contains the same fields.
- These fields:

| Slot | Key | What it is | Selected by |
|---|---|---|---|
| `obsm` | `X_umap` | cell axes | |
| `obs` | `highres_celltype`, `Age`, `kompot_da_Young_to_Old_lfc_zscore` | cell type (31 levels), age group, Kompot differential abundance z-score (Young to Old) | |
| `obsp` | `diffusion_walk_t5` | five-step diffusion walk, dense 8,090 × 8,090 | the focused cell's row |
| `layers` | `kompot_de_Young_to_Old_fold_change` | Kompot fold change, Old minus Young smoothed log expression | the focused gene's column, or the focused cell's row |
| `varp` | `spearman_fold_change` | Spearman ρ of two genes' fold changes across cells | the focused gene's row |
| `var` | `kompot_de_Young_to_Old_mean_lfc`, `kompot_de_Young_to_Old_mahalanobis` | volcano axes | |

- Cells and genes used: the old haematopoietic stem cell (HSC) `HSPC_Old_1#GAAGCCCGTGGCTCTG-1`
  and the gene `H2-Q7`, the paper's examples.

(tut-tour-focus)=
## 1. Open the data and set the focus

1. In the header choose `bm_aging.zarr` in **Dataset**.
2. Click the **Focused Gene** box, type `H2-Q7`, press Enter. Click the **Focused Cell** box,
   type or paste `HSPC_Old_1#GAAGCCCGTGGCTCTG-1`, press Enter. Both lists stay open after
   Enter; press Esc to close them.

The arrows left of each box ("Previous cell", "Next cell") step through the history of the
focus.

(tut-tour-cell-row)=
## 2. One cell, one row

::::{dropdown} Start here: this section's walk, beside the focused cell's kernel row (protocol view A)
```{literalinclude} ../_static/panelsets/protocol/protocol-A-kernel-walk.url.txt
:language: text
```
Panel set file: {download}`protocol-A-kernel-walk.json <../_static/panelsets/protocol/protocol-A-kernel-walk.json>`. The link is
ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

3. In the Welcome tile, under "Create New Panel", click **Cell Plot**. A new panel opens with
   its controls showing. Set:
   - **X** `obsm` · `X_umap` · `0`; **Y** `obsm` · `X_umap` · `1`.
   - **Color** `obsp` · `diffusion_walk_t5`. The third dropdown now reads "Focused cell
     HSPC_Old_1#…": the colour is that cell's row.
   - **Map** `Blues`, then click **Reverse**, so that a cell the walk does not
     reach is light grey and the outline of the UMAP stays visible.

   ```{figure} ../_static/screens/paper/fig1-controls-walk.png
   :class: screenshot
   :alt: Cell plot controls. X obsm X_umap 0, Y obsm X_umap 1, Color obsp diffusion_walk_t5 "Focused cell HSPC_Old_1#", Map Blues with Reverse active.
   :width: 70%

   The open padlock beside the third Color dropdown means the panel follows the focused cell.
   ```

4. Click the title in the tile header and rename the panel "5-step diffusion walk from the
   focused cell". Close the controls with the chevron ("Toggle Controls") in the header.

Each cell's colour is the probability that a five-step random walk on the diffusion kernel,
started at the focused HSC, ends in that cell. The walk stays among the HSCs: the row's
largest value is 0.0126, and 90.7% of its mass is on HSCs (`figures/NOTES.md` of the paper).

(tut-tour-clicks)=
## 3. Click to move the focus

::::{dropdown} Start here: the walk and the cell types as this section sets them up
```{literalinclude} ../_static/panelsets/paper/interface-focus-sequence.url.txt
:language: text
```
Panel set file: {download}`interface-focus-sequence.json <../_static/panelsets/paper/interface-focus-sequence.json>`. The link is
ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

To see where each click lands, put a cell-type map beside the walk.

5. Click "Split Horizontally" (the first of the two split icons in the tile header). In the
   new "Add New Panel" tile choose **Cell Plot**: UMAP axes as before, **Color** `obs` ·
   `highres_celltype`, **Palette** "As stored in adata.uns". Close its
   controls.
6. Hover over cells in the walk panel: the label shows the cell ID and `highres_celltype`.
   Click a GMP in the middle of the central cluster, near UMAP (12, 3). The paper clicked
   `HSPC_Old_3#GGGTATTAGGCCGCTT-1`. The header's **Focused Cell** changes, and the walk panel
   fetches that cell's row (8,090 numbers) and recolours.
7. Click a cMoP near (12.5, 8), for example `Mature_Young_1#CAAGGGATCCCGTAAA-1`.
8. Click a monocyte near (10, 7.5), for example `Mature_Young_1#CAACCAAGTATACCCA-1`.

::::{grid} 2 2 4 4
:gutter: 2

:::{grid-item}
```{figure} ../_static/screens/paper/fig2-b-1-HSC.png
:class: screenshot
:alt: Walk from the HSC, confined to the HSC cluster at the lower right of the UMAP.

1 · HSC
```
:::
:::{grid-item}
```{figure} ../_static/screens/paper/fig2-b-2-GMP.png
:class: screenshot
:alt: Walk from a GMP, spread widely over the central progenitor cluster.

2 · GMP
```
:::
:::{grid-item}
```{figure} ../_static/screens/paper/fig2-b-3-cMoP.png
:class: screenshot
:alt: Walk from a cMoP, concentrated at the top of the central cluster.

3 · cMoP
```
:::
:::{grid-item}
```{figure} ../_static/screens/paper/fig2-b-4-Monocyte.png
:class: screenshot
:alt: Walk from a monocyte, concentrated in the monocyte cluster at the top of the central cluster.

4 · monocyte
```
:::
::::

Each colour bar is scaled to its own row: the HSC's walk peaks at 0.0126, the GMP's at 0.0047,
because a progenitor's walk spreads over more cells. The colour-bar title ends with the ID of
the cell whose row is shown. The arrows beside **Focused Cell** replay the sequence.

:::{note}
**Paper, interface, panel b.** These four frames are panel b of the paper figure.
:::

{doc}`cell-similarity` uses this panel to ask what a kernel row says that the UMAP does not.

(tut-tour-four-arrows)=
## 4. The four slices of the focus model

::::{dropdown} Start here: the four slices this section builds
```{literalinclude} ../_static/panelsets/paper/overview-focus-model.url.txt
:language: text
```
Panel set file: {download}`overview-focus-model.json <../_static/panelsets/paper/overview-focus-model.json>`. The link is
ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

The walk panel uses one of four kinds of slice. This section puts all four on screen: a 2 × 2
grid whose left column holds cell scatters and right column gene scatters, with the top row
driven by the focused cell and the bottom row by the focused gene.

9. Close the cell-type panel (× in its header), then focus the HSC again (step 2).
10. **Top right: the focused cell's row of a layer.** Click "Split Horizontally" on the walk
    tile and choose **Gene Plot**. Set **X** `var` · `kompot_de_Young_to_Old_mean_lfc`
    and **Y** `var` · `kompot_de_Young_to_Old_mahalanobis` (a volcano), **Color**
    `layer` · `kompot_de_Young_to_Old_fold_change`. The third dropdown reads "Focused cell …".
    Choose **Map** `RdBu` and click **Center at 0**.
11. **Bottom left: the focused gene's column of the same layer.** Click "Split Vertically"
    (the second split icon) on the walk tile, choose **Cell Plot**, UMAP axes, **Color**
    `layer` · `kompot_de_Young_to_Old_fold_change` (third dropdown "Focused gene H2-Q7"),
    **Map** `RdBu`, **Center at 0**.
12. **Bottom right: the focused gene's row of varp.** Click "Split Vertically" on the gene
    plot, choose **Gene Plot**, volcano axes, **Color** `varp` · `spearman_fold_change` (third
    dropdown "Focused gene H2-Q7"). Choose **Map** `RdBu`, type `-1` in **Min** and `1`
    in **Max**, and click **Lock Range**, so that a colour means the same ρ for every gene you
    focus.

    ```{figure} ../_static/screens/paper/fig1-controls-varp.png
    :class: screenshot
    :alt: Gene plot controls. X var kompot_de_Young_to_Old_mean_lfc, Y var kompot_de_Young_to_Old_mahalanobis, Color varp spearman_fold_change "Focused gene H2-Q7", RdBu from -1 to 1 with Lock Range active.
    :width: 70%

    Controls of the bottom-right panel.
    ```

13. Close all controls.

```{figure} ../_static/screens/paper/fig1-1-start.png
:class: screenshot
:alt: Four panels. Top left, UMAP with a small blue patch around the focused HSC. Top right, volcano coloured red and blue by the HSC's fold change per gene. Bottom left, UMAP coloured by H2-Q7's fold change, red in most cells. Bottom right, volcano coloured by Spearman rho with H2-Q7.
:width: 100%

Focused cell HSC, focused gene H2-Q7. Top left: the HSC's row of the walk. Top right: the
HSC's fold change for each gene. Bottom left: H2-Q7's fold change in each cell. Bottom right:
each gene's ρ with H2-Q7; H2-Q7 itself is the large dot at the top right (mean log₂ fold
change 0.37, Mahalanobis distance 15.2).
```

14. Click a monocyte in the top-left panel, near (10, 7.5). The screenshot below clicked
    `Mature_Young_1#AGAGAATCACTTCATT-1`.

```{figure} ../_static/screens/paper/fig1-2-cell-click.png
:class: screenshot
:alt: After clicking a monocyte. Top left shows a blue patch around the monocyte cluster; top right shows a weaker fold-change pattern. The bottom row is unchanged.
:width: 100%

One click on a cell recolours the top row only: the walk now spreads over the monocytes, and
the gene scatter shows this monocyte's fold changes, from −0.39 to +0.40 against −1.35 to
+1.11 for the HSC. The bottom row depends only on the focused gene and did not change.
```

15. Click `H2-Aa` in the bottom-right volcano: mean log₂ fold change 0.14, Mahalanobis
    distance 12.6, below and left of H2-Q7. Hover to confirm the name.

```{figure} ../_static/screens/paper/fig1-3-gene-click.png
:class: screenshot
:alt: After clicking H2-Aa. Bottom left shows H2-Aa's fold change, blue in the naive B cells and red in the memory B cells below them; bottom right shows H2-Aa's correlation row. The top row is unchanged.
:width: 100%

One click on a gene recolours the bottom row only: H2-Aa's fold change in every cell (median
−0.60 in naive B cells, +1.41 in memory B cells, the two clusters at the left) and its ρ with
every gene, where the MHC class II genes near it turn red ({doc}`gene-similarity` follows this
module). In both gene scatters the large dot moved to H2-Aa.
```

:::{note}
**Paper, overview, panel a.** The four panels are the four arrows of the focus-model diagram, each ending
in a scatter.
:::

(tut-tour-lock)=
## 5. Lock a panel and move the focus past it

::::{dropdown} Start here: the four slices of section 4
```{literalinclude} ../_static/panelsets/paper/overview-focus-model.url.txt
:language: text
```
Panel set file: {download}`overview-focus-model.json <../_static/panelsets/paper/overview-focus-model.json>`. The link is
ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

A lock pins one panel's slice to the cell or gene it shows now, while the other panels keep
following the focus. This is how you compare two cells or two genes side by side
({doc}`cells-and-genes` compares two cells gene by gene this way).

16. Open the top-left panel's controls and click the padlock right of the third **Color**
    dropdown. It turns blue and its tooltip reads "Unlock (follow focused element)".

    ```{figure} ../_static/screens/paper/fig1-4-lock-button.png
    :class: screenshot
    :alt: The Color selector of the walk panel with the padlock closed and blue.
    :width: 70%
    ```

17. Close the controls and focus the HSC again from the header.

```{figure} ../_static/screens/paper/fig1-4-locked.png
:class: screenshot
:alt: Focus is the HSC again. Top left still shows the monocyte's walk; top right shows the HSC's fold-change row; bottom left marks the HSC in the bottom right of the UMAP.
:width: 100%

The header names the HSC and the top-right panel shows its fold changes again. The locked walk
panel still shows the monocyte's row; its colour-bar title names the cell it is locked to.
```

The dark dot in every cell panel, the locked one included, marks the focused cell (the HSC).
While a panel is locked and the focus differs, a crosshair button ("Refocus to current
selection") appears beside the padlock. It makes the locked cell the focused cell again, so the
other panels catch up with the locked one; the panel stays locked. Click the padlock again to
make the panel follow the focus.

(tut-tour-overview)=
## 6. Four linked panels with a table

::::{dropdown} Start here: the four linked panels this section builds
```{literalinclude} ../_static/panelsets/paper/interface-overview.url.txt
:language: text
```
Panel set file: {download}`interface-overview.json <../_static/panelsets/paper/interface-overview.json>`. The link is
ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

The paper's overview screenshot combines a walk, a volcano, a fold-change map and a cell
table. From the grid of section 4:

18. Unlock the walk panel, and focus `H2-Q7` and the HSC again.
19. In the top-right gene plot (the cell's row of the layer), change **Color** to `varp` ·
    `spearman_fold_change` with **Map** `RdBu`, **Min** `-1`, **Max** `1` and **Lock
    Range**, as in step 12. Close the bottom-right volcano with × in its header; the top-right
    one now holds the same view.
20. Click "Split Vertically" on the top-right volcano and choose **Cell Table**. In its
    controls, under "Available Columns" on the `obs` tab, tick `Age`, `highres_celltype` and
    `kompot_da_Young_to_Old_lfc_zscore` (type in "Search obs..." to find them) and click
    **Apply Changes**. In "Advanced Search" click **Add Condition** and set
    `highres_celltype` · `Equals` · `HSC`.
21. Close all controls.

```{figure} ../_static/screens/paper/fig2-a-overview.png
:class: screenshot
:alt: The AnnZarro window with four panels and the header showing Focused Gene H2-Q7 and Focused Cell HSPC_Old_1#GAAG.
:width: 100%

The table reads "Showing 1 to 25 of 319 entries (filtered from 8,090 total entries)": all 319
HSCs. Click a cell ID in the table and it becomes the focused cell.
```

:::{note}
**Paper, interface, panel a.** This layout is panel a of the paper figure.
:::

(tut-tour-filter)=
## 7. Filter cells with two conditions and mask a plot

::::{dropdown} Start here: the filtered table and the masked UMAP (protocol view E)
```{literalinclude} ../_static/panelsets/paper/interface-table-filter.url.txt
:language: text
```
Panel set file: {download}`interface-table-filter.json <../_static/panelsets/paper/interface-table-filter.json>`. The link is
ready for a local server; {ref}`what to change for yours <tut-start-links>`.
::::

A cell table's "Advanced Search" holds any number of conditions combined with AND or OR,
nested if needed. A plot can take the rows that pass as a mask ("Table filter"). The mask
needs no new data from the server, because the plot already holds every cell.

22. Start a new layout (or split any tile) with a **Cell Table**: tick `Age`,
    `highres_celltype` and `kompot_da_Young_to_Old_lfc_zscore`, **Apply Changes**.
23. **Add Condition**: `highres_celltype` · `Equals` · `HSC`.
24. **Add Condition** again: `kompot_da_Young_to_Old_lfc_zscore` · `Greater Than` · type `2`.
    The vertical **AND** button left of the conditions combines them; click it to switch to OR.
    The footer reads "Showing 1 to 25 of 290 entries (filtered from 8,090 total entries)".

    ```{figure} ../_static/screens/paper/fig2-table-controls.png
    :class: screenshot
    :alt: Cell table with its controls open. Available Columns tabs obs, obsm, obsp, layers; Selected Columns Age, highres_celltype, kompot_da_Young_to_Old_lfc_zscore; Advanced Search (2) with highres_celltype Equals HSC AND kompot_da_Young_to_Old_lfc_zscore Greater Than 2; 290 of 8,090 entries.
    :width: 80%

    The table with its controls open (column chooser at the top) and the two conditions.
    ```

25. Click "Split Horizontally" on the table and add a **Cell Plot**: UMAP axes, **Color**
    `obs` · `kompot_da_Young_to_Old_lfc_zscore`, **Map** `RdBu`, **Center at 0**.
26. In the plot's controls set **Table** to the table (it is listed by its title).
    Cells the filter removes turn grey; the eye button beside it ("Toggle between coloring
    non-table entries in gray or completely removing them") hides them instead.

```{figure} ../_static/screens/paper/fig2-c-filter.png
:class: screenshot
:alt: Left, the filtered cell table with two conditions. Right, the UMAP with only the HSC cluster coloured red and all other cells grey.
:width: 100%

290 cells "In table" and 7,800 "Not in table" (grey): the 290 of 319 HSCs whose abundance
z-score is above 2, all in the HSC cluster. Edit a condition and the mask follows at once.
```

:::{note}
**Paper, interface, panel c.** This view is panel c of the paper figure.
:::

The search box above the table (top right) narrows the rows further, on top of the conditions.

27. Click **.\*** ("Regular Expression Mode") under the search box, so the search is a regular
    expression, and type `(Mid|Old)`. The footer reads "Showing 1 to 25 of 286 entries": the
    HSCs above z = 2 from Mid and Old mice. The plot follows: 286 cells "In table", 7,804
    grey.

    ```{figure} ../_static/screens/tutorials/we5-regex.png
    :class: screenshot
    :alt: The table's search box holding (Mid|Old) with the regular-expression and smart-search options switched on; rows of Mid HSCs with z-scores near 10; the footer "Showing 1 to 25 of 286 entries (filtered from 8,090 total entries)".
    :width: 70%

    A regular expression in the search box, combined with the two conditions.
    ```

    Keep the parentheses. With smart search on (the wand, the default), `Mid|Old` without them
    matches only 56 rows, the Mid ones, because the search wraps the whole term in a pattern
    that ties `Old` to the start of the row. A plain word works in either mode: `Old` alone finds
    the 230 Old HSCs.
28. Open the table's controls and click **Export CSV**. The file, named after the table title and
    the date, holds the 286 rows that pass, with the columns of the table: `Cell ID`, `Age`,
    `highres_celltype`, `kompot_da_Young_to_Old_lfc_zscore`. Close the controls and click a
    cell ID in the table: that cell becomes the focused cell everywhere.

(tut-tour-save)=
## 8. Save and share the view

**Save Panel Set** stores the panel settings under a name on the server. Every user of the same
server can load it, so a lab can keep a shared library of views ({doc}`../user-guide/panel-sets`).

29. Click **Save Panel Set** in the header, type a name, click **Save**.

    ```{figure} ../_static/screens/paper/fig2-save-panel-set.png
    :class: screenshot
    :alt: Save Panel Set dialog with the name interface-table-filter.
    :width: 60%
    ```

30. To reopen it, click **Load Panel Set**, click its card and click **Load**. Each card shows
    the dataset and one icon per panel; **Export** downloads the set as a JSON file. Loading
    sets the dataset and focus and lists the set's panels closed; click **Open saved layout** in
    the notice to open them all in their layout, or reopen single ones under "Duplicate or
    Reopen Panel". **Load and open layout** on a card does both in one step.

    ```{figure} ../_static/screens/paper/fig2-load-panel-set.png
    :class: screenshot
    :alt: Load Panel Set dialog with five saved panel sets of bm_aging, each with Export and delete buttons, and an Upload file button.
    :width: 60%

    The panel sets on the server used for these screenshots (the paper's five protocol views).
    ```

(tut-tour-load-file)=
(fig2-load-panel-set)=
### Load a panel set file

The tutorials and paper-figure pages offer their views as panel set files. To load one:

1. Click **Load Panel Set**, then **Upload file** (bottom left), **Browse files**, pick the
   file, and click **Load**.

   ```{figure} ../_static/screens/paper/fig2-upload-panel-set.png
   :class: screenshot
   :alt: Load Panel Set dialog in upload mode with overview-focus-model.json selected.
   :width: 60%
   ```

2. The panel set names its dataset by file name (`bm_aging.zarr`), and the server finds it in
   its data directory. That is the dataset already open. Panels are open, so AnnZarro asks
   whether to **Replace** them, **Add to closed panels** or **Cancel**; click **Replace**. A
   notice reads "Panel set was imported and loaded successfully." The panel set replaces the
   open panels:
   same dataset, same focused cell and gene, and every panel of the set listed **closed**, with
   its settings, under "Duplicate or Reopen Panel". The panels that were open before are in the
   same list. Nothing opens by itself, so a large set cannot overload the computer.

   ```{figure} ../_static/screens/paper/fig2-panel-set-loaded.png
   :class: screenshot
   :alt: After loading the panel set file: no panel open, its four panels listed closed under Duplicate or Reopen Panel, and a notice "Loaded" with the button Open saved layout (4 panels); Focused Gene H2-Q7 and Focused Cell HSPC_Old_1#GAAG in the header.
   :width: 100%

   After loading the panel set of section 4: its focus is set, its four panels are listed
   closed, and the notice offers its saved layout.
   ```

3. Click **Open saved layout (4 panels)** in the notice (or, if you closed the notice,
   **Open saved layout (4)** above the closed panels). The four panels open in their saved
   layout, with their settings, exactly as the share link of this view opens them
   ({ref}`tut-tour-share`). To open a single panel instead, click **Closed** (**Reopen** under
   the pointer) on it in the list.

   ```{figure} ../_static/screens/paper/fig2-panel-set-opened.png
   :class: screenshot
   :alt: The four panels of section 4 restored in their 2 x 2 layout, with Focused Gene H2-Q7 and Focused Cell HSPC_Old_1#GAAG.
   :width: 100%

   After **Open saved layout**: its four panels in their layout, with its focus.
   ```

```{important}
A panel set stores what a share link holds (dataset, focus, layout and panel settings), but it
is stored on the server under a name, and loading it opens none of its panels until you click
**Open saved layout** (or reopen single ones). An uploaded file also becomes a saved panel set on
that server, visible to its other users.
```

(tut-tour-share)=
### Share link

31. Click **Share Link**. The link is copied to the clipboard. Where the browser does not allow
    that (a plain `http` address on a cluster node, for example), the link appears in a field
    under the button, already selected; copy it with Ctrl+C or Cmd+C.

    ```{figure} ../_static/screens/paper/fig2-share-link.png
    :class: screenshot
    :alt: Header with the Share Link field open below the buttons, holding a link that starts with the server address and dataset_path.
    :width: 100%
    ```

The link holds the dataset path, the whole layout, every panel's settings and the focus, in the
URL fragment after `#view=` (1,448 characters for the view of section 7, server address and
dataset path included). Anyone who can
reach the same server and dataset path opens exactly this view ({doc}`../user-guide/share-links`,
{doc}`../reference/deep-links`).

(tut-start-links)=
(tut-tour-views)=
## Open the views

Every section with a **Start here** box, here and in the other tutorials, has a share link to its
view, so you can start at any section. The links are written for the server of
{doc}`../getting-started/quickstart`:

```text
http://127.0.0.1:8000/?dataset_path=bm_aging.zarr#view=z1...
└─────────┬─────────┘               └─────┬─────┘      └─┬─┘
1. your server                      2. the store       3. the view
```

- **1. Your server address.** Replace `http://127.0.0.1:8000` with the address you open AnnZarro
  at (another port, a remote host, an SSH tunnel's local port).
- **2. The store.** `dataset_path=bm_aging.zarr` (or `bm_aging_showcase.zarr`) is a file name: the
  server looks for it in its data directory (`--data-dir`, default `~/annzarro-data`). If the
  store is there, leave it. If it is elsewhere, replace the name with the store's absolute path;
  only a local single-user server opens paths outside the data directory
  ({doc}`../deployment/authentication`).
- **3. The view**: everything after `#view=` (layout, panels, focus). Copy it unchanged.

The same panels as a file: download the box's panel set file and load it with **Load Panel Set** >
**Upload file** ({ref}`tut-tour-load-file`), then click **Open saved layout** in the notice;
the link opens the layout directly. The file names its store by
file name too, and does not depend on the server address.

The views of this tour:

::::{dropdown} Sections 4 and 5: the four slices of the focus model
```{literalinclude} ../_static/panelsets/paper/overview-focus-model.url.txt
:language: text
```
::::

::::{dropdown} Section 3: walk and cell types (four clicks)
```{literalinclude} ../_static/panelsets/paper/interface-focus-sequence.url.txt
:language: text
```
::::

::::{dropdown} Section 6: four linked panels
```{literalinclude} ../_static/panelsets/paper/interface-overview.url.txt
:language: text
```
::::

::::{dropdown} Section 7: two-condition filter masking a UMAP
```{literalinclude} ../_static/panelsets/paper/interface-table-filter.url.txt
:language: text
```
::::

The same panels as panel set files ({ref}`tut-tour-load-file`):
{download}`overview-focus-model.json <../_static/panelsets/paper/overview-focus-model.json>`,
{download}`interface-focus-sequence.json <../_static/panelsets/paper/interface-focus-sequence.json>`,
{download}`interface-overview.json <../_static/panelsets/paper/interface-overview.json>`,
{download}`interface-table-filter.json <../_static/panelsets/paper/interface-table-filter.json>`.

## What you learned

- The focused cell picks rows (obsp, a layer's cell row); the focused gene picks columns and rows
  (a layer's gene column, varp). Any panel can be coloured by any of them.
- A click on a point moves the focus; every panel that follows it reads one new slice.
- A lock pins a panel to its current cell or gene, so two states can be compared.
- A table filter combines conditions with AND or OR and masks linked plots without new reads.
- A share link opens the dataset, focus, layout and panels; a panel set, stored on the server
  under a name, restores the dataset and focus and lists its panels closed, and **Open saved
  layout** opens them in their layout.

Next: {doc}`cell-similarity` asks how similar cells really are, reading a kernel or distance row
instead of trusting the UMAP.

Screenshots and views are made by `docs/_tools/shoot_figs13.py`, which follows the paper's
`figures/screenshots.py`.
