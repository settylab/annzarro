# Spatial coordinates

AnnZarro has no special spatial mode: spot or cell positions are an obsm matrix like any
embedding, so any two (or three) of its columns can be the axes of a cell plot. Everything else
works unchanged on top of them: colour by a gene, by a cell × cell kernel row of the focused spot,
click to focus, lock, link to a table.

This page uses `spatial_demo.zarr`: the 10x Genomics Visium dataset "Mouse Brain Serial Section 1
(Sagittal-Anterior)" (Space Ranger 1.1.0, CC BY 4.0), 2,693 spots × 2,000 highly variable genes,
prepared by `docs/_tools/make_spatial_demo.py`. It holds

- `obsm/spatial`: spot centres in full-resolution image pixels, with y growing downwards (the
  Space Ranger convention), and `obsm/spatial_upright`: the same positions as (x, −y), so the tissue
  is upright in a plot;
- `layers/log_normalized`: log-normalised expression (also in `X`; both are listed under the
  **layer** source);
- `obsp/spatial_kernel`: a dense Gaussian kernel on spot distance (σ = 200 µm, zero beyond 3σ, rows
  summing to 1) and `obsp/spatial_distance`: spot distances in µm;
- `obsm/X_umap` and `obs/leiden` from the expression data.

## Plot spots in tissue coordinates

1. Open `spatial_demo.zarr` in the **Dataset** picker and add a **Cell Plot**. It opens on the
   expression UMAP.
2. Open its controls. Set **X** to `obsm` → `spatial_upright` → `0` and **Y** to `obsm`
   → `spatial_upright` → `1`.
3. Set **Color** to `obs` → `leiden`.
4. Click **Equal aspect** (next to **Hide NaN** for a categorical colour, in the colour toolbar
   for a numerical one). One unit on x is now as long as one unit on y, so the section keeps its
   shape whatever the tile's proportions.

   ```{figure} ../_static/screens/user-guide/spatial-aspect.png
   :class: screenshot
   :alt: The Visium section coloured by Leiden cluster twice. Left, Equal aspect off: the section is stretched to the tall tile. Right, Equal aspect on: the y axis spans a wider range so that x and y have the same scale and the section keeps its shape.

   Equal aspect off (left) and on (right). View:
   {download}`userguide-spatial-aspect.json <../_tools/views/userguide-spatial-aspect.json>`.
   ```

5. Add three more cell plots the same way (split the tile, choose Cell Plot) and colour them as in
   the figure below.

```{figure} ../_static/screens/user-guide/spatial-overview.png
:class: screenshot
:alt: Four plots, three of them of the Visium section with equal aspect. Top left, spots in tissue coordinates coloured by Leiden cluster. Bottom left, the same spots coloured by Ttr expression. Top right, spots coloured by the spatial kernel row of the focused spot, a small blue disc around it. Bottom right, the same kernel row on the expression UMAP, where the disc's spots fall in a few clusters.

Tissue coordinates with three colour sources, and the kernel row on the expression UMAP.
```

- **Top left**: `obs` → `leiden`.
- **Bottom left**: `layer` → `log_normalized` → focused gene (Ttr).
- **Top right**: `obsp` → `spatial_kernel` → focused spot, colour map Blues, reversed: the
  spot's Gaussian neighbourhood in the tissue.
- **Bottom right**: the same kernel row with the expression UMAP as axes: where the tissue
  neighbours of the focused spot lie in expression space.

The view is {download}`userguide-spatial.json <../_tools/views/userguide-spatial.json>`
(open it with `spatial_demo.zarr`, {doc}`share-links`).

## Click a spot

Click any spot in the top-left plot. It becomes the focused spot: both kernel panels redraw around
it, and the focus marker moves in all four panels.

```{figure} ../_static/screens/user-guide/spatial-after-click.png
:class: screenshot
:alt: After clicking a spot in the middle of the section, the kernel disc in the top-right plot moved there, and the bottom-right UMAP shows its neighbours in another part of expression space.

After clicking a spot in the centre of the section.
```

```{admonition} What happens on the server
:class: note
The click sent one request, for the new spot's row of `obsp/spatial_kernel` (2,693 values). Both
kernel panels use that row; the browser fetched it once. The
Ttr panel did not change, because it depends on the focused gene.
```

## Notes on spatial data

- **Any obsm can be the axes.** Use the raw `spatial` positions, a registered coordinate system,
  or a 3D stack (x, y and section depth as three columns with **3D Plot**).
- **Image orientation.** If the tissue appears upside down, store the positions with y negated
  (as `spatial_upright` does here) when preparing the store; AnnZarro has no axis-flip control.
- **Aspect ratio.** Without **Equal aspect** the axes fill the tile and stretch the section to
  the tile's shape. **Equal aspect** is saved with the panel (`equalAspect`), in panel sets and
  share links. For an export, set the export width and height in proportion to the tile
  ({doc}`export`).
- **Kernels and distances.** A dense obsp matrix of spot neighbourhoods, like `spatial_kernel`,
  makes "what is near this spot" one click. How to compute and store such matrices is in
  {doc}`../data/pairwise-matrices`.
- **Lock** a kernel panel to keep one spot's neighbourhood while you click through others
  ({doc}`focus-and-lock`).
