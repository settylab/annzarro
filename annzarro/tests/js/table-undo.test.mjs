/**
 * What a table's Undo keeps and labels (panels/table-utilities/table-undo.js): the saved settings as a plain config, none of
 * what is derived or transient; the labels; what a config from outside is; how a config is given back (a field the config
 * lacks is taken out).
 *
 * Run:  node --test annzarro/tests/js/table-undo.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { tableSnapshot, changesTableState, giveBack, TABLE_STEP_NAMES } = await import('../../../static/js/panels/table-utilities/table-undo.js');
const { labelByKeys } = await import('../../../static/js/ui/panel-undo.js');

test('a snapshot has the saved settings, and no derived or transient field', () => {
    const settings = { columns: [{ key: 'a' }], searchText: 'x', pageLength: 50, currentEntries: [1, 2, 3], closedSelection: { a: 1 }, controlsVisible: false, title: 'T' };
    const snap = tableSnapshot(settings, { methods: { detect_above: 2 } });
    assert.deepEqual(snap, { columns: [{ key: 'a' }], searchText: 'x', pageLength: 50, methods: { detect_above: 2 } });
});

test('the live views of a DataTable are read as values, a getter that throws is left out', () => {
    const settings = { columns: [] };
    Object.defineProperty(settings, 'searchBuilderConfig', { enumerable: true, get: () => ({ criteria: [1] }) });
    Object.defineProperty(settings, 'searchText', { enumerable: true, get: () => { throw new Error('destroyed'); } });
    assert.deepEqual(tableSnapshot(settings), { columns: [], searchBuilderConfig: { criteria: [1] } });
});

test('the labels say what changed', () => {
    const l = (b, a) => labelByKeys(b, a, TABLE_STEP_NAMES);
    assert.equal(l({ columns: [1] }, { columns: [1, 2] }), 'change the columns');
    assert.equal(l({ searchText: '' }, { searchText: 'x' }), 'search');
    assert.equal(l({ searchRegex: false }, { searchRegex: true }), 'search');
    assert.equal(l({ pageLength: 25 }, { pageLength: 50 }), 'change the rows per page');
    assert.equal(l({ scoreOptions: null }, { scoreOptions: { clip: 3 } }), 'change the score methods');
    assert.equal(l({ searchBuilderConfig: {} }, { searchBuilderConfig: { criteria: [1] } }), 'change the filter');
});

test('a config from outside changes state unless it only carries the title or the controls shown', () => {
    assert.equal(changesTableState({ title: 'x', controlsVisible: false }), false);
    assert.equal(changesTableState({ columns: [] }), true);
    assert.equal(changesTableState({ methods: {} }), true);
    assert.equal(changesTableState(null), false);
});

test('giving a config back puts its fields in and takes out the ones it lacks, and leaves read-only views alone', () => {
    const settings = { columns: [1], pageLength: 50, searchText: 'x', currentEntries: [9] };
    Object.defineProperty(settings, 'live', { enumerable: true, get: () => 7 });
    giveBack(settings, { columns: [1, 2], searchText: '' });
    assert.deepEqual(settings.columns, [1, 2]);
    assert.equal('pageLength' in settings, false, 'a field the config lacks goes');
    assert.equal(settings.searchText, '');
    assert.deepEqual(settings.currentEntries, [9], 'derived fields stay');
    assert.equal(settings.live, 7);
});
