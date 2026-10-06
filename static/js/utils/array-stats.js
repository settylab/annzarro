/**
 * Stack-safe array statistics.
 *
 * `Math.min(...arr)` / `Math.max(...arr)` spread every element as a separate
 * function argument. For gene-expression color columns (~100k+ cells) this
 * overflows V8's argument/call-stack limit and throws
 * "Maximum call stack size exceeded" right before the plot renders.
 *
 * These helpers compute the same min/max with a single plain loop — no spread,
 * no `.apply` — so they are safe on typed arrays and arrays of any length.
 *
 * NaN values are skipped (matching the existing `.filter(v => !isNaN(v))`
 * intent at the call sites). On an empty / all-NaN input the functions return
 * `Infinity` (min) and `-Infinity` (max), exactly as `Math.min()` / `Math.max()`
 * do with no arguments, so behavior is unchanged.
 */

/**
 * Minimum of an array, skipping NaN. Returns Infinity if no valid value.
 * @param {ArrayLike<number>} arr
 * @returns {number}
 */
export function arrayMin(arr) {
  let min = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (Number.isNaN(v)) continue;
    if (v < min) min = v;
  }
  return min;
}

/**
 * Maximum of an array, skipping NaN. Returns -Infinity if no valid value.
 * @param {ArrayLike<number>} arr
 * @returns {number}
 */
export function arrayMax(arr) {
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (Number.isNaN(v)) continue;
    if (v > max) max = v;
  }
  return max;
}

/**
 * Minimum and maximum in a single pass, skipping NaN.
 * @param {ArrayLike<number>} arr
 * @returns {{min: number, max: number}} Infinity / -Infinity if no valid value.
 */
export function arrayMinMax(arr) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/**
 * A colour-range bound as the Min/Max boxes show it: three significant
 * digits, whole numbers from 1000 up. The boxes used toFixed(2), so a range
 * ending at 0.012 read "0.01", and one inside [0, 0.004] read "0.00".
 * Display only: the range itself is never rounded.
 * @param {number} v
 * @returns {string}
 */
export function formatRangeValue(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (n === 0) return '0';
  if (Math.abs(n) >= 1000) return String(Math.round(n));
  return String(Number(n.toPrecision(3)));
}

/**
 * Whether a column of values is numerical or categorical.
 *
 * Judged on PRESENT values (null, undefined and NaN are missing, not
 * evidence), sampled across the whole array. It used to look at the first
 * 100 values including missing ones, so a numeric column that is mostly
 * missing (a rank defined for 190 of 16,285 genes) was called categorical:
 * 190 categories, and Hide NaN did nothing. Server-declared categoricals are
 * decided before this is asked. Booleans count as categorical.
 * @param {ArrayLike<*>} arr
 * @param {number} [maxSample=1000]
 * @returns {'numerical'|'categorical'}
 */
export function inferValueType(arr, maxSample = 1000) {
  const n = arr ? arr.length : 0;
  if (!n) return 'categorical';
  let present = 0, numeric = 0, bool = 0;
  const step = Math.max(1, Math.floor(n / (maxSample * 4)));
  for (let i = 0; i < n && present < maxSample; i += step) {
    const v = arr[i];
    if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) continue;
    present++;
    if (v === true || v === false) bool++;
    else if (!Number.isNaN(parseFloat(v))) numeric++;
  }
  if (present === 0) return 'categorical';
  if (bool / present >= 0.8) return 'categorical';
  return numeric / present >= 0.8 ? 'numerical' : 'categorical';
}

/**
 * log10 colour values with a floor, for kernel rows and probabilities that
 * span orders of magnitude (on a linear scale everything but the top decade
 * is one colour). Values at or below the floor (zeros, negatives) are drawn
 * at log10(floor); missing values stay missing. Without an explicit floor
 * the smallest positive value is used.
 * @param {ArrayLike<number>} values
 * @param {number|null} [floor]
 * @returns {{values: number[], floor: number|null}}
 */
export function logColorValues(values, floor = null) {
  let f = typeof floor === 'number' && floor > 0 ? floor : null;
  if (f === null) {
    let min = Infinity;
    for (const v of values) if (typeof v === 'number' && v > 0 && v < min) min = v;
    f = Number.isFinite(min) ? min : null;
  }
  if (f === null) return { values: Array.from(values, () => NaN), floor: null };
  const lf = Math.log10(f);
  return {
    values: Array.from(values, v => (typeof v === 'number' && !Number.isNaN(v) ? (v > f ? Math.log10(v) : lf) : NaN)),
    floor: f
  };
}

// Mantissas per decade, finest first; the finest that gives at most
// LOG_TICKS_MAX ticks over the range is used (1-2-5 for 1 to 82).
const LOG_TICK_MANTISSAS = [[1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 5], [1, 3], [1]];
const LOG_TICKS_MAX = 8;

/** A tick label in original units: 0.002, 50, 2000; 5e-6 and 1e7 outside 1e-3..1e3. */
function logTickLabel(v, digits = 3) {
  const [m, e] = v.toExponential(digits - 1).split('e').map(Number);
  return e >= -3 && e <= 3 ? String(Number(v.toPrecision(digits))) : `${m}e${e}`;
}

/**
 * Colour-bar ticks for a log colour scale over [logMin, logMax] (log10
 * units), labelled with the original values. They were whole decades only,
 * so data from 1 to 82 had two ticks, 1 and 10, and a range inside one
 * decade had none. Now: 1-2-5 (or 1-3, or every decade) per decade,
 * whichever is finest with at most 8 ticks; over very many decades every
 * n-th decade; and inside a decade, evenly spaced values (2.5, 3, 3.5).
 * @returns {{tickvals: number[], ticktext: string[]}|null} null for no range
 */
export function logColorbarTicks(logMin, logMax) {
  if (!(Number.isFinite(logMin) && Number.isFinite(logMax) && logMax > logMin)) return null;
  const eps = 1e-9;
  const lo = Math.floor(logMin), hi = Math.ceil(logMax);
  let tickvals = null;
  if (hi - lo <= 4 * LOG_TICKS_MAX) {
    for (const mantissas of LOG_TICK_MANTISSAS) {
      const t = [];
      for (let k = lo; k <= hi && t.length <= LOG_TICKS_MAX; k++) {
        for (const m of mantissas) {
          const x = k + Math.log10(m);
          if (x >= logMin - eps && x <= logMax + eps) t.push(x);
        }
      }
      if (t.length <= LOG_TICKS_MAX) { tickvals = t; break; }
    }
  }
  if (!tickvals) {
    // many decades: every 2nd, 5th, 10th, ... one
    const first = Math.ceil(logMin - eps), last = Math.floor(logMax + eps);
    const need = (last - first + 1) / LOG_TICKS_MAX;
    const every = [2, 3, 5, 10, 20, 25, 50, 100, 200, 500].find(n => n >= need) || Math.ceil(need);
    tickvals = [];
    for (let k = Math.ceil(first / every) * every; k <= last; k += every) tickvals.push(k);
  }
  if (tickvals.length < 3) {
    // less than a decade: evenly spaced values in original units
    const a = 10 ** logMin, b = 10 ** logMax;
    const raw = (b - a) / 4, mag = 10 ** Math.floor(Math.log10(raw));
    let step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw * (1 - eps));
    const even = () => {
      const t = [];
      for (let i = Math.ceil(a / step - eps); i * step <= b * (1 + eps); i++) t.push(Math.log10(i * step));
      return t;
    };
    tickvals = even();
    while (tickvals.length < 3) { step /= 2; tickvals = even(); }
    // enough digits to tell neighbouring ticks apart
    const digits = Math.min(15, Math.max(3, Math.ceil(Math.log10(b / step)) + 1));
    return { tickvals, ticktext: tickvals.map(x => logTickLabel(10 ** x, digits)) };
  }
  return { tickvals, ticktext: tickvals.map(x => logTickLabel(10 ** x)) };
}

/**
 * The colour Min and Max are data values: under a log colour scale the user
 * types 82, not 1.914. The plot is drawn in log10 units, so settings.colorMin
 * and settings.colorMax hold log10 values while Log is on (the boxes, saved
 * views and share links show and store data values); these convert.
 */

/** Settings (drawn) units to data units: 10^v under Log. */
export function colorBoundToData(v, log) {
  if (v === null || v === undefined || !Number.isFinite(v)) return v ?? null;
  return log ? Number((10 ** v).toPrecision(12)) : v;
}

/**
 * Data units to settings (drawn) units: log10(v) under Log. At or below
 * zero there is no log10: Min is drawn from the floor (everything at or
 * below the floor has the floor's colour anyway); Max is refused.
 * @param {number|null} v - typed or stored value, data units
 * @param {boolean} log
 * @param {'min'|'max'} which
 * @param {number|null} [floor] - the log scale's floor, data units
 * @returns {{value: number|null, refused?: string, note?: string}}
 */
export function colorBoundFromData(v, log, which, floor = null) {
  if (!log || v === null || v === undefined || !Number.isFinite(v)) return { value: v ?? null };
  if (v > 0) return { value: Math.log10(v) };
  if (which === 'max') return { value: null, refused: `Max must be above 0 on a log colour scale (${v} has no log).` };
  const f = typeof floor === 'number' && floor > 0 ? floor : null;
  return {
    value: f === null ? null : Math.log10(f),
    note: `Min ${v} is at or below 0, which has no log: the scale starts at the floor`
      + (f === null ? '.' : `, ${formatRangeValue(f)}.`)
  };
}

/** Marker for colour bounds stored in data units; views saved before it stored log10 under Log. */
export const COLOR_RANGE_UNITS = 'data';

/**
 * The colour bounds as a panel's config stores them (getConfig: panel sets,
 * share links, sessions, copies of a panel): data units, marked.
 */
export function storedColorRange(settings) {
  const log = !!(settings.color && settings.color.log);
  return { colorMin: colorBoundToData(settings.colorMin, log), colorMax: colorBoundToData(settings.colorMax, log),
    colorRangeUnits: COLOR_RANGE_UNITS };
}

/**
 * A config as a panel's settings take it: bounds stored in data units
 * (colorRangeUnits: 'data') go back to drawn units. A view saved before
 * that marker stored drawn units already (log10 under Log) and is kept
 * as is, so old links open with the range they had.
 * @returns {Object} a copy without colorRangeUnits
 */
export function restoreColorRange(config) {
  if (!config || typeof config !== 'object') return config;
  const { colorRangeUnits, ...out } = config;
  const log = !!(out.color && out.color.log);
  if (colorRangeUnits === COLOR_RANGE_UNITS && log) {
    for (const [key, which] of [['colorMin', 'min'], ['colorMax', 'max']]) {
      if (key in out) out[key] = colorBoundFromData(out[key], true, which).value;
    }
  }
  return out;
}
