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
