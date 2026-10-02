/**
 * Selected table columns stay distinguishable.
 *
 * The Selected Columns list cut long names at the end, so
 * kompot_de_Young_to_Old_mahalanobis and kompot_de_Young_to_Old_mean_lfc
 * looked identical. They are shortened in the middle now (full name on
 * hover, as before).
 *
 * Run:  node --test annzarro/tests/js/column-names.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    getElementById: () => null, addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => []
};
globalThis.fetch = async () => ({ ok: false, statusText: 'test' });

const { shortColumnName } = await import('../../../static/js/panels/table-utilities/table-ui-make.js');

test('long names keep their distinguishing end', () => {
    const a = shortColumnName('kompot_de_Young_to_Old_mahalanobis');
    const b = shortColumnName('varm.kompot_de_Young_to_Old_groups:kompot_de_Young_to_Old_mean_lfc');
    assert.ok(Array.from(b).length <= 34);
    assert.ok(b.endsWith('mean_lfc'), b);
    assert.notEqual(a, b);
    assert.equal(shortColumnName('Age'), 'Age');
});
