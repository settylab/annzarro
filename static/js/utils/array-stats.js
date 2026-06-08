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
