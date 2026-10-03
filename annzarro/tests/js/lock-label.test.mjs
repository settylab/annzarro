/**
 * The column menu says 'Locked cell X' as soon as the padlock is clicked.
 *
 * Reproduced headless (view A walk colour, padlock, then a focus change):
 * the menu kept 'Focused cell HSPC_Old_1#GAAGCCCGTGGCTCTG-1' until the
 * panel was rebuilt from a link or panel set. The lock handler now relabels
 * with lockOptionLabel; after the fix it reads 'Locked cell HSPC_Old_1#...'
 * right away and after the focus moves.
 *
 * Run:  node --test annzarro/tests/js/lock-label.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    getElementById: () => null, addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => []
};
globalThis.fetch = async () => ({ ok: false, statusText: 'test' });
globalThis.Plotly = new Proxy({}, { get: () => () => Promise.resolve() });

const { lockOptionLabel } = await import('../../../static/js/panels/plot-utilities/listeners.js');

test('locking names the locked cell; unlocking names the current focus', () => {
    assert.equal(lockOptionLabel('obsp', 'cells', { column: 'c1', locked: true }, 'c2'), 'Locked cell c1');
    assert.equal(lockOptionLabel('obsp', 'cells', { column: 'c1', locked: false }, 'c2'), 'Focused cell c2');
});

test('the entity follows the source type and plot type', () => {
    assert.equal(lockOptionLabel('varp', 'genes', { column: 'g1', locked: true }, 'g2'), 'Locked gene g1');
    assert.equal(lockOptionLabel('layer', 'cells', { column: 'S100a9', locked: true }, null), 'Locked gene S100a9');
    assert.equal(lockOptionLabel('layer', 'genes', { column: 'c9', locked: true }, null), 'Locked cell c9');
    assert.equal(lockOptionLabel('obsp', 'cells', { column: '', locked: false }, null), null);
});
