/**
 * Automatic point size and opacity: defaults that follow the number of
 * points drawn.
 *
 * The app's default (5 px, opaque) suits thousands of cells; at tens of
 * millions it is a solid blob. Until the user sets a value, a panel draws
 * size and opacity as a smooth function of the points it draws (the subset,
 * or every cell), recomputed whenever that number changes.
 *
 * Automatic means: the panel config had no value (a new panel, or a link
 * written without one), or it was saved while automatic
 * (`autoPointSize` / `autoPointOpacity`). A value the user sets, by slider,
 * number box or an older link that names one, stays as set.
 */
import { roundSig } from './slider-scales.js';

/*
 * value(N) = base * (1 + N / N_HALF) ** -EXPONENT, rounded to 2 significant
 * digits. Smooth in N, equal to base for small N (today's look up to a few
 * thousand points), a power law above.
 * Calibrated on Tahoe UMAP screenshots (cell-line colours, DSF 2) over a grid
 * of size/opacity at 200, 100k, 1M, 10M and 95.6M points. Chosen there:
 * 200: 5 / 1 (anything less vanishes), 100k: 3 / 0.6, 1M: 2 / 0.4,
 * 10M: 1.3 / 0.25, 95.6M: 0.9 / 0.15 (1 / 0.2 still fills the clusters;
 * 0.7 / 0.1 starts to lose the sparse ones). With base 5 / 1 the curve
 * gives 5 / 1, 3 / 0.61, 2 / 0.39, 1.4 / 0.25, 0.92 / 0.16.
 */
export const AUTO_CURVE = Object.freeze({
  size: Object.freeze({ nHalf: 6000, exponent: 0.175 }),
  opacity: Object.freeze({ nHalf: 9000, exponent: 0.2 })
});

/** The automatic value for `n` points, from the default for few points. */
export function autoValue(n, base, curve) {
  if (!(n > 0)) return base;
  return roundSig(base * Math.pow(1 + n / curve.nHalf, -curve.exponent));
}

/** Automatic size and opacity for `n` points. */
export function autoPointStyle(n, base) {
  return {
    size: autoValue(n, base.size, AUTO_CURVE.size),
    opacity: Math.min(1, autoValue(n, base.opacity, AUTO_CURVE.opacity))
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
  const auto = autoPointStyle(n, base);
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
