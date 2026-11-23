/**
 * The density figures of the count plot (V3, CNT-10, UX 4.4): the smoothed curve of one number, with a curve per level
 * of a split, and the smoothed plane of two, as filled contours or an image.
 *
 * The figure is a pure function of the stored config, the table of one grid reply and the panel's options. The engine
 * bins the cells to 512 bins (256 by 256 in 2D) over the range its pre-pass chose and reports `n` and `sigma`
 * (`axes[i].density`); this file chooses the bandwidth (utils/kde.js), smooths the counts and draws. It costs the grid
 * and the kernel, never the cells, and nothing here runs on a paint, a hover or a progress frame: C2a calls it once per
 * reply or option change.
 *
 * The three sentences of UX 4.4 come with the figure (`notes`): the bandwidth, the range and, when it applies, the
 * floor. The panel shows them in Plot Options and the status strip.
 */
import { bandwidthOf, smooth1, smooth2 } from '../../utils/kde.js';
import { levelLabelsOf, densityLayers } from '../../utils/count-plot-model.js';
import { scaleKeys } from './colour.js';
import { pointTraces, pointsNote, POINT_SIZE } from './density-points.js';
import { normalizeHex } from '../../utils/plot-theme.js';
import { RESERVED } from '../../utils/level-id.js';
import { VOCABULARY } from '../../utils/vocabulary.js';

/** The modes this module draws. */
// export-unused-ok: C2a offers the density modes that draw here
export const DENSITY_MODES = Object.freeze(['density', 'density2d']);

/** The interface text of a density (UX 4.4): the count plot's words, utils/vocabulary.js. */
const WORDS = VOCABULARY.countPlot.density;

const CONTOURS = 6;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const shown = (h) => String(Number(h.toPrecision(2)));
const adjustShown = (a) => (Number.isInteger(a) ? a.toFixed(1) : String(a));

/** A reply that breaks the contract of a density grid (E4): the client refuses it instead of drawing a flat curve. */
function contractError(message) {
    return Object.assign(new Error(message), { reason: 'bad_grid_reply' });
}

/** `color` at `alpha`, when it is a hex color; else unchanged. */
function withAlpha(color, alpha) {
    const m = /^#([0-9a-f]{6})$/.exec(normalizeHex(color));
    if (!m) return color;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function axisStyle(theme, extra) {
    return { color: theme.axisColor, gridcolor: theme.gridColor, zerolinecolor: theme.zeroLineColor, automargin: true, ...extra };
}

function baseLayout(opts, extra) {
    const { theme } = opts;
    return { paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: theme.bgColor, font: { color: theme.textColor }, margin: { l: 60, r: 20, t: 20, b: 50 }, ...extra };
}

/** The color of level `i` of the split: the level's own, the theme's grey for a reserved level, else the palette's. */
function colorOf(table, a, i, opts) {
    const id = table.axes[a].levels[i];
    if (id === RESERVED.other || id === RESERVED.small) return opts.theme.notInTableColor;
    const own = table.axes[a].info.colors;
    return (own && own[id]) || opts.palette[i % opts.palette.length];
}

/** The pre-pass of an axis: what E4 read before binning. */
function prepassOf(table, a, name) {
    const d = table.axes[a].info.density;
    if (!d || typeof d !== 'object' || !Number.isInteger(d.n)) throw contractError(`The density grid reply lacks the pre-pass (density: n, sigma) on axis ${name}.`);
    return d;
}

/** The equal-width bins of an axis: its centres and step from the reply's edges. */
function gridOf(table, a, name) {
    const { levels, info } = table.axes[a];
    const edges = info.edges;
    if (!levels.every((id) => id.startsWith('bin:'))) throw new Error(`A density needs equal-width bins on ${name}; its levels are not a run of bins.`);
    const step = (edges[edges.length - 1] - edges[0]) / levels.length;
    return { bins: levels.length, lo: edges[0], hi: edges[edges.length - 1], step, centres: Array.from(levels, (_, i) => edges[0] + (i + 0.5) * step) };
}

/** The counts of one level of the split along the axes `along`, x slowest; the whole table when there is no split. */
function countsOf(table, along, split, s) {
    const dims = along.map((a) => table.dims[a]);
    const out = new Float64Array(dims.reduce((p, d) => p * d, 1));
    const at = (i, j) => i * table.stride[along[0]] + (along.length > 1 ? j * table.stride[along[1]] : 0) + (split >= 0 ? s * table.stride[split] : 0);
    if (along.length === 1) for (let i = 0; i < dims[0]; i++) out[i] = table.count[at(i, 0)];
    else for (let i = 0; i < dims[0]; i++) for (let j = 0; j < dims[1]; j++) out[i * dims[1] + j] = table.count[at(i, j)];
    return out;
}

const total = (a) => { let m = 0; for (let i = 0; i < a.length; i++) m += a[i]; return m; };

/**
 * The figure of a density.
 * @param {Object} config - from normalizeCountPlot, with mode `density` or `density2d`
 * @param {Object} table - from countTable over the grid's axes (x, then y in 2D, then split); each of x and y must carry
 *   `info.density` (`n`, `sigma`) and `info.edges`, as E4's grid reply does
 * @param {Object} opts
 * @param {{adjust?: number, scale?: 'level'|'size', style?: 'contours'|'image', colorscale?: string}} [opts.options] - the
 *   bandwidth adjust (default 1), a split's curves each scaled to 1 (default) or by the size of their level, a 2D density
 *   as filled contours (default) or an image, and the color map of a 2D density without a split
 * @param {Object} opts.inputNames - the title of each input (`x`, `y`, `split`)
 * @param {string[]} opts.palette - colors of a split's levels, repeated past its length
 * @param {Object} opts.theme - the plot theme's colors, as the other count figures take them
 * @param {Map[]} [opts.labels] - one Map per table axis, level id to the label shown; defaults to `levelLabelsOf`
 * @param {Function} [opts.titleOf] - the title of the panel behind a source, for the default labels
 * @returns {{data: Object[], layout: Object, notes: {bandwidth: (string|null), range: string, floor: (string|null)},
 *   floored: boolean, bandwidth: number[]}} the Plotly figure; the three sentences of UX 4.4; whether the floor applied
 *   on any axis; and the bandwidth used per axis
 */
// export-unused-ok: C2a draws the density modes with it
export function densityFigure(config, table, opts) {
    if (!DENSITY_MODES.includes(config.mode)) throw new Error(`The density figure draws ${DENSITY_MODES.join(' and ')}; ${config.mode} has its own drawing.`);
    const options = opts.options || {};
    const adjust = options.adjust === undefined ? 1 : options.adjust;
    if (!(adjust > 0) || !Number.isFinite(adjust)) throw new Error(`The bandwidth adjust must be a positive number, not ${adjust}.`);
    const two = config.mode === 'density2d';
    const names = two ? ['x', 'y'] : ['x'];
    const along = names.map((name) => {
        const a = table.axes.findIndex((axis) => axis.input === name);
        if (a < 0) throw new Error(`The density table has no ${name} axis.`);
        return a;
    });
    const sa = table.axes.findIndex((axis) => axis.input === 'split');
    const pre = along.map((a, i) => prepassOf(table, a, names[i]));
    const notes = { bandwidth: null, range: WORDS.range(table.outside), floor: null };
    const layout = (extra) => baseLayout(opts, extra);
    if (pre[0].n === 0) return { data: [], layout: layout({}), notes, floored: false, bandwidth: [] };
    if (table.axes[along[0]].info.degenerate) return degenerateFigure(table, along[0], opts, notes, layout);

    const grids = along.map((a, i) => gridOf(table, a, names[i]));
    const hs = pre.map((p, i) => bandwidthOf({ sigma: p.sigma, n: p.n, dims: names.length, adjust, step: grids[i].step }));
    const floored = hs.some((h) => h.floored);
    notes.bandwidth = WORDS.bandwidth(hs.map((h) => shown(h.h)), adjustShown(adjust), names.length);
    if (floored) notes.floor = WORDS.floor;

    const levels = sa >= 0 ? Array.from({ length: table.dims[sa] }, (_, s) => s) : [-1];
    const maps = sa >= 0 ? (opts.labels || levelLabelsOf(config, table, opts.titleOf)) : null;
    const labelOf = (s) => (maps && maps[sa] && maps[sa].get(table.axes[sa].levels[s])) || (s >= 0 ? table.axes[sa].levels[s] : '');
    const counts = levels.map((s) => countsOf(table, along, sa, s));
    const sizes = counts.map(total);
    const everyone = sizes.reduce((p, n) => p + n, 0);
    const bySize = options.scale === 'size';
    const smooth = counts.map((c, i) => {
        const f = two
            ? smooth2(c, { nx: grids[0].bins, ny: grids[1].bins, stepX: grids[0].step, stepY: grids[1].step, hx: hs[0].h, hy: hs[1].h })
            : smooth1(c, grids[0].step, hs[0].h);
        if (bySize && everyone > 0) for (let k = 0; k < f.length; k++) f[k] *= sizes[i] / everyone;
        return f;
    });
    /** The opacity of a level's color where its density is highest: below 1, so a level under another still shows. */
    const IMAGE_ALPHA = 0.9;
    const IMAGE_UNDER = 0.55;
    const words = WORDS;
    const title = bySize && sa >= 0 ? words.axisBySize : words.axis;
    const colors = levels.map((s) => (s >= 0 ? colorOf(table, sa, s, opts) : opts.palette[0]));
    const legend = sa >= 0 ? { showlegend: true, legend: { title: { text: esc(opts.inputNames.split) } } } : { showlegend: false };

    if (!two) {
        const [g] = grids;
        const data = levels.map((s, i) => ({
            type: 'scatter', mode: 'lines', x: g.centres, y: Array.from(smooth[i]), name: esc(labelOf(s)), showlegend: s >= 0,
            line: { color: colors[i], width: 2 }, fill: 'tozeroy', fillcolor: withAlpha(colors[i], sa >= 0 ? 0.2 : 0.35),
            hovertemplate: `${esc(opts.inputNames.x)}: %{x:.4g}<br>${esc(title)}: %{y:.3g}<extra>${esc(labelOf(s))}</extra>`
        }));
        return {
            data, notes, floored, bandwidth: hs.map((h) => h.h),
            layout: layout({ ...legend,
                xaxis: axisStyle(opts.theme, { title: { text: esc(opts.inputNames.x) }, range: [g.lo, g.hi] }),
                yaxis: axisStyle(opts.theme, { title: { text: esc(title) }, rangemode: 'tozero' }) })
        };
    }
    const [gx, gy] = grids;
    const layers = densityLayers(options.layers, options.style, sa >= 0);
    const rows = (f) => Array.from({ length: gy.bins }, (_, iy) => Array.from({ length: gx.bins }, (_, ix) => f[ix * gy.bins + iy]));
    const base = (i, s) => ({
        x: gx.centres, y: gy.centres, z: rows(smooth[i]), name: esc(labelOf(s)),
        hovertemplate: `${esc(opts.inputNames.x)}: %{x:.4g}<br>${esc(opts.inputNames.y)}: %{y:.4g}<br>${esc(title)}: %{z:.3g}<extra>${esc(labelOf(s))}</extra>`
    });
    const peak = smooth.reduce((m, f) => { for (let k = 0; k < f.length; k++) if (f[k] > m) m = f[k]; return m; }, 0) || 1;
    const data = [];
    const contoured = layers.fill || layers.lines;
    if (sa >= 0) {
        // the density is the opacity of each level's color, on one scale for every level: a level with little density stays
        // faint. The same density levels bound every level's bands, so a band is one opacity wherever it is
        const step = peak / (CONTOURS + 1);
        const bands = { start: step, end: step * CONTOURS, size: step };
        const scaled = { zmin: 0, zmax: peak, showscale: false };
        if (layers.image) {
            levels.forEach((s, i) => data.push({ ...base(i, s), type: 'heatmap', ...scaled,
                colorscale: [[0, withAlpha(colors[i], 0)], [1, withAlpha(colors[i], IMAGE_ALPHA)]] }));
        }
        if (contoured) {
            levels.forEach((s, i) => data.push({ ...base(i, s), type: 'contour', ...scaled, contours: { coloring: layers.fill ? 'fill' : 'lines', showlines: layers.lines, ...bands },
                colorscale: layers.fill ? [[0, withAlpha(colors[i], 0)], [1, withAlpha(colors[i], IMAGE_ALPHA)]] : [[0, colors[i]], [1, colors[i]]],
                line: { color: colors[i], width: 2 } }));
        }
    } else {
        // one group: the density takes a color map the user chooses (map, direction, range) and a color bar
        const scale = scaleKeys(options, 'z');
        const last = contoured ? 'contour' : 'heatmap';
        const bar = (type) => ({ showscale: type === last, ...(type === last ? { colorbar: { title: { text: esc(title) } } } : {}) });
        if (layers.image) data.push({ ...base(0, -1), type: 'heatmap', ...scale, ...bar('heatmap') });
        if (contoured) {
            data.push({ ...base(0, -1), type: 'contour', ...scale, ...bar('contour'), ncontours: CONTOURS * 2,
                contours: { coloring: layers.fill ? 'fill' : 'lines', showlines: layers.lines },
                line: layers.fill ? { color: opts.theme.axisColor, width: 1 } : { width: 2 },
                // over the image, the bands let it show through
                ...(layers.image ? { opacity: IMAGE_UNDER } : {}) });
        }
    }
    if (layers.points && opts.points) {
        // each cell a point at its place, drawn over the other layers; the points' own hover is off, the grid's is the hover
        const pts = opts.points;
        const one = sa < 0;
        if (!layers.image && !contoured) {
            levels.forEach((s, i) => data.push({ ...base(i, s), type: 'heatmap', showscale: false, zmin: 0, zmax: peak,
                colorscale: [[0, 'rgba(0, 0, 0, 0)'], [1, 'rgba(0, 0, 0, 0)']] }));
        }
        const size = Number.isFinite(options.pointSize) ? Math.min(POINT_SIZE.max, Math.max(POINT_SIZE.min, options.pointSize)) : POINT_SIZE.default;
        const drawn = pointTraces(pts, { gx, gy, smooth, peak, colors, size, scale: one ? scaleKeys(options, 'marker') : {},
            bar: one && !layers.image && !contoured ? { title: esc(title) } : null });
        data.push(...drawn);
        notes.points = pointsNote(drawn.reduce((n, t) => n + t.x.length, 0), pts.x.length, pts.total);
    }
    // heatmaps and contours carry no legend of their own in every bundle: a marker names each level
    if (sa >= 0) {
        levels.forEach((s, i) => data.push({ type: 'scatter', mode: 'markers', x: [null], y: [null], name: esc(labelOf(s)), hoverinfo: 'skip',
            marker: { symbol: 'square', size: 10, color: colors[i] } }));
        data.forEach((t) => { if (t.type !== 'scatter') t.showlegend = false; });
    }
    return {
        data, notes, floored, bandwidth: hs.map((h) => h.h),
        layout: layout({ ...legend,
            xaxis: axisStyle(opts.theme, { title: { text: esc(opts.inputNames.x) }, range: [gx.lo, gx.hi] }),
            yaxis: axisStyle(opts.theme, { title: { text: esc(opts.inputNames.y) }, range: [gy.lo, gy.hi] }) })
    };
}

/** A column of one value has no curve: a line at the value, so the plot is not empty and the sentences still read. */
function degenerateFigure(table, a, opts, notes, layout) {
    const value = table.axes[a].info.value;
    const trace = { type: 'scatter', mode: 'lines', x: [value, value], y: [0, 1], line: { color: opts.palette[0], width: 2 }, showlegend: false,
        hovertemplate: `${esc(opts.inputNames.x)}: ${esc(value)}<extra></extra>` };
    return { data: [trace], notes, floored: false, bandwidth: [],
        layout: layout({ showlegend: false, xaxis: axisStyle(opts.theme, { title: { text: esc(opts.inputNames.x) } }), yaxis: axisStyle(opts.theme, { visible: false }) }) };
}
