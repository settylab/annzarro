/**
 * The colour scale of a count figure, from the options of the config (WP-6a): one place for the map, Reverse and the
 * fixed range, so a 2D histogram, a 2D density and an UpSet's bars read them alike. Pure.
 */
import { plotlyColorscale, EXTRA_SCALES } from '../../utils/color-scales.js';
import { PLOTLY_SCALE_STOPS } from '../../utils/color-scale-stops.js';
import { asHex } from '../../utils/grouping-colours.js';

/** The map drawn when the config stores none. */
export const DEFAULT_COLORSCALE = 'Viridis';

/**
 * The keys of a colour scale for a trace.
 * @param {{colorscale?: string, colour?: {reverse?: boolean, min?: number, max?: number, center?: number}}} options - the
 *   drawing's options (controls-model.js `drawOptions`)
 * @param {'z'|'marker'} family - `z` for a heatmap or contour (`zmin`), `marker` for a marker's (`cmin`)
 * @param {{map?: string, reverse?: boolean, center?: number}} [fallback] - what the plot draws when the config stores
 *   no map: a diverging z-score's RdBu, reversed, around 0
 * @returns {Object} `colorscale`, `reversescale` and the limits that are set
 */
export function scaleKeys(options, family, fallback = {}) {
    const o = options || {};
    const colour = o.colour || {};
    const map = o.colorscale || fallback.map || DEFAULT_COLORSCALE;
    // a chosen map is drawn as chosen; the plot's own fallback (a z-score's reversed RdBu) is Reverse's starting point
    const stored = !!o.colorscale;
    const reverse = (!stored && fallback.reverse === true) !== (colour.reverse === true);
    const [lo, hi, mid] = family === 'marker' ? ['cmin', 'cmax', 'cmid'] : ['zmin', 'zmax', 'zmid'];
    const keys = { colorscale: plotlyColorscale(map) };
    if (reverse) keys.reversescale = true;
    if (Number.isFinite(colour.min)) keys[lo] = colour.min;
    if (Number.isFinite(colour.max)) keys[hi] = colour.max;
    const centre = Number.isFinite(colour.center) ? colour.center : fallback.center;
    if (Number.isFinite(centre)) keys[mid] = centre;
    return keys;
}

/**
 * The numbers a figure's colour scale is drawn over: the `z` of its heatmap or contour, else the marker colours of a
 * trace that shows a colour bar. The Color pop-over's range sliders move over them. Null when the figure has no
 * numeric colour scale (a level palette, a most-frequent-level heatmap).
 * @param {Object[]} data - the Plotly traces
 * @returns {Float64Array|null}
 */
export function colourValues(data) {
    const out = [];
    for (const t of data || []) {
        const source = Array.isArray(t.z) && (t.colorbar || t.showscale) ? t.z.flat()
            : t.marker && t.marker.showscale && Array.isArray(t.marker.color) ? t.marker.color : null;
        if (!source) continue;
        for (const v of source) if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
    }
    return out.length ? Float64Array.from(out) : null;
}

const rgbOf = (css) => { const h = asHex(css); return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); };

/** The colour of a map at `t` in 0..1 (stops interpolated in RGB, as Plotly draws a colour scale), as `#rrggbb`. */
function mapColourAt(stops, t) {
    const at = Math.min(1, Math.max(0, t));
    let k = 1;
    while (k < stops.length - 1 && stops[k][0] < at) k++;
    const [t0, c0] = stops[k - 1];
    const [t1, c1] = stops[k];
    const f = t1 === t0 ? 0 : Math.min(1, Math.max(0, (at - t0) / (t1 - t0)));
    const a = rgbOf(c0);
    const b = rgbOf(c1);
    return `#${a.map((v, i) => Math.round(v + (b[i] - v) * f).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The colours a pie's slices take from a continuous colour scale: Plotly maps a number to a colour for a trace, not for a
 * pie's slices, so the figure maps them with the map's own stops and the same range rules as `scaleKeys` (Min, Max and
 * Center as set, else the values' own; Reverse). A value that is not a finite number gets `grey`.
 * @param {Array<number|null>} values
 * @param {{colorscale?: string, colour?: {reverse?: boolean, min?: number, max?: number, center?: number}}} options
 * @param {string} grey
 * @returns {{colours: string[], lo: number, hi: number}} the colours and the range the scale was drawn over
 */
export function scaleColours(values, options, grey) {
    const o = options || {};
    const colour = o.colour || {};
    const name = o.colorscale || DEFAULT_COLORSCALE;
    const stops = EXTRA_SCALES[name] || PLOTLY_SCALE_STOPS[name] || PLOTLY_SCALE_STOPS[DEFAULT_COLORSCALE];
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of values) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (Number.isFinite(colour.min)) lo = colour.min;
    if (Number.isFinite(colour.max)) hi = colour.max;
    // Center, as Plotly's cmid: with a limit unset, the range is made symmetric about it
    if (Number.isFinite(colour.center) && !(Number.isFinite(colour.min) && Number.isFinite(colour.max))) {
        const half = Math.max(Math.abs((Number.isFinite(colour.min) ? colour.min : lo) - colour.center), Math.abs((Number.isFinite(colour.max) ? colour.max : hi) - colour.center));
        if (!Number.isFinite(colour.min)) lo = colour.center - half;
        if (!Number.isFinite(colour.max)) hi = colour.center + half;
    }
    const colours = values.map((v) => {
        if (!Number.isFinite(v)) return grey;
        const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
        return mapColourAt(stops, colour.reverse === true ? 1 - Math.min(1, Math.max(0, t)) : t);
    });
    return { colours, lo, hi };
}
