/**
 * The browser side of utils/table-resolver.js: build the filter of a CLOSED table in the
 * background, hand it to the plots as the table's closed selection, and let everything else go.
 *
 * The build is a detached DataTable (Option A-min of design-gene-signature.md 8.2): it loads only
 * the columns the filter uses, or every column when the table has search text (the search spans all
 * of them), and runs the SAME SearchBuilder and search code as an open table
 * (initializeDataTable with `headless`), so it selects the same rows by construction. Afterwards
 * only the compact selection (utils/closed-table.js) stays; the rows are released (releaseTable).
 *
 * The build and its release are one uninterrupted task (nothing else can see a half-released
 * table), and that task is the page freeze the size limits (TABLE_LIMITS) are chosen for.
 */
import { DataManager } from '../../data-manager.js';
import { TableResolver } from '../../utils/table-resolver.js';
import { referencedKeys } from '../../utils/line-select.js';
import { freezeSelection } from '../../utils/closed-table.js';
import { tableCheck, refusalPanel } from '../../utils/memory-guard-ui.js';
import { loadTableData, initializeDataTable, releaseTable, getColumnKey } from './table-data.js';
import { TableScores, tileOnScreen } from './table-scores.js';
import { usedScoreColumns } from '../../utils/score-column.js';
import { dependsOn, usersOf, setReferenceHost } from '../../utils/panel-references.js';

const TABLE_KINDS = new Set(['cell-table', 'gene-table']);

/**
 * The columns a background build loads for a table's configuration: those its filter has a
 * condition on, or all of them when the table has search text.
 * @param {{columns?: Object[], searchText?: string, searchBuilderConfig?: Object}} config
 * @returns {Object[]}
 */
export function neededColumns(config) {
    const columns = Array.isArray(config.columns) ? config.columns : [];
    if (config.searchText) return columns;
    const keys = referencedKeys(config.searchBuilderConfig);
    return columns.filter(c => keys.has(getColumnKey(c)));
}

/** Whether the configuration filters at all: a table that does not passes every row. */
export function filters(config) {
    return !!config.searchText || referencedKeys(config.searchBuilderConfig).size > 0;
}

/**
 * Build the selection of a closed table: the names of the rows that pass its filter, and of every
 * row it has, for the cells (or genes) shown now.
 * @param {{kind: string, config: Object, signal: AbortSignal, check: Function}} job
 * @returns {Promise<{passing, seen}>} (utils/closed-table.js)
 */
export async function buildSelection({ id, kind, config, signal, check, enter }) {
    const entityType = kind === 'cell-table' ? 'cells' : 'genes';
    const settings = {
        // the scores the filter reads are the table's own (panels/table-utilities/table-scores.js)
        _tableId: id,
        columns: neededColumns(config),
        searchBuilderConfig: config.searchBuilderConfig,
        searchText: config.searchText || '',
        searchRegex: config.searchRegex === true,
        searchSmart: config.searchSmart !== false,
        searchCaseInsensitive: config.searchCaseInsensitive !== false
    };
    const tableData = await loadTableData(settings, entityType, signal);
    // a score the filter reads must be there: the resolver builds only when every one is ready
    for (const column of usedScoreColumns(settings.columns, settings.searchBuilderConfig, getColumnKey)) {
        const entry = TableScores.entry(id, column);
        if (!entry || !entry.reader.vec) throw new Error(`the score '${column.label || column.key}' is not ready`);
    }
    // the step below cannot be interrupted: last look at whether anyone still wants it
    // the last step cannot be interrupted: the resolver says so first and lets the page paint it
    if (enter) await enter(); else check();
    const rowNames = tableData.entityIndex;
    const rows = tableData.data.length;
    const have = new Set(tableData.columns.map(c => c.data));
    for (const key of referencedKeys(settings.searchBuilderConfig)) {
        if (!have.has(key)) {
            throw new Error('a column of its filter could not be read');
        }
    }
    let entries;
    if (!filters(config)) {
        entries = Array.from({ length: rows }, (_, i) => i);
    } else {
        const box = document.createElement('div');       // never attached to the page
        let dataTable = null;
        try {
            dataTable = initializeDataTable(box, tableData, settings, entityType, { headless: true });
            entries = dataTable.rows({ search: 'applied' }).indexes().toArray();
        } finally {
            if (dataTable) releaseTable(dataTable, settings);
        }
    }
    const selection = freezeSelection(entries, rowNames, rows);
    if (!selection) throw new Error(`the ${entityType} names are not in the browser`);
    return selection;
}

function panelOf(id) {
    const pm = window.PanelManager;
    const panel = pm && pm.getPanel ? pm.getPanel(id) : null;
    const type = panel && panel.getType ? panel.getType() : null;
    return TABLE_KINDS.has(type) ? { panel, kind: type } : null;
}

function isActive(panel) {
    return window.PanelManager.getActivePanels().includes(panel);
}

const onScreen = tileOnScreen;

const host = {
    panel(id) {
        const found = panelOf(id);
        if (!found) return null;
        const { panel, kind } = found;
        return {
            id, kind, open: isActive(panel), title: panel.getTitle ? panel.getTitle() : id,
            get config() { return panel.getConfig(); }
        };
    },
    isDependant(dependantId, tableId) {
        const pm = window.PanelManager;
        const panel = pm.getPanel(dependantId);
        if (!panel || !isActive(panel)) return false;
        // filtered by the table, or coloured, drawn or columned by its score (a gene table is a source of a gene
        // score): it uses the table (utils/panel-references.js)
        return usersOf(tableId).some(user => user.panelId === dependantId);
    },
    visible: onScreen,
    cellsKey(kind) {
        const dataset = DataManager.getCurrentDataset();
        if (kind !== 'cell-table') return `${dataset}|genes`;
        const cells = DataManager.getCells();
        return `${dataset}|${DataManager.getSubsetParam()}|${cells ? cells.length : 0}`;
    },
    rowCount(kind) {
        const rows = kind === 'cell-table' ? DataManager.getCells() : DataManager.getGenes();
        return rows ? Number(rows.length) || 0 : 0;
    },
    mayLoad(id, kind, n) {
        try {
            const result = tableCheck({ id, kind, n });
            if (result.verdict !== 'block') return { ok: true };
            const refusal = refusalPanel({ result, kind, n, checkAt: m => tableCheck({ id, kind, n: m }), anyway: 'Load anyway' });
            return { ok: false, detail: refusal.why };
        } catch (error) {
            // the guard must never be why a filter is not built
            console.warn('Browser memory check failed; building the filter without it', error);
            return { ok: true };
        }
    },
    // what a panel is computed from, over every panel on the page (a table filtered on a grouping's
    // column, a grouping partitioned by a table's rows): one declaration per panel type
    depends: dependsOn,
    scoreGate(id, { open }) {
        const found = panelOf(id);
        if (!found || found.kind !== 'cell-table' || typeof found.panel.scoreGate !== 'function') return null;
        // a closed table's scores are computed for the dependants that can be seen
        return found.panel.scoreGate(open ? {} : { visible: () => TableResolver.wantedBy(id).some(onScreen) });
    },
    releaseScores(id) {
        TableScores.release(id);
    },
    build: buildSelection,
    publish(id, selection) {
        const found = panelOf(id);
        if (found && typeof found.panel.setClosedSelection === 'function') found.panel.setClosedSelection(selection);
    },
    notify(id, kind) {
        const pm = window.PanelManager;
        if (!pm || !pm.notifyPanels) return;
        pm.notifyPanels('tableFiltered', { id, type: kind === 'cell-table' ? 'cells' : 'genes' }).catch(() => {});
    },
    schedule: (fn) => setTimeout(fn, 0)
};

TableResolver.host = host;

// The page's panels, open or closed, as the reference graph sees them (utils/panel-references.js)
setReferenceHost({
    panel(id) {
        const pm = window.PanelManager;
        const panel = pm && pm.getPanel ? pm.getPanel(id) : null;
        if (!panel || typeof panel.getType !== 'function' || typeof panel.getConfig !== 'function') return null;
        return { type: panel.getType(), get config() { return panel.getConfig(); } };
    },
    ids() {
        const pm = window.PanelManager;
        return pm && pm.getAllPanels ? pm.getAllPanels().map(p => p.getId()) : [];
    }
});

// A score a closed table's filter reads arrived or changed: what was built from the old one is void
TableScores.on((tableId, entry, changed) => {
    if (!changed) return;
    const found = panelOf(tableId);
    if (found && !isActive(found.panel)) TableResolver.scoreChanged(tableId);
});

// Tests hold or tune the limits before the app loads (the browser tests set window.__azTableLimits)
if (typeof window !== 'undefined' && window.__azTableLimits) TableResolver.setLimits(window.__azTableLimits);

// A dataset switch ends every build and every selection built for the old one
document.addEventListener('datasetChanged', () => {
    TableResolver.reset();
    const pm = window.PanelManager;
    if (!pm || !pm.getPanel) return;
    for (const panel of pm.getAllPanels ? pm.getAllPanels() : []) {
        if (panel && TABLE_KINDS.has(panel.getType && panel.getType()) && typeof panel.setClosedSelection === 'function') {
            panel.setClosedSelection(null);
        }
    }
});

export { TableResolver };
