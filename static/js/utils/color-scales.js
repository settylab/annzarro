/**
 * Which way the sequential colour maps run, for the Map picker's labels,
 * and which points "Strong on top" draws last (strongOnTopKey, below).
 *
 * Plotly's single-hue maps run from dark to light (Blues, Greens, Greys,
 * YlGnBu, YlOrRd), against the usual "pale for little, dark for a lot";
 * Reds runs the other way. Flipping them would recolour every saved view and
 * share link that set Reverse to get the pale end at zero (all the shipped
 * Blues views do), so the maps are left as Plotly draws them and the picker
 * says which way each runs; the swatch beside it shows the map as drawn,
 * Reverse included.
 *
 * The ends below are Plotly 2.20's (static/vendor/js); the browser test
 * test_colour_scale_direction.py checks them against the loaded Plotly.
 * Diverging and rainbow maps (RdBu, Portland, Jet, ...) have no light end
 * and are not labelled.
 */

/** The low end of each sequential map, 'dark' or 'light'. */
export const SEQUENTIAL_LOW_END = Object.freeze({
    Greys: 'dark', YlGnBu: 'dark', Greens: 'dark', YlOrRd: 'dark', Reds: 'light', Blues: 'dark',
    Hot: 'dark', Blackbody: 'dark', Earth: 'dark', Electric: 'dark',
    Viridis: 'dark', Cividis: 'dark', Inferno: 'dark', Magma: 'dark', Plasma: 'dark'
});

/**
 * Low to high, as drawn: "dark → light", or null for a map with no light end.
 * @param {string} scale
 * @param {boolean} [reversed]
 * @returns {string|null}
 */
export function scaleDirection(scale, reversed = false) {
    const low = SEQUENTIAL_LOW_END[scale];
    if (!low) return null;
    const darkLow = (low === 'dark') !== !!reversed;
    return darkLow ? 'dark → light' : 'light → dark';
}

/** The picker's option text: "Blues (dark → light)", or the name alone. */
export function scaleOptionLabel(scale) {
    const direction = scaleDirection(scale);
    return direction ? `${scale} (${direction})` : scale;
}

/**
 * A CSS gradient of Plotly colour stops [[t, colour], ...], low on the left.
 * @param {Array<[number, string]>} stops
 * @param {boolean} [reversed]
 * @returns {string}
 */
export function scaleGradient(stops, reversed = false) {
    const ordered = reversed ? stops.map(([t, c]) => [1 - t, c]).reverse() : stops;
    return `linear-gradient(to right, ${ordered.map(([t, c]) => `${c} ${Math.round(t * 1000) / 10}%`).join(', ')})`;
}

/*
 * "Strong on top": which points are drawn last (on top).
 *
 * It draws the top end of the colour bar on top. On a scale centred at 0
 * (Center at 0) or a diverging map both ends of the bar count as the top,
 * so points are ordered by |value|, as before. On any other map they are
 * ordered by where their colour sits on the bar: their value clamped to
 * [Min, Max] in drawn units (log10 when Log is on), Max last. Plotly's colour
 * bar has Max at the top whether or not Reverse is on (Reverse swaps the
 * colours, not the ends), so Reverse does not change the order. Points
 * clamped to the same end tie and keep data order; missing values stay at
 * the bottom.
 *
 * |value| ordered every map, which is wrong for a sequential one: Blues with
 * Reverse (pale = low) and Min 0.3 locked drew values far below 0.3,
 * clamped to the pale end, over the strong blue ones. For values that are
 * all at or above 0 on an unlocked range both orders are the same.
 */

/** Diverging maps: both ends are the top, so strong on top stays |value|. */
export const DIVERGING_SCALES = Object.freeze(new Set(['RdBu', 'Picnic', 'Bluered']));

/**
 * The sort key of strong on top: points are drawn in ascending key order.
 * @param {Object} o
 * @param {string} o.scale - the colour map's name
 * @param {boolean} [o.centred] - Center at 0
 * @param {number} o.min - the drawn range (cmin, in drawn units)
 * @param {number} o.max
 * @returns {(v: number) => number} -Infinity for a missing value
 */
export function strongOnTopKey({ scale, centred = false, min, max }) {
    const finite = (v) => typeof v === 'number' && Number.isFinite(v);
    if (centred || DIVERGING_SCALES.has(scale) || !(finite(min) && finite(max) && max > min)) {
        return (v) => (finite(v) ? Math.abs(v) : -Infinity);
    }
    const span = max - min;
    return (v) => {
        if (!finite(v)) return -Infinity;
        return v <= min ? 0 : v >= max ? 1 : (v - min) / span;
    };
}

/*
 * Maps the picker offers that Plotly 2.20 has no name for. Given a name it
 * does not know, Plotly silently drew its default (RdBu's stops), so
 * Inferno, Magma and Plasma looked like RdBu. They are passed to Plotly as
 * explicit stops instead: 11 evenly spaced samples of the maps as matplotlib
 * 3.11 ships them. The maps are by Nathaniel J. Smith and Stefan van der Walt
 * (https://github.com/BIDS/colormap, colormaps.py), released under the CC0
 * public domain dedication; credit is asked for, no terms are imposed.
 */
export const EXTRA_SCALES = Object.freeze({
    Inferno: [[0.0, '#000004'], [0.1, '#160b39'], [0.2, '#420a68'], [0.3, '#6a176e'], [0.4, '#932667'], [0.5, '#bc3754'],
        [0.6, '#dd513a'], [0.7, '#f37819'], [0.8, '#fca50a'], [0.9, '#f6d746'], [1.0, '#fcffa4']],
    Magma: [[0.0, '#000004'], [0.1, '#140e36'], [0.2, '#3b0f70'], [0.3, '#641a80'], [0.4, '#8c2981'], [0.5, '#b73779'],
        [0.6, '#de4968'], [0.7, '#f7705c'], [0.8, '#fe9f6d'], [0.9, '#fecf92'], [1.0, '#fcfdbf']],
    Plasma: [[0.0, '#0d0887'], [0.1, '#41049d'], [0.2, '#6a00a8'], [0.3, '#8f0da4'], [0.4, '#b12a90'], [0.5, '#cc4778'],
        [0.6, '#e16462'], [0.7, '#f2844b'], [0.8, '#fca636'], [0.9, '#fcce25'], [1.0, '#f0f921']]
});

/** What to give Plotly as `colorscale` for a map name: its stops for EXTRA_SCALES, else the name. */
export function plotlyColorscale(name) {
    return Object.prototype.hasOwnProperty.call(EXTRA_SCALES, name) ? EXTRA_SCALES[name] : name;
}
