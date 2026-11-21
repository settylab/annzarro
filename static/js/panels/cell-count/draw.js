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
    axisOrder, heightValues, shareValues, measureValues, levelLabelsOf, levelsAt, tableRows, tableCsv
} from '../../utils/count-plot-model.js';
import { defaultLabelMaps } from '../../utils/cell-grouping.js';
import { parseLevelId, RESERVED } from '../../utils/level-id.js';
import { plotlyColorscale } from '../../utils/color-scales.js';

/** The modes this module draws; the others (density, Venn, UpSet) have their own drawing. */
// export-unused-ok: C2a offers the count modes that draw here
export const DRAWN_MODES = Object.freeze(['bar', 'histogram', 'hist2d', 'heatmap', 'pie']);

/** How many steps of fade a rectangle's share of its most frequent level is drawn in (CNT-18). */
const FADE_STEPS = 4;
const FADE_FROM = 0.3;
const DEFAULT_COLORSCALE = 'Viridis';

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

function colorOf(table, a, i, opts) {
    const id = table.axes[a].levels[i];
    if (id === RESERVED.other || id === RESERVED.small) return opts.theme.notInTableColor;
    const own = table.axes[a].info.colors;
    return (own && own[id]) || opts.palette[i % opts.palette.length];
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

function barMode(config, spec, histogram) {
    if (spec.kind === 'measure') return { barmode: 'group' };
    const arrangement = config.arrangement || 'stack';
    if (arrangement === 'dodge') return { barmode: histogram ? 'overlay' : 'group' };
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
    const bins = histogram ? binPositions(table, xa) : null;
    const order = bins ? axisOrder(table, xa, null, {}) : axisOrder(table, xa, spec.values, { sort, reverse });
    const xLabels = order.map((l) => labelAt(table.axes[xa].levels[l], xa));
    const splits = sa >= 0 ? Array.from({ length: table.dims[sa] }, (_, i) => i) : [null];
    const mode = barMode(config, spec, histogram);
    const data = splits.map((s) => {
        const at = (l) => l * table.stride[xa] + (s === null ? 0 : s * table.stride[sa]);
        const along = order.map((l, k) => (bins ? bins.centers[l] : k));
        const trace = {
            type: 'bar', orientation: horizontal ? 'h' : 'v',
            [horizontal ? 'y' : 'x']: along, [horizontal ? 'x' : 'y']: order.map((l) => (Number.isFinite(spec.values[at(l)]) ? spec.values[at(l)] : null)),
            marker: { color: s === null ? opts.palette[0] : colorOf(table, sa, s, opts) },
            hovertext: order.map((l) => hoverOf(config, table, opts, at(l), labelAt)), hoverinfo: 'text',
            showlegend: s !== null, cliponaxis: false
        };
        if (bins) trace.width = order.map((l) => bins.widths[l]);
        if (s !== null) trace.name = esc(labelAt(table.axes[sa].levels[s], sa));
        if (labelsOn) Object.assign(trace, { text: order.map((l) => textOf(labelsOn, at(l))), textposition: 'auto' });
        if (histogram && mode.barmode === 'overlay') trace.opacity = 0.6;
        return trace;
    });
    const xTitle = opts.inputNames.x;
    const value = {
        title: { text: esc(mode.barnorm ? opts.words.fill : spec.title) },
        ...(log && spec.kind === 'count' ? { type: 'log' } : { rangemode: spec.kind === 'measure' ? 'normal' : 'tozero' }),
        ...(spec.percent && !mode.barnorm ? { tickformat: '.0%' } : {}), ...(mode.barnorm ? { ticksuffix: '%' } : {})
    };
    const level = bins ? { title: { text: esc(xTitle) }, ...(reverse ? { autorange: 'reversed' } : {}) }
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

/** Labels of the most frequent level's factor: the caller's, or the default of the ids the table kept. */
function topLabels(config, table, opts) {
    if (opts.topLabels) return opts.topLabels;
    const [map] = defaultLabelMaps({ partitionings: [config.value.factor] }, { partitionings: [{ levels: table.top.levels }] }, opts.titleOf);
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
    const [xb, yb] = hist2d ? [binPositions(table, xa), binPositions(table, ya)] : [null, null];
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
            if (top) {
                if (top.level[r] >= 0) v = top.level[r] * stepsOf + (stepsOf === 1 ? 0 : Math.min(stepsOf - 1, Math.floor(top.share[r] * stepsOf)));
            } else if (Number.isFinite(spec.values[r]) && !(hist2d && spec.kind === 'count' && spec.values[r] === 0)) {
                v = spec.values[r];
            }
            zr.push(v);
            hr.push(hoverOf(config, table, opts, r, labelAt) + (top && top.level[r] >= 0
                ? `<br>${esc(names.get(top.levels[top.level[r]]) || top.levels[top.level[r]])}: ${pct(top.share[r])}` : ''));
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
        const colors = top.levels.flatMap((_, i) => Array.from({ length: stepsOf }, (__, s) => {
            const base = opts.palette[i % opts.palette.length];
            return stepsOf === 1 ? base : faded(base, opts.theme.bgColor, FADE_FROM + (1 - FADE_FROM) * ((s + 1) / stepsOf));
        }));
        Object.assign(trace, { colorscale: steppedScale(colors), zmin: -0.5, zmax: colors.length - 0.5, showscale: false });
        top.levels.forEach((id, i) => extra.push({
            type: 'scatter', mode: 'markers', x: [null], y: [null], name: esc(names.get(id) || id), hoverinfo: 'skip',
            marker: { symbol: 'square', size: 10, color: opts.palette[i % opts.palette.length] }
        }));
    } else {
        const diverging = config.value && config.value.kind === 'measure' && config.measure.stat === 'zscore';
        Object.assign(trace, {
            colorscale: plotlyColorscale(diverging ? 'RdBu' : opts.options.colorscale || DEFAULT_COLORSCALE), reversescale: diverging,
            ...(diverging ? { zmid: 0 } : {}),
            colorbar: { title: { text: esc(spec.title) }, tickformat: spec.percent ? '.0%' : undefined }
        });
    }
    const axisFor = (a, positions, order, title, extra2) => (positions
        ? axisStyle(opts.theme, { title: { text: esc(title) }, ...extra2 })
        : categoryAxis(opts.theme, order.map((l) => labelAt(table.axes[a].levels[l], a)), title, extra2));
    const layout = baseLayout(opts, {
        showlegend: !!top, ...(top ? { legend: { title: { text: esc(opts.inputNames.factor) } } } : {}),
        xaxis: axisFor(xa, xb, xo, opts.inputNames.x, {}),
        yaxis: axisFor(ya, yb, yo, opts.inputNames.y, hist2d ? {} : { autorange: 'reversed' })
    });
    return { data: [trace, ...extra], layout };
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
        marker: { colors: order.map((l) => colorOf(table, a, l, opts)) },
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
 * @param {string[]} opts.palette - colors of a categorical input's levels, repeated past its length
 * @param {Object} opts.theme - the plot theme's `textColor`, `axisColor`, `gridColor`, `zeroLineColor`, `bgColor`, `notInTableColor`
 * @param {Map[]} [opts.labels] - one Map per table axis, level id to the label shown; defaults to `levelLabelsOf`
 * @param {Map} [opts.topLabels] - the labels of the most frequent level's factor
 * @param {string} [opts.measureSource] - the measure's source as the axis names it ("Mrpl15 · logged_counts")
 * @param {Function} [opts.titleOf] - the title of the panel behind a source, for the default labels
 * @returns {{data: Object[], layout: Object}}
 */
// export-unused-ok: C2a draws the plot with it
export function countFigure(config, table, opts) {
    switch (config.mode) {
        case 'bar':
        case 'histogram': return barFigure(config, table, opts);
        case 'hist2d':
        case 'heatmap': return rectFigure(config, table, opts);
        case 'pie': return pieFigure(config, table, opts);
        default: throw new Error(`The count plot draws ${DRAWN_MODES.join(', ')} here; ${config.mode} has its own drawing.`);
    }
}

/**
 * The CSV of the plotted table (CNT-23): the levels of each input, the count, the share and the measure.
 * @param {Object} config
 * @param {Object} table
 * @param {{labels?: Map[], inputNames: Object, headers: {count: string, share: string, measure?: string}, titleOf?: Function}} opts
 */
// export-unused-ok: C2a offers the CSV in Plot Options and Show as table
export function countCsv(config, table, opts) {
    const labelAt = labelFn(labelMapsOf(config, table, opts));
    return tableCsv(tableRows(config, table, {
        labelOf: labelAt, inputNames: opts.inputNames, headers: opts.headers, shareBase: valueOf(config).base
    }));
}
