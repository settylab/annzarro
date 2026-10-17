/**
 * Automatic point size and opacity: defaults that follow how densely the
 * points fill the plot.
 *
 * The app's default (5 px, opaque) suits thousands of cells; at tens of
 * millions it is a solid blob. Until the user sets a value, a panel draws
 * size and opacity as a smooth function of the points it draws (the subset,
 * or every cell) per plot area, recomputed whenever either changes: the
 * number (subset, filters, zoom: in a zoomed 2D view it is the points in
 * view, view-point-style.js) or the area (window resize, split-pane drag,
 * controls shown or hidden, panel maximised, an export at its own size).
 *
 * Automatic means: the panel config had no value (a new panel, or a link
 * written without one), or it was saved while automatic
 * (`autoPointSize` / `autoPointOpacity`). A value the user sets, by slider,
 * number box or an older link that names one, stays as set.
 */
import { roundSig, snapPointSize } from './slider-scales.js';
import { Config } from '../config.js';
import { PLOT_PALETTES, plotColour } from './plot-theme.js';

/*
 * value(N) = base * (1 + N / N_HALF) ** -EXPONENT, rounded to 2 significant
 * digits. Smooth in N, equal to base for a few thousand points or fewer, a
 * power law above. N is the count scaled to the reference plot area:
 * N_eff = N * REF_AREA / area, so a plot of the reference area draws the
 * values below, one twice as large draws what half the points would, one
 * half as large what twice the points would. Every value below is at
 * REF_AREA.
 *
 * Size (base 5 px): N_HALF 6000, EXPONENT 0.3. A power law, so every tenfold
 * in points takes the size down by the same factor (about 2) and the change
 * is visible at every scale: 5.1 px at 100 points, 3.5 at 10k, 2.0 at 100k,
 * 1.2 at 1M, 0.78 at 5M, and the smallest step scattergl draws (0.392 px) from
 * about 10M. The first calibration (Tahoe UMAP screenshots, 200 to 95.6M
 * points) chose an exponent of 0.175, which left points at 2 px at 1M and
 * 1.6 px at 10M: clusters of a few million cells were already solid, and 100
 * to 10k points hardly changed. Redone on 1M, 2M and 5M Tahoe cells (cell
 * line colours): at 1M to 5M the old sizes merge neighbouring clusters, these
 * keep their outlines and the sparse bridges between them.
 *
 * Opacity (base 1): N_HALF 9000, EXPONENT 0.18: 0.87 at 10k, 0.64 at 100k,
 * 0.43 at 1M, 0.32 at 5M, 0.28 at 10M, 0.19 at 95.6M. Points are smaller than before, so
 * a little more opaque than the first calibration (0.2); looked at to 5M
 * points, not beyond.
 *
 * Sizes are snapped to the ones scattergl draws (scattergl rounds to steps of
 * 100/255 px; slider-scales.js snapPointSize), never below one step.
 *
 * Area: the axes' plot area in CSS px (Plotly's _fullLayout._size, w * h:
 * the paper less its margins, legend and colour bar), not the window.
 * REF_AREA is the panel all the screenshots above were taken in: one tile,
 * controls hidden, in a 900 x 700 px browser window, coloured by cell line
 * (a legend on the right), which drew a plot area of 660 x 332 px. The
 * factor area / REF_AREA is held within AREA_RANGE, 1/8 to 8: 8 is a single
 * panel filling a 2560 x 1440 window (2241 x 783 px), and 1/8 leaves room
 * below a small split pane (a fifth of that window's width and 40% of its
 * height: 310 x 181 px, about 1/4). Past either end (a thumbnail, a
 * 5000 px export) the value stays at that end. The size never exceeds
 * base however large the area: the curve is base for few points. 3D sizes
 * follow the area as 2D ones do (the scene fills the plot area); 3D
 * opacity stays 1.
 */
export const AUTO_CURVE = Object.freeze({
  size: Object.freeze({ nHalf: 6000, exponent: 0.3 }),
  opacity: Object.freeze({ nHalf: 9000, exponent: 0.18 })
});

/** The plot area (CSS px^2) the curve's values are for. */
export const REF_AREA = 660 * 332;
/** The bounds of area / REF_AREA. */
export const AREA_RANGE = Object.freeze([1 / 8, 8]);

/** The automatic value for `n` points, from the default for few points. */
export function autoValue(n, base, curve) {
  if (!(n > 0)) return base;
  return roundSig(base * Math.pow(1 + n / curve.nHalf, -curve.exponent));
}

/** `n` points in a plot area of `area` CSS px^2, as a count at REF_AREA (unknown area: REF_AREA). */
export function areaCount(n, area) {
  if (!(area > 0)) return n;
  const factor = Math.min(AREA_RANGE[1], Math.max(AREA_RANGE[0], area / REF_AREA));
  return n / factor;
}

/**
 * Automatic size and opacity for `n` points in a plot area of `area` CSS
 * px^2 (default REF_AREA). `is3D`: a scatter3d plot,
 * whose automatic opacity is 1 at any N (below 1 Plotly draws its points
 * out of depth order, far ones over near ones) and whose sizes are not
 * snapped; 2D sizes are ones scattergl draws (slider-scales.js
 * snapPointSize); both are at least one step (0.392 px).
 */
export function autoPointStyle(n, base, is3D = false, area = REF_AREA) {
  n = areaCount(n, area);
  const size = autoValue(n, base.size, AUTO_CURVE.size);
  return {
    // never below the smallest step scattergl draws, 3D too
    size: is3D ? Math.max(size, snapPointSize(0)) : snapPointSize(size),
    opacity: is3D ? 1 : Math.min(1, autoValue(n, base.opacity, AUTO_CURVE.opacity))
  };
}

const isSet = (v) => v !== undefined && v !== null;

/**
 * Mark a new panel's size and opacity automatic unless `options` (its
 * config or link) sets them. Call after the options are merged in.
 */
export function initAutoPointStyle(settings, options = {}) {
  const o = options || {};
  settings.autoPointSize = o.autoPointSize === true || !isSet(o.pointSize);
  settings.autoPointOpacity = o.autoPointOpacity === true || !isSet(o.pointOpacity);
}

// The plot area each panel's style was last worked out for, by its
// settings object: the greyed-out points (greyMarker) follow it too. Kept
// here, not in the settings, which are saved and shared.
const _areas = new WeakMap();

/** The plot area `settings`' panel was last styled for (undefined before that). */
export function styleArea(settings) {
  return settings && typeof settings === 'object' ? _areas.get(settings) : undefined;
}

/**
 * Set the automatic values for `n` points drawn in a plot area of `area`
 * CSS px^2 (view-point-style.js plotArea; omitted: the area last given for
 * this panel, else REF_AREA). `base` is the app's default for few points.
 * Returns whether a value changed.
 */
export function applyAutoPointStyle(settings, n, base, area) {
  if (area > 0) _areas.set(settings, area);
  const auto = autoPointStyle(n, base, !!settings.z, styleArea(settings));
  let changed = false;
  if (settings.autoPointSize && settings.pointSize !== auto.size) {
    settings.pointSize = auto.size;
    changed = true;
  }
  if (settings.autoPointOpacity && settings.pointOpacity !== auto.opacity) {
    settings.pointOpacity = auto.opacity;
    changed = true;
  }
  return changed;
}

/** The default size and opacity for few points: the app's (server) defaults. */
export function pointStyleBase() {
  const d = (Config && Config.DEFAULTS) || {};
  return { size: d.POINT_SIZE || 5, opacity: d.POINT_OPACITY || 0.7 };
}

/** The grey of the points not in the table in the light theme; the dark one is in utils/plot-theme.js. */
export const NOT_IN_TABLE_COLOR = PLOT_PALETTES.light.notInTableColor;

/**
 * The marker of the grey points a table link leaves in the plot (the rows
 * not in the table, drawn first so they sit behind). They have a style of
 * their own, always derived the same way: the automatic style of their own
 * count (`nGrey` points in the panel's plot area, styleArea, the same
 * curve the main points follow), the size
 * times the panel's `notInTableScale` (1 = as the curve gives it). Neither
 * the main points' manual size nor their automatic one enters, so a few
 * chosen rows do not sit on a solid grey backdrop and a size set later
 * does not leave these behind. `notInTableOpacity` and `notInTableColor`
 * replace the curve's opacity and the default grey when set.
 */
export function greyMarker(settings, nGrey) {
  const auto = autoPointStyle(nGrey, pointStyleBase(), !!settings.z, styleArea(settings));
  const scale = settings.notInTableScale > 0 ? settings.notInTableScale : 1;
  const size = auto.size * scale;
  const opacity = settings.notInTableOpacity > 0 && settings.notInTableOpacity <= 1
    ? settings.notInTableOpacity : auto.opacity;
  return {
    size: settings.z ? Math.max(size, snapPointSize(0)) : snapPointSize(size),
    opacity,
    color: plotColour(settings, 'notInTableColor')
  };
}
