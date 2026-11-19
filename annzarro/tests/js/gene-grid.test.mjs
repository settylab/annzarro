/**
 * The windowing and the keys of the virtualised gene grid
 * (static/js/utils/gene-grid.js). Only the rows in view are in the page, and a
 * list as long as a genome (or a million names) costs the same.
 *
 * Run:  node --test annzarro/tests/js/gene-grid.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { visibleRange, rowAfterKey } = await import('../../../static/js/utils/gene-grid.js');

test('the rows drawn are the ones in view and a few beyond', () => {
    // 28 px rows, a 280 px view: rows 0..9 in view, 6 more below
    assert.deepEqual(visibleRange(0, 280, 28, 32738), { start: 0, end: 16 });
    // scrolled to row 1000
    assert.deepEqual(visibleRange(28000, 280, 28, 32738), { start: 994, end: 1016 });
});

test('the window never leaves the list', () => {
    assert.deepEqual(visibleRange(0, 280, 28, 3), { start: 0, end: 3 });
    assert.deepEqual(visibleRange(0, 280, 28, 0), { start: 0, end: 0 });
    const last = visibleRange(28 * 99990, 280, 28, 100000);
    assert.equal(last.end, 100000);
    assert.ok(last.start > 99900);
    assert.deepEqual(visibleRange(-50, 280, 28, 100), { start: 0, end: 16 });
});

test('the number of rows drawn does not grow with the list', () => {
    for (const count of [100, 32738, 1000000]) {
        const { start, end } = visibleRange(28 * Math.floor(count / 2), 400, 28, count);
        assert.ok(end - start <= 30, `${count} rows draw ${end - start}`);
    }
});

test('movement keys', () => {
    assert.equal(rowAfterKey('ArrowDown', 3, 10, 5), 4);
    assert.equal(rowAfterKey('ArrowUp', 3, 10, 5), 2);
    assert.equal(rowAfterKey('ArrowUp', 0, 10, 5), 0, 'stays at the top');
    assert.equal(rowAfterKey('ArrowDown', 9, 10, 5), 9, 'stays at the end');
    assert.equal(rowAfterKey('Home', 7, 10, 5), 0);
    assert.equal(rowAfterKey('End', 2, 10, 5), 9);
    assert.equal(rowAfterKey('PageDown', 2, 10, 5), 7);
    assert.equal(rowAfterKey('PageDown', 8, 10, 5), 9);
    assert.equal(rowAfterKey('PageUp', 3, 10, 5), 0);
    assert.equal(rowAfterKey('PageDown', 0, 100, 0), 1, 'a page is at least one row');
    assert.equal(rowAfterKey('a', 3, 10, 5), null);
    assert.equal(rowAfterKey('Space', 3, 10, 5), null);
    assert.equal(rowAfterKey('ArrowDown', 0, 0, 5), null, 'no rows, no move');
});
