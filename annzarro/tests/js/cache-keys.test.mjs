/**
 * `DataManager.getCacheKeys()` delegates to `CacheManager.keys()`, which did
 * not exist: every call was a TypeError ("CacheManager.keys is not a function").
 *
 * Run:  node --test annzarro/tests/js/cache-keys.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = { addEventListener() {}, getElementById: () => null };

const { CacheManager } = await import('../../../static/js/cache-manager.js');
const { DataManager } = await import('../../../static/js/data-manager.js');

test('getCacheKeys returns the live keys instead of throwing', () => {
    CacheManager.clear();
    CacheManager.set('a', [1], 60000);
    CacheManager.set('b', [2], 0);          // no expiry
    assert.deepEqual(DataManager.getCacheKeys(), ['a', 'b']);
});

test('expired entries are not reported', () => {
    CacheManager.clear();
    CacheManager.set('fresh', 1, 60000);
    CacheManager.set('stale', 1, 1);
    const until = Date.now() + 5;
    while (Date.now() < until) { /* let `stale` expire */ }
    assert.deepEqual(DataManager.getCacheKeys(), ['fresh']);
    assert.equal(CacheManager.has('stale'), false);
});

test('caching a large decoded slice does not JSON-encode it', () => {
    CacheManager.clear();
    const real = JSON.stringify;
    let stringified = 0;
    JSON.stringify = (...args) => { stringified += 1; return real(...args); };
    try {
        CacheManager.set('big', { values: new Float32Array(1_000_000), shape: [1_000_000] });
        CacheManager.set('arr', { data: new Array(200_000).fill(1.5) });
    } finally {
        JSON.stringify = real;
    }
    assert.equal(stringified, 0);
    assert.ok(CacheManager.get('big'));
});
