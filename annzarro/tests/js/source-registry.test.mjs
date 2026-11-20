/**
 * The registry of sources with three levels (static/js/utils/source-registry.js) and how view copy
 * keys a gene-score axis (utils/view-descriptor.js coordinateId).
 *
 * Run:  node --test annzarro/tests/js/source-registry.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const R = await import('../../../static/js/utils/source-registry.js');
const { coordinateId } = await import('../../../static/js/utils/view-descriptor.js');

R.registerSource({
    type: 'fake-score', label: 'fake', entity: 'cells', consumers: ['cell-plot'], axes: ['x', 'y', 'color'], defaultSub: 'a',
    entities: () => [{ id: 'S1', title: 'Closed one', open: false }], subKeys: () => [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    load: async () => ({})
});
R.registerSource({
    type: 'fake-cellset', label: 'cell sets', entity: 'genes', consumers: ['gene-plot', 'gene-table'], axes: ['x', 'y', 'color'],
    defaultSub: 'cluster', entities: () => [], subKeys: () => [], load: async () => ({})
});

test('a consumer is offered the providers that accept it for the role', () => {
    assert.deepEqual(R.sourcesFor('cell-plot', 'x').map(p => p.type), ['fake-score']);
    assert.deepEqual(R.sourcesFor('cell-plot', 'z').map(p => p.type), [], 'a provider says which axes it takes');
    assert.deepEqual(R.sourcesFor('gene-plot', 'x').map(p => p.type), ['fake-cellset'], 'not cell consumers only');
});

test('the provider lists entities (closed ones too) and sub-keys, default first', () => {
    const p = R.getSource('fake-score');
    assert.equal(p.entities()[0].open, false);
    assert.equal(p.subKeys('S1')[0].value, p.defaultSub);
});

test('an empty column means the default sub-key, the way an old link has it', () => {
    assert.equal(R.subKeyOf({ type: 'fake-score', key: 'S1', column: '' }), 'a');
    assert.equal(R.subKeyOf({ type: 'fake-score', key: 'S1' }), 'a');
    assert.equal(R.subKeyOf({ type: 'fake-score', key: 'S1', column: 'b' }), 'b');
    assert.equal(R.subKeyOf({ type: 'obsm', key: 'X_umap', column: '1' }), '1', 'a built-in source keeps its column');
});

test('view copy keys a score axis by signature and aggregation; a link without one is the z-score mean', () => {
    const old = coordinateId({ type: 'gene-score', key: 'sig-1', column: '' });
    assert.deepEqual(old, { key: 'gene-score:sig-1', dim: 'zscore_mean' });
    assert.deepEqual(coordinateId({ type: 'gene-score', key: 'sig-1', column: 'zscore_mean' }), old);
    assert.notDeepEqual(coordinateId({ type: 'gene-score', key: 'sig-1', column: 'mean' }), old);
    assert.notDeepEqual(coordinateId({ type: 'gene-score', key: 'sig-2', column: '' }), old);
});

test('a consumer reads the layer of its own choice, else the signature input; view copy and columns tell layers apart', async () => {
    const { layerOf } = R;
    assert.equal(layerOf({ type: 'gene-score', key: 's' }), '');
    assert.equal(layerOf({ type: 'gene-score', key: 's', layer: 'counts' }), 'counts');
    const a = coordinateId({ type: 'gene-score', key: 'sig-1', column: '' });
    const b = coordinateId({ type: 'gene-score', key: 'sig-1', column: '', layer: 'counts' });
    assert.notDeepEqual(a, b, 'the same score over another layer is another coordinate');
    assert.deepEqual(coordinateId({ type: 'gene-score', key: 'sig-1', column: '', layer: '' }), a);
    const { getColumnKey } = await import('../../../static/js/utils/column-key.js');
    const base = { type: 'gene-score', key: 'sig-1', column: 'mean' };
    assert.notEqual(getColumnKey(base), getColumnKey({ ...base, layer: 'counts' }));
    assert.equal(getColumnKey(base), getColumnKey({ ...base, layer: '' }), 'old columns keep their key');
    const { sameScoreColumn } = await import('../../../static/js/utils/score-column.js');
    assert.equal(sameScoreColumn(base, { ...base, layer: 'counts' }), false);
    assert.equal(sameScoreColumn(base, { ...base }), true);
});
