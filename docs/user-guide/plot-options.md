# Plot Options

**Plot Options** (a button in a plot panel's controls) sets how the plot looks on screen and in an
export. It never changes what the plot shows. Its settings belong to the panel: they are kept in
panel sets and share links, and a link that lacks an option draws that option's default.

The menu has nine groups, described below in the order the menu shows them. A group opens and
folds with a click, and the menu opens again as you left it. Only **Presets** is open the first
time.

```{figure} ../_static/screens/user-guide/plot-options-menu.png
:class: screenshot
:width: 35%
:alt: The Plot Options menu with nine folded groups: Presets (open, with Publication and Default buttons), Appearance, Axes and ticks, Points, Legend and colour bar, Text, Margins, Export, Apply to other panels.

Plot Options with its nine groups.
```

## Recipes

**A figure for a paper**

1. Click **Publication** in **Presets**.
2. In **Axes and ticks**, set **Ticks per axis** if five is not what you want. For spatial or
   embedding coordinates, switch on **Equal aspect** (the panel's button) and then **Scale bar**.
3. In **Margins**, adjust the margin if the labels are cut off or there is too much white.
4. In **Export**, set **Width** and **Height** and click **SVG** or **PNG** ({doc}`export`).

**All panels look the same**

Set one plot up, then open **Apply to other panels** and click it, then **Apply**. Every other
plot of the same kind takes the look. Do this after the look is final: it replaces theirs.

**A dark plot**

In **Appearance**, click **Dark Theme**. **Light Defaults** goes back.

## Presets

- **Publication** sets a white background, no grid and no zero lines, tick marks with about five
  ticks per axis, text of 16 px, axis lines of 1.5 px, margins of 70 px left and right, 40 px
  top and 60 px bottom, and a colour bar 60 % long with five ticks. It also resets the
  colours, the legend position and the other look settings to those of a new plot. It does not
  touch the scale bar, the font, the **Points** group or the export size.
- **Default** returns the look settings to what a new plot has: colours, grid, axes, tick count,
  text size, line widths, margins, legend, colour bar, and the scale bar's switch and corner
  (the scale bar goes off). The font, the scale bar's size and unit, the **Points** group, the
  export size, and what the plot shows stay.

A preset is a starting point: change anything afterwards.

## Appearance

- **Background** colour, with **Reset**.
- **3D Backdrop** (3D plots only): **Show** and the backdrop colour, with **Reset**.
- **Apply Color Theme**: **Light Defaults** sets the background, grid, axis, text and zero-line
  colours (and the 3D backdrop colour) to those of a new plot. **Dark Theme** sets them to a dark
  background with light axes and text. Neither changes anything else.

## Axes and ticks

```{figure} ../_static/screens/user-guide/plot-options-axes.png
:class: screenshot
:width: 35%
:alt: The Axes and ticks group open, from Show Grid down to the Scale bar switch, its Size slider at 100 % and the Unit box.

Axes and ticks, with the scale bar on.
```

In the order of the menu:

- **Show Grid** and **Grid Color**.
- **Show Axis Titles**, **Show Tick Labels**, **Show Axis Lines** and **Show Zero Lines**.
- **Line Widths** of the axis, the grid and the zero lines (0.1 to 10 px).
- **Axis Color** and **Zero Line Color**, each with **Reset**.
- **Show Tick Marks** is independent of **Show Tick Labels**. Until you set it, the marks follow
  the labels.
- **Ticks per axis** asks for about that many ticks on each axis (2 to 30). Empty is automatic.
  Plotly treats it as a hint and picks round values near it.
- **Scale bar** (off by default) draws a bar with a label such as `200` in a corner of the plot.
  The length is the round number (1, 2 or 5 times a power of ten) of coordinate units nearest a
  fifth of the width in view, so it gets shorter as you zoom in and is redrawn when the panel is
  resized. The bar and its label take the text colour. **Size** (25 to 400 %, 100 % by default)
  scales the bar's length together with its line and label. **Unit** is an optional text after
  the number (up to 20 characters, for example `µm`) for when the coordinates are in known
  units. The corner list offers bottom right (the default), bottom left, top right and top left.
  A scale bar is only true when a unit is as long on y as on x, so it needs **Equal aspect** (the
  panel's button) and a 2D plot; otherwise its controls are greyed out and say why. Turning Equal
  aspect off switches the scale bar off, and turning it back on does not bring the bar back. The
  bar is part of an export. See {doc}`spatial-coordinates`.

## Points

The **Points** group sets how the grey points of a table filter (**Not in table**) look. They get
no legend entry. See {doc}`tables-and-filters`.

- **Size** is a multiple of the size they get automatically from their own count (0.1 to 20,
  `x auto`; 1 by default).
- **Opacity** (0.01 to 1). Empty is automatic.
- **Color**, grey by default, with **Reset**.

## Legend and colour bar

- **Show Legend** and **Legend Position** (right, left, top or bottom).
- **Colour bar**, for a numerical colour, has its own **position** (right, left, top, bottom, or
  **with the legend**, the default, which follows **Legend Position**), a **Length** from 10 to
  100 % of the plot's height (or width when horizontal; 100 % by default) and **Ticks**, the
  tick count (2 to 30; empty is automatic).

## Text

**Font** (Arial, Times New Roman, Courier, Georgia, Trebuchet MS or Verdana), **Size** (8 to
24 px; 12 by default) and **Color**, with **Reset**.

## Margins

One slider and number box set all four sides in pixels (0 to 200). A new plot has 80 px left,
right and top and 60 px at the bottom; the slider shows the top value, and moving it sets all
four sides to it. **Set each side separately** shows a box for **Top**, **Bottom**, **Left** and
**Right**; switching it off again sets all four to the top value. **Reset Margins** restores the
defaults.

## Export

The **JPEG**, **SVG**, **WEBP** and **PNG** buttons, and **Width** and **Height** in pixels (100
to 5000; 1200 by 800 by default), as in {doc}`export`.

## Apply to other panels

**Apply to other panels** copies this plot's look to every other plot of the same kind: cell
plots to cell plots, gene plots to gene plots. The look is the colours, axes, ticks, text, line
widths, margins, legend, colour bar, scale bar, **Points** group and export size. The menu asks
first (**Apply** or **Cancel**) and then says how many plots it changed; with no other plot of
the kind it says so instead.

Axes, colour columns, table filters, subsets, point size and opacity, Equal aspect and the title
are not copied. A plot without Equal aspect does not take the scale bar: it stays off there.

## Large plots

A plot with more than about a million cells is drawn in large-plot mode ({ref}`large-plot-mode`).
Presets, **Apply to other panels**, tick marks and count, margins, the scale bar and the colour
bar options (position, length, ticks) work there as usual. The **Points** group has nothing to
style there: a large plot cannot be filtered by a table.
