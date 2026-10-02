# Fig. 7: slot map

```{figure} ../_static/figures/paper/fig7.png
:alt: AnnData slot map with the focused cell as a horizontal band and the focused gene as a vertical band.
:width: 100%

Paper Fig. 7. An AnnData object laid out around its cells × genes matrix. A click on a cell
selects one row (blue) of every cell-indexed array; a click on a gene selects one column
(orange) of every gene-indexed array. AnnZarro fetches only these slices.
```

Every view reads one AnnData slot, and each click reads one slice of it. What to store in
each slot, and what the demonstration store contains, is in {doc}`../data/slot-map`. Choosing
a slot for a plot's axes or colour (the type, key and column dropdowns) is in
{doc}`../user-guide/cell-and-gene-plots`. The `layer` type lists `X` first, then the arrays
under `layers/`, so the main matrix is a source like any layer.

The panels below put each slot on screen once on `bm_aging.zarr`, with the focused cell
`HSPC_Old_1#GAAGCCCGTGGCTCTG-1` and the focused gene `H2-Q7`. The settings of each are in
`docs/_tools/views/fig7-*.json` and `docs/_tools/shoot_figs79.py`.

::::{grid} 1 2 2 2
:gutter: 2

:::{grid-item}
```{figure} ../_static/screens/paper/slot-obsm-obs.png
:class: screenshot
:alt: UMAP coloured by cell type with the stored category colours.

**obsm, obs, uns.** X/Y `obsm` `X_umap`; Color `obs` `highres_celltype`, colours from
`uns['highres_celltype_colors']`.
```
:::

:::{grid-item}
```{figure} ../_static/screens/paper/slot-obs-axes.png
:class: screenshot
:alt: Cells plotted by their young and old Kompot log density, coloured by log fold change.

**obs as axes.** X `obs` `kompot_da_Young_log_density`, Y `obs` `kompot_da_Old_log_density`;
Color `obs` `kompot_da_Young_to_Old_lfc`.
```
:::

:::{grid-item}
```{figure} ../_static/screens/paper/slot-obsp.png
:class: screenshot
:alt: UMAP in grey with a blue patch around the focused stem cell.

**obsp row.** Color `obsp` `diffusion_walk_t5`, "Focused cell …": the focused cell's row.
```
:::

:::{grid-item}
```{figure} ../_static/screens/paper/slot-layer-gene.png
:class: screenshot
:alt: UMAP coloured by the Young to Old fold change of H2-Q7.

**layer column.** Cell Plot, Color `layer` `kompot_de_Young_to_Old_fold_change`, "Focused
gene H2-Q7".
```
:::

:::{grid-item}
```{figure} ../_static/screens/paper/slot-layer-cell.png
:class: screenshot
:alt: Kompot volcano coloured by each gene's fold change in the focused cell.

**layer row, var axes.** Gene Plot, X/Y `var` Kompot mean LFC and Mahalanobis distance;
Color `layer` fold change, "Focused cell …".
```
:::

:::{grid-item}
```{figure} ../_static/screens/paper/slot-varm.png
:class: screenshot
:alt: Genes plotted by their PC1 and PC2 loadings.

**varm.** X/Y `varm` `PCs` `0` and `1`; Color `var` Mahalanobis distance. The 12,214 genes
outside the PCA have zero loadings and sit at the origin.
```
:::

:::{grid-item}
```{figure} ../_static/screens/paper/slot-varp.png
:class: screenshot
:alt: Kompot volcano coloured by Spearman correlation to H2-Q7.

**varp row.** Color `varp` `spearman_fold_change`, "Focused gene H2-Q7", range locked at
−1 to 1.
```
:::
::::
