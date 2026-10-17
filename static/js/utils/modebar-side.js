/**
 * Which side of a plot Plotly's toolbar (camera, zoom, pan, reset) sits on.
 *
 * Plotly draws it top right, where a legend or colour bar placed on the right
 * runs into it once the legend is tall or the panel short. So it sits top
 * left, and moves to the top right only when a shown legend or colour bar is
 * placed on the left. A legend or bar above or below is centred and clears
 * both corners.
 *
 * The rule is read off the figure (what is drawn and where), not off the
 * panel settings, so every path that draws a figure or moves a legend gets it
 * without a call of its own: `watchModebarSide` re-reads it after each Plotly
 * redraw. Plotly has no option for the side; the class this sets is read by
 * the `.az-modebar-right` rules in styles.css.
 *
 * `modebarSide`, `figureSides` and `modebarSideOf` are pure;
 * annzarro/tests/js/modebar-side.test.mjs runs them in Node.
 */

/** The class on a graph whose toolbar sits top right (top left otherwise). */
export const MODEBAR_RIGHT_CLASS = 'az-modebar-right';

/** 'left', 'right' or 'centre' for a legend / colour bar at paper x. */
export function sideOfX(x) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return 'right';   // Plotly's own default: right of the plot
    if (x < 0.25) return 'left';
    return x > 0.75 ? 'right' : 'centre';
}

/**
 * The toolbar's side: 'left' unless something shown is on the left.
 * @param {string|null} legend  Side of the shown legend ('left'|'right'|'centre'), or null when none shows.
 * @param {string|null} colourbar  Likewise for the colour bar.
 * @returns {'left'|'right'}
 */
export function modebarSide(legend, colourbar) {
    return legend === 'left' || colourbar === 'left' ? 'right' : 'left';
}

/** The paper x of every colour bar a figure shows: a marker's, a trace's own, a shared coloraxis'. */
function barXs(data, layout) {
    const xs = [];
    for (const t of data || []) {
        if (!t || t.visible === false || t.visible === 'legendonly') continue;
        if (t.marker && t.marker.showscale && t.marker.colorbar) xs.push(t.marker.colorbar.x);
        else if (t.showscale && t.colorbar) xs.push(t.colorbar.x);
    }
    for (const [key, axis] of Object.entries(layout || {})) {
        if (/^coloraxis\d*$/.test(key) && axis && axis.showscale !== false && axis.colorbar) xs.push(axis.colorbar.x);
    }
    return xs;
}

/**
 * Where the legend and colour bar of a figure are.
 * @param {Array} data  Plotly traces
 * @param {Object} layout  Plotly layout
 * @returns {{legend: (string|null), colourbar: (string|null)}}
 */
export function figureSides(data, layout) {
    const L = layout || {};
    const entries = (data || []).some(t => t && t.showlegend !== false && t.visible !== false);
    const legend = L.showlegend && entries && L.legend ? sideOfX(L.legend.x) : null;
    const sides = barXs(data, L).map(sideOfX);
    const colourbar = sides.includes('left') ? 'left' : (sides[0] || null);
    return { legend, colourbar };
}

/** The toolbar's side for a figure. */
export function modebarSideOf(data, layout) {
    const { legend, colourbar } = figureSides(data, layout);
    return modebarSide(legend, colourbar);
}

/** Put the graph's toolbar on the side its drawn figure calls for. */
export function syncModebarSide(gd) {
    if (!gd || !gd.classList || typeof gd.classList.toggle !== 'function') return;
    const side = modebarSideOf(gd._fullData || gd.data, gd._fullLayout || gd.layout);
    gd.classList.toggle(MODEBAR_RIGHT_CLASS, side === 'right');
}

/** Per graph, its redraw listener (Plotly.purge drops listeners, so each draw sets it afresh). */
const _listeners = new WeakMap();

/** Re-read the side after every redraw of the graph (a legend moved, a colour bar shown), and now. */
export function watchModebarSide(gd) {
    if (!gd) return;
    syncModebarSide(gd);
    if (typeof gd.on !== 'function') return;
    let fn = _listeners.get(gd);
    if (fn && typeof gd.removeListener === 'function') gd.removeListener('plotly_afterplot', fn);
    fn = () => syncModebarSide(gd);
    _listeners.set(gd, fn);
    gd.on('plotly_afterplot', fn);
}
