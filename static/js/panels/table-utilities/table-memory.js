/**
 * The browser memory guard before a Cell or Gene Table loads its rows
 * (utils/memory-guard-ui.js tableCheck): a table of millions of rows holds
 * hundreds of bytes a row on the JS heap, so it counts next to the plots.
 * Refused, the table says why and offers the ways out a plot offers.
 */
import { DataManager } from '../../data-manager.js';
import { tableCheck, shortRefusalText, takeOverride } from '../../utils/memory-guard-ui.js';
import { DRAW_ANYWAY_RISK } from '../../utils/memory-guard.js';
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
    const fewer = kind === 'cell-table' ? [['subset-half', 'Half the cells'], ['subset', 'Subset…']] : [];
    drawPlaceholder(container, null, unit, {
        actions: [...fewer, ['close-others', 'Close other plots'], ['draw-anyway', 'Load anyway']],
        say: { severity: 'warning', headline: 'Not loaded: not enough browser memory',
            lines: [shortRefusalText(result), DRAW_ANYWAY_RISK.replace(/^Draw anyway/, 'Load anyway')] }
    });
    return false;
}
