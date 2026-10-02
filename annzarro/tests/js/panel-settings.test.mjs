/**
 * Collapsing a filtered table's controls must not throw.
 *
 * Reproduced headless on demo view E (protocol-integration and this branch):
 * clicking the table tile's controls toggle threw
 *   Cannot set property searchBuilderConfig of #<Object> which has only a getter
 * because the toggle handed the panel's whole getConfig() to updateConfig,
 * which assigned every key, including the getters table-data.js defines over
 * the live DataTable. assignKnownSettings skips getter-only properties.
 *
 * Run:  node --test annzarro/tests/js/panel-settings.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { assignKnownSettings } = await import('../../../static/js/utils/panel-settings.js');

function tableSettings() {
    const s = { columns: ['a'], searchBuilderConfig: { criteria: [] }, currentEntries: [], pageLength: 25 };
    // what initializeDataTable does
    Object.defineProperty(s, 'searchBuilderConfig', { configurable: true, get: () => ({ criteria: [{ value: ['HSC'] }] }) });
    Object.defineProperty(s, 'currentEntries', { configurable: true, get: () => [1, 2, 3] });
    return s;
}

test("a table's whole config handed back is accepted, getters untouched", () => {
    const s = tableSettings();
    const config = { title: 'T', ...s, controlsVisible: false, columns: ['a', 'b'] };
    assert.doesNotThrow(() => assignKnownSettings(s, config));
    assert.deepEqual(s.columns, ['a', 'b']);
    assert.deepEqual(s.searchBuilderConfig.criteria[0].value, ['HSC'], 'the live filter is still read from the table');
    assert.deepEqual(s.currentEntries, [1, 2, 3]);
});

test('unknown keys and the title are not copied (as before)', () => {
    const s = { pageLength: 25 };
    assignKnownSettings(s, { title: 'x', controlsVisible: false, pageLength: 50 });
    assert.deepEqual(s, { pageLength: 50 });
});

test('a settable accessor is still set', () => {
    let stored = 1;
    const s = {};
    Object.defineProperty(s, 'v', { get: () => stored, set: (x) => { stored = x; }, enumerable: true });
    assignKnownSettings(s, { v: 7 });
    assert.equal(stored, 7);
});
