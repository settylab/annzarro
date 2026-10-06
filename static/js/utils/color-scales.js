/**
 * Which way the sequential colour maps run, for the Map picker's labels.
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
