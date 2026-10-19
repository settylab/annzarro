/**
 * The line-selection tool of the table panel, on the page.
 *
 * The table's Line button arms it. While it is armed every plot of the same
 * kind of entity (cell plots for a cell table, gene plots for a gene table)
 * that takes a line is covered by a transparent layer:
 *
 *   - a plot the tool can work on takes a drag, mouse down to release; the
 *     line and the side that will be filtered out (right of the way from the
 *     down point to the release point) are drawn while the mouse moves, Shift
 *     snaps the line to multiples of 45 degrees, and the release hands the
 *     line to the table (applyLine of the table panel: columns, a condition
 *     joined to the filter by an outer AND);
 *   - a plot it does not apply to (3D, large-plot mode) gets nothing, and the
 *     mouse is its own there; a 2D plot it cannot use (a text or date axis)
 *     gets a light tooltip near the cursor that says why, and blocks nothing.
 * Escape stops it: a line being drawn is dropped (the release then does
 * nothing) and the tool is left. Plotly's own zoom and pan are the model: the
 * tool stays armed after a line, so that several lines make an area.
 *
 * The arithmetic is utils/line-select.js; this file is the browser side.
 */
import { PanelManager } from '../../panel-manager.js';
import { DataManager } from '../../data-manager.js';
import { notify } from '../../utils/notify.js';
import {
    axisMap, lineCondition, rightPolygon, clipLine, snap45, fitInside, columnRef, plotMode
} from '../../utils/line-select.js';
import { getColumnDisplayName } from './table-data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TABLE_SOURCES = {
    cells: ['obs', 'obsm', 'obsp', 'layer'],
    genes: ['var', 'varm', 'varp', 'layer']
};
const PLOT_TYPE = { cells: 'cell-plot', genes: 'gene-plot' };
const HINT = 'Drag to draw a line. The right side is filtered out. Shift: 45\u00b0. Esc: stop.';
/** The badge's help: drag on a plot of the table's own rows ('cells' or 'genes'). */
const badgeHelp = (rows) => `Drag on a plot of ${rows} to draw a line. The side to the right of the line, `
    + 'looking from where you press to where you release, is filtered out of this table. '
    + 'Esc or a click here stops.';

/** @type {null|{tableId: string, rows: string, overlays: Map<string, Object>, frame: number,
 *                drag: Object|null, busy: boolean, onKey: Function, onKeyUp: Function}} */
let active = null;

/** The Plotly div of a plot panel. */
function plotDiv(panel) {
    return document.getElementById(`plot-container-${panel.getId()}`);
}

/** The name of an axis for a message. */
function axisLabel(axis) {
    return axis && axis.type && axis.type !== 'none' ? getColumnDisplayName(columnRef(axis)) : 'none';
}

/**
 * What the tool does over this plot (plotMode in utils/line-select.js), from what is drawn.
 * @param {Object} panel  a plot panel
 * @param {string} rows  'cells' or 'genes', the table's rows
 * @returns {{mode: 'ok'|'none'|'warn', why: string|null}}
 */
export function modeOf(panel, rows) {
    const gd = plotDiv(panel);
    const fl = gd && gd._fullLayout;
    const cfg = (panel.getConfig && panel.getConfig()) || {};
    const axis = (a) => (cfg[a] && cfg[a].type) || 'none';
    return plotMode({
        drawn: !!(fl && fl.xaxis && fl.yaxis && fl.xaxis._length > 0 && fl.yaxis._length > 0),
        isLarge: !!(gd && gd.__isLarge),
        // a 3D plot has a scene, not an x and y axis: say so before anything about "drawn"
        is3d: !!(cfg.z && cfg.z.type && cfg.z.type !== 'none') || !!(fl && fl.scene)
            || !!(gd && gd._fullData && gd._fullData.some(t => /3d/.test(t.type || ''))),
        xType: fl && fl.xaxis ? fl.xaxis.type : '',
        yType: fl && fl.yaxis ? fl.yaxis.type : '',
        xSource: axis('x'),
        ySource: axis('y'),
        tableSources: TABLE_SOURCES[rows],
        xLabel: axisLabel(cfg.x),
        yLabel: axisLabel(cfg.y)
    });
}

/** Whether the tool is armed from this table. */
export function isLineSelectArmed(tableId) {
    return !!active && active.tableId === tableId;
}

/** Make the Line buttons say whether the tool is armed. */
function syncButtons() {
    for (const btn of document.querySelectorAll('.az-line-select-btn')) {
        const on = !!active && btn.getAttribute('data-table') === active.tableId;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
    }
}

/** The Line button for a table (its search-options row). */
export function lineSelectButton(tableId, rows) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm az-line-select-btn';
    btn.setAttribute('data-table', tableId);
    btn.setAttribute('aria-label', 'Line selection');
    btn.title = `Line filter: draw a line on a plot of ${rows}. The side to the right of the line is filtered out of this table.`;
    btn.innerHTML = '<i class="fas fa-slash" aria-hidden="true"></i><span class="az-line-select-text">Line filter</span>';
    btn.addEventListener('click', () => toggleLineSelect(tableId, rows));
    btn.classList.toggle('active', isLineSelectArmed(tableId));
    btn.setAttribute('aria-pressed', String(isLineSelectArmed(tableId)));
    return btn;
}

/** Arm the tool for a table, or leave it when it is armed from that table. */
export function toggleLineSelect(tableId, rows) {
    if (isLineSelectArmed(tableId)) {
        leaveLineSelect();
        return;
    }
    leaveLineSelect();
    arm(tableId, rows);
}

/** Leave the tool: the layers go, the buttons are released. */
export function leaveLineSelect() {
    if (!active) return;
    const was = active;
    active = null;
    cancelAnimationFrame(was.frame);
    document.removeEventListener('keydown', was.onKey, true);
    document.removeEventListener('keyup', was.onKeyUp, true);
    document.removeEventListener('mousemove', showTip, true);
    was.listeners.abort();
    document.getElementById('line-select-tip')?.remove();
    for (const o of was.overlays.values()) o.el.remove();
    was.overlays.clear();
    document.getElementById('line-select-badge')?.remove();
    for (const el of document.querySelectorAll('.az-line-armed')) el.classList.remove('az-line-armed');
    syncButtons();
}

/** Why the tool must stop: its table was closed, rebuilt (a panel set, a link, Close all) or the dataset changed. */
function targetGone(state) {
    const panel = PanelManager.getPanel(state.tableId);
    if (!panel || panel !== state.panel) return true;
    if (!PanelManager.getAllActivePanels().includes(panel)) return true;
    const box = document.getElementById(`table-container-${state.tableId}`);
    if (!box || !box.isConnected) return true;
    return DataManager.getCurrentDataset() !== state.dataset;
}

/** The red badge in the dataset bar, and the red frame round the target table's tile. */
function showArmed(state) {
    const panel = state.panel;
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.id = 'line-select-badge';
    badge.className = 'btn btn-sm az-line-badge';
    badge.title = badgeHelp(state.rows);
    badge.setAttribute('aria-label', `Line filter on: ${panel.getTitle()}. Click to stop.`);
    badge.innerHTML = '<i class="fas fa-slash" aria-hidden="true"></i> Line filter on: <span class="az-line-badge-name"></span> <i class="fas fa-xmark" aria-hidden="true"></i>';
    badge.querySelector('.az-line-badge-name').textContent = panel.getTitle();
    badge.addEventListener('click', () => leaveLineSelect());
    const host = document.querySelector('#dataset-stats .dataset-bar');
    const anchor = document.getElementById('theme-toggle');
    if (host) host.insertBefore(badge, anchor && anchor.parentNode === host ? anchor : null);
    const tile = document.querySelector(`.tile[data-tile-id="${CSS.escape(state.tableId)}"]`);
    if (tile) tile.classList.add('az-line-armed');
    // the badge names the table as its tile's title field does, while it is typed and once it is set
    const field = tile && tile.querySelector('.tile-title');
    if (field) {
        const follow = () => {
            const name = field.value || panel.getTitle();
            badge.querySelector('.az-line-badge-name').textContent = name;
            badge.setAttribute('aria-label', `Line filter on: ${name}. Click to stop.`);
        };
        field.addEventListener('input', follow, { signal: state.listeners.signal });
        field.addEventListener('change', follow, { signal: state.listeners.signal });
    }
}

function arm(tableId, rows) {
    const state = {
        panel: PanelManager.getPanel(tableId), dataset: DataManager.getCurrentDataset(),
        listeners: new AbortController(), tableId, rows, overlays: new Map(), modes: new Map(), warn: new Map(), frame: 0, drag: null, busy: false,
        onKey: null, onKeyUp: null
    };
    state.onKey = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            stopFromEscape();
        } else if (e.key === 'Shift' && active && active.drag) {
            active.drag.shift = true;
            movePreview();
        }
    };
    state.onKeyUp = (e) => {
        if (e.key === 'Shift' && active && active.drag) {
            active.drag.shift = false;
            movePreview();
        }
    };
    if (!state.panel) return;
    active = state;
    showArmed(state);
    document.addEventListener('keydown', state.onKey, true);
    document.addEventListener('keyup', state.onKeyUp, true);
    document.addEventListener('mousemove', showTip, true);
    syncButtons();
    const tick = () => {
        if (active !== state) return;
        if (targetGone(state)) { leaveLineSelect(); return; }
        reconcile();
        state.frame = requestAnimationFrame(tick);
    };
    tick();
}

/** Escape: drop the line being drawn, whose release then does nothing, and leave the tool. */
function stopFromEscape() {
    const drag = active && active.drag;
    if (drag) {
        drag.cancelled = true;
        // the release of the drag that was dropped (and the click it makes) must reach nothing
        const types = ['pointerup', 'mouseup', 'click'];
        const swallow = (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (e.type === 'pointerup') setTimeout(done, 0);
        };
        const done = () => { for (const type of types) window.removeEventListener(type, swallow, true); };
        for (const type of types) window.addEventListener(type, swallow, true);
        // a release that never comes (outside the window) must not leave them behind
        setTimeout(done, 5000);
    }
    leaveLineSelect();
}

/**
 * One layer over each plot of the table's kind that takes a line. A plot the tool does not apply to
 * (3D, large, not drawn yet) gets nothing: no layer, no message, and the mouse is its own. A 2D plot
 * it cannot use (a text, date or log axis) gets no layer either, only a light tooltip (showTip).
 */
function reconcile() {
    const { rows, overlays, warn } = active;
    const panels = PanelManager.getPanelsByType(PLOT_TYPE[rows]) || [];
    const seen = new Set();
    const now = performance.now();
    for (const panel of panels) {
        const gd = plotDiv(panel);
        if (!gd || !gd.isConnected) continue;
        const id = panel.getId();
        seen.add(id);
        let o = overlays.get(id);
        // the plot may be redrawn with other axes: looked at a few times a second, and not under a drag
        let m = active.modes.get(id);
        if (!m || (now - m.checked > 250 && !(o && o.drag))) {
            m = { ...modeOf(panel, rows), checked: now };
            active.modes.set(id, m);
        }
        if (m.mode === 'warn') warn.set(id, { gd, why: m.why }); else warn.delete(id);
        if (m.mode !== 'ok') {
            if (o && !o.drag) { o.el.remove(); overlays.delete(id); }
            continue;
        }
        if (!o) {
            o = makeOverlay(panel);
            overlays.set(id, o);
        }
        place(o, gd);
    }
    for (const [id, o] of overlays) {
        if (!seen.has(id)) { o.el.remove(); overlays.delete(id); }
    }
    for (const id of [...warn.keys()]) if (!seen.has(id)) warn.delete(id);
}

/** A light tooltip near the mouse over a plot the tool cannot use; it blocks nothing. */
function showTip(e) {
    if (!active) return;
    let hit = null;
    for (const { gd, why } of active.warn.values()) {
        const r = gd.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
            && gd.contains(e.target)) { hit = why; break; }
    }
    let tip = document.getElementById('line-select-tip');
    if (!hit) { if (tip) tip.remove(); return; }
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'line-select-tip';
        tip.className = 'az-line-tip';
        tip.setAttribute('role', 'tooltip');
        document.body.appendChild(tip);
    }
    if (tip.textContent !== hit) tip.textContent = hit;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(4, Math.min(e.clientX + 14, window.innerWidth - w - 4))}px`;
    const h = tip.offsetHeight;
    tip.style.top = `${e.clientY + 18 + h > window.innerHeight ? e.clientY - 12 - h : e.clientY + 18}px`;
}

/** The ancestors of a plot that clip it (a scrolled tile, a pane). */
function clippers(gd) {
    const out = [];
    for (let el = gd.parentElement; el && el !== document.body; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') out.push(el);
    }
    return out;
}

/** The part of the plot's rectangle that shows, as {left, top, right, bottom}. */
function visibleBox(gd, clips) {
    const r = gd.getBoundingClientRect();
    const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (const el of clips) {
        const c = el.getBoundingClientRect();
        box.left = Math.max(box.left, c.left);
        box.top = Math.max(box.top, c.top);
        box.right = Math.min(box.right, c.right);
        box.bottom = Math.min(box.bottom, c.bottom);
    }
    return { box, r };
}

/** Put a layer over the part of its plot that shows (a plot in a scrolled tile is cut at the tile's edge). */
function place(o, gd) {
    const now = performance.now();
    if (!o.clips || now - (o.checked || 0) > 250) {
        o.clips = clippers(gd);
        o.checked = now;
    }
    const { box, r } = visibleBox(gd, o.clips);
    const w = box.right - box.left, h = box.bottom - box.top;
    const visible = r.width > 0 && r.height > 0 && w > 0 && h > 0;
    o.el.style.display = visible ? '' : 'none';
    const key = `${box.left}|${box.top}|${w}|${h}|${r.left}|${r.top}|${r.width}|${r.height}`;
    if (key === o.key) return;
    // the plot moved or changed size under a line being drawn (a resize, the table above growing)
    if (o.drag && o.key) cancelDrag(o);
    o.key = key;
    Object.assign(o.el.style, {
        left: `${box.left}px`, top: `${box.top}px`, width: `${Math.max(w, 0)}px`, height: `${Math.max(h, 0)}px`
    });
    // the drawing is placed on the whole plot, of which the layer shows a part
    Object.assign(o.svg.style, { left: `${r.left - box.left}px`, top: `${r.top - box.top}px` });
    o.svg.setAttribute('width', r.width);
    o.svg.setAttribute('height', r.height);
}

function svgEl(name, attrs = {}) {
    const el = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
}

function makeOverlay(panel) {
    const el = document.createElement('div');
    el.className = 'az-line-overlay';
    el.setAttribute('role', 'img');
    el.setAttribute('data-plot', panel.getId());
    const svg = svgEl('svg', { class: 'az-line-svg', 'aria-hidden': 'true' });
    const shade = svgEl('polygon', { class: 'az-line-shade' });
    const line = svgEl('line', { class: 'az-line-line' });
    const a = svgEl('circle', { class: 'az-line-end', r: 4 });
    const b = svgEl('circle', { class: 'az-line-end', r: 4 });
    svg.append(shade, line, a, b);
    const msg = document.createElement('div');
    msg.className = 'az-line-msg';
    el.append(svg, msg);
    document.body.appendChild(el);
    const o = { panel, el, svg, shade, line, a, b, msg, key: '', drag: null };
    msg.textContent = HINT;
    el.setAttribute('aria-label', HINT);
    hidePreview(o);
    el.addEventListener('pointerdown', (e) => onDown(o, e));
    el.addEventListener('pointermove', (e) => onMove(o, e));
    el.addEventListener('pointerup', (e) => onUp(o, e));
    el.addEventListener('pointercancel', () => cancelDrag(o));
    return o;
}

function hidePreview(o) {
    for (const n of [o.shade, o.line, o.a, o.b]) n.style.display = 'none';
}

function cancelDrag(o) {
    o.drag = null;
    if (active) active.drag = null;
    hidePreview(o);
}

/** The geometry of a plot's area, read when a line starts. */
function geometry(o) {
    const gd = plotDiv(o.panel);
    const fl = gd._fullLayout;
    const r = gd.getBoundingClientRect();
    const xa = fl.xaxis, ya = fl.yaxis;
    return {
        left: r.left + xa._offset, top: r.top + ya._offset, w: xa._length, h: ya._length,
        ox: xa._offset, oy: ya._offset,
        xr: xa.range.slice(), yr: ya.range.slice(),
        xm: axisMap(xa.range, xa._length, false), ym: axisMap(ya.range, ya._length, true)
    };
}

function onDown(o, e) {
    if (e.button !== 0 || !active || active.busy) return;
    e.preventDefault();
    const geo = geometry(o);
    const p = { x: e.clientX - geo.left, y: e.clientY - geo.top };
    if (p.x < 0 || p.y < 0 || p.x > geo.w || p.y > geo.h) return;
    o.el.setPointerCapture(e.pointerId);
    o.drag = active.drag = { o, geo, p1: p, raw: p, p2: p, shift: e.shiftKey, cancelled: false };
    movePreview();
}

function onMove(o, e) {
    const d = o.drag;
    if (!d || d.cancelled) return;
    d.raw = { x: e.clientX - d.geo.left, y: e.clientY - d.geo.top };
    d.shift = e.shiftKey;
    movePreview();
}

/** The end of the line: where the mouse is, snapped with Shift, inside the plot area. */
function endOf(d) {
    const { w, h } = d.geo;
    const clamp = (p) => ({ x: Math.min(Math.max(p.x, 0), w), y: Math.min(Math.max(p.y, 0), h) });
    const p = d.shift ? fitInside(d.p1, snap45(d.p1, d.raw), w, h) : clamp(d.raw);
    return p;
}

/** Draw the line and the side that is filtered out. */
function movePreview() {
    const d = active && active.drag;
    if (!d || d.cancelled) return;
    const o = d.o;
    d.p2 = endOf(d);
    const { geo, p1, p2 } = d;
    const cond = lineCondition(p1, p2, geo.xm, geo.ym);
    if (!cond) { hidePreview(o); return; }
    for (const n of [o.shade, o.line, o.a, o.b]) n.style.display = '';
    const at = (p) => `${p.x + geo.ox},${p.y + geo.oy}`;
    o.shade.setAttribute('points', rightPolygon(p1, p2, geo.w, geo.h).map(at).join(' '));
    const seg = clipLine(p1, p2, geo.w, geo.h) || [p1, p2];
    o.line.setAttribute('x1', seg[0].x + geo.ox);
    o.line.setAttribute('y1', seg[0].y + geo.oy);
    o.line.setAttribute('x2', seg[1].x + geo.ox);
    o.line.setAttribute('y2', seg[1].y + geo.oy);
    o.a.setAttribute('cx', p1.x + geo.ox);
    o.a.setAttribute('cy', p1.y + geo.oy);
    o.b.setAttribute('cx', p2.x + geo.ox);
    o.b.setAttribute('cy', p2.y + geo.oy);
}

async function onUp(o, e) {
    const d = o.drag;
    if (!d) return;
    if (o.el.hasPointerCapture(e.pointerId)) o.el.releasePointerCapture(e.pointerId);
    if (d.cancelled) { cancelDrag(o); return; }
    // the axes were zoomed or the plot redrawn since the line began: the points mean something else now
    const now = geometry(o);
    const same = (a, b) => a[0] === b[0] && a[1] === b[1];
    if (now.left !== d.geo.left || now.top !== d.geo.top || now.w !== d.geo.w || now.h !== d.geo.h
        || !same(now.xr, d.geo.xr) || !same(now.yr, d.geo.yr)) { cancelDrag(o); return; }
    d.raw = { x: e.clientX - d.geo.left, y: e.clientY - d.geo.top };
    d.shift = e.shiftKey;
    d.p2 = endOf(d);
    const cond = lineCondition(d.p1, d.p2, d.geo.xm, d.geo.ym);
    cancelDrag(o);
    if (!cond) return;
    const state = active;
    state.busy = true;
    try {
        await commit(state, o.panel, cond);
    } catch (error) {
        console.error('Line selection failed:', error);
        notify('Line selection failed', error.message || 'The line could not be added to the table.', 'error');
    } finally {
        state.busy = false;
    }
}

/** The table's condition, in words, for the notice. */
function describe(cond, column) {
    const op = cond.op === '<=' ? '≤' : '≥';
    const value = cond.kind === 'slope' ? cond.b : cond.value;
    return `${column.key || column} ${op} ${value}`;
}

/** Hand the line to the table, then link the plot to it when it is not linked. */
async function commit(state, plot, cond) {
    const table = PanelManager.getPanel(state.tableId);
    if (!table || !table.applyLine) return;
    const cfg = plot.getConfig();
    const added = await table.applyLine({ x: columnRef(cfg.x), y: columnRef(cfg.y), cond });
    if (!cfg.tableFilter || cfg.tableFilter === 'none') linkPlot(plot, state.tableId);
    notify('Line added to ' + table.getTitle(), `Kept: ${describe(cond, added.column)}`, 'info');
}

/** Select the table in the plot's table filter, as the user would. */
function linkPlot(plot, tableId) {
    const select = document.querySelector(`#table-filter-${CSS.escape(plot.getId())}`)
        || document.querySelector(`.tile[data-tile-id="${CSS.escape(plot.getId())}"] select.table-filter-select`);
    if (select && Array.from(select.options).some(opt => opt.value === tableId)) {
        select.value = tableId;
        jQuery(select).trigger('change');
        return;
    }
    plot.setConfig({ tableFilter: tableId });
    if (plot.onDataUpdate) plot.onDataUpdate('tableChanged', { id: tableId });
}
