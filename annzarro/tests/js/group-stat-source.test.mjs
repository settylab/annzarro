/**
 * The `group-stat` provider's registration (static/js/utils/group-stat-source.js, SO-8b): a Cell group is a source of every
 * Gene Plot axis, x, y and z as well as the colour, offered through the registry as the other sources are per axis, and
 * of no other consumer. Each axis holds its own setting.
 *
 * Run:  node --test annzarro/tests/js/group-stat-source.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../../../static/js/utils/group-stat-source.js');
const R = await import('../../../static/js/utils/source-registry.js');
const M = await import('../../../static/js/utils/group-stat-model.js');
const { typeChoices } = await import('../../../static/js/panels/plot-utilities/panel-ui-update.js');

const TYPE = 'group-stat';

test('a Cell group is offered for x, y, z and the colour of a Gene Plot, and as a column of a Gene Table, and for nothing else', () => {
    for (const axis of ['x', 'y', 'z', 'color']) {
        assert.ok(R.sourcesFor('gene-plot', [axis]).some((p) => p.type === TYPE), `${axis} of a Gene Plot lists it`);
        assert.ok(typeChoices('genes', 'gene-plot', [axis]).some((c) => c.value === TYPE && c.text === 'Cell group'), `${axis}'s type menu`);
        assert.ok(!R.sourcesFor('cell-plot', [axis]).some((p) => p.type === TYPE), `${axis} of a Cell Plot does not`);
    }
    const provider = R.getSource(TYPE);
    assert.equal(provider.entity, 'genes');
    assert.equal(provider.valueType, 'numerical');
    assert.deepEqual(provider.consumers, ['gene-plot', 'gene-table']);
    assert.deepEqual(provider.axes, ['x', 'y', 'z', 'color', 'column']);
    assert.equal(provider.hover, undefined, 'no hover entry (decision 35)');
    assert.equal(provider.readsCellSubset, true);
    assert.equal(R.largeAccepts(TYPE, 'x'), false, 'a large Cell Plot never draws it');
});

test('each axis holds its own setting: a touch of one never writes another', () => {
    const provider = R.getSource(TYPE);
    const key = M.columnOf(['c:B cell']);
    const x = { type: TYPE, key: 'cell-grouping-A', column: key, stat: 'mean', layer: 'X', groupWas: ['B cell'] };
    const y = { ...x };
    const patch = provider.settingAfter(y, 'stat', 'sd');
    Object.assign(y, patch);
    assert.equal(M.statOf(y), 'sd');
    assert.equal(M.statOf(x), 'mean', 'the x axis is unchanged');
    assert.deepEqual(M.referenceOf(x), M.referenceOf({ ...y, stat: 'mean' }), 'the same group on both');
    // the request two axes on the same group, layer and threshold make is the same one: the store shares it by this hash
    assert.equal(M.momentsHash('k', M.groupKeyOf(x), M.layerOf(x), 0), M.momentsHash('k', M.groupKeyOf(y), M.layerOf(y), 0));
});
