/**
 * The browser memory guard before a Cell or Gene Table loads its rows
 * (utils/memory-guard-ui.js tableCheck): a table of millions of rows holds
 * hundreds of bytes a row on the JS heap, so it counts next to the plots.
 * Refused, the table says why and offers the ways out a plot offers.
 */
import { DataManager } from '../../data-manager.js';
import { tableCheck, refusalPanel, takeOverride } from '../../utils/memory-guard-ui.js';
import { drawPlaceholder } from '../../utils/panel-surface.js';

/**
 * Whether the table `id` may load its rows; when not, its container says why.
 * @param {HTMLElement} container - the table container
 * @param {string} id
 * @param {'cell-table'|'gene-table'} kind
 * @param {Function} [letGo] - frees the rows shown now (called before the refusal is drawn)
 * @returns {boolean}
 */
export function tableMayLoad(container, id, kind, letGo = () => {}) {
    if (takeOverride(id)) return true;
    const rows = kind === 'cell-table' ? DataManager.getCells() : DataManager.getGenes();
    const n = Array.isArray(rows) ? rows.length : Number(rows && rows.length) || 0;
    let result;
    try {
        result = tableCheck({ id, kind, n });
    } catch (error) {
        // the guard must never be why a table is not shown
        console.warn('Browser memory check failed; loading the table without it', error);
        return true;
    }
    if (result.verdict !== 'block') return true;
    letGo();
    const unit = kind === 'cell-table' ? 'cells' : 'genes';
    const refusal = refusalPanel({ result, kind, n, checkAt: m => tableCheck({ id, kind, n: m }), anyway: 'Load anyway' });
    drawPlaceholder(container, null, unit, {
        actions: refusal.actions,
        say: { severity: 'warning', headline: refusal.headline, lines: [refusal.why, refusal.risk].filter(Boolean) }
    });
    return false;
}
