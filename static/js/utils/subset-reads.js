/**
 * Which panels a change of the cell subset (a part step, the dialog) concerns.
 *
 * It decides by what a panel reads, not by its type. A panel's data changes
 * with the subset only when it reads along the cell axis of the cells shown:
 * everything a cell plot or cell table draws, and the obs and obsm sources of
 * any panel. A focused cell's row (a layer or obsp source of a gene panel) is
 * addressed by the cell's dataset row, so the same other cells leave it as it
 * was; if the subset moves the focus, the focus change updates that colour
 * on its own. Gene-axis sources (var, varm, varp) never change.
 */

const CELL_AXIS_STORES = ['obs', 'obsm'];

/**
 * Whether one source ({type, key, column}) of a panel over `entity` is read
 * along the cells shown.
 * @param {'cells'|'genes'} entity - what the panel's points or rows are
 * @param {{type?: string}|null} series
 */
export function seriesReadsCellSubset(entity, series) {
    if (!series || !series.type || series.type === 'none') return false;
    return entity === 'cells' || CELL_AXIS_STORES.includes(series.type);
}

/**
 * Whether any of a panel's sources, or a table link, reads the cell subset.
 * A link to a table is conservative: the table's own rows decide, and a cell
 * table's change reaches the panel as its own notice.
 * @param {'cells'|'genes'} entity
 * @param {Array<Object|null>} series
 * @param {string} [tableFilter]
 */
export function readsCellSubset(entity, series, tableFilter = 'none') {
    if (entity === 'cells') return true;
    if (tableFilter && tableFilter !== 'none') return true;
    return (series || []).some(s => seriesReadsCellSubset(entity, s));
}
