/**
 * Legend options of a categorical colouring: the size of the dots, the number
 * of columns and the title.
 *
 * Dots. Plotly's `itemsizing: 'constant'` (the default here) draws every
 * legend symbol 12 px wide whatever the trace's marker size; `'trace'` draws
 * it at the trace's marker size, up to 16 px. So the legend entries are the
 * proxy traces of plot-make-helper.js (full opacity, no points) and a dot
 * size set in Plot Options switches the legend to `'trace'` and gives the
 * proxies that size. Unset, the legend is the constant one it always was.
 *
 * Columns. Plotly 2.20 has no column count for a legend, but a horizontal
 * legend with `traceorder: 'grouped'` lays its legend groups side by side,
 * the entries of a group stacked, each group as wide as its widest entry.
 * So N columns are N groups: the legend's proxy traces, in their order, are
 * dealt into N consecutive chunks and each chunk gets `legendgroup:
 * 'azcol<i>'` (`assignColumns`). The column's entries read down, the columns
 * are compact, and wrap onto a new row of columns only where the legend runs
 * out of width.
 *
 * The category an entry stands for is its legend group (it ties the entry to
 * the points it shows and hides, and keeps what the legend hides across a
 * redraw: legend-entries.js). A proxy moved to a column keeps that group in
 * `azKey`, which `legendKey` reads first. `groupclick: 'toggleitem'` makes
 * Plotly toggle the clicked proxy alone, so after every draw the points of a
 * category are shown or hidden to match their entry (`mirrorEntries`), and a
 * double click isolates the category (`legendDoubleClick`), as Plotly does
 * for groups. The title is kept above the entries (`title.side`, always). One column
 * changes no group: the legend is as it always was.
 *
 * `assignColumns` and the settings readers are pure;
 * annzarro/tests/js/legend-options.test.mjs runs them in Node.
 */
import { colourTitle } from './plot-titles.js';
import { legendKey } from './legend-entries.js';

/** Legend symbols: Plotly draws them at the marker size up to 16 px; 12 px is what the constant legend draws. */
export const DOT_SIZE_MIN = 2;
export const DOT_SIZE_MAX = 16;
export const DOT_SIZE_AUTO = 12;
export const COLUMNS_MAX = 8;

/** The dot size set in Plot Options (px), or null: the constant legend, as before the option. */
export function legendDotSize(settings) {
    const n = settings && settings.legendDotSize;
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(DOT_SIZE_MIN, Math.min(DOT_SIZE_MAX, Math.round(n))) : null;
}

/**
 * The marker size of a legend proxy: the dot size, else 12 px, which is what a constant legend draws whatever
 * the size is. (It was the plot's point size, which the automatic size changes after the proxies are built:
 * a figure drawn from a config and one changed in Plot Options then differed in a size nothing shows.)
 */
export function proxyMarkerSize(settings) {
    return legendDotSize(settings) ?? DOT_SIZE_AUTO;
}

/** The number of legend columns: 1 unless set to 2 or more. */
export function legendColumns(settings) {
    const n = settings && settings.legendColumns;
    return typeof n === 'number' && n >= 2 ? Math.min(COLUMNS_MAX, Math.round(n)) : 1;
}

/** The legend's orientation: its position's, but horizontal for several columns. */
export function legendOrientation(base, settings) {
    return legendColumns(settings) > 1 ? 'h' : base;
}

/** Width of a space, in em, by font family (the families Plot Options offers); Arial's for any other. */
const SPACE_EM = [[/courier|mono/i, 0.6], [/times/i, 0.25], [/georgia/i, 0.241], [/trebuchet/i, 0.301], [/verdana/i, 0.352]];

/** Px from the legend's left edge to where an entry's label starts: the symbol (`itemwidth`, 30) and its padding. */
export const LABEL_INDENT = 38;

/** The spaces that put the first letter of a title in the title's font at `indent` px from its left edge. */
export function titleIndent(fontFamily, titleSize, indent = LABEL_INDENT) {
    const hit = SPACE_EM.find(([re]) => re.test(fontFamily || ''));
    const space = (hit ? hit[1] : 0.278) * titleSize;
    return '\u00a0'.repeat(Math.max(0, Math.round(indent / space)));
}

/**
 * The legend title: the colouring's name, empty when the title is switched off. Plotly sets a title flush
 * left, a little left of the symbols and with no room below it, so it is indented (non-breaking spaces) to
 * start where the labels start and followed by a blank line, a gap that grows with the font.
 */
export function legendTitleText(settings) {
    if (settings.showLegendTitle === false) return '';
    const text = colourTitle(settings.color);
    if (!text) return '';
    return `${titleIndent(settings.fontFamily, (settings.fontSize || 12) + 2)}${text}<br>\u00a0`;
}

/** The legend options a figure's layout carries (the builders' nested `layout`; edits it in place). */
export function legendOptionsIntoLayout(layout, settings) {
    const lg = layout.legend = { ...(layout.legend || {}) };
    lg.itemsizing = legendDotSize(settings) === null ? 'constant' : 'trace';
    lg.title = { ...(lg.title || {}), text: legendTitleText(settings) };
    lg.title.side = 'top';
    if (legendColumns(settings) > 1) Object.assign(lg, COLUMN_LAYOUT);
    if (lg.orientation) lg.orientation = legendOrientation(lg.orientation, settings);
    layout.meta = { ...(layout.meta || {}), azLegendColumns: legendColumns(settings) };
    return layout;
}

/** The same as relayout keys, for a graph already drawn. */
export function legendOptionKeys(settings) {
    return {
        'legend.itemsizing': legendDotSize(settings) === null ? 'constant' : 'trace',
        'legend.title.text': legendTitleText(settings),
        'legend.title.side': 'top',
        'legend.traceorder': legendColumns(settings) > 1 ? COLUMN_LAYOUT.traceorder : null,
        'legend.groupclick': legendColumns(settings) > 1 ? COLUMN_LAYOUT.groupclick : null,
        'meta.azLegendColumns': legendColumns(settings)
    };
}

const PROXY = 'az-legend';
/** The legend layout of several columns, besides a horizontal orientation. */
const COLUMN_LAYOUT = Object.freeze({ traceorder: 'grouped', groupclick: 'toggleitem' });

/** Put the legend options on a drawn graph: the proxies' dot size, the layout keys; `orientation` is the position's. */
export function applyLegendOptions(gd, settings, orientation) {
    if (!gd || !Array.isArray(gd.data) || typeof Plotly === 'undefined') return Promise.resolve();
    const size = proxyMarkerSize(settings);
    const idx = [];
    gd.data.forEach((t, i) => { if (t && t.meta === PROXY && !(t.marker && t.marker.size === size)) idx.push(i); });
    const keys = legendOptionKeys(settings);
    if (orientation) keys['legend.orientation'] = legendOrientation(orientation, settings);
    const work = [Plotly.relayout(gd, keys)];
    if (idx.length) work.push(Plotly.restyle(gd, { 'marker.size': size }, idx));
    return Promise.all(work).then(() => syncLegendColumns(gd));
}

/** The legend proxies of `traces` in the order the legend shows them (Plotly's default legend rank is 1000). */
function proxiesInOrder(traces) {
    return (Array.isArray(traces) ? traces : [])
        .map((t, i) => [t, i])
        .filter(([t]) => t && t.meta === PROXY && t.showlegend !== false)
        .sort((a, b) => ((a[0].legendrank ?? 1000) - (b[0].legendrank ?? 1000)) || (a[1] - b[1]))
        .map(([t]) => t);
}

/** Entries per column for `count` entries in `columns` columns: as even as can be, the first columns longer. */
export function columnSizes(count, columns) {
    const n = Math.max(1, Math.min(columns, count));
    const base = Math.floor(count / n), extra = count % n;
    return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Deal the legend proxies of `traces` into `columns` legend groups, or, for one column, give every
 * proxy its own category's group back. Edits `traces` in place.
 * @returns {boolean} whether any trace changed
 */
export function assignColumns(traces, columns) {
    const proxies = proxiesInOrder(traces);
    let changed = false;
    const put = (t, group) => {
        if (t.azKey === undefined && group !== t.legendgroup) t.azKey = t.legendgroup || t.name;
        if (t.legendgroup !== group) { t.legendgroup = group; changed = true; }
    };
    if (columns > 1) {
        let at = 0;
        columnSizes(proxies.length, columns).forEach((size, c) => {
            for (let k = 0; k < size; k++) put(proxies[at++], `azcol${c}`);
        });
    } else {
        for (const t of proxies) {
            if (t.azKey === undefined) continue;
            t.legendgroup = t.azKey;
            delete t.azKey;
            changed = true;
        }
    }
    return changed;
}

/** The figure about to be drawn with the columns its layout asks for (drawPlot, plotly-batch.js). */
export function withLegendColumns(traces, layout) {
    const columns = (layout && layout.meta && layout.meta.azLegendColumns) || 1;
    assignColumns(traces, columns);
    return traces;
}

/** The traces of `gd` that stand for the same category as `trace`. */
function categoryTraces(gd, trace) {
    const key = legendKey(trace);
    const out = [];
    gd.data.forEach((t, i) => { if (t && legendKey(t) === key) out.push(i); });
    return out;
}

const hidden = (t) => t.visible === 'legendonly';

/**
 * A double click on an entry of a legend in columns shows only that category, or all again when only that
 * one is shown. (Plotly's own isolates the clicked trace alone, and with `groupclick: 'toggleitem'` that
 * hides the category's points.) Returns false: the default is not wanted.
 */
export function legendDoubleClick(gd, event) {
    const columns = (gd.layout && gd.layout.meta && gd.layout.meta.azLegendColumns) || 1;
    const clicked = gd.data[event.curveNumber];
    if (columns < 2 || !clicked || clicked.meta !== PROXY) return true;
    const own = categoryTraces(gd, clicked);
    const entries = proxiesInOrder(gd.data).map(legendKey);
    const all = [];
    gd.data.forEach((t, i) => { if (t && entries.includes(legendKey(t))) all.push(i); });
    const others = all.filter(i => !own.includes(i));
    const isolated = others.every(i => hidden(gd.data[i])) && !hidden(clicked);
    const visible = all.map(i => (isolated || own.includes(i) ? true : 'legendonly'));
    Plotly.restyle(gd, { visible }, all);
    return false;
}

/**
 * The points of a category follow its legend entry: a click on an entry toggles the entry alone
 * (`groupclick: 'toggleitem'`), and its points are shown or hidden to match, here, after the draw.
 */
export function mirrorEntries(gd) {
    const idx = [], visible = [];
    for (const proxy of proxiesInOrder(gd.data)) {
        const want = hidden(proxy) ? 'legendonly' : true;
        for (const i of categoryTraces(gd, proxy)) {
            const t = gd.data[i];
            if (t === proxy || t.meta === PROXY || t.visible === false) continue;
            if (hidden(t) !== (want === 'legendonly')) { idx.push(i); visible.push(want); }
        }
    }
    return idx.length ? Plotly.restyle(gd, { visible }, idx) : null;
}

const _setting = new WeakSet();

/** Bring the proxies of a drawn graph to the columns its layout asks for, and the points to their entries. */
export function syncLegendColumns(gd) {
    if (!gd || !Array.isArray(gd.data) || !gd.layout || _setting.has(gd) || typeof Plotly === 'undefined') return Promise.resolve();
    const columns = (gd.layout.meta && gd.layout.meta.azLegendColumns) || 1;
    const regrouped = assignColumns(gd.data, columns);
    const mirrored = !regrouped && columns > 1 ? mirrorEntries(gd) : null;
    if (!regrouped && !mirrored) return Promise.resolve();
    _setting.add(gd);
    return Promise.resolve(regrouped ? Plotly.redraw(gd) : mirrored).catch(() => {}).finally(() => _setting.delete(gd));
}

const _listeners = new WeakMap();

/** Sort the proxies into columns now and after every redraw; the points follow their entries, a double click isolates a category. */
export function watchLegendColumns(gd) {
    if (!gd) return;
    syncLegendColumns(gd);
    if (typeof gd.on !== 'function') return;
    let fns = _listeners.get(gd);
    if (fns && typeof gd.removeListener === 'function') {
        gd.removeListener('plotly_afterplot', fns.after);
        gd.removeListener('plotly_legenddoubleclick', fns.dbl);
    }
    fns = { after: () => syncLegendColumns(gd), dbl: (e) => legendDoubleClick(gd, e) };
    _listeners.set(gd, fns);
    gd.on('plotly_afterplot', fns.after);
    gd.on('plotly_legenddoubleclick', fns.dbl);
}
