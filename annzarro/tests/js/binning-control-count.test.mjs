/**
 * C2a: the shared binning control in a count plot (G9b's `kind: 'count'`, UX 4.4, CNT-9). A count plot takes up to
 * 2,000 bins (512 per axis in 2D) and its default count differs from the grouping's, so every write of the control
 * keeps a count it is given: one past the grouping's limit, and one equal to the grouping's default. In a grouping
 * (no options) nothing changes.
 *
 * Run:  node --test annzarro/tests/js/binning-control-count.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'offline in test' });
const B = await import('../../../static/js/panels/partition-options/binning-control.js');

const COUNT = { max: 2000, keepDefault: true };
const wide = { method: 'equal_width', bins: 1500 };

test('every write keeps a count plot\'s bin count past the grouping\'s limit', () => {
    assert.deepEqual(B.setBins({ method: 'equal_width', bins: 50 }, 1500, COUNT), wide);
    assert.deepEqual(B.setZeroBin(wide, true, COUNT), { ...wide, zero_bin: true });
    assert.deepEqual(B.setEdgesFrom(wide, 'all', COUNT), { ...wide, edges_from: 'all' });
    assert.deepEqual(B.setRange(wide, [0, null], COUNT), { ...wide, range: [0, null] });
    assert.deepEqual(B.setMethod(wide, 'equal_count', null, COUNT), { method: 'equal_count', bins: 1500 });
    assert.deepEqual(B.setMethod(wide, 'manual', { edges: [0, 1, 2], bins_made: 2, degenerate: false }, COUNT).method, 'manual');
});

test('a count equal to the grouping\'s default is a count like any other in a count plot', () => {
    assert.deepEqual(B.setBins({ method: 'equal_width', bins: 50 }, 10, COUNT), { method: 'equal_width', bins: 10 });
    assert.deepEqual(B.setBins({ method: 'equal_count', bins: 50 }, 4, COUNT), { method: 'equal_count', bins: 4 });
});

test('a grouping writes as before: its limit and its defaults', () => {
    assert.deepEqual(B.setBins({ method: 'equal_width', bins: 50 }, 10), { method: 'equal_width' });
    assert.deepEqual(B.setBins({ method: 'equal_width', bins: 50 }, 1500), { method: 'equal_width' });
    assert.deepEqual(B.setZeroBin({ method: 'equal_count', bins: 8 }, true), { method: 'equal_count', bins: 8, zero_bin: true });
});

test('a manual threshold moved keeps the count plot\'s options', () => {
    const manual = { method: 'manual', thresholds: [1, 2, 3], zero_bin: true };
    assert.deepEqual(B.moveThreshold(manual, 1, 2.5, COUNT), { ...manual, thresholds: [1, 2.5, 3] });
    assert.deepEqual(B.setThresholds(manual, [4, 5], COUNT), { ...manual, thresholds: [4, 5] });
});

test('a typed count up to the count plot\'s own limit is taken, and its sentence names that limit', () => {
    assert.deepEqual(B.parseBins('1500', { max: 2000 }), { ok: true, value: 1500 });
    assert.deepEqual(B.parseBins('2001', { max: 2000 }), { ok: false, message: 'Enter a whole number from 2 to 2,000.' });
    assert.deepEqual(B.parseBins('600', { max: 512 }), { ok: false, message: 'Enter a whole number from 2 to 512.' });
    assert.equal(B.rangeHelp('count'), 'Values outside are left out and counted.');
});
