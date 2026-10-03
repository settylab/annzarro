# Export

There are three ways to get a figure or numbers out of AnnZarro: the camera button of a plot
(a quick PNG), the **Export** section of **Plot Options** (PNG, JPEG, WEBP or SVG at a size you
choose) and **Export CSV** of a table. Because AnnZarro is read-only and keeps no state of its
own, every exported plot can also be rebuilt later from its panel set or share link, or
recomputed from the store in Python.

## Quick PNG from the camera button

1. Move the pointer over the plot. Its toolbar appears at the top right.
2. Click the camera, **Download plot as a png** (1).

```{figure} ../_static/screens/user-guide/export-modebar.png
:class: screenshot
:width: 45%
:alt: The plot toolbar with the camera button outlined (1), followed by zoom, pan, zoom in, zoom out and reset.

The camera button (1) in a plot's toolbar.
```

The browser saves `annzarro_plot.png`, drawn at 1200 × 800 and scaled by 2: the file is
2400 × 1600 pixels whatever the size of the tile.

## Choose format and size in Plot Options

1. Open the panel's controls and click **Plot Options**. A panel with appearance settings opens
   next to the button.
2. Scroll to **Export**.

   ```{figure} ../_static/screens/user-guide/export-plot-options.png
   :class: screenshot
   :width: 45%
   :alt: The lower part of Plot Options: Font, Margins, Legend, and Export with JPEG, SVG, WEBP and PNG buttons (PNG outlined, 1) and Dimensions Width 1200 (2) and Height 800 (3).

   Plot Options, Export section.
   ```

3. Set **Width** (2) and **Height** (3) in pixels (defaults 1200 and 800).
4. Click **JPEG**, **SVG**, **WEBP** or **PNG** (1). The file is called `plot_<date and time>`
   with that extension and has exactly the width and height you set (a 1000 × 1000 PNG for
   1000 and 1000).

The rest of **Plot Options** changes how the plot looks on screen and in the export: background
colour and a **Dark Theme**, grid, axis titles, tick labels, axis lines, zero lines, line widths
and colours, the font (Arial, Times New Roman, Courier, Georgia, Trebuchet MS, Verdana), its size
and colour, the margins, and whether and where the legend is shown. These settings
are part of the panel and are kept in panel sets and share links.

```{note}
Plots are drawn with WebGL (Plotly's `scattergl` and `scatter3d`) to stay responsive with many
points. In an **SVG** export the axes, labels, legend and colour bar are vector graphics, but the
points are embedded as a bitmap (an `<image>` in the SVG). For vector points, export the data and
draw the figure in Python (below).
```

## Export a table as CSV

**Export CSV** in a table's controls writes the rows that pass the table's filter, in the current
sort order, with all displayed columns at full precision ({doc}`tables-and-filters`).

## Reproduce a plot later

Every plot is fully described by its panel settings: the source of each axis and of the colour
(type, key, column), the colour map and range, locks, the linked table and its filter. To redraw
an exported figure:

- **In AnnZarro**: keep the {doc}`share link <share-links>` or save a {doc}`panel set <panel-sets>`
  (and **Export** it as JSON from the Load Panel Set dialog to keep a copy outside the server).
  Opening it on a server with the same dataset gives the same plot, which you can export again at
  another size or format.
- **In Python**: read the same slots from the store. For the fold-change UMAP of H2-Q7 used
  throughout this guide:

  ```python
  import matplotlib.pyplot as plt
  import numpy as np
  import zarr

  g = zarr.open_group("bm_aging.zarr", mode="r")
  umap = g["obsm/X_umap"][:]                                   # x = column 0, y = column 1
  genes = g["var/_index"][:]
  j = int(np.flatnonzero(genes == "H2-Q7")[0])
  fc = g["layers/kompot_de_Young_to_Old_fold_change"][:, j]   # colour = the gene's column
  m = np.abs(fc).max()                                         # "Center at 0"
  plt.scatter(umap[:, 0], umap[:, 1], c=fc, cmap="RdBu_r", vmin=-m, vmax=m, s=3)
  plt.colorbar(label="fold change (Young to Old), H2-Q7")
  plt.savefig("h2-q7_fold_change.svg")
  ```

  Plotly's `RdBu` puts blue at the low end, which matches matplotlib's `RdBu_r`. The panel
  settings in the view file ({download}`userguide-focus.json <../_tools/views/userguide-focus.json>`)
  name every slot such a script needs.

```{admonition} What happens on the server
:class: note
Nothing. All exports are drawn in the browser from the vectors it already holds.
```
