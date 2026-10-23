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
 * Columns. A legend in N columns is N Plotly legends (`legend`, `legend2`, ... Plotly 2.22), each
 * a vertical list as wide as its widest entry, side by side. The legend's proxy traces, in their
 * order, are dealt into consecutive chunks of ceil(n / N) and each chunk's traces (and the points
 * of the same categories) get `legend: 'legendK'` (`assignColumns`). The columns never wrap or
 * stack: they are placed in px from the widths Plotly measured, beside the plot, or centred over
 * or under it, with the margin they need (`placeColumns`, `syncLegendColumns`). The title is the first column's;
 * the others carry a blank one of the same height so that the entries line up. The columns take at
 * most 60 % of the width of the graph (the plot's width for a legend above or below), and a
 * legend wider than that has its longest labels cut short with an ellipsis (`fitLabels`), so the
 * plot keeps its room and nothing is clipped. Click and double click hide and isolate a category in
 * every column: its entry and its points share a legend group.
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
export const TITLE_SIZE_MIN = 6;
export const TITLE_SIZE_MAX = 48;
export const TITLE_GAP_MAX = 80;

/** The legend title's size (px): set in Plot Options, else 2 px above the text, as it has always been. */
export function legendTitleSize(settings) {
    const n = settings && settings.legendTitleSize;
    if (typeof n === 'number' && Number.isFinite(n)) return Math.max(TITLE_SIZE_MIN, Math.min(TITLE_SIZE_MAX, Math.round(n)));
    return settings && settings.fontSize ? settings.fontSize + 2 : 14;
}

/** The gap (px) between the title and the first entry set in Plot Options, or null: the blank line it always had. */
export function legendTitleGap(settings) {
    const n = settings && settings.legendTitleGap;
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(TITLE_GAP_MAX, Math.round(n))) : null;
}

/** Where the legend title sits across the legend: its left edge at the markers' or at the labels', centred, or right. */
export const TITLE_ALIGNS = Object.freeze(['markers', 'labels', 'centre', 'right']);

/** The title alignment set in Plot Options, or null: it follows the legend's position (`legendTitleAlign`). */
export function legendTitleAlignSetting(settings) {
    const v = settings && settings.legendTitleAlign;
    return TITLE_ALIGNS.includes(v) ? v : null;
}

/** The title alignment in effect: the one set, else centred over a legend above or below the plot and at the markers beside it. */
export function legendTitleAlign(settings) {
    const set = legendTitleAlignSetting(settings);
    if (set) return set;
    const pos = settings && settings.legendPosition;
    return pos === 'top' || pos === 'bottom' ? 'centre' : 'markers';
}

/** Plotly's `legend.title.side` for an alignment (a single legend aligns its own title). */
export function titleSide(align) {
    return align === 'centre' ? 'top center' : align === 'right' ? 'top right' : 'top';
}

/** Plotly's line height, in em: a line of the title's font is 1.3 times its size high. */
const LINE_EM = 1.3;

/** The gap (px) a blank line under a title of `size` px makes, which is the legend title's default. */
export function defaultTitleGap(settings) {
    return Math.round(LINE_EM * legendTitleSize(settings));
}

/**
 * How a set gap is made. Plotly spaces the lines of a title by the title element's font (1.3 times its
 * size) whatever size a span inside a line has, and the first line sits 4 px + 1.3 (P - S) below the top
 * of the legend for a text of size S in an element of size P. The title's text is a span of the title's
 * size S inside an element of a small size P, and the gap is `lines` blank lines of 1.3 P each:
 * P = gap / (1.3 lines), at least 1 px (Plotly takes no smaller font) and at most S. Where P is smaller
 * than S the text would start above the legend and be cut off, so `lead` blank lines of the small font go
 * above it to make the room (1.3 P each; the room is 1.3 (S - P) - 0.3 S + 3 px, which the measured
 * layout of Plotly 2.35 needs). 0 is no blank line. Unset: the title's own size and one blank line, as it
 * always was.
 * @returns {{lead: number, lines: number, size: number}|null} null when unset
 */
export function titleGapPlan(settings) {
    const gap = legendTitleGap(settings);
    if (gap === null) return null;
    const S = legendTitleSize(settings);
    if (gap === 0) return { lead: 0, lines: 0, size: S };
    const lines = Math.ceil(gap / (LINE_EM * S));
    const size = Math.min(S, Math.max(1, Math.round((gap / (LINE_EM * lines)) * 100) / 100));
    const room = LINE_EM * (S - size) - 0.3 * S + 3;
    const lead = size >= S || room <= 0 ? 0 : Math.ceil(room / (LINE_EM * size));
    return { lead, lines, size };
}

/** The font size of the legend title's element: the title's size, or, for a set gap, the line size of its plan. */
export function legendTitleFontSize(settings) {
    const plan = titleGapPlan(settings);
    return plan && plan.lines > 0 ? plan.size : legendTitleSize(settings);
}

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

/** The legend's orientation: its position's, but vertical for each of several columns. */
export function legendOrientation(base, settings) {
    return legendColumns(settings) > 1 ? 'v' : base;
}

/** Px between the legend's columns when none is set. */
export const COLUMN_GAP_DEFAULT = 24;
export const COLUMN_GAP_MAX = 80;

/** The space (px) between the columns of the legend: set in Plot Options, else 24. */
export function legendColumnGap(settings) {
    const n = settings && settings.legendColumnGap;
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(COLUMN_GAP_MAX, Math.round(n))) : COLUMN_GAP_DEFAULT;
}

/** Where each legend position puts the (first) legend: Plotly's keys, as the plot and its menu set them. */
export const LEGEND_POSITIONS = Object.freeze({
    right: Object.freeze({ orientation: 'v', x: 1.05, y: 0.5, xanchor: 'left', yanchor: 'middle' }),
    left: Object.freeze({ orientation: 'v', x: -0.05, y: 0.5, xanchor: 'right', yanchor: 'middle' }),
    // above the axes, growing upwards: Plotly makes the top margin it needs
    top: Object.freeze({ orientation: 'h', x: 0.5, y: 1, xanchor: 'center', yanchor: 'bottom' }),
    // below the axes' tick labels and title: legend-below.js sets y in px, as a paper fraction, once drawn
    bottom: Object.freeze({ orientation: 'h', x: 0.5, y: 0, xanchor: 'center', yanchor: 'top' })
});

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

/** Px from the legend's left edge, left of the title, to the left edge of a symbol of `marker` px: Plotly centres it in 30 px (`itemwidth`). */
export function markerIndent(marker) {
    return 18 - marker / 2;
}

/**
 * Px the legend title is moved right of where Plotly puts it (2 px from the legend's left edge): to the
 * markers' left edge, or to the labels'. Applied to the drawn title (`shiftLegendTitles`), not written
 * into its text, so the stored title stays the colouring's name.
 */
export function legendTitleShift(settings) {
    const align = legendTitleAlign(settings);
    return align === 'markers' ? markerIndent(proxyMarkerSize(settings)) : align === 'labels' ? LABEL_INDENT : 0;
}

/**
 * The legend title: the colouring's name, empty when the title is switched off. Plotly sets a title flush
 * left, a little left of the symbols and with no room below it, so it is indented (non-breaking spaces) to
 * start where the labels start and followed by a blank line, a gap that grows with the font. `blank` gives
 * a title of the same height with no text (the other columns of a legend in columns).
 */
export function legendTitleText(settings, blank = false) {
    if (settings.showLegendTitle === false) return '';
    const name = colourTitle(settings.color);
    if (!name) return '';
    const size = legendTitleSize(settings);
    const line = blank ? '\u00a0' : name;
    const plan = titleGapPlan(settings);
    if (!plan) return `${line}<br>\u00a0`;
    const lead = '\u00a0<br>'.repeat(plan.lead);
    if (plan.lines === 0) return `${lead}${line}`;
    return `${lead}<span style="font-size:${size}px">${line}</span>${'<br>\u00a0'.repeat(plan.lines)}`;
}

/** The same title with its text blanked (what the other columns of a legend in columns carry), from a title text as drawn. */
export function blankTitle(text) {
    if (typeof text !== 'string' || text === '') return '';
    return text.split(/(<[^>]*>)/).map(part => (part.startsWith('<') ? part : part.replace(/^(\u00a0*)[^\u00a0].*$/s, '$1\u00a0'))).join('');
}

/** The legend options a figure's layout carries (the builders' nested `layout`; edits it in place). */
export function legendOptionsIntoLayout(layout, settings) {
    const lg = layout.legend = { ...(layout.legend || {}) };
    lg.itemsizing = legendDotSize(settings) === null ? 'constant' : 'trace';
    lg.title = { ...(lg.title || {}), text: legendTitleText(settings) };
    lg.title.side = titleSide(legendTitleAlign(settings));
    lg.title.font = { ...(lg.title.font || {}), size: legendTitleFontSize(settings) };
    if (lg.orientation) lg.orientation = legendOrientation(lg.orientation, settings);
    layout.meta = { ...(layout.meta || {}), ...columnMeta(settings) };
    return layout;
}

/** What the legend's columns need to know of the settings, in the layout's `meta`. */
function columnMeta(settings) {
    return { azTitleAlign: legendTitleAlign(settings), azTitleShift: legendTitleShift(settings), azLegendColumns: legendColumns(settings), azLegendGap: legendColumnGap(settings), azLegendPosition: (settings && settings.legendPosition) || 'right' };
}

/** The title's text, side and alignment as relayout keys (they change with the alignment, the gap and the position). */
export function legendTitleKeys(settings) {
    const align = legendTitleAlign(settings);
    return { 'legend.title.text': legendTitleText(settings), 'legend.title.side': titleSide(align), 'meta.azTitleAlign': align, 'meta.azTitleShift': legendTitleShift(settings) };
}

/** The same as relayout keys, for a graph already drawn; `position` is the legend's position, `placed` what it was before. */
export function legendOptionKeys(settings) {
    return {
        'legend.itemsizing': legendDotSize(settings) === null ? 'constant' : 'trace',
        ...legendTitleKeys(settings),
        'legend.title.font.size': legendTitleFontSize(settings),
        'meta.azLegendColumns': legendColumns(settings),
        'meta.azLegendGap': legendColumnGap(settings),
        'meta.azLegendPosition': (settings && settings.legendPosition) || 'right'
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

/** The legend proxies of `traces` in the order the legend shows them (Plotly's default legend rank is 1000). */
function proxiesInOrder(traces) {
    return (Array.isArray(traces) ? traces : [])
        .map((t, i) => [t, i])
        .filter(([t]) => t && t.meta === PROXY && t.showlegend !== false)
        .sort((a, b) => ((a[0].legendrank ?? 1000) - (b[0].legendrank ?? 1000)) || (a[1] - b[1]))
        .map(([t]) => t);
}

/** `legend`, `legend2`, `legend3`, ...: the id of the legend of column `i` (from 0). */
export function legendId(i) {
    return i === 0 ? 'legend' : `legend${i + 1}`;
}

/** The ids of the legends a layout has: `legend`, then `legend2`, `legend3`, ... in order. */
export function legendIds(layout) {
    const ids = ['legend'];
    for (let i = 2; layout && layout[`legend${i}`]; i++) ids.push(`legend${i}`);
    return ids;
}

/** Entries per column: the entries in chunks of ceil(count / columns), the last column the rest. */
export function columnSizes(count, columns) {
    const n = Math.max(1, Math.min(columns, count));
    const per = Math.ceil(count / n);
    const sizes = [];
    for (let left = count; left > 0; left -= per) sizes.push(Math.min(per, left));
    return sizes;
}

/**
 * The legend each trace of `traces` is in, for `columns` columns: undefined for every trace when there is
 * one column (the default legend); else `legendK` for the legend proxies and the traces of their categories.
 */
function legendsFor(traces, columns) {
    const out = new Array(traces.length).fill(undefined);
    const proxies = proxiesInOrder(traces);
    if (columns < 2 || proxies.length < 2) return out;
    const key = new Map();
    let at = 0;
    columnSizes(proxies.length, columns).forEach((size, c) => {
        for (let k = 0; k < size; k++) key.set(legendKey(proxies[at++]), legendId(c));
    });
    traces.forEach((t, i) => { const id = t && key.get(legendKey(t)); if (id && (t.meta === PROXY || t.meta === 'az-points' || t.showlegend === false)) out[i] = id; });
    return out;
}

/** How many legends the entries of `traces` fill in `columns` columns. */
export function usedColumns(traces, columns) {
    const n = proxiesInOrder(traces).length;
    return columns < 2 || n < 2 ? 1 : columnSizes(n, columns).length;
}

/**
 * Put the legend proxies of `traces` (and the points of their categories) into `columns` legends, or, for
 * one column, back in the one legend. Edits `traces` in place.
 * @returns {boolean} whether any trace changed
 */
export function assignColumns(traces, columns) {
    const want = legendsFor(traces, columns);
    let changed = false;
    traces.forEach((t, i) => {
        if (!t || t.legend === want[i]) return;
        if (want[i] === undefined) delete t.legend; else t.legend = want[i];
        changed = true;
    });
    return changed;
}

/** The figure about to be drawn with the columns its layout asks for (drawPlot, plotly-batch.js). */
export function withLegendColumns(traces, layout) {
    const columns = (layout && layout.meta && layout.meta.azLegendColumns) || 1;
    assignColumns(traces, columns);
    if (layout) {
        const used = usedColumns(traces, columns);
        for (let k = 2; layout[`legend${k}`] || k <= used; k++) {
            if (k <= used) layout[`legend${k}`] = columnLegend(layout, k - 1);
            else delete layout[`legend${k}`];
        }
        if (used > 1) Object.assign(layout.legend = { ...(layout.legend || {}) }, rowKeysFor(layout, 0));
    }
    return traces;
}

// ---- placement ------------------------------------------------------------------------------------

/** The columns take at most this share of a graph's width (the plot's width, for a legend above or below it). */
export const COLUMNS_SHARE = 0.6;
/** Smallest space (px) between columns when they are squeezed, and between the legend and the graph's edge. */
export const MIN_COLUMN_GAP = 8;
export const EDGE_PAD = 8;
/** Space (px) between the plot and a legend beside it. */
export const PLOT_GAP = 12;
/** Room (px) the y-axis tick labels take, left of the plot, in front of a legend at the left. */
export const TICK_ROOM = 50;
/** Px of an entry beyond its label's text: the symbol and the padding. */
export const ENTRY_EXTRA = 46;

/**
 * The widths (px) the labels of each column may take, and the space between the columns, so that the columns
 * together take at most `cap` px. Narrow columns keep what they need; the rest is shared out equally.
 * @param {number[]} needs - the width each column needs (its widest entry, symbol included)
 * @returns {{gap: number, limits: number[]|null}} limits: per column the width it may take, null when all fit
 */
export function fitColumns(needs, gap, cap) {
    const k = needs.length;
    const sum = needs.reduce((a, b) => a + b, 0);
    if (sum + gap * (k - 1) <= cap) return { gap, limits: null };
    const tight = Math.min(gap, MIN_COLUMN_GAP);
    if (sum + tight * (k - 1) <= cap) return { gap: tight, limits: null };
    let budget = Math.max(cap - tight * (k - 1), k * 60);
    const limits = new Array(k).fill(0);
    let open = needs.map((_, i) => i);
    for (;;) {
        const share = budget / open.length;
        const small = open.filter(i => needs[i] <= share);
        if (!small.length) { open.forEach(i => { limits[i] = share; }); break; }
        small.forEach(i => { limits[i] = needs[i]; budget -= needs[i]; });
        open = open.filter(i => !small.includes(i));
        if (!open.length) break;
    }
    return { gap: tight, limits };
}

/** `text` cut to at most `max` px by `measure(text)`, ending in an ellipsis when it was cut. */
export function cutLabel(text, max, measure) {
    if (measure(text) <= max) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (measure(`${text.slice(0, mid)}\u2026`) <= max) lo = mid; else hi = mid - 1;
    }
    return `${text.slice(0, Math.max(1, lo))}\u2026`;
}

/** The length of the longest prefix all of `texts` share. */
function commonPrefix(texts) {
    if (!texts.length) return 0;
    let n = texts[0].length;
    for (const t of texts) { let i = 0; while (i < n && i < t.length && t[i] === texts[0][i]) i++; n = i; }
    return n;
}

/**
 * `text` cut to at most `max` px, keeping what tells it from `all` the labels of the legend: the prefix and
 * suffix they all share are shortened first (an ellipsis where something is dropped), the middle part that
 * differs is kept whole where it fits, and only then is it cut in the middle (head and tail kept).
 */
export function cutLabelAmong(text, max, measure, all) {
    if (measure(text) <= max) return text;
    const pre = commonPrefix(all);
    const rev = (t) => [...t].reverse().join('');
    const suf = commonPrefix(all.map(rev));
    const lp = Math.min(pre, text.length), ls = Math.min(suf, Math.max(0, text.length - lp));
    let kp = lp, ks = ls;
    const build = () => `${kp < lp ? '\u2026' : ''}${text.slice(lp - kp, text.length - ls + ks)}${ks < ls ? '\u2026' : ''}`;
    while (measure(build()) > max && (kp > 0 || ks > 0)) { if (kp >= ks) kp--; else ks--; }
    const body = build();
    if (measure(body) <= max) return body;
    // the differing part alone is too wide: its head and tail around an ellipsis
    let h = Math.ceil(body.length / 2), t = Math.floor(body.length / 2);
    const mid = () => `${body.slice(0, h)}\u2026${t ? body.slice(body.length - t) : ''}`;
    while (measure(mid()) > max && (h > 1 || t > 0)) { if (h > t) h--; else t--; }
    return mid();
}

/**
 * Where the legends of columns of `widths` px go, as Plotly's paper fractions (of the plot's width, from its
 * left edge) with the legends' anchors. At the `right` of the plot the columns start `PLOT_GAP` px from
 * it and take the margin they need; at the `left` they end `TICK_ROOM` + `PLOT_GAP` px from it (anchored
 * right); `top` and `bottom` centre them over or under the plot. Plotly makes the same margin from the
 * legends by itself (a legend at paper x = 1 + offset / width needs offset + its width), so the margin
 * set here is the one it would make, and the places are exact for the plot that margin leaves.
 * @param {{l: number, r: number}} margins - the margins the plot has now (px)
 * @param {{l: number, r: number}} base - the margins set for the plot, which the columns do not shrink
 * @returns {{legends: {x: number, xanchor: string}[], margin: {l?: number, r?: number}}}
 */
export function placeColumns({ position, widths, gap, width, margins, base }) {
    const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
    const lefts = [];
    let at = 0;
    for (const w of widths) { lefts.push(at); at += w + gap; }
    if (position === 'top' || position === 'bottom') {
        const plotW = width - margins.l - margins.r;
        const start = Math.max(0, (plotW - total) / 2);
        return { margin: {}, legends: lefts.map(l => ({ x: round((start + l) / plotW), xanchor: 'left' })) };
    }
    if (position === 'left') {
        const l = Math.max(base.l, total + EDGE_PAD + TICK_ROOM + PLOT_GAP);
        const plotW = width - l - margins.r;
        return { margin: { l }, legends: lefts.map((x, i) => ({ x: round(-(TICK_ROOM + PLOT_GAP + total - x - widths[i]) / plotW), xanchor: 'right' })) };
    }
    const r = Math.max(base.r, total + EDGE_PAD + PLOT_GAP);
    const plotW = width - margins.l - r;
    return { margin: { r }, legends: lefts.map(x => ({ x: round(1 + (PLOT_GAP + x) / plotW), xanchor: 'left' })) };
}

const round = (v) => Math.round(v * 10000) / 10000;

/** A column's legend (k from 1) for a layout whose first legend is `layout.legend`: the same, with a blank title. */
function columnLegend(layout, k) {
    const base = layout.legend || {};
    const out = { ...base };
    for (const key of PLACED) delete out[key];
    out.title = { ...(base.title || {}), text: blankTitle((base.title && base.title.text) || '') };
    const here = layout[legendId(k)] || {};
    const keep = {};
    for (const key of ['x', 'xanchor']) if (here[key] !== undefined) keep[key] = here[key];
    return { ...out, ...keep, ...rowKeysFor(layout, k) };
}

/**
 * The orientation and vertical placement of the legend of column `k`, by the legend's position: against the
 * top of the plot for a legend at its side, the position's own anchor above or below it. Column 0's y below
 * the plot is legend-below.js's; the other columns follow it.
 */
function rowKeysFor(layout, k) {
    const pos = (layout.meta && layout.meta.azLegendPosition) || 'right';
    const b = LEGEND_POSITIONS[pos] || LEGEND_POSITIONS.right;
    const lg = layout.legend || {};
    const side = pos === 'left' || pos === 'right';
    const keys = { orientation: 'v', xanchor: side ? b.xanchor : 'left', yanchor: side ? 'top' : b.yanchor };
    if (side) keys.y = 1;
    else if (pos === 'top') keys.y = 1;
    else if (k > 0) keys.y = lg.y ?? b.y;
    return keys;
}

let _measureCtx = null;

/** A function giving the px width of a text in the legend's font, by the canvas's own measure. */
function legendMeasure(gd) {
    const font = (gd._fullLayout && gd._fullLayout.legend && gd._fullLayout.legend.font) || (gd._fullLayout && gd._fullLayout.font) || {};
    if (!_measureCtx && typeof document !== 'undefined') _measureCtx = document.createElement('canvas').getContext('2d');
    if (!_measureCtx) return (t) => String(t).length * 7;
    _measureCtx.font = `${font.size || 12}px ${font.family || 'sans-serif'}`;
    return (t) => _measureCtx.measureText(String(t).replace(/<[^>]*>/g, '')).width;
}

const hidden = (t) => t.visible === 'legendonly';

/**
 * A double click on an entry of a legend in columns shows only that category, or all again when only that
 * one is shown. Plotly's own isolates among the traces of the clicked entry's legend; this one takes every
 * column's. Returns false: the default is not wanted.
 */
export function legendDoubleClick(gd, event) {
    const columns = (gd.layout && gd.layout.meta && gd.layout.meta.azLegendColumns) || 1;
    const clicked = gd.data[event.curveNumber];
    if (columns < 2 || !clicked || clicked.meta !== PROXY) return true;
    const key = legendKey(clicked);
    const entries = new Set(proxiesInOrder(gd.data).map(legendKey));
    const all = [];
    gd.data.forEach((t, i) => { if (t && t.visible !== false && entries.has(legendKey(t))) all.push(i); });
    const own = all.filter(i => legendKey(gd.data[i]) === key);
    const others = all.filter(i => !own.includes(i));
    const isolated = others.every(i => hidden(gd.data[i])) && !hidden(clicked);
    const visible = all.map(i => (isolated || own.includes(i) ? true : 'legendonly'));
    Plotly.restyle(gd, { visible }, all);
    return false;
}

const _setting = new WeakSet();
/** Passes of settling the columns (each relayout moves the plot, which moves what is measured). */
const MAX_PASSES = 6;

/** The margin (px) the plot has on `side` apart from the columns', and what the columns set (layout.meta.azColMargin). */
function baseMargin(layout, side) {
    const set = layout.meta && layout.meta.azColMargin && layout.meta.azColMargin[side];
    const now = layout.margin && layout.margin[side];
    if (set && now === set.set) return set.base;
    return typeof now === 'number' ? now : 80;
}

/**
 * Px the first legend's title reaches past the right edge of its box: the title is shifted right to the markers
 * (`shiftLegendTitles`), which Plotly does not count in the legend's width. Zero for a title drawn as an annotation.
 */
function titleOverhang(gd, used) {
    const meta = (gd.layout && gd.layout.meta) || {};
    if (typeof document === 'undefined' || !(Number(meta.azTitleShift) > 0)) return 0;
    if (used > 1 && (meta.azTitleAlign === 'centre' || meta.azTitleAlign === 'right')) return 0;
    const text = gd.querySelector('g.legend text[class$="titletext"]');
    const bg = gd.querySelector('g.legend rect.bg');
    if (!text || !bg) return 0;
    let right = -Infinity;
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!/\S/.test(n.textContent.replace(/\u00a0/g, ''))) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        right = Math.max(right, r.getBoundingClientRect().right);
    }
    return Number.isFinite(right) ? Math.max(0, Math.ceil(right - bg.getBoundingClientRect().right + 2)) : 0;
}

/** The placement keys of legends that are not the columns' own and must be left to their owners when comparing. */
const PLACED = ['x', 'xanchor', 'y', 'yanchor'];

const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.0005 : a === b);

/** `legend` object without its placement, to compare what a column's legend is. */
function withoutPlace(o) {
    const out = {};
    for (const k of Object.keys(o || {}).sort()) if (!PLACED.includes(k)) out[k] = o[k];
    return JSON.stringify(out);
}

/**
 * What to change on a drawn graph to bring its legends to the columns `gd.layout.meta` asks for, in two
 * steps: first the structure (a legend per column, its title, the labels cut to the room, each trace's
 * legend), then, once that is drawn and Plotly has measured the legends, their places. Null when all is
 * as asked.
 * @returns {{relayout: Object, restyle: Array}|null}
 */
export function planLegendColumns(gd) {
    const L = gd.layout, FL = gd._fullLayout;
    if (!L || !FL || !FL._size || !Array.isArray(gd.data)) return null;
    const meta = L.meta || {};
    const columns = meta.azLegendColumns || 1;
    const used = usedColumns(gd.data, columns);
    const want = legendsFor(gd.data, columns);
    const relayout = {};
    const legendIdx = [], legendVal = [], nameIdx = [], nameVal = [];
    gd.data.forEach((t, i) => { if (t && t.legend !== want[i]) { legendIdx.push(i); legendVal.push(want[i] === undefined ? null : want[i]); } });
    const margin = { ...(meta.azColMargin || {}) };
    const setMargin = (side, value, base) => {
        if (value === undefined) {
            const was = margin[side];
            if (was && L.margin && L.margin[side] === was.set) relayout[`margin.${side}`] = was.base;
            delete margin[side];
        } else {
            if (!L.margin || L.margin[side] !== value) relayout[`margin.${side}`] = value;
            margin[side] = { set: value, base };
        }
    };
    const pos = meta.azLegendPosition || 'right';
    const proxies = proxiesInOrder(gd.data);

    const over = titleOverhang(gd, used);
    if (used < 2 && pos === 'right' && over > 0 && FL.legend && FL._size && FL.legend._width > 0) {
        // one legend whose shifted title is wider than its entries: room for the title past the box, in the margin
        for (let k = 2; L[`legend${k}`]; k++) relayout[`legend${k}`] = null;
        const baseM = { l: baseMargin(L, 'l'), r: baseMargin(L, 'r') };
        const placed = placeColumns({ position: 'right', widths: [FL.legend._width + over], gap: 0, width: FL.width,
            margins: { l: FL._size.l, r: FL._size.r }, base: baseM });
        setMargin('l');
        setMargin('r', placed.margin.r, baseM.r);
        const cur = L.legend || {};
        if (!same(cur.x, placed.legends[0].x)) relayout['legend.x'] = placed.legends[0].x;
        if (cur.xanchor !== 'left') relayout['legend.xanchor'] = 'left';
        if (meta.azColPlaced !== true) relayout['meta.azColPlaced'] = true;
        titleNote(gd, relayout, false, false);
        return finish(relayout, margin, meta, legendIdx, legendVal, nameIdx, nameVal);
    }
    if (used < 2) {
        for (let k = 2; L[`legend${k}`]; k++) relayout[`legend${k}`] = null;
        setMargin('l'); setMargin('r');
        titleNote(gd, relayout, false, false);
        if (meta.azColPlaced === true) {
            const b = LEGEND_POSITIONS[pos] || LEGEND_POSITIONS.right;
            Object.assign(relayout, { 'legend.x': b.x, 'legend.xanchor': b.xanchor, 'legend.yanchor': b.yanchor,
                'legend.orientation': b.orientation, 'meta.azColPlaced': false });
            if (pos !== 'bottom') relayout['legend.y'] = b.y;
        }
        for (const t of proxies) if (t.azName !== undefined && t.azName !== t.name) { nameIdx.push(gd.data.indexOf(t)); nameVal.push(t.azName); }
        return finish(relayout, margin, meta, legendIdx, legendVal, nameIdx, nameVal);
    }

    for (let k = used + 1; L[`legend${k}`]; k++) relayout[`legend${k}`] = null;
    const ids = Array.from({ length: used }, (_, i) => legendId(i));
    const W = FL.width, plot = { w: FL._size.w };
    const margins = { l: FL._size.l, r: FL._size.r };
    const gap = typeof meta.azLegendGap === 'number' ? meta.azLegendGap : COLUMN_GAP_DEFAULT;
    const side = pos === 'left' || pos === 'right';

    // the labels cut to the room the columns may take
    const at = new Map();
    gd.data.forEach((t, i) => at.set(t, i));
    const columnOf = (t) => ids.indexOf(want[at.get(t)]);
    const groups = ids.map(() => []);
    for (const t of proxies) { const c = columnOf(t); if (c >= 0) groups[c].push(t); }
    const measure = legendMeasure(gd);
    const needs = groups.map(g => Math.max(0, ...g.map(t => measure(t.azName ?? t.name))) + ENTRY_EXTRA);
    const fit = fitColumns(needs, gap, side ? W * COLUMNS_SHARE : Math.max(plot.w, 200));
    const allLabels = proxies.map(t => t.azName ?? t.name);
    groups.forEach((g, c) => {
        for (const t of g) {
            const full = t.azName ?? t.name;
            const shown = fit.limits ? cutLabelAmong(full, fit.limits[c] - ENTRY_EXTRA, measure, allLabels) : full;
            if (shown !== t.name) { nameIdx.push(at.get(t)); nameVal.push(shown); }
            if (shown !== full) t.azName = full;
        }
    });

    // the legends: one per column, each with its title (blank after the first)
    let structural = legendIdx.length > 0 || nameIdx.length > 0;
    const first = rowKeysFor(L, 0);
    for (const [key, v] of Object.entries(first)) if (!same((L.legend || {})[key], v)) relayout[`legend.${key}`] = v;
    for (let k = 1; k < used; k++) {
        const wanted = columnLegend(L, k);
        if (withoutPlace(L[ids[k]]) !== withoutPlace(wanted)) { relayout[ids[k]] = wanted; structural = true; }
    }
    if (structural) return finish(relayout, margin, meta, legendIdx, legendVal, nameIdx, nameVal);

    // the places, from the widths Plotly measured
    const widths = ids.map(id => FL[id] && FL[id]._width);
    if (widths.every(w => Number.isFinite(w)) && over > 0) widths[0] += over;     // the shifted title is part of the first column
    if (!widths.every(w => Number.isFinite(w) && w > 0)) return finish(relayout, margin, meta, legendIdx, legendVal, nameIdx, nameVal);
    const baseM = { l: baseMargin(L, 'l'), r: baseMargin(L, 'r') };
    const placed = placeColumns({ position: pos, widths, gap: fit.gap, width: W, margins, base: baseM });
    for (const m of ['l', 'r']) {
        if (placed.margin[m] !== undefined) setMargin(m, placed.margin[m], baseM[m]); else setMargin(m);
    }
    ids.forEach((id, k) => {
        const p = placed.legends[k];
        const cur = k === 0 ? (L.legend || {}) : (L[id] || {});
        const keys = { ...rowKeysFor(L, k), x: p.x, xanchor: p.xanchor };
        for (const [key, v] of Object.entries(keys)) if (!same(cur[key], v)) relayout[`${id}.${key}`] = v;
    });
    if (meta.azColPlaced !== true) relayout['meta.azColPlaced'] = true;
    const noteWanted = (meta.azTitleAlign === 'centre' || meta.azTitleAlign === 'right') && !!(L.legend && L.legend.title && L.legend.title.text);
    titleNote(gd, relayout, noteWanted, Object.keys(relayout).length === 0 && nameIdx.length === 0 && legendIdx.length === 0);
    return finish(relayout, margin, meta, legendIdx, legendVal, nameIdx, nameVal);
}

function finish(relayout, margin, meta, legendIdx, legendVal, nameIdx, nameVal) {
    if (JSON.stringify(meta.azColMargin || {}) !== JSON.stringify(margin)) relayout['meta.azColMargin'] = Object.keys(margin).length ? margin : null;
    const restyle = [];
    if (legendIdx.length) restyle.push([{ legend: legendVal }, legendIdx]);
    if (nameIdx.length) restyle.push([{ name: nameVal }, nameIdx]);
    return Object.keys(relayout).length || restyle.length ? { relayout, restyle } : null;
}

const NOTE = 'az-legend-title';
const CLEAR = 'rgba(0,0,0,0)';
const isClear = (c) => typeof c === 'string' && c.replace(/\s/g, '') === CLEAR;

/**
 * The legend title across several columns. One legend aligns only its own title, so for Centre and Right
 * over columns the first legend's title stays (invisible, for its height) and the title is a layout annotation,
 * placed from where the first and last legend and the title's text were drawn. Edits `relayout`.
 * @param {boolean} active - whether the annotation is wanted
 * @param {boolean} settled - whether the legends have stopped moving, so that their places can be read
 */
function titleNote(gd, relayout, active, settled) {
    const L = gd.layout, FL = gd._fullLayout;
    const meta = L.meta || {};
    const list = Array.isArray(L.annotations) ? L.annotations : [];
    const mine = list.find(a => a && a.name === NOTE);
    const cur = L.legend && L.legend.title && L.legend.title.font && L.legend.title.font.color;
    if (!active) {
        if (mine) relayout.annotations = list.filter(a => a !== mine);
        if (isClear(cur)) relayout['legend.title.font.color'] = meta.azTitleColor ?? FL.font.color ?? '#000000';
        return;
    }
    if (!isClear(cur)) {
        if (cur !== undefined && cur !== meta.azTitleColor) relayout['meta.azTitleColor'] = cur;
        relayout['legend.title.font.color'] = CLEAR;
    }
    if (!settled || typeof document === 'undefined') return;
    const first = gd.querySelector('g.legend rect.bg');
    const lastId = legendId(usedColumns(gd.data, meta.azLegendColumns || 1) - 1);
    const last = gd.querySelector(`g.${lastId} rect.bg`);
    const text = gd.querySelector('g.legend text[class$="titletext"]');
    if (!first || !last || !text) return;
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    let node = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/\S/.test(n.textContent.replace(/\u00a0/g, ''))) { node = n; break; }
    if (!node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const t = range.getBoundingClientRect(), a = first.getBoundingClientRect(), b = last.getBoundingClientRect(), g = gd.getBoundingClientRect();
    const align = meta.azTitleAlign;
    const px = align === 'right' ? b.right - 2 : (a.left + b.right) / 2;
    const size = FL._size;
    const font = FL.legend && FL.legend.title && FL.legend.title.font || {};
    const span = node.parentElement ? parseFloat(getComputedStyle(node.parentElement).fontSize) : NaN;
    const want = {
        name: NOTE, text: node.textContent.replace(/\u00a0/g, ' ').trim().replace(/</g, '&lt;'), showarrow: false, xref: 'paper', yref: 'paper',
        x: round((px - g.left - size.l) / size.w), y: round((size.t + size.h - ((t.top + t.bottom) / 2 - g.top)) / size.h),
        xanchor: align === 'right' ? 'right' : 'center', yanchor: 'middle', align: align === 'right' ? 'right' : 'center',
        borderpad: 0, borderwidth: 0, captureevents: false,
        font: { family: font.family, size: Number.isFinite(span) && span > 0 ? span : font.size, color: (isClear(meta.azTitleColor) ? undefined : meta.azTitleColor) || (isClear(cur) ? undefined : cur) || FL.font.color || '#000000' }
    };
    const same2 = mine && mine.text === want.text && same(mine.x, want.x) && same(mine.y, want.y) && mine.xanchor === want.xanchor
        && mine.font && mine.font.size === want.font.size && mine.font.color === want.font.color && mine.font.family === want.font.family;
    if (!same2) relayout.annotations = [...list.filter(x => x !== mine), want];
}

/** A cut entry shows its full name on hover (an SVG title on the entry). */
function showFullNames(gd) {
    try {
        for (const el of gd.querySelectorAll('g.traces')) {
            const full0 = el.__data__ && el.__data__[0] && el.__data__[0].trace;
            const trace = full0 && gd.data[full0.index];
            const full = trace && trace.azName !== undefined && trace.azName !== trace.name ? trace.azName : null;
            let title = el.querySelector(':scope > title');
            if (!full) { if (title) title.remove(); continue; }
            if (!title) { title = document.createElementNS('http://www.w3.org/2000/svg', 'title'); el.appendChild(title); }
            if (title.textContent !== full) title.textContent = full;
        }
    } catch { /* a hover hint only */ }
}

/** Bring the legends of a drawn graph to its columns and their places; resolves when they are settled. */
export async function syncLegendColumns(gd, pass = 0) {
    if (!gd || !Array.isArray(gd.data) || !gd.layout || !gd._fullLayout || _setting.has(gd) || typeof Plotly === 'undefined') return;
    const plan = planLegendColumns(gd);
    if (!plan || pass >= MAX_PASSES) { showFullNames(gd); return; }
    _setting.add(gd);
    try {
        for (const [update, idx] of plan.restyle) await Plotly.restyle(gd, update, idx);
        if (Object.keys(plan.relayout).length) await Plotly.relayout(gd, plan.relayout);
    } catch (err) {
        console.warn('Legend columns not set:', err && err.message);
        return;
    } finally {
        _setting.delete(gd);
    }
    await syncLegendColumns(gd, pass + 1);
}

/** Move the drawn legend title right by `meta.azTitleShift` px (a transform on its text, so its stored text stays the name). */
export function shiftLegendTitles(gd) {
    if (!gd || !gd.layout || typeof gd.querySelectorAll !== 'function') return;
    const meta = gd.layout.meta || {};
    const dx = Number(meta.azTitleShift) || 0;
    const note = meta.azTitleAlign === 'centre' || meta.azTitleAlign === 'right';
    const el = gd.querySelector('g.legend text[class$="titletext"]');
    if (!el) return;
    if (dx > 0 && !note) el.setAttribute('transform', `translate(${Math.round(dx * 100) / 100},0)`);
    else el.removeAttribute('transform');
}

const _listeners = new WeakMap();

/** Settle the legends into columns now and after every redraw; a double click isolates a category in every column. */
export function watchLegendColumns(gd) {
    if (!gd) return;
    shiftLegendTitles(gd);
    syncLegendColumns(gd);
    if (typeof gd.on !== 'function') return;
    let fns = _listeners.get(gd);
    if (fns && typeof gd.removeListener === 'function') {
        gd.removeListener('plotly_afterplot', fns.after);
        gd.removeListener('plotly_legenddoubleclick', fns.dbl);
    }
    fns = { after: () => { shiftLegendTitles(gd); syncLegendColumns(gd); }, dbl: (e) => legendDoubleClick(gd, e) };
    _listeners.set(gd, fns);
    gd.on('plotly_afterplot', fns.after);
    gd.on('plotly_legenddoubleclick', fns.dbl);
}
