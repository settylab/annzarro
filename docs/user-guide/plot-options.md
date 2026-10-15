# Plot Options

**Plot Options** (a button in a plot panel's controls) sets how the plot looks on screen and in an
export. It never changes what the plot shows. Its settings belong to the panel: they are kept in
panel sets and share links, and a link written before an option existed draws the default.

```{figure} ../_static/screens/user-guide/plot-options-menu.png
:class: screenshot
:width: 35%
:alt: The Plot Options menu with nine groups: Presets, Appearance, Axes and ticks, Points, Legend and colour bar, Text, Margins, Export (open, with the format buttons and size), Apply to other panels.

Plot Options. Every group starts folded except Export. A group opens and folds with a click, and the menu opens again as you left it.
```

## Presets

- **Publication** sets a white background and black text and axes (kept in either app theme), no grid or zero lines, tick marks with about five
  ticks per axis, larger text (16 px) and axis lines, a tighter margin and a shorter colour bar
  with five ticks. It does not touch the scale bar.
- **Default** returns every look setting to what a new plot has, the scale bar off included, and
  lets every colour follow the app theme again.
  What the plot shows and the Not in table group stay.

A preset is a starting point: change anything afterwards.

(plot-colours-theme)=
## Plot colours and the app theme

The plot's background, grid, axis lines, zero lines, text, 3D backdrop and the grey of the Not in
table points follow the app's light or dark theme ({ref}`colour-theme`), **for every colour you
have not set**. This is the rule:

- A colour you choose (a colour box in Plot Options), or a plot theme button you press, is
  **kept** when the app theme changes. The plot's other colours keep following.
- **Appearance > Plot colours** has three buttons. **Follow app theme** releases every colour so the
  plot follows the theme again. **Light colours** and **Dark colours** set the colours of that
  palette and keep them in either app theme.
- Each colour's **Reset** releases that one colour (it is greyed out while the colour already
  follows). The colour box always shows the colour on screen.
- The scale bar takes the text colour, so it follows the theme until you set the text colour.
- Only the colours you set are stored in panel sets and share links, so a link opens in the
  theme of whoever opens it, with your colours where you set them. A link saved by an earlier
  version stored every colour; a colour in it that equals the old light default counts as not set
  (it looks the same in the Light theme and follows the theme in the Dark one), any other colour
  stays as saved, including what the old **Dark Theme** button set.
- Colours of the data (palettes, colour scales) do not change with the theme.

An export uses the colours on screen. For a figure in a paper, switch to Light (or press
**Publication**) before exporting.

## Axes and ticks

Grid, axis titles, axis lines, zero lines, line widths and the axis and zero-line colours, as
before, plus:

- **Show Tick Labels** and **Show Tick Marks** are independent. (A link written before tick marks
  had a switch of their own hides the marks with the labels until you set them here.)
- **Ticks per axis** asks for about that many ticks on each axis (2 to 30). Empty is automatic.
  Plotly treats it as a hint and picks round values near it.
- **Scale bar** (off by default) draws a bar with a label such as `200` in a corner of the plot.
  The length is the round number (1, 2 or 5 times a power of ten) of coordinate units nearest a
  fifth of the width in view, so it gets shorter as you zoom in and is redrawn when the panel is
  resized. **Size** scales the bar's length together with its line and label. **Unit** is an
  optional text after the number (for example `µm`) for when the coordinates are in known units.
  A scale bar is only true when a unit is as long on y as on x, so it needs **Equal aspect** (the
  panel's button) and a 2D plot; otherwise its controls are greyed out and say why. Turning Equal
  aspect off switches the scale bar off, and turning it back on does not bring the bar back. The
  bar is part of an export. See {doc}`spatial-coordinates`.

## Points

The **Not in table** group sets how the grey points of a table filter look: their **size** as a
multiple of the size they get automatically from their own count (1x), their **opacity** (empty
is automatic) and their **colour**. They get no legend entry. See {doc}`tables-and-filters`.

## Legend and colour bar

Show or hide the legend and choose its side. The **colour bar** (for a numerical colour) has its
own position (right, left, top, bottom, or **with the legend**, the default), a **length** from
10 to 100 % of the plot's height (or width when horizontal) and a **tick count** (2 to 30, empty
is automatic).

## Text and margins

Font, size and colour. **Margins** is one slider for all four sides, in pixels. **Set each side
separately** shows a box per side; switching it off again sets all four to the top value.

## Export

The format buttons and the export size, as in {doc}`export`.

## Apply to other panels

**Apply to other panels** copies this plot's look (colours, axes, ticks, text, margins, legend,
colour bar, scale bar, Not in table, export size) to every other plot of the same kind: cell plots
to cell plots, gene plots to gene plots. The menu asks first (**Apply** or **Cancel**) and then
says how many plots it changed. Axes, colour columns, table filters, subsets, point size and
opacity, Equal aspect and the title are not copied.

## Large plots

A plot with more than about a million cells is drawn in large-plot mode ({ref}`large-plot-mode`).
Presets, ticks, margins, the scale bar, the colour bar options and the text and colour settings of
the graph work there as usual. The Not in table group has nothing to style there: a large plot cannot be
filtered by a table.
