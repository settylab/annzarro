/**
 * One abort signal per load of a panel.
 *
 * Every load a panel starts (a full plot load, a recolour, an axis refocus, a
 * table load) takes its signal from `beginLoad`, which aborts the loads it
 * makes stale, so the old requests stop and the old result never reaches the
 * panel. The loading overlay's Cancel button calls `cancelLoads`.
 *
 * A panel is keyed by the element its loads draw into (the plot container,
 * the table container). A full load (`'plot'`, `'table'`) supersedes every
 * other load of the panel; a partial one (`'colour'`, `'axis:x'`) only an
 * earlier load of its own kind, so a recolour does not drop an axis change
 * that is still arriving.
 */

const _loads = new WeakMap();        // host -> Map(kind -> AbortController)
const _cancelled = new WeakSet();    // signals aborted by the Cancel button

const FULL = new Set(['plot', 'table']);

function _abortError(why) {
    return new DOMException(why, 'AbortError');
}

/**
 * Start a load of `host`. Aborts the loads it supersedes.
 * @param {object} host - the panel's plot or table container
 * @param {string} [kind] - 'plot' / 'table' (full), or a partial kind
 * @param {AbortSignal|null} [external] - a signal that also ends this load
 *    (the batch signal of PanelManager.notifyPanels)
 * @returns {AbortSignal}
 */
export function beginLoad(host, kind = 'plot', external = null) {
    let loads = _loads.get(host);
    if (!loads) _loads.set(host, loads = new Map());
    for (const [k, controller] of [...loads]) {
        if (FULL.has(kind) || k === kind) {
            loads.delete(k);
            controller.abort(_abortError('Superseded by a newer load'));
        }
    }
    const controller = new AbortController();
    loads.set(kind, controller);
    if (external) {
        if (external.aborted) controller.abort(_abortError('Update aborted'));
        else external.addEventListener('abort', () => controller.abort(_abortError('Update aborted')), { once: true });
    }
    return controller.signal;
}

/** The load `signal` belongs to has ended: forget it unless a newer one replaced it. */
export function endLoad(host, signal) {
    const loads = _loads.get(host);
    if (!loads) return;
    for (const [k, controller] of loads) {
        if (controller.signal === signal) loads.delete(k);
    }
    if (!loads.size) _loads.delete(host);
}

/** Whether a load of `host` is running. */
export function hasLoads(host) {
    const loads = _loads.get(host);
    return !!(loads && loads.size);
}

/**
 * Abort every load of `host`. `byUser`: the Cancel button, so the panel says
 * the loading was cancelled; otherwise (the panel closes) it says nothing.
 * @returns {boolean} whether a load was running
 */
export function cancelLoads(host, byUser = false) {
    const loads = _loads.get(host);
    if (!loads || !loads.size) return false;
    _loads.delete(host);
    for (const controller of loads.values()) {
        if (byUser) _cancelled.add(controller.signal);
        controller.abort(_abortError(byUser ? 'Loading cancelled' : 'Panel closed'));
    }
    return true;
}

/** Whether `signal` was aborted by the Cancel button (not by a newer load). */
export function wasCancelled(signal) {
    return !!signal && _cancelled.has(signal);
}
