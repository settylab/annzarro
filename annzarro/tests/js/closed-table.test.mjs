/**
 * A closed table's filter on other cells (static/js/utils/closed-table.js).
 *
 * Recorded on v030-preview and before this change: a plot filtered by a
 * closed table mapped the table's row indexes onto whatever cells it showed
 * after a subset or part change, so it showed no cells (indexes past the
 * end) or cells that never passed the filter. Kept as names, a cell is shown
 * only when its name passed; a cell the table never had is counted unknown.
 *
 * Run:  node --test annzarro/tests/js/closed-table.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { freezeSelection, selectionOnCells, staleText } = await import('../../../static/js/utils/closed-table.js');
const { PackedNames } = await import('../../../static/js/utils/packed-names.js');
const { serializableConfig } = await import('../../../static/js/utils/deeplink.js');

const names = (a, b) => Array.from({ length: b - a }, (_, i) => `cell_${String(a + i).padStart(4, '0')}`);

// the table had cells 0-199; its filter passed rows 100-199
const ALL = names(0, 200);
const PASSED = Array.from({ length: 100 }, (_, i) => 100 + i);

test('names, not row indexes: never a cell that did not pass, whatever the cells now', () => {
    const sel = freezeSelection(PASSED, ALL, 200);
    assert.equal(sel.passing.length, 100);
    assert.equal(sel.seen.length, 200);
    // a smaller subset (every other cell): exactly those that passed, nothing unknown
    const smaller = ALL.filter((_, i) => i % 2 === 0);
    let r = selectionOnCells(sel, smaller);
    assert.deepEqual([...r.passing].sort(), smaller.filter(c => c >= 'cell_0100'));
    assert.equal(r.unknown, 0);
    // an equal-size different part: cells the table never had are unknown, none shown
    r = selectionOnCells(sel, names(200, 400));
    assert.equal(r.passing.size, 0);
    assert.equal(r.unknown, 200);
    // a larger subset: the passing ones it had, the rest unknown
    r = selectionOnCells(sel, names(0, 300));
    assert.deepEqual([...r.passing], names(100, 200));
    assert.equal(r.unknown, 100);
    // the cells it had and that did not pass are neither shown nor unknown
    r = selectionOnCells(sel, names(0, 100));
    assert.equal(r.passing.size + r.unknown, 0);
});

test('the old index mapping on the same cells would have been wrong', () => {
    // what plot-make did: entities[index] on the cells shown now
    const now = names(200, 400);
    const byIndex = PASSED.map(i => now[i]).filter(Boolean);
    assert.ok(byIndex.length === 100 && byIndex.every(c => c >= 'cell_0300'), 'cells that never passed');
    assert.equal(selectionOnCells(freezeSelection(PASSED, ALL, 200), now).passing.size, 0);
});

test('only the rows the table had; names kept packed; names absent: no selection', () => {
    // a table that loaded the first 150 cells only
    const sel = freezeSelection([10, 140, 160], ALL, 150);
    assert.deepEqual([...sel.passing], ['cell_0010', 'cell_0140']);
    assert.equal(selectionOnCells(sel, ['cell_0180']).unknown, 1);
    assert.ok(sel.passing instanceof PackedNames && sel.seen instanceof PackedNames);
    // PackedNames rows (names held as one buffer) work as row names
    const packed = PackedNames.fromArray(ALL);
    assert.deepEqual([...freezeSelection([5], packed, 200).passing], ['cell_0005']);
    // names kept on the server (large datasets): nothing to freeze
    assert.equal(freezeSelection([1], { length: 3, at: () => undefined }, 3), null);
    assert.equal(freezeSelection([1], null, 3), null);
});

test('no frozen filter (restored from a panel set, or never loaded): every cell unknown', () => {
    const r = selectionOnCells(null, names(0, 50));
    assert.equal(r.passing.size, 0);
    assert.equal(r.unknown, 50);
});

test("the tag's sentence", () => {
    assert.equal(staleText('Table 1', 100), "Table filter from closed 'Table 1' is out of date: 100 cells were not in it");
    assert.equal(staleText('Table 1', 1), "Table filter from closed 'Table 1' is out of date: 1 cell was not in it");
    assert.equal(staleText('G', 1234, 'genes'), "Table filter from closed 'G' is out of date: 1,234 genes were not in it");
});

test('a frozen filter never goes into a config, a link or a panel set', () => {
    const sel = freezeSelection(PASSED, ALL, 200);
    const cfg = { id: 'cell-table-A', currentEntries: PASSED, closedSelection: { ...sel, toJSON: () => undefined }, pageLength: 25 };
    // Reopen and duplicate copy the config through JSON
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(cfg))), ['id', 'currentEntries', 'pageLength']);
    // links and panel sets drop derived state: no row indexes, no names
    assert.deepEqual(Object.keys(serializableConfig(cfg)), ['id', 'pageLength']);
});
