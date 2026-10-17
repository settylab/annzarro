# Interface

AnnZarro has one window: a header with the two focus pickers and the panel set buttons, a dataset
bar with the dataset and its size, and below it a canvas of tiles. Each tile holds one panel (a cell plot, gene plot, cell table or
gene table). You add tiles, split them side by side or stacked, resize them by dragging, and
close them. This page walks through every control on that screen with `bm_aging_annzarro.zarr`
({doc}`../data/demo-data`).

## The header

```{figure} ../_static/screens/user-guide/ui-header.png
:class: screenshot
:alt: The AnnZarro header and dataset bar with nine numbered controls: dataset button, refresh, gene history arrows, focused gene picker, cell history arrows, focused cell picker, Save Panel Set, Load Panel Set, Share Link.

The header and the dataset bar under it. Numbers match the list below.
```

1. **The dataset button**, at the left of the dataset bar, names the open dataset (its path relative
   to the data directory, cut in the middle when it is long; the whole path is its tooltip) and opens
   the dataset browser ({ref}`dataset-browser`). The same happens with **Ctrl+O** (**Cmd+O** on a Mac),
   wherever the focus is. With no dataset open it reads "Open a dataset...". While one loads it reads
   "Opening ...". A view whose dataset is not on this server shows "No data: *name*" with **Choose...**,
   and a dataset that turned unreadable (a revoked grant, a removed store) "Not available: *name*",
   both in warning colours; the button then opens the browser to choose a dataset for the view.
   The bar goes on with the open dataset's cells (and the subset badge), genes and format
   (`zarr v2`, `zarr v3`, `zarr v3 sharded` or `h5ad`). The browser tab (and the desktop window) is
   titled with the open dataset's name, `bm_aging_annzarro.zarr · AnnZarro`.
2. **Refresh dataset**, the icon beside the button, reopens the current dataset. The server first
   re-checks the store against the disk and, if any file changed (an in-place write of values
   included), serves the change from then on, to every user; the panels then read the dataset
   again, past this browser's copies. On your own machine, and for admins of a hosted server, it
   also clears the server's cache for that dataset. Use it after the store on disk changed.
   A store with too many files to check within the server's 3 s budget cannot be fully checked: the
   app then says so ("Refresh may not show every change"), because a write that only overwrote
   data chunks may not show for a user other than an admin. An admin's Refresh dataset (or a server
   restart) picks it up, and says so when it did. A panel's **Refresh** gives the same notice. (In
   the browser, **Ctrl+R** reloads the page as usual; the desktop app binds it to Refresh dataset.)
3. **Previous gene / Next gene** step through the genes you focused in this session.
4. **Focused Gene** is the gene every gene-dependent panel follows ({doc}`focus-and-lock`).
5. **Previous cell / Next cell** step through the cells you focused.
6. **Focused Cell** is the cell every cell-dependent panel follows.
7. **Save Panel Set** stores the current panels on the server ({doc}`panel-sets`).
8. **Load Panel Set** opens the list of stored panel sets.
9. **Share Link** copies a URL that reopens this dataset, layout and focus ({doc}`share-links`).

The **System / Light / Dark** buttons at the right end of the dataset bar set the colour
theme ({ref}`colour-theme`).

A **Close all** button sits between Load Panel Set and Share Link (not numbered in the picture): it closes every open panel and can also clear the browser's stored data ({ref}`close all panels <close-all-panels>`).

**Which version is this?** Hold the pointer over the app name at the top left: the tooltip reads
"AnnZarro 0.5.5" (the version the server runs; a custom app name comes first, as "Lab Atlas ·
AnnZarro 0.5.5"). On a server with login, the tooltip of your user name under the app name ends with the
same line. Say this version in a bug report. The desktop app shows its own, bundled version the
same way.

**About AnnZarro.** Click the app name at the top left (or focus it and press Enter) to open a
small dialog with the version, links to the documentation, the repository and the changelog, how
to cite AnnZarro (the paper and the software's DOI), who develops it (the Setty Lab at Fred
Hutch Cancer Center), and the funding statement. Escape or the close button closes it and puts focus back on the name.

(colour-theme)=
## Light and dark theme

AnnZarro follows your system's light or dark setting. Switch the system setting while the page is
open and the app, plots included, switches with it. The three buttons at the right end of the dataset bar override this for this browser: **System** follows the system, **Light** and
**Dark** stay as chosen. The choice is remembered in the browser (not on the server, and not in
panel sets or share links) and applies to the login page and the admin pages too. The desktop app
follows the operating system the same way.

```{figure} ../_static/screens/user-guide/ui-dark-theme.png
:class: screenshot
:alt: The AnnZarro window in the dark theme: a dark header and panels, a cell plot coloured by cell type and a gene plot, both on a dark plot background with light axis text.

The dark theme. Plot colours (data colours) are the same as in the light theme.
```

Plots follow the theme for every colour you have not set yourself ({ref}`plot colours
<plot-colours-theme>`). Colours that show your data (palettes and colour scales) are never changed
by the theme; a very dark end of a colour scale, such as black in **Greys** or **Hot**, is hard to
see on a dark plot, so pick another map there. A figure for a paper is usually exported in the
Light theme, or with the **Publication** preset, which keeps its white background in either theme
({doc}`export`).

In the dataset bar, after the dataset button and Refresh, come the number of cells (8,090) with a
badge, **All cells**, the number of genes (16,285) and the format. Datasets with more than
200,000 cells open on a reproducible subset of 100,000 cells; the badge then reads **Subset ·
seed 0** ({doc}`subsets`).

(dataset-browser)=
## Choose a dataset

The dataset button, **Ctrl+O** (**Cmd+O**), and the **Browse datasets...** button of the welcome
screen all open the same dialog, the dataset browser. It is also what opens to choose a dataset for a
view that has none ({doc}`reproducing`) or for a panel set ({doc}`panel-sets`); its title and a banner
at the top say which.

```{figure} ../_static/screens/user-guide/ui-dataset-browser.png
:class: screenshot
:alt: The dataset browser: a search field (1), the places Recent, Pinned and Data directory (2), the path of the folder shown (3), a table of datasets with sortable column headers (4) and, on the right, the selected dataset's cells, genes, format, obs and obsm keys and the result of the store check (5).

The dataset browser with a dataset selected. Numbers match the list below.
```

1. **Search** finds datasets by name or path as you type (the **.\*** button switches to a regular
   expression, as in the gene picker). It searches the folder shown and everything below it; on
   **Recent** or **Pinned** it searches the data directory as well. Typing a path or a URL offers
   **Open** *path* as the first row. **Enter** opens the first dataset found. The filters beside
   it narrow the rows by format (h5ad, zarr v2, zarr v3, sharded), by number of cells and by
   modification date, hide the datasets that cannot be opened (the button says how many there are),
   and, when a view is open or being given a dataset, keep only the datasets that match it.
2. **Places.** **Recent** lists what you opened, newest first, including datasets in subfolders
   and remote stores; one that has since been removed, or is no longer shared with you, stays in
   the list, greyed. **Pinned** lists the datasets you pinned. **Data directory** is the folder the
   server shares; a hosted server's administrators can add more data directories, each a place of
   its own. **Remote** lists the remote stores you opened, where the server opens them
   ({doc}`remote-datasets`). Recent and pinned datasets are kept in your browser, separately for
   each server and each user.
3. **The path above the table** is the folder shown, each part a link back. Click the empty part
   of it, or press **Ctrl+L** (**Cmd+L**), to type instead: a path to a dataset opens it, a path to
   a folder shows it, a URL opens a remote store, and what the server refuses is said under the
   field, with your text kept. What it accepts depends on you: a path in the data directory (on
   your own machine, any path), and a store URL only where remote stores are enabled.
4. **The table** lists folders first, then datasets, with their cells, genes, format, the date they
   were modified and, for those you opened, when. Click a column header to sort; click it again
   to reverse. The server sorts by name and by modification date before it pages, so a folder of
   thousands of datasets sorts as a whole; the other columns sort the rows loaded so far, and the
   table says so ("Sorted among 500 loaded"). It shows 200 rows at a time and **Show more** adds more.
   A dataset that cannot be opened is listed last with the reason; it is selected by a click and never opened.
   A **same cells and genes** tag marks the datasets that match the view you are choosing for.
   **Click the name** of a dataset to open it (of a folder, to enter it). A click elsewhere in the
   row selects it and fills the details pane. **Enter** and a double click open it.
5. **The details pane** (in a window wider than 1100 px; below that, the (i) button of a row opens it
   as a sheet) shows the selected dataset's path, cells, genes, format, modification date, file size
   for an `.h5ad`, where a link leads, and its obs and var columns, obsm keys and layers, read from
   the store's metadata alone, never its data. For a local zarr store it then runs the store check
   ({doc}`../data/chunking`) within a time budget (`server.dataset_details_check_budget_s`, 1.5 s by
   default) and says in one line what it found; for a remote store a **Check chunking** button runs
   it. **Open** opens the dataset, **Pin** keeps it under Pinned, **Copy path** copies its path.
   When panels are open, the pane also names the keys they use that the selected dataset lacks
   ("cell_type: missing"), so that the switch holds no surprise.

Switching datasets does not ask: the open panels stay and read from the new dataset, and a back button
beside the dataset name ("Back to *old name*") returns to the dataset you left. It stays until the next
switch, and going back is itself a switch, so the button then offers the dataset you just left.

When you can see only some datasets (an administrator restricted your account), the places are **Your
datasets** and each folder you were given, no path above one is ever shown, and a link or panel
set that names a dataset you cannot read is opened without data with the sentence that is true
whether it is missing or just not yours. If the site names a contact (`branding.admin_contact`,
{doc}`../reference/configuration`), the banner adds "Ask *contact* for access."

### Keyboard

The browser is made for the keyboard. **Ctrl+O** (**Cmd+O**) opens it with the cursor in the search
field, so typing a few letters and pressing **Enter** opens a dataset. **Down** moves into the table, which is one tab stop: **Up**,
**Down**, **Home**, **End**, **Page Up** and **Page Down** move between rows, **Enter** opens, **Right**
enters a folder, **Left** or **Backspace** goes up one, typing letters jumps to the name that starts with
them, **/** returns to the search field, and **Escape** closes the dialog and puts the focus back on
the dataset button. Rows and column headers are those of an ordinary table, so a screen reader reads
a row as "short.zarr, 200 cells, 20 genes, zarr v2, modified ..."; counts and the progress of an
opening are announced politely.

| Keys | Action |
|---|---|
| **Ctrl+O** (**Cmd+O**) | Open the dataset browser |
| **Ctrl+Shift+L** (**Cmd+Shift+L**) | Load Panel Set |
| **Ctrl+L** (**Cmd+L**), in the browser | Type a path or URL |
| **F1** | List the keyboard shortcuts |

In the desktop app **Open file or folder...** (also **Ctrl+Shift+O**, **Cmd+Shift+O**) in the browser
and on the welcome screen opens your system's dialog and takes a `.zarr` folder or an `.h5ad` file
from anywhere on disk (on Windows and Linux, whose dialogs take one kind at a time, as two buttons,
**Open .h5ad File...** and **Open .zarr Folder...**) ({doc}`../getting-started/desktop-app`).

## Pick a gene or a cell by name

1. Click the **Focused Gene** box and type part of a name, for example `H2-`. A list of matching
   genes opens under the box; the line above it says how many matched (here 22). The server
   searches all gene names as you type and sends back at most 100 matches, exact matches first,
   then names that start with the text, then names that contain it, ignoring case. With more
   matches the list says "First 100 matches, keep typing to narrow".
2. Click a gene, or move to it with the arrow keys and press **Enter**. **Escape** closes the list
   and keeps the current gene.

```{figure} ../_static/screens/user-guide/ui-gene-picker.png
:class: screenshot
:width: 45%
:alt: The focused gene picker with "H2-" typed and a list of 22 matching genes, H2-K1 highlighted, with the regular-expression button (1) and the match count (2) above the list.

The gene picker after typing `H2-`: the regular-expression button (1) and the match count (2).
```

The **.\*** button (1) above the list switches to a case-insensitive regular expression, for
example `^H2-(Aa|Ab1)$`. The **Focused Cell** picker works the same way on cell names; with a
{doc}`cell subset <subsets>` it lists the subset's cells first and then the dataset's others,
marked **not shown**. Because the list is fetched from the server, the pickers stay fast with
millions of names; while a search is still running the line under the box says "searching…" (or
"Building the name index…" for the first search of a very large dataset), never "No cell matches".

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
   away. It also lists every open and closed panel under **Duplicate or Reopen Panel**. Once
   tiles fill the window, this area has no room left; new panels then go into a split
   (below).

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
3. **Split side by side** puts a new, empty pane to the right of this tile.
4. **Split top and bottom** puts a new, empty pane below this tile.
5. **Close** removes the tile. Its settings are kept under **Duplicate or Reopen Panel**.


## Split and resize

1. In the tile header, click **Split side by side**. The tile shrinks to the left half and the
   right half shows **Add New Panel** with the same cards.

   ```{figure} ../_static/screens/user-guide/ui-split-selector.png
   :class: screenshot
   :alt: The cell plot on the left half; the right half shows "Add New Panel" with Cell Plot, Gene Plot, Cell Table and Gene Table cards, and a Duplicate or Reopen Panel section.

   After Split side by side: the new pane waits for a panel type.
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

Plots fill their tile and resize with it (a plot is at least 260 px tall; a smaller tile
scrolls). The pane sizes are stored as percentages in panel layouts and share
links, so a shared layout opens with the same proportions on any screen.

## Loading, and stopping a load

While a panel reads its data or builds its plot, a small box at the top left of the plot says
"Loading axis data…". A table shows a spinner, or the same box when it keeps its rows while it
loads other cells. A load that takes longer than about a second and a half adds a **Cancel**
button to the box (a quick load never flashes it).

**Cancel** stops that panel's requests and the work on them, and leaves only that panel changed:
other panels go on loading.

- A panel that already showed a plot keeps it, with a tag **Loading cancelled** at the right of
  its status line. The plot may not match the controls (you had changed the colour, say). Click
  the tag and press **Load**, or press **Refresh**, to read the data again.
- A panel with nothing shown yet, and a table whose rows were replaced by the spinner, shows
  "Loading cancelled" with a **Load** button.
- A gene set analysis section has its own **Cancel**; it returns to what it showed before.

Changing what a panel shows stops the load it is running without a click: another x, y, z or
colour, a new subset or part, another dataset, the cell or gene it follows, or closing the panel.
The old requests are cancelled, and a late reply never replaces the newer view. A request that
another panel also needs keeps running for that panel.

Two limits. The server finishes a read it has started (a request already being served is not
interrupted; it stops sending when the browser has gone), so Cancel frees the browser and the
connection at once and the server shortly after. And once a plot is handed to the drawing
library (the last step, after the data is downloaded and arranged), the draw runs to its end:
**Cancel** acts on the downloads and decoding before it, which are the long part of a very large
plot.

## Close, reopen and duplicate panels

1. Click **Close** on a tile. The neighbouring tile takes over its space.
2. To bring it back, split any tile (**Split side by side** or **Split top and bottom**). The new
   pane lists the closed panel under **Duplicate or Reopen Panel** with a **Closed** badge; open
   panels are listed there too, without a badge. (When the last tile is closed, the Welcome tile
   shows the same list.)

   ```{figure} ../_static/screens/user-guide/ui-reopen.png
   :class: screenshot
   :alt: The "Duplicate or Reopen Panel" section of a new pane, listing "Cell Plot 1" and "Gene Plot 1", the latter marked Closed, with a "Clear closed panels" button.

   Gene Plot 1 was closed; Cell Plot 1 is open.
   ```

3. Hover over the **Closed** badge; it changes to **Reopen**. Click it to bring the panel back
   with all its settings, in that pane.
4. Click anywhere else on a card to open a **copy** of that panel (a duplicate with a new
   title). This works for open and closed panels.
5. The small **×** on a closed card forgets that panel. **Clear closed panels** forgets all
   closed panels: the first press turns the button into "Delete all N closed panels?", the second
   (within a few seconds) deletes them.

## The browser remembers your last layout

AnnZarro autosaves the view (dataset, focus, layout and every panel's settings) to the browser's
local storage every 10 seconds and when the page is closed. On your next visit to the same server
it reopens that view as it was. This copy lives only in
your browser. To keep a layout or give it to someone else, use {doc}`panel-sets` or
{doc}`share-links`. Opening a share link always wins over the autosaved layout. The interval
and the restore behaviour are set under `ui.autosave` in the configuration
({doc}`../reference/configuration`).

```{admonition} What happens on the server
:class: note
Opening a dataset costs a handful of small requests: the dataset structure (which keys exist in
obs, obsm, obsp, layers, var, varm, varp and uns) and the cell and gene names. No matrix values are read until a panel asks for a vector. Splitting, resizing, closing
and reopening tiles are handled in the browser and send nothing to the server; a reopened panel
reads its data again, usually from the browser's cache.
```
