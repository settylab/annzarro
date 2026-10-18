/**
 * A legend below the plot sits below the x-axis tick labels and title.
 *
 * Plotly places a legend as a fraction of the plot's height from the axes'
 * bottom edge, but the tick labels and the axis title below the axes take a
 * fixed number of pixels, so no fraction clears them at every panel height:
 * -15% of a short plot is less than the labels and the title, and the legend
 * lands on them. This turns the pixel offset of the axis text's bottom into the
 * fraction for the plot as drawn, after every Plotly draw (`plotly_afterplot`,
 * which a resize also ends in). The offset comes from where Plotly drew the
 * x-axis title; without one, from a fixed estimate. The legend's own height is
 * room Plotly's automargin makes below it.
 *
 * Plotly 2.20 has no `legend.yref: 'container'` (the schema lists it for
 * another object), hence the px-to-fraction step.
 *
 * `isBelowLegend` and `belowLegendY` are pure;
 * annzarro/tests/js/legend-below.test.mjs runs them in Node.
 */

/** Room (px) the x-axis tick labels and title take when none is measurable, and the gap left under them. */
export const AXIS_TEXT_ESTIMATE = 60;
export const GAP = 8;

/** Whether a layout's legend is the horizontal one hanging below the axes (a bottom legend). */
export function isBelowLegend(layout) {
    const lg = layout && layout.legend;
    return !!lg && lg.orientation === 'h' && lg.yanchor === 'top' && typeof lg.y === 'number' && lg.y <= 0.5;
}

/** The `legend.y` (paper fraction, negative) that puts the legend's top `offsetPx` below the axes of a plot `plotH` px high. */
export function belowLegendY(offsetPx, plotH) {
    if (!Number.isFinite(offsetPx) || !Number.isFinite(plotH) || plotH <= 0) return null;
    return Math.round((-offsetPx / plotH) * 10000) / 10000;
}

/** Px from the axes' bottom edge to the bottom of what is drawn under them (the x-axis title, else an estimate). */
function axisTextDepth(gd, size) {
    const title = gd.querySelector && gd.querySelector('.g-xtitle');
    if (title && title.getBoundingClientRect) {
        const g = gd.getBoundingClientRect(), t = title.getBoundingClientRect();
        const depth = t.bottom - g.top - (size.t + size.h);
        if (Number.isFinite(depth) && depth > 0) return depth;
    }
    return AXIS_TEXT_ESTIMATE;
}

let _setting = new WeakSet();

/** Put a bottom legend below the axis text, as drawn. Relayouts only when the fraction changes. */
export function syncBelowLegend(gd) {
    const L = gd && gd._fullLayout;
    if (!L || !L._size || !isBelowLegend(gd.layout) || _setting.has(gd) || typeof Plotly === 'undefined') return;
    const want = belowLegendY(axisTextDepth(gd, L._size) + GAP, L._size.h);
    if (want === null || Math.abs(want - gd.layout.legend.y) < 0.002) return;
    _setting.add(gd);
    Promise.resolve(Plotly.relayout(gd, { 'legend.y': want })).catch(() => {}).finally(() => _setting.delete(gd));
}

/** Per graph, its redraw listener (Plotly.purge drops listeners, so each draw sets it afresh). */
const _listeners = new WeakMap();

/** Place a bottom legend now and after every redraw of the graph. */
export function watchBelowLegend(gd) {
    if (!gd) return;
    syncBelowLegend(gd);
    if (typeof gd.on !== 'function') return;
    let fn = _listeners.get(gd);
    if (fn && typeof gd.removeListener === 'function') gd.removeListener('plotly_afterplot', fn);
    fn = () => syncBelowLegend(gd);
    _listeners.set(gd, fn);
    gd.on('plotly_afterplot', fn);
}
