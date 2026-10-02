# Fig. 4 · Gene by gene

```{figure} ../_static/figures/paper/fig4.png
:alt: Paper Figure 4, four panels: two Kompot volcanoes coloured by a gene's row of the fold-change correlation matrix, two rank strips coloured by module, and a scatter of two correlation rows.

Fig. 4 of the AnnZarro paper (Otto, Baasri and Setty, in preparation), made in Python by
`figures/fig3_gene_by_gene.py` in the paper repository.
```

A gene x gene matrix read one row at a time over a differential expression volcano: the focused
gene picks a row of `varp/spearman_fold_change` (the correlation of fold changes across cells),
and the row colours every gene. H2-Q7 shares its age response with H2-Q6 (ρ = 0.82), Tapbpl
(0.73), H2-D1 (0.66) and B2m (0.60); one click on H2-Aa moves the colour to the MHC class II
genes. Graded rows are compared with discrete modules of the 190 DE genes, and two rows of two
matrices separate a shared age response from a shared expression pattern. The tutorial
{doc}`../tutorials/gene-similarity` builds every panel in AnnZarro.

| Panel | In AnnZarro | Tutorial section |
|---|---|---|
| a | live: `varp` row of the focused gene as colour | {ref}`tut-gene-volcano-row` |
| b | live: click H2-Aa | {ref}`tut-gene-refocus` |
| c | precomputed modules and ranks (showcase columns) | {ref}`tut-gene-modules` |
| d | live axes (two `varp` rows); precomputed colour | {ref}`tut-gene-two-rows` |
| numbers | hover labels and table filters | {ref}`tut-gene-check` |

## Checking the numbers

Hover labels and table filters check most statements; offline ones are marked. Steps: {ref}`tut-gene-check`.

| Statement | How to check it in AnnZarro | Result |
|---|---|---|
| H2-Q6 ρ = 0.82, Tapbpl 0.73, H2-D1 0.66, B2m 0.60 | gene table with `rho_fc_H2-Q7`; click its header twice to sort descending | top rows H2-Q7 (1), H2-Q6, Tapbpl, H2-D1, Fxyd5, Sec62, B2m |
| only H2-Q6 of these is DE | add `kompot_de_Young_to_Old_is_de` as a column | Yes for H2-Q6 only |
| 190 DE genes | `kompot_de_Young_to_Old_mahalanobis` **Greater Than** `5.82` | 190 entries |
| 52 of 86 module-mates with ρ < 0.2 | `fig4_module_k3` = `module 1` AND `rho_fc_H2-Q7` < `0.2` | 52 entries |
| 204 genes share the cell-state pattern | `rho_smoothed_H2-Q7` **Greater Than** `0.7` | 205 entries: 204 plus H2-Q7 itself |
| 35 genes share the age response | `rho_fc_H2-Q7` **Greater Than** `0.5` | 36 entries: 35 plus H2-Q7 |

## Differences from the paper figure

- **Statistics computed offline.** The modules, the silhouette scores (flat at 0.23 to 0.25 for
  k = 2 to 6, maximum 0.250 at k = 3), the ranks and the class labels of panel d come from the
  figure script and are stored as columns of `bm_aging_showcase.zarr`
  ({doc}`../data/showcase-store`). AnnZarro does not cluster, rank or compute silhouettes.
- **Fixed to H2-Q7 and S100a9.** The rank, module and class columns describe those two genes.
  Panels a, b and the axes of d follow any focused gene; the panel c strips and the panel d colours
  do not.
- **Labels.** The paper labels the top partners next to their points. AnnZarro has no text labels
  on plots; use hover labels or a sorted table.
- **Drawing order.** The paper draws the strongest |ρ| on top and uses a smaller marker.
  AnnZarro draws genes in store order, which hides some of H2-Q7's partners (Tapbpl, B2m) in the
  dense core until you zoom.
- **Threshold line.** The dashed 5% FDR line in a and b is not drawn; the DE threshold is the
  smallest Mahalanobis distance of a DE gene, 5.82.
- **Colour map.** AnnZarro's `RdBu` from −1 to 1 stands in for the paper's diverging map; both put
  positive ρ in red.
- **Table columns.** A gene table cannot show a `varp` row in this version, so the checks use the
  showcase columns `rho_fc_*` and `rho_smoothed_H2-Q7`.

## Views

Share links (replace `/path/to/annzarro-data` with your absolute data directory and the host with
your server's):

::::{dropdown} Panels a and b
```{literalinclude} ../_static/panelsets/paper/fig4-ab.url.txt
:language: text
```
::::

::::{dropdown} Panel c
```{literalinclude} ../_static/panelsets/paper/fig4-c.url.txt
:language: text
```
::::

::::{dropdown} Panel d
```{literalinclude} ../_static/panelsets/paper/fig4-d.url.txt
:language: text
```
::::

Panel sets: {download}`fig4-ab.json <../_static/panelsets/paper/fig4-ab.json>`,
{download}`fig4-c.json <../_static/panelsets/paper/fig4-c.json>`,
{download}`fig4-d.json <../_static/panelsets/paper/fig4-d.json>`. Loading one registers its panels
under **Add New Panel** > "Duplicate or Reopen Panel" but does not restore focus or layout; the
links do ({doc}`../user-guide/panel-sets`).

Screenshots and views are made by `docs/_tools/shoot_figs45.py`; the paper's numbers are in
`figures/numbers/fig3.json` of the paper repository.
