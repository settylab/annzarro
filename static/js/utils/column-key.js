/**
 * The key of a table column: the row property and the DataTables `data` of the column. No DOM
 * and no page state, so Node tests (and the link code that rewrites a column's key when a
 * signature's id changes) use the same formula the table does.
 */

/**
 * Characters DataTables reads in a column's `data` string: "." nests, "[...]" indexes an
 * array, "()" calls a function, and "\\" escapes. A column named orig.ident was looked up as
 * row.obs_orig -> .ident_main and showed N/A (or a DataTables warning).
 */
const DATATABLES_SPECIAL = /[.[\]()\\]/g;

/**
 * Get a unique key for a column. It is the row property and the DataTables `data` of the
 * column, so it holds none of the characters DataTables reads as a path: each is replaced by
 * its code between two U+241E marks (the name shown for the column is not this key).
 * @param {{type: string, key: string, column?: string}} column
 * @returns {string}
 */
export function getColumnKey(column) {
    const { type, key, column: columnName, layer } = column;
    // a column that names a layer (a gene score over a layer) is another column from the same source over its default layer
    return `${type}_${key}_${columnName || 'main'}${layer ? `__of_${layer}` : ''}`.replace(/\s+/g, '_')
        .replace(DATATABLES_SPECIAL, c => `␞${c.charCodeAt(0).toString(16)}␞`);
}
