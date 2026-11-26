/**
 * An aborted fetch is no console error: a load that was superseded (the colour moved to another layer) ends with an
 * AbortError, which every loader of data-manager.js passes on without logging ("Error loading layer.X data: AbortError:
 * Fetch request was aborted" was logged for the layer, obsm, varm, obsp and varp loaders).
 *
 * Run:  node --test annzarro/tests/js/aborted-fetch-no-error.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { CacheManager } = await import('../../../static/js/cache-manager.js');
const { DataManager } = await import('../../../static/js/data-manager.js');

const LOADERS = [
    ['loadLayer', { layerName: 'logged', rows: [1] }],
    ['loadObsm', { obsmKey: 'X_umap' }],
    ['loadVarm', { varmKey: 'PCs' }],
    ['loadObsp', { obspKey: 'k', rows: [1] }],
    ['loadVarp', { varpKey: 'k', rows: [1] }]
];

for (const [name, extra] of LOADERS) {
    test(`${name} ends with an AbortError and logs nothing when its request was superseded`, async () => {
        CacheManager.clear();
        const controller = new AbortController();
        controller.abort();
        globalThis.fetch = async () => { throw new Error('the aborted request must not reach the network'); };
        const logged = [];
        const original = console.error;
        console.error = (...a) => logged.push(a.map(String).join(' '));
        try {
            await assert.rejects(DataManager[name]({ datasetPath: '/d/a.zarr', signal: controller.signal, ...extra }), (e) => e.name === 'AbortError');
        } finally {
            console.error = original;
        }
        assert.deepEqual(logged, [], 'an aborted fetch is not an error');
    });
}
