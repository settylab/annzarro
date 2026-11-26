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
 *   color: { id, stat, layer?, detectAbove?, scaling, values, raw?, noExpressing?, colorscale, reversescale?,
 *            min?, max?, center?, title?, printValues? },
 *   size:  { id, stat, layer?, detectAbove?, values, dotMin?, dotMax?, smallest?, largest?, title? }
 *        | { none: sentence },                    No size: one dot size, the legend replaced by the sentence
 *   legend?: { colorBar?: boolean, sizeLegend?: boolean, strips?: boolean }, plotTitle?: string,
 *   outline?: { color, width }   the dots' outline, and the size legend's; absent means none; heatmap cells never have one
 *   dotOpacity?: number          the dots' opacity, 0.1 to 1 (1, opaque, when absent); the size legend's dots take the same
 *                                share of their own; a heatmap has none
 *   pendingText?: string,                         what a row still being read says (rows[].pending, CXG-18)
 *   view?: '3d', height?: { same: true, values, min?, max? } | { same: false, stat, layer?, detectAbove?, values, min?, max? },
 *   camera?: { eye, center?, up? }, zTitle?: string,    the 3D view (UX 6b, WP-12), see figure3d
 *   labels3d?: { side?, edges?, justify? } }           its labels' options (Plot Options ▸ Axes, in 3D)
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
import { DEFAULT_FONT } from '../../utils/fonts.js';
import { formatFraction } from '../../utils/cell-gene-model.js';
import { VOCABULARY } from '../../utils/vocabulary.js';
import { PLOT_PALETTES, GAP_COLOUR, MODEBAR_REMOVE } from '../../utils/plot-theme.js';
import { arrayMin, arrayMax } from '../../utils/array-stats.js';
import { annotateFigure, matrixPixels, rowCoordinates, MODEBAR_PX } from './draw-annotations.js';
import { bars3d, footprintFromSize, axisTicks } from '../../utils/bars-3d.js';
import { colourBar as colourBarOf } from '../plot-utilities/colour-bar.js';

const W = VOCABULARY.cellGene;

/** Dots are `scatter` up to this many, so a vector export stays vector; `scattergl` above (plan 1.7). */
const DOT_SVG_MAX = 5000;

const SMALLEST_DOT = 3;
const LARGEST_DOT = 20;
/** The largest dot fills its cell less DOT_GAP_PX, so neighbouring dots never touch, and is never under MIN_LARGEST_DOT. */
const DOT_GAP_PX = 2;
const MIN_LARGEST_DOT = 4;
/** The largest share of its cell a dot is drawn at (1000 %, Largest dot's typed ceiling). */
const MAX_DOT_SCALE = 10;
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
/** The widest a column of dots is drawn (px): fewer columns than the plot has room for keep this pitch, not stretch across it. */
const MAX_DOT_COLUMN_PX = 140;
/** The plot takes the left of the figure and the legends stack in the column on its right, in paper units. */
const LEGEND_X = 0.83;
const PLOT_RIGHT = 0.78;
/** The legend column is at least this wide in px, so a narrow figure's legends stay readable (the plot gives way). */
const LEGEND_MIN_PX = 120;
const LEGEND_SLOT_MAX = 0.3;
/** The share of a legend slot its content fills (the rest is the gap to the next), and the least a colour bar or size legend is shrunk to for a long strip legend. */
const LEGEND_SLOT_FILL = 0.82;
const LEGEND_SLOT_FLOOR = 0.18;
/** Most columns a strip legend wraps into by itself, and the fewest characters a label keeps in one. */
const LEGEND_AUTO_COLUMNS = 4;
const LEGEND_MIN_LABEL_CHARS = 8;
const DEFAULT_HEIGHT = 600;
const MAIN = 'main';
/** A character's width in em, on average (as draw-annotations.js measures labels), and the most lines a title wraps to. */
const CHAR_EM = 0.58;
const TITLE_LINES = 3;
/** A color bar: the px a line of its title takes, the least length left to the bar itself, and its padding (Plotly's ypad). */
const TITLE_LINE_PX = 17;
const BAR_MIN_PX = 20;
const BAR_PAD_PX = 4;
/** A line of a strip's legend, in px: its levels are listed while they fit, then "+ N more". */
const LEGEND_LINE_PX = 15;
const PENDING_DOT = 5;

/** Plotly reads a little markup in titles, ticks and hover text, so a name holding `<` or `&` is escaped. */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fmt = (v) => String(Number(v.toPrecision(4)));
const fmtCount = (n) => n.toLocaleString('en-US');
/** A statistic's value as text: a fraction in the fraction's format (`digits` decimals), any other as `fmt`. */
const fmtOf = (stat, digits = 2) => (stat === 'fraction_of_cells' ? (v) => formatFraction(v, digits) : fmt);

/** "Mean · X", "fraction of cells (> 0) · logged_counts": a quantity named by statistic, threshold and layer. */
function statisticTitle({ stat, layer, detectAbove }) {
    const threshold = (stat === 'fraction_of_cells' || stat === 'mean_expressing') && detectAbove != null ? ` (> ${fmt(detectAbove)})` : '';
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
                : [statisticTitle(settings), ...(settings.stat === 'zscore_mean' && W.unit[settings.stat] ? [W.unit[settings.stat]] : []),
                    ...(settings.scaling === 'none' ? [] : [W.scaled[settings.scaling]])];
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

/**
 * The matrix's cell in px, as the figure lays it out: the pitch along the genes or along the groups, whichever is
 * smaller. The axes' domains are annotateFigure's (labels, brackets, strips, trees and totals take their room around the
 * matrix), so the layout is made once here without the traces, which do not move it.
 */
function cellPixels(model, P, th, right) {
    const base = { font: { size: th.fontSize || 12 }, margin: { ...MARGIN }, annotations: [], ...layoutAxes(model, P, th, right) };
    if (model.plotTitle) base.title = { text: esc(model.plotTitle) };
    const { layout } = annotateFigure({ data: [], layout: base, config: {} }, model, th);
    const pixels = model.pixels || { width: 900, height: DEFAULT_HEIGHT };
    const inner = { w: pixels.width - layout.margin.l - layout.margin.r, h: pixels.height - layout.margin.t - layout.margin.b };
    const pitch = (ax, px) => ((ax.domain[1] - ax.domain[0]) * px) / Math.max(Math.abs(ax.range[1] - ax.range[0]), 1);
    return Math.min(pitch(layout.xaxis, inner.w), pitch(layout.yaxis, inner.h));
}

/**
 * The smallest and largest dot in px. By default the largest fills a cell of the matrix (cellPixels) less DOT_GAP_PX,
 * so the dots follow the plot's size and the number of rows and groups (operator, 2026-11-23); the size legend draws
 * them smaller when its slot cannot hold them, and says so. `size.scale` (0.1 to 10) takes that share of the cell (over
 * 1 a dot is larger than its cell and overlaps its neighbours, operator 2026-11-25); a
 * `size.largest` in px (the px range of a link from before) is kept as it is. The smallest dot is never larger than the
 * largest.
 */
function dotRange(model, P, th, right) {
    const size = model.size;
    let largest = size.largest;
    if (!(largest > 0)) {
        const scale = size.scale > 0 ? Math.min(MAX_DOT_SCALE, size.scale) : 1;
        largest = Math.max(MIN_LARGEST_DOT, scale * (cellPixels(model, P, th, right) - DOT_GAP_PX));
    }
    return { smallest: Math.min(size.smallest > 0 ? size.smallest : SMALLEST_DOT, largest), largest };
}

/** The size legend's grey reference dots, at Dot opacity 1. */
const LEGEND_DOT_OPACITY = 0.55;

/** Dot opacity, 0.1 to 1; 1 when absent. */
function dotOpacityOf(model) {
    const v = model.dotOpacity;
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : 1;
}

/**
 * A bar's height under the height range (Color ▾ in 3D, `height.min`, `height.max`): the statistic limited to the range,
 * as a color is limited to its Min and Max. A bar of 0 is not drawn, so a Min above 0 does not raise it.
 */
function limited(h, range) {
    if (!Number.isFinite(h) || h === 0) return h;
    if (range.min !== undefined && h < range.min) return range.min;
    if (range.max !== undefined && h > range.max) return range.max;
    return h;
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
    const unit = W.unit[color.stat] ? ` ${W.unit[color.stat]}` : '';        // a z-score is in SD

    return (r, g, i) => {
        const v = color.values[i];
        let colourText;
        if (!Number.isFinite(v)) {
            colourText = `${colourName[r]}: ${color.constant && color.constant[i] ? W.constantGene : none}`;
        } else {
            colourText = scaled
                ? color.raw ? `${colourName[r]}: ${fmt(color.raw[i])} (${scaledWord}: ${fmt(v)})` : `${colourName[r]} (${scaledWord}): ${fmt(v)}`
                : `${colourName[r]}: ${fmtOf(color.stat, 3)(v)}${unit}`;
            if (color.noExpressing && color.noExpressing[i]) colourText += ` (${W.noExpressingCells})`;
        }
        const sizeText = sizeName && Number.isFinite(size.values[i]) ? `<br>${sizeName[r]}: ${fmtOf(size.stat, 3)(size.values[i])}` : '';
        return `${groupLine[g]}<br>${rowLine[r]}<br>${colourText}${sizeText}`;
    };
}

// --- legends ----------------------------------------------------------------------------------------------------

/** Where the legend column starts, in paper units: LEGEND_X, or further left in a narrow figure (LEGEND_MIN_PX). */
function legendX(model, keepMin = true) {
    // the space Plot Options sets for the legend column (WP-5a, model.legendLayout: plot-style.js cellGeneLegend)
    const space = model.legendLayout && model.legendLayout.space;
    if (space > 0) return Math.max(0.4, Math.min(0.95, 1 - space));
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
 * @param {number} [most] - the most lines it takes (TITLE_LINES, or fewer in a short slot; 0: no title, all in the hover)
 * @returns {{text: string, full: (string|null)}}
 */
function fitTitle(lines, chars, most = TITLE_LINES) {
    if (most < 1) return { text: '', full: lines.join(' · ') };
    const out = [];
    let cut = false;
    const push = (line) => {
        if (out.length < most) { out.push(line); return; }
        cut = true;
        const last = out[most - 1];
        out[most - 1] = `${last.slice(0, Math.max(chars - 1, 1))}…`;
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
    if (cut && out.length === most && !out[most - 1].endsWith('…')) out[most - 1] = `${out[most - 1].slice(0, Math.max(chars - 1, 1))}…`;
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
    const plotPx = Math.max(((model.pixels && model.pixels.height) || DEFAULT_HEIGHT) - 20, 1);
    const reserve = MODEBAR_PX / plotPx;
    const total = 0.96 - reserve;
    const base = Math.min(LEGEND_SLOT_MAX, total / Math.max(items.length, 1));
    // a strip legend that lists more levels than its slot holds takes room from the colour bar and size legend (which draw
    // in a short slot) before it wraps into columns, so "Entries, at most" is not cut by the slot alone
    const slots = items.map(() => base);
    const cap = Math.max(1, (model.legendLayout && model.legendLayout.max) || Infinity);
    const wants = items.map((it) => {
        if (it.kind !== 'strip') return 0;
        const lines = Math.min(strips[it.index].legend.length, cap);
        return Math.min(total, (lines * LEGEND_LINE_PX + TITLE_LINES * LEGEND_LINE_PX + 4) / plotPx / LEGEND_SLOT_FILL);
    });
    const needy = items.map((it, i) => wants[i] > base);
    if (needy.some(Boolean)) {
        const floor = Math.min(base, LEGEND_SLOT_FLOOR);
        const others = items.filter((_, i) => !needy[i]).length;
        const fits = others * base + wants.reduce((a, w, i) => a + (needy[i] ? w : 0), 0) <= total;
        const otherSlot = fits ? base : floor;
        const left = total - others * otherSlot;
        const sumWant = wants.reduce((a, w, i) => a + (needy[i] ? w : 0), 0);
        items.forEach((_, i) => { slots[i] = needy[i] ? Math.max(base, fits ? wants[i] : (left * wants[i]) / sumWant) : otherSlot; });
    }
    let top = 1 - reserve;
    items.forEach((it, i) => {
        it.top = top;
        top -= slots[i];
        it.height = slots[i] * LEGEND_SLOT_FILL;
        it.chars = chars;
        it.x = x;
        it.px = it.height * plotPx;
    });
    return items;
}

const barOf = (stack, key) => stack.find((it) => it.kind === 'bar' && it.key === key);

/**
 * A color bar's title, as many lines as its slot holds above a bar of BAR_MIN_PX. Plotly takes a top title's height
 * from the bar's length; a title taller than the slot left it a negative length, and Plotly threw ("Something went
 * wrong with axis scaling") and drew nothing: the dots of a crowded legend column at a short plot (operator, 2026-11-23).
 */
function barTitle(entry, lines) {
    const fits = Math.floor((entry.px - 2 * BAR_PAD_PX - BAR_MIN_PX) / TITLE_LINE_PX);
    return fitTitle(lines, entry.chars, Math.max(0, Math.min(TITLE_LINES, fits)));
}

/** A Plotly color bar for one key, placed in its slot of the legend column. */
function colourBar(entry, lines, th) {
    const title = barTitle(entry, lines).text;
    return {
        ...(title ? { title: { text: title, side: 'top', font: { color: th.textColor } } } : {}),
        tickfont: { color: th.textColor },
        x: entry.x, xanchor: 'left', y: entry.top, yanchor: 'top', len: entry.height, lenmode: 'fraction', thickness: 12,
        ypad: BAR_PAD_PX, outlinewidth: 0
    };
}

/**
 * The size legend of one key: up to five reference dots from dot_min to dot_max, on a small subplot of its own; fewer
 * (at least two, the ends) when the slot is too short for each to have its line. The dots keep two lines of the slot;
 * the title takes the whole lines left above them (TITLE_LINE_PX each), so it never stands over the first dot's label.
 * Dots larger than two lines of the slot hold (the largest dot fills its cell) are drawn at 1:`scale`, said under the
 * title.
 */
function sizeLegendParts(model, k, entry, n, th) {
    const { smallest = SMALLEST_DOT, largest = LARGEST_DOT } = model.size;
    const axisId = n + 2;
    const plotPx = Math.max(((model.pixels && model.pixels.height) || DEFAULT_HEIGHT) - 20, 1);
    const slotPx = entry.height * plotPx;
    const sized = !!model.pixels;
    const most = sized ? Math.max(0, Math.min(TITLE_LINES, Math.floor((slotPx - 4 - 2 * REFERENCE_LINE_PX) / TITLE_LINE_PX))) : TITLE_LINES;
    const roomOf = (lines) => slotPx - (lines ? lines * TITLE_LINE_PX + 4 : 0);
    // the scale the dots are drawn at: 1 while two of the largest fit under the title, else the least whole 1:N that does
    const fitLargest = Math.max(roomOf(most) / 2, 1);
    const scale = sized && largest > fitLargest ? Math.ceil(largest / fitLargest) : 1;
    const noted = scale > 1 && most > 0;
    const fitted = fitTitle(k.lines, entry.chars, noted ? most - 1 : most);
    const titleLines = fitted.text ? fitted.text.split('<br>').length : 0;
    const lines = titleLines + (noted ? 1 : 0);
    const titleRoom = sized ? (slotPx - roomOf(lines)) / plotPx : titleRoomOf(model, entry, fitted);
    const drawn = { smallest: smallest / scale, largest: largest / scale };
    const linePx = Math.max(REFERENCE_LINE_PX, drawn.largest);
    const count = sized ? Math.max(2, Math.min(REFERENCE_DOTS, Math.floor(roomOf(lines) / linePx))) : REFERENCE_DOTS;
    const refs = Array.from({ length: count }, (_, j) => k.lo + ((k.hi - k.lo) * j) / (count - 1));
    const trace = {
        type: 'scatter', mode: 'markers+text', name: 'size legend', hoverinfo: 'skip', showlegend: false,
        xaxis: `x${axisId}`, yaxis: `y${axisId}`,
        x: refs.map(() => 0), y: refs.map((_, j) => j),
        text: refs.map((v) => (k.hi > k.lo ? fmtOf(model.size.stat)(v) : fmtOf(model.size.stat)(k.lo))), textposition: 'middle right', cliponaxis: false,
        marker: { size: refs.map((v) => diameterOf(v, k.lo, k.hi, drawn.smallest, drawn.largest)), color: th.axisColor, opacity: LEGEND_DOT_OPACITY * dotOpacityOf(model), line: model.outline ? { color: model.outline.color, width: model.outline.width } : { width: 0 } }
    };
    const axes = {
        [`xaxis${axisId}`]: { domain: [entry.x + 0.01, 1], range: [-0.6, 3], visible: false, fixedrange: true },
        [`yaxis${axisId}`]: { domain: [entry.top - entry.height, entry.top - titleRoom], range: [count - 0.5, -0.5], visible: false, fixedrange: true }
    };
    const title = {
        xref: 'paper', yref: 'paper', x: entry.x, y: entry.top, xanchor: 'left', yanchor: 'top', showarrow: false,
        align: 'left', text: fitted.text, font: { color: th.textColor }, ...(fitted.full ? { hovertext: esc(fitted.full), captureevents: true } : {})
    };
    // the scale the dots are drawn at, on the title's last line
    const note = noted ? {
        name: 'size legend scale', xref: 'paper', yref: 'paper', x: entry.x, y: entry.top - (titleLines * TITLE_LINE_PX) / plotPx,
        xanchor: 'left', yanchor: 'top', showarrow: false, align: 'left', text: esc(W.legendScaled(scale)), font: { color: th.textColor }
    } : null;
    return { trace, axes, title, note };
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
    // Plot Options' columns and cap (WP-5a, model.legendLayout): the levels fill the columns top to bottom, at most
    // `max` of them, and the last line says how many more there are
    const { columns: set = 1, max = Infinity } = model.legendLayout || {};
    const all = strip.legend;
    // what the cap allows that one column cannot hold wraps into more columns (as far as a label keeps a few characters),
    // so the levels the setting allows are drawn; only past that does the last line say how many more there are
    let columns = set;
    const wanted = Math.min(all.length, max);
    if (wanted > fit * columns) {
        const widest = Number.isFinite(entry.chars) ? Math.max(1, Math.floor(entry.chars / (LEGEND_MIN_LABEL_CHARS + 3))) : LEGEND_AUTO_COLUMNS;
        columns = Math.max(columns, Math.min(LEGEND_AUTO_COLUMNS, widest, Math.ceil(wanted / fit)));
    }
    const room = fit * columns;
    const keep = Math.min(all.length, max);
    const shown = keep === all.length && keep <= room ? all : all.slice(0, Math.min(keep, room - 1));
    const more = all.length - shown.length;
    const lines = shown.length + (more ? 1 : 0);
    const perColumn = Math.max(1, Math.ceil(lines / columns));
    const step = 6.6 / columns;
    const chars = Number.isFinite(entry.chars) && columns > 1 ? Math.max(3, Math.floor(entry.chars / columns) - 3) : Infinity;
    const cut = (label) => (label.length > chars ? `${label.slice(0, chars - 1)}…` : label);
    const cutAny = shown.some((e) => String(e.label).length > chars);
    const axisId = n + 2;
    const trace = {
        type: 'scatter', mode: 'markers+text', name: 'strip legend', hoverinfo: cutAny ? 'text' : 'skip',
        ...(cutAny ? { hovertext: [...shown.map((e) => esc(String(e.label))), ...(more ? [''] : [])] } : {}), showlegend: false,
        xaxis: `x${axisId}`, yaxis: `y${axisId}`,
        x: Array.from({ length: lines }, (_, j) => Math.floor(j / perColumn) * step), y: Array.from({ length: lines }, (_, j) => j % perColumn),
        text: [...shown.map((e) => esc(cut(String(e.label)))), ...(more ? [esc(W.options.more(more))] : [])], textposition: 'middle right', cliponaxis: false,
        marker: { symbol: 'square', size: 10, color: [...shown.map((e) => e.colour), ...(more ? ['rgba(0,0,0,0)'] : [])], line: { width: 0 } },
        textfont: { color: th.textColor }
    };
    const top = entry.top - titleRoom;
    const axes = {
        [`xaxis${axisId}`]: { domain: [entry.x + 0.01, 1], range: [-0.6, 6], visible: false, fixedrange: true },
        [`yaxis${axisId}`]: { domain: [entry.top - entry.height, top], range: [Math.max(perColumn, fit) - 0.5, -0.5], visible: false, fixedrange: true }
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
function axisOf(ticks, labels, extent, th, extra, pad = 0) {
    return {
        tickvals: ticks, ticktext: labels, range: [-0.5 - pad, Math.max(extent, 1) - 0.5 + pad], zeroline: false, automargin: true,
        gridcolor: th.gridColor, linecolor: th.axisColor, tickcolor: th.axisColor, ...extra
    };
}

/** How far, in cells, the largest dot reaches past its cell on each side: 0 up to a full cell. */
function overflowOf(model) {
    const size = model.mode === 'dots' && model.size && !model.size.none ? model.size : null;
    return size && size.scale > 1 ? (Math.min(MAX_DOT_SCALE, size.scale) - 1) / 2 : 0;
}

function layoutAxes(model, P, th, right) {
    const groupTicks = model.groups.map((_, g) => g);
    const groupLabels = model.groups.map((g) => esc(g.label));
    const rowLabels = model.rows.map((r) => (r.own ? `<i>${esc(r.label)}</i>` : esc(r.label)));
    // no grid lines, in dots and in a heatmap (operator, 2026-11-23); dots larger than their cell (Largest dot over 100 %)
    // get room at the matrix's edges, so the plot area does not cut the outer ones (half the overflow, in cells)
    const pad = overflowOf(model);
    const group = axisOf(groupTicks, groupLabels, P.G, th, { showgrid: false }, pad);
    const gene = axisOf(P.pos, rowLabels, P.span, th, { showgrid: false }, pad);
    // few columns of dots (two one-row sections) are not stretched across the whole plot: a column is at most MAX_DOT_COLUMN_PX
    // wide, and the matrix keeps its place, with the room that is left empty at its far end
    if (model.mode === 'dots' && model.pixels && model.pixels.width > 0) {
        const along = matrixPixels(model, { right, fontPx: th.fontSize || 12, margin: MARGIN });
        const cells = gene.range[1] - gene.range[0];
        if (along / cells > MAX_DOT_COLUMN_PX) gene.range = [gene.range[0], gene.range[0] + along / MAX_DOT_COLUMN_PX];
    }
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
        // Dot opacity, opaque by default: Plotly draws a marker with sizes per point at 0.7 unless told
        const marker = { size: sizes, color: colours, colorscale: color.colorscale, cmin: k.lo, cmax: k.hi, showscale: Boolean(entry), opacity: dotOpacityOf(model) };
        if (color.reversescale) marker.reversescale = true;
        if (model.outline) marker.line = { color: model.outline.color, width: model.outline.width };
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
        if (color.reversescale) trace.reversescale = true;
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

// --- 3D (UX 6b, WP-12) ------------------------------------------------------------------------------------------

/** The camera of a new 3D view (UX 6b). */
export const DEFAULT_CAMERA = Object.freeze({
    eye: Object.freeze({ x: 1.6, y: -1.6, z: 1.1 }), center: Object.freeze({ x: 0, y: 0, z: 0 }), up: Object.freeze({ x: 0, y: 0, z: 1 })
});
/** Above this many categories on an axis its labels are hidden; the hover names each bar (UX 6b). */
const LABELS_3D_MAX = 60;
/** x:y of the scene follows the bar counts, clamped to 1:4..4:1; z is this share of the longer side. */
const ASPECT_CLAMP = 4;
const ASPECT_Z = 0.6;
const UIREVISION_3D = 'cgene-3d';

/** The scene's aspect ratio for `xCount` bars along x and `yCount` along y (the Count Plot's 3D shares it). */
export function sceneAspect(xCount, yCount) {
    const ratio = Math.min(ASPECT_CLAMP, Math.max(1 / ASPECT_CLAMP, Math.max(xCount, 1) / Math.max(yCount, 1)));
    return ratio >= 1 ? { x: 1, y: 1 / ratio, z: ASPECT_Z } : { x: ratio, y: 1, z: ASPECT_Z };
}

/**
 * The gap, px, between a label and its tick on the box edge, on the label's side (Plot Options ▸ Axes ▸ Padding, in 3D).
 * Plotly drops a scene annotation outside the axis ranges, so the anchor is ON the edge and the gap is a screen shift.
 */
const LABEL_GAP_PX = 4;
const PADDING_MAX = 40;
/** A z tick this close to the floor (a share of the z span) is not labelled: the floor corner is where the labels start. */
const Z_FLOOR_SKIP = 0.08;
const Z_TICKS = 5;
/** A capital letter's width in em (Arial's widest are about 0.72): the label band's width for the title's place. */
const LABEL_EM_MAX = 0.7;

/**
 * A scene axis of categories: grid lines at the bar centres, thinned, over a box that is exactly the cells. Plotly
 * centres a 3D tick label on its tick and has no anchor for it, and sets the axis title where its own labels end, so
 * both are hidden here and sceneLabels draws them.
 */
export function sceneAxis(labels, positions, extent, th) {
    const base = {
        title: { text: '' }, color: th.textColor, gridcolor: th.gridColor, linecolor: th.axisColor, showticklabels: false,
        zeroline: false, showspikes: false, backgroundcolor: th.bgColor, range: [-0.5, Math.max(extent, 1) - 0.5], autorange: false
    };
    if (labels.length > LABELS_3D_MAX) return base;
    const ticks = axisTicks(labels, LABELS_3D_MAX);
    return { ...base, tickmode: 'array', tickvals: ticks.tickvals.map((k) => positions[k]), ticktext: ticks.ticktext };
}

/** About `count` round values from lo to hi (1, 2 or 5 times a power of ten apart), as an axis would tick them. */
function niceTicks(lo, hi, count) {
    if (!(hi > lo)) return [lo];
    const raw = (hi - lo) / Math.max(count, 1);
    const p = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((m) => m * p).find((v) => v >= raw) || 10 * p;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
    return out;
}

const minus = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const unit = (a) => { const n = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / n, y: a.y / n, z: a.z / n }; };
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/** The camera looked through: the default one when looking straight down or up, where the camera sets no screen right. */
function lookOf(camera) {
    const c0 = camera.center || DEFAULT_CAMERA.center;
    return Math.hypot(camera.eye.x - c0.x, camera.eye.y - c0.y) < 1e-6 ? DEFAULT_CAMERA : camera;
}

/** The screen's right and up in the scene (orthographic): forward x up, and right x forward. */
function screenAxes(camera) {
    const look = lookOf(camera);
    const forward = minus(look.center || DEFAULT_CAMERA.center, look.eye);
    const right = unit(cross(forward, look.up || DEFAULT_CAMERA.up));
    return { right, up: unit(cross(right, forward)) };
}

/** The screen's right in the scene: forward x up, in the frame Plotly's camera is given in. */
function screenRight(camera) {
    return cross(minus(camera.center || DEFAULT_CAMERA.center, camera.eye), camera.up || DEFAULT_CAMERA.up);
}

/** The anchors Justify may set (Plot Options ▸ Axes, in 3D); Auto is none of them. */
const JUSTIFY = Object.freeze(['left', 'right', 'center']);

/**
 * Where each category axis's labels go for a camera (operator: a label is never centred on its tick). Each axis's labels
 * run along the box edge nearer the camera, and the side of the screen that edge's middle falls on sets the anchor: on
 * the right a label starts at its tick (`left`), on the left it ends there (`right`), so it always runs outward, away
 * from the bars. One anchor per axis, so an axis never mixes them. Screen right is forward x up, in the scene's
 * normalised box (the aspect ratio, centred on 0), the frame Plotly's camera is given in. Side Fixed keeps the stored
 * edges; Justify Left, Right or Center sets the anchor.
 * @returns {{x: {edge: 'min'|'max', xanchor: string}, y: {edge: 'min'|'max', xanchor: string}}}
 */
function sceneLabelSides({ camera, aspect, options = {} }) {
    const look = lookOf(camera);
    const eye = look.eye;
    const center = look.center || DEFAULT_CAMERA.center;
    const right = screenRight(look);
    const side = (p) => (p.x * right.x + p.y * right.y > 0 ? 'left' : 'right');
    const fixed = options.side === 'fixed' && options.edges ? options.edges : null;
    const yEdge = fixed ? fixed.x : eye.y < center.y ? 'min' : 'max';
    const xEdge = fixed ? fixed.y : eye.x < center.x ? 'min' : 'max';
    const half = (edge, len) => (edge === 'min' ? -len / 2 : len / 2);
    const justify = JUSTIFY.includes(options.justify) ? options.justify : null;
    const anchor = (p) => justify || side(p);
    return {
        x: { edge: yEdge, xanchor: anchor({ x: 0, y: half(yEdge, aspect.y) }) },
        y: { edge: xEdge, xanchor: anchor({ x: half(xEdge, aspect.x), y: 0 }) }
    };
}

/**
 * The edges the labels are on for a camera (Auto's choice), as Side Fixed stores them: `{x, y}`, each 'min' or 'max', the
 * edge across the box from that axis's labels.
 */
export function labelEdges(camera, aspect) {
    const sides = sceneLabelSides({ camera, aspect });
    return { x: sides.x.edge, y: sides.y.edge };
}

/**
 * The angle (Plotly's textangle: degrees, clockwise) of the edge an axis's labels stand on, as drawn: Rotation ▸ Along
 * the axis. The edge's two ends are projected as Plotly's camera does, in perspective, in the scene's box (each axis
 * from -aspect/2 to aspect/2, the floor at the bottom), and the angle turned to read left to right (-90 to 90).
 * @param {'x'|'y'} dim
 * @param {'min'|'max'} edge - the edge across the box the labels stand on
 */
function axisAngle(dim, edge, aspect, camera) {
    return edgeOnScreen(dim, edge, aspect, camera).angle;
}

/**
 * The edge's angle on screen (as axisAngle) and which way is out of the box there: `outward` is the screen direction
 * (x right, y down) from the edge's middle away from the box's centre line.
 */
function edgeOnScreen(dim, edge, aspect, camera) {
    const look = lookOf(camera);
    const eye = look.eye;
    const forward = unit(minus(look.center || DEFAULT_CAMERA.center, eye));
    const right = unit(cross(forward, look.up || DEFAULT_CAMERA.up));
    const up = cross(right, forward);
    const across = edge === 'min' ? -0.5 : 0.5;
    const at = (t) => (dim === 'x' ? { x: t * aspect.x, y: across * aspect.y, z: -0.5 * aspect.z }
        : { x: across * aspect.x, y: t * aspect.y, z: -0.5 * aspect.z });
    const screen = (p) => { const v = minus(p, eye); const depth = dot(v, forward) || 1e-9; return { x: dot(v, right) / depth, y: dot(v, up) / depth }; };
    const a = screen(at(-0.5));
    const b = screen(at(0.5));
    let deg = Math.atan2(-(b.y - a.y), b.x - a.x) * 180 / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg <= -90) deg += 180;
    // out of the box: from the middle of the opposite edge to the middle of this one, on screen (y down)
    const mid = screen(at(0));
    const opposite = screen(dim === 'x' ? { x: 0, y: -across * aspect.y, z: -0.5 * aspect.z } : { x: -across * aspect.x, y: 0, z: -0.5 * aspect.z });
    return { angle: Math.round(deg * 10) / 10, outward: { x: mid.x - opposite.x, y: -(mid.y - opposite.y) } };
}

/**
 * Rotation ▸ Across the axis: perpendicular to the edge on screen, each name running straight out of the box from its
 * tick, so names along a dense edge stand side by side instead of end to end. The anchor follows: a name whose text
 * runs outward starts at its tick (left), else it ends there (right).
 */
function acrossAxis(dim, edge, aspect, camera) {
    const { angle, outward } = edgeOnScreen(dim, edge, aspect, camera);
    let deg = angle + 90;
    if (deg > 90) deg -= 180;
    const t = deg * Math.PI / 180;
    // the text's direction on screen (y down) at Plotly's clockwise angle
    const runsOut = Math.cos(t) * outward.x + Math.sin(t) * outward.y > 0;
    return { angle: Math.round(deg * 10) / 10, xanchor: runsOut ? 'left' : 'right' };
}

/**
 * Where a label stands on its tick for an anchor and an angle. Plotly anchors the rotated label's bounding box, so a
 * tilted label is anchored at the corner where its text starts (left) or ends (right): its start, or end, is at the tick.
 */
function anchored(xanchor, angle, pad) {
    const yanchor = !angle || xanchor === 'center' ? 'middle' : (angle > 0) === (xanchor === 'left') ? 'top' : 'bottom';
    return { xanchor, yanchor, xshift: xanchor === 'left' ? pad : xanchor === 'right' ? -pad : 0 };
}

/**
 * The 3D labels' options as the drawing reads them, in one place: the shared Plot Options' Axes fields (WP-5a;
 * cell-gene/options.js PLOT_OPTION_FIELDS): `labels3d` (side, edges, justify, rotation and angle, padding), and the gene and
 * group label switches (`annotations.labels`). `rotation` comes back as 'horizontal', 'along', 'across' or the angle.
 * @param {Object} model - the drawing model
 * @returns {{side?: string, edges?: Object, justify?: string, rotation: ('horizontal'|'along'|number), padding: number,
 *   show: {genes: boolean, groups: boolean}}}
 */
// export-unused-ok: the 3D labels' options in one place, for the Node tests and any later reader of the schema's fields
export function labelOptions3d(model) {
    const l3 = (model && model.labels3d) || {};
    const shown = (model && model.annotations && model.annotations.labels) || {};
    // Rotation ▸ Angle is its angle (a number); the others by name
    const angle = typeof l3.angle === 'number' && Number.isFinite(l3.angle) ? Math.max(-90, Math.min(90, l3.angle)) : 0;
    const rotation = l3.rotation === 'along' || l3.rotation === 'across' ? l3.rotation
        : l3.rotation === 'angle' ? angle : typeof l3.rotation === 'number' && Number.isFinite(l3.rotation) ? l3.rotation : 'horizontal';
    const padding = typeof l3.padding === 'number' && Number.isFinite(l3.padding) ? Math.max(0, Math.min(PADDING_MAX, l3.padding)) : LABEL_GAP_PX;
    return { ...l3, rotation, padding, show: { genes: shown.genes !== false, groups: shown.groups !== false } };
}

/**
 * The labels as scene annotations for a camera (figure3d's `labels3d`, again for each camera the user turns to):
 * - each category label at its tick on the near edge of the box, on the floor, anchored by sceneLabelSides and Padding
 *   px off it, at the Rotation's angle (Horizontal, Along the axis, or an angle);
 * - each axis's title at the middle of that edge, moved on screen along the edge's outward normal past the label band
 *   (labels estimated at CHAR_EM per character; with the labels hidden, by the padding alone);
 * - the height's labels and title on the vertical edge at the left of the screen, ending at the edge; the tick at the
 *   floor is not labelled, since the floor corner is where the category labels start (operator: the 0 collided).
 * An axis whose labels are hidden (Plot Options ▸ Labels) has neither labels nor title.
 * @param {{x: {labels, positions, extent, title, show?}, y: {...}, aspect, z: number, zTicks?: number[], zRange?: number[],
 *   zTitle?: string, font: Object, options?: Object}} spec - `options` is labelOptions3d's
 * @param {{eye, center?, up?}} camera
 * @returns {Object[]}
 */
export function sceneLabels(spec, camera) {
    const opts = spec.options || {};
    const pad = typeof opts.padding === 'number' ? opts.padding : LABEL_GAP_PX;
    const sides = sceneLabelSides({ camera, aspect: spec.aspect, options: opts });
    const out = [];
    const edgeAt = (edge, extent) => (edge === 'min' ? -0.5 : Math.max(extent, 1) - 0.5);
    const fontPx = (spec.font && spec.font.size) || 12;
    const lineH = fontPx * 1.3;
    for (const dim of ['x', 'y']) {
        const axis = spec[dim];
        if (axis.show === false) continue;
        const other = spec[dim === 'x' ? 'y' : 'x'];
        const across = edgeAt(sides[dim].edge, other.extent);
        const shown = axis.labels.length <= LABELS_3D_MAX;
        const perpendicular = opts.rotation === 'across' ? acrossAxis(dim, sides[dim].edge, spec.aspect, camera) : null;
        const angle = perpendicular ? perpendicular.angle : opts.rotation === 'along' ? axisAngle(dim, sides[dim].edge, spec.aspect, camera)
            : typeof opts.rotation === 'number' ? opts.rotation : 0;
        // Across picks the end that runs out of the box, unless Justify sets the anchor
        const xanchor = perpendicular && !JUSTIFY.includes(opts.justify) ? perpendicular.xanchor : sides[dim].xanchor;
        if (axis.title) {
            // square to the edge as drawn (in perspective; x right, y down), on the side out of the box: the label band is
            // a strip along the edge, so this is the shortest way past it
            const edgeShape = edgeOnScreen(dim, sides[dim].edge, spec.aspect, camera);
            const e = edgeShape.angle * Math.PI / 180;
            let ux = -Math.sin(e);
            let uy = Math.cos(e);
            if (ux * edgeShape.outward.x + uy * edgeShape.outward.y < 0) { ux = -ux; uy = -uy; }
            // the label band's depth along that direction: a label is a w x lineH box turned by its angle, its widths
            // at a capital's em (names are often capitals, which CHAR_EM's average under-reads)
            const longest = shown ? axis.labels.reduce((m, l) => (String(l).length > m ? String(l).length : m), 0) : 0;
            const w = longest * LABEL_EM_MAX * fontPx;
            const t = angle * Math.PI / 180;
            const band = shown ? pad + Math.abs(w * (Math.cos(t) * ux + Math.sin(t) * uy)) + Math.abs(lineH * (-Math.sin(t) * ux + Math.cos(t) * uy)) : 0;
            const titleW = String(axis.title).length * CHAR_EM * (fontPx + 1);
            const push = band + pad + (titleW / 2) * Math.abs(ux) + (lineH / 2) * Math.abs(uy) + (angle ? lineH / 2 : 0);
            const mid = (Math.max(axis.extent, 1) - 1) / 2;
            out.push({ name: `${dim} title`, x: dim === 'x' ? mid : across, y: dim === 'x' ? across : mid, z: spec.z, text: axis.title,
                showarrow: false, xanchor: 'center', yanchor: 'middle', font: { ...spec.font, size: fontPx + 1 },
                // Plotly's yshift is up
                xshift: Math.round(ux * push), yshift: Math.round(-uy * push), textangle: 0 });
        }
        if (!shown) continue;
        const ticks = axisTicks(axis.labels, LABELS_3D_MAX);
        const place = anchored(xanchor, angle, pad);
        ticks.tickvals.forEach((k, n) => {
            const at = axis.positions[k];
            out.push({ name: `${dim} label`, x: dim === 'x' ? at : across, y: dim === 'x' ? across : at, z: spec.z,
                text: esc(ticks.ticktext[n]), showarrow: false, font: spec.font, textangle: angle, yshift: 0, ...place });
        });
    }
    if (spec.zTicks && spec.zTicks.length) out.push(...zLabels(spec, camera, pad, fontPx, lineH));
    return out;
}

/** The height's tick labels and title on the floor corner furthest left on screen, ending at its vertical edge. */
function zLabels(spec, camera, pad, fontPx, lineH) {
    const { right } = screenAxes(camera);
    const X = Math.max(spec.x.extent, 1) - 0.5;
    const Y = Math.max(spec.y.extent, 1) - 0.5;
    const xMid = (X - 0.5) / 2;
    const yMid = (Y - 0.5) / 2;
    const corners = [[-0.5, -0.5], [X, -0.5], [-0.5, Y], [X, Y]];
    const screenX = ([x, y]) => ((x - xMid) / (X + 0.5)) * spec.aspect.x * right.x + ((y - yMid) / (Y + 0.5)) * spec.aspect.y * right.y;
    const [cx, cy] = corners.reduce((a, b) => (screenX(b) < screenX(a) ? b : a));
    const [lo, hi] = spec.zRange;
    const out = [];
    const labelled = spec.zTicks.filter((v) => v - lo > Z_FLOOR_SKIP * (hi - lo));
    let widest = 0;
    for (const v of labelled) {
        const text = fmt(v);
        widest = Math.max(widest, text.length);
        out.push({ name: 'z label', x: cx, y: cy, z: v, text, showarrow: false, font: spec.font, xanchor: 'right', yanchor: 'middle',
            xshift: -pad, yshift: 0, textangle: 0 });
    }
    if (spec.zTitle) {
        out.push({ name: 'z title', x: cx, y: cy, z: (lo + hi) / 2, text: spec.zTitle, showarrow: false, font: { ...spec.font, size: fontPx + 1 },
            xanchor: 'center', yanchor: 'middle', textangle: -90,
            xshift: -Math.round(pad + widest * CHAR_EM * fontPx + pad + lineH / 2), yshift: 0 });
    }
    return out;
}

/**
 * The 3D figure (UX 6b): one `mesh3d` of bars (utils/bars-3d.js), genes along x and groups along y (swapped with Swap
 * axes), the height up. Colour, height and, in dots, Size (the footprint's area, footprintFromSize) are all shown. A
 * missing value is not drawn, nor is a bar of height 0; a row being read (CXG-18) has no bar yet. Under a scaling every
 * row shares one colour range; unscaled, a one-row section with a quantity of its own is coloured by where it lies on
 * its own bar, as the clustering reads it, and its hover gives its own value. Dendrograms, strips, brackets, totals,
 * printed values and the size legend are not drawn (the panel's strip says so); the order still applies.
 */
function figure3d(model, th) {
    const dots = model.mode === 'dots';
    const P = prepare(dots ? model : { ...model, size: { none: true } });
    const { groups, rows, color, size, swap } = model;
    const G = P.G;
    const R = rows.length;
    const height = model.height || { same: true, values: color.values };
    const main = P.colour.find((k) => k.key === MAIN) || P.colour[0];
    const rangeOf = new Map();
    for (const k of P.colour) for (const r of k.rows) rangeOf.set(r, k);
    const sizeKey = dots && P.size.length ? new Map(P.size.map((k) => [k.key, k])) : null;

    const n = R * G;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const heights = new Float64Array(n);
    const values = new Float64Array(n);
    const footprint = sizeKey ? new Float64Array(n) : null;
    const hover = new Array(n);
    const describe = describer(model, P, dots);
    const heightLine = height.same ? W.view3d.heightAsColor : `${W.view3d.height} · ${esc(statisticTitle(height))}`;
    for (let r = 0; r < R; r++) {
        const bar = rangeOf.get(r) || main;
        const sk = sizeKey ? sizeKey.get(sizeKeyOf(model, rows[r])) : null;
        for (let g = 0; g < G; g++) {
            const i = r * G + g;
            xs[i] = swap ? g : P.pos[r];
            ys[i] = swap ? P.pos[r] : g;
            const h = height.values[i];
            heights[i] = rows[r].pending ? NaN : limited(h, height);
            const v = color.values[i];
            // a section on its own bar: its place on that bar, on the main bar's range (one mesh, one colour scale)
            values[i] = bar === main || !(bar.hi > bar.lo) ? v : main.lo + ((v - bar.lo) / (bar.hi - bar.lo)) * (main.hi - main.lo);
            if (footprint) footprint[i] = sk ? footprintFromSize(size.values[i], sk.hi) : 1;
            if (Number.isFinite(h) && Number.isFinite(v)) {
                const [groupLine, rowLine, ...rest] = describe(r, g, i).split('<br>');
                const ownHeight = height.same ? heightLine : `${heightLine}: ${fmt(h)}`;
                hover[i] = [rowLine, groupLine, ...rest, ownHeight].join('<br>');
            }
        }
    }
    // the names as they are: gl3d draws tick text literally, so an escaped '<' would show as '&lt;'; sceneLabels escapes
    // them for the annotations, which Plotly reads as markup (and decodes)
    const geneLabels = rows.map((row) => String(row.label));
    const groupLabels = groups.map((grp) => String(grp.label));
    const legendOn = !model.legend || model.legend.colorBar !== false;
    // the Cell Plot's colour bar (plot-utilities/colour-bar.js): its title runs along the bar, in the plot's font
    const colorbar = legendOn ? { ...colourBarOf({ textColor: th.textColor, fontSize: th.fontSize, fontFamily: th.fontFamily, colorbarLength: 0.7 },
        main.lines.map(esc).join(' · ')), thickness: 12, outlinewidth: 0 } : null;
    const built = bars3d({
        xs, ys, heights, footprint, hover,
        colour: { kind: 'continuous', values, colorscale: color.colorscale, cmin: main.lo, cmax: main.hi, ...(colorbar ? { colorbar } : {}) }
    });
    const trace = built.trace;
    if (color.reversescale) trace.reversescale = true;
    trace.name = 'bars';

    // x:y by the bar counts (clamped), z a share of the longer side
    const xCount = swap ? G : P.span;
    const yCount = swap ? P.span : G;
    const aspect = sceneAspect(xCount, yCount);
    const genePositions = rows.map((_, r) => P.pos[r]);
    const groupPositions = groups.map((_, g) => g);
    const geneAxis = sceneAxis(geneLabels, genePositions, P.span, th);
    const groupAxis = sceneAxis(groupLabels, groupPositions, G, th);
    const labelOpts = labelOptions3d(model);
    const geneSpec = { labels: geneLabels, positions: genePositions, extent: P.span, title: esc(W.view3d.genes), show: labelOpts.show.genes };
    const groupSpec = { labels: groupLabels, positions: groupPositions, extent: G, title: esc(W.view3d.groups), show: labelOpts.show.groups };
    // the height's axis: a range over the bars from the floor (0, or below it), round ticks, labelled by sceneLabels
    const zLo = Math.min(0, built.zRange[0]);
    const zTop = Math.max(0, built.zRange[1]);
    const zHi = zTop > zLo ? zTop + 0.02 * (zTop - zLo) : zLo + 1;
    const zTicks = niceTicks(zLo, zHi, Z_TICKS);
    const zTitle = model.zTitle || (height.same ? main.lines.join(' · ') : statisticTitle(height));
    const labels3d = { x: swap ? groupSpec : geneSpec, y: swap ? geneSpec : groupSpec, aspect, z: zLo, zTicks, zRange: [zLo, zHi], zTitle: esc(zTitle),
        options: labelOpts,
        font: { color: th.textColor, size: th.fontSize || 12, family: th.fontFamily || DEFAULT_FONT } };
    const camera = model.camera ? JSON.parse(JSON.stringify(model.camera)) : JSON.parse(JSON.stringify(DEFAULT_CAMERA));
    const layout = {
        paper_bgcolor: th.bgColor, plot_bgcolor: th.bgColor, showlegend: false, hovermode: 'closest', uirevision: UIREVISION_3D,
        font: { family: th.fontFamily || DEFAULT_FONT, size: th.fontSize || 12, color: th.textColor },
        margin: { l: 0, r: 0, t: model.plotTitle ? 40 : 10, b: 0 }, annotations: [],
        scene: {
            xaxis: swap ? groupAxis : geneAxis,
            yaxis: swap ? geneAxis : groupAxis,
            // Plotly's own z labels and title stand where they collide with the category labels at the floor corner, so
            // sceneLabels draws them (zLabels); the grid stays at the same ticks
            zaxis: { title: { text: '' }, showticklabels: false, tickmode: 'array', tickvals: zTicks, range: [zLo, zHi], autorange: false,
                color: th.textColor, gridcolor: th.gridColor, linecolor: th.axisColor, zerolinecolor: th.axisColor, showspikes: false,
                backgroundcolor: th.bgColor },
            aspectmode: 'manual', aspectratio: aspect,
            camera, annotations: sceneLabels(labels3d, camera),
            bgcolor: th.bgColor
        }
    };
    if (model.plotTitle) layout.title = { text: esc(model.plotTitle), font: { color: th.textColor } };
    const config = { responsive: true, displaylogo: false,
        modeBarButtonsToRemove: [...MODEBAR_REMOVE, 'resetCameraDefault3d', 'resetCameraLastSave3d'] };
    return { data: [trace], layout, config, hidden: [], bars: built.drawn, labels3d };
}

// --- the figure -------------------------------------------------------------------------------------------------

/**
 * @param {object} model - see the top of this file
 * @param {{bgColor: string, gridColor: string, axisColor: string, textColor: string, fontFamily?: string, fontSize?: number}}
 *   [theme] - the plot's resolved colors (plot-theme.js: PLOT_PALETTES or plotColour of the panel's settings); light by default
 * @returns {{data: object[], layout: object, config: object, hidden: string[]}} `hidden`: what a narrow width gave up
 *   so each column of the matrix keeps MIN_COLUMN_PX ('totals', 'dendrogram', 'legend'; fitMatrix). With `view: '3d'`
 *   the figure is figure3d's (one mesh3d in a scene), with `bars` the bars drawn
 */
// export-unused-ok: X3a draws the panel with it
export function buildFigure(given, theme) {
    if (given.mode !== 'dots' && given.mode !== 'heatmap') throw new Error(`unknown mode ${given.mode}`);
    const dots = given.mode === 'dots';
    if (dots && !given.size) throw new Error('dots need a size or a No size sentence');
    const th = { ...PLOT_PALETTES.light, ...theme };
    if (given.view === '3d') return figure3d(given, th);
    const P = prepare(dots ? given : { ...given, size: { none: true } });
    const fitted = fitMatrix(given, P, dots, th);
    const { hidden, keepMin } = fitted;
    const stack = legendStack(fitted.model, P, dots, th, keepMin);
    const right = stack.length ? stack[0].x - (LEGEND_X - PLOT_RIGHT) : 1;
    const model = dots && !fitted.model.size.none
        ? { ...fitted.model, size: { ...fitted.model.size, ...dotRange(fitted.model, P, th, right) } } : fitted.model;

    const data = dots ? dotTraces(model, P, stack, th) : heatmapTraces(model, P, stack, th);
    const layout = {
        paper_bgcolor: th.bgColor, plot_bgcolor: th.bgColor, showlegend: false, hovermode: 'closest',
        font: { family: th.fontFamily || DEFAULT_FONT, size: th.fontSize || 12, color: th.textColor },
        margin: { ...MARGIN }, annotations: [],
        ...layoutAxes(model, P, th, right)
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
            if (parts.note) layout.annotations.push(parts.note);
        } else if (entry.kind === 'bar') {
            const fitted = barTitle(entry, P.colour.find((k) => k.key === entry.key).lines);
            if (fitted.full) layout.annotations.push(titleHover(fitted, entry.x, entry.top, th));
        } else if (entry.kind === 'none') {
            layout.annotations.push({
                xref: 'paper', yref: 'paper', x: entry.x, y: entry.top, xanchor: 'left', yanchor: 'top', showarrow: false,
                align: 'left', width: Number.isFinite(entry.chars) ? Math.max(60, Math.round(entry.chars * CHAR_EM * (th.fontSize || 12))) : 170, text: model.size.none, font: { color: th.textColor }
            });
        }
    }
    const config = { responsive: true, displaylogo: false, modeBarButtonsToRemove: [...MODEBAR_REMOVE] };
    const figure = annotateFigure({ data, layout, config }, model, th);
    // what a narrow width gave up for the matrix, for the panel's strip
    figure.hidden = hidden;
    return figure;
}
