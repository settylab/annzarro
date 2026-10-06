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
 * It ordered every map by |value|. That is right for a scale centred at 0
 * (Center at 0) and for the diverging maps, whose middle is the neutral
 * colour; it is wrong for a sequential map. Blues with Reverse (pale = low)
 * and Min 0.3 locked: values far below 0.3, clamped to the pale end, have a
 * large |value| and were drawn over the strong blue ones.
 *
 * So on a sequential map (no Center at 0) points are ordered by where their
 * colour sits on the scale, clamped to [Min, Max] in drawn units (log10 when
 * Log is on), and "strong" is the end away from the pale end: the end that
 * stands out against the white plot. Reverse moves the pale end and so what
 * counts as strong. A map with no near-white end (Portland, Jet, Viridis,
 * ...) has no pale end; there the high end is strong, Reverse or not.
 * Points clamped to the same end tie and keep data order. For values that
 * are all at or above 0 on an unlocked range this is the |value| order it
 * was. Missing values stay at the bottom.
 */

/** Diverging maps (neutral middle or two hues): strong on top stays |value|. */
export const DIVERGING_SCALES = Object.freeze(new Set(['RdBu', 'Picnic', 'Bluered']));

/**
 * The near-white end of the sequential maps that have one ('low' or 'high'
 * as Plotly 2.20 draws them, before Reverse): every channel of the end
 * colour at 200/255 or more. Viridis' and Cividis' yellow, Blackbody's pale
 * blue and the rainbow maps' ends are not near-white.
 */
export const PALE_END = Object.freeze({
    Greys: 'high', YlGnBu: 'high', Greens: 'high', YlOrRd: 'high', Reds: 'low', Blues: 'high',
    Hot: 'high', Earth: 'high', Electric: 'high'
});

/**
 * The sort key of strong on top: points are drawn in ascending key order.
 * @param {Object} o
 * @param {string} o.scale - the colour map's name
 * @param {boolean} [o.reversed]
 * @param {boolean} [o.centred] - Center at 0
 * @param {number} o.min - the drawn range (cmin, in drawn units)
 * @param {number} o.max
 * @returns {(v: number) => number} -Infinity for a missing value
 */
export function strongOnTopKey({ scale, reversed = false, centred = false, min, max }) {
    const finite = (v) => typeof v === 'number' && Number.isFinite(v);
    if (centred || DIVERGING_SCALES.has(scale) || !(finite(min) && finite(max) && max > min)) {
        return (v) => (finite(v) ? Math.abs(v) : -Infinity);
    }
    const pale = PALE_END[scale];
    const paleHigh = pale ? (pale === 'high') !== !!reversed : false;
    const span = max - min;
    return (v) => {
        if (!finite(v)) return -Infinity;
        const p = v <= min ? 0 : v >= max ? 1 : (v - min) / span;
        return paleHigh ? 1 - p : p;
    };
}
