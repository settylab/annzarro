/**
 * The guard's eviction pass (static/js/utils/memory-guard-ui.js): before it warns or refuses, it evicts the holdings
 * no consumer on screen pins (a grouping's codes held by hidden plots, CAT-4) and checks again; their owners are told,
 * so they ask again when shown. Pinned holdings never give way.
 *
 * Run:  node --test annzarro/tests/js/memory-guard-evict.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const kept = new Map();
const localStorage = { getItem: k => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)),
    removeItem: k => kept.delete(k) };
globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/', origin: 'http://localhost' }, Config: {}, localStorage };
globalThis.document = {
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    getElementById: () => null, createElement: () => ({}), querySelectorAll: () => []
};
globalThis.fetch = async () => ({ ok: false, statusText: 'test' });

const ui = await import('../../../static/js/utils/memory-guard-ui.js');
const TOO_MUCH = 1e15;
const small = () => ui.tableCheck({ id: 't1', kind: 'cell-table', n: 10 });

test('nothing held: a small table fits, and nothing is evicted', () => {
    assert.equal(small().fits, true);
});

test('codes only hidden consumers hold give way before the guard refuses, and their owner is told', () => {
    const told = [];
    ui.ledger.hold('codes:hidden', TOO_MUCH, { pinned: false, evict: () => told.push('codes:hidden') });
    const r = small();
    assert.equal(r.fits, true);
    assert.deepEqual(told, ['codes:hidden']);
    assert.equal(ui.ledger.holdings.size, 0);
});

test('codes a consumer on screen holds are never evicted: the guard refuses instead', () => {
    const told = [];
    ui.ledger.hold('codes:shown', TOO_MUCH, { pinned: true, evict: () => told.push('codes:shown') });
    const r = small();
    assert.equal(r.fits, false);
    assert.deepEqual(told, []);
    assert.equal(ui.ledger.heldBytes(), TOO_MUCH);
    ui.ledger.release('codes:shown');
    assert.equal(small().fits, true);
});

test('a fitting check evicts nothing, even with unpinned codes held', () => {
    const told = [];
    ui.ledger.hold('codes:small', 1000, { pinned: false, evict: () => told.push('x') });
    assert.equal(small().fits, true);
    assert.deepEqual(told, []);
    assert.equal(ui.ledger.heldBytes(), 1000);
    ui.ledger.release('codes:small');
});
