/**
 * Hand one update to every panel so that each succeeds or fails on its own.
 *
 * Issue #2: after a dataset switch, an error in one panel (a field the new
 * dataset lacks) left every later panel showing the previous dataset. Here
 * every panel's onDataUpdate is STARTED before any is awaited, a synchronous
 * throw or a rejection is caught per panel, and the returned promise waits
 * for all of them. One panel's failure is its own; it cannot stop, delay or
 * reject another's update.
 *
 * @param {Iterable<Object>} panels - Panels with an optional onDataUpdate
 * @param {string} updateType - e.g. 'datasetChanged'
 * @param {Object} updateData - Passed to every panel
 * @param {Function} [report] - (panel, error) for a non-abort failure
 * @returns {Promise<Array<{id: string|undefined, ok: boolean, error?: *}>>}
 *     One outcome per panel that takes updates, in panel order
 */
export function notifyEach(panels, updateType, updateData, report = defaultReport) {
    const outcomes = [];
    for (const panel of panels) {
        if (!panel || typeof panel.onDataUpdate !== 'function') continue;
        const id = typeof panel.getId === 'function' ? panel.getId() : undefined;
        let result;
        try {
            result = panel.onDataUpdate(updateType, updateData);
        } catch (error) {
            result = Promise.reject(error);
        }
        outcomes.push(Promise.resolve(result).then(
            () => ({ id, ok: true }),
            (error) => {
                if (!error || error.name !== 'AbortError') report(panel, error);
                return { id, ok: false, error };
            }));
    }
    return Promise.all(outcomes);
}

function defaultReport(panel, error) {
    const id = typeof panel.getId === 'function' ? panel.getId() : '?';
    console.error(`Error updating panel ${id}:`, error);
}
