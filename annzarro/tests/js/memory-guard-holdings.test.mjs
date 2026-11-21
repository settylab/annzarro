/**
 * The memory guard's ledger of named holdings outside the panels (static/js/utils/memory-guard.js `Ledger.hold`): a
 * grouping's codes (CAT-4). Held bytes count in totals().off and buffers(); a pinned holding stays, an unpinned one may
 * be evicted, which tells its owner.
 *
 * Run:  node --test annzarro/tests/js/memory-guard-holdings.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { Ledger } = await import('../../../static/js/utils/memory-guard.js');

test('a holding counts outside the heap and as buffers, and goes when released', () => {
    const L = new Ledger();
    const base = L.totals();
    const buffers = L.buffers();
    let told = 0;
    L.onChange(() => told++);
    L.hold('codes:a', 5e6);
    assert.equal(L.totals().off, base.off + 5e6);
    assert.equal(L.totals().heap, base.heap);
    assert.equal(L.buffers(), buffers + 5e6);
    assert.equal(L.heldBytes(), 5e6);
    L.hold('codes:a', 6e6);                        // the same name again replaces it
    assert.equal(L.heldBytes(), 6e6);
    L.release('codes:a');
    assert.equal(L.heldBytes(), 0);
    assert.equal(L.totals().off, base.off);
    assert.equal(told, 3);
    L.release('codes:a');
    assert.equal(told, 3, 'releasing what is not held changes nothing');
});

test('only unpinned holdings are evicted, oldest first, until the bytes asked are free; each owner is told', () => {
    const L = new Ledger();
    const evicted = [];
    L.hold('a', 100, { pinned: false, evict: () => evicted.push('a') });
    L.hold('b', 200, { pinned: true, evict: () => evicted.push('b') });
    L.hold('c', 300, { pinned: false, evict: () => evicted.push('c') });
    assert.equal(L.evictable(), 400);
    assert.equal(L.evict(50), 100);
    assert.deepEqual(evicted, ['a']);
    L.pin('b', false);
    assert.equal(L.evict(), 500);
    assert.deepEqual(evicted, ['a', 'b', 'c']);
    assert.equal(L.heldBytes(), 0);
});

test('a holding is pinned unless it says otherwise, and pin changes only what is held', () => {
    const L = new Ledger();
    L.hold('a', 10);
    assert.equal(L.holdings.get('a').pinned, true);
    assert.equal(L.evict(), 0);
    L.pin('nope', false);
    assert.equal(L.holdings.size, 1);
});
