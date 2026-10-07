# Reproducing a view and its figures

A {doc}`share link <share-links>` or a {doc}`panel set <panel-sets>` file is a recipe for a view,
and every exported plot carries the same recipe inside it. The rule is simple:

**The same store and the same AnnZarro version give the same view and the same figure**, on any
server, in the desktop app, today or in five years. Another version of AnnZarro opens the view
too, but may draw it differently, and says so.

This page says what carries over between deployments, what does not, and how to make a figure
again from the command line.

## What a saved view records

Since v0.4.1 a link and a panel set record, next to the layout and every panel's settings:

- **The store by its name in the data directory**, for example `bm_aging.zarr` or
  `datasets/bm_aging.zarr`, whenever the store is inside the server's data directory. Any server
  whose data directory holds the store under that name opens the view, wherever that directory
  is. The absolute path the store had where the view was saved is kept as a last hint. A store
  outside the data directory (the desktop app, an administrator's arbitrary path) is recorded by
  its absolute path.
- **The store's fingerprint**, in two parts. The first says which cells and genes the store has:
  their counts and a digest of every cell name and every gene name. The second says which fields
  it has: a digest of its metadata, per group (obs, var, obsm, layers and so on), and the names
  of the fields. The data matrices are never read for it.
- **The AnnZarro version** that saved it.

## Opening a view on another deployment

When a link or panel set is opened, AnnZarro finds its store in this order:

1. the path the view names, a name relative to the data directory first;
2. a store in the data directory with the same cells and genes (same fingerprint), even under
   another name or in a subdirectory. If there are several, the one with the saved name wins.
   A view saved before v0.4.1 has no fingerprint; it opens on the one store with the same file
   name, as such views always did;
3. the absolute path the view was saved with, if this server may open it.

AnnZarro then compares the fingerprints:

| The store here | What happens |
|---|---|
| the same store | the view opens; nothing is said |
| found under another path (step 2 or 3) | the view opens, with a notice: "Opened on another path", naming both |
| the same cells and genes, other fields (a column added or removed, say) | the view opens, with a notice naming the fields, e.g. "fields differ: obs/leiden is not in this store" |
| other cells or genes | a warning, "This store differs from the one the view was saved on", with the cell and gene counts of both. The layout is shown without data until you choose **Open anyway**, **Change dataset** or **Keep without data** |
| not found at all | the layout opens **without data**: every panel shows "no data" and keeps all its settings. A notice names the missing path and offers **Change dataset** |
| saved with another AnnZarro version | the view opens, with a notice: "Saved with AnnZarro 0.4.1; this is 0.5.0. The view may look different." |

A store with many cells is fingerprinted in the background the first time it is opened (about
9.4 s for the 95.6 million cell names of Tahoe-100M on a laptop, then remembered across restarts),
so nothing waits for it. Until then a view is checked by its counts and fields, and the cell and
gene names are checked when they are ready.

### Change dataset

**Change dataset** (in the notice, on every "no data" panel, and in the header while a view has
no data) lists the stores of the data directory: those with the same cells and genes first, then
those of the same size, then a store with the saved name, then the rest. You can also type a path;
a shared server opens it only inside its data directory ({doc}`../deployment/hosting-checklist`). The view then opens on the chosen
store. On a store with other cells or genes the warning above comes first.

Choosing the **dataset menu** in the header while a view has no data does the same.

### Fields the store does not have

A panel whose settings name something the store lacks (an obs or var column, a layer, an obsm
key, a gene or a cell) keeps that setting and says "not in this dataset": in the menu that picks it, and in a notice
when the panel is drawn. Nothing else fails. Switch back to a store
that has it and the panel shows it again, as saved.

## What does not carry over

- **Another store.** A view is a recipe, not data. On a store with other cells, other genes or
  other values, the same settings draw other plots; the fingerprint is there so that you are told.
  A store edited in place without any file moving its timestamp keeps its old fingerprint until it
  is refreshed (**Refresh dataset**).
- **Another AnnZarro version.** Defaults, automatic point sizes, colour handling and the drawing
  library change between versions. A view saved with one version opens in later ones (a corpus of
  v0.4.0 links and panel sets is opened by every test run), but only the same version promises the
  same picture.
- **Another browser or screen, for what is on screen.** The plots on screen and the "As shown"
  export depend on the tile size, the screen's pixel ratio, the graphics card and the fonts of
  the browser. The full-size export (the **Export** buttons and `annzarro export`) depends on the
  panel's export width, height and scale, not on the window; across computers it can still differ
  in fonts and in how the graphics card draws the points.

## Figures that carry their own recipe

Every PNG and SVG exported from a plot ({doc}`export`) carries the view it was made from: the
panel set (layout, every panel's settings, focus, the store's name and fingerprint), which panel
it shows, its export size, and the AnnZarro version. In a PNG it is a `tEXt` chunk with the
keyword `annzarro-recipe`; in an SVG it is the first `<metadata>` element. It never contains the
server's absolute path or any data. To read it:

```console
$ python -c "from annzarro.export import read_recipe; import json, sys; \
    print(json.dumps(read_recipe(sys.argv[1]), indent=1)[:300])" fig.png
```

## `annzarro export`

`annzarro export` draws a saved view's plots without a browser window, exactly as each plot's
**Export** button would: size and scale from the panel's settings, the coverage notice when not
every point is shown, and the recipe in the file.

```console
$ pip install 'annzarro[export]'
$ python -m playwright install chromium

$ annzarro export my-view.json --store data/bm_aging.zarr --out fig.svg
$ annzarro export 'http://host/?dataset_path=bm_aging.zarr#view=z1.…' --store bm_aging.zarr --out fig.png
$ annzarro export --from fig.png --store bm_aging.zarr --out again.png
```

- The first argument is a panel set file (from **Export** in the Load Panel Set dialog) or a share
  link. `--from` takes an exported PNG or SVG instead and makes that figure again.
- `--store` is the store to draw from. If its cells or genes differ from the store the view was
  saved on, the command stops; `--allow-other-store` exports anyway.
- `--out` ends in `.png` or `.svg`. A view with several plots writes one file per plot,
  `<name>-<panel id>.<ext>`; `--panel cell-plot-1` writes just that one.
- If the view was saved with another AnnZarro version, the command says which, and that the
  exact figure needs that version (`pip install annzarro==<version>`).

It starts a local server on the store and renders in the headless Chromium that Playwright
installs, with WebGL drawn in software (SwiftShader), so the graphics card does not enter the
result. Exported twice from the same panel set and store, each time in a fresh server and browser,
the SVGs are identical byte for byte and the PNGs pixel for pixel; the test suite checks this on
every run (`annzarro/tests/integration/test_export_reproducible.py`).

```{note}
The points of a plot are drawn with WebGL, so in an SVG they are one embedded bitmap, as in any
SVG export ({doc}`export`); axes, labels and legend are vector graphics. Prefer SVG for
publication: its text stays text, and the bitmap of the points is the same pixels as the PNG's.
```

```{admonition} What happens on the server
:class: note
Opening a saved view asks `/api/v1/data/fingerprint` once ({doc}`../reference/http-api`). The
fingerprint reads the store's metadata files and its cell and gene names, never a data matrix,
and is stored in `~/.annzarro/fingerprints/`. The server never writes to the store.
```
