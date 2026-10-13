/**
 * The `columns` query parameter of /data/obs and /data/var.
 *
 * The server reads it as a comma-separated list, or as a JSON list when it parses as one
 * (routes/data_routes.py, _parse_strings). A column named a,b would be two columns in the
 * first form, so a name with a comma is sent as the JSON list, which is exact for any name.
 * Plain names keep the short form, so their URLs (and their cache entries) are unchanged.
 */

/**
 * @param {string|string[]} columns - one column name or several
 * @returns {string}
 */
export function columnsParam(columns) {
    const names = Array.isArray(columns) ? columns : [columns];
    // a name that itself reads as JSON ("[1]", "123") would be taken for a list or a number
    const ambiguous = names.some((n) => typeof n === 'string' && (n.includes(',') || /^[[\d"{-]/.test(n) && isJson(n)));
    return ambiguous ? JSON.stringify(names) : names.join(',');
}

function isJson(text) {
    try {
        JSON.parse(text);
        return true;
    } catch (error) {
        return false;
    }
}
