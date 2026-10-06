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

test('a dataset refresh drops that dataset\'s replies, keyed URL-encoded', () => {
    // The keys are the request URLs _fetchWithCache builds: dataset_path is
    // encoded (%2F). Clearing by the raw path matched none of them, so a
    // refresh within 60 s of a load redrew from the old replies.
    CacheManager.clear();
    const key = (route, path, extra = {}) =>
        `/api/v1/data/${route}?${new URLSearchParams({ dataset_path: path, ...extra })}`;
    const path = '/data/my store/bm_aging.zarr';
    CacheManager.set(key('obs', path, { columns: 'doublet_score' }), [1]);
    CacheManager.set(key('obsm/X_umap', path), [2]);
    CacheManager.set(key('obs', `${path}2`), [3]);          // another dataset, same prefix
    CacheManager.set('/api/v1/datasets?', [4]);
    assert.ok(CacheManager.keys()[0].includes('%2Fdata%2Fmy+store'), 'keys are encoded');
    // what the header's Refresh dataset calls (then reopens the dataset)
    globalThis.fetch = async () => { throw new Error('offline in test'); };
    Promise.resolve(DataManager.refreshCacheForDataset(path)).catch(() => {});
    assert.deepEqual(CacheManager.keys(), [key('obs', `${path}2`), '/api/v1/datasets?']);
    CacheManager.set(key('obs', path), [5]);
    assert.equal(DataManager.clearDatasetCache(path), 1);
});

test('a refresh asks the server to re-check the dataset, for every user', async () => {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
        calls.push([String(url), opts && opts.method]);
        return new Response(JSON.stringify({ status: 'success', changed: true, checked: true }), { status: 200 });
    };
    const r = await DataManager.revalidateDataset('/data/my store/a.zarr');
    assert.deepEqual(r.changed, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0][0], /\/data\/refresh\?dataset_path=%2Fdata%2Fmy\+store%2Fa\.zarr$/);
    assert.equal(calls[0][1], 'POST');
    // a server that cannot re-check does not stop the refresh in the browser
    globalThis.fetch = async () => new Response('{}', { status: 500 });
    assert.equal(await DataManager.revalidateDataset('/x.zarr'), null);
});

test('a panel Refresh re-checks the dataset and reads past the cached replies', async () => {
    // Refresh used to redraw from CacheManager: within 60 s of a load it sent
    // no request at all, though the docs say it reloads the panel's data.
    CacheManager.clear();
    const path = '/data/b.zarr';
    CacheManager.set(`/api/v1/data/obs?${new URLSearchParams({ dataset_path: path, columns: 'n' })}`, [1]);
    const calls = [];
    globalThis.fetch = async (url, opts) => {
        calls.push(opts && opts.method);
        return new Response('{"changed": false, "checked": true}', { status: 200 });
    };
    assert.deepEqual(await DataManager.reloadDatasetData(path), { changed: false, checked: true });
    assert.deepEqual(calls, ['POST']);
    assert.deepEqual(CacheManager.keys(), []);
});
