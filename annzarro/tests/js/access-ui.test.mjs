/**
 * What the page does for a user who sees only what they are granted
 * (annzarro/server/access.py answers a store they may not read exactly as one
 * that is not there, so the page says what is true of both).
 *
 *   - a no-dataset screen says "not available" once the dataset is marked, for
 *     screens already built and for screens built later, and goes back when cleared;
 *   - the first 404 `not_found` for the OPEN dataset (a grant revoked while it
 *     was open) reaches the handler once; a 404 for another dataset, a missing
 *     column (`key_not_found`) and any other status do not;
 *   - the typed-path field of the picker names what a restricted user can open.
 *
 * Run:  node --test annzarro/tests/js/access-ui.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const nodes = [];
const screen = () => {
    const title = { textContent: 'No dataset loaded', attr: 'title' };
    const text = { textContent: 'Please select a dataset to begin visualization' };
    const el = { dataset: {}, querySelector: (sel) => (sel.includes('title') ? title : text), title, text };
    nodes.push(el);
    return el;
};
globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    addEventListener() {}, getElementById: () => null,
    querySelectorAll: (sel) => (sel === '[data-no-dataset-screen]' ? nodes : []),
};

const screens = await import('../../../static/js/utils/no-dataset-screen.js');
const { CacheManager } = await import('../../../static/js/cache-manager.js');
const { DataManager } = await import('../../../static/js/data-manager.js');
const { pathFieldWording } = await import('../../../static/js/utils/dataset-picker.js');

test('a marked dataset turns the no-dataset screens into "not available", old and new', () => {
    const built = screen();
    screens.markDatasetUnavailable('/srv/data/secret.zarr');
    assert.equal(built.title.textContent, 'Dataset not available');
    assert.match(built.text.textContent, /secret\.zarr is not available to you, or no longer exists/);
    assert.equal(built.dataset.unavailable, 'true');
    const later = screens.noDatasetScreenHtml('cell-plot-2');
    assert.match(later, /Dataset not available/);
    assert.match(later, /secret\.zarr is not available to you, or no longer exists/);
    assert.match(later, /data-unavailable="true"/);
    screens.clearDatasetUnavailable();
    assert.equal(built.title.textContent, 'No dataset loaded');
    assert.equal(built.text.textContent, 'Please select a dataset to begin visualization');
    assert.match(screens.noDatasetScreenHtml('cell-plot-3'), /No dataset loaded/);
    assert.equal(screens.datasetUnavailable(), null);
});

test('a name that carries markup is text, never HTML', () => {
    screens.markDatasetUnavailable('<img src=x onerror=alert(1)>.zarr');
    const html = screens.noDatasetScreenHtml('p');
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
    screens.clearDatasetUnavailable();
});

const reply = (status, body) => ({
    ok: status < 400, status,
    headers: { get: k => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => JSON.stringify(body),
});

async function open(path) {
    CacheManager.clear();
    globalThis.fetch = async () => reply(200, { n_obs: 1, n_var: 1, obs_columns: [], var_columns: [], layers: [], embeddings: [] });
    await DataManager.setCurrentDataset(path, true).catch(() => {});
}

test('the first 404 not_found for the open dataset reaches the handler once', async () => {
    const gone = [];
    DataManager.setDatasetGoneHandler((p) => gone.push(p));
    await open('/d/open.zarr');
    globalThis.fetch = async () => reply(404, { error: 'Dataset not found: /d/open.zarr', reason: 'not_found' });
    for (let i = 0; i < 3; i++) {
        await assert.rejects(() => DataManager.loadObs({ datasetPath: '/d/open.zarr', columns: [`c${i}`] }));
    }
    assert.deepEqual(gone, ['/d/open.zarr']);
});

test('another dataset, a missing column and other statuses are not "gone"', async () => {
    const gone = [];
    DataManager.setDatasetGoneHandler((p) => gone.push(p));
    await open('/d/open2.zarr');
    const cases = [
        [404, { reason: 'not_found' }, '/d/elsewhere.zarr'],
        [404, { reason: 'key_not_found' }, '/d/open2.zarr'],
        [500, { reason: 'not_found' }, '/d/open2.zarr'],
        [403, { reason: 'outside_data_dir' }, '/d/open2.zarr'],
    ];
    for (const [status, body, path] of cases) {
        CacheManager.clear();
        globalThis.fetch = async () => reply(status, body);
        await assert.rejects(() => DataManager.loadObs({ datasetPath: path, columns: ['x'] }));
    }
    assert.deepEqual(gone, []);
});

test('the typed-path field tells a restricted user to open what was shared', () => {
    const words = pathFieldWording({ auth_enabled: true, restricted: true, may_open_any_path: false, remote_stores: false });
    assert.match(words.label, /shared with you/);
    assert.doesNotMatch(words.label, /data directory/);
    assert.match(pathFieldWording({ auth_enabled: true, may_open_any_path: false }).label, /data directory/);
});
