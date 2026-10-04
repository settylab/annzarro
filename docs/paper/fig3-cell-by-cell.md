# Fig. 3 · Cell by cell

```{figure} ../_static/figures/paper/fig3.png
:alt: Paper Fig. 3. a, four UMAPs coloured by the five-step diffusion walk from an HSC, an LMPP, a GMP and a monocyte, with the diffusion path drawn as a line. b, UMAP distance against diffusion distance from a focused plasma cell, with two discordant groups in orange and blue. c, the same groups on the UMAP.
:width: 100%

Fig. 3 of the AnnZarro paper (Otto, Baasri and Setty, in preparation), made in Python by
`figures/fig2_cell_by_cell.py` in the paper repository.
```

A cells × cells matrix read one focused cell at a time. **a**, The UMAP coloured by the focused
cell's row of a dense five-step diffusion walk (`obsp/diffusion_walk_t5`) for four cells along the
shortest diffusion path from an HSC to a monocyte. **b**, For a focused plasma cell, UMAP distance
against multiscale diffusion distance to every other cell (Spearman ρ = 0.62), with 265 cells near
on the UMAP but far in diffusion space (orange) and 392 the reverse (blue). **c**, The same groups
on the UMAP. The tutorial {doc}`../tutorials/cell-similarity` builds every panel in AnnZarro on
`bm_aging_showcase.zarr`.

| Panel | In AnnZarro | Tutorial section |
|---|---|---|
| a | live: `obsp/diffusion_walk_t5` row as colour, four clicks in a table of the path cells (precomputed `fig3a_*` columns) | {ref}`tut-cell-walk` |
| b | live axes: rows of `obsp/umap_distance` and `obsp/diffusion_distance`; precomputed colour `fig3_plasma_groups` | {ref}`tut-cell-distance-axes` |
| c | UMAP coloured by `fig3_plasma_groups` | {ref}`tut-cell-groups-umap` |
| counts (265, 392, cell types) | table filters | {ref}`tut-cell-check` |

(fig3-differences)=
## Differences from the paper figure

| In the paper | In AnnZarro | Closest equivalent |
|---|---|---|
| **Log colour scale** for the walk (10⁻⁵ to 0.0126), cells below 10⁻⁵ in grey | Linear by default. Of the 956 cells the HSC's walk reaches above 10⁻⁵, 64% are below 5 × 10⁻⁴ (median 1.0 × 10⁻⁴), so on a linear scale they show as pale blue and the walks look narrower. | Click **Log** in the colour controls and type `1e-5` in the floor box beside it: the colour becomes log10 of the value, and values at or below the floor share the lowest colour. |
| **Shared colour range** across the four panels of a | Each row scales itself. | **Lock Range** with the HSC focused keeps 0 to 0.0126, the largest value in the four rows. |
| **Path line** through the 13 path cells | No line overlays. | The path table in the tutorial, or colour by `obs/fig3a_focus_cells` (raise **Size**). |
| **n_eff = 1/Σp²** per panel (251, 517, 559, 289 cells) | Not computed. | Values in `figures/numbers/fig2.json` of the paper repository. |
| **Spearman ρ = 0.62** and the 5% / 20% **threshold lines** in b | No statistics or reference lines on plots. | The thresholds' result is stored as `fig3_plasma_groups`; per-cell distances to the plasma cell also exist as obs columns (`fig3_umap_dist_to_plasma`, `fig3_diffusion_dist_to_plasma`). |
| **Group labels and walk mass** in c (0.09% on orange, 59.2% on blue) | Not computed. | Table filters give the cell types of each group ({ref}`tut-cell-check`). |
| **Dataset-wide numbers** in the caption (median per-cell ρ 0.85; 14 of 30 neighbours shared) | Not computed; they summarise all 8,090 rows. | `figures/fig2_cell_by_cell.py`. |
| **Groups fixed to one plasma cell** | The axes of b follow any focused cell; the colours do not, since `fig3_plasma_groups` describes the paper's plasma cell only. | Lock both axes to keep the plasma cell's distances. |
| Focused cell drawn as a ring | Drawn as a larger dark point ("Highlight Focused Cell"). | |

The path cells, groups and distances in the showcase store were computed by the paper's figure
code and checked against its numbers (265 and 392 cells; ρ of the two rows 0.6169), see
{doc}`../data/showcase-store`.

## Views

The links are ready for a local server with the store in its data directory; to use another
server address or a store elsewhere, see {ref}`tut-start-links`.

::::{dropdown} Panel a: walk and path table (opens at the HSC)
```{literalinclude} ../_static/panelsets/paper/fig3-walk.url.txt
:language: text
```
::::

::::{dropdown} Panels b and c (opens at the plasma cell)
```{literalinclude} ../_static/panelsets/paper/fig3-umap-vs-diffusion.url.txt
:language: text
```
::::

Panel sets: {download}`fig3-walk.json <../_static/panelsets/paper/fig3-walk.json>`,
{download}`fig3-umap-vs-diffusion.json <../_static/panelsets/paper/fig3-umap-vs-diffusion.json>`.
View JSON: {download}`fig3-walk.view.json <../_tools/views/fig3-walk.json>`,
{download}`fig3-umap-vs-diffusion.view.json <../_tools/views/fig3-umap-vs-diffusion.json>`.
Loading one restores the dataset, the focus and the split layout, like the links ({ref}`tut-tour-load-file`).

Screenshots and views are made by `docs/_tools/shoot_figs13.py`; the paper's numbers are in
`figures/numbers/fig2.json` of the paper repository.
