# Fig. 2 · The interface

```{figure} ../_static/figures/paper/fig2.png
:alt: Paper Fig. 2. a, the AnnZarro window with four linked panels. b, four views of the same diffusion-walk UMAP after clicks on an HSC, a GMP, a cMoP and a monocyte. c, a cell table filtered by two conditions next to a UMAP in which cells outside the table are grey.
:width: 100%

Fig. 2 of the AnnZarro paper (Otto, Baasri and Setty, in preparation), assembled by
`figures/fig5_app.py` from headless screenshots made by `figures/screenshots.py` in the paper
repository.
```

AnnZarro on the demonstration data `bm_aging.zarr`. **a**, Four linked panels with the focused
gene H2-Q7 and a focused haematopoietic stem cell: a UMAP coloured by the stem cell's row of a
five-step diffusion walk, the Kompot volcano coloured by each gene's fold-change correlation with
H2-Q7, the UMAP coloured by H2-Q7's fold change, and a cell table filtered to stem cells.
**b**, The walk panel after four clicks from a stem cell through a GMP and a cMoP to a monocyte.
**c**, A two-condition table filter (HSC and differential abundance z-score above 2; 290 of 8,090
cells) masks a linked UMAP. All three are app screenshots, so the tutorial {doc}`../tutorials/tour`
rebuilds them exactly.

| Panel | In AnnZarro | Tutorial section |
|---|---|---|
| a | live, identical view | {ref}`tut-tour-overview` |
| b | live, the same four clicks | {ref}`tut-tour-clicks` |
| c | live, identical filter; 290 of 8,090 cells | {ref}`tut-tour-filter` |
| saving and sharing the views | Save Panel Set, Load Panel Set, Share Link | {ref}`tut-tour-save` |

## Differences from the paper figure

- **Assembly.** The paper crops the Plotly toolbar from the panel b and c tiles and adds titles
  such as "click 1: HSC" in matplotlib (`figures/fig5_app.py`). The app shows tile titles
  instead.
- **Rendering.** The paper's screenshots were taken at device scale factor 2 on AnnZarro commit
  95d0e64 (pull request 43); the tutorial's are at 1.5 on the documentation branch, so fonts and
  point sizes differ slightly.
- **Last click in b.** The paper's last frame is not the protocol's example monocyte
  (`Mature_Young_2#TCAATTCAGTGAGGCT-1`), which is drawn under a neighbour and cannot be hit by a
  click. To focus that exact cell, type its ID into **Focused Cell**.
- **Legend overlap in c.** The "Not in table" legend entry overlaps the colour-bar title, as in the
  paper; a known display issue.

## Views

Replace `/path/to/annzarro-data` with the absolute path of your data directory and the host with
your server's ({doc}`../user-guide/share-links`).

::::{dropdown} Panel a: four linked panels
```{literalinclude} ../_static/panelsets/paper/fig2-overview.url.txt
:language: text
```
::::

::::{dropdown} Panel b: walk and cell types (opens at the HSC)
```{literalinclude} ../_static/panelsets/paper/fig2-focus-sequence.url.txt
:language: text
```
::::

::::{dropdown} Panel c: two-condition filter masking a UMAP
```{literalinclude} ../_static/panelsets/paper/fig2-table-filter.url.txt
:language: text
```
::::

Panel sets: {download}`fig2-overview.json <../_static/panelsets/paper/fig2-overview.json>`,
{download}`fig2-focus-sequence.json <../_static/panelsets/paper/fig2-focus-sequence.json>`,
{download}`fig2-table-filter.json <../_static/panelsets/paper/fig2-table-filter.json>`.
View JSON: {download}`fig2-overview.view.json <../_tools/views/fig2-overview.json>`,
{download}`fig2-focus-sequence.view.json <../_tools/views/fig2-focus-sequence.json>`,
{download}`fig2-table-filter.view.json <../_tools/views/fig2-table-filter.json>`.
Loading a panel set registers its panels under **Add New Panel** > "Duplicate or Reopen Panel"
but does not restore focus or layout; the links do ({ref}`tut-tour-load-file`).

Screenshots and views are made by `docs/_tools/shoot_figs13.py`.
