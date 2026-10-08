/**
 * Nearest-point lookup over millions of points, in typed arrays only.
 *
 * Large-plot mode (panels/plot-utilities/large-plot.js) gives Plotly no
 * per-point data, so hover and click find the point under the cursor here: a
 * uniform grid over the drawn positions in compressed-row form. A counting
 * sort in two passes puts the point numbers of each grid cell next to each
 * other (`order`, 4 B per point) behind a table of cell offsets (about
 * 4 B / POINTS_PER_CELL per point). Together with the dataset row of every
 * drawn point (`rows`, 4 B per point) that is 8 B per point and nothing on
 * the V8 heap; the positions are the arrays the plot already holds.
 *
 * A point is its position in X/Y (the plot's own order); `rows[p]` says which
 * cell of the dataset it is. Pure (no DOM), tested in node.
 */

/** Average points per grid cell: at 95.6M points the cells are about a screen pixel wide. */
export const POINTS_PER_CELL = 64;

/**
 * @param {Float32Array} X  x of the drawn points (no NaN)
 * @param {Float32Array} Y  y of the drawn points (no NaN)
 * @param {Uint32Array} rows  dataset row of each drawn point
 * @returns {{X, Y, rows, order: Uint32Array, offsets: Uint32Array, gx: number, gy: number,
 *   x0: number, y0: number, sx: number, sy: number, bytes: number}}
 */
export function buildPointIndex(X, Y, rows) {
  const n = X.length;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = X[i], y = Y[i];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (n === 0) { x0 = y0 = 0; x1 = y1 = 1; }
  const w = Math.max(x1 - x0, 1e-30), h = Math.max(y1 - y0, 1e-30);
  const cells = Math.max(1, Math.ceil(n / POINTS_PER_CELL));
  const gx = Math.max(1, Math.min(cells, Math.round(Math.sqrt(cells * w / h))));
  const gy = Math.max(1, Math.ceil(cells / gx));
  const sx = gx / w, sy = gy / h;
  const offsets = new Uint32Array(gx * gy + 1);
  const cell = (x, y) => {
    let cx = ((x - x0) * sx) | 0, cy = ((y - y0) * sy) | 0;
    if (cx >= gx) cx = gx - 1;
    if (cy >= gy) cy = gy - 1;
    return cy * gx + cx;
  };
  for (let i = 0; i < n; i++) offsets[cell(X[i], Y[i]) + 1]++;
  for (let c = 0; c < gx * gy; c++) offsets[c + 1] += offsets[c];
  // fill from a copy of the cell starts, so `offsets` stays the table of starts
  const order = new Uint32Array(n);
  const fill = offsets.slice(0, gx * gy);          // transient, cells x 4 B
  for (let i = 0; i < n; i++) order[fill[cell(X[i], Y[i])]++] = i;
  return { X, Y, rows, order, offsets, gx, gy, x0, y0, sx, sy,
    bytes: order.byteLength + offsets.byteLength + rows.byteLength };
}

/**
 * The point nearest to (cx, cy) within the ellipse of half-axes (rx, ry) (data
 * units: the pixel radius mapped through the axes), or -1. Distance is the
 * ellipse's own, i.e. pixel distance.
 */
export function nearestPoint(index, cx, cy, rx, ry) {
  const { X, Y, order, offsets, gx, gy, x0, y0, sx, sy } = index;
  if (!(rx > 0) || !(ry > 0) || order.length === 0) return -1;
  const clamp = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v);
  const cx0 = Math.floor((cx - rx - x0) * sx), cx1 = Math.floor((cx + rx - x0) * sx);
  const cy0 = Math.floor((cy - ry - y0) * sy), cy1 = Math.floor((cy + ry - y0) * sy);
  if (cx1 < 0 || cy1 < 0 || cx0 > gx - 1 || cy0 > gy - 1) return -1;
  const ax = clamp(cx0, gx - 1), bx = clamp(cx1, gx - 1);
  let best = -1, bestD = 1;                         // 1 = on the ellipse
  const ix = 1 / rx, iy = 1 / ry;
  for (let row = clamp(cy0, gy - 1); row <= clamp(cy1, gy - 1); row++) {
    // the cells of one grid row are one contiguous run of `order`
    const end = offsets[row * gx + bx + 1];
    for (let j = offsets[row * gx + ax]; j < end; j++) {
      const p = order[j];
      const dx = (X[p] - cx) * ix, dy = (Y[p] - cy) * iy;
      const d = dx * dx + dy * dy;
      if (d < bestD || (d === bestD && best >= 0 && p < best)) { bestD = d; best = p; }
    }
  }
  return best;
}

/** The drawn point holding dataset row `row` (a native scan; no inverse table is kept), or -1. */
export function pointOfRow(index, row) {
  return index.rows.indexOf(row);
}
