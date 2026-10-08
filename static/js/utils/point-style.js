/**
 * Automatic point size and opacity: defaults that follow the number of
 * points drawn.
 *
 * The app's default (5 px, opaque) suits thousands of cells; at tens of
 * millions it is a solid blob. Until the user sets a value, a panel draws
 * size and opacity as a smooth function of the points it draws (the subset,
 * or every cell), recomputed whenever that number changes. In a zoomed 2D
 * view the number is the points in view (view-point-style.js).
 *
 * Automatic means: the panel config had no value (a new panel, or a link
 * written without one), or it was saved while automatic
 * (`autoPointSize` / `autoPointOpacity`). A value the user sets, by slider,
 * number box or an older link that names one, stays as set.
 */
import { roundSig, snapPointSize } from './slider-scales.js';
import { Config } from '../config.js';

/*
 * value(N) = base * (1 + N / N_HALF) ** -EXPONENT, rounded to 2 significant
 * digits. Smooth in N, equal to base for a few thousand points or fewer, a
 * power law above.
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
 */
export const AUTO_CURVE = Object.freeze({
  size: Object.freeze({ nHalf: 6000, exponent: 0.3 }),
  opacity: Object.freeze({ nHalf: 9000, exponent: 0.18 })
});

/** The automatic value for `n` points, from the default for few points. */
export function autoValue(n, base, curve) {
  if (!(n > 0)) return base;
  return roundSig(base * Math.pow(1 + n / curve.nHalf, -curve.exponent));
}

/**
 * Automatic size and opacity for `n` points. `is3D`: a scatter3d plot,
 * whose automatic opacity is 1 at any N (below 1 Plotly draws its points
 * out of depth order, far ones over near ones) and whose sizes are not
 * snapped; 2D sizes are ones scattergl draws (slider-scales.js
 * snapPointSize); both are at least one step (0.392 px).
 */
export function autoPointStyle(n, base, is3D = false) {
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

/**
 * Set the automatic values for `n` points drawn. `base` is the app's
 * default for few points. Returns whether a value changed.
 */
export function applyAutoPointStyle(settings, n, base) {
  const auto = autoPointStyle(n, base, !!settings.z);
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

/**
 * The marker of the grey points a table link leaves in the plot (the rows
 * not in the table, drawn first so they sit behind). They do not count for
 * the plot's automatic style, which follows the points shown in full; they
 * keep the automatic style of everything drawn (`nAll` points), so a few
 * chosen rows do not sit on a solid grey backdrop. A size or opacity the
 * user set applies to them too.
 */
export function greyMarker(settings, nAll) {
  const auto = autoPointStyle(nAll, pointStyleBase(), !!settings.z);
  return {
    size: settings.autoPointSize ? auto.size : settings.pointSize,
    opacity: settings.autoPointOpacity ? auto.opacity : settings.pointOpacity
  };
}
