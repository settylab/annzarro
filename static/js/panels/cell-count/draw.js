/**
 * What a count plot draws (CNT-15, CNT-18 to CNT-20, CNT-23): the Plotly figure of a count table for a bar, a
 * histogram, a 2D histogram, a heatmap and a pie, and the CSV of the plotted table.
 *
 * The figure is a pure function of the stored config, the table of one reply (`countTable`) and the panel's options,
 * so Node tests cover every mode. It is made once per reply or option change and costs the table's rows; nothing here
 * runs on a paint, a hover or a progress frame, and the table is never changed. Only the bundled traces are used
 * (bar, heatmap, pie, scatter for the legend of a rectangle's most frequent level).
 *
 * Words, sizes of the interface and colors are the caller's: the panel passes `words` (interface text from
 * `utils/vocabulary.js`), `labels` (the level labels it shows, renames applied), `inputNames`, a `palette` and the
 * plot theme's colors. A level's label is never made here.
 */
import {
    arrangementShown, axisOrder, binSpacingOf, heightValues, shareValues, measureValues, levelLabelsOf, levelsAt, tableRows, tableCsv
} from '../../utils/count-plot-model.js';
import { defaultLabelMaps } from '../../utils/cell-grouping.js';
import { parseLevelId, RESERVED } from '../../utils/level-id.js';
import { asHex, factorColours, tableLevelColour, plotPaletteOf } from '../../utils/grouping-colours.js';
import { scaleKeys } from './colour.js';

/** The modes this module draws; the others (density, Venn, UpSet) have their own drawing. */
// export-unused-ok: C2a offers the count modes that draw here
export const DRAWN_MODES = Object.freeze(['bar', 'histogram', 'hist2d', 'heatmap', 'pie']);

/** How many steps of fade a rectangle's share of its most frequent level is drawn in (CNT-18). */
const FADE_STEPS = 4;
const FADE_FROM = 0.3;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (v) => (Number.isInteger(v) ? v.toLocaleString('en-US') : String(Number(v.toPrecision(4))));
const pct = (f) => `${Number((f * 100).toPrecision(3))}%`;
const axisOf = (table, input) => table.axes.findIndex((a) => a.input === input);

// --- what is drawn: the value and its words --------------------------------------------------------------------------

/** The kind of value a height or a color shows and the base of its share. */
function valueOf(config) {
    const v = config.value || { kind: 'count' };
    return { kind: v.kind, base: v.of || 'all' };
}

/**
 * The numbers a bar's height or a rectangle's color shows, with the axis title and the format that go with them.
 * @returns {{kind: string, values: ArrayLike<number>|null, title: string, show: (v: number) => string, percent: boolean}}
 */
function valueSpec(config, table, opts) {
    const { kind, base } = valueOf(config);
    const { words, inputNames } = opts;
    if (kind === 'share') return { kind, values: heightValues(config, table), title: words.share(base, inputNames), show: pct, percent: true };
    if (kind === 'measure') {
        const values = heightValues(config, table);
        if (!values) throw new Error('A measure height needs the grid\'s measure block and the config\'s measure.');
        return { kind, values, title: words.measure(config.measure.stat, opts.measureSource, config.measure.above), show: num, percent: false };
    }
    if (kind === 'top_level') return { kind, values: null, title: words.topLevel(inputNames.factor), show: num, percent: false };
    return { kind: 'count', values: heightValues(config, table), title: words.count, show: num, percent: false };
}

/**
 * Whether a tile without cells is a real 0 of the colour's statistic (a count, a share, a sum) and so is drawn in the
 * scale's 0 colour; the others (mean, SD, % above, z-score) are undefined with no cells and the tile stays empty.
 */
function zeroIsValue(config, spec) {
    return spec.kind === 'count' || spec.kind === 'share' || (spec.kind === 'measure' && config.measure.stat === 'sum');
}

/** The hover line of a zero tile whose statistic the table has no number for: "Share: 0%", "sum of score: 0". */
function zeroLine(config, spec, opts) {
    return `${spec.kind === 'share' ? opts.words.hoverShare : spec.title}: ${spec.show(0)}`;
}

/** The numbers a printed label shows (CNT-19), chosen apart from height and color; null for none. */
function labelSpec(config, table, opts) {
    const kind = opts.options.labels;
    if (!kind || kind === 'none') return null;
    if (kind === 'count') return { values: table.count, show: num };
    if (kind === 'share') return { values: shareValues(table, valueOf(config).kind === 'share' ? valueOf(config).base : 'all'), show: pct };
    if (kind === 'measure') {
        const values = config.measure ? measureValues(table, config.measure.stat) : null;
        return values ? { values, show: num } : null;
    }
    throw new Error(`Unknown label kind: ${kind}`);
}

const textOf = (spec, r) => (spec && Number.isFinite(spec.values[r]) ? spec.show(spec.values[r]) : '');

/** The hover of row `r` (CNT-21): the levels, the count, the share and, when there is one, the measure. */
function hoverOf(config, table, opts, r, labelAt) {
    const { words } = opts;
    const share = shareValues(table, valueOf(config).kind === 'share' ? valueOf(config).base : 'all');
    const lines = [levelsAt(table, r).map(labelAt).map(esc).join(' × '), `${esc(words.hoverCount)}: ${num(table.count[r])}`];
    if (Number.isFinite(share[r])) lines.push(`${esc(words.hoverShare)}: ${pct(share[r])}`);
    const measure = config.measure ? measureValues(table, config.measure.stat) : null;
    if (measure && Number.isFinite(measure[r])) {
        lines.push(`${esc(words.measure(config.measure.stat, opts.measureSource, config.measure.above))}: ${num(measure[r])}`);
    }
    return lines.join('<br>');
}

// --- levels, positions and colors ------------------------------------------------------------------------------------

/** One Map per axis: level id to the label shown. */
const labelMapsOf = (config, table, opts) => opts.labels || levelLabelsOf(config, table, opts.titleOf);

/** The label of a level of axis `a`: the caller's, or the id (a level the labels do not know). */
const labelFn = (maps) => (id, a) => (maps[a] && maps[a].get(id)) || id;

function colorOf(config, table, a, i, opts) {
    return tableLevelColour(config, table, a, i, opts.theme.notInTableColor);
}

/**
 * The numeric centers and widths of a binned axis's levels from the reply's edges, or null when the axis is not a
 * run of bins (the levels are then drawn as a category axis). A zero bin sits just below the first edge.
 */
function binPositions(table, a) {
    const { levels, info } = table.axes[a];
    const edges = info.edges;
    if (!Array.isArray(edges) || edges.length < 2) return null;
    const centers = [];
    const widths = [];
    for (const id of levels) {
        if (id === RESERVED.zero) {
            const w = Math.min(edges[1] - edges[0], 2 * Math.abs(edges[0])) || edges[1] - edges[0];
            centers.push(0);
            widths.push(w);
            continue;
        }
        const level = parseLevelId(id);
        if (!level || level.kind !== 'bin' || level.index + 1 >= edges.length) return null;
        centers.push((edges[level.index] + edges[level.index + 1]) / 2);
        widths.push(edges[level.index + 1] - edges[level.index]);
    }
    return { centers, widths };
}

/** A bin edge as a tick or a hover shows it: three significant figures. */
const edgeText = (v) => String(Number(Number(v).toPrecision(3)));

/** Ticks of an index axis are thinned to about this many labels. */
const MAX_BORDER_LABELS = 12;

/**
 * The bins of axis `a` drawn evenly (WP-9, decision 28): each level at its index in `order` with width 1, and the ticks
 * at the borders between them (`k - 0.5`), labelled with the edges and thinned to about twelve labels. A bin's own
 * range is in its label, so the hover keeps it. Null when the axis is not a run of bins (a no-value level, categories):
 * it is then drawn as before. A manual binning's end bins are open, so the border outside them has no edge and no tick;
 * a zero bin is a slot at its place labelled 0.
 * @param {Object} table
 * @param {number} a - the axis
 * @param {number[]} order - the level indexes in drawing order
 * @returns {{positions: number[], tickvals: number[], ticktext: string[]}|null}
 */
function evenBins(table, a, order) {
    const { levels, info } = table.axes[a];
    const edges = info.edges;
    if (!Array.isArray(edges) || edges.length < 1) return null;
    const manual = edges.length < levels.filter((id) => id !== RESERVED.zero).length + 1;
    const ranges = [];
    for (const l of order) {
        const id = levels[l];
        if (id === RESERVED.zero) { ranges.push({ lo: 0, hi: null, zero: true }); continue; }
        const level = parseLevelId(id);
        if (!level || level.kind !== 'bin') return null;
        const i = level.index;
        if (manual) ranges.push({ lo: i === 0 ? null : edges[i - 1], hi: i < edges.length ? edges[i] : null });
        else if (i + 1 < edges.length) ranges.push({ lo: edges[i], hi: edges[i + 1] });
        else return null;
    }
    const n = order.length;
    const all = [];
    for (let k = 0; k <= n; k++) {
        const next = k < n ? ranges[k] : null;
        const prev = k > 0 ? ranges[k - 1] : null;
        let value = null;
        if (next && (next.zero || next.lo !== null)) value = next.zero ? 0 : next.lo;
        else if (prev && !prev.zero && prev.hi !== null) value = prev.hi;
        if (value !== null) all.push({ at: k - 0.5, text: edgeText(value), k });
    }
    const step = Math.max(1, Math.ceil((n + 1) / MAX_BORDER_LABELS));
    const kept = all.filter((t) => t.k % step === 0);
    return { positions: order.map((_, k) => k), tickvals: kept.map((t) => t.at), ticktext: kept.map((t) => t.text) };
}

/** The bins of axis `a` as the figure draws them: evenly (index axis) or at their values, per the config's switch. */
function drawnBins(config, table, input, order) {
    const a = axisOf(table, input);
    if (a < 0) return { even: null, values: null };
    const even = binSpacingOf(config, input) === 'even' ? evenBins(table, a, order) : null;
    return { even, values: even ? null : binPositions(table, a) };
}

// --- shared layout ---------------------------------------------------------------------------------------------------

function axisStyle(theme, extra) {
    return { color: theme.axisColor, gridcolor: theme.gridColor, zerolinecolor: theme.zeroLineColor, automargin: true, ...extra };
}

function baseLayout(opts, extra) {
    const { theme } = opts;
    return {
        paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: theme.bgColor, font: { color: theme.textColor },
        uniformtext: { mode: 'hide', minsize: 8 }, margin: { l: 60, r: 20, t: 20, b: 50 }, ...extra
    };
}

/** A category axis: positions 0..n-1 with one tick of text each, so two levels with one label are never merged. */
function categoryAxis(theme, labels, title, extra = {}) {
    return axisStyle(theme, {
        title: { text: title ? esc(title) : '' }, tickmode: 'array', tickvals: labels.map((_, i) => i), ticktext: labels.map(esc), ...extra
    });
}

// --- bar and histogram -----------------------------------------------------------------------------------------------

/** The translucency of overlaid bars: each level over the others, the ones behind still seen. */
const OVERLAY_OPACITY = 0.6;

function barMode(config, spec) {
    if (spec.kind === 'measure') return { barmode: 'group' };
    const arrangement = arrangementShown(config);
    if (arrangement === 'overlay') return { barmode: 'overlay' };
    if (arrangement === 'dodge') return { barmode: 'group' };
    if (arrangement === 'fill') return { barmode: 'stack', barnorm: 'percent' };
    return { barmode: 'stack' };
}

function barFigure(config, table, opts) {
    const histogram = config.mode === 'histogram';
    const xa = axisOf(table, 'x');
    const sa = axisOf(table, 'split');
    const spec = valueSpec(config, table, opts);
    const labelsOn = labelSpec(config, table, opts);
    const maps = labelMapsOf(config, table, opts);
    const labelAt = labelFn(maps);
    const { horizontal, log, sort, reverse } = opts.options;
    const inOrder = histogram ? axisOrder(table, xa, null, {}) : null;
    const drawn = histogram ? drawnBins(config, table, 'x', inOrder) : { even: null, values: null };
    const bins = drawn.values;
    const even = drawn.even;
    const order = bins || even ? inOrder : axisOrder(table, xa, spec.values, { sort, reverse });
    const xLabels = order.map((l) => labelAt(table.axes[xa].levels[l], xa));
    const splits = sa >= 0 ? Array.from({ length: table.dims[sa] }, (_, i) => i) : [null];
    const mode = barMode(config, spec);
    const data = splits.map((s) => {
        const at = (l) => l * table.stride[xa] + (s === null ? 0 : s * table.stride[sa]);
        const along = order.map((l, k) => (bins ? bins.centers[l] : k));
        const trace = {
            type: 'bar', orientation: horizontal ? 'h' : 'v',
            [horizontal ? 'y' : 'x']: along, [horizontal ? 'x' : 'y']: order.map((l) => (Number.isFinite(spec.values[at(l)]) ? spec.values[at(l)] : null)),
            marker: { color: s === null ? opts.palette[0] : colorOf(config, table, sa, s, opts) },
            hovertext: order.map((l) => hoverOf(config, table, opts, at(l), labelAt)), hoverinfo: 'text',
            showlegend: s !== null, cliponaxis: false
        };
        if (bins) trace.width = order.map((l) => bins.widths[l]);
        if (even) trace.width = order.map(() => 1);
        if (s !== null) trace.name = esc(labelAt(table.axes[sa].levels[s], sa));
        if (labelsOn) Object.assign(trace, { text: order.map((l) => textOf(labelsOn, at(l))), textposition: 'auto' });
        if (mode.barmode === 'overlay') trace.opacity = OVERLAY_OPACITY;
        return trace;
    });
    const xTitle = opts.inputNames.x;
    const value = {
        title: { text: esc(mode.barnorm ? opts.words.fill : spec.title) },
        ...(log && spec.kind === 'count' ? { type: 'log' } : { rangemode: spec.kind === 'measure' ? 'normal' : 'tozero' }),
        ...(spec.percent && !mode.barnorm ? { tickformat: '.0%' } : {}), ...(mode.barnorm ? { ticksuffix: '%' } : {})
    };
    const level = even ? { title: { text: esc(xTitle) }, tickmode: 'array', tickvals: even.tickvals, ticktext: even.ticktext, zeroline: false, ...(reverse ? { autorange: 'reversed' } : {}) }
        : bins ? { title: { text: esc(xTitle) }, ...(reverse ? { autorange: 'reversed' } : {}) }
        : categoryAxis(opts.theme, xLabels, xTitle, horizontal ? { autorange: 'reversed' } : {});
    const layout = baseLayout(opts, {
        ...mode, bargap: histogram ? 0.02 : 0.15, showlegend: sa >= 0,
        ...(sa >= 0 ? { legend: { title: { text: esc(opts.inputNames.split) } } } : {}),
        [horizontal ? 'yaxis' : 'xaxis']: axisStyle(opts.theme, level),
        [horizontal ? 'xaxis' : 'yaxis']: axisStyle(opts.theme, value)
    });
    return { data, layout };
}

// --- 2D histogram and heatmap ----------------------------------------------------------------------------------------

/** The stepped colorscale that gives code `c` of `n` its own color, for a plot colored by a level. */
function steppedScale(colors) {
    const n = colors.length;
    return colors.flatMap((color, c) => [[c / n, color], [(c + 1) / n, color]]);
}

/** `colour` mixed towards the plot background by `alpha` (a color the heatmap can step through), from '#rrggbb'. */
function faded(colour, background, alpha) {
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    if (!/^#[0-9a-f]{6}$/i.test(colour) || !/^#[0-9a-f]{6}$/i.test(background)) return colour;
    const [c, b] = [rgb(colour), rgb(background)];
    return `#${c.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Labels of the most frequent level's factor: the default of each level, read from the factor's axis of the reply as an
 * axis's are (a boolean column's two levels, a grouping's group names), with the factor's own renames over them.
 */
function topLabels(config, table, opts) {
    const factor = config.value.factor;
    const [map] = defaultLabelMaps({ partitionings: [factor] }, { partitionings: [{ ...table.top.info, levels: table.top.levels }] }, opts.titleOf);
    for (const [id, text] of Object.entries(factor.labels || {})) map.set(id, text);
    return map;
}

function rectFigure(config, table, opts) {
    const hist2d = config.mode === 'hist2d';
    const xa = axisOf(table, 'x');
    const ya = axisOf(table, 'y');
    const spec = valueSpec(config, table, opts);
    const labelsOn = labelSpec(config, table, opts);
    const maps = labelMapsOf(config, table, opts);
    const labelAt = labelFn(maps);
    const { reverse } = opts.options;
    const orderOf = (a) => axisOrder(table, a, null, { reverse: hist2d ? false : reverse });
    const [xo, yo] = [orderOf(xa), orderOf(ya)];
    const drawnX = hist2d ? drawnBins(config, table, 'x', xo) : { even: null, values: null };
    const drawnY = hist2d ? drawnBins(config, table, 'y', yo) : { even: null, values: null };
    const [xb, yb] = [drawnX.values, drawnY.values];
    const [xe, ye] = [drawnX.even, drawnY.even];
    const top = spec.kind === 'top_level' ? table.top : null;
    const names = top ? topLabels(config, table, opts) : null;
    const stepsOf = top && opts.options.fade ? FADE_STEPS : 1;
    const at = (xl, yl) => xl * table.stride[xa] + yl * table.stride[ya];
    const z = [];
    const hover = [];
    const text = [];
    for (const yl of yo) {
        const zr = [];
        const hr = [];
        const tr = [];
        for (const xl of xo) {
            const r = at(xl, yl);
            let v = null;
            let zeroed = false;
            if (top) {
                if (top.level[r] >= 0) v = top.level[r] * stepsOf + (stepsOf === 1 ? 0 : Math.min(stepsOf - 1, Math.floor(top.share[r] * stepsOf)));
            } else if (Number.isFinite(spec.values[r])) {
                v = spec.values[r];
            } else if (hist2d && table.count[r] === 0 && zeroIsValue(config, spec)) {
                v = 0;
                zeroed = true;       // a tile without cells is a real 0 of this statistic, drawn in the scale's 0 colour
            }
            zr.push(v);
            hr.push(hoverOf(config, table, opts, r, labelAt) + (top && top.level[r] >= 0
                ? `<br>${esc(names.get(top.levels[top.level[r]]) || top.levels[top.level[r]])}: ${pct(top.share[r])}` : '')
                + (zeroed && spec.kind !== 'count' ? `<br>${esc(zeroLine(config, spec, opts))}` : ''));
            tr.push(textOf(labelsOn, r));
        }
        z.push(zr);
        hover.push(hr);
        text.push(tr);
    }
    const xs = xo.map((l, i) => (xb ? xb.centers[l] : i));
    const ys = yo.map((l, i) => (yb ? yb.centers[l] : i));
    const trace = { type: 'heatmap', x: xs, y: ys, z, hovertext: hover, hoverinfo: 'text', hoverongaps: false };
    if (labelsOn) Object.assign(trace, { text, texttemplate: '%{text}' });
    const extra = [];
    if (top) {
        const topColours = factorColours(plotPaletteOf(config, config.value.factor), top.info, top.levels);
        const topColour = (id) => (topColours.get(id) ? asHex(topColours.get(id)) : opts.theme.notInTableColor);
        const colors = top.levels.flatMap((id) => Array.from({ length: stepsOf }, (__, s) => {
            const base = topColour(id);
            return stepsOf === 1 ? base : faded(base, opts.theme.bgColor, FADE_FROM + (1 - FADE_FROM) * ((s + 1) / stepsOf));
        }));
        Object.assign(trace, { colorscale: steppedScale(colors), zmin: -0.5, zmax: colors.length - 0.5, showscale: false });
        top.levels.forEach((id) => extra.push({
            type: 'scatter', mode: 'markers', x: [null], y: [null], name: esc(names.get(id) || id), hoverinfo: 'skip',
            marker: { symbol: 'square', size: 10, color: topColour(id) }
        }));
    } else {
        const diverging = config.value && config.value.kind === 'measure' && config.measure.stat === 'zscore';
        Object.assign(trace, {
            ...scaleKeys(opts.options, 'z', diverging ? { map: 'RdBu', reverse: true, center: 0 } : {}),
            colorbar: { title: { text: esc(spec.title) }, tickformat: spec.percent ? '.0%' : undefined }
        });
    }
    const axisFor = (a, positions, order, title, extra2, even) => (even
        ? axisStyle(opts.theme, { title: { text: esc(title) }, tickmode: 'array', tickvals: even.tickvals, ticktext: even.ticktext, zeroline: false, ...extra2 })
        : positions
        ? axisStyle(opts.theme, { title: { text: esc(title) }, ...extra2 })
        : categoryAxis(opts.theme, order.map((l) => labelAt(table.axes[a].levels[l], a)), title, extra2));
    const layout = baseLayout(opts, {
        showlegend: !!top, ...(top ? { legend: { title: { text: esc(opts.inputNames.factor) } } } : {}),
        xaxis: axisFor(xa, xb, xo, opts.inputNames.x, {}, xe),
        yaxis: axisFor(ya, yb, yo, opts.inputNames.y, hist2d ? {} : { autorange: 'reversed' }, ye)
    });
    return { data: [trace, ...extra], layout };
}

/** `colour` ('#rrggbb') as an rgba() of `alpha`; any other color is kept. */
function withAlpha(colour, alpha) {
    if (!/^#[0-9a-f]{6}$/i.test(colour)) return colour;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The opacity of a level's color where its count is highest: below 1, so a level under another still shows. */
const LAYER_ALPHA = 0.9;

/** The top of the layers' scale: the config's Max where it is set, else the highest count. */
function layerMax(opts, peak) {
    const max = opts.options && opts.options.colour ? opts.options.colour.max : undefined;
    return Number.isFinite(max) && max > 0 ? max : peak || 1;
}

/**
 * A 2D histogram with a Color by: one layer of rectangles per level, each from transparent to the level's color, the
 * count as the opacity on one scale for every level (0 to the highest count of any level in any rectangle), so a level
 * with few cells stays faint. A marker names each level in the legend, as a rectangle's most frequent level does.
 */
function layerFigure(config, table, opts) {
    const xa = axisOf(table, 'x');
    const ya = axisOf(table, 'y');
    const sa = axisOf(table, 'split');
    const labelAt = labelFn(labelMapsOf(config, table, opts));
    const [xo, yo] = [xa, ya].map((a) => axisOrder(table, a, null, { reverse: false }));
    const [drawnX, drawnY] = [drawnBins(config, table, 'x', xo), drawnBins(config, table, 'y', yo)];
    const [xb, yb] = [drawnX.values, drawnY.values];
    const at = (xl, yl, s) => xl * table.stride[xa] + yl * table.stride[ya] + s * table.stride[sa];
    let peak = 0;
    for (let r = 0; r < table.count.length; r++) if (table.count[r] > peak) peak = table.count[r];
    const levels = Array.from({ length: table.dims[sa] }, (_, s) => s);
    const colors = levels.map((s) => colorOf(config, table, sa, s, opts));
    const xs = xo.map((l, i) => (xb ? xb.centers[l] : i));
    const ys = yo.map((l, i) => (yb ? yb.centers[l] : i));
    const layers = levels.map((s) => ({
        type: 'heatmap', x: xs, y: ys, name: esc(labelAt(table.axes[sa].levels[s], sa)), showscale: false, showlegend: false, hoverongaps: false,
        // an empty tile of a level is a real 0 (the transparent end of its scale), so its hover says "0 cells"
        z: yo.map((yl) => xo.map((xl) => table.count[at(xl, yl, s)])),
        hovertext: yo.map((yl) => xo.map((xl) => hoverOf(config, table, opts, at(xl, yl, s), labelAt))), hoverinfo: 'text',
        zmin: 0, zmax: layerMax(opts, peak), colorscale: [[0, withAlpha(colors[s], 0)], [1, withAlpha(colors[s], LAYER_ALPHA)]]
    }));
    const markers = levels.map((s) => ({
        type: 'scatter', mode: 'markers', x: [null], y: [null], name: esc(labelAt(table.axes[sa].levels[s], sa)), hoverinfo: 'skip',
        marker: { symbol: 'square', size: 10, color: colors[s] }
    }));
    const axisFor = (a, positions, order, title, even) => (even
        ? axisStyle(opts.theme, { title: { text: esc(title) }, tickmode: 'array', tickvals: even.tickvals, ticktext: even.ticktext, zeroline: false })
        : positions
        ? axisStyle(opts.theme, { title: { text: esc(title) } })
        : categoryAxis(opts.theme, order.map((l) => labelAt(table.axes[a].levels[l], a)), title));
    const layout = baseLayout(opts, {
        showlegend: true, legend: { title: { text: esc(opts.inputNames.split) } },
        xaxis: axisFor(xa, xb, xo, opts.inputNames.x, drawnX.even), yaxis: axisFor(ya, yb, yo, opts.inputNames.y, drawnY.even)
    });
    return { data: [...layers, ...markers], layout };
}

// --- pie -------------------------------------------------------------------------------------------------------------

function pieFigure(config, table, opts) {
    const a = axisOf(table, 'x');
    const maps = labelMapsOf(config, table, opts);
    const labelAt = labelFn(maps);
    const { sort, reverse, ring } = opts.options;
    const order = axisOrder(table, a, table.count, { sort, reverse });
    const labelsOn = opts.options.labels && opts.options.labels !== 'none' ? opts.options.labels : null;
    const trace = {
        type: 'pie', sort: false, direction: 'clockwise', hole: ring ? 0.5 : 0,
        labels: order.map((l) => esc(labelAt(table.axes[a].levels[l], a))), values: order.map((l) => table.count[l]),
        marker: { colors: order.map((l) => colorOf(config, table, a, l, opts)) },
        hovertext: order.map((l) => hoverOf(config, table, opts, l, labelAt)), hoverinfo: 'text',
        textinfo: labelsOn === 'count' ? 'value' : labelsOn === 'share' ? 'percent' : 'none', textposition: 'auto'
    };
    const layout = baseLayout(opts, { showlegend: true, legend: { title: { text: esc(opts.inputNames.x) } } });
    return { data: [trace], layout };
}

// --- the figure and the CSV ------------------------------------------------------------------------------------------

/**
 * The Plotly figure of a count table.
 * @param {Object} config - from normalizeCountPlot
 * @param {Object} table - from countTable, for the inputs of the config's mode
 * @param {Object} opts
 * @param {{labels?: string, horizontal?: boolean, log?: boolean, sort?: string, reverse?: boolean, ring?: boolean,
 *   fade?: boolean, colorscale?: string}} opts.options - the panel's options: printed labels ('none', 'count', 'share'
 *   or 'measure'), orientation, a log count axis, the sort ('height' or the engine's order), reverse, a pie as a ring,
 *   the fade by a level's share, the color map of a numeric color
 * @param {Object} opts.words - the interface text: `count`, `fill`, `hoverCount`, `hoverShare` (strings) and
 *   `share(base, inputNames)`, `measure(stat, source, above)` and `topLevel(factorName)` (functions)
 * @param {Object} opts.inputNames - the title of each input by its name (`x`, `y`, `split`, `factor`)
 * @param {string[]} opts.palette - the color of a plot with no split, its first (the levels are colored by utils/grouping-colours.js)
 * @param {Object} opts.theme - the plot theme's `textColor`, `axisColor`, `gridColor`, `zeroLineColor`, `bgColor`, `notInTableColor`
 * @param {Map[]} [opts.labels] - one Map per table axis, level id to the label shown; defaults to `levelLabelsOf`. The
 *   most frequent level's factor is labelled from the table's `top.info` and the factor's own `labels`
 * @param {string} [opts.measureSource] - the measure's source as the axis names it ("Mrpl15 · logged_counts")
 * @param {Function} [opts.titleOf] - the title of the panel behind a source, for the default labels
 * @returns {{data: Object[], layout: Object}}
 */
// export-unused-ok: C2a draws the plot with it
export function countFigure(config, table, opts) {
    switch (config.mode) {
        case 'bar':
        case 'histogram': return barFigure(config, table, opts);
        case 'hist2d': return axisOf(table, 'split') >= 0 ? layerFigure(config, table, opts) : rectFigure(config, table, opts);
        case 'heatmap': return rectFigure(config, table, opts);
        case 'pie': return pieFigure(config, table, opts);
        default: throw new Error(`The count plot draws ${DRAWN_MODES.join(', ')} here; ${config.mode} has its own drawing.`);
    }
}

/**
 * The rows of the plotted table (CNT-23), headers first: the levels of each input, the count, the share and the measure.
 * The CSV and Show as table are these rows (one column specification).
 * @param {Object} config
 * @param {Object} table
 * @param {{labels?: Map[], inputNames: Object, headers: {count: string, share: string, measure?: string}, titleOf?: Function}} opts
 */
// export-unused-ok: the CSV's rows; Node tests read them (Show as table, their other reader, was dropped in WP-6a)
export function countRows(config, table, opts) {
    return tableRows(config, table, {
        labelOf: labelFn(labelMapsOf(config, table, opts)), inputNames: opts.inputNames, headers: opts.headers, shareBase: valueOf(config).base
    });
}

/**
 * The CSV of the plotted table (CNT-23): `countRows` as text.
 * @param {Object} config
 * @param {Object} table
 * @param {Object} opts - as countRows
 */
export function countCsv(config, table, opts) {
    return tableCsv(countRows(config, table, opts));
}
