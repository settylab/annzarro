# Quickstart

This page starts a local server, opens the demonstration store and draws a first plot. It
takes about two minutes once AnnZarro is installed ({doc}`installation`) and you have a store.
The demonstration store `bm_aging_annzarro.zarr` (murine bone marrow, Young vs Old, 8,090 cells x
16,285 genes, 5.7 GB zipped, 5.3 GiB unzipped) is on Zenodo,
[doi:10.5281/zenodo.23277102](https://doi.org/10.5281/zenodo.23277102); {doc}`../data/demo-data`
describes it. Any AnnData written with `adata.write_zarr(...)` works the same way.

## 1. Put the store in a data directory

AnnZarro lists the datasets found in one directory, its *data directory*. Download the
demonstration store into one and unzip it there:

```bash
mkdir -p ~/annzarro-data && cd ~/annzarro-data
curl -LO https://zenodo.org/records/23277103/files/bm_aging_annzarro.zarr.zip
curl -LO https://zenodo.org/records/23277103/files/SHA256SUMS
grep bm_aging_annzarro.zarr.zip SHA256SUMS | shasum -a 256 -c -     # macOS; on Linux: sha256sum -c -
unzip -q bm_aging_annzarro.zarr.zip                                # makes bm_aging_annzarro.zarr/
```

The check should print `bm_aging_annzarro.zarr.zip: OK`. The zip is no longer needed after
unzipping. To use a store you already have, link it into the data directory instead:
`ln -s /path/to/store.zarr ~/annzarro-data/`.

The dataset browser lists `.zarr` directories and `.h5ad` files at the top level of the data directory
and in its `datasets` subdirectory, if there is one. Panel sets you save are written to
`~/annzarro-data/sessions/`.

## 2. Start the server

```bash
annzarro start --data-dir ~/annzarro-data
```

The server listens on `127.0.0.1:8000` and opens `http://127.0.0.1:8000` in your browser. On
a machine without a display, add `--no-browser` and open the address yourself. Without
`--data-dir`, the data directory is `~/annzarro-data`, created if it does not exist, so
`annzarro start` alone works for the layout above. Stop the server with Ctrl+C.

Bound to `127.0.0.1`, the server is reachable only from this machine and needs no login. To
use a server on another machine, see {doc}`../deployment/personal-server`.

## 3. Open the dataset

The server opens a dataset by itself only when it is the only one in the data directory (the
desktop app also reopens the one opened last time); with several it opens none, and the main area
shows the Welcome tile with **Open a dataset** on top. Once a dataset is open, the address bar
names it (`?dataset_path=...`), so a reload opens it again.

```{figure} ../_static/screens/getting-started/welcome-browser.png
:class: screenshot
:alt: The AnnZarro Welcome tile with the dataset browser open, listing the stores of the data directory

The Welcome tile with the dataset browser open (the dataset button at the left of the bar under the
header, or **Ctrl+O**, opens it). It lists every store in the data directory, with its cells, genes and
format. "Create New Panel" starts an empty panel; "Load Saved Panel Set" lists the panel sets saved on
this server (here the five protocol views of the demonstration data).
```

1. Click the dataset button at the left of the bar under the header (it reads "Open a dataset...") and
   click the name `bm_aging_annzarro.zarr`. The bar then shows its size (for the demonstration store,
   "Cells: 8,090" and "Genes: 16,285"). To open a store
   outside the data directory on your own machine, press **Ctrl+L** in the browser and type its full
   path; a remote URL such as `s3://bucket/atlas.zarr` is entered the same way
   ({doc}`../user-guide/remote-datasets`).
2. Check the **Focused Gene** and **Focused Cell** boxes in the header. They start at the
   first gene and a cell of the dataset; every panel follows them
   ({doc}`../user-guide/focus-and-lock`).

## 4. Draw a first plot

1. In the Welcome tile, under "Create New Panel", click **Cell Plot**.
2. The tile becomes "Cell Plot 1": a scatter plot of all cells on the first two UMAP
   coordinates (X `obsm` / `X_umap` / `0`, Y `obsm` / `X_umap` / `1`), coloured
   by the `obs` column `leiden`. The focused cell is drawn as a larger
   point with a dark outline ("Highlight Focused Cell" is on).

```{figure} ../_static/screens/getting-started/first-plot.png
:class: screenshot
:alt: A cell plot of the demonstration data coloured by leiden cluster

The first Cell Plot on `bm_aging_annzarro.zarr`, with its controls open.
```

3. Change the colour: in the **Color** row, set the first box to `layer` and the second to
   `kompot_de_Young_to_Old_fold_change`. The third box shows the focused gene. Each cell is now
   coloured by that gene's Young to Old fold change, with a colour bar titled
   `layer.kompot_de_Young_to_Old_fold_change.<gene>`.
4. Click any cell in the plot. It becomes the focused cell, and every panel that depends on it
   updates.
5. Collapse the controls with **Toggle Controls** (the arrow at the top right of the tile) to
   give the plot the full tile.

**Split Horizontally** and **Split Vertically** (the two icons next to the arrow) add a second
panel beside or below this one, for
example a **Gene Plot** of the differential expression results. The {doc}`../user-guide/index`
explains every panel, and the {doc}`../paper/index` pages rebuild each paper figure step by
step.

## 5. Keep the view

- **Save Panel Set** stores the layout under a name on the server; anyone using the same server
  can load it from "Load Saved Panel Set": **Load** opens its dataset, focus and
  panels in their saved layout ({doc}`../user-guide/panel-sets`).
- **Share Link** copies a URL that reopens this dataset with the same layout and focus
  ({doc}`../user-guide/share-links`).

## Next

- {doc}`../data/preparing-a-store` to turn your own AnnData into a responsive store.
- {doc}`../deployment/modes` to choose between the desktop app, a personal server on a cluster
  and a shared lab server.
