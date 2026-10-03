/**
 * Table filters (DataTables SearchBuilder) that mean what they say.
 *
 * Two silent wrong results, both reported from the Fig 4/5 walkthrough:
 *
 * 1. A boolean column filtered "Equals Yes" kept 0 rows. Cells showed
 *    Yes/No, but filtering and type detection saw raw booleans: the saved
 *    condition was {type: 'num', value: ['true']}, and a number condition on
 *    'true' matches nothing. Boolean columns now present 'Yes'/'No' to every
 *    consumer except sorting and are declared string columns; conditions
 *    saved the old way are translated when they are restored.
 *
 * 2. A saved filter with a top-level OR came back as AND: only `criteria`
 *    was handed to SearchBuilder's preDefined, not `logic`.
 */

/** True if every present value is a boolean (and at least one is). */
export function isBooleanColumn(values) {
    let seen = false;
    for (const v of values) {
        if (v === null || v === undefined) continue;
        if (typeof v !== 'boolean') return false;
        seen = true;
    }
    return seen;
}

/**
 * DataTables render function for a boolean column: 'Yes'/'No' for display,
 * filtering and type detection, 1/0 for sorting.
 */
export function renderBoolean(data, type) {
    if (data === null || data === undefined) {
        return type === 'display' ? '<span class="text-muted">N/A</span>' : '';
    }
    if (type === 'sort') return data ? 1 : 0;
    return data ? 'Yes' : 'No';
}

const TRUTHY = new Set(['true', '1', 'yes']);
const FALSY = new Set(['false', '0', 'no']);

function _translate(node, booleanKeys) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node.criteria)) {
        return { ...node, criteria: node.criteria.map(c => _translate(c, booleanKeys)) };
    }
    if (!booleanKeys.has(node.origData)) return node;
    const value = (node.value || []).map(v => {
        const s = String(v).trim().toLowerCase();
        if (TRUTHY.has(s)) return 'Yes';
        if (FALSY.has(s)) return 'No';
        return v;
    });
    // number conditions have string counterparts for equality; others pass
    const condition = { '=': '=', '!=': '!=', 'null': 'null', '!null': '!null' }[node.condition] || node.condition;
    return { ...node, type: 'string', condition, value };
}

/**
 * The preDefined object to hand SearchBuilder for a saved configuration.
 * @param {{criteria?: Array, logic?: string}|undefined} saved
 * @param {Set<string>|string[]} [booleanKeys] - data keys of boolean columns
 * @returns {{criteria: Array, logic: string}}
 */
export function searchBuilderPreDefined(saved, booleanKeys = []) {
    const keys = booleanKeys instanceof Set ? booleanKeys : new Set(booleanKeys);
    const criteria = Array.isArray(saved?.criteria) ? saved.criteria : [];
    return {
        criteria: keys.size ? criteria.map(c => _translate(c, keys)) : criteria,
        logic: saved?.logic === 'OR' ? 'OR' : 'AND'
    };
}
