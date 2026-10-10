# Cells and genes

```{figure} ../_static/figures/paper/cells-and-genes.png
:alt: The paper's cells-and-genes figure: S100a9 fold change and smoothed expression on UMAPs, and a scatter of two cells' fold-change rows.

*Linking genes to cells and cells to genes*, a figure of the AnnZarro paper (Otto, Baasri and
Setty, in preparation), made in Python by
`figures/fig4_cells_by_genes.py` in the paper repository.
```

One cells x genes layer read both ways. A gene's column of the Kompot fold-change layer colours
the cells: S100a9 has a mean log2 fold change of −0.05, yet it drops in HSCs (median −1.35), and
its smoothed expression on one shared scale goes from 1.74 (Young) to 0.39 (Old) in HSCs. A cell's
row places the genes: the fold changes of a locked HSC against those of the focused monocyte
split the DE genes into 129 that change in the same direction and 61 in opposite directions, and
beyond Kompot's noise level only Apoe changes in opposite directions. The tutorial
{doc}`../tutorials/cells-and-genes` builds every panel in AnnZarro.

| Panel | In AnnZarro | Tutorial section |
|---|---|---|
| a | live: layer column of the focused gene as colour | {ref}`tut-cg-column` |
| b, c | live, with a locked shared colour range | {ref}`tut-cg-shared-scale` |
| d | live axes (locked cell row, focused cell row); precomputed colour | {ref}`tut-cg-rows` |
| d, counts | nested AND/OR table filter on the live rows | {ref}`tut-cg-andor` |
| d, noise | z-score layer and a table filter | {ref}`tut-cg-noise` |
| numbers | hover labels and table filters | {ref}`tut-cg-check` |

## Checking the numbers

Hover labels and table filters check most statements; offline ones are marked. Steps: {ref}`tut-cg-check`.

| Statement | How to check it in AnnZarro | Result |
|---|---|---|
| S100a9 mean log2 fold change −0.05 | gene table, `kompot_de_Young_to_Old_mean_lfc`; or hover S100a9 in a volcano | −0.0513 |
| it drops in HSCs | cell table, fold change < −0.5 AND cell type = HSC | 288 of 317 cells (measured above) |
| HSC median −1.35, Young 1.74, Old 0.39 | not computed in the app; hover over HSCs for single values, or compute the median in Python | from `figures/numbers/fig4.json` |
| 129 same, 61 opposite | the nested AND/OR filter | 61 entries (measured above) |
| only Apoe opposite beyond 1.96 s.d., 10 same | the z-score filter | 11 entries (measured above) |
| Spearman ρ = 0.53 over DE genes | not computed in the app | from `figures/numbers/fig4.json` |

## Differences from the paper figure

- **Rings.** The paper rings both the locked HSC and the focused monocyte in a to c. AnnZarro
  marks only the focused cell. The view for a to c focuses the HSC; the view for d focuses the
  monocyte.
- **Per-cell-type medians and Spearman ρ** (HSC −1.35, next lowest non-classical monocyte −0.21;
  ρ = 0.53 between the two rows over DE genes) are offline statistics. AnnZarro shows single values
  and counts, not medians or correlations.
- **Direction classes** come from the stored column `hsc_vs_monocyte_direction`, computed for these two
  cells. For another pair the AND/OR table recounts them live; the colour does not change.
- **Noise level.** The paper used per-cell standard deviations from
  `obs/kompot_de_{Young,Old}_std`. The stored z-score layer is the same quantity (it equals
  Kompot's own `fold_change_zscores` to float32 precision) and gives the same genes: Apoe and 10
  same-direction genes.
- **Labels and identity line.** The paper labels the five strongest opposite-direction genes and
  draws the identity line. AnnZarro draws neither; use hover labels and the table.
- **Colour maps.** AnnZarro's `RdBu` (centred) and `Viridis` stand in for the paper's diverging and
  sequential maps. The shared scale starts at 0, as in the paper.

## Views

Share links. The links are ready for a local server with the store in its data directory; to use another
server address or a store elsewhere, see {ref}`tut-start-links`.

::::{dropdown} Panels a to c
```{literalinclude} ../_static/panelsets/paper/cells-and-genes-abc.url.txt
:language: text
```
::::

::::{dropdown} Panel a: cells with fold change below −0.5
```{literalinclude} ../_static/panelsets/paper/cells-and-genes-a-cells.url.txt
:language: text
```
::::

::::{dropdown} Panel d with the AND/OR table
```{literalinclude} ../_static/panelsets/paper/cells-and-genes-d.url.txt
:language: text
```
::::

::::{dropdown} Panel d with the noise filter
```{literalinclude} ../_static/panelsets/paper/cells-and-genes-d-noise.url.txt
:language: text
```
::::

Panel sets: {download}`cells-and-genes-abc.json <../_static/panelsets/paper/cells-and-genes-abc.json>`,
{download}`cells-and-genes-a-cells.json <../_static/panelsets/paper/cells-and-genes-a-cells.json>`,
{download}`cells-and-genes-d.json <../_static/panelsets/paper/cells-and-genes-d.json>`,
{download}`cells-and-genes-d-noise.json <../_static/panelsets/paper/cells-and-genes-d-noise.json>`. Loading one restores the dataset, the focus and the split layout, like the links
({doc}`../user-guide/panel-sets`).

Screenshots and views are made by `docs/_tools/shoot_figs45.py`; the paper's numbers are in
`figures/numbers/fig4.json` of the paper repository.
