/* global document -- stubbed on globalThis below */
/**
 * X is a plot/table source, and a missing source is reported, not swapped
 * in silently.
 *
 * Reported by a docs writer: a deep link {type: 'layer', key: 'X', column:
 * 'Penk'} silently became layer.counts.Penk, because the layer menu listed
 * only layers, and populateKeySelector fell back to the first entry without
 * a word. layerKeys offers X first; keyExistsInStructure tells a key missing
 * from the dataset (notify the user) from one of another type (the user
 * switched the type menu).
 *
 * Run:  node --test annzarro/tests/js/structure-keys.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { layerKeys, keyExistsInStructure } = await import('../../../static/js/utils/structure-keys.js');
const { notify, NOTIFY_EVENT } = await import('../../../static/js/utils/notify.js');

// shape of bm_aging.zarr's /data/dataset_structure (trimmed)
const bm = {
    X: { available: true, shape: [8090, 16285] },
    layers: { available: true, keys: ['counts', 'logged_counts'], details: { keys: ['counts', 'logged_counts'] } },
    obs: { columns: ['highres_celltype', 'Age'] },
    var: { columns: ['highly_variable'] },
    obsm: { keys: ['X_umap', 'spatial'], dataframes: {} },
    obsp: { keys: ['connectivities'] },
    varp: { keys: ['spearman_fold_change'] }
};

test('X is offered first among the layers', () => {
    assert.deepEqual(layerKeys(bm), ['X', 'counts', 'logged_counts']);
});

test('a layer literally named X is not listed twice', () => {
    assert.deepEqual(layerKeys({ X: { available: true }, layers: { keys: ['X', 'a'] } }), ['X', 'a']);
});

test('no X, no X entry', () => {
    assert.deepEqual(layerKeys({ layers: { keys: ['a'] } }), ['a']);
    assert.deepEqual(layerKeys({}), []);
});

test('keyExistsInStructure: missing vs. of another type', () => {
    assert.equal(keyExistsInStructure(bm, 'X'), true);
    assert.equal(keyExistsInStructure(bm, 'highres_celltype'), true, 'an obs column: the user switched type');
    assert.equal(keyExistsInStructure(bm, 'spatial'), true);
    assert.equal(keyExistsInStructure(bm, 'raw_counts'), false, 'not in this dataset: tell the user');
    assert.equal(keyExistsInStructure(bm, ''), false);
});

test('notify dispatches the event main.js shows', () => {
    const seen = [];
    globalThis.document = new EventTarget();
    globalThis.CustomEvent = class extends Event { constructor(t, i = {}) { super(t); this.detail = i.detail; } };
    document.addEventListener(NOTIFY_EVENT, e => seen.push(e.detail));
    notify('Plot source not found', 'layer "raw" is not in this dataset');
    assert.deepEqual(seen, [{ title: 'Plot source not found', message: 'layer "raw" is not in this dataset', type: 'warning' }]);
});
