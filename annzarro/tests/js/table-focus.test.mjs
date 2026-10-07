/* global document -- stubbed on globalThis below */
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
 * chain and counts what it does to the table.
 *
 * Issue #9: a table column depends on its cell or gene, never on the fact
 * that it was focused. A column picked from the focus names its entity, and
 * a "focused cell/gene" placeholder from an older view is pinned to a name
 * when its panel is made (table-focus-pin.test.mjs). So NO column is
 * reloaded on a focus change, placeholder or not, and the table is never
 * rebuilt for one.
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
const { getColumnKey } = await import('../../../static/js/panels/table-utilities/table-data.js');

DataManager.getCurrentDataset = () => '/fixture.zarr';
DataManager.getDatasetStructure = async () => ({});
const CELLS = ['c0', 'c1', 'c2'];
const GENES = ['g0', 'g1'];
DataManager.getCells = () => CELLS;
DataManager.getGenes = () => GENES;
DataManager.getCellIndex = (c) => CELLS.indexOf(c);
DataManager.resolveCellIndex = async (c) => CELLS.indexOf(c);
DataManager.locateCell = async (c) => ({ name: c, position: CELLS.indexOf(c), row: CELLS.indexOf(c),
                                         shown: CELLS.indexOf(c) >= 0 });
DataManager.getGeneIndex = (g) => GENES.indexOf(g);
DataManager.getFocusedCell = () => 'c1';
DataManager.getFocusedGene = () => 'g1';
// one row of the requested matrix, sized for the table that asked
DataManager.loadObsp = async () => ({ data: [[0.1, 0.2, 0.3]] });
DataManager.loadVarp = async () => ({ data: [[0.4, 0.5]] });
DataManager.loadLayer = async ({ cell }) => ({ data: cell ? [7, 8] : [1, 2, 3] });

const settle = () => new Promise(r => setTimeout(r, 20));

/** A DataTables stand-in holding `columns`, recording what is done to it. */
function fakeDataTable(settings, nRows, { inTable = true } = {}) {
    const rowsData = Array.from({ length: nRows }, (_, i) => ({ _index: `e${i}` }));
    const headers = [{ textContent: 'ID' }];
    const aoColumns = [{ mData: '_index' }];
    if (inTable) {
        for (const col of settings.columns) {
            aoColumns.push({ mData: getColumnKey(col) });
            headers.push({ textContent: 'old' });
        }
    }
    const log = { draws: 0, rowsData, headers };
    const dt = {
        settings: () => [{ _panelSettings: settings, aoColumns }],
        rows: () => ({
            count: () => rowsData.length,
            every(fn) { rowsData.forEach((row, i) => fn.call({ data: () => row }, i)); },
            invalidate: () => ({ draw: () => { log.draws++; } })
        }),
        column: (i) => ({ header: () => headers[i] })
    };
    return { dt, log };
}

/** What one focus change does to a table holding `columns`. */
async function afterFocusChange(tableEntityType, columns, changed, opts) {
    const id = `t-${Math.random()}`;
    let refreshes = 0;
    const settings = { id, columns };
    const { dt, log } = fakeDataTable(settings, tableEntityType === 'cells' ? CELLS.length : GENES.length, opts);
    const cleanup = setupTableEventListeners({
        id, settings, tableContainer: null, dataTable: dt, entityType: tableEntityType,
        title: 't', refreshTable: () => { refreshes++; }
    });
    if (changed === 'cells') {
        document.dispatchEvent(new CustomEvent('focusedCellChanged', { detail: { cell: 'c1' } }));
    } else {
        document.dispatchEvent(new CustomEvent('focusedGeneChanged', { detail: { gene: 'g1' } }));
    }
    await settle();
    cleanup();
    return { refreshes, inPlace: log.draws, log };
}

/** Column reloads caused by one focus change (in place; never a rebuild). */
async function refreshesAfter(tableEntityType, columns, changed) {
    const { refreshes, inPlace } = await afterFocusChange(tableEntityType, columns, changed);
    assert.equal(refreshes, 0, 'the whole table must not be rebuilt');
    return inPlace;
}

const CASES = [
    // table,   column,                                                    expected refreshes on [cell change, gene change]
    // A placeholder that reaches a live table does not follow the focus either
    ['cells', { type: 'obsp', key: 'connectivities', column: 'focused_cell' }, [0, 0]],
    ['cells', { type: 'obsp', key: 'connectivities', column: '_focused_cell' }, [0, 0]],
    ['cells', { type: 'layer', key: 'counts', column: 'focused_gene' }, [0, 0]],
    ['genes', { type: 'varp', key: 'corr', column: 'focused_gene' }, [0, 0]],
    ['genes', { type: 'layer', key: 'counts', column: 'focused_cell' }, [0, 0]],
    // A named entity does not follow focus at all.
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

test('a focus change leaves every column, its values and its header as they were', async () => {
    const cols = [{ type: 'obs', key: 'celltype' }, { type: 'obsp', key: 'connectivities', column: 'c1' },
                  { type: 'layer', key: 'counts', column: 'g0' }];
    const before = structuredClone(cols);
    for (const changed of ['cells', 'genes']) {
        const { refreshes, inPlace, log } = await afterFocusChange('cells', cols, changed);
        assert.equal(refreshes, 0);
        assert.equal(inPlace, 0);
        assert.ok(log.rowsData.every(r => Object.keys(r).length === 1), 'no column value was written');
        assert.ok(log.headers.slice(1).every(h => h.textContent === 'old'), 'no header was renamed');
    }
    assert.deepEqual(cols, before);
});
