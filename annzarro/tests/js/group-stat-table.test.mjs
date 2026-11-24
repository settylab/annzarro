/**
 * The `group-stat` provider's table half (T2 of table-chooser-080): a Cell group is a source of a Gene Table's columns, one
 * number per gene. The stored column IS the Gene Plot's setting for the same choice, so a column and an axis share a request.
 *
 * Run:  node --test annzarro/tests/js/group-stat-table.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../../../static/js/utils/group-stat-source.js');
const R = await import('../../../static/js/utils/source-registry.js');
const M = await import('../../../static/js/utils/group-stat-model.js');
const { tableHalfOf } = await import('../../../static/js/utils/table-source.js');

const TYPE = 'group-stat';
const ENTITY = { id: 'cell-grouping-A', title: 'Cell types', open: true };
const choice = { group: ['c:B cell'], groupWas: ['B cell'], stat: 'mean', layer: 'logged' };

test('a Cell group is a source of a Gene Table, and still of the Gene Plot', () => {
    const provider = R.getSource(TYPE);
    assert.deepEqual(provider.consumers, ['gene-plot', 'gene-table']);
    assert.ok(provider.axes.includes('column'));
    assert.ok(R.sourcesFor('gene-table', ['column']).some((p) => p.type === TYPE));
    assert.ok(!R.sourcesFor('cell-table', ['column']).some((p) => p.type === TYPE), 'a Cell Table does not list it');
    assert.ok(provider.table && provider.table.chooser.add.group, 'the table half has an add row with a group select');
    assert.equal(provider.readsCellSubset, true);
});

test('the stored column deep-equals a Gene Plot setting for the same choice', () => {
    const provider = R.getSource(TYPE);
    const column = provider.table.chooser.columnOf(ENTITY, choice);
    const axis = { type: TYPE, key: ENTITY.id, column: M.columnOf(choice.group), stat: 'mean', layer: 'logged', groupWas: ['B cell'] };
    assert.deepEqual({ ...column, label: undefined }, { ...axis, label: undefined });
    assert.equal(M.momentsHash('k', M.groupKeyOf(column), M.layerOf(column), 0), M.momentsHash('k', M.groupKeyOf(axis), M.layerOf(axis), 0));
});

test('a column is told apart by grouping, group, statistic and layer', () => {
    const { chooser } = tableHalfOf({ type: TYPE });
    const base = chooser.columnOf(ENTITY, choice);
    const id = (c) => chooser.identity(c);
    assert.equal(id(base), id({ ...base }));
    for (const change of [{ stat: 'sum' }, { layer: 'counts' }, { column: M.columnOf(['c:T cell']) }, { key: 'cell-grouping-B' }]) {
        assert.notEqual(id({ ...base, ...change }), id(base), JSON.stringify(change));
    }
    assert.equal(chooser.layerOf(base), 'logged');
});

test('column names: row, header and export', () => {
    const half = tableHalfOf({ type: TYPE });
    const column = half.chooser.columnOf(ENTITY, choice);
    assert.equal(half.label(column), 'B cell: mean · logged');
    assert.ok(half.fullLabel(column).endsWith('B cell: mean · logged'));
    assert.ok(half.fullLabel(column).includes(' › '), 'the grouping, then the group');
    assert.equal(half.label({ ...column, stat: 'zscore_mean' }), 'B cell: z-score mean · logged');
});

test('the table\'s statistic list is the Gene Plot\'s, in order, without cell count, z-score mean graded by layout', () => {
    const half = tableHalfOf({ type: TYPE });
    const menu = (layout) => half.chooser.add.menus(ENTITY, { method: 'mean', layer: 'logged' }, { kinds: { logged: 'log' }, layouts: { logged: layout } });
    const csc = menu('csc').methods;
    assert.deepEqual(csc.map((o) => o.value), ['zscore_mean', 'mean', 'pct_expressing', 'mean_expressing', 'sum', 'sd']);
    assert.equal(csc[0].disabled, false);
    const csr = menu('csr').methods[0];
    assert.equal(csr.disabled, true);
    assert.match(csr.title, /whole-layer read/);
});
