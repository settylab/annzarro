/**
 * A matrix load (varp, varm, obsm, obsp, layer, by-path) that the app cancels itself, because a
 * newer render superseded it, is not an error: no console.error, and the AbortError still
 * reaches the caller so it can drop the stale result. Opening a link such as the gene-groups
 * start link logged "Error loading varp.spearman_fold_change data: AbortError" now and then.
 * A real failure is still logged.
 *
 * Run:  node --test annzarro/tests/js/aborted-matrix-load.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = { addEventListener() {}, getElementById: () => null };

const { DataManager } = await import('../../../static/js/data-manager.js');

async function logged(run) {
    const errors = [];
    const real = console.error;
    console.error = (...args) => { errors.push(args.map(String).join(' ')); };
    try { return { result: await run().then(() => null, e => e), errors }; }
    finally { console.error = real; }
}

const aborted = () => { const c = new AbortController(); c.abort(); return c.signal; };
const loads = {
    varp: signal => DataManager.loadVarp({ datasetPath: 'd.zarr', varpKey: 'spearman_fold_change', rows: [3], signal }),
    varm: signal => DataManager.loadVarm({ datasetPath: 'd.zarr', varmKey: 'k', signal }),
    obsm: signal => DataManager.loadObsm({ datasetPath: 'd.zarr', obsmKey: 'X_umap', signal }),
    obsp: signal => DataManager.loadObsp({ datasetPath: 'd.zarr', obspKey: 'k', cell: { shown: true, position: 1 }, signal }),
    layer: signal => DataManager.loadLayer({ layerName: 'k', cell: { shown: true, position: 1 }, signal }),
};

for (const [kind, load] of Object.entries(loads)) {
    test(`an aborted ${kind} load rethrows the abort and logs no error`, async () => {
        const { result, errors } = await logged(() => load(aborted()));
        assert.ok(result, 'the load should reject');
        assert.equal(result.name, 'AbortError');
        assert.deepEqual(errors, []);
    });
}

test('a failed varp load is still logged', async () => {
    globalThis.fetch = async () => { throw new TypeError('network down'); };
    const { result, errors } = await logged(() =>
        DataManager.loadVarp({ datasetPath: 'd.zarr', varpKey: 'spearman_fold_change', rows: [4] }));
    assert.ok(result);
    assert.notEqual(result.name, 'AbortError');
    assert.ok(errors.some(e => e.includes('Error loading varp.spearman_fold_change')), errors.join('|'));
});
