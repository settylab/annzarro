# Paper figures

Reference pages for the figures of the AnnZarro paper (Otto, Baasri and Setty, in
preparation). Each page shows the figure, says which parts AnnZarro reproduces, and links to
the views: share links and panel set files that reopen every view shown in the figure. The
interface, cell-by-cell, gene-by-gene and cells-and-genes figures are rebuilt step by step in
the {doc}`../tutorials/index`.

The pages are named after what a figure shows, not after its number in the paper, so they
stay valid when the paper's figures are renumbered.

::::{grid} 2 3 3 3
:gutter: 2

:::{grid-item-card} Overview: focus model, slots and comparison
:img-top: ../_static/figures/paper/overview-thumb.png
:link: overview
:link-type: doc
:::

:::{grid-item-card} Interface
:img-top: ../_static/figures/paper/interface-thumb.png
:link: interface
:link-type: doc
:::

:::{grid-item-card} Procedure
:img-top: ../_static/figures/paper/procedure-thumb.png
:link: procedure
:link-type: doc
:::

:::{grid-item-card} Cell by cell
:img-top: ../_static/figures/paper/cell-by-cell-thumb.png
:link: cell-by-cell
:link-type: doc
:::

:::{grid-item-card} Gene by gene
:img-top: ../_static/figures/paper/gene-by-gene-thumb.png
:link: gene-by-gene
:link-type: doc
:::

:::{grid-item-card} Cells and genes
:img-top: ../_static/figures/paper/cells-and-genes-thumb.png
:link: cells-and-genes
:link-type: doc
:::

:::{grid-item-card} Deployment
:img-top: ../_static/figures/paper/deployment-thumb.png
:link: deployment
:link-type: doc
:::

:::{grid-item-card} Scale: Tahoe-100M
:img-top: ../_static/figures/paper/scale-thumb.png
:link: scale
:link-type: doc
:::

:::{grid-item-card} Performance: what one click costs
:img-top: ../_static/figures/paper/performance-thumb.png
:link: performance
:link-type: doc
:::
::::

(paper-data)=
## Data for the views

The share links on these pages open a store on a local AnnZarro server: they are written for
`http://127.0.0.1:8000` with the store's file name in the server's data directory
({doc}`../getting-started/quickstart`; to change the address or the store path, see
{ref}`tut-start-links`). Each page needs one of these stores.

| Page | Store | How to get it |
|---|---|---|
| {doc}`overview`, {doc}`interface`, {doc}`procedure`, {doc}`performance`, {doc}`cell-by-cell` (a to c), {doc}`gene-by-gene`, {doc}`cells-and-genes` | `bm_aging_annzarro.zarr` (5.3 GiB) | Download it from Zenodo (ZENODO_DOI_TBD), or build it from the public raw data with two scripts in this repository: {doc}`../data/demo-data` |
| {doc}`cell-by-cell` (d) | `celegans_connectome_cengen.zarr` (7.7 MB) | Build it with a script in this repository from public downloads: {ref}`cell-by-cell-connectome` |
| {doc}`scale` | the Tahoe-100M store (95,624,334 cells) | Download the public Tahoe-100M release; the build script will be published with the paper: {ref}`paper-scale-store` |
| {doc}`deployment` | none | The figure is a diagram |

```{important}
**Placeholder: Zenodo deposit.** The processed AnnZarro-ready stores and the panel sets used for
the figures will be deposited on Zenodo with the paper's release. The record does not exist yet;
its DOI and download instructions will be added here when it does. Until then, build the stores
as described in the table.
```

(paper-companion)=
## The paper's companion repository

Some pages name files such as `figures/…`, `data_prep/…` or `benchmark/…`. They are in the
paper's companion repository, `settylab/annzarro-paper`, which stays private until the paper is
published. The names say where a figure, a number or a view comes from; you do not need them to
open the views or to build the stores, whose scripts are in this repository. The exception is
the Tahoe-100M store, whose build script will be published with the paper.

```{toctree}
:hidden:
:maxdepth: 1

overview
interface
procedure
cell-by-cell
gene-by-gene
cells-and-genes
deployment
scale
performance
```
