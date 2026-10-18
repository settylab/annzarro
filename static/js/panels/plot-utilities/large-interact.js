/**
 * Hover, click and the focused-cell highlight of a large plot.
 *
 * large-plot.js gives Plotly no per-point data, so what the regular path gets
 * from Plotly's hover layer is done here from the point index
 * (utils/point-index.js):
 *
 *   - hover: the pointer, mapped through the axes, finds the nearest drawn
 *     point within HOVER_PX; a small HTML tooltip shows its coordinates at
 *     once and its name and colour value once the server has answered for
 *     that one row (a few hundred rows are remembered, nothing per point);
 *   - click: the regular path's action, `setFocusedCell(name)`. A click
 *     before the index is ready (seconds or more at 95.6M points) is kept, in data
 *     units: the cursor and the status strip say so ("Preparing click
 *     selection…"), and it is applied once the index is there;
 *   - highlight: one layout shape (a circle, sized in pixels) at the focused
 *     cell. A shape is redrawn without calculating the traces again, which a
 *     restyle or added trace of a 95M-point plot is not.
 *
 * Everything reads `plotContainer.__largeState`, replaced on each draw, so the
 * listeners are added once per graph.
 */
import { DataManager } from '../../data-manager.js';
import { nearestPoint, pointOfRow } from '../../utils/point-index.js';
import { colourTitle } from '../../utils/plot-titles.js';
import { CLICK_MAX_MS, CLICK_MAX_MOVE_PX, noteDoublePress, noteClickRelease, isDoubleClick, deferFocus, cancelDeferredFocus } from './plot-make-helper.js';
import { focusShapeStyle } from '../../utils/focus-style.js';
import { setStatusTag } from '../../utils/panel-surface.js';

const HOVER_PX = 10;           // how close the pointer must be to a point
const HOVER_MS = 16;           // hover lookups are coalesced to one per this long
const DWELL_MS = 100;          // the pointer rests this long before the server is asked
const REMEMBERED = 200;        // rows whose name and colour are kept
// A click focuses only when it is quick and still, decided on release: a pan or zoom that
// starts on a point must not focus. The rule and values are the regular plot's (CLICK_MAX_MS,
// CLICK_MAX_MOVE_PX, imported above).

const _cache = new Map();      // `${generation}:${row}:${colour}` -> {name, colour}
const _names = new Map();      // `${generation}:${row}` -> name: a click after a hover needs no request
let _tip = null;

function tooltip() {
  if (_tip && _tip.isConnected) return _tip;
  _tip = document.createElement('div');
  _tip.className = 'large-plot-tip';
  Object.assign(_tip.style, { position: 'fixed', zIndex: '10000', pointerEvents: 'none', display: 'none',
    padding: '3px 7px', font: '12px/1.35 Arial, Helvetica, sans-serif', whiteSpace: 'nowrap',
    background: 'var(--bs-body-bg, #fff)', color: 'var(--bs-body-color, #212529)',
    border: '1px solid #888', borderRadius: '3px', boxShadow: '0 1px 4px rgba(0,0,0,.25)' });
  document.body.appendChild(_tip);
  return _tip;
}

const _fmt = (v) => (typeof v === 'number' ? Number(v.toPrecision(5)).toString() : String(v));

/**
 * The points of traces hidden with the legend, as sorted [from, to) pairs of
 * point numbers (or null when none is hidden). `st.chunks` says which points
 * each point trace draws (large-plot.js); hiding is read from the graph at
 * each lookup, so a legend click needs no rebuild of the index (1 s and
 * 4 B a point at 95.6M, against a pass over the few hundred traces).
 */
function hiddenRanges(gd, st) {
  const chunks = st.chunks, data = gd.data;
  if (!chunks || !data) return null;
  const out = [];
  for (const c of chunks) {
    const v = data[c.trace] && data[c.trace].visible;
    if (v !== false && v !== 'legendonly') continue;
    if (out.length && out[out.length - 1] === c.from) out[out.length - 1] = c.to;
    else out.push(c.from, c.to);
  }
  return out.length ? Uint32Array.from(out) : null;
}

/**
 * Where a pointer event is in data units, with the search radius mapped
 * through the axes: `{cx, cy, rx, ry}`, or null off the plot area (or on the
 * modebar, legend or colour bar). Needs no index.
 */
function queryAt(gd, clientX, clientY, target) {
  if (target && target.closest && target.closest('.modebar, .legend, .colorbar')) return null;
  const area = gd.querySelector('.nsewdrag');
  const fl = gd._fullLayout;
  if (!area || !fl || !fl.xaxis || !fl.yaxis) return null;
  const box = area.getBoundingClientRect();
  const mx = clientX - box.left, my = clientY - box.top;
  if (mx < 0 || my < 0 || mx > box.width || my > box.height) return null;
  const xa = fl.xaxis, ya = fl.yaxis;
  return { cx: xa.p2d(mx), cy: ya.p2d(my),
    rx: Math.abs(xa.p2d(mx + HOVER_PX) - xa.p2d(mx - HOVER_PX)) / 2,
    ry: Math.abs(ya.p2d(my + HOVER_PX) - ya.p2d(my - HOVER_PX)) / 2 };
}

/** The drawn point nearest to a query of queryAt, or null. `{p, row}` as for pointAt. */
function pointOfQuery(gd, st, q) {
  if (!q || !st.index) return null;
  const p = nearestPoint(st.index, q.cx, q.cy, q.rx, q.ry, hiddenRanges(gd, st));
  return p < 0 ? null : { p, row: st.index.rows[p] };
}

/**
 * The point under a pointer event, or null. `{p, row}`: p is the drawn point,
 * row its cell's position among the cells shown.
 */
function pointAt(gd, st, clientX, clientY, target) {
  return st.index ? pointOfQuery(gd, st, queryAt(gd, clientX, clientY, target)) : null;
}

const PREPARING = { text: 'Preparing click selection…',
  title: 'The index that finds the point under the pointer is being built; the click is applied when it is ready' };

/** Say that a click waits for the index (cursor and status strip), or stop saying it. */
function showWaiting(gd, on) {
  const area = gd.querySelector && gd.querySelector('.nsewdrag');
  if (area && on && area.dataset.largeBusy === undefined) {
    area.dataset.largeBusy = area.style.cursor || '';
    area.style.cursor = 'progress';
  } else if (area && !on && area.dataset.largeBusy !== undefined) {
    area.style.cursor = area.dataset.largeBusy;
    delete area.dataset.largeBusy;
  }
  setStatusTag(gd, 'click', on ? PREPARING : null);
}

/**
 * Apply the click that waited for the point index, now that it is ready
 * (large-plot.js calls this when the build ends), or drop it when the build
 * failed and there is no index. Nothing to do without one.
 * @param {HTMLElement} gd  the plot
 */
export function applyPendingClick(gd) {
  const st = gd && gd.__largeState;
  if (!st || !st.pending) return;
  const q = st.pending;
  st.pending = null;
  showWaiting(gd, false);
  const hit = pointOfQuery(gd, st, q);
  if (hit) focusRow(gd, st, hit).catch((err) => console.warn('Focus by click failed:', err && err.message));
}

/** Name and colour value of one row, from the server (remembered). */
async function describeRow(st, row) {
  const colour = st.settings.color;
  const hasColour = colour && colour.type !== 'none';
  const key = `${DataManager.getDatasetGeneration()}:${row}:${hasColour ? JSON.stringify(colour) : ''}`;
  if (_cache.has(key)) return _cache.get(key);
  const [name, value] = await Promise.all([
    // the name is remembered as soon as it is here: a click needs only that
    DataManager.cellNameAt(row).then((n) => {
      _names.set(`${DataManager.getDatasetGeneration()}:${row}`, n);
      if (_names.size > REMEMBERED) _names.delete(_names.keys().next().value);
      return n;
    }),
    hasColour ? DataManager.loadCellValue(colour, { shown: true, position: row }).catch(() => null)
      : Promise.resolve(null)
  ]);
  const out = { name, colour: value };
  _cache.set(key, out);
  _names.set(`${DataManager.getDatasetGeneration()}:${row}`, name);
  if (_names.size > REMEMBERED) _names.delete(_names.keys().next().value);
  if (_cache.size > REMEMBERED) _cache.delete(_cache.keys().next().value);
  return out;
}

function showTip(gd, st, hit, clientX, clientY) {
  const tip = tooltip();
  const lines = [`x: ${_fmt(st.index.X[hit.p])}`, `y: ${_fmt(st.index.Y[hit.p])}`];
  const colour = st.settings.color;
  const draw = (info) => {
    const rows = [];
    if (info && info.name !== undefined) rows.push(String(info.name));
    rows.push(...lines);
    if (info && info.colour !== null && info.colour !== undefined && colour && colour.type !== 'none') {
      rows.push(`${colourTitle(colour)}: ${_fmt(info.colour)}`);
    }
    tip.replaceChildren(...rows.map((t, i) => {
      const d = document.createElement('div');
      if (i === 0 && info && info.name !== undefined) d.style.fontWeight = '600';
      d.textContent = t;
      return d;
    }));
  };
  const key = `${DataManager.getDatasetGeneration()}:${hit.row}:${colour && colour.type !== 'none' ? JSON.stringify(colour) : ''}`;
  draw(_cache.get(key));
  tip.style.display = 'block';
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.min(clientX + 14, window.innerWidth - w - 4)}px`;
  tip.style.top = `${Math.min(clientY + 14, window.innerHeight - h - 4)}px`;
  if (!_cache.has(key)) {
    clearTimeout(st.dwell);
    st.dwell = setTimeout(() => {
      describeRow(st, hit.row).then((info) => {
        if (st.hovered === hit.p && tip.style.display !== 'none') draw(info);
      }).catch(() => {});
    }, DWELL_MS);
  }
}

function hideTip(gd, st) {
  clearTimeout(st.dwell);
  st.hovered = -1;
  if (_tip) _tip.style.display = 'none';
  const area = gd.querySelector && gd.querySelector('.nsewdrag');
  if (area && area.dataset.largeCursor) { area.style.cursor = area.dataset.largeCursor; delete area.dataset.largeCursor; }
}

/** The regular path's click: focus the cell (other panels follow). */
async function focusRow(gd, st, hit) {
  const known = _names.get(`${DataManager.getDatasetGeneration()}:${hit.row}`);
  const name = known ?? await DataManager.cellNameAt(hit.row);
  if (!name) return;
  DataManager.rememberCell(name, { index: hit.row });
  st.lastFocus = { name, row: hit.row, p: hit.p };
  DataManager.setFocusedCell(name, false);
}

/**
 * Make the graph interactive from `index`, which may be null while it is
 * still being built (`st.index` is set when it is ready; until then hover shows
 * nothing and a click waits for it, see applyPendingClick). Safe to call on
 * every draw: the listeners are added once, the state replaced; a click still
 * waiting is kept for a draw of the same axes. Returns the state.
 * @param {HTMLElement} gd  the plot
 * @param {Object} settings  the panel's settings
 * @param {Object|null} index  from buildPointIndex
 */
export function attachLargeInteraction(gd, settings, index) {
  const old = gd.__largeState;
  const same = old && old.pending && JSON.stringify([old.settings.x, old.settings.y]) === JSON.stringify([settings.x, settings.y]);
  const st = gd.__largeState = { index, settings, hovered: -1, dwell: 0, lastFocus: null, seq: old ? old.seq : 0,
    pending: same ? old.pending : null };
  if (old) clearTimeout(old.dwell);
  if (old && old.pending && !same) showWaiting(gd, false);
  if (gd.__largeOff) return st;
  const off = [];
  gd.__largeOff = off;
  const listen = (target, type, fn, capture) => {
    target.addEventListener(type, fn, capture);
    off.push(() => target.removeEventListener(type, fn, capture));
  };
  let frame = 0, last = null, down = null;
  off.push(() => { clearTimeout(frame); frame = 0; });
  listen(gd, 'mousemove', (e) => {
    const s = gd.__largeState;
    last = { x: e.clientX, y: e.clientY, target: e.target, buttons: e.buttons };
    if (frame) return;
    // a short timer, not requestAnimationFrame: frames are not run for an idle or hidden page
    frame = setTimeout(() => {
      frame = 0;
      if (!s || gd.__largeState !== s || !last) return;
      const hit = last.buttons ? null : pointAt(gd, s, last.x, last.y, last.target);
      if (!hit) { if (s.hovered !== -1) hideTip(gd, s); return; }
      const area = gd.querySelector('.nsewdrag');
      if (area && !area.dataset.largeCursor) { area.dataset.largeCursor = area.style.cursor || ''; }
      if (area && area.dataset.largeBusy === undefined) area.style.cursor = 'pointer';
      if (hit.p !== s.hovered) s.hovered = hit.p;
      showTip(gd, s, hit, last.x, last.y);
    }, HOVER_MS);
  });
  listen(gd, 'mouseleave', () => { if (gd.__largeState) hideTip(gd, gd.__largeState); });
  // pointer events, not click: Plotly's drag layer takes the mouse between
  // press and release, so no click reaches the graph
  listen(gd, 'pointerdown', (e) => {
    const primary = e.isPrimary && (e.pointerType !== 'mouse' || e.button === 0);
    const seq = primary ? noteDoublePress(gd, e) : 0;
    down = primary && e.target.closest && e.target.closest('.draglayer, .nsewdrag')
      ? { id: e.pointerId, t: e.timeStamp, x: e.clientX, y: e.clientY, seq } : null;
  }, true);
  listen(document, 'pointerup', (e) => {
    const s = gd.__largeState;
    const d = down;
    down = null;
    if (!d || e.pointerId !== d.id || !s || !gd.isConnected) return;
    if (e.timeStamp - d.t > CLICK_MAX_MS || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_MAX_MOVE_PX) return;
    const q = queryAt(gd, e.clientX, e.clientY, e.target);
    if (!q) return;
    if (!s.index) {
      // a double click while the index is built: no click waits (the first one's is dropped)
      const second = isDoubleClick(gd, d.seq);
      noteClickRelease(gd, e);
      if (second) { s.pending = null; showWaiting(gd, false); return; }
      // the index is still being built: the click waits for it, and says so
      s.pending = q;
      showWaiting(gd, true);
      return;
    }
    if (s.pending) { s.pending = null; showWaiting(gd, false); }
    const hit = pointOfQuery(gd, s, q);
    if (hit) deferFocus(gd, e, () => focusRow(gd, s, hit).catch((err) => console.warn('Focus by click failed:', err && err.message)), d.seq);
  }, true);
  return st;
}

/**
 * Take the large-plot interaction off the graph: the listeners, the tooltip,
 * the hand cursor and the point index (the state holds it). The graph leaves
 * large-plot mode (a subset small enough for a regular plot, a lost context,
 * the panel closing) and Plotly's own hover is the only one left. Safe on a
 * graph that never had it.
 * @param {HTMLElement} gd  the plot
 */
export function detachLargeInteraction(gd) {
  if (!gd) return;
  cancelDeferredFocus(gd);
  const st = gd.__largeState;
  if (st) { clearTimeout(st.dwell); hideTip(gd, st); st.index = null; st.seq++; }
  if (st && st.pending) { st.pending = null; showWaiting(gd, false); }
  if (gd.__largeOff) { for (const f of gd.__largeOff) f(); gd.__largeOff = null; }
  gd.__largeState = null;
  const area = gd.querySelector && gd.querySelector('.nsewdrag');
  if (area && area.dataset.largeCursor !== undefined) { area.style.cursor = area.dataset.largeCursor; delete area.dataset.largeCursor; }
}

/**
 * The shape that marks the focused cell: a filled circle sized in pixels, in
 * the panel's Focused style as the regular path's marker (utils/focus-style.js;
 * a shape's opacity covers fill and edge, as a marker's does).
 */
function focusShape(x, y, settings) {
  const { r, opacity, fillcolor, line } = focusShapeStyle(settings);
  return { name: 'Focused Cell', type: 'circle', xref: 'x', yref: 'y', xsizemode: 'pixel', ysizemode: 'pixel',
    xanchor: x, yanchor: y, x0: -r, x1: r, y0: -r, y1: r, layer: 'above', opacity, fillcolor, line };
}

function setShape(gd, shape) {
  const have = Array.isArray(gd.layout && gd.layout.shapes) && gd.layout.shapes.length > 0;
  if (!shape && !have) return Promise.resolve();
  return Promise.resolve()
    .then(() => Plotly.relayout(gd, { shapes: shape ? [shape] : [] }))
    .catch(error => console.warn('Focused-cell highlight skipped:', error && error.message ? error.message : error));
}

/** Take the highlight off a large plot (the toggle was turned off). */
export function clearLargeFocus(gd) {
  if (!gd || !gd.__largeState) return Promise.resolve();
  gd.__largeState.seq++;
  return setShape(gd, null);
}

/**
 * Put the highlight on the focused cell, when the setting is on and the cell
 * is among the points drawn; take it off otherwise. The cell's row is found
 * by name (the server's index) and its point by a scan of the drawn rows, so
 * no per-point table is kept; a cell clicked on skips both.
 */
export async function highlightLargeFocus(gd, settings) {
  const st = gd && gd.__largeState;
  if (!st || !st.index) return;
  const seq = ++st.seq;
  const name = DataManager.getFocusedCell();
  if (!name || !settings.highlightFocusedCell) return setShape(gd, null);
  let p = -1;
  const last = st.lastFocus;
  if (last && last.name === name && st.index.rows[last.p] === last.row) {
    p = last.p;
  } else {
    const cell = await DataManager.locateCell(name);
    if (cell && cell.shown && cell.position >= 0) p = pointOfRow(st.index, cell.position);
  }
  if (seq !== st.seq || gd.__largeState !== st || !st.index) return;
  if (p < 0) return setShape(gd, null);
  return setShape(gd, focusShape(st.index.X[p], st.index.Y[p], settings));
}

/**
 * Draw the highlight shape, where it is, in the panel's Focused style as it
 * is now (a Plot Options change, the point size, the app theme). No shape,
 * or one drawn so already: nothing to do.
 */
export function restyleLargeFocus(gd, settings) {
  const shapes = gd && gd.layout && gd.layout.shapes;
  const shape = Array.isArray(shapes) ? shapes.find(s => s && s.name === 'Focused Cell') : null;
  if (!shape) return Promise.resolve();
  const next = focusShape(shape.xanchor, shape.yanchor, settings);
  const line = shape.line || {};
  if (shape.x1 === next.x1 && shape.opacity === next.opacity && shape.fillcolor === next.fillcolor
      && line.color === next.line.color && line.width === next.line.width) return Promise.resolve();
  return setShape(gd, next);
}
