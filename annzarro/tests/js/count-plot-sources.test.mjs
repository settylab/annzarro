/**
 * G-SRC2 (aggregation-unify-080.md 17): a Count Plot's rows pick a signature, a gene table or a cell grouping under layer.
 * The sets a row lists by what the row takes, the Distribution opener writing what the row writes, a score named by its
 * method on an axis, a grouping's known groups.
 *
 * Run:  node --test annzarro/tests/js/count-plot-sources.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.PanelManager = { getPanel: () => null, getAllPanels: () => [], getActivePanels: () => [] };
await import('../../../static/js/utils/score-source.js');
await import('../../../static/js/utils/cell-group-source.js');
const A = await import('../../../static/js/utils/axis-aggregate.js');
const K = await import('../../../static/js/panels/cell-count/controls-model.js');
const { getSource } = await import('../../../static/js/utils/source-registry.js');

test('a row that takes a number per cell lists no grouping; a partitioning row lists the groupings last', () => {
    const headings = (numeric, roles) => A.setSections('cell-plot', roles, numeric).map((s) => s.heading);
    // no panels are open here, so no section has an entry; the providers a row lists are what differs
    const providers = (numeric, roles) => A.aggregateProviders('cell-plot', roles, numeric).map((p) => p.type);
    assert.deepEqual(providers(false, ['x']), ['gene-score', 'cell-group']);
    assert.deepEqual(providers(false, ['color']), ['gene-score', 'cell-group']);
    assert.deepEqual(providers(true, ['x']), ['gene-score'], 'a group label is not a number');
    assert.deepEqual(headings(true, ['x']).includes('Cell groupings'), false);
});

test('Distribution writes what picking the same set in the row writes', () => {
    const picked = A.startSet({ history: {} }, A.encodeSet('gene-score', 'gene-signature-S'), 'X');
    assert.deepEqual(K.distributionSource('gene-signature-S'), K.sourceFromSetting(picked));
    assert.deepEqual(K.distributionSource('gene-signature-S'), { type: 'gene-score', key: 'gene-signature-S', column: 'zscore_mean', layer: 'X' });
});

test('a score is named by its method and layer on an axis when they are not the default, and by its title when they are', () => {
    const names = (source) => K.inputNames({ x: { source: { ...source, label: 'B score' } } }, undefined).x;
    assert.equal(names({ type: 'gene-score', key: 'gene-signature-S', column: 'zscore_mean', layer: 'X' }), 'B score');
    assert.match(names({ type: 'gene-score', key: 'gene-signature-S', column: 'mean', layer: 'X' }), /^.* · mean$/i);
    assert.equal(K.inputNames({ x: { source: { type: 'obs', key: 'cell_type' } } }, undefined).x, 'cell_type');
});

test('a grouping reports its groups once they are known, and none before', () => {
    const { levelCount } = getSource('cell-group').aggregate;
    assert.equal(typeof levelCount, 'function');
    assert.equal(levelCount('cell-grouping-never-read'), null);
});

test('a grouping has no aggregation button and a score has one', () => {
    assert.equal(getSource('cell-group').aggregate.methods({ type: 'cell-group', key: 'g' }), null);
    assert.ok(getSource('gene-score').aggregate.methods({ type: 'gene-score', key: 's', column: 'mean' }).options.length === 6);
});
