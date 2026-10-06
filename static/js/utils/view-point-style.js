/**
 * Automatic point size and opacity for the points in view (issue #85).
 *
 * The automatic values (point-style.js) follow the number of points a
 * panel draws. Zoomed in, only some of them are on screen: at 95.6M cells
 * the automatic 0.78 px at opacity 0.16 left a zoomed view almost blank.
 * In a zoomed or panned 2D view the count is the points inside the visible
 * x/y ranges; back at the full view (autorange), every point drawn.
 *
 * Counting reads the drawn traces' x/y (no refetch); above SAMPLE points it
 * reads every k-th point and scales up, which is far finer than the curve's
 * two significant digits need.
 */

/** Points read per count at most. */
export const SAMPLE = 2000000;
/** Wait after the last zoom or pan before counting, in ms. */
export const VIEW_STYLE_DELAY = 150;

const isArrayLike = (v) => Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView));

const ordered = (r) => (r[0] <= r[1] ? [r[0], r[1]] : [r[1], r[0]]);

/**
 * Points of `gd`'s shown 2D traces inside the axis ranges it shows now, or
 * null when that is not a plain count: no graph, a 3D scene, or an axis
 * that is not linear (category and date ranges are not in data units).
 * @param {HTMLElement} gd - The Plotly graph div.
 * @param {(trace: Object) => boolean} [skip] - Traces that are not points (legend proxies).
 * @returns {number|null}
 */
export function pointsInView(gd, skip = () => false) {
  const fl = gd && gd._fullLayout;
  if (!fl || !Array.isArray(gd.data) || fl.scene) return null;
  const xa = fl.xaxis, ya = fl.yaxis;
  if (!xa || !ya || xa.type !== 'linear' || ya.type !== 'linear'
      || !Array.isArray(xa.range) || !Array.isArray(ya.range)) return null;
  const [x0, x1] = ordered(xa.range);
  const [y0, y1] = ordered(ya.range);
  const traces = gd.data.filter(t => t && t.type === 'scattergl' && t.visible !== false
    && t.visible !== 'legendonly' && !skip(t) && isArrayLike(t.x) && isArrayLike(t.y));
  let total = 0;
  for (const t of traces) total += Math.min(t.x.length, t.y.length);
  const stride = Math.max(1, Math.ceil(total / SAMPLE));
  let count = 0;
  let at = 0;   // index into all traces' points end to end
  for (const t of traces) {
    const x = t.x, y = t.y, len = Math.min(x.length, y.length);
    let i = at;
    for (; i < len; i += stride) {
      const xv = x[i], yv = y[i];
      if (xv >= x0 && xv <= x1 && yv >= y0 && yv <= y1) count++;
    }
    at = i - len;
  }
  return count * stride;
}

/**
 * A trailing debounce: `run` once, `delay` ms after the last call.
 * @param {Function} run
 * @param {number} [delay]
 * @returns {Function & {cancel: Function}}
 */
export function debounced(run, delay = VIEW_STYLE_DELAY) {
  let timer = null;
  const call = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; run(); }, delay);
  };
  call.cancel = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  return call;
}
