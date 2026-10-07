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

/**
 * SearchBuilder type of a column with too many distinct values to list: its
 * "Equals" and "Not" take typed text instead of a dropdown of every value.
 * The dropdown of a one-per-cell column (a barcode, the Cell ID) held one
 * option per row (utils/categories.js VALUE_LIST_MAX).
 */
export const TEXT_ONLY_TYPE = 'az-text';

/** True when `values` holds more than `max` distinct values (stops counting there). */
export function moreDistinctThan(values, max) {
    const seen = new Set();
    for (let i = 0; i < values.length; i++) {
        seen.add(values[i]);
        if (seen.size > max) return true;
    }
    return false;
}

/**
 * The SearchBuilder conditions of TEXT_ONLY_TYPE: the string conditions, with
 * "Equals" and "Not" on a text box.
 * @param {Object} Criteria  $.fn.dataTable.Criteria (SearchBuilder)
 */
export function textOnlyConditions(Criteria) {
    const base = Criteria.stringConditions;
    const typed = (c) => ({ ...c, init: Criteria.initInput, inputValue: Criteria.inputValueInput,
                            isInputValid: Criteria.isInputValidInput });
    return { ...base, '=': typed(base['=']), '!=': typed(base['!=']) };
}

/**
 * SearchBuilder's value list for "Equals" and "Not" in one pass. Its own
 * (Criteria.initSelect, 1.4.2) made a jQuery <option> per ROW and found
 * repeats by indexOf over the options so far: a 1,000-value column of a 1M
 * row table took 14.8 s. Here the rows' values are collected in a Map and an
 * option is made per distinct value, sorted and preselected as SearchBuilder
 * does. The values are those of the table's rows, not the column's whole
 * category list: under a subset that list holds values no row has.
 * @param {Object} Criteria  $.fn.dataTable.Criteria (SearchBuilder)
 * @param {Function} $  jQuery
 */
export function fastSelectInit(Criteria, $) {
    const strip = (s) => (typeof s === 'string' ? s.replace(/(<([^>]+)>)/gi, '') : s);
    return function (that, fn, preDefined = null) {
        const column = that.dom.data.children('option:selected').val();
        const dt = that.s.dt;
        const settings = dt.settings()[0];
        const orth = that.c.orthogonal;
        const search = typeof orth === 'string' ? orth : orth.search;
        const display = typeof orth === 'string' ? orth : orth.display;
        that.dom.valueTitle.prop('selected', true);
        const select = $('<select/>')
            .addClass(Criteria.classes.value).addClass(Criteria.classes.dropDown)
            .addClass(Criteria.classes.italic).addClass(Criteria.classes.select)
            .append(that.dom.valueTitle)
            .on('change.dtsb', function () {
                $(this).removeClass(Criteria.classes.italic);
                fn(that, this);
            });
        if (that.c.greyscale) select.addClass(Criteria.classes.greyscale);
        // option value (what <option value> makes of it) -> [value, text]
        const seen = new Map();
        for (const row of dt.rows().indexes().toArray()) {
            let v = settings.oApi._fnGetCellData(settings, row, column, search);
            if (typeof v === 'string') v = v.replace(/[\r\n\u2028]/g, ' ');
            const key = v === null || v === undefined ? '' : String(v);
            if (!seen.has(key)) seen.set(key, [v, settings.oApi._fnGetCellData(settings, row, column, display)]);
        }
        const type = that.s.type || '';
        const keys = [...seen.keys()];
        if (type.includes('num')) {
            const num = type.includes('fmt') ? (k) => +k.replace(/[^0-9.]/g, '') : (k) => +strip(k);
            keys.sort((a, b) => num(a) - num(b));
        } else {
            keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        }
        const wanted = preDefined !== null && preDefined !== undefined ? preDefined[0] : undefined;
        const options = keys.map((key) => {
            const [v, text] = seen.get(key);
            const option = $('<option>', { type: 'String', value: v }).data('sbv', v)
                .addClass(that.classes.option).addClass(that.classes.notItalic).html(strip(text));
            if (wanted !== undefined && key === String(wanted)) {
                option.prop('selected', true);
                select.removeClass(Criteria.classes.italic);
                that.dom.valueTitle.removeProp('selected');
            }
            return option;
        });
        select.append(options);
        return select;
    };
}

/**
 * The string and number conditions with "Equals" and "Not" on
 * fastSelectInit, for SearchBuilder's `conditions` option.
 * @param {Object} Criteria  $.fn.dataTable.Criteria
 * @param {Function} $  jQuery
 */
export function fastSelectConditions(Criteria, $) {
    const init = fastSelectInit(Criteria, $);
    const withInit = (base) => (base ? { ...base, '=': { ...base['='], init }, '!=': { ...base['!='], init } } : undefined);
    const out = {};
    for (const [type, base] of [['string', Criteria.stringConditions], ['html', Criteria.stringConditions],
        ['num', Criteria.numConditions], ['html-num', Criteria.numConditions],
        ['num-fmt', Criteria.numFmtConditions], ['html-num-fmt', Criteria.numFmtConditions]]) {
        const c = withInit(base);
        if (c) out[type] = c;
    }
    return out;
}
