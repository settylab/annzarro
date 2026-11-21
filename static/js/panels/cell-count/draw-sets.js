/**
 * The Venn and UpSet figures of the count plot (V2, CNT-11 to CNT-13, CNT-19 to CNT-21, CNT-23).
 *
 * Pure: `buildFigure(setPlot, theme, options)` returns Plotly's `{ data, layout, config }` and touches no DOM, so Node
 * tests hold the figure. `setPlot` is V1's `setPlotModel` result (utils/set-plot-model.js). The model has already sorted,
 * cut and filtered the regions: this file draws `shown` in the order given and states `hidden`. It never recounts,
 * and it reads only the shown regions, so a paint costs what the bars cost whatever the number of regions (65,535 at
 * 16 sets).
 *
 * Venn (2 or 3 sets; one is drawn too) is circles of equal size with each region's count and share, not area
 * proportional. The sets are lettered, the names stay in the set list and in the hover. UpSet is intersection bars
 * over a dot matrix, with the sets named in full and a bar for each set's size.
 *
 * Both modes ship one trace that carries `customdata` = the region's index in `setPlot.regions`, so a click can
 * offer Save as grouping (CNT-21) without a lookup. Shapes and annotations export to PNG and SVG with the figure.
 */
import { fmtPercent } from '../../utils/score-inspect.js';
import { VOCABULARY } from '../../utils/vocabulary.js';

const VENN_MAX_SETS = 3;
const UPSET_MAX_SETS = 16;
/** Below this width the set-size bars move under the matrix (UX 4.8). */
const NARROW_PX = 560;
const ROW_PX = 22;
const BARS_PX = 240;
const GAP_PX = 28;
const GLYPH_PX = 7;
/** Okabe and Ito, the first three: tells apart under the common colour-vision differences. */
const VENN_COLOURS = Object.freeze(['#0072B2', '#E69F00', '#009E73']);

/** Venn geometry: circle centres, radius 1, and where each region's label sits (by the bit code of its key). */
const VENN = Object.freeze({
    1: { centres: [[0, 0]], letters: [[0, 1.15]], labels: { 1: [0, 0] } },
    2: {
        centres: [[-0.55, 0], [0.55, 0]], letters: [[-0.55, 1.15], [0.55, 1.15]],
        labels: { 1: [-1.1, 0], 2: [1.1, 0], 3: [0, 0] }
    },
    3: {
        centres: [[-0.55, 0.32], [0.55, 0.32], [0, -0.62]], letters: [[-0.55, 1.47], [0.55, 1.47], [0, -1.77]],
        labels: { 1: [-1.0, 0.6], 2: [1.0, 0.6], 4: [0, -1.3], 3: [0, 0.85], 5: [-0.62, -0.3], 6: [0.62, -0.3], 7: [0, 0] }
    }
});

const plain = (n) => n.toLocaleString('en-US');

const text = Object.freeze({
    cells: 'Cells in region',
    setSize: 'Cells in set',
    noSet: (n) => `${plain(n)} cells in no ${VOCABULARY.word.set}`,
    hidden: (h) => `${fmtPercent(h.share)} of cells are in ${h.regions.toLocaleString('en-US')} bars not shown`,
    changed: (name) => `${name} (group changed)`,
    deleted: (name) => `${name} (deleted)`
});

function regionLabel(region, labels) {
    if (labels === 'none') return '';
    const count = plain(region.count);
    const share = fmtPercent(region.share);
    if (labels === 'count') return count;
    if (labels === 'share') return share;
    return `${count}<br>${share}`;
}

function setName(set) {
    if (set.state === 'changed') return text.changed(set.name);
    if (set.state === 'deleted') return text.deleted(set.name);
    return set.name;
}

/** What pointing at a region says: the sets it is in, the count and the share of the universe. */
function regionHover(region, sets, universe) {
    const names = [];
    for (let s = 0; s < sets.length; s++) if (region.key[s]) names.push(sets[s].name);
    const who = names.join(' and ') + (names.length < sets.length ? ' only' : '');
    return `${who}<br>${plain(region.count)} cells (${fmtPercent(region.share)} of ${plain(universe)} cells shown)`;
}

const codeOf = (key) => key.reduce((a, v, s) => a + (v ? 1 << s : 0), 0);

function themeLayout(theme) {
    return { paper_bgcolor: theme.bgColor, plot_bgcolor: theme.bgColor, font: { color: theme.textColor, size: 12 }, showlegend: false, hovermode: 'closest' };
}

const CONFIG = Object.freeze({ responsive: true, displaylogo: false });

function vennFigure(plot, theme, opts) {
    const k = plot.sets.length;
    const geo = VENN[k];
    if (!geo) throw new RangeError(`Venn draws 1 to ${VENN_MAX_SETS} sets, not ${k}`);
    const labels = opts.labels || 'both';
    const x = [], y = [], texts = [], hover = [], region = [];
    for (const ri of plot.shown) {
        const r = plot.regions[ri];
        const at = geo.labels[codeOf(r.key)];
        x.push(at[0]); y.push(at[1]);
        texts.push(regionLabel(r, labels));
        hover.push(regionHover(r, plot.sets, plot.universe));
        region.push(ri);
    }
    const shapes = geo.centres.map(([cx, cy], s) => ({
        type: 'circle', xref: 'x', yref: 'y', x0: cx - 1, x1: cx + 1, y0: cy - 1, y1: cy + 1,
        fillcolor: VENN_COLOURS[s], opacity: 0.3, line: { color: VENN_COLOURS[s], width: 2 }, layer: 'below'
    }));
    const annotations = plot.sets.map((set, s) => ({
        x: geo.letters[s][0], y: geo.letters[s][1], xref: 'x', yref: 'y', text: set.letter, showarrow: false,
        font: { size: 16, color: theme.textColor }
    }));
    annotations.push({
        x: 1, y: 0, xref: 'paper', yref: 'paper', xanchor: 'right', yanchor: 'bottom', showarrow: false,
        text: text.noSet(plot.inNone), font: { size: 12, color: theme.textColor }
    });
    return {
        data: [{ type: 'scatter', mode: 'text', name: 'regions', x, y, text: texts, hovertext: hover, hoverinfo: 'text',
            customdata: region, textfont: { color: theme.textColor, size: 13 } }],
        layout: {
            ...themeLayout(theme), shapes, annotations, margin: { l: 16, r: 16, t: 16, b: 16 },
            xaxis: { visible: false, range: [-2.4, 2.4], fixedrange: true },
            yaxis: { visible: false, range: [-2.0, 1.8], scaleanchor: 'x', fixedrange: true }
        },
        config: CONFIG
    };
}

function upsetFigure(plot, theme, opts) {
    const k = plot.sets.length;
    if (k < 1 || k > UPSET_MAX_SETS) throw new RangeError(`UpSet draws 1 to ${UPSET_MAX_SETS} sets, not ${k}`);
    const width = opts.width || 720;
    const narrow = width < NARROW_PX;
    const labels = opts.labels || 'count';
    const m = plot.shown.length;
    const colored = plot.color !== null && plot.color !== undefined;
    const regions = plot.shown.map(ri => plot.regions[ri]);

    // one label per bar only when each bar's slot is wide enough to carry the longest label
    const barTexts = regions.map(r => regionLabel(r, labels === 'both' ? 'count' : labels));
    const longest = barTexts.reduce((a, t) => Math.max(a, t.length), 0);
    const plotWidth = width * (narrow ? 0.85 : 0.6);
    const roomy = m > 0 && plotWidth / m >= longest * GLYPH_PX + 4;
    const barLabels = roomy ? barTexts : barTexts.map(() => '');

    const cols = regions.map((_, i) => i);
    const hover = regions.map(r => regionHover(r, plot.sets, plot.universe));
    const colourValues = colored ? regions.map(r => (Number.isFinite(r.color) ? r.color : null)) : null;
    const missing = colored ? colourValues.map(v => v === null) : null;
    const bars = {
        type: 'bar', name: 'intersections', xaxis: 'x', yaxis: 'y', x: cols, y: regions.map(r => r.count),
        text: barLabels, textposition: 'outside', cliponaxis: false, hovertext: hover, hoverinfo: 'text', customdata: plot.shown,
        marker: colored
            ? { color: colourValues, colorscale: 'Viridis', showscale: true,
                colorbar: { title: { text: plot.color.label, side: 'right' }, ...(plot.color.kind === 'share' ? { tickformat: '.0%' } : {}) } }
            : { color: theme.noneColor }
    };
    const data = [bars];
    if (colored && missing.some(Boolean)) {
        data.push({
            type: 'bar', name: 'no value', xaxis: 'x', yaxis: 'y', x: cols, y: regions.map((r, i) => (missing[i] ? r.count : null)),
            hovertext: hover, hoverinfo: 'text', customdata: plot.shown, marker: { color: theme.notInTableColor }
        });
    }

    // the dot matrix: a grey dot per set a region is out of, a dark one per set it is in, a line across the dark ones
    const inX = [], inY = [], outX = [], outY = [], linkX = [], linkY = [];
    regions.forEach((r, col) => {
        let lo = Infinity, hi = -1;
        for (let s = 0; s < k; s++) {
            if (r.key[s]) { inX.push(col); inY.push(s); lo = Math.min(lo, s); hi = Math.max(hi, s); } else { outX.push(col); outY.push(s); }
        }
        if (hi > lo) linkX.push(col, col, null), linkY.push(lo, hi, null);
    });
    const rows = plot.sets.map((_, s) => s);
    const rowsAxis = narrow ? 'y3' : 'y2';
    data.push(
        { type: 'scatter', mode: 'markers', name: 'out', xaxis: 'x', yaxis: 'y2', x: outX, y: outY, hoverinfo: 'skip', marker: { size: 9, color: theme.gridColor } },
        { type: 'scatter', mode: 'lines', name: 'links', xaxis: 'x', yaxis: 'y2', x: linkX, y: linkY, hoverinfo: 'skip', line: { width: 3, color: theme.textColor } },
        { type: 'scatter', mode: 'markers', name: 'in', xaxis: 'x', yaxis: 'y2', x: inX, y: inY, hoverinfo: 'skip', marker: { size: 9, color: theme.textColor } },
        { type: 'bar', orientation: 'h', name: 'set sizes', xaxis: 'x2', yaxis: rowsAxis, x: plot.sets.map(s => s.size), y: rows,
            hovertext: plot.sets.map(s => `${s.name}<br>${plain(s.size)} cells`), hoverinfo: 'text', marker: { color: theme.axisColor, opacity: 0.7 } }
    );

    const tickText = plot.sets.map(setName);
    const rowsPx = k * ROW_PX;
    const total = BARS_PX + GAP_PX + rowsPx + (narrow ? GAP_PX + rowsPx : 0);
    const frac = (px) => px / total;
    const matrixDomain = [narrow ? frac(rowsPx + GAP_PX) : 0, frac((narrow ? rowsPx + GAP_PX : 0) + rowsPx)];
    const barsDomain = [1 - frac(BARS_PX), 1];
    const rowsAxisBase = (domain) => ({ domain, tickvals: rows, ticktext: tickText, autorange: 'reversed', zeroline: false, showgrid: false, automargin: true, fixedrange: true });
    const countAxis = (title, extra) => ({
        title: { text: title }, type: opts.logCounts ? 'log' : 'linear', ...(opts.logCounts ? {} : { rangemode: 'tozero' }),
        gridcolor: theme.gridColor, linecolor: theme.axisColor, zerolinecolor: theme.zeroLineColor, ...extra
    });
    const layout = {
        ...themeLayout(theme),
        height: total + 80, margin: { l: 16, r: colored ? 90 : 24, t: 24, b: 56 }, bargap: 0.25, barmode: 'overlay',
        xaxis: { domain: narrow ? [0, 1] : [0.38, 1], anchor: 'y2', visible: false, range: [-0.5, Math.max(m, 1) - 0.5], fixedrange: true },
        yaxis: { ...countAxis(text.cells), domain: barsDomain, anchor: 'x' },
        yaxis2: { ...rowsAxisBase(matrixDomain), anchor: narrow ? 'x' : 'x2' },
        xaxis2: {
            ...countAxis(text.setSize), domain: narrow ? [0, 1] : [0, 0.3], anchor: rowsAxis, ...(narrow ? {} : { autorange: 'reversed' })
        },
        annotations: []
    };
    if (narrow) layout.yaxis3 = { ...rowsAxisBase([0, frac(rowsPx)]), anchor: 'x2' };
    if (plot.hidden && plot.hidden.regions > 0) {
        layout.annotations.push({
            x: 1, y: 1, xref: 'paper', yref: 'paper', xanchor: 'right', yanchor: 'bottom', showarrow: false,
            text: text.hidden(plot.hidden), font: { size: 12, color: theme.textColor }
        });
    }
    return { data, layout, config: CONFIG };
}

/**
 * The figure of a SetPlot. `theme` is a palette of plot-theme.js (the plot's own colours, light or dark).
 * `options`: `labels` ('both' | 'count' | 'share' | 'none'; Venn defaults to both, UpSet to count), `logCounts`, and the
 * panel's `width` in pixels (UpSet thins its bar labels and moves the set sizes under the matrix when it is small).
 */
// export-unused-ok: C3's draw.js and the panel dispatch to it for the Venn and UpSet modes
export function buildFigure(plot, theme, options = {}) {
    return plot.mode === 'upset' ? upsetFigure(plot, theme, options) : vennFigure(plot, theme, options);
}
