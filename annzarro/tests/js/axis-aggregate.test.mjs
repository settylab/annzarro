/**
 * The aggregates of an axis (static/js/utils/axis-aggregate.js, axis-aggregate-picker-080): a set is picked in the item
 * picker of a layer, its aggregation is its provider's, and leaving the layer or picking a single item clears the set
 * completely, so no method, layer or group outlives it (the switch-back-to-varm bug).
 *
 * Run:  node --test annzarro/tests/js/axis-aggregate.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// the page's panel registry: no panels, so no signature is found (the symbols and names do not need one)
globalThis.PanelManager = { getPanel: () => null, getAllPanels: () => [], getActivePanels: () => [] };
await import('../../../static/js/utils/group-stat-source.js');
await import('../../../static/js/utils/table-stat-source.js');
await import('../../../static/js/utils/score-source.js');
const A = await import('../../../static/js/utils/axis-aggregate.js');
const { METHOD_INFO } = await import('../../../static/js/utils/signature-options.js');
const { STATISTIC_INFO } = await import('../../../static/js/utils/group-statistics.js');
const { SCORE_SYMBOLS, STAT_SYMBOLS } = await import('../../../static/js/utils/aggregation-symbols.js');
const { DEFAULT_METHOD } = await import('../../../static/js/utils/signature-options.js');

const score = () => ({ type: 'gene-score', key: 'gene-signature-S', column: 'mean', layer: 'counts', label: 'T cell score', labelFull: 'T cell score\nmean · counts', history: { layer: { key: 'X' } } });
const group = () => ({ type: 'group-stat', key: 'cell-grouping-A', column: '["c:B cell"]', stat: 'sd', layer: 'logged', groupWas: ['B cell'], follow: true, label: 'Grouping 1' });

test('a set setting is a set, shown as the layer source; a plain item and any other source are not', () => {
    assert.ok(A.isAggregate(score()) && A.isAggregate(group()));
    assert.equal(A.displayType(score()), 'layer');
    assert.equal(A.displayType(group()), 'layer');
    for (const plain of [{ type: 'layer', key: 'X', column: 'ACTB' }, { type: 'obsm', key: 'X_umap', column: '0' }, { type: 'none' }, null]) {
        assert.ok(!A.isAggregate(plain));
    }
    assert.equal(A.displayType({ type: 'obsm', key: 'X_umap' }), 'obsm');
    assert.equal(A.layerOfSetting(score()), 'counts');
    assert.equal(A.layerOfSetting(group()), 'logged');
    assert.equal(A.layerOfSetting({ type: 'layer', key: 'X' }), 'X');
});

test('a picker value is a set\'s provider and entry, and only a set\'s', () => {
    const value = A.encodeSet('gene-score', 'gene-signature-S');
    assert.deepEqual(A.decodeSet(value), { type: 'gene-score', entry: 'gene-signature-S' });
    assert.equal(A.decodeSet('ACTB'), null);
    assert.equal(A.decodeSet(A.encodeSet('layer', 'X')), null, 'a source that has no sets is not one');
    assert.equal(A.heldSet(score()), value);
    assert.equal(A.heldSet({ type: 'layer', key: 'X', column: 'ACTB' }), '');
});

test('picking a single item or a set clears the setting completely but its history', () => {
    const s = score();
    A.startItem(s, 'X', 'ACTB');
    assert.deepEqual(s, { history: { layer: { key: 'X' } }, type: 'layer', key: 'X', column: 'ACTB' });
    const g = group();
    A.startSet(g, A.encodeSet('gene-score', 'gene-signature-T'), 'logged');
    for (const stale of ['stat', 'groupWas', 'follow']) assert.ok(!(stale in g), `${stale} did not outlive the group`);
    assert.equal(g.type, 'gene-score');
    assert.equal(g.key, 'gene-signature-T');
    assert.equal(g.layer, 'logged');
    const left = A.clearSetting(score());
    assert.deepEqual(Object.keys(left), ['history'], 'leaving the layer source leaves nothing of the set');
});

test('the aggregations are the method tables\', in their order and with their names, each with a symbol', () => {
    // a signature's: every method of METHOD_INFO has a symbol, written once in aggregation-symbols.js; x and z carry a bar
    assert.deepEqual(Object.keys(SCORE_SYMBOLS), METHOD_INFO.map((m) => m.value));
    assert.deepEqual(SCORE_SYMBOLS.zscore_mean, { text: 'z', over: true });
    assert.deepEqual(SCORE_SYMBOLS.mean, { text: 'x', over: true });
    assert.equal(SCORE_SYMBOLS.fraction_of_total.text, '%');
    assert.ok(Object.values(SCORE_SYMBOLS).every((y) => !/\u0304/.test(y.text)), 'a bar is CSS, never a combining character');
    assert.deepEqual(Object.keys(STAT_SYMBOLS), STATISTIC_INFO.map((m) => m.value));
    assert.equal(A.aggregationOf(score()).symbol, SCORE_SYMBOLS.mean);
    assert.equal(A.aggregateOf(score()).aggregate.symbolOf(score()), SCORE_SYMBOLS.mean);
    // a new set starts on the table's default: z-score mean for a signature, mean for a group
    assert.equal(A.aggregateOf(score()).aggregate.start('gene-signature-S', 'X').column, DEFAULT_METHOD);
    assert.equal(DEFAULT_METHOD, 'zscore_mean');
    assert.equal(A.aggregateOf(group()).aggregate.start(JSON.stringify(['cell-grouping-A', '["c:B cell"]']), 'X').stat, 'mean');
    // a group's statistics
    const stats = A.aggregateOf(group()).aggregate.methods(group());
    assert.deepEqual(stats.options.map((o) => o.value), STATISTIC_INFO.map((m) => m.value));
    assert.deepEqual(stats.options.map((o) => o.name), STATISTIC_INFO.map((m) => m.label));
    assert.ok(stats.options.every((o) => o.symbol));
    assert.equal(A.aggregationOf(group()).name, 'SD');
});

test('a layer after the user moved it: the aggregation moves only when it became impossible, said once', () => {
    const s = { type: 'group-stat', key: 'cell-grouping-A', column: '["c:B cell"]', stat: 'fraction_of_cells', layer: 'logged', groupWas: ['B cell'] };
    const said = A.applyAfter(s, 'layer', 'X');
    assert.equal(s.layer, 'X');
    assert.equal(typeof said, 'string');
    assert.equal(A.applyAfter({ type: 'obsm' }, 'layer', 'X'), '', 'another source has nothing to move');
});

test('a Gene Plot lists cell groupings and cell tables, each section with a line of its own when it has no entry', () => {
    const sections = A.setSections('gene-plot', ['x']);
    assert.deepEqual(sections.map((g) => g.heading), ['Cell groupings', 'Cell tables']);
    assert.deepEqual(sections.map((g) => g.entries.map((e) => [e.text, e.disabled === true])), [[['No cell groupings yet', true]], [['No cell tables yet', true]]]);
    // the line is no choice: its value stands for no set
    for (const g of sections) assert.equal(A.decodeSet(g.entries[0].value), null);
    // a Cell Plot lists signatures and gene tables, never these
    assert.ok(!A.setSections('cell-plot', ['x']).some((g) => /Cell (groupings|tables)/.test(g.heading)));
});

test('a table is a set of its own with no members, read on a layer with the group statistics and the table\'s own default', () => {
    const table = { type: 'table-stat', key: 'cell-table-T', stat: 'sd', layer: 'logged', label: 'Table 1' };
    assert.ok(A.isAggregate(table));
    assert.equal(A.displayType(table), 'layer');
    assert.equal(A.membersOf(table), null, 'the table is the group: no select of members');
    assert.equal(A.heldSet(table), A.encodeSet('table-stat', 'cell-table-T'));
    const fresh = A.startSet({ type: 'layer', key: 'logged', column: 'CELL0001' }, A.encodeSet('table-stat', 'cell-table-T'), 'logged');
    assert.equal(fresh.type, 'table-stat');
    assert.equal(fresh.stat, 'mean');
    assert.ok(!('groupWas' in fresh) && !('follow' in fresh));
    const methods = A.aggregateOf(table).aggregate.methods(table);
    assert.deepEqual(methods.options.map((o) => o.value), STATISTIC_INFO.map((m) => m.value), 'the group statistics, in their order');
    assert.equal(methods.chosen, 'sd');
    // a table kept as the statistic it had when the user picks another table
    const next = A.startSet(table, A.encodeSet('table-stat', 'cell-table-U'), 'logged');
    assert.equal(next.stat, 'sd');
    assert.equal(next.key, 'cell-table-U');
});
