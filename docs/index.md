# AnnZarro

AnnZarro is a read-only, browser-based viewer for AnnData stored as zarr. It is built around
the matrices that other viewers leave out: cell-by-cell kernels and distances (`obsp`) and
gene-by-gene similarities (`varp`), explored one focused cell or gene at a time and linked to
the cell-by-gene layers.

```{figure} _static/screens/index/overview.png
:class: screenshot
:alt: Four linked AnnZarro panels on the demonstration data

Four linked panels on the demonstration data: a diffusion walk from the focused cell, a
differential expression volcano coloured by correlation with the focused gene, the gene's
fold change on the UMAP, and a filtered cell table.
```

::::{grid} 2
:gutter: 2

:::{grid-item-card} Getting started
:link: getting-started/index
:link-type: doc
Install from PyPI or the desktop app and open your first dataset.
:::

:::{grid-item-card} User guide
:link: user-guide/index
:link-type: doc
Focus, lock, panels, tables, panel sets, share links and export.
:::

:::{grid-item-card} Preparing data
:link: data/index
:link-type: doc
Which slot drives which view, chunking, Kompot outputs and the demonstration data.
:::

:::{grid-item-card} Tutorials
:link: tutorials/index
:link-type: doc
Cell similarity beyond the UMAP, gene programmes beyond clusters, and where a gene changes.
:::

:::{grid-item-card} Deployment
:link: deployment/index
:link-type: doc
Desktop, personal server over SSH, and read-only lab servers.
:::

:::{grid-item-card} Reference
:link: reference/index
:link-type: doc
CLI, configuration, HTTP API, deep links, wire format and architecture.
:::
::::

## Desktop app or server

AnnZarro runs in two main ways. Both show the same interface and read the same stores.

::::{grid} 1 1 2 2
:gutter: 2

:::{grid-item-card} Desktop app
For one person with data on their own computer.

- Standalone for macOS, Windows and Linux, no Python needed
- Works offline; nothing leaves your computer
- Opens local `.zarr` stores from a folder or the dataset picker
- No login, no set-up

{doc}`Download and first launch <getting-started/desktop-app>`
:::

:::{grid-item-card} Server mode
For a lab or institute that shares datasets in the browser.

- Many users reach one server in the browser, with login
- Panel sets are shared and exchanged between users
- Large datasets stay on the server; only the slices a view needs travel to the browser
- Per-user dataset access control and an admin page
- Less memory on each user's computer

{doc}`Lab server <deployment/lab-server>`, {doc}`access control <deployment/authentication>`
:::
::::

Use the desktop app if you are the only user and the data are on your computer. Use a server if
several people should open the same datasets, if the data are too large or too far away to copy
to each computer, or if some collaborators may see only some datasets. A personal server over SSH
({doc}`deployment/personal-server`) covers one person with data on a cluster. The
{doc}`full comparison <getting-started/desktop-or-server>` lists the differences.

```{toctree}
:hidden:
:maxdepth: 2

getting-started/index
tutorials/index
user-guide/index
data/index
deployment/index
reference/index
```

```{toctree}
:hidden:
:caption: Appendix
:maxdepth: 1

paper/index
references
```

```{toctree}
:hidden:
:caption: Links

GitHub repository <https://github.com/settylab/annzarro>
Setty Lab <https://settylab.org>
```
