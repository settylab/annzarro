/**
 * A panel set restores the view a share link restores.
 *
 * Loading a panel set used to only register its panels as CLOSED: no
 * dataset, no focused cell/gene, no split layout. And registerClosedPanel
 * renamed any panel whose id was taken, which silently cut a plot's
 * `tableFilter` link to its table. Panel sets now store the share-link view
 * and utils/deeplink.js panelSetToView turns a stored set (new or legacy)
 * into what the deep-link path applies, keeping every id.
 *
 * Fixture: the paper's demo set E (cell table with an Advanced Search
 * filter, UMAP filtered by that table), in the legacy format it was saved in.
 *
 * Run:  node --test annzarro/tests/js/panelset-view.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
    panelSetToView, defaultHierarchy, remapPanelReferences, collectTileIds, closePlanPanels, panelsToAdd, VIEW_SCHEMA_VERSION
} = await import('../../../static/js/utils/deeplink.js');

const legacyE = () => ({
    name: 'protocol_E_table_filter',
    dataset: '/data/bm_aging.zarr',
    datasetName: 'bm_aging',
    constants: { focusedCell: 'HSPC_Old_1#GAAGCCCGTGGCTCTG-1', focusedGene: 'S100a9', taxonomyId: '10090' },
    panelConfigs: {
        'cell-table-E1': {
            id: 'cell-table-E1', type: 'cell-table', title: 'E | HSC with DA z-score > 2',
            config: {
                id: 'cell-table-E1', title: 'E | HSC with DA z-score > 2',
                columns: [{ type: 'obs', key: 'highres_celltype', column: '' }],
                searchBuilderConfig: { criteria: [{ condition: '=', data: 'highres_celltype', type: 'string', value: ['HSC'] }], logic: 'AND' }
            },
            isSelectionTile: false
        },
        'cell-plot-E2': {
            id: 'cell-plot-E2', type: 'cell-plot', title: 'E | UMAP masked by table filter',
            config: { id: 'cell-plot-E2', title: 'E | UMAP masked by table filter', tableFilter: 'cell-table-E1' },
            isSelectionTile: false
        },
        'cell-plot-old': {
            id: 'cell-plot-old', type: 'cell-plot', title: 'closed one',
            config: { id: 'cell-plot-old', active: false }, isSelectionTile: false
        }
    }
});

test('a legacy set opens its open panels, with dataset, focus and ids intact', () => {
    const plan = panelSetToView(legacyE());
    assert.equal(plan.legacy, true);
    assert.equal(plan.datasetPath, '/data/bm_aging.zarr');
    assert.deepEqual(plan.view.constants, legacyE().constants);
    assert.deepEqual(collectTileIds(plan.view.layout.hierarchy), ['cell-table-E1', 'cell-plot-E2']);
    // the plot -> table link survives: same ids, same reference
    assert.equal(plan.view.layout.panelConfigs['cell-plot-E2'].tableFilter, 'cell-table-E1');
    assert.equal(plan.view.layout.panelConfigs['cell-table-E1'].searchBuilderConfig.criteria[0].value[0], 'HSC');
    // the panel that was closed when saved comes back closed
    assert.deepEqual(plan.closedPanels.map(p => p.id), ['cell-plot-old']);
});

test('a set with a view restores that view verbatim', () => {
    const layout = {
        v: 1,
        hierarchy: [{ type: 'split', direction: 'vertical', panes: [{ percentage: 30 }, { percentage: 70 }],
            children: [{ type: 'tile', id: 'cell-table-1' }, { type: 'tile', id: 'cell-plot-2' }] }],
        controlState: { 'cell-table-1': false, 'cell-plot-2': true },
        panelConfigs: {
            'cell-table-1': { id: 'cell-table-1', title: 't' },
            'cell-plot-2': { id: 'cell-plot-2', tableFilter: 'cell-table-1' },
            'gene-plot-3': { id: 'gene-plot-3', title: 'closed when saved' }
        }
    };
    const set = { ...legacyE(), view: { v: 1, constants: { focusedCell: 'c9', focusedGene: 'g1' }, layout } };
    const plan = panelSetToView(set);
    assert.equal(plan.legacy, false);
    assert.equal(plan.datasetPath, '/data/bm_aging.zarr');
    assert.deepEqual(plan.view.constants, { focusedCell: 'c9', focusedGene: 'g1' });
    assert.deepEqual(plan.view.layout, layout, 'the split, sizes and controls must survive unchanged');
    assert.deepEqual(plan.closedPanels, [{ id: 'gene-plot-3', type: 'gene-plot', config: { id: 'gene-plot-3', title: 'closed when saved' } }]);
});

test('a view without constants falls back to the set constants', () => {
    const plan = panelSetToView({ ...legacyE(), view: { v: 1 } });
    assert.equal(plan.view.constants.focusedGene, 'S100a9');
    assert.equal(plan.view.layout, undefined);
});

test('nothing to open is a plan with no layout, not an error', () => {
    const plan = panelSetToView({ name: 'x', dataset: '/d', panelConfigs: {} });
    assert.equal(plan.view.v, VIEW_SCHEMA_VERSION);
    assert.equal(plan.view.layout, undefined);
    assert.deepEqual(plan.closedPanels, []);
    assert.equal(panelSetToView(null), null);
});

test('defaultHierarchy lays panels out in rows of two', () => {
    assert.deepEqual(defaultHierarchy([]), []);
    assert.deepEqual(defaultHierarchy(['a-1']), [{ type: 'tile', id: 'a-1' }]);
    const three = defaultHierarchy(['a-1', 'b-2', 'c-3']);
    assert.deepEqual(collectTileIds(three), ['a-1', 'b-2', 'c-3']);
    assert.equal(three[0].direction, 'vertical');
    assert.equal(three[0].children[0].direction, 'horizontal');
    assert.equal(three[0].children[1].id, 'c-3');
    const five = defaultHierarchy(['a-1', 'b-2', 'c-3', 'd-4', 'e-5']);
    assert.deepEqual(five[0].panes.map(p => p.percentage), [33, 67]);
    assert.deepEqual(collectTileIds(five), ['a-1', 'b-2', 'c-3', 'd-4', 'e-5']);
});

test('remapPanelReferences moves tableFilter to a renamed table', () => {
    const configs = [{ id: 'cell-plot-1', tableFilter: 'cell-table-1' }, { id: 'cell-plot-2', tableFilter: 'none' }];
    remapPanelReferences(configs, new Map([['cell-table-1', 'cell-table-99']]));
    assert.equal(configs[0].tableFilter, 'cell-table-99');
    assert.equal(configs[1].tableFilter, 'none');
});

test('derived table state is not serialized into links or panel sets', async () => {
    // an unfiltered 8,090-row table put every row index into the share link
    // (23,674 characters headless on protocol-integration; 544 without)
    const { serializableConfig } = await import('../../../static/js/utils/deeplink.js');
    const live = { title: 't', columns: [{ type: 'obs', key: 'Age' }], searchBuilderConfig: { criteria: [], logic: 'AND' } };
    Object.defineProperty(live, 'currentEntries', { enumerable: true, get: () => Array.from({ length: 8090 }, (_, i) => i) });
    live.filteredCells = ['a', 'b'];
    const out = serializableConfig(live);
    assert.equal('currentEntries' in out, false);
    assert.equal('filteredCells' in out, false);
    assert.deepEqual(out.columns, live.columns);
    assert.deepEqual(out.searchBuilderConfig, { criteria: [], logic: 'AND' });
});

test('the same store named relative and absolute is not a dataset switch', async () => {
    // The docs' fig1 panel set names 'bm_aging.zarr'; with the absolute path
    // open, loading it asked "Switch dataset?" (strings were compared).
    const { sameDatasetPath } = await import('../../../static/js/utils/deeplink.js');
    const listing = [{ path: '/data/bm_aging.zarr', rel_path: 'bm_aging.zarr', name: 'bm_aging.zarr' }];
    assert.equal(sameDatasetPath('bm_aging.zarr', '/data/bm_aging.zarr', listing), true);
    assert.equal(sameDatasetPath('bm_aging.zarr', '/data/bm_aging.zarr'), true, 'without a listing: suffix match');
    assert.equal(sameDatasetPath('./sub//x.zarr/', '/data/sub/x.zarr'), true);
    assert.equal(sameDatasetPath('other.zarr', '/data/bm_aging.zarr', listing), false);
    assert.equal(sameDatasetPath('/a/x.zarr', '/b/x.zarr'), false);
    assert.equal(sameDatasetPath('s3://bucket/x.zarr', 's3://bucket/x.zarr'), true);
    assert.equal(sameDatasetPath('', '/data/x.zarr'), false);
});

// A panel set the user loads opens none of its panels: on a large set that
// could overload the machine (operator report). closePlanPanels keeps the
// dataset, subset and focus and lists every panel closed with its config.
test('closePlanPanels lists every panel of a set closed, open ones first', () => {
    const plan = panelSetToView({ ...legacyE(), view: { v: 1, subset: { n: 500, seed: 0 },
        constants: { focusedCell: 'c9' },
        layout: { v: 1, hierarchy: [{ type: 'split', direction: 'horizontal',
            panes: [{ percentage: 50 }, { percentage: 50 }],
            children: [{ type: 'tile', id: 'cell-table-1' }, { type: 'tile', id: 'cell-plot-2' }] }],
            panelConfigs: { 'cell-table-1': { id: 'cell-table-1', title: 't' },
                            'cell-plot-2': { id: 'cell-plot-2', tableFilter: 'cell-table-1', pointSize: 3 },
                            'gene-plot-3': { id: 'gene-plot-3' } } } } });
    const before = JSON.parse(JSON.stringify(plan));
    const closed = closePlanPanels(plan);
    assert.deepEqual(plan, before, 'the input plan is not changed');
    assert.equal(closed.view.layout, undefined);
    // the set's view is kept whole for "Open saved layout"
    assert.deepEqual(closed.savedView, before.view);
    assert.equal(closed.savedCount, 2);
    assert.equal(closed.view.panels, undefined);
    assert.deepEqual(closed.view.subset, { n: 500, seed: 0 });
    assert.deepEqual(closed.view.constants, { focusedCell: 'c9' });
    assert.equal(closed.datasetPath, '/data/bm_aging.zarr');
    assert.deepEqual(closed.closedPanels, [
        { id: 'cell-table-1', type: 'cell-table', config: { id: 'cell-table-1', title: 't' } },
        { id: 'cell-plot-2', type: 'cell-plot', config: { id: 'cell-plot-2', tableFilter: 'cell-table-1', pointSize: 3 } },
        { id: 'gene-plot-3', type: 'gene-plot', config: { id: 'gene-plot-3' } }
    ]);
});

test('closePlanPanels closes a legacy set\'s panels too, settings kept', () => {
    const closed = closePlanPanels(panelSetToView(legacyE()));
    assert.equal(closed.view.layout, undefined);
    assert.deepEqual(closed.closedPanels.map(p => p.id), ['cell-table-E1', 'cell-plot-E2', 'cell-plot-old']);
    assert.equal(closed.closedPanels[1].config.tableFilter, 'cell-table-E1');
    assert.equal(closed.closedPanels[0].config.searchBuilderConfig.criteria[0].value[0], 'HSC');
});

test('closePlanPanels takes the flat panel list of a hand-written view', () => {
    const closed = closePlanPanels({ datasetPath: '/d', legacy: false, closedPanels: [],
        view: { v: 1, panels: [{ type: 'cell_plot', title: 'P', config: { pointSize: 4 } }] } });
    assert.equal(closed.view.panels, undefined);
    assert.deepEqual(closed.closedPanels, [{ id: null, type: 'cell-plot', config: { pointSize: 4, title: 'P' } }]);
    assert.equal(closed.savedCount, 1);
    assert.equal(closePlanPanels(null), null);
});

test('closePlanPanels offers no saved layout for a set that opens nothing', () => {
    const closed = closePlanPanels(panelSetToView({ name: 'x', dataset: '/d', panelConfigs: {} }));
    assert.equal(closed.savedView, null);
    assert.equal(closed.savedCount, 0);
});

// "Add to closed panels" (operator follow-up): the set's panels join the
// closed list beside what is open. Clashing ids get fresh ones, and a plot's
// tableFilter follows its own table's rename instead of landing on the open
// panel that has the old id.
const counter = () => { let n = 0; return type => `${type}-new${++n}`; };

test('panelsToAdd keeps ids that are free, with every config', () => {
    const added = panelsToAdd(panelSetToView(legacyE()), () => false, counter());
    assert.deepEqual(added.map(p => [p.type, p.config.id]),
        [['cell-table', 'cell-table-E1'], ['cell-plot', 'cell-plot-E2'], ['cell-plot', 'cell-plot-old']]);
    assert.equal(added[1].config.tableFilter, 'cell-table-E1');
    assert.equal(added[0].config.searchBuilderConfig.criteria[0].value[0], 'HSC');
});

test('panelsToAdd renames clashing ids and keeps tableFilter inside the set', () => {
    const open = new Set(['cell-table-E1', 'cell-plot-E2']);   // the same set is open already
    const added = panelsToAdd(panelSetToView(legacyE()), id => open.has(id), counter());
    const ids = added.map(p => p.config.id);
    assert.deepEqual(ids, ['cell-table-new1', 'cell-plot-new2', 'cell-plot-old']);
    assert.equal(new Set(ids).size, ids.length);
    // the plot filters by the ADDED table, not the open one with the old id
    assert.equal(added[1].config.tableFilter, 'cell-table-new1');
});

test('panelsToAdd leaves the plan alone and gives every panel an id', () => {
    const plan = panelSetToView(legacyE());
    const before = JSON.parse(JSON.stringify(plan));
    panelsToAdd(plan, id => !id.includes('-new'), counter());   // every saved id taken
    assert.deepEqual(plan, before);
    const flat = panelsToAdd({ datasetPath: '/d', legacy: false, closedPanels: [],
        view: { v: 1, panels: [{ type: 'cell_plot' }, { type: 'cell_plot' }] } }, () => false, counter());
    assert.deepEqual(flat.map(p => p.config.id), ['cell-plot-new1', 'cell-plot-new2']);
    assert.deepEqual(panelsToAdd(null, () => false, counter()), []);
});
