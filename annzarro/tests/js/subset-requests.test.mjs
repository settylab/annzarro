/**
 * The data layer sends the cell subset with every cell-axis request of the
 * subset's dataset, and with nothing else: the invariant that every panel
 * shows the same cells starts here (static/js/data-manager.js).
 *
 * Run:  node --test annzarro/tests/js/subset-requests.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
const notices = [];
globalThis.document = {
    addEventListener() {}, getElementById: () => null,
    dispatchEvent(e) { if (e.type === 'annzarro:notify') notices.push(e.detail); }
};
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const { CacheManager } = await import('../../../static/js/cache-manager.js');
const { DataManager } = await import('../../../static/js/data-manager.js');

const BIG = '/data/atlas.zarr';
const SMALL = '/data/small.zarr';
const KEY = '{"n":2,"seed":0}';

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A fake server: BIG subsets by default, SMALL does not. Records every URL. */
function installServer({ subsetStatus = 200 } = {}) {
    const calls = [];
    globalThis.fetch = async (url) => {
        const u = new URL(url, 'http://localhost');
        const q = Object.fromEntries(u.searchParams);
        calls.push({ path: u.pathname, q });
        const big = q.dataset_path === BIG;
        if (u.pathname.endsWith('/data/dataset_structure')) return json({ n_obs: big ? 4 : 3 });
        if (u.pathname.endsWith('/data/subset')) {
            if (subsetStatus !== 200 && q.subset !== 'auto') return json({ error: 'No obs column \'nope\' in this dataset.', reason: 'key_not_found' }, subsetStatus);
            const wantsSubset = big && q.subset !== 'all';
            return json(wantsSubset
                ? { subset: { n: 2, seed: 0 }, key: KEY, n: 2, n_total: 4, n_eligible: 4,
                    defaults: { threshold: 3, size: 2, seed: 0 } }
                : { subset: null, key: null, n: big ? 4 : 3, n_total: big ? 4 : 3, n_eligible: big ? 4 : 3,
                    defaults: { threshold: 3, size: 2, seed: 0 } });
        }
        if (u.pathname.endsWith('/data/cells')) {
            return json({ cells: q.subset ? ['c1', 'c3'] : (big ? ['c0', 'c1', 'c2', 'c3'] : ['s0', 's1', 's2']) });
        }
        if (u.pathname.endsWith('/data/genes')) return json({ genes: ['g0', 'g1'] });
        return json({ data: [] });
    };
    return calls;
}

async function exercise() {
    await DataManager.loadObs({ columns: ['cluster'] });
    await DataManager.loadObsm({ obsmKey: 'X_umap', columnName: '0' });
    await DataManager.loadObsp({ obspKey: 'connectivities', rows: [1] });
    await DataManager.loadX({ cols: [1] });
    await DataManager.loadLayer({ layerName: 'counts', cols: [1] });
    await DataManager.loadVar({ columns: ['mean'] });
    await DataManager.loadVarm({ varmKey: 'PCs', columnName: '0' });
    await DataManager.loadUns({ unsKey: 'colors' });
}

test('a large dataset opens on the server default, and every cell-axis read names it', async () => {
    CacheManager.clear();
    const calls = installServer();
    DataManager.setSubsetRequest('auto');
    await DataManager.setCurrentDataset(BIG, true);
    assert.deepEqual(DataManager.getCells(), ['c1', 'c3']);
    assert.equal(DataManager.getSubsetParam(), KEY);
    assert.equal(DataManager.getCellsNotInSubset(), 2);
    assert.deepEqual(DataManager.getSubsetForView(), { n: 2, seed: 0 });

    calls.length = 0;
    await exercise();
    const withSubset = calls.filter(c => c.q.subset === KEY).map(c => c.path.replace('/api/v1/data/', ''));
    const without = calls.filter(c => c.q.subset === undefined).map(c => c.path.replace('/api/v1/data/', ''));
    assert.deepEqual(withSubset.sort(), ['X', 'layer/counts', 'obs', 'obsm/X_umap', 'obsp/connectivities']);
    assert.deepEqual(without.sort(), ['uns/colors', 'var', 'varm/PCs']);

    // another dataset's reads are not given this dataset's subset
    calls.length = 0;
    await DataManager.loadObs({ datasetPath: SMALL, columns: ['cluster'] });
    assert.equal(calls[0].q.subset, undefined);
});

test('a small dataset sends no subset at all, and a view of it records none', async () => {
    CacheManager.clear();
    const calls = installServer();
    await DataManager.setCurrentDataset(SMALL, true);
    assert.equal(DataManager.getSubset(), null);
    assert.equal(DataManager.getSubsetForView(), undefined);
    calls.length = 0;
    await exercise();
    assert.ok(calls.every(c => c.q.subset === undefined), JSON.stringify(calls));
});

test('every cell of a large dataset is recorded as null; a reload keeps the subset it had', async () => {
    CacheManager.clear();
    installServer();
    DataManager.setSubsetRequest(null);
    await DataManager.setCurrentDataset(BIG, true);
    assert.equal(DataManager.getSubset(), null);
    assert.equal(DataManager.getCells().length, 4);
    assert.equal(DataManager.getSubsetForView(), null);

    DataManager.setSubsetRequest({ n: 2, seed: 0 });
    await DataManager.setCurrentDataset(BIG, true);
    assert.equal(DataManager.getSubsetParam(), KEY);
    await DataManager.setCurrentDataset(BIG, true);   // 'auto' on the same dataset: keep
    assert.equal(DataManager.getSubsetParam(), KEY);
});

test('a subset the dataset cannot apply opens on the default, with a notice', async () => {
    CacheManager.clear();
    notices.length = 0;
    const calls = installServer({ subsetStatus: 404 });
    DataManager.setSubsetRequest({ n: 2, seed: 0, where: [{ col: 'nope', op: 'in', values: ['a'] }] });
    await assert.doesNotReject(DataManager.setCurrentDataset(SMALL, true));
    assert.equal(notices.length, 1);
    assert.match(notices[0].title, /not applied/);
    assert.ok(calls.some(c => c.path.endsWith('/data/subset') && c.q.subset === 'auto'));
});

test('a superseded part is dropped quietly: no console error, no notice, nothing cached, the last part is kept', async () => {
    CacheManager.clear();
    notices.length = 0;
    installServer();
    DataManager.setSubsetRequest('auto');
    await DataManager.setCurrentDataset(BIG, true);

    const real = globalThis.fetch;
    const asked = [];
    globalThis.fetch = async (url, init) => {
        const u = new URL(url, 'http://localhost');
        if (u.pathname.endsWith('/data/subset')) {
            const part = JSON.parse(u.searchParams.get('subset')).part;
            asked.push(part);
            // the server answers the older part as superseded (200, not 409)
            if (part === 1) return json({ superseded: true, reason: 'subset_superseded', error: 'newer subset asked' });
            return json({ subset: { n: 2, seed: 0, part }, key: JSON.stringify({ n: 2, seed: 0, part }), n: 2,
                          n_total: 4, n_eligible: 4, defaults: { threshold: 3, size: 2, seed: 0 } });
        }
        return real(url, init);
    };
    const errors = [];
    const warns = [];
    const { error, warn } = console;
    console.error = (...a) => errors.push(a);
    console.warn = (...a) => warns.push(a);
    try {
        DataManager.setSubsetRequest({ n: 2, seed: 0, part: 1 });
        await assert.rejects(DataManager.reloadSubset(), { name: 'AbortError' });
        DataManager.setSubsetRequest({ n: 2, seed: 0, part: 2 });
        await DataManager.reloadSubset();
        // the superseded reply was not cached: asking for part 1 again asks the server again
        DataManager.setSubsetRequest({ n: 2, seed: 0, part: 1 });
        await assert.rejects(DataManager.reloadSubset(), { name: 'AbortError' });
        DataManager.setSubsetRequest({ n: 2, seed: 0, part: 2 });
        await DataManager.reloadSubset();
    } finally {
        console.error = error;
        console.warn = warn;
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(warns, []);
    assert.deepEqual(notices, []);
    assert.deepEqual(asked, [1, 2, 1]);   // the last part came from the cache
    assert.equal(DataManager.getSubset().subset.part, 2);
});
