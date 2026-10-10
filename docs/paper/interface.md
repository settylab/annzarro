# Interface

```{figure} ../_static/figures/paper/interface.png
:alt: The paper's interface figure. a, the AnnZarro window with four linked panels. b, four views of the same diffusion-walk UMAP after clicks on an HSC, a GMP, a cMoP and a monocyte. c, a cell table filtered by two conditions next to a UMAP in which cells outside the table are grey.
:width: 100%

*AnnZarro on the demonstration data*, the interface figure of the AnnZarro paper (Otto, Baasri
and Setty, in preparation), assembled by
`figures/fig5_app.py` from headless screenshots made by `figures/screenshots.py` in the paper
repository.
```

AnnZarro on the demonstration data `bm_aging_annzarro.zarr`. **a**, Four linked panels with the focused
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
  (`Mature_Young_2#TCAATTCAGTGAGGCT-1`), which is drawn under a neighbour. A click focuses the
  nearest point; clicking the same spot again steps through the points under it, or type the ID
  into **Focused Cell**.

## Views

The links are ready for a local server with the store in its data directory; to use another
server address or a store elsewhere, see {ref}`tut-start-links`.

::::{dropdown} Panel a: four linked panels
```{literalinclude} ../_static/panelsets/paper/interface-overview.url.txt
:language: text
```
::::

::::{dropdown} Panel b: walk and cell types (opens at the HSC)
```{literalinclude} ../_static/panelsets/paper/interface-focus-sequence.url.txt
:language: text
```
::::

::::{dropdown} Panel c: two-condition filter masking a UMAP
```{literalinclude} ../_static/panelsets/paper/interface-table-filter.url.txt
:language: text
```
::::

Panel sets: {download}`interface-overview.json <../_static/panelsets/paper/interface-overview.json>`,
{download}`interface-focus-sequence.json <../_static/panelsets/paper/interface-focus-sequence.json>`,
{download}`interface-table-filter.json <../_static/panelsets/paper/interface-table-filter.json>`.
View JSON: {download}`interface-overview.view.json <../_tools/views/interface-overview.json>`,
{download}`interface-focus-sequence.view.json <../_tools/views/interface-focus-sequence.json>`,
{download}`interface-table-filter.view.json <../_tools/views/interface-table-filter.json>`.
Loading one restores the dataset, the focus and the split layout, like the links ({ref}`tut-tour-load-file`).

Screenshots and views are made by `docs/_tools/shoot_figs13.py`.
