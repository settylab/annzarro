/**
 * The Cell-Gene Plot's matrix and its legends (0.8.0 step X4a; CXG-9, CXG-12, CXG-15, CXG-16, CXG-20; UX 3.2 "in the
 * plot" and 3.3): `buildFigure(model, theme)` returns the Plotly figure `{data, layout, config}` for dots or a heatmap,
 * with the color bar, the size legend and the hover text. It is pure and holds no DOM, so Node tests hold the figure.
 * Brackets, strips, totals, dendrograms and label thinning are draw-annotations.js's (X4b), applied at the end of
 * buildFigure; the model's `pixels` and `annotations` fields are described there.
 *
 * **The model** (the panel builds it from utils/cell-gene-model.js; every word the user reads is passed in or comes from
 * utils/vocabulary.js):
 * ```
 * { mode: 'dots' | 'heatmap', swap?: boolean,
 *   groups: [{ label, n }],                       the cell axis, in order; `n` is the group's cells
 *   rows: [{ label, gapBefore?,                   the gene axis, in order; `gapBefore` empty positions before it
 *            section?: { index, title },          the row's section (needed when `own` is given)
 *            own?: { color?: { id, label }, size?: { id, label } } }],   a one-row section's own quantity
 *   color: { id, stat, layer?, detectAbove?, scaling, values, raw?, noExpressing?, colorscale,
 *            min?, max?, center?, title?, printValues? },
 *   size:  { id, stat, layer?, detectAbove?, values, dotMin?, dotMax?, smallest?, largest?, title? }
 *        | { none: sentence },                    No size: one dot size, the legend replaced by the sentence
 *   legend?: { colorBar?: boolean, sizeLegend?: boolean, strips?: boolean }, plotTitle?: string,
 *   pendingText?: string }                        what a row still being read says (rows[].pending, CXG-18)
 * ```
 * A row with `pending: true` is a placeholder of a section still being read (CXG-18): its cells are drawn faint, with
 * `pendingText` in the hover, never as missing values. A strip of draw-annotations.js with a `legend` ({label, colour}
 * per level) gets a legend in the legend column, below the color bars and size legends (X5).
 * `values` are `rows x groups` Float64Arrays (`values[row * groups + group]`, NaN for no value) as the model's scale()
 * and setRow() write them; `values` of `color` are the values as displayed (scaled), `raw` the statistic as computed.
 *
 * **Which rows share a legend** (UX 3.3, Q1). Gene rows and a one-row section share the color bar when they show the
 * same quantity (`id`) or when a scaling is on, since 0-to-1 and z-score values are on one scale. Otherwise the section
 * gets its own color bar, titled with the section. A one-row section whose size is not the genes' size (`id`) gets its
 * own size legend likewise. The ids are the panel's: equal ids mean the same statistic, layer, threshold and scale.
 *
 * **Cost.** One pass over the matrix for the layout and one for the traces; nothing here grows faster than the cells
 * (a heatmap draws up to 400,000, CXG-17). Hover text is built per cell from strings made once per row and group.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { PLOT_PALETTES, GAP_COLOUR } from '../../utils/plot-theme.js';
import { arrayMin, arrayMax } from '../../utils/array-stats.js';
import { annotateFigure, matrixPixels, rowCoordinates } from './draw-annotations.js';

const W = VOCABULARY.cellGene;

/** Dots are `scatter` up to this many, so a vector export stays vector; `scattergl` above (plan 1.7). */
const DOT_SVG_MAX = 5000;

const SMALLEST_DOT = 3;
const LARGEST_DOT = 20;
const ONE_SIZE = 9;
const REFERENCE_DOTS = 5;
/** A reference dot of the size legend takes at least this many px, so its label never meets the next dot's. */
const REFERENCE_LINE_PX = 16;
/** The figure's margins, px. */
const MARGIN = Object.freeze({ l: 10, r: 10, t: 10, b: 10 });
/**
 * A column of the matrix keeps at least this many px along the gene axis (a dot must be told apart from the next);
 * at a narrow width the bands give way first (fitMatrix).
 */
const MIN_COLUMN_PX = Object.freeze({ dots: 10, heatmap: 4 });
/** The plot takes the left of the figure and the legends stack in the column on its right, in paper units. */
const LEGEND_X = 0.83;
const PLOT_RIGHT = 0.78;
/** The legend column is at least this wide in px, so a narrow figure's legends stay readable (the plot gives way). */
const LEGEND_MIN_PX = 120;
const LEGEND_SLOT_MAX = 0.3;
/** The top of the legend column stays clear of Plotly's modebar (camera, zoom, pan), about this many px tall. */
const MODEBAR_PX = 36;
const DEFAULT_HEIGHT = 600;
const MAIN = 'main';
/** A character's width in em, on average (as draw-annotations.js measures labels), and the most lines a title wraps to. */
const CHAR_EM = 0.58;
const TITLE_LINES = 3;
/** A line of a strip's legend, in px: its levels are listed while they fit, then "+ N more". */
const LEGEND_LINE_PX = 15;
const PENDING_DOT = 5;

/** Plotly reads a little markup in titles, ticks and hover text, so a name holding `<` or `&` is escaped. */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fmt = (v) => String(Number(v.toPrecision(4)));
const fmtCount = (n) => n.toLocaleString('en-US');

/** "Mean · X", "% expressing (> 0) · logged_counts": a quantity named by statistic, threshold and layer. */
function statisticTitle({ stat, layer, detectAbove }) {
    const threshold = (stat === 'pct_expressing' || stat === 'mean_expressing') && detectAbove != null ? ` (> ${fmt(detectAbove)})` : '';
    return `${W.statistic[stat]}${threshold}${layer ? ` · ${layer}` : ''}`;
}

// --- which rows share which legend ------------------------------------------------------------------------------

function sizeKeyOf(model, row) {
    const own = row.own && row.own.size;
    return own && own.id !== model.size.id ? `s${row.section.index}` : MAIN;
}

/** The rows of each key, in first-appearance order: `[{ key, rows: [index], section }]`. */
function groupRows(rows, keyOf) {
    const byKey = new Map();
    for (let r = 0; r < rows.length; r++) {
        const key = keyOf(rows[r]);
        if (!byKey.has(key)) byKey.set(key, { key, rows: [], section: rows[r].section });
        byKey.get(key).rows.push(r);
    }
    return [...byKey.values()];
}

/** Lowest and highest finite value of `values` over the given rows; `[Infinity, -Infinity]` when there is none. */
function rangeOver(values, groups, rowIdx) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rowIdx) {
        const part = values.subarray(r * groups, (r + 1) * groups);
        const a = arrayMin(part);
        const b = arrayMax(part);
        if (a < lo) lo = a;
        if (b > hi) hi = b;
    }
    return [lo, hi];
}

/** The color range of a bar: the data's, Min and Max where set, symmetric about Center where set, never empty. */
function colourRange(values, groups, rowIdx, { min, max, center }) {
    let [lo, hi] = rangeOver(values, groups, rowIdx);
    if (min != null) lo = min;
    if (max != null) hi = max;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) [lo, hi] = [0, 1];
    if (center != null) {
        const half = Math.max(Math.abs(hi - center), Math.abs(center - lo));
        [lo, hi] = [center - half, center + half];
    }
    return hi > lo ? [lo, hi] : [lo - 0.5, lo + 0.5];
}

/**
 * The model's rows as the sections colourBars reads: one entry per one-row section that has a quantity of its own, and
 * the other rows (genes, and one-row sections on the genes' quantity) in a single entry with no `own`.
 */
function sectionsOf(rows) {
    const sections = [];
    let genes = null;
    rows.forEach((row, r) => {
        if (row.own && row.own.color) {
            sections.push({ title: row.section.title, rows: [r], own: row.own.color });
        } else {
            if (!genes) {
                genes = { title: '', rows: [] };
                sections.push(genes);
            }
            genes.rows.push(r);
        }
    });
    return sections;
}

/**
 * The color bars of a matrix: which rows share one, and its range. The drawing and the clustering (X2b: a cell's
 * position on its own bar) both read this, so they cannot disagree (UX 3.3, Q1).
 * - Under a scaling (0 to 1, z-score) every row is on one scale: one bar for all rows.
 * - Unscaled, a section with its own quantity (`own: {id, label}`) different from the genes' (`settings.id`) gets a bar
 *   of its own, titled with the section; every other row shares the genes' bar.
 * Every row is in exactly one bar. `lo` and `hi` skip NaN; Min, Max and Center of `settings` apply to the genes' bar.
 * @param {{values: Float64Array, rows: number, groups: number}} matrix - the displayed values
 * @param {{title: string, rows: number[], own?: {id: string, label: string}}[]} sections - `rows` are matrix rows
 * @param {{id: string, scaling: string, stat: string, layer?: string, detectAbove?: number, title?: string,
 *   min?: number, max?: number, center?: number}} settings
 * @returns {{key: string, rows: Int32Array, lo: number, hi: number, title: string, lines: string[]}[]}
 */
// export-unused-ok: X3a passes it to X2b's order() as bars
export function colourBars(matrix, sections, settings) {
    const groups = new Map();
    const add = (key, section, rowIdx) => {
        if (!groups.has(key)) groups.set(key, { key, section, rows: [] });
        for (const r of rowIdx) groups.get(key).rows.push(r);
    };
    for (const section of sections) {
        const own = section.own && settings.scaling === 'none' && section.own.id !== settings.id;
        add(own ? `s${section.title}\u0000${section.rows[0]}` : MAIN, section, section.rows);
    }
    return [...groups.values()].map((g) => {
        const isOwn = g.key !== MAIN;
        const lines = isOwn ? [g.section.title, g.section.own.label]
            : settings.title ? [settings.title]
                : [statisticTitle(settings), ...(settings.scaling === 'none' ? [] : [W.scaled[settings.scaling]])];
        const rows = Int32Array.from(g.rows.sort((a, b) => a - b));
        const [lo, hi] = colourRange(matrix.values, matrix.groups, rows, isOwn ? {} : settings);
        return { key: g.key, rows, lo, hi, title: lines.join('<br>'), lines };
    });
}

/** The model's rows, cells and legends as the traces need them. */
function prepare(model) {
    const { groups, rows, color } = model;
    const G = groups.length;
    // one rule for where rows go, the annotations' (gaps between sections skipped); no rows span nothing here
    const { pos, extent } = rowCoordinates(rows);
    const span = rows.length === 0 ? 0 : extent;

    const colour = colourBars({ values: color.values, rows: rows.length, groups: G }, sectionsOf(rows), color)
        .map((bar) => ({ key: bar.key, rows: Array.from(bar.rows), lines: bar.lines, lo: bar.lo, hi: bar.hi }));

    const sized = !model.size.none;
    const size = !sized ? [] : groupRows(rows, (row) => sizeKeyOf(model, row)).map((k) => {
        const own = k.key !== MAIN;
        const spec = model.size;
        const lines = own ? [k.section.title, rows[k.rows[0]].own.size.label] : spec.title ? [spec.title] : [statisticTitle(spec)];
        const [dataLo, dataHi] = rangeOver(spec.values, G, k.rows);
        const lo = !own && spec.dotMin != null ? spec.dotMin : dataLo;
        const hi = !own && spec.dotMax != null ? spec.dotMax : dataHi;
        return { ...k, lines, lo, hi };
    });
    return { G, pos, span, colour, size };
}

/** A dot's diameter in px for a value on a size legend's range (dot_min to dot_max). */
function diameterOf(v, lo, hi, smallest, largest) {
    if (!(hi > lo)) return (smallest + largest) / 2;
    const t = v <= lo ? 0 : v >= hi ? 1 : (v - lo) / (hi - lo);
    return smallest + (largest - smallest) * t;
}

// --- hover text (CXG-15) ----------------------------------------------------------------------------------------

/** `(r, g, i) => text`: the group and its cells, the gene (or section and aggregation), each shown value. */
function describer(model, P, dots) {
    const { groups, rows, color, size } = model;
    const groupLine = groups.map((g) => `${esc(g.label)} · ${W.csv.cells}: ${fmtCount(g.n)}`);
    const rowLine = rows.map((r) => esc(r.section && r.own ? `${r.section.title} · ${r.label}` : r.label));
    const colourName = rows.map((r) => esc(r.own && r.own.color ? r.own.color.label : statisticTitle(color)));
    const sizeName = dots && !size.none ? rows.map((r) => esc(r.own && r.own.size ? r.own.size.label : statisticTitle(size))) : null;
    const scaled = color.scaling !== 'none';
    const scaledWord = W.scaled[color.scaling];
    const none = VOCABULARY.word.noValue;

    return (r, g, i) => {
        const v = color.values[i];
        let colourText;
        if (!Number.isFinite(v)) {
            colourText = `${colourName[r]}: ${none}`;
        } else {
            colourText = scaled
                ? color.raw ? `${colourName[r]}: ${fmt(color.raw[i])} (${scaledWord}: ${fmt(v)})` : `${colourName[r]} (${scaledWord}): ${fmt(v)}`
                : `${colourName[r]}: ${fmt(v)}`;
            if (color.noExpressing && color.noExpressing[i]) colourText += ` (${W.noExpressingCells})`;
        }
        const sizeText = sizeName && Number.isFinite(size.values[i]) ? `<br>${sizeName[r]}: ${fmt(size.values[i])}` : '';
        return `${groupLine[g]}<br>${rowLine[r]}<br>${colourText}${sizeText}`;
    };
}

// --- legends ----------------------------------------------------------------------------------------------------

/** Where the legend column starts, in paper units: LEGEND_X, or further left in a narrow figure (LEGEND_MIN_PX). */
function legendX(model, keepMin = true) {
    if (!keepMin || !model.pixels || !(model.pixels.width > 0)) return LEGEND_X;
    return Math.min(LEGEND_X, 1 - LEGEND_MIN_PX / Math.max(model.pixels.width - 20, 1));
}

/** How many characters a line of the legend column holds at the figure's width; with no width known, any. */
function legendChars(model, th, x) {
    if (!model.pixels || !(model.pixels.width > 0)) return Infinity;
    const px = Math.max(model.pixels.width - 20, 1) * (1 - x);
    return Math.max(4, Math.floor(px / (CHAR_EM * (th.fontSize || 12))));
}

/**
 * A legend title fitted to the legend column: each of its lines wrapped at spaces to `chars` characters, at most
 * TITLE_LINES lines, a word or a last line too long cut with an ellipsis. Returns the markup and, when anything was cut,
 * the whole title for the hover (`full`, else null).
 * @param {string[]} lines
 * @param {number} chars
 * @returns {{text: string, full: (string|null)}}
 */
function fitTitle(lines, chars) {
    const out = [];
    let cut = false;
    const push = (line) => {
        if (out.length < TITLE_LINES) { out.push(line); return; }
        cut = true;
        const last = out[TITLE_LINES - 1];
        out[TITLE_LINES - 1] = `${last.slice(0, Math.max(chars - 1, 1))}…`;
    };
    for (const line of lines) {
        let now = '';
        for (const word of words(line)) {
            const w = word.length > chars ? `${word.slice(0, chars - 1)}…` : word;
            if (w !== word) cut = true;
            if (!now) now = w;
            else if (now.length + 1 + w.length <= chars) now = `${now} ${w}`;
            else { push(now); now = w; }
        }
        push(now);
    }
    if (cut && out.length === TITLE_LINES && !out[TITLE_LINES - 1].endsWith('…')) out[TITLE_LINES - 1] = `${out[TITLE_LINES - 1].slice(0, Math.max(chars - 1, 1))}…`;
    return { text: out.map(esc).join('<br>'), full: cut ? lines.join(' · ') : null };
}

/** The paper height a fitted title takes at the top of its slot: its lines, at most 45% of the slot. */
function titleRoomOf(model, entry, fitted) {
    const plotPx = Math.max(((model.pixels && model.pixels.height) || DEFAULT_HEIGHT) - 20, 1);
    const lines = fitted.text.split('<br>').length;
    return Math.min(entry.height * 0.45, (lines * LEGEND_LINE_PX + 4) / plotPx);
}

/** A line's words for wrapping: a bracketed part such as "(> 0)" is one word, so it never breaks inside. */
function words(line) {
    const out = [];
    let open = null;
    for (const w of String(line).split(' ')) {
        if (open !== null) {
            open = `${open} ${w}`;
            if (w.includes(')')) { out.push(open); open = null; }
        } else if (w.startsWith('(') && !w.includes(')')) {
            open = w;
        } else {
            out.push(w);
        }
    }
    if (open !== null) out.push(open);
    return out;
}

/** A transparent copy of a cut title over it, whose hover gives the whole title (Plotly titles have no hover). */
function titleHover(fitted, x, y, th) {
    return {
        name: 'legend title hover', xref: 'paper', yref: 'paper', x, y, xanchor: 'left', yanchor: 'top', showarrow: false,
        align: 'left', text: fitted.text, font: { color: 'rgba(0,0,0,0)' }, hovertext: esc(fitted.full), captureevents: true,
        hoverlabel: { bgcolor: th.bgColor, font: { color: th.textColor } }
    };
}

/**
 * Keep the matrix readable at a narrow width: while a column of it would get under MIN_COLUMN_PX along the gene axis,
 * give up, in order, the totals bar, then the groups' dendrogram (both stand beside the matrix along that axis), then
 * the legend column's minimum width. Returns the model drawn and what was given up ('totals', 'dendrogram', 'legend'),
 * which the panel says in its strip. Nothing changes with no width known. Cost: a few passes over the labels.
 */
function fitMatrix(model, P, dots, th) {
    if (!model.pixels || !(model.pixels.width > 0)) return { model, hidden: [], keepMin: true };
    const need = P.span * MIN_COLUMN_PX[dots ? 'dots' : 'heatmap'];
    const fontPx = th.fontSize || 12;
    const legend = legendStack(model, P, dots, th).length > 0;
    let m = model;
    let keepMin = true;
    const hidden = [];
    const room = () => {
        const right = legend ? legendX(m, keepMin) - (LEGEND_X - PLOT_RIGHT) : 1;
        return matrixPixels(m, { right, fontPx, margin: MARGIN });
    };
    const ann = () => m.annotations || {};
    const steps = [
        ['totals', () => !!ann().totals, () => { m = { ...m, annotations: { ...ann(), totals: false } }; }],
        ['dendrogram', () => !!(ann().dendrograms && ann().dendrograms.groups && ann().dendrograms.groups.length),
            () => { m = { ...m, annotations: { ...ann(), dendrograms: { ...ann().dendrograms, groups: [] } } }; }],
        ['legend', () => legend && !m.swap && legendX(m, true) < LEGEND_X, () => { keepMin = false; }]
    ];
    for (const [name, applies, apply] of steps) {
        if (room() >= need) break;
        if (!applies()) continue;
        apply();
        hidden.push(name);
    }
    return { model: m, hidden, keepMin };
}

/**
 * The legend column, top to bottom: one entry per color bar, then one per size legend (or the sentence that replaces it
 * under No size). `top` and `height` are paper fractions.
 */
function legendStack(model, P, dots, th, keepMin = true) {
    const x = legendX(model, keepMin);
    const chars = legendChars(model, th, x);
    const items = [];
    const wanted = (k) => !model.legend || model.legend[k] !== false;
    if (wanted('colorBar')) for (const k of P.colour) items.push({ kind: 'bar', key: k.key });
    if (dots && wanted('sizeLegend')) {
        if (model.size.none) items.push({ kind: 'none' });
        else for (const k of P.size) items.push({ kind: 'size', key: k.key });
    }
    const strips = (model.annotations && model.annotations.strips) || [];
    if (wanted('strips')) strips.forEach((strip, i) => { if (strip.legend && strip.legend.length) items.push({ kind: 'strip', index: i }); });
    const reserve = MODEBAR_PX / Math.max(((model.pixels && model.pixels.height) || DEFAULT_HEIGHT) - 20, 1);
    const slot = Math.min(LEGEND_SLOT_MAX, (0.96 - reserve) / Math.max(items.length, 1));
    items.forEach((it, i) => {
        it.top = 1 - reserve - i * slot;
        it.height = slot * 0.82;
        it.chars = chars;
        it.x = x;
    });
    return items;
}

const barOf = (stack, key) => stack.find((it) => it.kind === 'bar' && it.key === key);

/** A Plotly color bar for one key, placed in its slot of the legend column. */
function colourBar(entry, lines, th) {
    return {
        title: { text: fitTitle(lines, entry.chars).text, side: 'top', font: { color: th.textColor } },
        tickfont: { color: th.textColor },
        x: entry.x, xanchor: 'left', y: entry.top, yanchor: 'top', len: entry.height, lenmode: 'fraction', thickness: 12,
        outlinewidth: 0
    };
}

/**
 * The size legend of one key: up to five reference dots from dot_min to dot_max, on a small subplot of its own; fewer
 * (at least two, the ends) when the slot is too short for each to have its line.
 */
function sizeLegendParts(model, k, entry, n, th) {
    const { smallest = SMALLEST_DOT, largest = LARGEST_DOT } = model.size;
    const axisId = n + 2;
    const fitted = fitTitle(k.lines, entry.chars);
    const titleRoom = titleRoomOf(model, entry, fitted);
    const plotPx = Math.max(((model.pixels && model.pixels.height) || DEFAULT_HEIGHT) - 20, 1);
    const linePx = Math.max(REFERENCE_LINE_PX, largest);
    const count = model.pixels ? Math.max(2, Math.min(REFERENCE_DOTS, Math.floor(((entry.height - titleRoom) * plotPx) / linePx))) : REFERENCE_DOTS;
    const refs = Array.from({ length: count }, (_, j) => k.lo + ((k.hi - k.lo) * j) / (count - 1));
    const trace = {
        type: 'scatter', mode: 'markers+text', name: 'size legend', hoverinfo: 'skip', showlegend: false,
        xaxis: `x${axisId}`, yaxis: `y${axisId}`,
        x: refs.map(() => 0), y: refs.map((_, j) => j),
        text: refs.map((v) => (k.hi > k.lo ? fmt(v) : fmt(k.lo))), textposition: 'middle right', cliponaxis: false,
        marker: { size: refs.map((v) => diameterOf(v, k.lo, k.hi, smallest, largest)), color: th.axisColor, opacity: 0.55, line: { width: 0 } }
    };
    const axes = {
        [`xaxis${axisId}`]: { domain: [entry.x + 0.01, 1], range: [-0.6, 3], visible: false, fixedrange: true },
        [`yaxis${axisId}`]: { domain: [entry.top - entry.height, entry.top - titleRoom], range: [count - 0.4, -0.6], visible: false, fixedrange: true }
    };
    const title = {
        xref: 'paper', yref: 'paper', x: entry.x, y: entry.top, xanchor: 'left', yanchor: 'top', showarrow: false,
        align: 'left', text: fitted.text, font: { color: th.textColor }, ...(fitted.full ? { hovertext: esc(fitted.full), captureevents: true } : {})
    };
    return { trace, axes, title };
}

/**
 * The legend of one strip: its factor as the title, then a swatch and the label of each level, as many as the slot
 * holds, the last line "+ N more" when they do not all fit.
 */
function stripLegendParts(model, strip, entry, n, th) {
    const plotPx = Math.max(((model.pixels && model.pixels.height) || DEFAULT_HEIGHT) - 20, 1);
    const fitted = fitTitle([strip.title], entry.chars);
    const titleRoom = titleRoomOf(model, entry, fitted);
    const fit = Math.max(1, Math.floor(((entry.height - titleRoom) * plotPx) / LEGEND_LINE_PX));
    const all = strip.legend;
    const shown = all.length <= fit ? all : all.slice(0, fit - 1);
    const more = all.length - shown.length;
    const lines = shown.length + (more ? 1 : 0);
    const axisId = n + 2;
    const trace = {
        type: 'scatter', mode: 'markers+text', name: 'strip legend', hoverinfo: 'skip', showlegend: false,
        xaxis: `x${axisId}`, yaxis: `y${axisId}`,
        x: Array.from({ length: lines }, () => 0), y: Array.from({ length: lines }, (_, j) => j),
        text: [...shown.map((e) => esc(e.label)), ...(more ? [esc(W.options.more(more))] : [])], textposition: 'middle right', cliponaxis: false,
        marker: { symbol: 'square', size: 10, color: [...shown.map((e) => e.colour), ...(more ? ['rgba(0,0,0,0)'] : [])], line: { width: 0 } },
        textfont: { color: th.textColor }
    };
    const top = entry.top - titleRoom;
    const axes = {
        [`xaxis${axisId}`]: { domain: [entry.x + 0.01, 1], range: [-0.6, 6], visible: false, fixedrange: true },
        [`yaxis${axisId}`]: { domain: [entry.top - entry.height, top], range: [Math.max(lines, fit) - 0.5, -0.5], visible: false, fixedrange: true }
    };
    const title = {
        name: 'strip legend title', xref: 'paper', yref: 'paper', x: entry.x, y: entry.top, xanchor: 'left', yanchor: 'top', showarrow: false,
        align: 'left', text: fitted.text, font: { color: th.textColor }, ...(fitted.full ? { hovertext: esc(fitted.full), captureevents: true } : {})
    };
    return { trace, axes, title };
}

/** The hover of a placeholder cell (CXG-18): the group, the row, and what is being read. */
function pendingHover(model) {
    const said = esc(model.pendingText || '');
    return (r, g) => `${esc(model.groups[g].label)}<br>${esc(model.rows[r].label)}<br>${said}`;
}

// --- axes -------------------------------------------------------------------------------------------------------

/**
 * Every tick is given here; annotateFigure (draw-annotations.js) keeps the labels that fit the axis's pixels, so Plotly
 * measures tens of labels, not thousands. The hover still names every cell.
 */
function axisOf(ticks, labels, extent, th, extra) {
    return {
        tickvals: ticks, ticktext: labels, range: [-0.5, Math.max(extent, 1) - 0.5], zeroline: false, automargin: true,
        gridcolor: th.gridColor, linecolor: th.axisColor, tickcolor: th.axisColor, ...extra
    };
}

function layoutAxes(model, P, th, dots, right) {
    const groupTicks = model.groups.map((_, g) => g);
    const groupLabels = model.groups.map((g) => esc(g.label));
    const rowLabels = model.rows.map((r) => (r.own ? `<i>${esc(r.label)}</i>` : esc(r.label)));
    const group = axisOf(groupTicks, groupLabels, P.G, th, { showgrid: dots });
    const gene = axisOf(P.pos, rowLabels, P.span, th, { showgrid: dots });
    const flip = (axis) => ({ ...axis, range: [axis.range[1], axis.range[0]] });
    // the first group, or the first gene when swapped, is at the top; genes on x are read from above, at an angle
    return model.swap
        ? { xaxis: { ...group, domain: [0, right] }, yaxis: { ...flip(gene), domain: [0, 1] } }
        : { xaxis: { ...gene, domain: [0, right], side: 'top', tickangle: -90 }, yaxis: { ...flip(group), domain: [0, 1] } };
}

// --- dots -------------------------------------------------------------------------------------------------------

function dotTraces(model, P, stack, th) {
    const { color, size, swap } = model;
    const G = P.G;
    const smallest = size.none ? ONE_SIZE : size.smallest != null ? size.smallest : SMALLEST_DOT;
    const largest = size.none ? ONE_SIZE : size.largest != null ? size.largest : LARGEST_DOT;
    const describe = describer(model, P, true);
    const sizeSpec = new Map(P.size.map((k) => [k.key, k]));
    const sizeKey = P.size.length ? model.rows.map((row) => sizeKeyOf(model, row)) : null;

    let total = 0;
    const traces = P.colour.map((k) => {
        const x = [];
        const y = [];
        const sizes = [];
        const colours = [];
        const text = [];
        for (const r of k.rows) {
            const spec = sizeKey ? sizeSpec.get(sizeKey[r]) : null;
            for (let g = 0; g < G; g++) {
                const i = r * G + g;
                const c = color.values[i];
                if (!Number.isFinite(c)) continue;
                let d = ONE_SIZE;
                if (spec) {
                    const s = size.values[i];
                    if (!Number.isFinite(s)) continue;
                    d = diameterOf(s, spec.lo, spec.hi, smallest, largest);
                }
                x.push(swap ? g : P.pos[r]);
                y.push(swap ? P.pos[r] : g);
                sizes.push(d);
                colours.push(c);
                text.push(describe(r, g, i));
            }
        }
        total += x.length;
        const entry = barOf(stack, k.key);
        const marker = { size: sizes, color: colours, colorscale: color.colorscale, cmin: k.lo, cmax: k.hi, showscale: Boolean(entry) };
        if (entry) marker.colorbar = colourBar(entry, k.lines, th);
        return { type: 'scatter', mode: 'markers', x, y, text, hoverinfo: 'text', showlegend: false, marker };
    });
    const pending = pendingRows(model);
    if (pending.length) {
        const hover = pendingHover(model);
        const x = [];
        const y = [];
        const text = [];
        for (const r of pending) {
            for (let g = 0; g < G; g++) {
                x.push(swap ? g : P.pos[r]);
                y.push(swap ? P.pos[r] : g);
                text.push(hover(r, g));
            }
        }
        traces.push({ type: 'scatter', mode: 'markers', name: 'rows being read', x, y, text, hoverinfo: 'text', showlegend: false,
            marker: { size: PENDING_DOT, symbol: 'circle-open', color: th.axisColor, opacity: 0.6 } });
        total += x.length;
    }
    const type = total > DOT_SVG_MAX ? 'scattergl' : 'scatter';
    for (const t of traces) if (t.name !== 'rows being read') t.type = type;
    return traces;
}

/** The rows still being read (CXG-18). */
function pendingRows(model) {
    const out = [];
    model.rows.forEach((row, r) => { if (row.pending) out.push(r); });
    return out;
}

// --- heatmap ----------------------------------------------------------------------------------------------------

function blank(rows, cols) {
    return Array.from({ length: rows }, () => new Array(cols).fill(NaN));
}

function heatmapTraces(model, P, stack, th) {
    const { color, swap } = model;
    const G = P.G;
    const Y = swap ? P.span : G;
    const X = swap ? G : P.span;
    const xs = Array.from({ length: X }, (_, k) => k);
    const ys = Array.from({ length: Y }, (_, k) => k);
    const describe = describer(model, P, false);
    const noValue = [];
    const pending = new Set(pendingRows(model));

    const layers = P.colour.map((k) => {
        const z = blank(Y, X);
        const text = Array.from({ length: Y }, () => new Array(X));
        for (const r of k.rows) {
            for (let g = 0; g < G; g++) {
                const i = r * G + g;
                const yy = swap ? P.pos[r] : g;
                const xx = swap ? g : P.pos[r];
                const v = color.values[i];
                if (Number.isFinite(v)) {
                    z[yy][xx] = v;
                    text[yy][xx] = describe(r, g, i);
                } else if (!pending.has(r)) {
                    noValue.push(yy, xx, describe(r, g, i));
                }
            }
        }
        const entry = barOf(stack, k.key);
        const trace = {
            type: 'heatmap', x: xs, y: ys, z, text, hoverinfo: 'text', hoverongaps: false,
            colorscale: color.colorscale, zmin: k.lo, zmax: k.hi, showscale: Boolean(entry)
        };
        if (entry) trace.colorbar = colourBar(entry, k.lines, th);
        if (color.printValues) trace.texttemplate = '%{z:.2~f}';
        return trace;
    });

    if (noValue.length) {
        const z = blank(Y, X);
        const text = Array.from({ length: Y }, () => new Array(X));
        for (let j = 0; j < noValue.length; j += 3) {
            z[noValue[j]][noValue[j + 1]] = 1;
            text[noValue[j]][noValue[j + 1]] = noValue[j + 2];
        }
        layers.push({
            type: 'heatmap', x: xs, y: ys, z, text, hoverinfo: 'text', hoverongaps: false, showscale: false,
            colorscale: [[0, GAP_COLOUR], [1, GAP_COLOUR]], zmin: 0, zmax: 1
        });
    }
    if (pending.size) {
        const hover = pendingHover(model);
        const z = blank(Y, X);
        const text = Array.from({ length: Y }, () => new Array(X));
        for (const r of pending) {
            for (let g = 0; g < G; g++) {
                const yy = swap ? P.pos[r] : g;
                const xx = swap ? g : P.pos[r];
                z[yy][xx] = 1;
                text[yy][xx] = hover(r, g);
            }
        }
        layers.push({
            type: 'heatmap', name: 'rows being read', x: xs, y: ys, z, text, hoverinfo: 'text', hoverongaps: false, showscale: false,
            colorscale: [[0, th.gridColor], [1, th.gridColor]], zmin: 0, zmax: 1, opacity: 0.6
        });
    }
    return layers;
}

// --- the figure -------------------------------------------------------------------------------------------------

/**
 * @param {object} model - see the top of this file
 * @param {{bgColor: string, gridColor: string, axisColor: string, textColor: string, fontFamily?: string, fontSize?: number}}
 *   [theme] - the plot's resolved colors (plot-theme.js: PLOT_PALETTES or plotColour of the panel's settings); light by default
 * @returns {{data: object[], layout: object, config: object, hidden: string[]}} `hidden`: what a narrow width gave up
 *   so each column of the matrix keeps MIN_COLUMN_PX ('totals', 'dendrogram', 'legend'; fitMatrix)
 */
// export-unused-ok: X3a draws the panel with it
export function buildFigure(given, theme) {
    if (given.mode !== 'dots' && given.mode !== 'heatmap') throw new Error(`unknown mode ${given.mode}`);
    const dots = given.mode === 'dots';
    if (dots && !given.size) throw new Error('dots need a size or a No size sentence');
    const th = { ...PLOT_PALETTES.light, ...theme };
    const P = prepare(dots ? given : { ...given, size: { none: true } });
    const { model, hidden, keepMin } = fitMatrix(given, P, dots, th);
    const stack = legendStack(model, P, dots, th, keepMin);
    const right = stack.length ? stack[0].x - (LEGEND_X - PLOT_RIGHT) : 1;

    const data = dots ? dotTraces(model, P, stack, th) : heatmapTraces(model, P, stack, th);
    const layout = {
        paper_bgcolor: th.bgColor, plot_bgcolor: th.bgColor, showlegend: false, hovermode: 'closest',
        font: { family: th.fontFamily || 'Arial, Helvetica, sans-serif', size: th.fontSize || 12, color: th.textColor },
        margin: { ...MARGIN }, annotations: [],
        ...layoutAxes(model, P, th, dots, right)
    };
    if (model.plotTitle) layout.title = { text: esc(model.plotTitle), font: { color: th.textColor } };

    let sized = 0;
    for (const entry of stack) {
        if (entry.kind === 'strip') {
            const parts = stripLegendParts(model, model.annotations.strips[entry.index], entry, sized++, th);
            data.push(parts.trace);
            Object.assign(layout, parts.axes);
            layout.annotations.push(parts.title);
        } else if (entry.kind === 'size') {
            const parts = sizeLegendParts(model, P.size.find((k) => k.key === entry.key), entry, sized++, th);
            data.push(parts.trace);
            Object.assign(layout, parts.axes);
            layout.annotations.push(parts.title);
        } else if (entry.kind === 'bar') {
            const fitted = fitTitle(P.colour.find((k) => k.key === entry.key).lines, entry.chars);
            if (fitted.full) layout.annotations.push(titleHover(fitted, entry.x, entry.top, th));
        } else if (entry.kind === 'none') {
            layout.annotations.push({
                xref: 'paper', yref: 'paper', x: entry.x, y: entry.top, xanchor: 'left', yanchor: 'top', showarrow: false,
                align: 'left', width: Number.isFinite(entry.chars) ? Math.max(60, Math.round(entry.chars * CHAR_EM * (th.fontSize || 12))) : 170, text: model.size.none, font: { color: th.textColor }
            });
        }
    }
    const config = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'] };
    const figure = annotateFigure({ data, layout, config }, model, th);
    // what a narrow width gave up for the matrix, for the panel's strip
    figure.hidden = hidden;
    return figure;
}
