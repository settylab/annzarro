/**
 * A read or draw the browser ran out of memory for: recognised from the
 * engines' errors (memory-guard.js isOutOfMemory), said in the memory guard's
 * words by every coverage that carries it (coverage.js), and the subset with
 * half the cells that the panel offers (subset-carry.js halfSubset).
 *
 * Run:  node --test annzarro/tests/js/out-of-memory.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { isOutOfMemory, MEMORY_ADVICE, OUT_OF_MEMORY_ADVICE } from '../../../static/js/utils/memory-guard.js';
import { GAP, ROLE, Coverage, breakdown } from '../../../static/js/utils/coverage.js';
import { halfSubset } from '../../../static/js/utils/subset-carry.js';

test('the engines\' allocation failures are out of memory', () => {
    for (const e of [
        new RangeError('Array buffer allocation failed'),
        new RangeError('Invalid array length'),
        new RangeError('Invalid typed array length: 4294967296'),
        new Error('out of memory'),
        Object.assign(new Error('allocation size overflow'), { name: 'InternalError' }),
        Object.assign(new Error('script stack space quota is exhausted; out of memory'), { name: 'InternalError' }),
        new RangeError('Out of memory'),
        new RangeError('Array size is not a small enough positive integer.'),
        'RangeError: Array buffer allocation failed',
        'Failed to allocate 2147483648 bytes'
    ]) {
        assert.ok(isOutOfMemory(e), String(e && e.message || e));
    }
    // a real allocation in this process: too large for any typed array
    let thrown = null;
    try { new Float64Array(2 ** 53); } catch (e) { thrown = e; }
    assert.ok(thrown && isOutOfMemory(thrown), String(thrown));
});

test('other errors are not', () => {
    for (const e of [null, undefined, '', new RangeError('toFixed() digits argument must be between 0 and 100'),
        new RangeError('Maximum call stack size exceeded'), new TypeError('x is undefined'),
        new Error('HTTP 503: read_busy'), new Error('Not found'), 'the memory column is empty']) {
        assert.ok(!isOutOfMemory(e), String(e && e.message || e));
    }
});

test('the advice is the memory guard\'s, with a try again', () => {
    assert.equal(MEMORY_ADVICE, 'Close a plot, or show fewer cells (a smaller subset).');
    assert.ok(OUT_OF_MEMORY_ADVICE.startsWith(MEMORY_ADVICE.slice(0, -1)));
    assert.match(OUT_OF_MEMORY_ADVICE, /and try again\.$/);
});

test('a failed read out of memory says so in plain words, wherever it was built', () => {
    const missing = Coverage.missing(GAP.FAILED, 'Array buffer allocation failed', { source: 'plot data', unit: 'cells' });
    assert.equal(missing.gaps[0].kind, 'memory');
    assert.deepEqual(missing.lines(), [`plot data: the browser ran out of memory -- ${OUT_OF_MEMORY_ADVICE}`]);
    assert.equal(missing.headline(), 'The browser ran out of memory');
    assert.equal(missing.severity, 'error');
    assert.ok(!missing.lines()[0].includes('allocation'), 'the engine\'s words are gone');
    // a gap added later (withGap), and a column that only describes
    const later = Coverage.complete(100, 'cells').withGap(GAP.FAILED, 'Invalid typed array length: 9e9', 'obs.leiden');
    assert.equal(later.gaps[0].kind, 'memory');
    const colour = Coverage.missing(GAP.FAILED, 'RangeError: Array buffer allocation failed',
        { source: 'obs.leiden', unit: 'cells', total: 100, role: ROLE.DESCRIBES });
    const b = breakdown(colour);
    assert.equal(b.notes.length, 1);
    assert.equal(b.notes[0].kind, 'memory');
    assert.match(b.notes[0].label, /^obs\.leiden: the browser ran out of memory -- Close a plot/);
    // with counts: the shown/total headline stays, the reason line is the memory one
    const counted = Coverage.missing(GAP.FAILED, 'Array buffer allocation failed', { source: 'plot data', unit: 'cells', total: 30000 });
    assert.equal(counted.headline(), 'No cells shown (of 30,000)');
    assert.match(breakdown(counted).rows[0].label, /plot data: the browser ran out of memory/);
});

test('other failures and other reasons are left as they were', () => {
    const other = Coverage.missing(GAP.FAILED, 'HTTP 500', { source: 'plot data', unit: 'cells' });
    assert.equal(other.gaps[0].kind, '');
    assert.deepEqual(other.lines(), ['plot data: failed to read -- HTTP 500']);
    assert.equal(other.headline(), 'Some data could not be read');
    const unavailable = Coverage.missing(GAP.UNAVAILABLE, 'out of memory', { source: 'x' });
    assert.equal(unavailable.gaps[0].kind, '', 'only a failed read is reworded');
});

test('half the cells: of the subset shown (filter and balance kept, part 1), or of every cell', () => {
    const info = { subset: { n: 100000, seed: 3, balance: 'batch', where: [{ col: 'a', op: 'empty' }], part: 4 }, n: 100000, n_total: 1e6 };
    assert.deepEqual(halfSubset(info, null), { n: 50000, seed: 3, balance: 'batch', where: [{ col: 'a', op: 'empty' }] });
    assert.deepEqual(halfSubset({ subset: { n: null, seed: 0, where: [{ col: 'a', op: 'empty' }] }, n: 7001, n_total: 9000 }, null),
        { n: 3501, seed: 0, where: [{ col: 'a', op: 'empty' }] });
    assert.deepEqual(halfSubset(null, { n_total: 30000 }, { seed: 5 }), { n: 15000, seed: 5 });
    assert.deepEqual(halfSubset(null, { n_total: 30001 }), { n: 15001, seed: 0 });
    assert.equal(halfSubset(null, { n_total: 1 }), null);
    assert.equal(halfSubset(null, null), null);
});
