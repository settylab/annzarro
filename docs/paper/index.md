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
| {doc}`overview`, {doc}`interface`, {doc}`procedure`, {doc}`performance`, {doc}`cell-by-cell` (a to c), {doc}`gene-by-gene`, {doc}`cells-and-genes` | `bm_aging_annzarro.zarr` (5.3 GiB) | Download it from Zenodo (doi:10.5281/zenodo.23277103), or build it from the public raw data with two scripts in this repository: {doc}`../data/demo-data` |
| {doc}`cell-by-cell` (d) | `celegans_connectome_cengen.zarr` (7.7 MB) | Build it with a script in this repository from public downloads: {ref}`cell-by-cell-connectome` |
| {doc}`scale` | the Tahoe-100M store (95,624,334 cells) | Download the public Tahoe-100M release (CC0) and its UMAP from the same Zenodo record, and build the store with `build_tahoe.py` from `annzarro-reproducibility`: {ref}`paper-scale-store` |
| {doc}`deployment` | none | The figure is a diagram |

The Zenodo record [doi:10.5281/zenodo.23277103](https://doi.org/10.5281/zenodo.23277103) holds
the bone marrow store and the UMAP of every Tahoe-100M cell. The benchmark code of the paper,
including the Tahoe-100M build script, is in the public repository
[settylab/annzarro-reproducibility](https://github.com/settylab/annzarro-reproducibility).

(paper-companion)=
## The paper's companion repository

The paper's figure scripts, figure numbers, panel set sources and benchmark harness and results
are in the public repository
[settylab/annzarro-reproducibility](https://github.com/settylab/annzarro-reproducibility). Pages
name files such as `figures/…`, `data_prep/…` or `benchmark/…`; each name links to that file at
one fixed commit
([`9c416c6`](https://github.com/settylab/annzarro-reproducibility/commit/9c416c624c2ba9effb7ea77488a029972fbf31f4)), so the link shows
what the page describes. The names say where a figure, a number or a view comes from; you do not
need them to open the views or to build the stores, whose scripts are in this repository. The
exception is the Tahoe-100M store, whose build script is in the companion repository
({ref}`paper-scale-store`).

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
