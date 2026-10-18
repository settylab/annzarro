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
 * Columns. Plotly 2.20 has no column count for a legend. A horizontal legend
 * wraps its entries into a grid of equal-width columns, as many as fit in
 * `_maxWidth` (half the graph's width for a legend beside the plot, else the
 * plot's width), and `entrywidth` (px) sets the width of an entry's text. So
 * N columns are a horizontal legend whose entries are as wide as N of them
 * fit and N + 1 do not (`columnEntryWidth`), at least as wide as the longest
 * label. Labels too long for N columns give fewer. That width is the least
 * that gives N columns and no more: a horizontal legend fills the width it
 * wraps at, so narrower entries would give more columns (Plotly 2.20 has no
 * second legend, no `maxwidth`, and no break between rows that does not
 * widen the legend). The title is kept above the entries (`title.side`). The width depends on the
 * graph as drawn, so `watchLegendColumns` sets it after every draw (as
 * legend-below.js does for a legend below the plot). The column count is kept
 * in `layout.meta.azLegendColumns`, which Plotly keeps with the layout.
 *
 * `columnEntryWidth` and the settings readers are pure;
 * annzarro/tests/js/legend-options.test.mjs runs them in Node.
 */
import { colourTitle } from './plot-titles.js';

/** Legend symbols: Plotly draws them at the marker size up to 16 px; 12 px is what the constant legend draws. */
export const DOT_SIZE_MIN = 2;
export const DOT_SIZE_MAX = 16;
export const DOT_SIZE_AUTO = 12;
export const COLUMNS_MAX = 8;

/** Px Plotly adds to an entry's text width: the symbol (`itemwidth`) and its gaps. */
const ENTRY_GAPS = 15;
const DEFAULT_ITEMWIDTH = 30;

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

/** The legend title: the colouring's name, empty when the title is switched off. */
export function legendTitleText(settings) {
    return settings.showLegendTitle === false ? '' : colourTitle(settings.color);
}

/**
 * The entry text width (px) that makes `columns` columns in a horizontal legend that wraps at `maxWidth`:
 * an entry advances by this plus the symbol, and N of them fit while N + 1 do not. Never narrower than the longest label.
 */
export function columnEntryWidth({ columns, maxWidth, textWidth, itemwidth = DEFAULT_ITEMWIDTH }) {
    const ideal = maxWidth / (columns + 1) + 2 - (itemwidth + ENTRY_GAPS);
    return Math.ceil(Math.max(textWidth || 0, ideal));
}

/** The width a horizontal legend wraps at in Plotly 2.20: half the graph beside the plot, else the plot's width. */
export function legendMaxWidth(fullLayout) {
    const lg = fullLayout.legend || {};
    const beside = lg.x < 0 || lg.x > 1;
    return beside ? fullLayout.width / 2 : fullLayout._size.w;
}

/** The legend options a figure's layout carries (the builders' nested `layout`; edits it in place). */
export function legendOptionsIntoLayout(layout, settings) {
    const lg = layout.legend = { ...(layout.legend || {}) };
    lg.itemsizing = legendDotSize(settings) === null ? 'constant' : 'trace';
    lg.title = { ...(lg.title || {}), text: legendTitleText(settings) };
    if (legendColumns(settings) > 1) lg.title.side = 'top';
    if (lg.orientation) lg.orientation = legendOrientation(lg.orientation, settings);
    layout.meta = { ...(layout.meta || {}), azLegendColumns: legendColumns(settings) };
    return layout;
}

/** The same as relayout keys, for a graph already drawn. */
export function legendOptionKeys(settings) {
    return {
        'legend.itemsizing': legendDotSize(settings) === null ? 'constant' : 'trace',
        'legend.title.text': legendTitleText(settings),
        'legend.title.side': legendColumns(settings) > 1 ? 'top' : null,
        'meta.azLegendColumns': legendColumns(settings)
    };
}

const PROXY = 'az-legend';

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

const _setting = new WeakSet();

/** Size the legend's entries for its column count, as drawn. Relayouts only when the width changes. */
export function syncLegendColumns(gd) {
    const L = gd && gd._fullLayout;
    if (!L || !L._size || !gd.layout || _setting.has(gd) || typeof Plotly === 'undefined') return Promise.resolve();
    const columns = (gd.layout.meta && gd.layout.meta.azLegendColumns) || 1;
    const have = (gd.layout.legend && gd.layout.legend.entrywidth) || 0;
    let want = 0;
    if (columns > 1 && L.showlegend && L.legend && L.legend.orientation === 'h') {
        let textWidth = 0;
        gd.querySelectorAll('.legend .legendtext').forEach(el => {
            try { textWidth = Math.max(textWidth, el.getBBox().width); } catch { /* not drawn */ }
        });
        want = columnEntryWidth({ columns, maxWidth: legendMaxWidth(L), textWidth, itemwidth: L.legend.itemwidth });
    }
    if (Math.abs(want - have) <= 2) return Promise.resolve();
    _setting.add(gd);
    return Promise.resolve(Plotly.relayout(gd, { 'legend.entrywidth': want || null }))
        .catch(() => {}).finally(() => _setting.delete(gd));
}

const _listeners = new WeakMap();

/** Size the legend for its columns now and after every redraw of the graph. */
export function watchLegendColumns(gd) {
    if (!gd) return;
    syncLegendColumns(gd);
    if (typeof gd.on !== 'function') return;
    let fn = _listeners.get(gd);
    if (fn && typeof gd.removeListener === 'function') gd.removeListener('plotly_afterplot', fn);
    fn = () => syncLegendColumns(gd);
    _listeners.set(gd, fn);
    gd.on('plotly_afterplot', fn);
}
