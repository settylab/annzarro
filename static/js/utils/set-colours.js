/**
 * The colour of each set of a count plot's Venn and UpSet: the one place that decides, read by the set list's swatches
 * (panels/cell-count/sets.js), the SetPlot (utils/set-plot-model.js) and the figure (panels/cell-count/draw-sets.js).
 *
 * Pure and with no import beyond the palettes, so the drawing module stays free of the app's state: draw-sets.js is
 * drawn in a page with no server (tests/browser/test_draw_sets_export.py), and importing set-plot-model.js there brought
 * in the server configuration's loader.
 */
import { groupColours } from '../panels/plot-utilities/colors.js';
import { isColourString } from './uns-palette.js';

/** Okabe and Ito: the first colours of the sets, which tell apart under the common colour-vision differences. */
const SET_COLOURS = Object.freeze(['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#F0E442', '#000000']);

/** The default colour of the set at `index`: Okabe and Ito, then the group colours (plot-utilities/colors.js). */
export function defaultSetColour(index) {
    return index < SET_COLOURS.length ? SET_COLOURS[index] : groupColours(index + 1)[index];
}

/**
 * The colour of each set: the one the user picked (`set.color`, stored only then), else the default of its position.
 * @param {{color?: string}[]} sets
 * @returns {string[]}
 */
export function setColours(sets) {
    return sets.map((set, i) => (set && typeof set.color === 'string' && isColourString(set.color) ? set.color.trim() : defaultSetColour(i)));
}
