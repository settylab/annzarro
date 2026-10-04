/**
 * The filter of a CLOSED table, as cell (or gene) names. Pure, so Node tests
 * cover it.
 *
 * A plot whose table filter is a table shows the rows that pass the table's
 * filter. An open table gives them as row indexes (currentEntries) into the
 * cells its rows were loaded for, and reloads its rows and filters them again
 * when the cells change. A closed table cannot: its indexes are into the cells
 * of the moment it was closed, and after a subset or part change they pointed
 * at other cells, or past the end (the plot then showed none, or cells that
 * never passed the filter, and said nothing).
 *
 * So when a table closes, its filter is kept as the NAMES of the rows that
 * passed (`passing`) and of every row it had (`seen`), packed. On any cells
 * later, a cell is shown when its name passed; a cell the table never had is
 * unknown, and the plot says that its table filter is out of date.
 */
import { PackedNames } from './packed-names.js';

/**
 * The closed table's filter from its row indexes that pass and the names of
 * its rows (the cells or genes it was loaded for, in row order).
 * @param {number[]} entries - currentEntries
 * @param {ArrayLike<string>} rowNames - name of row i at [i] (or .at(i))
 * @param {number} rows - rows the table had
 * @returns {{passing: PackedNames, seen: PackedNames}|null} null when the
 *   names are not in the browser (large datasets keep them on the server)
 */
export function freezeSelection(entries, rowNames, rows) {
    if (!rowNames) return null;
    const nameOf = (i) => (typeof rowNames.at === 'function' ? rowNames.at(i) : rowNames[i]);
    const n = Math.min(Number(rows) || 0, rowNames.length || 0);
    const seen = [];
    for (let i = 0; i < n; i++) {
        const name = nameOf(i);
        if (typeof name !== 'string') return null;
        seen.push(name);
    }
    const passing = [];
    for (const i of entries || []) if (i >= 0 && i < n) passing.push(seen[i]);
    return { passing: PackedNames.fromArray(passing), seen: PackedNames.fromArray(seen) };
}

/**
 * The closed table's filter on `cells` (the plot's names): which pass, and
 * how many the table never had. Without a frozen filter (a closed table
 * restored from a panel set, or one that never loaded), every cell is unknown.
 * @param {{passing, seen}|null} selection
 * @param {Iterable<string>} cells
 * @returns {{passing: Set<string>, unknown: number}}
 */
export function selectionOnCells(selection, cells) {
    const passing = new Set();
    let unknown = 0;
    if (!selection) {
        for (const c of cells) { if (c !== undefined) unknown++; }
        return { passing, unknown };
    }
    const passed = new Set(selection.passing);
    const seen = new Set(selection.seen);
    for (const c of cells) {
        if (passed.has(c)) passing.add(c);
        else if (!seen.has(c)) unknown++;
    }
    return { passing, unknown };
}

/** The sentence of the out-of-date tag (`unit` 'cells' or 'genes'). */
export function staleText(tableName, unknown, unit = 'cells') {
    const n = Number(unknown).toLocaleString('en-US');
    const one = unit.replace(/s$/, '');
    return `Table filter from closed '${tableName}' is out of date: ${n} ${unknown === 1 ? `${one} was` : `${unit} were`} not in it`;
}
