/**
 * A closed table keeps what other panels read from it, and lets go of its
 * DataTable (freezeTableState in static/js/panels/table-utilities/table-data.js).
 *
 * A plot whose table filter is a table keeps showing the rows that passed it
 * after the table is closed (recorded on v030-preview before this change:
 * 100 of 200 cells, also after the plot redraws). Those rows came from a
 * getter over the destroyed DataTable, which kept the DataTable and all its
 * row data alive as long as the closed panel was kept for Reopen. Frozen,
 * the values are the same and nothing refers to the DataTable.
 *
 * Run:  node --test annzarro/tests/js/table-freeze.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    createElement: () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    getElementById: () => null, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}
};
globalThis.Plotly = new Proxy({}, { get: () => () => Promise.resolve() });
const chain = new Proxy(function () {}, {
    get: (_t, p) => (p === 'length' ? 0 : p === Symbol.iterator ? [][Symbol.iterator] : () => chain),
    apply: () => chain
});
globalThis.jQuery = () => chain;
globalThis.$ = globalThis.jQuery;

const { freezeTableState } = await import('../../../static/js/panels/table-utilities/table-data.js');
const { assignKnownSettings } = await import('../../../static/js/utils/panel-settings.js');

function liveTable() {
    let destroyed = false;
    const rows = [3, 1, 4];
    const settings = { columns: ['a'], pageLength: 25, currentEntries: [], searchBuilderConfig: {} };
    // what initializeDataTable defines: views of the live DataTable
    Object.defineProperty(settings, 'currentEntries', { configurable: true, enumerable: true,
        get: () => { if (destroyed) throw new Error('destroyed'); return rows.slice(); } });
    Object.defineProperty(settings, 'searchBuilderConfig', { configurable: true, enumerable: true,
        get: () => ({ criteria: [{ data: 'a', value: ['x'] }] }) });
    return { settings, destroy: () => { destroyed = true; } };
}

test('a closed table keeps its rows and filter as values, not through the DataTable', () => {
    const t = liveTable();
    freezeTableState(t.settings);
    t.destroy();
    assert.deepEqual(t.settings.currentEntries, [3, 1, 4]);
    assert.ok(Array.isArray(t.settings.currentEntries));   // plot-make checks Array.isArray
    assert.deepEqual(t.settings.searchBuilderConfig, { criteria: [{ data: 'a', value: ['x'] }] });
    for (const key of ['currentEntries', 'searchBuilderConfig']) {
        const d = Object.getOwnPropertyDescriptor(t.settings, key);
        assert.equal(d.get, undefined, `${key} is a value`);
        assert.equal(d.enumerable, true, `${key} is still saved with the panel`);
    }
    // what the panel set and Reopen read: the same keys and values
    assert.deepEqual(JSON.parse(JSON.stringify({ ...t.settings })).currentEntries, [3, 1, 4]);
    // the frozen values can be replaced by a later config, as plain settings
    assignKnownSettings(t.settings, { currentEntries: [9] });
    assert.deepEqual(t.settings.currentEntries, [9]);
});

test('freezing a table that never drew, or twice, changes nothing', () => {
    const plain = { currentEntries: [1], searchBuilderConfig: { criteria: [] } };
    freezeTableState(plain);
    assert.deepEqual(plain, { currentEntries: [1], searchBuilderConfig: { criteria: [] } });
    const t = liveTable();
    freezeTableState(t.settings);
    freezeTableState(t.settings);
    assert.deepEqual(t.settings.currentEntries, [3, 1, 4]);
});

test('a getter that throws freezes to an empty selection rather than failing the close', () => {
    const s = {};
    Object.defineProperty(s, 'currentEntries', { configurable: true, enumerable: true, get: () => { throw new Error('gone'); } });
    freezeTableState(s);
    assert.deepEqual(s.currentEntries, []);
});
