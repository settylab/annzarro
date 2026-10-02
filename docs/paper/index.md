# Paper figures, step by step

These guides reproduce the figures of the AnnZarro paper (Otto, Baasri and Setty, in
preparation) in the app, on the demonstration data `bm_aging.zarr` (8,090 cells × 16,285
genes; ageing murine bone marrow, processed with Kompot {cite:p}`otto2025kompot`). Each guide
says which panels to add, which dropdown values to pick and where to click, and shows what
you should then see. Where AnnZarro cannot draw part of a figure, the guide says so and shows
the closest view.

Figure numbers follow the manuscript. Fig. 6 compares AnnZarro with other single-cell
viewers; it is a table of capabilities rather than an AnnZarro view, so it has no guide. Its
sources are listed in `figures/COMPARISON_NOTES.md` of the paper repository.

::::{grid} 1 2 2 3
:gutter: 3

:::{grid-item-card} Fig. 1 · The focus model
:img-top: ../_static/figures/paper/fig1-thumb.png
:link: fig1-focus-model
:link-type: doc

How one focused cell and one focused gene pick rows of obsp, layers and varp, and how a
click moves the focus.
:::

:::{grid-item-card} Fig. 2 · The interface
:img-top: ../_static/figures/paper/fig2-thumb.png
:link: fig2-interface
:link-type: doc

The app screenshots of the paper: linked panels, focus controls, tables and panel sets on
the demonstration data.
:::

:::{grid-item-card} Fig. 3 · Cell by cell
:img-top: ../_static/figures/paper/fig3-thumb.png
:link: fig3-cell-by-cell
:link-type: doc

A walk through haematopoiesis, one focused cell at a time, with a diffusion kernel row
(obsp) painted over the embedding.
:::

:::{grid-item-card} Fig. 4 · Gene by gene
:img-top: ../_static/figures/paper/fig4-thumb.png
:link: fig4-gene-by-gene
:link-type: doc

A Kompot volcano coloured by Spearman correlation to the focused gene (varp), used to
browse MHC class I and class II modules.
:::

:::{grid-item-card} Fig. 5 · Cells and genes
:img-top: ../_static/figures/paper/fig5-thumb.png
:link: fig5-cells-and-genes
:link-type: doc

A gene's fold change across cells, a cell's fold change across genes, and a locked cell
compared with the focused one.
:::

:::{grid-item-card} Fig. 6 · Tool comparison
:img-top: ../_static/figures/paper/fig6-thumb.png

Not an AnnZarro view and no guide: a capability table of AnnZarro and other single-cell
viewers, checked against their documentation and source code.
:::

:::{grid-item-card} Fig. 7 · Slot map
:img-top: ../_static/figures/paper/fig7-thumb.png
:link: fig7-slot-map
:link-type: doc

Which AnnData array drives which control: one panel per slot (obs, obsm, obsp, layers, var,
varm, varp, uns) with the exact dropdown values.
:::

:::{grid-item-card} Fig. 8 · Deployment modes
:img-top: ../_static/figures/paper/fig8-thumb.png
:link: fig8-deployment
:link-type: doc

How to set up each arrangement: desktop app, `annzarro start` on an HPC node through an SSH
tunnel, and a lab server behind a TLS proxy.
:::

:::{grid-item-card} Fig. 9 · Performance
:img-top: ../_static/figures/paper/fig9-thumb.png
:link: fig9-performance
:link-type: doc

Rerunning the benchmark harness, what each panel measures, and how to measure the cost of a
click in your own browser.
:::
::::

```{toctree}
:hidden:
:maxdepth: 1

fig1-focus-model
fig2-interface
fig3-cell-by-cell
fig4-gene-by-gene
fig5-cells-and-genes
fig7-slot-map
fig8-deployment
fig9-performance
```
