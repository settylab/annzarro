/* global document -- stubbed on globalThis below */
/**
 * Table panels must not accumulate event listeners across refreshes.
 *
 * Both table panels call `setupTableEventListeners` after EVERY refresh and
 * call the returned cleanup first. The cleanup only removed a jQuery
 * SearchBuilder handler, so each refresh stacked another full set of
 * document-level listeners: after N refreshes one 'refreshTable' event ran N
 * refreshes (each of which added yet more), and one focus change ran N table
 * reloads against N stale DataTables.
 *
 * `setupColumnSelectionEvents` had the same shape on the panel's option
 * controls (export, length, toggles), re-run on every focus change.
 *
 * Run:  node --test annzarro/tests/js/table-listeners.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

class El extends EventTarget {
    constructor(id) { super(); this.id = id; this.checked = false; this.value = ''; }
    closest() { return panel; }
    querySelectorAll() { return []; }
}
const panel = new El('panel');
const elements = new Map();
const el = (id) => { if (!elements.has(id)) elements.set(id, new El(id)); return elements.get(id); };

const doc = new EventTarget();
// The apply button is replaced by a clone each time; nothing to count there.
doc.getElementById = (id) => (id.startsWith('apply-columns-') ? null : el(id));
doc.createElement = () => new El('x');
globalThis.document = doc;
globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.CustomEvent = class extends Event {
    constructor(type, init = {}) { super(type); this.detail = init.detail; }
};

const { setupTableEventListeners } = await import('../../../static/js/panels/table-utilities/listeners.js');
const { setupColumnSelectionEvents } = await import('../../../static/js/panels/table-utilities/table-ui-make.js');

for (const entityType of ['cells', 'genes']) {
    test(`${entityType} table: N refreshes leave ONE set of document listeners`, () => {
        let refreshes = 0;
        let cleanup = null;
        // What the panel's _setupEventListeners does after each refresh.
        for (let i = 0; i < 5; i++) {
            if (cleanup) cleanup();
            cleanup = setupTableEventListeners({
                id: 'p1', settings: {}, tableContainer: null, dataTable: null,
                entityType, title: 't', refreshTable: () => { refreshes++; }
            });
        }
        document.dispatchEvent(new CustomEvent('refreshTable', { detail: { id: 'p1' } }));
        assert.equal(refreshes, 1);

        // And destroy() removes the last set too.
        cleanup();
        document.dispatchEvent(new CustomEvent('refreshTable', { detail: { id: 'p1' } }));
        assert.equal(refreshes, 1);
    });
}

test('re-running setupColumnSelectionEvents leaves one listener per control', () => {
    let exports = 0;
    const onExport = () => { exports++; };
    document.addEventListener('exportTableToCsv', onExport);
    for (let i = 0; i < 4; i++) setupColumnSelectionEvents('p2', {}, 'cells');
    el('export-csv-p2').dispatchEvent(new Event('click'));
    document.removeEventListener('exportTableToCsv', onExport);
    assert.equal(exports, 1);
});
