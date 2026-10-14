# Plot Options

**Plot Options** (a button in a plot panel's controls) sets how the plot looks on screen and in an
export. It never changes what the plot shows. Its settings belong to the panel: they are kept in
panel sets and share links, and a link written before an option existed draws the default.

```{figure} ../_static/screens/user-guide/plot-options-menu.png
:class: screenshot
:width: 35%
:alt: The Plot Options menu with nine folded groups: Presets (open, with Publication and Default buttons), Appearance, Axes and ticks, Points, Legend and colour bar, Text, Margins, Export, Apply to other panels.

Plot Options. A group opens and folds with a click, and the menu opens again as you left it.
```

## Presets

- **Publication** sets a white background, no grid or zero lines, tick marks with about five
  ticks per axis, larger text (16 px) and axis lines, a tighter margin and a shorter colour bar
  with five ticks. If a scale bar is set up (a unit or a scale other than the defaults) and
  **Equal aspect** is on, the preset switches it on too.
- **Default** returns every look setting to what a new plot has. What the plot shows, the scale
  bar's unit and scale, and the Not in table group stay.

A preset is a starting point: change anything afterwards.

## Axes and ticks

Grid, axis titles, axis lines, zero lines, line widths and the axis and zero-line colours, as
before, plus:

- **Show Tick Labels** and **Show Tick Marks** are independent. (A link written before tick marks
  had a switch of their own hides the marks with the labels until you set them here.)
- **Ticks per axis** asks for about that many ticks on each axis (2 to 30). Empty is automatic.
  Plotly treats it as a hint and picks round values near it.
- **Scale bar** draws a bar with a label such as `200 µm` in a corner of the plot. Say what one
  coordinate unit is in the box (**1 coordinate =** a number and a unit label, for example `0.65`
  and `µm`). The length is the round number (1, 2 or 5 times a power of ten) nearest a fifth of
  the width in view, so it gets shorter as you zoom in and is redrawn when the panel is resized.
  Choose its corner below. A scale bar is only true when a unit is as long on y as on x, so it
  needs **Equal aspect** (the panel's button) and a 2D plot; otherwise its controls are greyed
  out and say why. The bar is part of an export. See {doc}`spatial-coordinates`.

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
