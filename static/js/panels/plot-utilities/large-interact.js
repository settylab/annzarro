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
 *   - click: the regular path's action, `setFocusedCell(name)`;
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

const HOVER_PX = 10;           // how close the pointer must be to a point
const HOVER_MS = 16;           // hover lookups are coalesced to one per this long
const DWELL_MS = 100;          // the pointer rests this long before the server is asked
const REMEMBERED = 200;        // rows whose name and colour are kept
// A click focuses only when it is quick and still, decided on release: a pan or zoom that
// starts on a point must not focus. The same rule and values as plot-make-helper.js
// (CLICK_MAX_MS, CLICK_MAX_MOVE_PX on dominik/click-not-drag); mirrored here until that
// branch is merged, when these two lines become an import.
const CLICK_MAX_MS = 300;
const CLICK_MAX_MOVE_PX = 5;

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
 * The point under a pointer event, or null. `{p, row}`: p is the drawn point,
 * row its cell's position among the cells shown.
 */
function pointAt(gd, st, clientX, clientY, target) {
  if (target && target.closest && target.closest('.modebar, .legend, .colorbar')) return null;
  const area = gd.querySelector('.nsewdrag');
  const fl = gd._fullLayout;
  if (!area || !fl || !fl.xaxis || !fl.yaxis || !st.index) return null;
  const box = area.getBoundingClientRect();
  const mx = clientX - box.left, my = clientY - box.top;
  if (mx < 0 || my < 0 || mx > box.width || my > box.height) return null;
  const xa = fl.xaxis, ya = fl.yaxis;
  const cx = xa.p2d(mx), cy = ya.p2d(my);
  const rx = Math.abs(xa.p2d(mx + HOVER_PX) - xa.p2d(mx - HOVER_PX)) / 2;
  const ry = Math.abs(ya.p2d(my + HOVER_PX) - ya.p2d(my - HOVER_PX)) / 2;
  const p = nearestPoint(st.index, cx, cy, rx, ry);
  return p < 0 ? null : { p, row: st.index.rows[p] };
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
  const area = gd.querySelector('.nsewdrag');
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
 * Make the graph interactive from `index`. Safe to call on every draw: the
 * listeners are added once, the state replaced.
 * @param {HTMLElement} gd  the plot
 * @param {Object} settings  the panel's settings
 * @param {Object} index  from buildPointIndex
 */
export function attachLargeInteraction(gd, settings, index) {
  const old = gd.__largeState;
  const st = gd.__largeState = { index, settings, hovered: -1, dwell: 0, lastFocus: null, seq: old ? old.seq : 0 };
  if (old) clearTimeout(old.dwell);
  if (old && old.listening) { st.listening = true; return; }
  st.listening = true;
  let frame = 0, last = null, down = null;
  gd.addEventListener('mousemove', (e) => {
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
      if (area) area.style.cursor = 'pointer';
      if (hit.p !== s.hovered) s.hovered = hit.p;
      showTip(gd, s, hit, last.x, last.y);
    }, HOVER_MS);
  });
  gd.addEventListener('mouseleave', () => { if (gd.__largeState) hideTip(gd, gd.__largeState); });
  // pointer events, not click: Plotly's drag layer takes the mouse between
  // press and release, so no click reaches the graph
  gd.addEventListener('pointerdown', (e) => {
    down = e.isPrimary && (e.pointerType !== 'mouse' || e.button === 0)
      && e.target.closest && e.target.closest('.draglayer, .nsewdrag')
      ? { id: e.pointerId, t: e.timeStamp, x: e.clientX, y: e.clientY } : null;
  }, true);
  document.addEventListener('pointerup', (e) => {
    const s = gd.__largeState;
    const d = down;
    down = null;
    if (!d || e.pointerId !== d.id || !s || !gd.isConnected) return;
    if (e.timeStamp - d.t > CLICK_MAX_MS || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_MAX_MOVE_PX) return;
    const hit = pointAt(gd, s, e.clientX, e.clientY, e.target);
    if (hit) focusRow(gd, s, hit).catch((err) => console.warn('Focus by click failed:', err && err.message));
  }, true);
}

/** The shape that marks the focused cell: a filled circle sized in pixels, as the regular path's marker. */
function focusShape(x, y, pointSize) {
  const r = Math.max(2, Number(pointSize) || 4);
  return { name: 'Focused Cell', type: 'circle', xref: 'x', yref: 'y', xsizemode: 'pixel', ysizemode: 'pixel',
    xanchor: x, yanchor: y, x0: -r, x1: r, y0: -r, y1: r, layer: 'above',
    fillcolor: 'rgba(255, 0, 0, 1)', line: { color: 'rgba(0, 0, 0, 1)', width: 2 } };
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
  return setShape(gd, focusShape(st.index.X[p], st.index.Y[p], settings.pointSize));
}
