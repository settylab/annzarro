/**
 * Closed panels come back from links and panel sets (static/js/utils/closed-restore.js).
 *
 * Before this, a share link listed every panel's configuration, closed ones
 * included, and opening it restored none of the closed ones: a plot filtered
 * by a closed table lost its filter. The plan holds configuration only, for
 * every panel type, and is made before the open panels are built.
 *
 * Run:  node --test annzarro/tests/js/closed-restore.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { closedPanelsOfView, mergeClosedPlans, reconcileClosed } =
    await import('../../../static/js/utils/closed-restore.js');
const { normalizeView, panelSetToView } = await import('../../../static/js/utils/deeplink.js');

const KNOWN = new Set(['cell-plot', 'gene-plot', 'cell-table', 'gene-table', 'gene-set']);
const can = (type) => KNOWN.has(type);

const view = (open, configs) => ({
    v: 1,
    layout: {
        v: 1,
        hierarchy: open.map(id => ({ type: 'tile', id })),
        controlState: {},
        panelConfigs: configs
    }
});

test('every closed panel type comes back, with its configuration', () => {
    const configs = {
        'cell-plot-1': { id: 'cell-plot-1', tableFilter: 'cell-table-2' },
        'cell-plot-5': { id: 'cell-plot-5', title: 'Closed plot', color: { type: 'obs', key: 'cell_type', column: '' } },
        'gene-plot-6': { id: 'gene-plot-6', title: 'Closed gene plot' },
        'cell-table-2': { id: 'cell-table-2', title: 'Table 1', columns: [{ type: 'obs', key: 'a', column: '' }],
            searchText: 'T|B', searchRegex: true, searchSmart: true, searchCaseInsensitive: false },
        'gene-table-7': { id: 'gene-table-7', title: 'Genes', searchText: 'Cd' },
        'gene-set-8': { id: 'gene-set-8', title: 'GSA', tableFilter: 'gene-table-7' }
    };
    const { closed, skipped } = closedPanelsOfView(view(['cell-plot-1'], configs), can);
    assert.deepEqual(closed.map(p => [p.id, p.type]), [
        ['cell-plot-5', 'cell-plot'], ['gene-plot-6', 'gene-plot'], ['cell-table-2', 'cell-table'],
        ['gene-table-7', 'gene-table'], ['gene-set-8', 'gene-set']]);
    assert.deepEqual(skipped, []);
    const table = closed.find(p => p.id === 'cell-table-2').config;
    assert.equal(table.searchText, 'T|B');
    assert.equal(table.searchRegex, true);
    assert.equal(table.searchCaseInsensitive, false);
    assert.equal(table.title, 'Table 1');
});

test('open panels are not in the plan', () => {
    const { closed } = closedPanelsOfView(view(['cell-plot-1', 'cell-table-2'], {
        'cell-plot-1': { id: 'cell-plot-1' }, 'cell-table-2': { id: 'cell-table-2' }
    }), can);
    assert.deepEqual(closed, []);
});

test('configuration only: a table keeps no rows, no names and no computed values', () => {
    const { closed } = closedPanelsOfView(view([], {
        'cell-table-2': { id: 'cell-table-2', columns: [], searchText: 'x',
            currentEntries: [1, 2, 3], filteredCells: ['a'], closedSelection: { passing: ['a'] },
            _closed: true, active: false }
    }), can);
    assert.deepEqual(Object.keys(closed[0].config).sort(), ['columns', 'id', 'searchText']);
});

test('an unknown or disabled type is skipped, with no error, and the rest still come back', () => {
    const { closed, skipped } = closedPanelsOfView(view([], {
        'umap-widget-3': { id: 'umap-widget-3' },
        'cell-table-2': { id: 'cell-table-2' },
        'nodash': { id: 'nodash' },
        'gene-set-9': { id: 'gene-set-9' }
    }), (type) => type !== 'gene-set' && can(type));
    assert.deepEqual(closed.map(p => p.id), ['cell-table-2']);
    assert.deepEqual(skipped.map(p => p.id).sort(), ['gene-set-9', 'nodash', 'umap-widget-3']);
});

test('a malformed config is left out, not an error', () => {
    const { closed } = closedPanelsOfView(view([], { 'cell-table-2': null, 'cell-table-3': 'text', 'cell-table-4': { id: 'cell-table-4' } }), can);
    assert.deepEqual(closed.map(p => p.id), ['cell-table-4']);
});

test('the id of the config is the id of the tile, whatever the file says', () => {
    const { closed } = closedPanelsOfView(view([], { 'cell-table-2': { id: 'cell-table-99', title: 'T' } }), can);
    assert.equal(closed[0].config.id, 'cell-table-2');
});

test('old links: a view with no layout, an empty layout and a panels list have no closed panels', () => {
    assert.deepEqual(closedPanelsOfView(null, can), { closed: [], skipped: [] });
    assert.deepEqual(closedPanelsOfView({ v: 1 }, can), { closed: [], skipped: [] });
    assert.deepEqual(closedPanelsOfView({ v: 1, panels: [{ type: 'cell_plot', config: {} }] }, can).closed, []);
    // a v0.4.0 link: one layout whose panelConfigs are exactly its tiles
    const old = normalizeView({ v: 1, layout: { v: 1, hierarchy: [{ type: 'tile', id: 'cell-plot-1' }],
        controlState: { 'cell-plot-1': true }, panelConfigs: { 'cell-plot-1': { id: 'cell-plot-1', tableFilter: 'cell-table-2' } } } });
    assert.deepEqual(closedPanelsOfView(old, can).closed, []);
});

test('a link written before the search toggles were saved restores a table with none of them', () => {
    const { closed } = closedPanelsOfView(view([], { 'cell-table-2': { id: 'cell-table-2', searchText: 'T' } }), can);
    assert.equal('searchRegex' in closed[0].config, false);   // the table's own defaults apply
});

test('a panel set (new form) lists its closed panels as a link does', () => {
    const set = { name: 's', dataset: 'x.zarr', view: view(['cell-plot-1'], {
        'cell-plot-1': { id: 'cell-plot-1' }, 'cell-table-2': { id: 'cell-table-2', searchText: 'q' } }) };
    const plan = panelSetToView(set);
    assert.deepEqual(closedPanelsOfView(plan.view, can).closed.map(p => p.id), ['cell-table-2']);
    assert.deepEqual(plan.closedPanels.map(p => p.id), ['cell-table-2']);
});

test('a legacy panel set keeps its closed panels apart: merged, once, unknown types dropped', () => {
    const planned = closedPanelsOfView(view([], { 'cell-table-2': { id: 'cell-table-2', searchText: 'a' } }), can).closed;
    const merged = mergeClosedPlans(planned, [
        { id: 'cell-table-2', type: 'cell-table', config: { id: 'cell-table-2', searchText: 'other' } },
        { id: 'gene-table-3', type: 'gene-table', config: { id: 'gene-table-3' } },
        { id: 'widget-4', type: 'widget', config: { id: 'widget-4' } }
    ], can);
    assert.deepEqual(merged.map(p => p.id), ['cell-table-2', 'gene-table-3']);
    assert.equal(merged[0].config.searchText, 'a');
});

test('Back and Forward: a missing closed panel is added, a changed closed one replaced, the rest left', () => {
    const target = closedPanelsOfView(view([], {
        'cell-table-1': { id: 'cell-table-1', searchText: 'new' },
        'cell-table-2': { id: 'cell-table-2', searchText: 'same' },
        'gene-table-3': { id: 'gene-table-3', searchText: 'gone' },
        'cell-table-4': { id: 'cell-table-4', searchText: 'open now' }
    }), can).closed;
    const live = new Map([
        ['cell-table-1', { open: false, config: { id: 'cell-table-1', searchText: 'old', searchRegex: false } }],
        // the page's panel has defaults the entry does not list: the same
        ['cell-table-2', { open: false, config: { id: 'cell-table-2', searchText: 'same', searchRegex: false, columns: [] } }],
        ['cell-table-4', { open: true, config: { id: 'cell-table-4', searchText: 'other' } }],
        ['cell-table-9', { open: false, config: { id: 'cell-table-9' } }]
    ]);
    const { add, replace } = reconcileClosed(target, live);
    assert.deepEqual(add.map(p => p.id), ['gene-table-3']);
    assert.deepEqual(replace.map(p => p.id), ['cell-table-1']);
});

test('reconciling twice changes nothing the second time', () => {
    const target = closedPanelsOfView(view([], { 'cell-table-1': { id: 'cell-table-1', searchText: 'a' } }), can).closed;
    const live = new Map();
    const first = reconcileClosed(target, live);
    first.add.forEach(p => live.set(p.id, { open: false, config: p.config }));
    assert.deepEqual(reconcileClosed(target, live), { add: [], replace: [] });
});
