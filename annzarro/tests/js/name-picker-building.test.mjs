/**
 * A name search that has not answered is never "No cell matches".
 *
 * On the 95.6M-cell Tahoe store (v0.4.0) the Focused Cell picker said "No
 * cell matches" eight times over about 30 s: under the subset, the shown
 * cells' search answered at once with nothing, while the dataset-wide
 * search, which builds the name index the first time, was still running.
 * The picker now says it is searching, and that the index is being built
 * when the server says so (/data/names/status), and answers once the
 * search does.
 *
 * Run:  node --test annzarro/tests/js/name-picker-building.test.mjs
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../../../static/js/utils/name-picker.js');

const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); };
const status = (model) => (typeof M.statusText === 'function' ? M.statusText(model, 'cell') : 'No cell matches');

test('nothing among the shown cells while every cell is still searched: searching, not "no match"', async () => {
    const all = deferred();
    const model = new M.NameSearchModel(async () => ({ matches: [], truncated: false, more: all.p }));
    await model.setQuery('01_131');
    assert.notEqual(status(model), 'No cell matches', 'a search still running said no match');
    assert.match(status(model), /^Searching every cell…$/);
    all.resolve({ matches: [{ name: '01_131_179-lib_1105', index: null, row: 5, outside: true }], truncated: false });
    await flush();
    assert.equal(status(model), '1 match');
});

test('while the server builds the name index the line says so, then gives the answer', async (t) => {
    mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => mock.timers.reset());
    const all = deferred();
    let state = 'building';
    const updates = [];
    const model = new M.NameSearchModel(async () => ({ matches: [], truncated: false, more: all.p }), async () => state);
    model.onUpdate = () => updates.push(status(model));
    await model.setQuery('lib_1105');
    mock.timers.tick(400);
    await flush();
    assert.equal(status(model), 'Building the name index (first search of this dataset)…');
    state = 'ready';
    all.resolve({ matches: [], truncated: false });
    await flush();
    assert.equal(status(model), 'No cell matches', 'answered: now a no match is true');
    assert.ok(!updates.slice(0, -1).includes('No cell matches'), `said no match before the answer: ${updates}`);
});

test('a search with no answer yet is "searching", and its old list is marked as such', async (t) => {
    mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => mock.timers.reset());
    const slow = deferred();
    let n = 0;
    const model = new M.NameSearchModel(async () => (++n === 1 ? { matches: [{ name: 'a', index: 0 }], truncated: false } : slow.p),
        async () => 'absent');
    await model.setQuery('a');
    const second = model.setQuery('ab');
    mock.timers.tick(400);
    await flush();
    assert.match(status(model), /^1 match; building the name index/);
    slow.resolve({ matches: [], truncated: false });
    await second;
    assert.equal(status(model), 'No cell matches');
});

test('a dataset-wide search that fails says so instead of "no match"', async () => {
    const all = deferred();
    const model = new M.NameSearchModel(async () => ({ matches: [], truncated: false, more: all.p }));
    await model.setQuery('x');
    all.reject(new Error('Name search failed (500)'));
    await flush();
    assert.equal(model.error, 'Could not search every name: Name search failed (500)');
});

test('fetchNameIndexState asks /data/names/status with the scope; null from an older server', async (t) => {
    const urls = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
        urls.push(url);
        return url.includes('old') ? new Response('', { status: 404 }) : new Response(JSON.stringify({ state: 'building' }));
    });
    assert.equal(typeof M.fetchNameIndexState, 'function');
    assert.equal(await M.fetchNameIndexState('/api/v1/data/names', { datasetPath: '/d.zarr', entity: 'cells', subset: 'k', scope: 'dataset' }), 'building');
    const q = new URL(urls[0], 'http://x').searchParams;
    assert.equal(new URL(urls[0], 'http://x').pathname, '/api/v1/data/names/status');
    assert.deepEqual([q.get('dataset_path'), q.get('entity'), q.get('subset'), q.get('scope')], ['/d.zarr', 'cells', 'k', 'dataset']);
    assert.equal(await M.fetchNameIndexState('/old/names', { datasetPath: '/d.zarr', entity: 'cells' }), null);
});

test('datasetNamesScanned: true only for a "streaming" dataset, asked once per dataset, unknown not remembered', async (t) => {
    const urls = [];
    let state = 'streaming';
    t.mock.method(globalThis, 'fetch', async (url) => {
        urls.push(url);
        return url.includes('old') ? new Response('', { status: 404 }) : new Response(JSON.stringify({ state }));
    });
    const ask = (p) => M.datasetNamesScanned('/api/v1/data/names', { datasetPath: p, subset: 'k' });
    assert.equal(await ask('/big.zarr'), true);
    assert.equal(await ask('/big.zarr'), true);
    assert.equal(urls.length, 1, 'asked again for the same dataset');
    assert.equal(new URL(urls[0], 'http://x').searchParams.get('scope'), 'dataset');
    state = 'absent';
    assert.equal(await ask('/small.zarr'), false);
    assert.equal(await M.datasetNamesScanned('/old/names', { datasetPath: '/older.zarr' }), false);
    assert.equal(await M.datasetNamesScanned('/old/names', { datasetPath: '/older.zarr' }), false);
    assert.equal(urls.length, 4, 'an unknown answer (older server) was remembered');
});
