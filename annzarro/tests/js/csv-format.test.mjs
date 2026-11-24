/**
 * CSV fields and percentages (static/js/utils/csv-format.js), moved out of Inspect's module when Inspect was dropped
 * (decision 31): the Count Plot, the Cell-Gene Plot and the Cell Grouping write their CSV files with them.
 *
 * Run:  node --test annzarro/tests/js/csv-format.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const F = await import('../../../static/js/utils/csv-format.js');

test('a share is a percentage with one decimal, a tiny one is <0.1% and a missing one is empty', () => {
    assert.equal(F.fmtPercent(0.412), '41.2%');
    assert.equal(F.fmtPercent(0.0004), '<0.1%');
    assert.equal(F.fmtPercent(0), '0%');
    assert.equal(F.fmtPercent(1), '100.0%');
    assert.equal(F.fmtPercent(null), '');
    assert.equal(F.fmtPercent(NaN), '');
});

test('csv fields are quoted when they need it and formulas are defused', () => {
    assert.equal(F.csvField('plain'), 'plain');
    assert.equal(F.csvField('a,b'), '"a,b"');
    assert.equal(F.csvField('say "hi"'), '"say ""hi"""');
    assert.equal(F.csvField('line\nbreak'), '"line\nbreak"');
    assert.equal(F.csvField('=1+1', { text: true }), "'=1+1");
    assert.equal(F.csvField('-5', { text: true }), '-5');          // a number is not a formula
    assert.equal(F.csvField('@SUM(A1)', { text: true }), "'@SUM(A1)");
    assert.equal(F.csvField('=1+1'), '=1+1');
    assert.equal(F.csvField(null), '');
    assert.equal(F.csvField(3.5), '3.5');
});
