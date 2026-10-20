# Plot Options

**Plot Options** (a button in a plot panel's controls) sets how the plot looks on screen and in an
export. It never changes what the plot shows. Its settings belong to the panel: they are kept in
panel sets and share links, and a link that lacks an option draws that option's default.

The menu has ten groups, described below in the order the menu shows them. A group opens and
folds with a click, and the menu opens again as you left it. Only **Export** is open the first
time.

```{figure} ../_static/screens/user-guide/plot-options-menu.png
:class: screenshot
:width: 35%
:alt: The Plot Options menu with ten groups: Presets, Background, Axes and ticks, Points, Focused cell, Legend and colour bar, Text, Margins, Export (open, with the format buttons and size), Apply to other panels.

Plot Options with its ten groups. Every group starts folded except Export.
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

**Every plot looks the same, and stays so**

(session-default-style)=
Set one plot up, open **Apply to other panels** and click **Make this the session default** (the
section shows **On Default** or **Own style**). That look is now what **Default** means for this
session, for plots of the same kind (cell plots and gene plots each have one).

- **A plot is on Default** when it was made from the chooser (a new plot, a split, the bottom of the
  page, a duplicate of a plot on Default) or when you pressed the **Default** preset on it. A plot on
  Default follows the session default: those open now take it when you set it, and take the new look
  whenever you change it. A plot whose look you changed in Plot Options, copied with **Apply to other
  panels**, or set with another preset has a look of its own and does not move. Pressing **Default**
  on it puts it back on Default. The section says which one a plot is, in those two words.
- **Default** is the built-in look when there is no session default, and the session default when
  there is one; the tooltip of the preset says which.
- **Reset to built-in default**, under the button, ends the session default: plots on Default go back to the
  built-in look. So does **Close all** with **Also clear everything this site stored in this browser**
  ticked; without the tick the default stays.
- The default is the same look **Apply to other panels** copies (colours, axes, ticks, text, margins,
  legend, colour bar, scale bar, Not in table, the focused marker and the export size), never what
  the plot shows. A colour you left on the app theme stays on it. The scale bar still needs Equal
  aspect, so it shows only on a plot that has it. A look that is the built-in one is no default. A default set while no panel is open is not kept over a reload in a fresh tab.
- A plot saved on Default (in a panel set, the autosave or a share link) opens on Default, and
  follows the default of the session it opens in. The session carries the default with it: a reload of
  the tab keeps it (the tab's session storage; a new tab starts without one), and the autosave, a
  share link and a saved panel set hold it ({ref}`panelsets-session-style`,
  {doc}`share-links`). A plot saved before this existed has a look of its own.

**A dark plot**

The plot follows the app's light or dark theme by itself. To keep one look in either theme, press
**Publication** (a white figure), or choose the colours you want: a colour you choose stays as it
is in either theme, and its **Reset** hands it back to the theme.

## Presets

- **Publication** sets a white background and black text and axes (kept in either app theme), no grid and no zero lines, tick marks with about five
  ticks per axis, Arial at 16 px, axis lines of 1.5 px, margins of 70 px left and right, 40 px
  top and 60 px bottom, and a colour bar 40 % long with three ticks. It also resets the
  legend position and the other look settings to those of a new plot. It does not
  touch the scale bar, the **Points** and **Focused cell** groups or the export size.
- **Bare** draws only the points, for figures and overlays: no margins (the plot fills the whole panel),
  legend, colour bar or scale bar, and no axes (lines, ticks, labels, titles), grid or zero lines; in 3D no
  axes, grid or background planes either. Background colour, point colours, size and opacity, and what
  the plot shows stay. **Default** undoes it.
- **Default** puts the plot on Default ({ref}`the session default <session-default-style>`): the built-in look, or the
  session default when one is set, with every colour following the app theme again. It resets the whole look
  that **Apply to other panels** copies: grid, axes, tick count, font and text size, line widths, margins,
  legend, colour bar, the scale bar, **Not in table**, **Focused cell** and the export size. What the plot
  shows, and the **Points** size and opacity, stay.

A preset is a starting point: change anything afterwards.

(plot-colours-theme)=
## Plot colours and the app theme

The plot's background, grid, axis lines, zero lines, text, 3D backdrop, the grey of the Not in
table points and the fill and edge of the focused marker follow the app's light or dark theme ({ref}`colour-theme`), **for every colour you
have not set**. This is the rule:

- A colour you choose (a colour box in Plot Options), or the **Publication** preset, is
  **kept** when the app theme changes. The plot's other colours keep following.
- Each colour's **Reset** releases that one colour (it is greyed out while the colour already
  follows). The colour box always shows the colour on screen.
- The scale bar takes the text colour, so it follows the theme until you set the text colour.
- Only the colours you set are stored in panel sets and share links, so a link opens in the
  theme of whoever opens it, with your colours where you set them. A link saved by an earlier
  version stored every colour; a colour in it that equals the old light default counts as not set
  (it looks the same in the Light theme and follows the theme in the Dark one), any other colour
  stays as saved, including a whole dark palette an earlier version pinned.
- Colours of the data (palettes, colour scales) do not change with the theme.

An export uses the colours on screen. For a figure in a paper, switch to Light (or press
**Publication**) before exporting.

## Background

What is drawn behind the data.

- **Colour** of the plot background, with **Reset**.
- **3D Backdrop** (3D plots only): **Show** and the backdrop colour, with **Reset**.

Both follow the app theme until you set them ({ref}`how plots follow the app theme <plot-colours-theme>`).

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
- **Flip y (grows downwards)** and **Flip x (grows to the left)** run an axis the other way.
  Spatial coordinates are often read with y growing downwards, as in the image the cells were
  taken from: switch **Flip y** on and the plot matches it. The flip belongs to this plot. It
  stays through zoom, pan, **Reset axes** and a double click, works with Equal aspect and the
  scale bar and in large-plot mode, is part of an export, and is kept in sessions, share links
  and panel sets. A link made before this option opens unflipped. It is a view setting, not a
  look: **Apply to other panels**, the presets and the session default do not copy or reset it.
  The switches are greyed out in a 3D plot. A line drawn with the table's Line filter
  ({doc}`tables-and-filters`) filters the side you see, so it works on a flipped plot.

## Points

The **Points** group sets how the grey points of a table filter (**Not in table**) look. They get
no legend entry. See {doc}`tables-and-filters`.

- **Size** is a multiple of the size they get automatically from their own count (0.1 to 20,
  `x auto`; 1 by default).
- **Opacity** (0.01 to 1). Empty is automatic.
- **Color**, grey by default, with **Reset**.

## Focused cell

The **Focused cell** group (**Focused gene** in a gene plot) sets how the marker on the focused
cell looks while **Highlight Focused Cell** is on ({doc}`focus-and-lock`). Without changes it is an
open circle five times the point size, drawn by a 2 px edge that is black in the light app theme
and white in the dark one.

- **Size** is a multiple of the point size (0.1 to 50, `x points`; 5 by default), so the marker
  keeps its proportion when the point size changes, by hand or automatically.
- **Opacity** (0.01 to 1). Empty is opaque.
- **Edge width** in pixels (0 to 20; 2 by default). 0 draws no edge. A 3D plot draws only a hairline edge, whatever the
  width, because its renderer has no wider one.
- **Fill** colour, red by default (shown once **No fill** is off), and **Edge** colour, black (light theme) or white (dark theme)
  by default, each with **Reset**. A colour you choose stays as chosen in either theme; one you
  leave alone follows the theme.
- **No fill** is on by default: the marker is an open circle, its edge alone, in the edge colour
  and width, with the plot showing through the middle. Switch it off to fill the marker. Switching it on raises an edge width under 1 px to
  1 px, and the width cannot go below 1 px while it is on, so the circle always shows. In a 3D
  plot the open circle is drawn in the edge colour. The fill colour is kept for when No fill is
  switched off, and **Reset** still only returns the colour to the theme.

The hollow ring of a focused cell the subset does not show ({ref}`focus-outside-subset`) takes the
size, the opacity and the fill colour as its line colour, with the edge width as its line width
(at least 1 px), with or without **No fill**. The marker is part of an export, PNG and SVG,
and **Apply to other panels** copies it.

## Legend and colour bar

- **Show Legend** and **Legend Position** (right, left, top or bottom). A legend on top or at the
  bottom lies outside the axes, below the x-axis title at the bottom, and the margin grows to make room.
- For the legend of a categorical colour: **Legend title** (on by default), **Dot size** (2 to 16 px;
  empty draws the 12 px dots of the default legend, whatever the points' size) and **Columns** (2 to
  8; 1 or empty is one column), each with a **Reset**. The entries read down the columns, with the
  title above them, and each column is as wide as its longest label; columns that do not fit the
  width the legend has wrap onto a new row. A click on an entry still hides that category alone. They
  work on 2D, 3D and large plots, and with the legend at any position. **Text** size has a **Reset** too.
- **Colour bar**, for a numerical colour, has its own **position** (right, left, top, bottom, or
  **with the legend**, the default, which follows **Legend Position**), a **Length** from 10 to
  100 % of the plot's height (or width when horizontal; 100 % by default) and **Ticks**, the
  tick count (2 to 30; empty is automatic). A colour bar on top or at the bottom lies outside the
  axes (below the x-axis title at the bottom), and the margin grows to make room for it.
- The plot's toolbar sits in the top right corner of the plotting area, so a legend or colour bar
  placed beside the plot does not cover it.

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
to 5000; 1200 by 800 by default), as in {doc}`export`. **Export at 2x** is on by default: PNG, JPEG
and WEBP files are drawn at twice the width and height set, 2400 by 1600 pixels by default, so a
figure stays sharp in print. Switch it off for files of exactly the pixels set. An SVG is vector
and keeps the size set either way.

## Apply to other panels

**Apply to other panels** copies this plot's look to every other plot of the same kind: cell
plots to cell plots, gene plots to gene plots. The look is the colours, axes, ticks, text, line
widths, margins, legend, colour bar, scale bar, **Points** and **Focused cell** groups and
export size. The menu asks
first (**Apply** or **Cancel**) and then says how many plots it changed; with no other plot of
the kind it says so instead.

Axes, their direction (Flip x, Flip y), colour columns, table filters, subsets, point size and
opacity, Equal aspect and the title are not copied. A plot without Equal aspect does not take the scale bar: it stays off there.

## Large plots

A plot with more than about a million cells is drawn in large-plot mode ({ref}`large-plot-mode`).
Presets, **Apply to other panels**, tick marks and count, margins, the scale bar, the colour
bar options (position, length, ticks) and the **Focused cell** group work there as usual (the
focused marker is a circle of the same size, opacity, colours and edge). The **Points** group has nothing to
style there: a large plot cannot be filtered by a table.
