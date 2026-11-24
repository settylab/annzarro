/**
 * The Count Plot in 3D (UX 6b, WP-11): a 2D histogram, a heatmap or a bar plot with a Color by as bars on a grid, ONE
 * `mesh3d` (utils/bars-3d.js, the builder the Cell-Gene Plot shares). A pure function of the stored config, the table of
 * one reply and the panel's options, like draw.js, so Node tests cover it; it costs the table's rows.
 *
 * What is drawn (each one is tested):
 *  - The bar's intensity is the 2D colour value, cell by cell: a 2D histogram's and a heatmap's z (a count, a share, a
 *    statistic, or the stepped code of the most frequent level), a bar plot's plotted value. The colour map, Reverse and
 *    the range reach the mesh as they reach the 2D heatmap.
 *  - The height has its own source (`config.height`, a value choice), Same as Color by default. The most frequent level has
 *    no number, so the height is then the count. A statistic as height is read from the moments the grid already holds
 *    (planGrid asks for the measure); with none in the reply the height is Same as Color.
 *  - The grid: a 2D histogram's and a heatmap's x by y; a bar plot's x by its Color by's levels. An empty rectangle, a zero
 *    count and a missing value are not drawn (bars-3d.js). A 2D histogram with a Color by is drawn in layers in 2D and
 *    not offered in 3D (`view3dGate`).
 *  - Bins are always spaced evenly in 3D (WP-9): each at its index with the grid lines at the borders, labelled by the
 *    edges, so a log or equal-count axis reads the same as in 2D's even drawing.
 *  - The scene, its category labels (anchored on their ticks, turned with the camera) and the camera come from the
 *    Cell-Gene Plot's 3D (cell-gene/draw.js `sceneAxis`, `sceneLabels`, `sceneAspect`).
 *  - Plot Options' 3D section (`opts.view3d`): the footprint, the lighting, the axis box and the height's title.
 *
 * Left out in 3D (the strip says so): printed values, the log count axis, horizontal bars, arrangements and the fade.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { axisOrder, heightChoiceValues, splitUsed } from '../../utils/count-plot-model.js';
import { bars3d, checkBarCap, barCap, BAR_FILL, VERTICES_PER_BAR } from '../../utils/bars-3d.js';
import { countFigure, axisOf, valueSpec, hoverOf, labelMapsOf, labelFn, evenBins } from './draw.js';
import { scaleKeys } from './colour.js';
import { sceneAxis, sceneLabels, sceneAspect, DEFAULT_CAMERA } from '../cell-gene/draw.js';

export { DEFAULT_CAMERA, sceneLabels };

const W = VOCABULARY.countPlot.view3d;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const UIREVISION_3D = 'ccnt-3d';

/**
 * Whether the plot may be drawn in 3D (graded like every choice: refused with its reason): the mode has a grid of bars, and,
 * once the table is known (`rows`: its rows, one bar each), they are at most the cap.
 * @param {Object} config - the shown config (shownConfig)
 * @param {number|null} [rows] - the table's rows; null before there is one
 * @param {number} [max] - the cap; the shared one by default (bars-3d.js)
 * @returns {{ok: boolean, why: 'mode'|'cap'|'', text: string}}
 */
export function view3dGate(config, rows = null, max = barCap()) {
    const refuse = (text) => ({ ok: false, why: 'mode', text });
    if (config.mode === 'hist2d') {
        if (config.split && splitUsed(config)) return refuse(W.refused.layers);
    } else if (config.mode === 'bar') {
        if (!config.split) return refuse(W.refused.needSplit);
    } else if (config.mode !== 'heatmap') {
        return refuse(W.refused.mode);
    }
    if (rows !== null) {
        const cap = checkBarCap(rows, { max, hint: 'bins' });
        if (!cap.ok) return { ok: false, why: 'cap', text: cap.text };
    }
    return { ok: true, why: '', text: '' };
}

/** The config with the value `choice` stands for, so valueSpec words and reads it as it does the plot's own. */
function asValue(config, choice) {
    if (choice === 'count') return { ...config, value: { kind: 'count' } };
    if (choice.startsWith('share:')) return { ...config, value: { kind: 'share', of: choice.slice('share:'.length) } };
    return { ...config, value: { kind: 'measure' }, measure: { ...config.measure, stat: choice.slice('stat:'.length) } };
}

/** The height source of its own, or null (Same as Color): `{values, spec: {title, show}}`. */
function ownHeight(config, table, opts) {
    const own = heightChoiceValues(config, table);
    return own ? { values: own.values, spec: valueSpec(asValue(config, own.choice), table, opts) } : null;
}

/** The hover of a bar: the 2D hover, and the height's own line when it is not the colour. */
function hoverLine(base, own, r) {
    if (!own || !Number.isFinite(own.values[r])) return base;
    return `${base}<br>${esc(W.hoverHeight)} · ${esc(own.spec.title)}: ${own.spec.show(own.values[r])}`;
}

/** The axis a scene shows: its labels at their positions on the box edge, and the cells it spans. */
function axisSpec(labels, positions, extent, title) {
    return { labels, positions, extent, title };
}

/** A 2D histogram's or heatmap's bars: the 2D heatmap's own z, hover and colour keys, so the 3D colour is the 2D colour. */
function rectBars(config, table, opts) {
    const hist2d = config.mode === 'hist2d';
    const xa = axisOf(table, 'x');
    const ya = axisOf(table, 'y');
    const reverse = !hist2d && opts.options.reverse === true;
    const xo = axisOrder(table, xa, null, { reverse });
    const yo = axisOrder(table, ya, null, { reverse });
    const flat = countFigure(config, table, opts);
    const trace = flat.data[0];
    const spec = valueSpec(config, table, opts);
    const top = spec.kind === 'top_level';
    const own = ownHeight(config, table, opts);
    const labelAt = labelFn(labelMapsOf(config, table, opts));
    const n = xo.length * yo.length;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const heights = new Float64Array(n);
    const values = new Float64Array(n);
    const hover = new Array(n);
    let i = 0;
    for (let yi = 0; yi < yo.length; yi++) {
        for (let xi = 0; xi < xo.length; xi++, i++) {
            const r = xo[xi] * table.stride[xa] + yo[yi] * table.stride[ya];
            const v = trace.z[yi][xi];
            xs[i] = xi;
            ys[i] = yi;
            values[i] = v === null || v === undefined ? NaN : v;
            heights[i] = own ? own.values[r] : top ? table.count[r] : values[i];
            hover[i] = hoverLine(trace.hovertext[yi][xi], own, r);
        }
    }
    const axis = (a, order, name) => {
        const even = hist2d ? evenBins(table, a, order) : null;
        return even ? axisSpec(even.ticktext, even.tickvals, order.length, name)
            : axisSpec(order.map((l) => labelAt(table.axes[a].levels[l], a)), order.map((_, k) => k), order.length, name);
    };
    const keys = { colorscale: trace.colorscale };
    for (const [from, to] of [['zmin', 'cmin'], ['zmax', 'cmax'], ['zmid', 'cmid']]) if (trace[from] !== undefined) keys[to] = trace[from];
    if (trace.colorbar && trace.showscale !== false) keys.colorbar = { title: trace.colorbar.title, tickformat: trace.colorbar.tickformat };
    const legend = flat.data.slice(1).map((t) => ({
        type: 'scatter3d', mode: 'markers', x: [null], y: [null], z: [null], name: t.name, hoverinfo: 'skip',
        marker: { symbol: 'square', size: 6, color: t.marker.color }
    }));
    return {
        xs, ys, heights, values, hover, keys, reversescale: trace.reversescale === true, legend,
        legendTitle: flat.layout.legend ? flat.layout.legend.title : null,
        x: axis(xa, xo, opts.inputNames.x), y: axis(ya, yo, opts.inputNames.y),
        zTitle: own ? own.spec.title : top ? opts.words.count : spec.title, numeric: !top
    };
}

/** A bar plot with a Color by: x by the split's levels, the plotted value as the colour and, by default, the height. */
function barBars(config, table, opts) {
    const xa = axisOf(table, 'x');
    const sa = axisOf(table, 'split');
    const spec = valueSpec(config, table, opts);
    const { sort, reverse } = opts.options;
    const order = axisOrder(table, xa, spec.values, { sort, reverse });
    const maps = labelMapsOf(config, table, opts);
    const labelAt = labelFn(maps);
    const own = ownHeight(config, table, opts);
    const splits = table.dims[sa];
    const n = order.length * splits;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const heights = new Float64Array(n);
    const values = new Float64Array(n);
    const hover = new Array(n);
    let i = 0;
    for (let s = 0; s < splits; s++) {
        for (let k = 0; k < order.length; k++, i++) {
            const r = order[k] * table.stride[xa] + s * table.stride[sa];
            xs[i] = k;
            ys[i] = s;
            values[i] = Number.isFinite(spec.values[r]) ? spec.values[r] : NaN;
            heights[i] = own ? own.values[r] : values[i];
            hover[i] = hoverLine(hoverOf(config, table, opts, r, labelAt), own, r);
        }
    }
    const diverging = config.value && config.value.kind === 'measure' && config.measure.stat === 'zscore';
    const keys = { ...scaleKeys(opts.options, 'marker', diverging ? { map: 'RdBu', reverse: true, center: 0 } : {}) };
    const reversescale = keys.reversescale === true;
    delete keys.reversescale;
    keys.colorbar = { title: { text: esc(spec.title) }, tickformat: spec.percent ? '.0%' : undefined };
    const levels = (a, order2) => axisSpec(order2.map((l) => labelAt(table.axes[a].levels[l], a)), order2.map((_, k) => k), order2.length);
    const splitOrder = Array.from({ length: splits }, (_, s) => s);
    return {
        xs, ys, heights, values, hover, keys, reversescale, legend: [], legendTitle: null,
        x: { ...levels(xa, order), title: opts.inputNames.x }, y: { ...levels(sa, splitOrder), title: opts.inputNames.split },
        zTitle: own ? own.spec.title : spec.title, numeric: true
    };
}

/** The scene axis made plain: no grid, line or panes (Plot Options' axis box off). */
const boxless = (axis) => ({ ...axis, showgrid: false, showline: false, zeroline: false, showbackground: false });

/**
 * The 3D figure of a count table.
 * @param {Object} config - the shown config (mode hist2d, heatmap or bar; see `view3dGate`)
 * @param {Object} table - from countTable
 * @param {Object} opts - as draw.js `countFigure`'s, and `view3d`: `{footprint?: number, lighting?: boolean, box?: boolean,
 *   zTitle?: string}` (Plot Options' 3D section; the defaults when absent)
 * @returns {{data: Object[], layout: Object, bars: number, labels3d: Object, colourData: Float64Array|null}}
 */
export function figure3d(config, table, opts) {
    const v3 = opts.view3d || {};
    const th = opts.theme;
    const parts = config.mode === 'bar' ? barBars(config, table, opts) : rectBars(config, table, opts);
    const built = bars3d({
        xs: parts.xs, ys: parts.ys, heights: parts.heights, hover: parts.hover,
        fill: Number.isFinite(v3.footprint) ? v3.footprint : BAR_FILL,
        colour: { kind: 'continuous', values: parts.values, ...parts.keys }
    });
    const mesh = built.trace;
    if (parts.reversescale) mesh.reversescale = true;
    if (v3.lighting === false) mesh.lighting = { ambient: 1, diffuse: 0, specular: 0, roughness: 1, fresnel: 0 };

    const aspect = sceneAspect(parts.x.extent, parts.y.extent);
    const zTitle = v3.zTitle ? v3.zTitle : parts.zTitle;
    const font = { color: th.textColor, size: th.fontSize || 12, family: th.fontFamily || 'Arial, Helvetica, sans-serif' };
    const labels3d = { x: { ...parts.x, title: esc(parts.x.title) }, y: { ...parts.y, title: esc(parts.y.title) }, aspect,
        z: Math.min(0, built.zRange[0]), font };
    const camera = config.camera ? JSON.parse(JSON.stringify(config.camera)) : JSON.parse(JSON.stringify(DEFAULT_CAMERA));
    const frame = (axis) => (v3.box === false ? boxless(axis) : axis);
    const layout = {
        paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: th.bgColor, font: { color: th.textColor }, uirevision: UIREVISION_3D,
        showlegend: parts.legend.length > 0, hovermode: 'closest', margin: { l: 0, r: 0, t: 10, b: 0 },
        ...(parts.legendTitle ? { legend: { title: parts.legendTitle } } : {}),
        scene: {
            xaxis: frame(sceneAxis(parts.x.labels, parts.x.positions, parts.x.extent, th)),
            yaxis: frame(sceneAxis(parts.y.labels, parts.y.positions, parts.y.extent, th)),
            zaxis: frame({ title: { text: esc(zTitle), font: { color: th.textColor } }, color: th.textColor, gridcolor: th.gridColor,
                linecolor: th.axisColor, zerolinecolor: th.axisColor, showspikes: false, backgroundcolor: th.bgColor }),
            aspectmode: 'manual', aspectratio: aspect, camera, annotations: sceneLabels(labels3d, camera), bgcolor: th.bgColor
        }
    };
    // the numbers the colour scale is drawn over, one per bar (the Display pop-over's range reads them)
    let colourData = null;
    if (parts.numeric) {
        colourData = new Float64Array(built.drawn);
        for (let b = 0; b < built.drawn; b++) colourData[b] = mesh.intensity[b * VERTICES_PER_BAR];
    }
    return { data: [mesh, ...parts.legend], layout, bars: built.drawn, labels3d, colourData };
}
