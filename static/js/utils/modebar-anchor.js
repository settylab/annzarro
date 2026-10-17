/**
 * Where Plotly's toolbar (camera, zoom, pan, reset) sits: the top right corner
 * of the plotting area (the axes in 2D, the scene in 3D), not of the figure.
 *
 * Plotly draws it at the figure's top right, which is where a legend or colour
 * bar placed on the right runs into it. The plotting area never holds a
 * legend or colour bar, wherever they are placed (right, left, top, bottom),
 * so anchoring the toolbar to its corner clears all four.
 *
 * Plotly has no option for it. Its toolbar container is an absolutely
 * positioned div (`top: 0; right: 0`, written when Plotly builds the figure's
 * frame), so this sets that container's `top` and its width (a box from the
 * figure's left edge to the plot area's right edge, which the toolbar hangs
 * from by its right edge) from the drawn layout after every Plotly draw (`plotly_afterplot`, which a resize, a
 * legend move and a colour bar change all end in). `_fullLayout._size` is
 * Plotly's own record of the plot area and has no public equivalent; when it
 * is missing the container is left as Plotly drew it. Measured from the left,
 * the toolbar stays with the plot while a panel is being dragged and the graph
 * is resized before Plotly has redrawn it, rather than sliding off the plot's
 * edge with the figure's.
 *
 * `modebarAnchor` is pure; annzarro/tests/js/modebar-anchor.test.mjs runs it in Node.
 */

/**
 * Where the toolbar sits against the top edge of the plot area. 'inside': in the
 * corner, over the axes (it can cover data in a small panel). 'above': just above
 * the axes, in the top margin, right-aligned to the axes' right edge (it is held
 * at the figure's top when the margin is thinner than the toolbar). One word to switch.
 * @type {'inside'|'above'}
 */
export const TOOLBAR_VERTICAL = 'inside';

/** The toolbar's height (px): one row of 22 px buttons and Plotly's 2 px inset, with a pixel to spare. */
export const TOOLBAR_HEIGHT = 27;

/**
 * The toolbar container's top offset and width: it spans from the figure's left edge to the plot area's right edge, so its top right corner is the plot area's.
 * @param {Object} fullLayout  gd._fullLayout
 * @param {'inside'|'above'} [vertical]  see TOOLBAR_VERTICAL
 * @returns {{top: number, width: number}|null}  null when the layout has no plot area yet
 */
export function modebarAnchor(fullLayout, vertical = TOOLBAR_VERTICAL) {
    const L = fullLayout;
    const s = L && L._size;
    if (!s || ![s.l, s.t, s.w, s.h].every(Number.isFinite)) return null;
    let right = s.l + s.w, top = s.t;
    const d = L.scene && L.scene.domain;
    if (d && Array.isArray(d.x) && Array.isArray(d.y) && [d.x[1], d.y[1]].every(Number.isFinite)) {
        right = s.l + d.x[1] * s.w;
        top = s.t + (1 - d.y[1]) * s.h;
    }
    if (vertical === 'above') top -= TOOLBAR_HEIGHT;
    return { top: Math.max(0, Math.round(top)), width: Math.max(0, Math.round(right)) };
}

/** Put the graph's toolbar container at its plot area's top right corner. */
export function syncModebarAnchor(gd) {
    const box = gd && gd.querySelector && gd.querySelector('.modebar-container');
    if (!box || !box.style) return;
    const a = modebarAnchor(gd._fullLayout);
    if (!a) return;
    box.style.top = `${a.top}px`;
    box.style.left = '0px';
    box.style.right = 'auto';
    box.style.width = `${a.width}px`;
}

/** Per graph, its redraw listener (Plotly.purge drops listeners, so each draw sets it afresh). */
const _listeners = new WeakMap();

/** Anchor the toolbar now and after every redraw of the graph. */
export function watchModebarAnchor(gd) {
    if (!gd) return;
    syncModebarAnchor(gd);
    if (typeof gd.on !== 'function') return;
    let fn = _listeners.get(gd);
    if (fn && typeof gd.removeListener === 'function') gd.removeListener('plotly_afterplot', fn);
    fn = () => syncModebarAnchor(gd);
    _listeners.set(gd, fn);
    gd.on('plotly_afterplot', fn);
}
