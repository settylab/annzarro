/* global document -- stubbed on globalThis below */
/**
 * A table column is fixed to its cell or gene. The focus only helps pick it;
 * the column never follows a later focus change (issue #9, operator rule).
 *
 * Columns chosen from the focus have stored the entity's name since #9. The
 * remaining gap was a `focused_cell` / `focused_gene` placeholder restored
 * from an older session, panel set or view JSON: it still read whatever was
 * focused, so a focus change after restore reloaded the column and re-ran the
 * filter conditions on it. Now the table panel pins such a placeholder to the
 * entity focused when the panel is made (the view's own focus is restored
 * before its panels, main.js `_applyView`), moves the filter conditions to
 * the renamed column, and nothing after that reads the focus.
 *
 * Run:  node --test annzarro/tests/js/table-focus-pin.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const doc = new EventTarget();
doc.getElementById = () => null;
doc.createElement = () => ({});
doc.querySelector = () => null;
doc.querySelectorAll = () => [];
globalThis.document = doc;
globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.CustomEvent = class extends Event {
    constructor(type, init = {}) { super(type); this.detail = init.detail; }
};
globalThis.fetch = async () => ({ ok: false, status: 404, headers: new Map(), json: async () => ({}) });

const { DataManager } = await import('../../../static/js/data-manager.js');
const { pinFocusPlaceholders, getColumnKey, getColumnDisplayName, loadTableData } =
    await import('../../../static/js/panels/table-utilities/table-data.js');
const { setupTableEventListeners } = await import('../../../static/js/panels/table-utilities/listeners.js');
const { GeneTablePanel } = await import('../../../static/js/panels/gene-table.js');
const { CellTablePanel } = await import('../../../static/js/panels/cell-table.js');
const { NOTIFY_EVENT } = await import('../../../static/js/utils/notify.js');

const CELLS = ['c0', 'c1', 'c2'];
const GENES = ['g0', 'g1', 'g2'];
let focusedCell = 'c1';
let focusedGene = 'g1';
DataManager.getCurrentDataset = () => '/fixture.zarr';
DataManager.getDatasetStructure = async () => ({});
DataManager.isDatasetLoaded = () => false;
DataManager.getCells = () => CELLS;
DataManager.getGenes = () => GENES;
DataManager.getCellIndex = (c) => CELLS.indexOf(c);
DataManager.cellShown = (c) => (CELLS.includes(c) ? true : undefined);   // as the real one: unknown names are undefined
DataManager.locateCell = async (c) => ({ name: c, position: CELLS.indexOf(c), row: CELLS.indexOf(c),
                                         shown: CELLS.indexOf(c) >= 0 });
DataManager.cellRowParams = (cell) => (cell && cell.position >= 0 ? { rows: String(cell.position) } : null);
DataManager.getGeneIndex = (g) => GENES.indexOf(g);
DataManager.getFocusedCell = () => focusedCell;
DataManager.getFocusedGene = () => focusedGene;
// every read is recorded, so a test can say WHICH entity a column read
const reads = [];
DataManager.loadVarp = async ({ rows }) => { reads.push(`varp:${GENES[rows[0]]}`); return { data: [[0.1 * rows[0], 0.5, 0.9]] }; };
DataManager.loadObsp = async ({ cell }) => { reads.push(`obsp:${cell.name}`); return { data: [[0.1, 0.2, 0.3]] }; };
DataManager.loadLayer = async ({ cell, cols }) => {
    reads.push(cell ? `layer:${cell.name}` : `layer:${GENES[cols[0]]}`);
    return { data: cell ? [1, 2, 3] : [4, 5, 6] };
};
DataManager.loadVar = async ({ columns }) => ({ data: { [columns[0]]: [1, 2, 3] } });

const settle = () => new Promise(r => setTimeout(r, 20));

const VARP = { type: 'varp', key: 'corr', column: 'focused_gene' };
const LAYER = { type: 'layer', key: 'X', column: '_focused_cell' };
const crit = (col, value) => ({ condition: '>', data: 'old title', origData: getColumnKey(col),
                                type: 'num', value: [String(value)] });

/** A saved gene-table view: a placeholder varp and layer column, filtered. */
function savedGeneTable() {
    return {
        id: 'gene-table-saved', title: 'Similar to the focused gene',
        columns: [{ type: 'var', key: 'means', column: '' }, { ...VARP }, { ...LAYER }],
        searchBuilderConfig: {
            logic: 'AND',
            criteria: [
                crit(VARP, 0.3),
                { logic: 'OR', criteria: [crit(LAYER, 1), crit({ type: 'var', key: 'means' }, 2)] }
            ]
        }
    };
}

// ---------------------------------------------------------------- pure rule

test('a placeholder is pinned to the focused entity and its conditions follow the rename', () => {
    const saved = savedGeneTable();
    const frozen = structuredClone(saved);
    const r = pinFocusPlaceholders(saved.columns, saved.searchBuilderConfig, { cell: 'c2', gene: 'g0' });
    assert.deepEqual(r.columns, [
        { type: 'var', key: 'means', column: '' },
        { type: 'varp', key: 'corr', column: 'g0' },
        { type: 'layer', key: 'X', column: 'c2' }
    ]);
    assert.equal(r.dropped.length, 0);
    assert.equal(r.pinned.length, 2);
    const [top, group] = r.searchBuilderConfig.criteria;
    assert.equal(top.origData, 'varp_corr_g0');
    assert.equal(top.data, 'corr: g0');
    assert.equal(group.logic, 'OR');
    assert.equal(group.criteria[0].origData, 'layer_X_c2');
    assert.equal(group.criteria[1].origData, 'var_means_main', 'a condition on another column is kept as it was');
    assert.equal(r.searchBuilderConfig.logic, 'AND');
    assert.deepEqual(saved, frozen, 'the saved settings are not changed in place');
});

test('a pinned column that already exists by name is kept once, with both conditions', () => {
    const named = { type: 'varp', key: 'corr', column: 'g1' };
    const r = pinFocusPlaceholders([named, { ...VARP }],
        { criteria: [crit(named, 0.1), crit(VARP, 0.2)] }, { gene: 'g1' });
    assert.deepEqual(r.columns, [named]);
    assert.deepEqual(r.searchBuilderConfig.criteria.map(c => c.origData), ['varp_corr_g1', 'varp_corr_g1']);
});

test('with nothing focused the placeholder is removed with its conditions, and an emptied group too', () => {
    const saved = savedGeneTable();
    const r = pinFocusPlaceholders(saved.columns, {
        logic: 'AND', criteria: [crit(VARP, 0.3), { logic: 'OR', criteria: [crit(LAYER, 1)] }]
    }, { cell: null, gene: null });
    assert.deepEqual(r.columns, [{ type: 'var', key: 'means', column: '' }]);
    assert.equal(r.dropped.length, 2);
    assert.deepEqual(r.searchBuilderConfig.criteria, []);
});

test('only the missing focus drops its placeholder', () => {
    const saved = savedGeneTable();
    const r = pinFocusPlaceholders(saved.columns, saved.searchBuilderConfig, { cell: null, gene: 'g2' });
    assert.deepEqual(r.columns.map(c => c.column), ['', 'g2']);
    assert.deepEqual(r.dropped, [LAYER]);
    const [top, group] = r.searchBuilderConfig.criteria;
    assert.equal(top.origData, 'varp_corr_g2');
    assert.deepEqual(group.criteria.map(c => c.origData), ['var_means_main']);
});

test('settings without a placeholder come back as the same objects', () => {
    const cols = [{ type: 'varp', key: 'corr', column: 'g0' }];
    const sb = { criteria: [crit(cols[0], 1)] };
    const r = pinFocusPlaceholders(cols, sb, { cell: 'c0', gene: 'g2' });
    assert.equal(r.columns, cols);
    assert.equal(r.searchBuilderConfig, sb);
    assert.equal(pinFocusPlaceholders(undefined, undefined, {}).columns, undefined);
});

test('an unresolved placeholder never reads the focus', async () => {
    reads.length = 0;
    const t = await loadTableData({ columns: [{ ...VARP }] }, 'genes');
    assert.deepEqual(reads, []);
    assert.match(t.coverage.lines().join('\n'), /names no gene/);
    assert.equal(getColumnDisplayName(VARP), 'corr: no gene (unresolved placeholder)');
});

// ------------------------------------------------- the real panels, restored

/** Fire both focus changes at a table whose settings are `settings`. */
async function changeFocus(settings, tableEntityType, cell, gene) {
    let rebuilt = 0;
    const aoColumns = [{ mData: '_index' }, ...settings.columns.map(c => ({ mData: getColumnKey(c) }))];
    let written = 0;
    const dt = {
        settings: () => [{ _panelSettings: settings, aoColumns }],
        rows: () => ({ count: () => 3, every() { written++; }, invalidate: () => ({ draw() {} }) }),
        column: () => ({ header: () => ({}) })
    };
    const cleanup = setupTableEventListeners({
        id: settings.id, settings, tableContainer: null, dataTable: dt, entityType: tableEntityType,
        title: 't', refreshTable: () => { rebuilt++; }
    });
    focusedCell = cell;
    focusedGene = gene;
    document.dispatchEvent(new CustomEvent('focusedCellChanged', { detail: { cell } }));
    document.dispatchEvent(new CustomEvent('focusedGeneChanged', { detail: { gene } }));
    await settle();
    cleanup();
    return { rebuilt, written };
}

test('gene table restored from a view: a later focus change leaves its columns and filters untouched', async () => {
    focusedCell = 'c1';
    focusedGene = 'g1';
    const panel = GeneTablePanel({}, savedGeneTable());
    const config = panel.getConfig();
    assert.deepEqual(config.columns.map(c => c.column), ['', 'g1', 'c1'], 'pinned to the restored focus');
    const columns = structuredClone(config.columns);
    const filters = structuredClone(config.searchBuilderConfig);
    assert.equal(filters.criteria[0].origData, 'varp_corr_g1');

    const { rebuilt, written } = await changeFocus(config, 'genes', 'c0', 'g2');
    assert.equal(rebuilt, 0, 'the table is not rebuilt');
    assert.equal(written, 0, 'no column is reloaded in place');
    const after = panel.getConfig();
    assert.deepEqual(after.columns, columns);
    assert.deepEqual(after.searchBuilderConfig, filters);

    // and the table, built after the focus moved, still reads the pinned entities
    reads.length = 0;
    const t = await loadTableData(after, 'genes');
    assert.deepEqual(reads, ['varp:g1', 'layer:c1']);
    assert.deepEqual(t.columns.map(c => c.title), ['Gene ID', 'means', 'corr: g1', 'X: c1']);
});

test('cell table restored from a view: pinned the same way, never follows', async () => {
    focusedCell = 'c2';
    focusedGene = 'g0';
    const obsp = { type: 'obsp', key: 'connectivities', column: 'focused_cell' };
    const layer = { type: 'layer', key: 'X', column: 'focused_gene' };
    const panel = CellTablePanel({}, {
        id: 'cell-table-saved', title: 'Neighbours',
        columns: [obsp, layer],
        searchBuilderConfig: { logic: 'OR', criteria: [crit(obsp, 0), crit(layer, 3)] }
    });
    const config = panel.getConfig();
    assert.deepEqual(config.columns.map(c => c.column), ['c2', 'g0']);
    assert.deepEqual(config.searchBuilderConfig.criteria.map(c => c.origData),
        ['obsp_connectivities_c2', 'layer_X_g0']);
    assert.equal(config.searchBuilderConfig.logic, 'OR');
    const before = structuredClone({ columns: config.columns, sb: config.searchBuilderConfig });

    const { rebuilt, written } = await changeFocus(config, 'cells', 'c0', 'g2');
    assert.equal(rebuilt + written, 0);
    assert.deepEqual({ columns: panel.getConfig().columns, sb: panel.getConfig().searchBuilderConfig }, before);
    reads.length = 0;
    await loadTableData(panel.getConfig(), 'cells');
    assert.deepEqual(reads, ['obsp:c2', 'layer:g0']);
});

test('restored with nothing focused: the placeholder is removed, said once, and focusing later adds nothing', async () => {
    focusedCell = null;
    focusedGene = null;
    const said = [];
    const listen = (e) => said.push(e.detail);
    document.addEventListener(NOTIFY_EVENT, listen);
    const panel = GeneTablePanel({}, savedGeneTable());
    document.removeEventListener(NOTIFY_EVENT, listen);
    const config = panel.getConfig();
    assert.deepEqual(config.columns, [{ type: 'var', key: 'means', column: '' }]);
    assert.deepEqual(config.searchBuilderConfig.criteria,
        [{ logic: 'OR', criteria: [crit({ type: 'var', key: 'means' }, 2)] }]);
    assert.equal(said.length, 1);
    assert.match(said[0].message, /corr \(focused gene\), X \(focused cell\)/);

    await changeFocus(config, 'genes', 'c1', 'g1');
    assert.deepEqual(panel.getConfig().columns, [{ type: 'var', key: 'means', column: '' }]);
});
