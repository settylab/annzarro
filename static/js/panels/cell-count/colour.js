/**
 * The colour scale of a count figure, from the options of the config (WP-6a): one place for the map, Reverse and the
 * fixed range, so a 2D histogram, a 2D density and an UpSet's bars read them alike. Pure.
 */
import { plotlyColorscale } from '../../utils/color-scales.js';

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
