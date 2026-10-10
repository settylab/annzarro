# Share links

**Share Link** turns what you see into a URL: the dataset, every panel with its settings, the split
layout with its sizes, and the focused cell and gene. Anyone who opens the URL on the same server
gets the same view. Nothing is stored on the server; the view travels inside the link.

## Copy a link

1. Arrange the view you want to share.
2. Click **Share Link** in the header. The label changes to **Copied!** for two seconds and the
   link is on your clipboard.
3. Paste it into a message or a document.

When the browser does not allow clipboard access (pages served over plain `http://` from a cluster
node, for example), AnnZarro shows the link in a field under the button instead, already
selected. Press Ctrl+C (Cmd+C on a Mac) to copy it, and close the field with **×**.

```{figure} ../_static/screens/user-guide/share-fallback.png
:class: screenshot
:width: 70%
:alt: The header's Share Link button (1) and, below it, a selected text field (2) holding the end of a long link.

Share Link (1) and the copy field (2) shown when the clipboard is not available.
```

## What a link contains

A link has two parts:

```text
http://<server>/?dataset_path=<path on the server>#view=z1.<compressed view>
```

- `dataset_path` (query) is the dataset: its name in the server's data directory, such as
  `bm_aging_annzarro.zarr`, when it is inside it (links made before v0.4.1 hold the absolute path), an
  absolute path for a store outside it, or a remote URL ({doc}`remote-datasets`). A name relative
  to the data directory works on any server that has that store there (the tutorials' links are
  written this way, {ref}`tut-start-links`).
- `#view=` (fragment) holds the view: the focused cell, focused gene and taxonomy, the cell subset
  ({doc}`subsets`), and the layout tree (splits, pane sizes in percent, which panels have their
  controls open, and each panel's full settings, including locks, colour ranges and table
  filters). Panels created from the Welcome tile are included like any other. It also records
  the store's fingerprint and the AnnZarro version, so a link opened on another store or version
  says so ({doc}`reproducing`). The `z1.` prefix marks it as deflate-compressed JSON in base64url.

The fragment is never sent to the server, so a link does not appear in server logs and has no
server-side length limit. The grammar, and how to build a link by hand from a JSON `view`, are in
{doc}`../reference/deep-links`; every view file offered for download in this guide (for example
{download}`userguide-focus.json <../_tools/views/userguide-focus.json>`) is such a `view`.

A link does **not** contain data. It opens on any server whose data directory holds the same
store; if the store is not there, the link opens its layout without data and lets you choose a
store ({doc}`reproducing`).

## How long is a link?

Measured on this build with `bm_aging_annzarro.zarr`. Each count includes the server address and the
URL-encoded dataset path, 169 characters here; a shorter data directory path gives shorter links.

| View | Link length |
|---|---|
| Two cell plots ({doc}`focus-and-lock`) | 1,472 characters |
| Two cell plots, a gene plot and a cell table filtered to 319 HSCs (the landing-page view) | 1,826 characters |
| Same, table filtered to the 3,116 cells of Age = Old | 1,825 characters |
| Same, table without a filter (8,090 rows) | 1,741 characters |

A link stores each table's filter conditions, not the rows that pass them, so its length does
not depend on how many rows a table shows. Plots add a few hundred characters each.

## Open a link

Paste the link into the address bar of a browser that can reach the server (and log in if the server
asks). Links work the same when the server runs under a path prefix behind a proxy (for example
`https://lab.example.org/annzarro/?dataset_path=…`). AnnZarro opens the dataset, applies the focus and rebuilds the layout. A link takes
precedence over the panels autosaved in that browser. Opening a second link in the same tab
reloads the page and applies the new view.

Once the view is open, the address bar follows it, as in a map: about half a second after you
change something (open or close a panel, change a setting, change the focus) the `#view=` part
of the address is replaced with the current view. A refresh brings back what you see now, not
the view you were sent, and the address you copy from the bar is a link to it. The address is
replaced, not added to, so the Back button is not affected, and it is not touched while a
dataset is loading.

A link without `#view=` (`http://<server>/?dataset_path=<path>`) opens the blank dashboard of
that dataset: no panels, every panel type offered on the welcome screen. It ignores the panels
autosaved in the browser. Closing every panel also removes `#view=` from the address, so the
address is that clean link again. Only an address with no `dataset_path` at all restores the
panels autosaved in this browser.

If the view cannot be decoded (for example because a mail client cut the link), AnnZarro says
"Invalid deep-link" and opens just the dataset.

```{admonition} What happens on the server
:class: note
Copying a link sends nothing. Opening one costs the same requests as building the view by hand:
the dataset structure, the cell and gene names, then one vector per axis and colour of every
panel.
```
