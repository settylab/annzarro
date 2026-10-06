# Procedure

```{figure} ../_static/figures/paper/procedure.png
:alt: Flowchart of the procedure. Installation, data preparation and starting AnnZarro lead to Worked examples 1 to 5 on the bone marrow store, and separately to Worked example 6 on Tahoe-100M; both lead to saving and sharing, then to optional hosting for a lab.
:width: 100%

*Overview of the procedure*, a figure of the AnnZarro paper (Otto, Baasri and Setty, in
preparation): the stages of the protocol with their step numbers. Dashed box, optional stage.
```

The paper's Procedure takes a processed AnnData object to linked, shareable views in five
stages. Worked examples 1 to 5 use the bone marrow store `bm_aging.zarr` and can be run in any
order, except that Worked example 3 reuses the volcano of Worked example 2. Worked example 6 uses
Tahoe-100M. Below, each stage links to the documentation that covers it, and each worked example
to the view it ends on, as a share link and a panel set file.

| Stage | Documentation |
|---|---|
| Installation: (A) Python package, (B) desktop app | {doc}`../getting-started/installation`, {doc}`../getting-started/desktop-app` |
| Data preparation: Kompot, a kernel in obsp, correlations in varp, a zarr store | {doc}`../data/demo-data`, {doc}`../data/preparing-a-store`, {doc}`../data/chunking` |
| Starting AnnZarro: server, dataset, panels | {doc}`../getting-started/quickstart` |
| Worked examples 1 to 5 | {ref}`paper-procedure-examples` |
| Worked example 6: millions of cells | {doc}`scale`, {doc}`../user-guide/subsets` |
| Saving, sharing: panel sets, links, export | {doc}`../user-guide/panel-sets`, {doc}`../user-guide/share-links`, {doc}`../user-guide/export` |
| (Optional) Hosting for a lab | {doc}`../deployment/lab-server`, {doc}`../deployment/authentication`, {doc}`../deployment/hosting-checklist` |

(paper-procedure-examples)=
## Worked examples

The links are ready for a local server with `bm_aging.zarr` in its data directory (Worked examples
1 to 5) or the Tahoe-100M store (Worked example 6); to use another server address or a store
elsewhere, see {ref}`tut-start-links`. Each panel set file loads the same view with **Load Panel
Set** > **Upload file**. The panel set files below are the views the paper's Worked examples end
on.

::::{dropdown} Worked example 1: walk a diffusion neighbourhood across the embedding
The five-step diffusion walk and the kernel row of the focused cell. Tutorial:
{doc}`../tutorials/cell-similarity`.

```{literalinclude} ../_static/panelsets/protocol/protocol-A-kernel-walk.url.txt
:language: text
```
{download}`protocol-A-kernel-walk.json <../_static/panelsets/protocol/protocol-A-kernel-walk.json>`
::::

::::{dropdown} Worked example 2: browse co-regulated genes in the volcano
The volcano coloured by the focused gene's Spearman rows, smoothed and fold change. Tutorial:
{doc}`../tutorials/gene-similarity`.

```{literalinclude} ../_static/panelsets/protocol/protocol-B-volcano-spearman.url.txt
:language: text
```
{download}`protocol-B-volcano-spearman.json <../_static/panelsets/protocol/protocol-B-volcano-spearman.json>`
::::

::::{dropdown} Worked example 3: from a gene to the cells where it changes
The focused gene's fold change, and its Young and Old smoothed expression. Tutorial:
{doc}`../tutorials/cells-and-genes`.

```{literalinclude} ../_static/panelsets/protocol/protocol-C-foldchange-umap.url.txt
:language: text
```
{download}`protocol-C-foldchange-umap.json <../_static/panelsets/protocol/protocol-C-foldchange-umap.json>`
::::

::::{dropdown} Worked example 4: compare two cell states gene by gene
The fold-change rows of a locked HSC against the focused cell. Tutorial:
{doc}`../tutorials/cells-and-genes`.

```{literalinclude} ../_static/panelsets/protocol/protocol-D-locked-vs-focused-cell.url.txt
:language: text
```
{download}`protocol-D-locked-vs-focused-cell.json <../_static/panelsets/protocol/protocol-D-locked-vs-focused-cell.json>`
::::

::::{dropdown} Worked example 5: define subsets with tables and mask plots
HSCs with a differential abundance z-score above 2, masking a UMAP. Tutorial:
{doc}`../tutorials/tour`.

```{literalinclude} ../_static/panelsets/protocol/protocol-E-table-filter.url.txt
:language: text
```
{download}`protocol-E-table-filter.json <../_static/panelsets/protocol/protocol-E-table-filter.json>`
::::

::::{dropdown} Worked example 6: datasets of millions of cells
The default subset, the next part, a subset balanced across cell lines and every cell in
large-plot mode, on Tahoe-100M. The links, and how to get the store, are on {doc}`scale`.

```{literalinclude} ../_static/panelsets/paper/scale-default-subset.url.txt
:language: text
```
{download}`scale-default-subset.json <../_static/panelsets/paper/scale-default-subset.json>`
::::
