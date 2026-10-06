# Cell by cell

```{figure} ../_static/figures/paper/cell-by-cell.png
:alt: The paper's cell-by-cell figure. a, four UMAPs coloured by the five-step diffusion walk from an HSC, an LMPP, a GMP and a monocyte, with the diffusion path drawn as a line. b, UMAP distance against diffusion distance from a focused plasma cell, with two discordant groups in orange and blue. c, the same groups on the UMAP. d, 112 C. elegans neuron classes on a UMAP of their transcriptomes, coloured by the chemical synapses sent by the focused class AVA, strongest in the ventral cord motor neurons.
:width: 100%

*A cell-by-cell matrix, read one focused cell at a time*, a figure of the AnnZarro paper (Otto,
Baasri and Setty, in preparation), made in Python by
`figures/fig2_cell_by_cell.py` in the paper repository.
```

A cells × cells matrix read one focused cell at a time. **a**, The UMAP coloured by the focused
cell's row of a dense five-step diffusion walk (`obsp/diffusion_walk_t5`) for four cells along the
shortest diffusion path from an HSC to a monocyte. **b**, For a focused plasma cell, UMAP distance
against multiscale diffusion distance to every other cell (Spearman ρ = 0.62), with 265 cells near
on the UMAP but far in diffusion space (orange) and 392 the reverse (blue). **c**, The same groups
on the UMAP. **d**, A connectome as a cells × cells matrix: *C. elegans* neuron classes on a UMAP of
their transcriptomes, coloured by the focused class AVA's row of chemical synapses. The tutorial
{doc}`../tutorials/cell-similarity` builds panels a to c in AnnZarro on `bm_aging_showcase.zarr`;
panel d uses its own store ({ref}`cell-by-cell-connectome`).

| Panel | In AnnZarro | Tutorial section |
|---|---|---|
| a | live: `obsp/diffusion_walk_t5` row as colour, four clicks in a table of the path cells (precomputed `fig3a_*` columns) | {ref}`tut-cell-walk` |
| b | live axes: rows of `obsp/umap_distance` and `obsp/diffusion_distance`; precomputed colour `fig3_plasma_groups` | {ref}`tut-cell-distance-axes` |
| c | UMAP coloured by `fig3_plasma_groups` | {ref}`tut-cell-groups-umap` |
| counts (265, 392, cell types) | table filters | {ref}`tut-cell-check` |
| d | live: `obsp/chemical_synapses` row of the focused class as a log colour | {ref}`cell-by-cell-connectome` |

(cell-by-cell-differences)=
## Differences from the paper figure

This section covers panels a to c; panel d has its own list below.

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
```{literalinclude} ../_static/panelsets/paper/cell-by-cell-walk.url.txt
:language: text
```
::::

::::{dropdown} Panels b and c (opens at the plasma cell)
```{literalinclude} ../_static/panelsets/paper/cell-by-cell-umap-vs-diffusion.url.txt
:language: text
```
::::

Panel sets: {download}`cell-by-cell-walk.json <../_static/panelsets/paper/cell-by-cell-walk.json>`,
{download}`cell-by-cell-umap-vs-diffusion.json <../_static/panelsets/paper/cell-by-cell-umap-vs-diffusion.json>`.
View JSON: {download}`cell-by-cell-walk.view.json <../_tools/views/cell-by-cell-walk.json>`,
{download}`cell-by-cell-umap-vs-diffusion.view.json <../_tools/views/cell-by-cell-umap-vs-diffusion.json>`.
Loading one restores the dataset, the focus and the split layout, like the links ({ref}`tut-tour-load-file`).

Screenshots and views are made by `docs/_tools/shoot_figs13.py`; the paper's numbers are in
`figures/numbers/fig2.json` of the paper repository.

(cell-by-cell-connectome)=
## A connectome as a cells × cells matrix

Panel d puts a different kind of cells × cells matrix behind the same click: the wiring of the
*C. elegans* hermaphrodite nervous system {cite:p}`varshney2011`. Each point is a neuron class,
placed on a UMAP of its CeNGEN transcriptome {cite:p}`taylor2021`, and the colour is the focused
class's row of `obsp/chemical_synapses`: the number of chemical synapses it sends to every other
class. The view opens on AVA, the command interneuron for backward locomotion.

1. **Build the store.** In the paper repository, run `python data_prep/neuro_demo.py` in an
   environment with anndata, scanpy, pyreadr, openpyxl and xlrd. It downloads every input from its
   public source, checks each file's sha256, and writes
   `data/neuro_demo/celegans_connectome_cengen.zarr` (7.7 MB; 112 neuron classes × 13,669 genes).
2. **Start AnnZarro on that folder:** `annzarro start --data-dir data/neuro_demo`.
3. **Open the link** below. If your server is not at `http://127.0.0.1:8000`, see
   {ref}`tut-start-links`.

::::{dropdown} Panel d: chemical synapses from the focused class (opens at AVA)
```{literalinclude} ../_static/panelsets/paper/cell-by-cell-connectome.url.txt
:language: text
```
::::

::::{dropdown} The same view with gap junctions (`obsp/gap_junctions`)
```{literalinclude} ../_static/panelsets/paper/cell-by-cell-connectome-gap.url.txt
:language: text
```
::::

Panel sets: {download}`cell-by-cell-connectome.json <../_static/panelsets/paper/cell-by-cell-connectome.json>`,
{download}`cell-by-cell-connectome-gap.json <../_static/panelsets/paper/cell-by-cell-connectome-gap.json>`.

```{figure} ../_static/screens/paper/connectome.png
:class: screenshot
:alt: Neuron classes on a UMAP, most in grey; the focused class AVA is a red dot on the left, and the darkest blue points sit in the small separate cluster of ventral cord motor neurons on the right.

The link in AnnZarro: chemical synapses from AVA, log colour scale. Classes that receive none are
grey.
```

**What to look for.** AVA's strongest targets are the ventral cord motor neurons VA (82 synapses),
DA (78) and AS (62), which sit in their own cluster at the right of the UMAP; together they receive
76% of the 293 chemical synapses AVA sends to other classes. The next is the interneuron PVC (28). Click VA to see its own
row, or type AVB into **Focused Cell** to compare the command interneuron for forward locomotion
with AVA.

**The unit is a neuron class, not a neuron.** CeNGEN measures expression per neuron class, so each
point is a class, and its synapse counts are summed over the class's neurons: left and right
partners (AVAL and AVAR), and the members of the motor neuron classes along the cord. Differences
between the two sides, or along the cord, are summed away.

**Licence.** The store combines the Varshney et al. connectome from WormAtlas (CC BY), the CeNGEN
tables of the `cengenDataSC` package (GPL-3.0) and neurotransmitter identities from Wang et al.
{cite:p}`wang2024nt` (CC BY 4.0). Because of the CeNGEN tables, a shared copy of the store is
GPL-3.0, together with the script that builds it. The more complete connectome of Cook et al.
(2019) was not used: its files carry no licence that allows redistribution.

### Settings and differences from panel d

The view is a Cell Plot with X and Y `obsm` `X_umap` 0 and 1, colour `obsp` `chemical_synapses`
(the focused cell's row), **Log** on with floor 0.5, reversed `Blues`, **Strong on top** and
**Highlight Focused Cell** on, and **Equal aspect** on. It is made by
`docs/_tools/shoot_connectome.py`.

- **Classes with no synapse.** Under **Log**, every value at or below the floor shares the lowest
  colour. With the default floor, the smallest positive value (here 1), the 94 classes that
  receive nothing would share a colour with the three that receive one synapse (AVH, ADE, RIG). A
  floor of 0.5 keeps them apart: zeros take the lowest colour, a light grey in reversed `Blues`, and
  one synapse is already pale blue. The paper draws zeros in a separate grey and slightly smaller.
- **Colour range.** Under **Log** the range is in log10 units. The view leaves it to the data
  (0.5 to 82, that is −0.30 to 1.91). To pin the paper's 1 to 82, set **Min** 0 and **Max** 1.914,
  with zeros then clipped to the lowest colour as well.
- **Colour map.** Plotly's `Blues`, reversed, runs from light grey to a saturated royal blue; the
  paper's map runs from pale sky blue to navy. The colour bar is labelled at 1 and 10, the paper's
  at 1, 3, 10, 30 and 80.
- **AVA itself.** AVA sends 3 synapses to its own class (AVAL to AVAR). The paper sets that value to
  0; AnnZarro keeps it, but the focused class is drawn as the large red marker of **Highlight
  Focused Cell**, so its colour is not seen. The paper draws a ring instead.
- **Labels.** The paper labels the focus, PVC and the motor neuron classes. AnnZarro has no text
  labels on plots; hover over a point for its class and value.
- **Extent.** The paper leaves room below the UMAP for its labels; the app fits the axes to the
  points.
