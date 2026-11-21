/**
 * C2a: a count plot is a source of the page's group sources (utils/group-host.js). A panel with `groupSource()`
 * describes itself (its config read in count-plot-model.js `gridShape`), and it is off only when its own panel type
 * is turned off by policy, not when Cell Grouping is.
 *
 * Run:  node --test annzarro/tests/js/group-host-count.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'offline in test' });
const { DataManager } = await import('../../../static/js/data-manager.js');
const G = await import('../../../static/js/utils/group-host.js');
const M = await import('../../../static/js/utils/count-plot-model.js');

Object.assign(DataManager, {
    getCurrentDataset: () => 'd.zarr', getCells: () => ['c0', 'c1'], getSubsetParam: () => null, getGenes: () => [], isDatasetLoaded: () => false
});

const config = M.normalizeCountPlot({ version: 1, mode: 'bar' }).config;
const shape = M.gridShape({ isNumeric: () => false, levelCount: () => null });
const count = { getId: () => 'cell-count-1', getType: () => 'cell-count', getTitle: () => 'Count 1', getConfig: () => config,
    groupSource: () => ({ title: 'Count 1', kind: 'count', recipe: () => config, shape }) };
const grouping = { getId: () => 'cell-grouping-1', getType: () => 'cell-grouping', getTitle: () => 'Grouping 1',
    getRecipe: () => ({ version: 1, partitionings: [] }), getConfig: () => ({}) };
const all = { 'cell-count-1': count, 'cell-grouping-1': grouping };
globalThis.PanelManager = { getPanel: (id) => all[id] || null, getActivePanels: () => Object.values(all), getAllPanels: () => Object.values(all) };

test('a panel with groupSource() is a source of the page\'s groups: its plan is its state', () => {
    const h = G.groupSources().sources.watch('cell-count-1', { consumer: { kind: 'plot', panelId: 'cell-count-1', role: 'panel' }, option: {},
        visible: () => true, onChange: () => {} });
    const snap = h.read();
    assert.equal(snap.state, 'empty', JSON.stringify(snap));
    assert.equal(snap.reason, 'choose_x');
    h.release();
});

test('a count plot is off with its own panel type, a grouping with Cell Grouping\'s', () => {
    const off = (types) => (type) => !types.includes(type);
    assert.equal(G.sourceOff('cell-count-1', off(['cell-grouping'])), false);
    assert.equal(G.sourceOff('cell-count-1', off(['cell-count'])), true);
    assert.equal(G.sourceOff('cell-grouping-1', off(['cell-count'])), false);
    assert.equal(G.sourceOff('cell-grouping-1', off(['cell-grouping'])), true);
    assert.equal(G.sourceOff(undefined, off(['cell-grouping'])), true, 'no id: as before, Cell Grouping\'s');
    assert.equal(G.sourceOff('cell-count-1'), false, 'the policy says nothing: on');
});
