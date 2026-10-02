/**
 * Cell subsets in the browser: the spec, its wire form, and what the header
 * says about it. Pure (no DOM, no fetch), so Node tests cover it.
 *
 * The server decides which cells a spec names (annzarro/core/subset.py); the
 * browser only carries the spec. A spec is
 *
 *   { n: <cells, or null for every cell passing the filter>,
 *     seed: <0 .. 2^32-1>,
 *     balance?: <obs column>,            equal-as-possible groups
 *     where?: [ condition, ... ] }       AND of conditions on obs columns
 *
 *   condition := { col, op: 'in'|'not_in', values: [...] }
 *              | { col, op: '>'|'>='|'<'|'<='|'=='|'!=', value: <number> }
 *              | { col, op: 'between', value: [low, high] }
 *
 * In a deep link or panel set the view's `subset` is that spec, `null` for
 * "every cell" (chosen on a dataset that would otherwise open on a subset),
 * or absent for "the server's default for this dataset".
 */

/** Ops the server accepts, with the label the dialog shows. */
export const SUBSET_OPS = [
    { op: 'in', label: 'is one of', kind: 'text' },
    { op: 'not_in', label: 'is not one of', kind: 'text' },
    { op: '>', label: '>', kind: 'number' },
    { op: '>=', label: '≥', kind: 'number' },
    { op: '<', label: '<', kind: 'number' },
    { op: '<=', label: '≤', kind: 'number' },
    { op: '==', label: '=', kind: 'number' },
    { op: '!=', label: '≠', kind: 'number' },
    { op: 'between', label: 'between', kind: 'range' }
];

const TEXT_OPS = new Set(['in', 'not_in']);
const NUMBER_OPS = new Set(['>', '>=', '<', '<=', '==', '!=']);
export const MAX_SEED = 2 ** 32 - 1;
/** The spec rides in every cell-axis request's query string (server: MAX_SPEC_CHARS). */
export const MAX_SPEC_CHARS = 2000;

function _isInt(v) {
    return typeof v === 'number' && Number.isInteger(v);
}

/**
 * A spec in canonical form (fixed key order, the same JSON the server
 * echoes), or null for "every cell". Throws on a malformed spec.
 * @param {Object|null} spec
 * @returns {Object|null}
 */
export function canonicalSubset(spec) {
    if (spec === null || spec === undefined || spec === 'all') return null;
    if (typeof spec !== 'object' || Array.isArray(spec)) throw new Error('A subset must be an object');
    const n = spec.n === undefined ? null : spec.n;
    if (n !== null && !(_isInt(n) && n >= 1)) throw new Error('The number of cells must be a whole number of at least 1');
    const seed = spec.seed === undefined ? 0 : spec.seed;
    if (!(_isInt(seed) && seed >= 0 && seed <= MAX_SEED)) throw new Error(`The seed must be a whole number from 0 to ${MAX_SEED}`);
    const out = { n, seed };
    if (spec.balance) {
        if (n === null) throw new Error('Balancing needs a number of cells');
        out.balance = String(spec.balance);
    }
    const where = Array.isArray(spec.where) ? spec.where : [];
    if (where.length) {
        out.where = where.map(c => {
            if (!c || !c.col) throw new Error('Every filter condition needs a column');
            if (TEXT_OPS.has(c.op)) {
                const values = [...new Set((c.values || []).map(v => String(v)))].sort();
                if (!values.length) throw new Error(`Choose at least one value for ${c.col}`);
                return { col: c.col, op: c.op, values };
            }
            if (c.op === 'between') {
                const [lo, hi] = (c.value || []).map(Number);
                if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error(`${c.col}: between needs two numbers`);
                return { col: c.col, op: c.op, value: lo <= hi ? [lo, hi] : [hi, lo] };
            }
            if (NUMBER_OPS.has(c.op)) {
                const value = Number(c.value);
                if (c.value === '' || c.value === null || !Number.isFinite(value)) throw new Error(`${c.col}: ${c.op} needs a number`);
                return { col: c.col, op: c.op, value };
            }
            throw new Error(`Unknown filter operator ${c.op}`);
        });
    }
    const length = JSON.stringify(out).length;
    if (length > MAX_SPEC_CHARS) {
        throw new Error(`This filter is ${length} characters long; at most ${MAX_SPEC_CHARS} fit in a request. Use fewer values.`);
    }
    return out;
}

/** The `subset` query parameter for a spec ('all' for none). */
export function subsetParam(spec) {
    const canonical = canonicalSubset(spec);
    return canonical === null ? 'all' : JSON.stringify(canonical);
}

/**
 * The view's `subset` as a deep link carries it: undefined (absent, the
 * server's default), null (every cell) or a canonical spec. A malformed
 * value is dropped (undefined), so an old or hand-edited link still opens.
 */
export function normalizeViewSubset(value) {
    if (value === undefined) return undefined;
    if (value === null || value === 'all') return null;
    try {
        return canonicalSubset(value);
    } catch {
        return undefined;
    }
}

/** True if two specs name the same cells (both null = every cell). */
export function sameSubset(a, b) {
    const ca = a === undefined ? undefined : canonicalSubset(a);
    const cb = b === undefined ? undefined : canonicalSubset(b);
    return JSON.stringify(ca) === JSON.stringify(cb);
}

const fmt = (n) => Number(n).toLocaleString('en-US');

/** "cluster in {3, 5}" etc., for the header and the widget. */
export function describeCondition(c) {
    if (TEXT_OPS.has(c.op)) {
        const shown = c.values.length > 4 ? [...c.values.slice(0, 3), `… ${c.values.length - 3} more`] : c.values;
        return `${c.col} ${c.op === 'in' ? 'in' : 'not in'} {${shown.join(', ')}}`;
    }
    if (c.op === 'between') return `${c.value[0]} ≤ ${c.col} ≤ ${c.value[1]}`;
    const label = (SUBSET_OPS.find(o => o.op === c.op) || {}).label || c.op;
    return `${c.col} ${label} ${c.value}`;
}

/**
 * What the header says. `info` is the /data/subset reply (or null for every
 * cell of a dataset with `total` cells).
 * @returns {{count: string, badge: string, title: string, active: boolean}}
 */
export function describeSubset(info, total = null) {
    if (!info || !info.subset) {
        const n = info ? info.n_total : total;
        return {
            count: n === null || n === undefined ? '-' : fmt(n),
            badge: 'All cells',
            title: 'Every cell is shown. Click to show a reproducible subset instead.',
            active: false
        };
    }
    const spec = info.subset;
    const parts = [`seed ${spec.seed}`];
    if (spec.balance) parts.push(`balanced by ${spec.balance}`);
    if (spec.where && spec.where.length) parts.push(spec.where.map(describeCondition).join(' and '));
    const lines = [
        `Showing ${fmt(info.n)} of ${fmt(info.n_total)} cells (${parts.join(', ')}).`
    ];
    if (spec.where && spec.where.length) {
        lines.push(`${fmt(info.n_eligible)} cells pass the filter.`);
    }
    lines.push('Every panel shows these same cells. Click to change the subset.');
    return {
        count: `${fmt(info.n)} of ${fmt(info.n_total)}`,
        badge: `Subset · seed ${spec.seed}`,
        title: lines.join('\n'),
        active: true
    };
}

/**
 * Translate a cell table's SearchBuilder filter into subset conditions, so
 * the server can apply it to EVERY cell (the table itself only holds the
 * cells already loaded).
 *
 * Only what the server can evaluate with the same meaning is translated: a
 * top-level AND (or a single condition) over obs columns, with =, != on text
 * and =, !=, <, <=, >, >=, between on numbers. Anything else is reported in
 * `unsupported` and NOT silently dropped by the caller.
 *
 * @param {{criteria?: Array, logic?: string}} details - SearchBuilder getDetails()
 * @param {Array<{type: string, key: string, column?: string}>} columns - the table's columns
 * @param {(column: Object) => string} columnKey - getColumnKey from table-data.js
 * @param {Set<string>} [booleanCols] - obs columns holding booleans (shown as Yes/No)
 * @returns {{where: Array, unsupported: string[]}}
 */
export function searchBuilderToWhere(details, columns, columnKey, booleanCols = new Set()) {
    const where = [];
    const unsupported = [];
    const criteria = (details && Array.isArray(details.criteria)) ? details.criteria : [];
    if (criteria.length > 1 && details.logic === 'OR') {
        return { where: [], unsupported: ['conditions joined by OR (only AND can be applied to all cells)'] };
    }
    const byKey = new Map((columns || []).map(c => [columnKey(c), c]));
    for (const crit of criteria) {
        if (!crit || Array.isArray(crit.criteria)) {
            unsupported.push('a nested group of conditions');
            continue;
        }
        const column = byKey.get(crit.origData) || byKey.get(crit.data);
        const label = crit.data || crit.origData || '?';
        if (!column || column.type !== 'obs') {
            unsupported.push(`${label} (only obs columns can filter the subset)`);
            continue;
        }
        const col = column.key;
        const values = Array.isArray(crit.value) ? crit.value : [];
        const isNum = crit.type === 'num' || crit.type === 'num-fmt' || crit.type === 'html-num';
        if (!isNum) {
            if ((crit.condition === '=' || crit.condition === '!=') && values.length) {
                let v = values[0];
                if (booleanCols.has(col)) v = { yes: 'true', no: 'false' }[String(v).toLowerCase()] ?? v;
                where.push({ col, op: crit.condition === '=' ? 'in' : 'not_in', values: [String(v)] });
            } else {
                unsupported.push(`${label} ${crit.condition || ''} (text conditions other than = and ≠)`);
            }
            continue;
        }
        const nums = values.map(Number);
        if (['<', '<=', '>', '>=', '=', '!='].includes(crit.condition) && Number.isFinite(nums[0])) {
            const op = crit.condition === '=' ? '==' : crit.condition;
            where.push({ col, op, value: nums[0] });
        } else if (crit.condition === 'between' && nums.length >= 2 && nums.every(Number.isFinite)) {
            where.push({ col, op: 'between', value: [nums[0], nums[1]] });
        } else {
            unsupported.push(`${label} ${crit.condition || ''}`);
        }
    }
    return { where, unsupported };
}
