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
 * proportional, unless `proportional` is set: then each circle's area follows its set's size and each overlap's the
 * intersection's (utils/venn-euler.js; exact for two sets, an approximation for three, with its error stated under the
 * plot above `NOTE_AT`), and a region's label is dropped when the region is too small to hold it (`labelFits`: one rule,
 * the region's widest inscribed circle against the label's size at the plot's width; the hover still names the region).
 * Each circle has its set's colour and a label with the letter and the name (cut short, the whole name in the hover),
 * which `names: false` leaves off. The text is the theme's text colour over the circles' 0.3 fill, which reads on both. UpSet is intersection bars over a dot matrix, with the sets named in full and a bar for each set's size
 * in its colour; the bars are one neutral colour unless the plot is coloured.
 *
 * Both modes ship one trace that carries `customdata` = the region's index in `setPlot.regions`, so a click can
 * offer Save as grouping (CNT-21) without a lookup. Shapes and annotations export to PNG and SVG with the figure.
 */
import { fmtPercent } from '../../utils/csv-format.js';
import { VOCABULARY } from '../../utils/vocabulary.js';
import { scaleKeys } from './colour.js';
import { defaultSetColour } from '../../utils/set-colours.js';
import { eulerLayout, regionPoint } from '../../utils/venn-euler.js';

const VENN_MAX_SETS = 3;
const UPSET_MAX_SETS = 16;
/** Below this width the set-size bars move under the matrix (UX 4.8). */
const NARROW_PX = 560;
const ROW_PX = 22;
const BARS_PX = 240;
const GAP_PX = 28;
const GLYPH_PX = 7;
/** The longest a set's name is written beside its circle: more is cut, and the whole name is in the hover. */
const LABEL_CHARS = 20;
/** The colour of each set of a SetPlot: the one set in the model (`colour`), else the default of its position. */
const coloursOf = (plot) => plot.sets.map((set, s) => set.colour || defaultSetColour(s));

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

/** A proportional Venn states its error under the plot from this fraction (5 percentage points of the cells in the sets). */
const NOTE_AT = 0.05;
/** Text height and width per character of a region's label, in pixels, for `labelFits`. */
const LINE_PX = 16;
/** The plot's room, in pixels, when the caller gives no width or height (the panel's usual size). */
const DEFAULT_PX = [720, 540];

const plain = (n) => n.toLocaleString('en-US');

const text = Object.freeze({
    cells: 'Cells in region',
    setSize: 'Cells in set',
    noSet: (n) => `${plain(n)} cells in no ${VOCABULARY.word.set}`,
    hidden: (h) => `${fmtPercent(h.share)} of cells are in ${h.regions.toLocaleString('en-US')} bars not shown`,
    approximate: (pct) => `Areas are approximate: largest error ${pct} of the cells in the sets`,
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

const HIDDEN_AXIS = Object.freeze({
    autorange: false, fixedrange: true, tickmode: 'linear', tick0: 0, dtick: 1, ticks: '', showticklabels: false, showgrid: false,
    zeroline: false, showline: false
});
const CONFIG = Object.freeze({ responsive: true, displaylogo: false });

/** Whether a label of `chars` characters on `lines` lines fits a region with `room` (the radius of its widest inscribed circle, in plot units). */
function labelFits(room, chars, lines, pxPerUnit) {
    return room > 0 && 2 * room * pxPerUnit >= Math.max(lines * LINE_PX, 0.5 * chars * GLYPH_PX);
}

/** The fixed layout: circles of radius 1 and the places of `VENN`, the same whatever the counts. */
function fixedGeometry(k, geo) {
    return {
        circles: geo.centres.map(([x, y]) => ({ x, y, r: 1 })),
        labelAt: (code) => ({ at: geo.labels[code], room: Infinity }),
        letterAt: (s) => { const [lx, ly] = geo.letters[s]; return { x: lx, y: ly, side: k > 1 && ly > 0 ? (lx < 0 ? -1 : 1) : 0 }; },
        xRange: [-2.4, 2.4], yRange: [-2.0, 1.8], error: null
    };
}

/** The proportional layout (utils/venn-euler.js) with its label places, set letters and the ranges that hold it; null when no set has a cell. */
function proportionalGeometry(plot) {
    const k = plot.sets.length;
    const byCode = new Map(plot.regions.map((r) => [codeOf(r.key), r.count]));
    const layout = eulerLayout(k, (code) => byCode.get(code) || 0);
    if (!layout) return null;
    const { circles } = layout;
    const meanX = circles.reduce((a, c) => a + c.x, 0) / k, meanY = circles.reduce((a, c) => a + c.y, 0) / k;
    const lowest = k === 3 ? circles.reduce((m, c, i) => (c.y < circles[m].y ? i : m), 0) : -1;
    const below = lowest >= 0 && meanY - circles[lowest].y > 0.25;
    const lo = [circles.reduce((m, c) => Math.min(m, c.x - c.r), Infinity), circles.reduce((m, c) => Math.min(m, c.y - c.r), Infinity)];
    const hi = [circles.reduce((m, c) => Math.max(m, c.x + c.r), -Infinity), circles.reduce((m, c) => Math.max(m, c.y + c.r), -Infinity)];
    return {
        circles,
        labelAt: (code) => { const p = regionPoint(circles, code); return { at: [p.x, p.y], room: p.room }; },
        letterAt: (s) => {
            const c = circles[s];
            if (below && s === lowest) return { x: c.x, y: c.y - c.r - 0.17, side: 0 };
            return { x: c.x, y: c.y + c.r + 0.17, side: k > 1 ? (c.x < meanX ? -1 : 1) : 0 };
        },
        xRange: [lo[0] - 1.0, hi[0] + 1.0], yRange: [lo[1] - 0.5, hi[1] + 0.5], error: layout.error
    };
}

function vennFigure(plot, theme, opts) {
    const k = plot.sets.length;
    const geo = VENN[k];
    if (!geo) throw new RangeError(`Venn draws 1 to ${VENN_MAX_SETS} sets, not ${k}`);
    const labels = opts.labels || 'both';
    const names = opts.names !== false;
    const proportional = opts.proportional === true;
    const g = (proportional && proportionalGeometry(plot)) || fixedGeometry(k, geo);
    const width = opts.width || DEFAULT_PX[0], height = opts.height || DEFAULT_PX[1];
    const pxPerUnit = Math.min((width - 32) / (g.xRange[1] - g.xRange[0]), (height - 32) / (g.yRange[1] - g.yRange[0]));
    const x = [], y = [], texts = [], hover = [], region = [];
    for (const ri of plot.shown) {
        const r = plot.regions[ri];
        const { at, room } = g.labelAt(codeOf(r.key));
        x.push(at[0]); y.push(at[1]);
        const text = regionLabel(r, labels);
        const lines = text.split('<br>');
        texts.push(proportional && !labelFits(room, lines.reduce((m, l) => Math.max(m, l.length), 0), lines.length, pxPerUnit) ? '' : text);
        hover.push(regionHover(r, plot.sets, plot.universe));
        region.push(ri);
    }
    const colours = coloursOf(plot);
    const shapes = g.circles.map(({ x: cx, y: cy, r }, s) => ({
        type: 'circle', xref: 'x', yref: 'y', x0: cx - r, x1: cx + r, y0: cy - r, y1: cy + r,
        fillcolor: colours[s], opacity: 0.3, line: { color: colours[s], width: 2 }, layer: 'below'
    }));
    // the label beside each circle: the letter and the name; the two upper ones lean away from each other
    const annotations = names ? plot.sets.map((set, s) => {
        const { x: lx, y: ly, side } = g.letterAt(s);
        const full = setName(set);
        const cut = full.length > LABEL_CHARS ? `${full.slice(0, LABEL_CHARS - 1)}…` : full;
        return {
            x: lx + side * 0.15, y: ly, xref: 'x', yref: 'y', text: `${set.letter} · ${cut}`, showarrow: false, captureevents: true,
            xanchor: side < 0 ? 'right' : (side > 0 ? 'left' : 'center'), hovertext: `${set.letter} · ${full}`,
            font: { size: 14, color: theme.textColor }
        };
    }) : [];
    annotations.push({
        x: 1, y: 0, xref: 'paper', yref: 'paper', xanchor: 'right', yanchor: 'bottom', showarrow: false,
        text: text.noSet(plot.inNone), font: { size: 12, color: theme.textColor }
    });
    const note = proportional && g.error !== null && g.error > NOTE_AT;
    if (note) {
        annotations.push({
            x: 0, y: 0, xref: 'paper', yref: 'paper', xanchor: 'left', yanchor: 'top', yshift: -6, showarrow: false,
            text: text.approximate(fmtPercent(g.error)), font: { size: 12, color: theme.textColor }
        });
    }
    return {
        data: [{ type: 'scatter', mode: 'text', name: 'regions', x, y, text: texts, hovertext: hover, hoverinfo: 'text',
            customdata: region, textfont: { color: theme.textColor, size: 13 } }],
        layout: {
            ...themeLayout(theme), shapes, annotations, margin: { l: 16, r: 16, t: 16, b: note ? 40 : 16 },
            // the circles are drawn in these axes' coordinates, so they are pinned: a fixed range, no autorange, and no ticks of any kind
            // (an axis with `visible: false` still has Plotly compute a tick step on some redraws, which made a plot drawn twice differ
            // from one drawn once: tests/browser/test_render_drift.py)
            xaxis: { ...HIDDEN_AXIS, range: g.xRange },
            yaxis: { ...HIDDEN_AXIS, range: g.yRange, scaleanchor: 'x' }
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
            ? { color: colourValues, ...scaleKeys(opts, 'marker', {}), showscale: true,
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
            hovertext: plot.sets.map(s => `${s.name}<br>${plain(s.size)} cells`), hoverinfo: 'text', marker: { color: coloursOf(plot), opacity: 0.85 } }
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
 * `options`: `labels` ('both' | 'count' | 'share' | 'none'; Venn defaults to both, UpSet to count), a Venn's `names` (false
 * leaves the set names off; default on) and `proportional` (true: areas follow the counts; default off), `logCounts`, `colorscale` and `colour`
 * (the colour map, Reverse and range of an UpSet's coloured bars: colour.js), and the
 * panel's `width` in pixels (UpSet thins its bar labels and moves the set sizes under the matrix when it is small).
 */
// export-unused-ok: C3's draw.js and the panel dispatch to it for the Venn and UpSet modes
export function buildFigure(plot, theme, options = {}) {
    return plot.mode === 'upset' ? upsetFigure(plot, theme, options) : vennFigure(plot, theme, options);
}
