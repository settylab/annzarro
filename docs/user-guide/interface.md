# Interface

AnnZarro has one window: a header with the dataset and the two focus pickers, a statistics bar,
and below it a canvas of tiles. Each tile holds one panel (a cell plot, gene plot, cell table or
gene table). You add tiles, split them side by side or stacked, resize them by dragging, and
close them. This page walks through every control on that screen with `bm_aging.zarr`
({doc}`../data/demo-data`).

## The header

```{figure} ../_static/screens/user-guide/ui-header.png
:class: screenshot
:alt: The AnnZarro header with nine numbered controls: dataset picker, refresh, gene history arrows, focused gene picker, cell history arrows, focused cell picker, Save Panel Set, Load Panel Set, Share Link.

The header. Numbers match the list below.
```

1. **Dataset** lists every dataset the server found at the top level of its data directory
   (`~/annzarro-data` unless set with `--data-dir`) and in that directory's `datasets` folder. You can also type a
   path or a remote URL into its search field and press Enter ({doc}`remote-datasets`).
2. **Refresh dataset** clears the server's and the browser's caches for the current dataset,
   reloads the dataset list and reopens the dataset. Use it after the store on disk changed.
3. **Previous gene / Next gene** step through the genes you focused in this session.
4. **Focused Gene** is the gene every gene-dependent panel follows ({doc}`focus-and-lock`).
5. **Previous cell / Next cell** step through the cells you focused.
6. **Focused Cell** is the cell every cell-dependent panel follows.
7. **Save Panel Set** stores the current panels on the server ({doc}`panel-sets`).
8. **Load Panel Set** opens the list of stored panel sets.
9. **Share Link** copies a URL that reopens this dataset, layout and focus ({doc}`share-links`).

Below the header, the statistics bar shows the number of cells (8090) and genes (16285) and the
dataset's display name.

## Pick a gene or a cell by name

1. Click the **Focused Gene** box. A search field opens with the genes in alphabetical order.
2. Type part of a name, for example `H2-`. The list narrows to matching genes.
3. Click a gene, or move to it with the arrow keys and press **Ctrl+Enter** to select it and
   close the list. A plain click selects the gene and leaves the list open, so you can step
   through several genes; press **Escape** to close it.

```{figure} ../_static/screens/user-guide/ui-gene-picker.png
:class: screenshot
:width: 60%
:alt: The focused gene picker open, with "H2-" typed and the matching genes H2-Aa, H2-Ab1, H2-D1 and so on listed below a "Regex Mode" button.

The gene picker after typing `H2-`.
```

The **Regex Mode** button under the search field switches the filter from substring matching
to a case-insensitive regular expression (it turns blue when on), for example `^H2-(Aa|Ab1)$`.
The mode switches off again each time the list is reopened. The **Focused Cell** picker works the
same way on cell names.

Every focus change, whether from a picker, a plot click or a table click, is added to the
history behind the arrow buttons. Going back and then choosing a new item discards the forward
part of the history, as in a web browser.

## Add the first panel

When a dataset is open and no panel exists, the canvas shows the Welcome tile.

```{figure} ../_static/screens/user-guide/ui-welcome.png
:class: screenshot
:alt: The Welcome tile with "Create New Panel" cards for Cell Plot, Gene Plot, Cell Table and Gene Table, and a "Load Saved Panel Set" section below.

The Welcome tile.
```

1. Under **Create New Panel**, click **Cell Plot**. The tile becomes a cell plot of
   `obsm/X_umap` columns 0 and 1, coloured by `obs/leiden` (the defaults are explained in
   {doc}`cell-and-gene-plots`).
2. Below the new tile, the same set of cards appears again, so the next panel is always one click
   away. It also lists every open and closed panel under **Duplicate or Reopen Panel**.

```{figure} ../_static/screens/user-guide/ui-first-cell-plot.png
:class: screenshot
:alt: A full-width cell plot titled "Cell Plot 1" with its controls open above a UMAP coloured by leiden cluster.

The first cell plot, with its controls open.
```

## Tile controls

```{figure} ../_static/screens/user-guide/ui-tile-header.png
:class: screenshot
:alt: A tile header with five numbered parts: the editable title, the toggle-controls chevron, split horizontally, split vertically and close.

A tile header.
```

1. **Title.** Click it and type to rename the panel. The title is saved with the panel and
   shown in panel sets.
2. **Toggle Controls** (chevron) shows or hides the panel's controls. Hide them to give the plot
   the whole tile; your settings are kept.
3. **Split Horizontally** puts a new, empty pane to the right of this tile.
4. **Split Vertically** puts a new, empty pane below this tile.
5. **Close** removes the tile. Its settings are kept under **Duplicate or Reopen Panel**.

```{note}
The Split Vertically icon is the Split Horizontally icon turned by 90 degrees; at small sizes it
looks like a floppy-disk "save" icon. It does not save anything.
```

## Split and resize

1. In the tile header, click **Split Horizontally**. The tile shrinks to the left half and the
   right half shows **Add New Panel** with the same cards.

   ```{figure} ../_static/screens/user-guide/ui-split-selector.png
   :class: screenshot
   :alt: The cell plot on the left half; the right half shows "Add New Panel" with Cell Plot, Gene Plot, Cell Table and Gene Table cards, and a Duplicate or Reopen Panel section.

   After Split Horizontally: the new pane waits for a panel type.
   ```

2. In the right pane, click **Gene Plot**. A gene plot opens there: genes at `varm/PCs`
   columns 0, 1 and 2 in 3D, coloured by `var/highly_variable`.

   ```{figure} ../_static/screens/user-guide/ui-two-panels.png
   :class: screenshot
   :alt: Two tiles side by side, a cell UMAP coloured by leiden on the left and a 3D gene plot of varm PCs coloured by highly_variable on the right.

   A cell plot and a gene plot side by side, controls hidden.
   ```

3. Drag the thin bar between the two tiles (the split handle) left or right to change their
   widths. A vertical split has a horizontal bar that you drag up or down. Splits nest: split
   either tile again to build a grid.

   ```{figure} ../_static/screens/user-guide/ui-split-handle.png
   :class: screenshot
   :width: 45%
   :alt: Close-up of the boundary between two tiles with the split handle outlined.

   The split handle (1) between two tiles.
   ```

Plots resize with their tile. The pane sizes are stored as percentages in panel layouts and share
links, so a shared layout opens with the same proportions on any screen.

## Close, reopen and duplicate panels

1. Click **Close** on a tile. The neighbouring tile takes over its space.
2. Scroll to the bottom of the canvas. The closed panel is listed under **Duplicate or Reopen
   Panel** with a **Closed** badge; open panels are listed there too, without a badge.

   ```{figure} ../_static/screens/user-guide/ui-reopen.png
   :class: screenshot
   :alt: The bottom of the canvas with "Create New Panel" cards and a "Duplicate or Reopen Panel" section listing "Cell Plot 1" and "Gene Plot 1", the latter marked Closed.

   Gene Plot 1 was closed; Cell Plot 1 is open.
   ```

3. Hover over the **Closed** badge; it changes to **Reopen**. Click it to bring the panel back
   with all its settings.
4. Click anywhere else on a card to open a **copy** of that panel (a duplicate with a new
   title). This works for open and closed panels.
5. The small **×** on a closed card forgets that panel. **Clear closed panels** forgets all
   closed panels after a confirmation.

## The browser remembers your last layout

AnnZarro autosaves the open panels to the browser's local storage every 10 seconds (and when the
page is closed). On your next visit to the same server it opens the dataset again and lists those
panels under **Duplicate or Reopen Panel**, ready to reopen. This copy lives only in
your browser. To keep a layout or give it to someone else, use {doc}`panel-sets` or
{doc}`share-links`. Opening a share link always wins over the autosaved layout. The interval
and the restore behaviour are set under `ui.autosave` in the configuration
({doc}`../reference/configuration`).

```{admonition} What happens on the server
:class: note
Opening a dataset costs a handful of small requests: the dataset structure (which keys exist in
obs, obsm, obsp, layers, var, varm, varp and uns), the list of cell names and the list of gene
names. No matrix values are read until a panel asks for a vector. Splitting, resizing, closing
and reopening tiles are handled in the browser and send nothing to the server; a reopened panel
reads its data again, usually from the browser's cache.
```
