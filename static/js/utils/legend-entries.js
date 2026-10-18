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

/**
 * Categories hidden with the legend, kept by what they are, not by where
 * their trace is.
 *
 * A legend click sets `visible: 'legendonly'` on the traces of a legend
 * group. Plotly keeps that across a `react` by trace `uid`, and by trace
 * index where there is none; the traces had none (each category is a point
 * trace and a legend proxy of the same name, so `name` was not unique), so
 * the hidden flag stayed at its index. Greying out the cells not in a linked
 * table puts the 'Not in table' trace first, and a filter that empties a
 * category drops its trace: every later trace moved by one, and the hidden
 * flag, with the points it hides, went to the next category. A category
 * whose trace left the figure lost its flag for good: it came back shown.
 *
 * So every drawn figure goes through `withLegendState(gd, traces, layout)`
 * (panel-surface.js drawPlot, plotly-batch.js), which
 *  1. reads what the legend hides on the figure shown (`rememberLegendHidden`,
 *     also called before a graph is released), by legend key, into a record
 *     on the graph that also keeps the keys of categories not drawn now;
 *  2. hides every trace of the new figure whose legend key is in the record,
 *     and shows the others;
 *  3. gives each trace a `uid` from its role and legend key, so Plotly's own
 *     uirevision bookkeeping follows the same identity.
 * The record holds for one `legend.uirevision` (the dataset and colour
 * column, plot-make.js buildPlotLayout): another colour column starts with
 * nothing hidden.
 */
const HIDDEN = '__legendHidden';

/**
 * The identity of a trace's legend entry: the legend group it stands for (a legend in columns moves its
 * entries to groups of their own and keeps the category's in `azKey`, legend-options.js), else its name
 * (null without one).
 */
export function legendKey(trace) {
    if (!trace) return null;
    if (typeof trace.azKey === 'string' && trace.azKey !== '') return trace.azKey;
    if (typeof trace.legendgroup === 'string' && trace.legendgroup !== '') return trace.legendgroup;
    return isRealName(trace.name) ? trace.name : null;
}

/** The revision the legend's hidden entries belong to: `legend.uirevision`, else the layout's. */
function legendRevision(layout) {
    if (!layout) return null;
    const own = layout.legend && layout.legend.uirevision;
    if (own !== undefined && own !== null) return own;
    return layout.uirevision === undefined ? null : layout.uirevision;
}

/** True for a trace that has an entry in the legend, shown or hidden. */
function hasEntry(trace) {
    return !!trace && trace.showlegend !== false && trace.visible !== false && isRealName(trace.name);
}

/** The legend keys of `traces` whose legend entry is hidden ('legendonly'). */
export function hiddenLegendKeys(traces) {
    const out = new Set();
    for (const t of Array.isArray(traces) ? traces : []) {
        if (hasEntry(t) && t.visible === 'legendonly') out.add(legendKey(t));
    }
    return out;
}

/**
 * The record of what the legend hides, brought up to date with `traces`
 * (the figure shown): an entry drawn there is hidden exactly when it is
 * hidden there; keys not drawn there keep what the record says.
 * Pure: returns the new record.
 * @param {{revision: *, hidden: Set<string>}|undefined} record
 * @param {Array<Object>} traces
 * @param {*} revision
 */
export function syncHidden(record, traces, revision) {
    const hidden = record && record.revision === revision ? new Set(record.hidden) : new Set();
    for (const t of Array.isArray(traces) ? traces : []) {
        if (hasEntry(t)) hidden.delete(legendKey(t));
    }
    for (const k of hiddenLegendKeys(traces)) hidden.add(k);
    return { revision, hidden };
}

/**
 * Hide the traces of `traces` whose legend key is in `hidden`, and show the
 * other traces that belong to a legend entry. Traces outside the legend (the
 * greyed-out points, the focus highlight, a colour bar's point) are left as
 * they are. Edits `traces` in place.
 */
export function applyHidden(traces, hidden) {
    for (const t of Array.isArray(traces) ? traces : []) {
        if (!t || t.visible === false) continue;
        const grouped = (typeof t.legendgroup === 'string' && t.legendgroup !== '') || hasEntry(t);
        if (!grouped) continue;
        if (hidden.has(legendKey(t))) t.visible = 'legendonly';
        else if (t.visible === 'legendonly') delete t.visible;
    }
    return traces;
}

/** Read what the legend of `gd` hides into its record (before a redraw or a release). */
export function rememberLegendHidden(gd) {
    if (!gd || !Array.isArray(gd.data)) return;
    const shown = gd[HIDDEN];
    gd[HIDDEN] = syncHidden(shown, gd.data, shown ? shown.revision : legendRevision(gd.layout));
}

/**
 * A trace uid that is a valid CSS id fragment. Plotly puts the uid into
 * element ids it later queries as CSS selectors (a colour bar's
 * '#...-cb<uid>'), so it is spelled with [A-Za-z0-9_-] only: "t:total_counts"
 * made the next draw throw 'not a valid selector'. Other characters are
 * written as _<hex>_, which keeps uids distinct.
 */
export function traceUid(name) {
    return 't-' + Array.from(name).map(c => (/[A-Za-z0-9-]/.test(c) ? c : `_${c.codePointAt(0).toString(16)}_`)).join('');
}

/**
 * A `uid` on every trace from what it is: its role (`meta`, e.g. a legend
 * proxy) and its legend key or name, with a count for the second trace of
 * the same identity (a large plot's chunks). A trace of one name keeps the
 * uid of its name. A uid set elsewhere (not 't-...') is kept. Edits in place.
 */
export function assignTraceUids(traces) {
    const seen = new Map();
    for (const t of Array.isArray(traces) ? traces : []) {
        if (!t || (typeof t.uid === 'string' && t.uid !== '' && !t.uid.startsWith('t-'))) continue;
        const key = legendKey(t) || (typeof t.name === 'string' && t.name) || 'trace';
        const id = (typeof t.meta === 'string' && t.meta ? `${t.meta}/` : '') + key;
        const n = seen.get(id) || 0;
        seen.set(id, n + 1);
        t.uid = traceUid(n ? `${id}#${n}` : id);
    }
    return traces;
}

/**
 * The legend state of the figure about to be drawn into `gd`: the hidden
 * entries of the figure shown carried over by legend key, and a uid on
 * every trace. Edits `traces` in place.
 * @param {HTMLElement} gd
 * @param {Array<Object>} traces
 * @param {Object} layout
 */
export function withLegendState(gd, traces, layout) {
    if (!gd) return traces;
    rememberLegendHidden(gd);
    const revision = legendRevision(layout);
    const shown = gd[HIDDEN];
    const record = shown && shown.revision === revision ? shown : { revision, hidden: new Set() };
    gd[HIDDEN] = record;
    applyHidden(traces, record.hidden);
    return assignTraceUids(traces);
}

/** The value of `legend.uirevision` for a plot of `dataset` coloured by `colour`. */
export function legendUirevision(dataset, colour) {
    const c = colour || {};
    return JSON.stringify([dataset || '', c.type || '', c.key || '', c.column || '']);
}
