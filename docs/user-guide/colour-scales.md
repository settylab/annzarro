# Colour scales

When a plot is coloured by numbers (an expression value, a fold change, a kernel row), the colour
map and its range decide what you see. This page covers the colour map, the Min and Max of the
range, centring at zero, reversing, a log scale, drawing order, locking a range so that two
panels or two focus states share one scale, and what happens to values outside the range and to
missing values. Categorical colour
is covered in {doc}`cell-and-gene-plots`.

The numerical colour controls appear in a panel's controls once its colour is numerical.

```{figure} ../_static/screens/user-guide/colour-controls.png
:class: screenshot
:alt: Numerical colour controls with twelve numbered parts: Color Map drop-down, Min slider and box, Max slider and box, Center at 0, Reverse Colormap, Lock Range, Hide Outliers, Hide NaN, Equal aspect, Strong on top, Log and the floor box.

Numerical colour controls of the fold-change panel.
```

1. **Color Map**: Greys, YlGnBu, Greens, YlOrRd, Bluered, RdBu, Reds, Blues, Picnic, Rainbow,
   Portland, Jet, Hot, Blackbody, Earth, Electric, Viridis, Cividis, Inferno, Magma, Plasma.
   A new panel uses Portland unless the server sets another default (`ui.defaults.color_scale`,
   {doc}`../reference/configuration`).
2. **Min**: slider and number box for the value drawn in the first colour of the map.
3. **Max**: the same for the last colour.

   The sliders move over **percentiles** of the coloured values, not over the value range: the
   middle of a slider is the median. For a skewed gene, where the 99th percentile may be 30 and
   the maximum 725, the useful values then fill the slider instead of its first 4%. A value
   repeated by many points (the zeros of a sparse gene) holds at most 2% of a slider. With
   **Center at 0** both sliders move over percentiles of the absolute values, Min mirroring Max.
   The number boxes and the saved settings keep values, not percentiles; a typed value outside
   the data puts the slider at its end. A column with a single value has nothing to slide over:
   its sliders are disabled, the boxes still work.
4. **Center at 0** makes the range symmetric: Min = −m and Max = m, where m is the largest absolute
   value in the data.
5. **Reverse Colormap** flips the map end for end.
6. **Lock Range** keeps Min and Max fixed when the data change.
7. **Hide Outliers** removes points whose value lies outside Min to Max. The axes keep their range.
8. **Hide NaN** removes points with no value (also offered for categorical colours, where it
   removes the grey **NA** points). The axes keep their range.
9. **Equal aspect** gives x and y the same scale ({doc}`spatial-coordinates`).
10. **Strong on top** (on by default) draws the points with the largest absolute colour value
    last, so they are not hidden under weaker ones.
11. **Log** switches to a log10 colour scale.
12. **floor** is the smallest value the log scale shows; empty means the smallest positive value
    in the data.

The Min and Max boxes show 3 significant digits (0.0126, −1.03), and a value you type is used
exactly as typed: typing `0.004` in **Max** sets the colour bar's top to 0.004.

## Sequential or diverging

Pick a **sequential** map (Blues, Greys, Viridis, Cividis, Magma…) for values that run from
nothing to a lot, and a **diverging** map (RdBu, Picnic, Bluered) with **Center at 0** for signed
values, so that zero sits at the neutral middle colour.

```{figure} ../_static/screens/user-guide/colour-seq-div.png
:class: screenshot
:alt: Left, a diffusion walk from an HSC in reversed Blues, light grey at zero and dark blue at the highest value. Right, H2-Q7 fold change in RdBu centred at zero, blue for decrease, red for increase.

Left: sequential (Blues, reversed, 0 to 0.012). Right: diverging (RdBu, Center at 0, −1.03 to 1.03).
```

1. Open the panel's controls.
2. In **Color Map**, choose **Blues**. Plotly's Blues runs from dark to light, so click **Reverse
   Colormap** to draw zero in the light colour and large values in dark blue.
3. For the fold change, choose **RdBu** and click **Center at 0**. Min and Max become −1.03 and
   1.03 for H2-Q7.

Both views are in {download}`userguide-colour-seq-div.json <../_tools/views/userguide-colour-seq-div.json>`.

## Fix the range

By default Min and Max follow the data: they are reset to the smallest and largest value whenever
the panel loads a new vector, for example when the focused gene changes. That makes each gene's
plot use its full colour range, but colours then mean different numbers for different genes.

1. Type a value in **Min** and **Max**, or drag the sliders.
2. Click **Lock Range**. The button turns blue. From now on, focusing another gene or cell keeps
   this range; only the points change colour.

Values outside the range are not dropped: they are drawn in the end colour of the map.

```{figure} ../_static/screens/user-guide/colour-range.png
:class: screenshot
:alt: Three fold-change UMAPs of H2-Q7. Left, full range -1.03 to 1.03. Middle, range -0.25 to 0.25: most cells saturate to dark red. Right, the same range with Hide Outliers: only 1,550 of 8,090 cells remain, with a notice and a Removed Datapoints box.

Left: range from the data. Middle: range fixed at −0.25 to 0.25; values beyond it take the end
colours. Right: the same range with Hide Outliers.
```

With **Hide Outliers** on, the right panel draws only the 1,550 of 8,090 cells whose fold change
lies between −0.25 and 0.25. The panel says so in a notice above the plot, and the **Removed
Datapoints** box in its lower left corner counts the removed points (here 6,540, 81 %). The axes
keep the range of all cells, so the panel lines up with the others. The view is
{download}`userguide-colour-range.json <../_tools/views/userguide-colour-range.json>`.

## Two panels on one scale

Locking the same Min and Max in two panels puts them on one scale, so a colour means the same
number in both. In {doc}`focus-and-lock` the two fold-change panels (one locked to H2-Q7, one
following the focused gene) both use RdBu from −1 to 1 with Lock Range on. To set this up:

1. In the first panel, type `-1` in **Min**, `1` in **Max**, click **Lock Range**.
2. Do the same in the second panel.

{ref}`tut-cg-shared-scale` in the tutorial {doc}`../tutorials/cells-and-genes` uses this to
compare Young and Old. There is no control that ties two panels' ranges together; each panel keeps its own numbers, and
they are saved with the panel in panel sets and share links (`colorMin`, `colorMax`,
`lockColorRange`).

## Log scale

Kernel rows, transition probabilities and counts often span several orders of magnitude; on a
linear scale everything but the top decade is one colour. Click **Log** to colour by log10 of the
value. Values at or below the **floor** (including zeros) take the floor's colour. Type a floor,
for example `1e-5`, or leave the box empty to use the smallest positive value.

```{figure} ../_static/screens/user-guide/colour-log.png
:class: screenshot
:alt: The HSC's diffusion walk row in Viridis. Left, linear: only a small patch near the HSC is not dark purple. Right, log with floor 1e-5: the walk's reach spreads in green and blue over the progenitor region, the colour bar runs from 1e-5 to 0.01.

The same diffusion walk row, linear (left) and log with floor 1e-5 (right). View:
{download}`userguide-colour-log.json <../_tools/views/userguide-colour-log.json>`.
```

## Drawing order: Strong on top

Points are drawn one over the other, so in a dense plot the last drawn decide what you see. With
**Strong on top** on (the default), AnnZarro draws the points with the largest absolute colour
value last. In the volcano plot below, the genes most correlated or anticorrelated with H2-Q7 sit
on top of the weakly correlated mass; with it off, the points are drawn in data order and strong
values are scattered under weak ones.

```{figure} ../_static/screens/user-guide/colour-strong-on-top.png
:class: screenshot
:alt: Two volcano plots coloured by Spearman correlation with H2-Q7. Left, Strong on top off: the dense centre is a mix of pale colours. Right, Strong on top on: saturated red and blue genes are visible on top of the centre.

Strong on top off (left) and on (right). View:
{download}`userguide-colour-strong-on-top.json <../_tools/views/userguide-colour-strong-on-top.json>`.
```

## Grey points and missing values

Several things can make a point grey, and they mean different things:

| What you see | Why |
|---|---|
| Light grey at the bottom of a reversed Blues (or Greys) map | the value is at or below Min, for example a cell the diffusion walk does not reach (5,675 of 8,090 cells in the HSC's row of `diffusion_walk_t5` are exactly 0) |
| Grey in the middle of RdBu | the value is near 0 |
| Flat grey `rgb(180, 180, 180)`, no colour bar entry | the point is not in the linked table ({doc}`tables-and-filters`) |
| Uniform grey `rgb(150, 150, 150)` | the colour is **None (constant)** |
| Dark grey `#444` in a numerical colour | the value is missing (NaN); Plotly draws missing colour values in this grey |
| Light grey under an **NA** legend entry | a missing value in a categorical colour ({doc}`cell-and-gene-plots`) |

Points whose **x** or **y** value is missing are never drawn; the **Removed Datapoints** box counts
them as "X-axis NaN" or "Y-axis NaN". Points with a missing **colour** value stay in the plot in
dark grey until you click **Hide NaN**, which removes them and adds a "Color NaN" count to the box.

```{tip}
Because grey can mean "zero", "near zero", "missing" or "not in the table", pick a colour map
without grey at the end you care about when you share a figure, or say in the legend which grey
is which. With RdBu and a linked table, genes with a value near 0 and genes outside the table are
both grey.
```

```{admonition} What happens on the server
:class: note
None of these controls send a request. Colour map, range, centring, reversing, log scale,
drawing order, locking and hiding all work on the vector the browser already holds.
```
