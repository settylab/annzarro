/**
 * A 503 `read_busy` (the server's pairwise-read memory budget is in use) is
 * retried once after Retry-After, so a focused cell's row arrives instead of
 * an error; a second 503 is the error.
 *
 * Run:  node --test annzarro/tests/js/busy-retry.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = { addEventListener() {}, getElementById: () => null };

const { CacheManager } = await import('../../../static/js/cache-manager.js');
const { DataManager } = await import('../../../static/js/data-manager.js');

const reply = (status, body, headers = {}) => ({
    ok: status < 400, status,
    headers: { get: k => headers[k] ?? (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => JSON.stringify(body),
});

test('a 503 with Retry-After is retried once and the row is returned', async () => {
    CacheManager.clear();
    const calls = [];
    globalThis.fetch = async url => {
        calls.push(url);
        return calls.length === 1
            ? reply(503, { reason: 'read_busy' }, { 'Retry-After': '1' })
            : reply(200, { data: [[0.5, 0.25]], obsp_key: 'k' });
    };
    const out = await DataManager.loadObsp({ datasetPath: '/d/a.zarr', obspKey: 'k', rows: [3] });
    assert.equal(calls.length, 2);
    assert.ok(out);
});

test('a second 503 is the error', async () => {
    CacheManager.clear();
    let n = 0;
    globalThis.fetch = async () => { n += 1; return reply(503, { reason: 'read_busy', error: 'busy' }, { 'Retry-After': '1' }); };
    await assert.rejects(() => DataManager.loadObsp({ datasetPath: '/d/b.zarr', obspKey: 'k', rows: [3] }));
    assert.equal(n, 2);
});
