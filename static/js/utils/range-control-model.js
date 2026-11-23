/**
 * The arithmetic of a min/max range control (the Cell Plot's colour range, now every plot's): which scale a slider
 * moves over, the value at a track position, the track position of a value. Pure, no DOM, so Node tests hold it and
 * the Cell Plot (plot-utilities/panel-ui-update.js, jQuery) and the Cell-Gene and Count Plots' pop-overs
 * (ui/range-control.js) read one rule.
 *
 * A track moves in quantile space (slider-scales.js): position p is the p-quantile of the drawn values, so a skewed
 * statistic keeps its useful range under the thumb. Only the track is rescaled; the stored value is the real one.
 */
import { SLIDER_STEPS, quantileScale, mirroredScale, trackValue, valueAt } from './slider-scales.js';

/**
 * The scales of a range's min and max sliders, or null when no value is finite. Both move in quantile space; centred
 * at 0 they move over |value|, the min thumb mirrored, so min = -max position for position.
 * @param {ArrayLike<number>} values - the drawn statistic
 * @param {boolean} [centered] - the range is symmetric about 0
 * @returns {{min: Object, max: Object}|null}
 */
export function rangeScales(values, centered = false) {
    if (!centered) {
        const scale = quantileScale(values);
        return scale && { min: scale, max: scale };
    }
    const abs = quantileScale(values, { transform: Math.abs });
    return abs && { min: mirroredScale(abs), max: abs };
}

/** The value a slider shows at track value `track`: through its scale, else the track value itself. */
export function sliderValue(scale, track) {
    return scale ? valueAt(scale, track) : parseFloat(track);
}

/** The track value (0..SLIDER_STEPS) that shows `value`; outside the data it pins to an end. `side` is 'low' or 'high'. */
export function sliderTrack(scale, value, side) {
    return scale ? trackValue(scale, value, side) : value;
}

/** The data's own ends under a scale: what an automatic min and max are. Null with no scale. */
export function rangeEnds(scale) {
    return scale ? { min: scale.min, max: scale.max } : null;
}

/** The track value of an automatic end: the left end for a min, the right end for a max. */
export function autoTrack(side) {
    return side === 'high' ? SLIDER_STEPS : 0;
}
