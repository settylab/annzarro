/**
 * The colours a dataset stores for a categorical column (`uns["<key>_colors"]`).
 *
 * Scanpy takes them only when there are at least as many as categories, and
 * generates a palette otherwise. Repeating a short list instead gives
 * different categories one colour, silently. This module is pure so that
 * every path (regular, update, large plot) applies the same rule.
 */

const COLOUR = /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|hsl)a?\([^)]*\)|[a-z]+)$/i;

/** True for a string Plotly can draw as a colour: hex, rgb()/hsl(), or a CSS name. */
export function isColourString(s) {
    return typeof s === 'string' && COLOUR.test(s.trim());
}

/**
 * The stored colours to draw `nCategories` categories with, or null when
 * they do not fit: not an array, fewer colours than categories, or an
 * invalid entry among the ones that would be used. Extra colours are fine.
 * @param {*} colours - the value of uns.<key>_colors
 * @param {number} nCategories
 * @returns {string[]|null}
 */
export function usableUnsPalette(colours, nCategories) {
    if (!Array.isArray(colours) || colours.length < nCategories || !(nCategories > 0)) return null;
    const used = colours.slice(0, nCategories);
    return used.every(isColourString) ? colours.slice() : null;
}

/**
 * The line that says the stored colours were not used, or null when there
 * are none stored or they fit.
 * @param {string} key - the column, without `_colors`
 * @param {*} colours
 * @param {number} nCategories
 * @returns {string|null}
 */
export function unsPaletteNote(key, colours, nCategories) {
    if (!Array.isArray(colours) || !colours.length) return null;
    if (usableUnsPalette(colours, nCategories)) return null;
    const n = colours.length;
    return n < nCategories
        ? `Colours in uns.${key}_colors (${n}) don't match the categories (${nCategories}); using the default palette`
        : `Colours in uns.${key}_colors are not all valid; using the default palette`;
}

/** The status tag for that line, or null. */
export function unsPaletteTag(key, colours, nCategories) {
    const text = unsPaletteNote(key, colours, nCategories);
    return text ? { text: 'Default colours: see why', title: text, severity: 'info', pop: { text } } : null;
}

export const UNS_PALETTE_TAG = 'uns-palette';
