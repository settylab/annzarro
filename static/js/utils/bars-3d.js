/**
 * The 3D bar builder (UX 6b, WP-10): a grid of bars as ONE Plotly `mesh3d` trace. Pure: no DOM, no Plotly, no state,
 * so Cell Count and the Cell-Gene Plot share it and Node tests it.
 *
 * Decisions (each one is tested):
 *  - A bar is a box from 0 to its height: 8 vertices and 10 triangles. The face at 0 is not built: it lies on the
 *    floor, is seen only from below, and 2 of 12 triangles is 17% of a mesh of up to 400,000. A negative height
 *    spans height..0 and drops the same (0-level) face, so it hangs down from the floor. Plotly lights both sides.
 *  - A bar of height 0 is OMITTED, as a missing value is (UX 6b: "zero counts are not drawn"). A flat tile would
 *    be a coplanar face with the floor and z-fight. Both are counted in `skipped`.
 *  - A non-finite height, colour value, or a footprint <= 0 omits the bar, counted separately.
 *  - Log height is not offered: the spec has none, and a log of a count of 0 is undefined where bars are omitted.
 *  - Bar positions are index units (x = column index, y = row index, cell width 1), as the 2D index axis is.
 *  - Intensity is per vertex and the same on all 8 vertices of a bar; `facecolor` is one entry per triangle.
 *  - Hover is set on every vertex; `hoverinfo: 'text'`.
 *
 * Memory: coordinates are Float32Array, face indices Int32Array, intensity Float32Array; there is no per-bar object.
 */

import { VOCABULARY } from './vocabulary.js';

/** At most this many bars in 3D. Provisional: WP-13 measures the real one. */
// export-unused-ok: the 3D builder API for WP-11 (Cell Count) and WP-12 (Cell-Gene)
export const BARS_3D_MAX = 40000;
/** Fraction of its cell a bar fills, so neighbours stay apart (UX 6b). */
// export-unused-ok: the 3D builder API for WP-11 (Cell Count) and WP-12 (Cell-Gene)
export const BAR_FILL = 0.85;
/** Vertices and triangles of one bar. */
// export-unused-ok: the 3D builder API for WP-11 (Cell Count) and WP-12 (Cell-Gene)
export const VERTICES_PER_BAR = 8;
// export-unused-ok: the 3D builder API for WP-11 (Cell Count) and WP-12 (Cell-Gene)
export const TRIANGLES_PER_BAR = 10;

// Corner order: 0..3 at the floor (z = 0), 4..7 above each (z = height); counter-clockwise from (-,-).
const CX = [-1, 1, 1, -1, -1, 1, 1, -1];
const CY = [-1, -1, 1, 1, -1, -1, 1, 1];
// 10 triangles: the top (4 to 7) and the four sides. The floor face (0 to 3) is not built.
const TRI = [
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7
];

/** Is the bar count within the cap? `{ok, count, max, text}`; `text` is the refusal and `hint` picks its last sentence. */
// export-unused-ok: the 3D builder API for WP-11 (Cell Count) and WP-12 (Cell-Gene)
export function checkBarCap(count, { max = BARS_3D_MAX, hint = 'bins' } = {}) {
    const ok = Number.isFinite(count) && count <= max;
    return { ok, count, max, text: ok ? '' : VOCABULARY.view3d.tooMany(max, count, hint) };
}

/** The footprint scale for a Size value: the side scales with sqrt(size / sizeMax), so the AREA encodes Size. */
// export-unused-ok: the 3D builder API for WP-12 (Cell-Gene dots)
export function footprintFromSize(size, sizeMax) {
    if (!(sizeMax > 0) || !Number.isFinite(size) || size < 0) return NaN;
    return Math.sqrt(Math.min(size, sizeMax) / sizeMax);
}

/**
 * Tick arrays for one category axis: a tick at each index, labels thinned to at most `maxTicks` (every step-th, always
 * keeping the first). Positions are the bar centres.
 */
// export-unused-ok: the 3D builder API for WP-11 (Cell Count) and WP-12 (Cell-Gene)
export function axisTicks(labels, maxTicks = 40) {
    const n = labels ? labels.length : 0;
    if (n === 0) return { tickvals: [], ticktext: [] };
    const step = Math.max(1, Math.ceil(n / Math.max(1, maxTicks)));
    const tickvals = [];
    const ticktext = [];
    for (let i = 0; i < n; i += step) {
        tickvals.push(i);
        ticktext.push(String(labels[i]));
    }
    return { tickvals, ticktext };
}

/**
 * Build the trace.
 *
 * @param {object} p
 * @param {ArrayLike<number>} p.xs      column index of each bar
 * @param {ArrayLike<number>} p.ys      row index of each bar
 * @param {ArrayLike<number>} p.heights bar height (negative hangs down; NaN, null or 0 omits the bar)
 * @param {ArrayLike<number>} [p.footprint] scale of the cell side per bar, 0..1 (default 1); Cell-Gene dots pass
 *        `footprintFromSize`
 * @param {number} [p.fill=BAR_FILL] fraction of a cell a full-footprint bar covers (1 - fill is the gap)
 * @param {object} p.colour one of
 *        `{kind: 'continuous', values, colorscale, cmin?, cmax?, cmid?, colorbar?}` or
 *        `{kind: 'categorical', colors}` (one CSS colour per bar)
 * @param {ArrayLike<string>} [p.hover] hover text per bar
 * @param {ArrayLike<string>} [p.xLabels] category labels for the x axis ticks
 * @param {ArrayLike<string>} [p.yLabels] category labels for the y axis ticks
 * @param {number} [p.maxTicks=40]
 * @returns {{trace: object, ticks: {x: object, y: object}, drawn: number, skipped: {nan: number, zero: number,
 *           footprint: number}, zRange: [number, number]}}
 */
// export-unused-ok: the 3D builder API for WP-11 (Cell Count) and WP-12 (Cell-Gene)
export function bars3d({ xs, ys, heights, footprint = null, fill = BAR_FILL, colour, hover = null, xLabels = null, yLabels = null, maxTicks = 40 }) {
    const n = heights.length;
    const continuous = colour && colour.kind === 'continuous';
    const values = continuous ? colour.values : null;
    const colors = !continuous && colour ? colour.colors : null;
    const skipped = { nan: 0, zero: 0, footprint: 0 };

    // Pass 1: which bars are drawn. A Uint8Array flag, not per-bar objects.
    const keep = new Uint8Array(n);
    let drawn = 0;
    let zMin = 0;
    let zMax = 0;
    for (let b = 0; b < n; b++) {
        const h = heights[b];
        if (h === null || h === undefined || !Number.isFinite(h)) { skipped.nan++; continue; }
        if (continuous) {
            const v = values[b];
            if (v === null || v === undefined || !Number.isFinite(v)) { skipped.nan++; continue; }
        }
        if (h === 0) { skipped.zero++; continue; }
        if (footprint) {
            const f = footprint[b];
            if (!(f > 0)) { skipped.footprint++; continue; }
        }
        keep[b] = 1;
        drawn++;
        if (h < zMin) zMin = h;
        if (h > zMax) zMax = h;
    }

    const x = new Float32Array(drawn * VERTICES_PER_BAR);
    const y = new Float32Array(drawn * VERTICES_PER_BAR);
    const z = new Float32Array(drawn * VERTICES_PER_BAR);
    const i = new Int32Array(drawn * TRIANGLES_PER_BAR);
    const j = new Int32Array(drawn * TRIANGLES_PER_BAR);
    const k = new Int32Array(drawn * TRIANGLES_PER_BAR);
    const intensity = continuous ? new Float32Array(drawn * VERTICES_PER_BAR) : null;
    const facecolor = continuous ? null : new Array(drawn * TRIANGLES_PER_BAR);
    const hovertext = hover ? new Array(drawn * VERTICES_PER_BAR) : null;

    // Pass 2: fill.
    let o = 0;
    for (let b = 0; b < n; b++) {
        if (!keep[b]) continue;
        const half = 0.5 * fill * (footprint ? footprint[b] : 1);
        const cx = xs[b];
        const cy = ys[b];
        const h = heights[b];
        const v0 = o * VERTICES_PER_BAR;
        for (let c = 0; c < VERTICES_PER_BAR; c++) {
            x[v0 + c] = cx + CX[c] * half;
            y[v0 + c] = cy + CY[c] * half;
            z[v0 + c] = c < 4 ? 0 : h;
        }
        const t0 = o * TRIANGLES_PER_BAR;
        for (let t = 0; t < TRIANGLES_PER_BAR; t++) {
            i[t0 + t] = v0 + TRI[3 * t];
            j[t0 + t] = v0 + TRI[3 * t + 1];
            k[t0 + t] = v0 + TRI[3 * t + 2];
        }
        if (continuous) {
            intensity.fill(values[b], v0, v0 + VERTICES_PER_BAR);
        } else if (colors) {
            for (let t = 0; t < TRIANGLES_PER_BAR; t++) facecolor[t0 + t] = colors[b];
        }
        if (hovertext) {
            const text = hover[b] === null || hover[b] === undefined ? '' : String(hover[b]);
            for (let c = 0; c < VERTICES_PER_BAR; c++) hovertext[v0 + c] = text;
        }
        o++;
    }

    const trace = {
        type: 'mesh3d',
        x, y, z, i, j, k,
        flatshading: true,
        lighting: { ambient: 0.75, diffuse: 0.6, specular: 0.05, roughness: 0.9, fresnel: 0.1 },
        hoverinfo: hovertext ? 'text' : 'skip',
        showscale: false
    };
    if (hovertext) trace.hovertext = hovertext;
    if (continuous) {
        trace.intensity = intensity;
        trace.intensitymode = 'vertex';
        if (colour.colorscale) trace.colorscale = colour.colorscale;
        if (colour.cmin !== undefined) trace.cmin = colour.cmin;
        if (colour.cmax !== undefined) trace.cmax = colour.cmax;
        if (colour.cmid !== undefined) trace.cmid = colour.cmid;
        trace.showscale = colour.colorbar !== undefined && colour.colorbar !== null;
        if (trace.showscale) trace.colorbar = colour.colorbar;
    } else {
        trace.facecolor = facecolor;
    }

    return {
        trace,
        ticks: { x: axisTicks(xLabels, maxTicks), y: axisTicks(yLabels, maxTicks) },
        drawn,
        skipped,
        zRange: [zMin, zMax]
    };
}
