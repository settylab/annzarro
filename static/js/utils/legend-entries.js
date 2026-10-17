/**
 * Which traces of a figure are legend entries, and the legend that follows from them.
 *
 * Plotly names a trace without a name "trace <index>" and gives it a legend
 * entry unless its `showlegend` is false. A plot coloured by nothing (no
 * colour, or a colour column the dataset does not have) is one grey trace
 * without a name: after a dataset switch and an axis change its legend read
 * "trace 0", because an update turned the legend on for every trace without
 * a colour scale. A redraw did not, so the entry came and went.
 *
 * A legend entry is a trace drawn with a name and without `showlegend: false`;
 * the builders decide which traces those are, and the legend switch only
 * shows or hides the legend. `withLegendInvariant` is applied where a figure
 * is handed to Plotly (panel-surface.js drawPlot, plotly-batch.js): a trace
 * without a name gets no entry, and a figure with no entry has no legend.
 */

const DEFAULT_NAME = /^trace \d+$/;

/** True for a name a legend can show: a non-empty string that is not Plotly's default. */
export function isRealName(name) {
    return typeof name === 'string' && name !== '' && !DEFAULT_NAME.test(name);
}

/** True when `trace` has an entry in the legend. */
export function isLegendEntry(trace) {
    return !!trace && trace.showlegend !== false && trace.visible !== false && isRealName(trace.name);
}

/** True when any of `traces` has an entry in the legend. */
export function hasLegendEntries(traces) {
    return Array.isArray(traces) && traces.some(isLegendEntry);
}

/**
 * The figure as it is drawn: a trace without a name and not hidden from the
 * legend is hidden from it (with a console warning: the trace's builder
 * should have said so), and `layout.showlegend` is false when no entry is
 * left. A legend with entries keeps the `showlegend` the layout has.
 * Edits `traces` and `layout` in place.
 * @param {Array<Object>} traces
 * @param {Object} layout
 * @returns {{traces: Array<Object>, layout: Object}}
 */
export function withLegendInvariant(traces, layout) {
    const list = Array.isArray(traces) ? traces : [];
    const unnamed = [];
    list.forEach((t, i) => {
        if (t && t.showlegend !== false && !isRealName(t.name)) {
            t.showlegend = false;
            unnamed.push(i);
        }
    });
    if (unnamed.length) {
        console.warn(`Legend: trace ${unnamed.join(', ')} has no name; drawn without a legend entry`);
    }
    if (layout && !hasLegendEntries(list)) layout.showlegend = false;
    return { traces, layout };
}
