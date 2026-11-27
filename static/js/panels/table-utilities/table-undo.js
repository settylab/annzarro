/**
 * Undo for the Cell Table and the Gene Table, on the shared helper (ui/panel-undo.js).
 *
 * A table's saved state is its settings: the columns, the filter (SearchBuilder's conditions), the search and its three
 * toggles, the page length, and a panel's own fields (a Cell Table's `methods`, a Gene Table's `scoreOptions`). The panel has
 * many ways to change them (the column chooser, a header, a filter row, a box), none of which says so, so the table does
 * not wrap them: any click, key, input or change inside the panel's tile starts a short timer, and when it ends the settings
 * are compared with the ones last known (`observe`). A difference is one step, labelled by what differs.
 *
 * What is NOT a step: the scroll position, the page shown, a column's sort order (the sort is the DataTable's own, and is
 * in no saved view), the rows (derived), the controls being shown or hidden, the title, and a change another panel makes
 * (a line drawn on a plot, a panel set's remap), which is `rebase`d: the steps are forgotten and the settings as they are
 * now are the start, so Undo never goes back to a state unrelated to what is on screen.
 *
 * Undo gives the settings before to the panel's own `restore` (the table is released, the settings assigned, the table built
 * again from them), the path a link takes.
 */
import { createPanelUndo, labelByKeys } from '../../ui/panel-undo.js';

/** Settings that are derived, transient or the panel's identity: no part of a step. */
const NOT_STATE = new Set(['currentEntries', 'closedSelection', 'filteredCells', 'controlsVisible', 'title', 'id', 'isSelectionTile']);

/** What a key of the settings is called in an Undo label. */
// export-unused-ok: read by the Node tests of the labels
export const TABLE_STEP_NAMES = Object.freeze({
    columns: 'change the columns',
    searchBuilderConfig: 'change the filter',
    searchText: 'search',
    searchRegex: 'search',
    searchSmart: 'search',
    searchCaseInsensitive: 'search',
    pageLength: 'change the rows per page',
    methods: 'change the methods',
    scoreOptions: 'change the score methods'
});

/**
 * A table's settings as a plain config: every saved field, the live views of the DataTable read as values, nothing derived.
 * @param {Object} settings - the panel's settings
 * @param {Object} [extra] - fields kept apart from the settings (a Cell Table's `methods`)
 * @returns {Object}
 */
// export-unused-ok: read by the Node tests of what a step holds
export function tableSnapshot(settings, extra = {}) {
    const out = {};
    for (const key of Object.keys(settings)) {
        if (NOT_STATE.has(key)) continue;
        let value;
        try { value = settings[key]; } catch { continue; }
        if (value === undefined || typeof value === 'function') continue;
        out[key] = value;
    }
    for (const [key, value] of Object.entries(extra)) if (value !== undefined) out[key] = value;
    return JSON.parse(JSON.stringify(out));
}

/**
 * Put a config's fields into the settings, and take out the fields the config lacks (a field that was not set when the
 * config was taken: the rows per page before the user chose one). The live views of the DataTable and the derived fields stay.
 * @param {Object} settings
 * @param {Object} config
 * @param {string[]} [apart] - fields the caller gives itself
 */
export function giveBack(settings, config, apart = []) {
    for (const key of Object.keys(settings)) {
        if (NOT_STATE.has(key) || apart.includes(key) || key in config) continue;
        const desc = Object.getOwnPropertyDescriptor(settings, key);
        if (desc && desc.get && !desc.set) continue;
        delete settings[key];
    }
    for (const [key, value] of Object.entries(config)) {
        if (NOT_STATE.has(key) || apart.includes(key)) continue;
        const desc = Object.getOwnPropertyDescriptor(settings, key);
        if (desc && desc.get && !desc.set) continue;
        settings[key] = value;
    }
}

/** Whether a config handed to updateConfig changes something a table keeps (not just its title or its controls shown). */
export function changesTableState(config) {
    return !!config && Object.keys(config).some((key) => !NOT_STATE.has(key));
}

/**
 * The Undo of one table panel.
 * @param {Object} opts
 * @param {HTMLElement} opts.root - the panel's tile content: events inside it may be the user's changes
 * @param {() => Object} opts.settings - the panel's settings
 * @param {() => Object} [opts.extra] - the saved fields kept apart from the settings
 * @param {(config: Object) => Promise<void>} opts.restore - give a config back to the panel and build the table from it
 * @param {() => boolean} [opts.busy] - the table is being built: what its settings do meanwhile is not the user's
 * @param {number} [opts.settleMs] - how long after the last event the settings are compared
 * @returns {Object} the helper (createPanelUndo's), with `dispose()` that stops listening
 */
export function createTableUndo({ root, settings, extra = () => ({}), restore, busy = () => false, settleMs = 250 }) {
    const undo = createPanelUndo({
        snapshot: () => tableSnapshot(settings(), extra()),
        restore,
        label: (before, after) => labelByKeys(before, after, TABLE_STEP_NAMES)
    });
    let timer = null;
    const events = ['click', 'keyup', 'input', 'change', 'pointerup'];
    const onEvent = (event) => {
        if (!root.isConnected || !root.contains(event.target)) return;
        clearTimeout(timer);
        timer = setTimeout(() => { if (!busy() && !undo.restoring) undo.observe(); }, settleMs);
    };
    for (const type of events) document.addEventListener(type, onEvent, true);
    // the DataTable says its own changes (a filter set through its API, a search, a redraw) on its table, as jQuery events
    const jq = typeof globalThis.$ === 'function' ? globalThis.$ : null;
    const dtEvents = 'draw.dt.azUndo searchBuilder.dtsb.azUndo search.dt.azUndo';
    if (jq) jq(root).on(dtEvents, onEvent);
    return Object.assign(undo, {
        dispose() {
            clearTimeout(timer);
            for (const type of events) document.removeEventListener(type, onEvent, true);
            if (jq) jq(root).off('.azUndo');
            undo.destroy();
        }
    });
}
