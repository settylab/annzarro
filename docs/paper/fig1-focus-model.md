# Fig. 1 · The focus model

```{figure} ../_static/figures/paper/fig1.png
:alt: Diagram. The focused cell selects its row of cells x cells (obsp) and of cells x genes (X and layers); the focused gene selects its column of cells x genes and its row of genes x genes (varp). Each row or column colours a cell scatter or a gene scatter. A server band at the bottom reads only the chunks that hold that row or column.
:width: 100%

Fig. 1 of the AnnZarro paper (Otto, Baasri and Setty, in preparation), drawn in TikZ
(`manuscript/figures/fig1_focus_model.tex` in the paper repository).
```

The focused cell selects rows of the cells × cells and cells × genes matrices; the focused gene
selects a column of cells × genes and a row of genes × genes. Each scatter is coloured by the
selected vector, and clicking a point moves the focus. The figure is a diagram; the tutorial
{doc}`../tutorials/tour` builds it as a live 2 × 2 layout on `bm_aging.zarr`, one panel per
arrow that ends in a scatter, and moves the focus through it.

| Part of the diagram | In AnnZarro | Tutorial section |
|---|---|---|
| focused cell → cells × cells (obsp) → cell scatter | live: `obsp/diffusion_walk_t5` row as colour | {ref}`tut-tour-cell-row` |
| focused cell → cells × genes → gene scatter | live: the cell's row of `layers/kompot_de_Young_to_Old_fold_change` | {ref}`tut-tour-four-arrows` |
| focused gene → cells × genes → cell scatter | live: the gene's column of the same layer | {ref}`tut-tour-four-arrows` |
| focused gene → genes × genes (varp) → gene scatter | live: `varp/spearman_fold_change` row as colour | {ref}`tut-tour-four-arrows` |
| clicking a point moves the focus | live | {ref}`tut-tour-clicks`, {ref}`tut-tour-four-arrows` |
| (not drawn) lock one panel while the focus moves | live | {ref}`tut-tour-lock` |
| server reads only the chunks of that row or column | not shown in the app | {doc}`fig9-performance` |

## Differences from the paper figure

- **The server band** ("reads only the chunks holding that row or column") has no on-screen
  counterpart. Each click costs one request per recoloured panel, visible in the browser's
  developer tools (Network tab); {doc}`fig9-performance` measures bytes and time per click.
- **Spatial coordinates.** The diagram's cell scatter says "embedding, spatial"; the tutorial uses
  the UMAP. Any obsm matrix, including spatial positions, works as axes the same way
  ({doc}`../user-guide/spatial-coordinates`).
- **Lock** is not in the diagram but is part of the same model: a locked panel keeps its slice
  while the focus moves on.

## Views

Replace `/path/to/annzarro-data` with the absolute path of your data directory and the host with
your server's ({doc}`../user-guide/share-links`).

::::{dropdown} The four panels of the focus model
```{literalinclude} ../_static/panelsets/paper/fig1-focus-model.url.txt
:language: text
```
::::

Panel set: {download}`fig1-focus-model.json <../_static/panelsets/paper/fig1-focus-model.json>`;
view JSON: {download}`fig1-focus-model.view.json <../_tools/views/fig1-focus-model.json>`.
Loading it restores the dataset, the focus and the split layout, like the link
({ref}`tut-tour-load-file`).
