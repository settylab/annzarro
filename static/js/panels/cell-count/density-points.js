/**
 * A 2D density drawn on the cell locations (the "Cell points" layer): each cell is a point at its (x, y), its
 * opacity the density of its level there, on the one scale of the other layers. Pure: the panel loads the per-cell
 * x, y and level codes (cell-count.js), this module bins them on the density grid, looks the smoothed density up,
 * and makes the traces.
 *
 * Only scattergl traces of fewer than 100,000 points are made, in the large Cell Plot's way (plot-utilities/
 * large-plot.js): below that size scattergl builds no hover index, so a million points do not cost the 50 bytes each
 * it would. Hover is the density grid's, not the point's. A Color by is one trace per level and opacity step in the
 * level's color; one group is one run of traces with the density as a number on the plot's color map.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { limitDefault } from '../../utils/limits.js';

/** The most cells drawn as points, by default; above it a seeded uniform sample is drawn. The cap in force is the
 *  server's limits.density_points_draw (density-points-load.js `drawCap`). */
// export-unused-ok: the default, for the module's tests
export const DENSITY_POINTS_DRAW = limitDefault('density_points_draw');
/** The most cells whose x and y are loaded (about 9 bytes a cell), by default; above it the layer is refused. The cap
 *  in force is limits.density_points_load (`loadCap`). */
// export-unused-ok: the default, for the module's tests
export const DENSITY_POINTS_LOAD = limitDefault('density_points_load');

/** The opacity steps of a Color by's points, one trace each. */
// export-unused-ok: the module's tests state it
export const ALPHA_STEPS = 8;
/** A trace's most points: fewer than 100,000, where scattergl starts to build a hover index. */
const PIECE = 99_999;
/** The marker size in pixels: the default and the range of the field. */
export const POINT_SIZE = Object.freeze({ default: 3, min: 1, max: 12 });
/** The seed of the sample, so a redraw shows the same cells. */
// export-unused-ok: the module's tests state it
export const SAMPLE_SEED = 1;

const W = VOCABULARY.countPlot.points;

/** The bin of grid `g` ({lo, step, bins}) holding value `v`: the top edge is in the last bin; -1 outside or NaN. */
// export-unused-ok: the module's tests state it
export function binIndex(v, g) {
    if (!(v >= g.lo)) return -1;
    const i = Math.floor((v - g.lo) / g.step);
    if (i < g.bins) return i;
    return v - g.lo <= g.bins * g.step * (1 + 1e-12) ? g.bins - 1 : -1;
}

/** The smoothed density `f` (x slowest) at (x, y), NaN outside the grid. */
// export-unused-ok: the module's tests state it
export function densityAt(f, gx, gy, x, y) {
    const ix = binIndex(x, gx);
    const iy = binIndex(y, gy);
    return ix < 0 || iy < 0 ? NaN : f[ix * gy.bins + iy];
}

/**
 * The opacity step (0 to ALPHA_STEPS - 1) of density `d` between `floor` and `peak`: -1 for a density not above the floor
 * (no density, with the floor at 0).
 */
// export-unused-ok: the module's tests state it
export function alphaStep(d, peak, steps = ALPHA_STEPS, floor = 0) {
    if (!(d > floor) || !(peak > floor)) return -1;
    return Math.min(steps - 1, Math.max(0, Math.ceil(((d - floor) / (peak - floor)) * steps) - 1));
}

/** The opacity a step is drawn in: rising evenly to `top` (the point opacity, 1 unless set) at the last. */
// export-unused-ok: the module's tests state it
export function stepAlpha(k, steps = ALPHA_STEPS, top = 1) {
    return Number((top * (k + 1) / steps).toFixed(4));
}

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Which `cap` of `n` cells to draw: null when they all fit, else the sorted indices of a seeded uniform sample
 * (selection sampling: one pass, exactly `cap` cells).
 * @returns {Uint32Array|null}
 */
export function sampleIndices(n, cap, seed = SAMPLE_SEED) {
    if (n <= cap) return null;
    const out = new Uint32Array(cap);
    const next = mulberry32(seed);
    let taken = 0;
    for (let i = 0; i < n && taken < cap; i++) if (next() * (n - i) < cap - taken) out[taken++] = i;
    return out;
}

/**
 * The notice of the strip: the points actually drawn, of the cells loaded (the sample, when there is one), of the cells
 * shown. Cells outside the density's range are loaded and not drawn, so the numbers can differ and each says what it is.
 */
export function pointsNote(drawn, loaded, total) {
    return loaded < total ? W.sample(drawn, loaded, total) : W.all(drawn, total);
}

/** Why the layer cannot be drawn: `{kind: 'too_many', total, limit}` or `{kind: 'source', input}`. */
export function pointsRefusal(why) {
    return why.kind === 'too_many' ? W.tooMany(why.total, why.limit === undefined ? DENSITY_POINTS_LOAD : why.limit) : W.source(why.input);
}

const rgba = (hex, a) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
};

const marker = (size) => ({ size, line: { width: 0 } });

/**
 * The traces of the cells as points.
 * @param {{x: Float32Array, y: Float32Array, level: ?Int16Array}} points - the cells drawn: positions, and the level
 *   (index into the table's split axis, -1 for none) of each, or null for one group
 * @param {Object} grid
 * @param {{lo: number, step: number, bins: number}} grid.gx
 * @param {{lo: number, step: number, bins: number}} grid.gy
 * @param {Float64Array[]} grid.smooth - the smoothed density of each level (one for a group), x slowest
 * @param {number} grid.peak - the highest density of any level: the opacity scale's top
 * @param {string[]} grid.colors - the color of each level ('#rrggbb')
 * @param {number} grid.size - the marker size
 * @param {Object} [grid.scale] - one group's color map keys (`colorscale`, `reversescale`, `cmin`, `cmax`)
 * @param {{title: string}} [grid.bar] - one group: put the color bar on the first trace
 * @returns {Object[]} scattergl traces
 */
export function pointTraces(points, { gx, gy, smooth, peak, floor = 0, colors, size, opacity = 1, fade = false, scale = {}, bar = null }) {
    const { x, y, level } = points;
    const n = x.length;
    if (!level) return groupTraces(x, y, smooth[0], gx, gy, peak, floor, size, opacity, scale, bar);
    const nLevels = smooth.length;
    // flat points are one run per level at the point opacity; faded ones step with the density up to it
    const steps = fade ? ALPHA_STEPS : 1;
    // a counting sort of the cells into (level, step) runs, so a run is typed and contiguous
    const key = new Int32Array(n);
    const counts = new Int32Array(nLevels * steps + 1);
    for (let i = 0; i < n; i++) {
        const s = level[i];
        let k = -1;
        if (s >= 0 && s < nLevels) {
            const d = densityAt(smooth[s], gx, gy, x[i], y[i]);
            const a = fade ? alphaStep(d, peak, steps, floor) : (d > floor ? 0 : -1);
            if (a >= 0) k = s * steps + a;
        }
        key[i] = k;
        if (k >= 0) counts[k + 1]++;
    }
    for (let k = 0; k < nLevels * steps; k++) counts[k + 1] += counts[k];
    const total = counts[nLevels * steps];
    const px = new Float32Array(total);
    const py = new Float32Array(total);
    const at = counts.slice(0, nLevels * steps);
    for (let i = 0; i < n; i++) {
        const k = key[i];
        if (k < 0) continue;
        px[at[k]] = x[i];
        py[at[k]] = y[i];
        at[k]++;
    }
    const traces = [];
    for (let k = 0; k < nLevels * steps; k++) {
        const from = counts[k];
        const to = counts[k + 1];
        const color = rgba(colors[Math.floor(k / steps)], fade ? stepAlpha(k % steps, steps, opacity) : opacity);
        for (let a = from; a < to; a += PIECE) {
            const b = Math.min(to, a + PIECE);
            traces.push({ type: 'scattergl', mode: 'markers', x: px.subarray(a, b), y: py.subarray(a, b), hoverinfo: 'skip', showlegend: false,
                marker: { ...marker(size), color } });
        }
    }
    return traces;
}

function groupTraces(x, y, f, gx, gy, peak, floor, size, opacity, scale, bar) {
    const n = x.length;
    const px = new Float32Array(n);
    const py = new Float32Array(n);
    const pd = new Float32Array(n);
    let m = 0;
    for (let i = 0; i < n; i++) {
        const d = densityAt(f, gx, gy, x[i], y[i]);
        if (!(d > floor)) continue;
        px[m] = x[i];
        py[m] = y[i];
        pd[m] = d;
        m++;
    }
    const traces = [];
    for (let a = 0; a < m; a += PIECE) {
        const b = Math.min(m, a + PIECE);
        traces.push({ type: 'scattergl', mode: 'markers', x: px.subarray(a, b), y: py.subarray(a, b), hoverinfo: 'skip', showlegend: false,
            marker: { ...marker(size), opacity, color: pd.subarray(a, b), ...scale,
                cmin: scale.cmin === undefined ? floor : scale.cmin, cmax: scale.cmax === undefined ? peak : scale.cmax,
                showscale: !!bar && a === 0, ...(bar && a === 0 ? { colorbar: { title: { text: bar.title } } } : {}) } });
    }
    return traces;
}
