/**
 * What the shared Plot Options do to a figure (WP-5a; design note options-ux-080 sections 2f and 3.1; operator decisions
 * 25, 30 and 33). Pure: no DOM and no Plotly, so annzarro/tests/js/plot-style.test.mjs holds it in Node.
 *
 * `applyPlotStyle(figure, style, kind)` is called once by each draw of the new plots, on the figure the panel's builder
 * made, just before it is drawn (panels/cell-gene.js, panels/cell-count.js). `style` is options-schema.js
 * `resolveStyle(config, kind)`. It sets:
 *  - Text: the font's family, size and colour on the layout; the plot title (a count plot's; the Cell-Gene Plot draws
 *    its own) and its size.
 *  - Background: the paper and the plot area.
 *  - Axes: grid lines on, off, their colour and width. On the Cell-Gene Plot only its main axes (`xaxis`, `yaxis`): the
 *    legend column's small axes and the annotation bands' are left alone. On a count plot every 2D axis; grid on keeps
 *    an axis that draws none on purpose (UpSet's rows) without one.
 *  - Margins: added to the margins the builder made for its labels (they are room, not positions).
 *  - Legend (count plot): shown or not, its position, its columns, its space and its cap. Past the cap the legend lists
 *    the first N entries and a last line "+ k more". Columns, a space or a cap make the legend the one Cell Plot draws in
 *    columns (utils/legend-options.js): each entry a proxy trace (`meta: 'az-legend'`), the bars or lines it stands for
 *    sharing its legend group, so a click still hides them; a pie's slices are listed by proxies too (a click does not
 *    hide a slice then).
 * The Cell-Gene Plot's legend column is laid out in its builder, which needs the space, the columns and the cap before
 * it places anything: `cellGeneLegend(style)` gives them for the model's `legendLayout` (cell-gene/draw.js), and
 * `styleTheme(style, palette)` gives the font and colours its builder measures labels with.
 *
 * Cost: one pass over the traces and the layout's axes.
 */
import { LEGEND_POSITIONS as PLACES } from '../../utils/legend-options.js';
import { isRealName } from '../../utils/legend-entries.js';
import { resolveStyle } from './options-schema.js';

const PROXY = 'az-legend';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fmt = (n) => n.toLocaleString('en-US');

/** The "+ k more" line of a capped legend. */
export const moreLine = (k) => `+ ${fmt(k)} more`;

/** The title's size: set, else 4 px above the text. */
export function titleSizeOf(style) {
    return style.titleSize ?? (style.fontSize || 12) + 4;
}

/**
 * The plot theme with the style's font and colours on it, for builders that measure their labels with it (Cell-Gene's
 * draw.js) or colour their parts from it (the count plot's builders).
 * @param {Object} style - resolveStyle(config, kind)
 * @param {Object} palette - utils/plot-theme.js PLOT_PALETTES[theme]
 */
export function styleTheme(style, palette) {
    const out = { ...palette, fontFamily: style.fontFamily, fontSize: style.fontSize };
    if (style.textColor) out.textColor = style.textColor;
    if (style.bgColor) out.bgColor = style.bgColor;
    if (style.gridColor) out.gridColor = style.gridColor;
    return out;
}

/** The Cell-Gene Plot's legend column as its builder takes it: the space (a fraction, or null), the columns, the cap. */
export function cellGeneLegend(style) {
    return { space: style.legendSpace ? style.legendSpace / 100 : null, columns: style.legendColumns || 1, max: style.legendMax || Infinity };
}

/**
 * What exportPlot (plot-aesthetics-menu.js) reads for an image: the size set, else the size of the plot on screen, and
 * twice the pixels unless 2x is off.
 * @param {Object} style
 * @param {{width?: number, height?: number}} [shown] - the plot's size on screen
 */
export function exportSettings(style, shown = {}) {
    const round = (v) => (v > 0 ? Math.round(v) : undefined);
    return { exportWidth: style.exportWidth || round(shown.width), exportHeight: style.exportHeight || round(shown.height), scaleExport: style.export2x !== false };
}

/** The 2D axes of a layout the grid applies to. */
function axisKeys(layout, kind) {
    if (kind === 'cell-gene') return ['xaxis', 'yaxis'].filter((k) => layout[k]);
    return Object.keys(layout).filter((k) => /^[xy]axis\d*$/.test(k) && layout[k]);
}

/** A trace's colour for its legend proxy. */
function colourOf(t) {
    const pick = (c) => (Array.isArray(c) ? c.find((x) => typeof x === 'string') : typeof c === 'string' ? c : undefined);
    return pick(t.marker && t.marker.color) || pick(t.line && t.line.color) || pick(t.fillcolor) || '#888888';
}

function proxy(name, key, color, i) {
    return { type: 'scatter', mode: 'markers', x: [null], y: [null], name, legendgroup: key, meta: PROXY, showlegend: true,
        hoverinfo: 'skip', legendrank: 1000 + i, marker: { symbol: 'square', size: 12, color } };
}

/**
 * The count plot's legend (in place). Does nothing to a figure that draws no legend.
 * @returns {{entries: number, shown: number, more: number, proxies: boolean}} what the legend lists
 */
function countLegend(figure, s) {
    const L = figure.layout;
    const data = figure.data;
    const none = { entries: 0, shown: 0, more: 0, proxies: false };
    if (!s.showLegend) { L.showlegend = false; return none; }
    if (L.showlegend !== true) return none;
    const pie = data.find((t) => t && t.type === 'pie');
    const traces = data.filter((t) => t && t.type !== 'pie' && t.showlegend !== false && t.visible !== false && isRealName(t.name));
    const n = pie ? (pie.labels || []).length : traces.length;
    const max = Math.max(1, s.legendMax || Infinity);
    const capped = n > max;
    const pos = PLACES[s.legendPosition] ? s.legendPosition : 'right';
    const columns = Math.max(1, s.legendColumns || 1);
    const useProxies = capped || columns > 1 || !!s.legendSpace;
    L.meta = { ...(L.meta || {}), azLegendPosition: pos, azLegendColumns: columns };
    if (s.legendSpace) L.meta.azLegendShare = s.legendSpace / 100; else delete L.meta.azLegendShare;
    if (pos !== 'right' || useProxies) L.legend = { ...(L.legend || {}), ...PLACES[pos] };
    if (!useProxies) return { entries: n, shown: n, more: 0, proxies: false };

    let list;
    if (pie) {
        const colours = (pie.marker && pie.marker.colors) || [];
        list = (pie.labels || []).map((label, i) => ({ name: String(label), key: `az-slice:${i}`, color: colours[i] || '#888888' }));
        pie.showlegend = false;
    } else {
        list = traces.map((t) => {
            if (typeof t.legendgroup !== 'string' || t.legendgroup === '') t.legendgroup = `az:${t.name}`;
            t.showlegend = false;
            return { name: t.name, key: t.legendgroup, color: colourOf(t) };
        });
    }
    const shown = capped ? list.slice(0, max) : list;
    const more = list.length - shown.length;
    shown.forEach((e, i) => data.push(proxy(e.name, e.key, e.color, i)));
    if (more) data.push(proxy(moreLine(more), 'az-more', 'rgba(0,0,0,0)', shown.length));
    // a pie has no axes: the proxies' own stay out of sight
    if (!axisKeys(L, 'cell-count').length) {
        L.xaxis = { visible: false, fixedrange: true };
        L.yaxis = { visible: false, fixedrange: true };
    }
    return { entries: n, shown: shown.length, more, proxies: true };
}

/**
 * Put the style on a figure the panel's builder made. Edits `figure` in place and returns it.
 * @param {{data: Object[], layout: Object}} figure
 * @param {Object} [style] - resolveStyle(config, kind); the kind's defaults when absent
 * @param {'cell-gene'|'cell-count'} kind
 * @returns {Object} the figure; `figure.legendShown` says what a count plot's legend lists
 */
export function applyPlotStyle(figure, style, kind) {
    if (!figure || !figure.layout) return figure;
    const s = style || resolveStyle({}, kind);
    const L = figure.layout;
    const is3d = !!L.scene;

    // Text
    L.font = { ...(L.font || {}), family: s.fontFamily, size: s.fontSize };
    if (s.textColor) L.font.color = s.textColor;
    if (kind === 'cell-count' && s.plotTitle) L.title = { text: esc(s.plotTitle) };
    if (L.title && L.title.text) {
        L.title = { ...L.title, font: { ...(L.title.font || {}), size: titleSizeOf(s), ...(s.textColor ? { color: s.textColor } : {}) } };
    }

    // Background
    if (s.bgColor) {
        L.paper_bgcolor = s.bgColor;
        L.plot_bgcolor = s.bgColor;
        if (is3d) L.scene = { ...L.scene, bgcolor: s.bgColor };
    }

    // Axes: grid lines
    if (!is3d) {
        for (const key of axisKeys(L, kind)) {
            const axis = { ...L[key] };
            if (!s.grid) axis.showgrid = false;
            else if (kind === 'cell-gene') axis.showgrid = true;
            if (s.gridColor) axis.gridcolor = s.gridColor;
            axis.gridwidth = s.gridWidth;
            L[key] = axis;
        }
    }

    // Margins: added to the builder's
    const m = L.margin || {};
    const base = (side, dflt) => (typeof m[side] === 'number' ? m[side] : dflt);
    L.margin = { ...m, t: base('t', 100) + (s.marginTop || 0), r: base('r', 80) + (s.marginRight || 0),
        b: base('b', 80) + (s.marginBottom || 0), l: base('l', 80) + (s.marginLeft || 0) };
    if (kind === 'cell-count' && s.plotTitle) L.margin.t += titleSizeOf(s) + 16;

    // Legend
    if (kind === 'cell-count') figure.legendShown = countLegend(figure, s);
    return figure;
}
