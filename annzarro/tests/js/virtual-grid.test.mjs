/**
 * G9c: the windowing, the keys and the contract of the shared virtualised grid (static/js/utils/virtual-grid.js).
 * The gene grid is built on it and keeps its exports, so the two cannot drift apart.
 *
 * Run:  node --test annzarro/tests/js/virtual-grid.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const grid = await import('../../../static/js/utils/virtual-grid.js');
const gene = await import('../../../static/js/utils/gene-grid.js');

test('the gene grid and the shared grid use one windowing and one key map', () => {
    assert.equal(gene.visibleRange, grid.visibleRange);
    assert.equal(gene.rowAfterKey, grid.rowAfterKey);
});

test('rows drawn: the ones in view and a few beyond, never more than the list', () => {
    assert.deepEqual(grid.visibleRange(0, 280, 28, 2000), { start: 0, end: 16 });
    assert.deepEqual(grid.visibleRange(28 * 1000, 280, 28, 2000), { start: 994, end: 1016 });
    assert.deepEqual(grid.visibleRange(0, 280, 28, 3), { start: 0, end: 3 });
    assert.deepEqual(grid.visibleRange(0, 280, 28, 0), { start: 0, end: 0 });
});

test('2,000 groups and a million names draw the same number of rows', () => {
    const drawn = (count) => { const r = grid.visibleRange(28 * Math.floor(count / 2), 400, 28, count); return r.end - r.start; };
    assert.equal(drawn(2000), drawn(1000000));
    assert.ok(drawn(2000) <= 30);
});

test('columns drawn: the ones in view and a few beyond, from the first column that is not frozen', () => {
    assert.deepEqual(grid.columnRange(0, 400, 80, 2000, 2), { start: 0, end: 7 });
    assert.deepEqual(grid.columnRange(8000, 400, 80, 2000, 2), { start: 98, end: 107 });
    assert.deepEqual(grid.columnRange(0, 400, 80, 3, 2), { start: 0, end: 3 });
    assert.deepEqual(grid.columnRange(0, 400, 80, 0, 2), { start: 0, end: 0 });
    const wide = grid.columnRange(80 * 1990, 400, 80, 2000, 2);
    assert.equal(wide.end, 2000);
});

test('movement keys', () => {
    assert.equal(grid.rowAfterKey('ArrowDown', 3, 10, 5), 4);
    assert.equal(grid.rowAfterKey('ArrowUp', 0, 10, 5), 0);
    assert.equal(grid.rowAfterKey('End', 2, 10, 5), 9);
    assert.equal(grid.rowAfterKey('PageDown', 8, 10, 5), 9);
    assert.equal(grid.rowAfterKey('a', 3, 10, 5), null);
    assert.equal(grid.rowAfterKey('ArrowDown', 0, 0, 5), null);
});

test('the grid is built from a contract: it exports the factory the two grids share', () => {
    assert.equal(typeof grid.createVirtualGrid, 'function');
    assert.equal(typeof gene.createGeneGrid, 'function');
});
