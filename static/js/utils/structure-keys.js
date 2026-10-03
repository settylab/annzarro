/**
 * Key lists derived from /data/dataset_structure, shared by the plot axis
 * menus and the table column menus so both offer the same sources.
 */

function _asList(keys) {
    if (!keys) return [];
    return Array.isArray(keys) ? keys : Object.keys(keys);
}

/**
 * The matrices offered under "layer": X first (when the dataset has X and no
 * layer is itself named X), then the layers.
 *
 * X used to be missing, so a deep link {type: 'layer', key: 'X'} fell back
 * to the first layer without a word. The server reads layer 'X' as X.
 * @param {Object} structure
 * @returns {string[]}
 */
export function layerKeys(structure) {
    const layers = _asList(structure?.layers?.details?.keys || structure?.layers?.keys);
    const hasX = !!(structure?.X && (structure.X.available || structure.X.shape));
    return hasX && !layers.includes('X') ? ['X', ...layers] : layers;
}

/**
 * Whether `key` names anything in the dataset (any obs/var column, obsm,
 * varm, obsp, varp or layer key, or X). Used to tell a key that is missing
 * from the dataset (worth telling the user) from one that belongs to another
 * source type (the user just switched the type menu).
 * @param {Object} structure
 * @param {string} key
 * @returns {boolean}
 */
export function keyExistsInStructure(structure, key) {
    if (!structure || !key) return false;
    const lists = [
        structure.obs?.columns || Object.keys(structure.obs || {}),
        structure.var?.columns || Object.keys(structure.var || {}),
        _asList(structure.obsm?.keys), Object.keys(structure.obsm?.dataframes || {}),
        _asList(structure.varm?.keys), Object.keys(structure.varm?.dataframes || {}),
        _asList(structure.obsp?.keys), _asList(structure.varp?.keys),
        layerKeys(structure)
    ];
    return lists.some(list => Array.isArray(list) && list.includes(key));
}
