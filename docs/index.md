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
