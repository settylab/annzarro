/**
 * A table column that follows a focus must refresh when THAT focus changes,
 * and only then.
 *
 * Reported from a live instance: a cell table's "focused cell" obsp column
 * refreshed when the focused GENE changed and stayed stale when the focused
 * CELL changed. Cause: the cell table listened only to focusedGeneChanged (the
 * gene table only to focusedCellChanged), and the refresh test fired for any
 * focused-entity column, or any obsp/layer column, regardless of which focus
 * moved. The gene table had the mirror image for varp "focused gene" columns.
 *
 * This drives the REAL setupTableEventListeners -> updateTableOnFocusChange
 * chain and counts the refreshes it causes.
 *
 * Run:  node --test annzarro/tests/js/table-focus.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const doc = new EventTarget();
doc.getElementById = () => null;      // no column chooser in the DOM
doc.createElement = () => ({});
globalThis.document = doc;
globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.CustomEvent = class extends Event {
    constructor(type, init = {}) { super(type); this.detail = init.detail; }
};

const { DataManager } = await import('../../../static/js/data-manager.js');
const { setupTableEventListeners } = await import('../../../static/js/panels/table-utilities/listeners.js');
const { focusChangeAffectsColumns } = await import('../../../static/js/panels/table-utilities/table-data.js');

DataManager.getCurrentDataset = () => '/fixture.zarr';
DataManager.getDatasetStructure = async () => ({});

const settle = () => new Promise(r => setTimeout(r, 20));

/** Refreshes caused by one focus change, for a table holding `columns`. */
async function refreshesAfter(tableEntityType, columns, changed) {
    const id = `t-${Math.random()}`;
    let refreshes = 0;
    const settings = { id, columns };
    const dataTable = { settings: () => [{ _panelSettings: settings }] };
    const cleanup = setupTableEventListeners({
        id, settings, tableContainer: null, dataTable, entityType: tableEntityType,
        title: 't', refreshTable: () => { refreshes++; }
    });
    if (changed === 'cells') {
        document.dispatchEvent(new CustomEvent('focusedCellChanged', { detail: { cell: 'c1' } }));
    } else {
        document.dispatchEvent(new CustomEvent('focusedGeneChanged', { detail: { gene: 'g1' } }));
    }
    await settle();
    cleanup();
    return refreshes;
}

const CASES = [
    // table,   column,                                                    expected refreshes on [cell change, gene change]
    ['cells', { type: 'obsp', key: 'connectivities', column: 'focused_cell' }, [1, 0]],
    ['cells', { type: 'obsp', key: 'connectivities', column: '_focused_cell' }, [1, 0]],
    ['cells', { type: 'layer', key: 'counts', column: 'focused_gene' }, [0, 1]],
    ['genes', { type: 'varp', key: 'corr', column: 'focused_gene' }, [0, 1]],
    ['genes', { type: 'layer', key: 'counts', column: 'focused_cell' }, [1, 0]],
    // A FIXED entity does not follow focus at all.
    ['cells', { type: 'obsp', key: 'connectivities', column: 'cell_9' }, [0, 0]],
    ['genes', { type: 'varp', key: 'corr', column: 'GENE_9' }, [0, 0]],
    ['cells', { type: 'obs', key: 'celltype' }, [0, 0]],
];

for (const [table, column, [onCell, onGene]] of CASES) {
    const label = `${table} table, ${column.type}:${column.column ?? column.key}`;
    test(`${label}: focused CELL change -> ${onCell} refresh`, async () => {
        assert.equal(await refreshesAfter(table, [column], 'cells'), onCell);
    });
    test(`${label}: focused GENE change -> ${onGene} refresh`, async () => {
        assert.equal(await refreshesAfter(table, [column], 'genes'), onGene);
    });
}

test('focusChangeAffectsColumns tolerates junk input', () => {
    assert.equal(focusChangeAffectsColumns(undefined, 'cells'), false);
    assert.equal(focusChangeAffectsColumns([{ column: 'focused_cell' }], 'bogus'), false);
});
