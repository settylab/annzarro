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
 *     where?: [ condition, ... ],        AND of conditions (or groups) on obs columns
 *     part?: <0-based part> }            which of the k = ceil(eligible / n)
 *                                        disjoint parts; absent means 0
 *
 * The parts together hold every eligible cell once, so stepping through them
 * shows every cell. Part 0 is the subset as it was before parts existed, and
 * is written without `part`. The UI counts parts from 1 ("Part 3 of 957" is
 * part 2).
 *
 *   condition := { col, op: 'in'|'not_in', values: [...] }
 *              | { col, op: 'contains'|'not_contains'|'starts_with'|'not_starts_with'
 *                         |'ends_with'|'not_ends_with', value: <text> }   case-insensitive
 *              | { col, op: 'empty'|'not_empty' }
 *              | { any: [ condition|group, ... ] }    OR      (also { all: [...] }, AND,
 *                                                       nested at most MAX_GROUP_DEPTH deep)
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
    { op: 'contains', label: 'contains', kind: 'string' },
    { op: 'not_contains', label: 'does not contain', kind: 'string' },
    { op: 'starts_with', label: 'starts with', kind: 'string' },
    { op: 'not_starts_with', label: 'does not start with', kind: 'string' },
    { op: 'ends_with', label: 'ends with', kind: 'string' },
    { op: 'not_ends_with', label: 'does not end with', kind: 'string' },
    { op: 'empty', label: 'is empty', kind: 'none' },
    { op: 'not_empty', label: 'is not empty', kind: 'none' },
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
const STRING_OPS = new Set(SUBSET_OPS.filter(o => o.kind === 'string').map(o => o.op));
const EMPTY_OPS = new Set(['empty', 'not_empty']);
/** Longest text a string condition takes (server: MAX_NEEDLE). */
export const MAX_NEEDLE = 200;
/** Groups nest at most this deep inside `where` (server: MAX_GROUP_DEPTH). */
export const MAX_GROUP_DEPTH = 2;
/** Conditions in a spec, groups unfolded (server: MAX_CONDITIONS). */
export const MAX_CONDITIONS = 16;
export const MAX_SEED = 2 ** 32 - 1;
/** The spec rides in every cell-axis request's query string (server: MAX_SPEC_CHARS). */
export const MAX_SPEC_CHARS = 2000;

function _isInt(v) {
    return typeof v === 'number' && Number.isInteger(v);
}

/** A condition or group in canonical form; throws on a malformed one. */
function canonicalCondition(c, depth) {
    if (c && (Array.isArray(c.any) || Array.isArray(c.all))) {
        const logic = Array.isArray(c.any) ? 'any' : 'all';
        if (depth > MAX_GROUP_DEPTH) throw new Error(`Groups of conditions nest at most ${MAX_GROUP_DEPTH} deep`);
        if (!c[logic].length) throw new Error('A group of conditions needs at least one condition');
        return { [logic]: c[logic].map(m => canonicalCondition(m, depth + 1)) };
    }
    if (!c || !c.col) throw new Error('Every filter condition needs a column');
    if (TEXT_OPS.has(c.op)) {
        const values = [...new Set((c.values || []).map(v => String(v)))].sort();
        if (!values.length) throw new Error(`Choose at least one value for ${c.col}`);
        return { col: c.col, op: c.op, values };
    }
    if (STRING_OPS.has(c.op)) {
        const value = c.value === undefined || c.value === null ? '' : String(c.value);
        if (!value) throw new Error(`${c.col}: type the text to look for`);
        if (value.length > MAX_NEEDLE) throw new Error(`${c.col}: the text is at most ${MAX_NEEDLE} characters`);
        return { col: c.col, op: c.op, value };
    }
    if (EMPTY_OPS.has(c.op)) return { col: c.col, op: c.op };
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
}

function countConditions(items) {
    return items.reduce((n, c) => n + (c.any || c.all ? countConditions(c.any || c.all) : 1), 0);
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
        out.where = where.map(c => canonicalCondition(c, 1));
        if (countConditions(out.where) > MAX_CONDITIONS) throw new Error(`A filter has at most ${MAX_CONDITIONS} conditions`);
    }
    const part = spec.part === undefined || spec.part === null ? 0 : spec.part;
    if (!(_isInt(part) && part >= 0)) throw new Error('The part must be a whole number of at least 0');
    if (part > 0) out.part = part;
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
    if (c.any || c.all) {
        const members = (c.any || c.all).map(m => ((m.any || m.all) ? `(${describeCondition(m)})` : describeCondition(m)));
        return members.join(c.any ? ' or ' : ' and ');
    }
    if (STRING_OPS.has(c.op)) {
        const label = (SUBSET_OPS.find(o => o.op === c.op) || {}).label || c.op;
        return `${c.col} ${label} "${c.value}"`;
    }
    if (EMPTY_OPS.has(c.op)) return `${c.col} ${c.op === 'empty' ? 'is empty' : 'is not empty'}`;
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
    if (info.parts > 1) {
        lines.push(`Part ${fmt((info.part || 0) + 1)} of ${fmt(info.parts)}: the parts hold every cell `
            + `${spec.where && spec.where.length ? 'passing the filter ' : ''}once; step through them with ‹ ›.`);
        if (spec.balance && info.groups) {
            const done = Object.entries(info.groups).filter(([, c]) => c.shown === 0).map(([g]) => g);
            if (done.length) {
                lines.push(`Groups already shown in full by earlier parts: ${done.length > 6
                    ? `${done.slice(0, 5).join(', ')} and ${done.length - 5} more` : done.join(', ')}.`);
            }
        }
    }
    lines.push('Every panel shows these same cells. Click to change the subset.');
    // the badge names what shapes the cells, not just the seed: a balance
    // (it was only in the tooltip) and that a filter applies
    const badgeParts = ['Subset', `seed ${spec.seed}`];
    if (spec.balance) badgeParts.push(`balanced by ${spec.balance}`);
    if (spec.where && spec.where.length) badgeParts.push('filtered');
    return {
        count: `${fmt(info.n)} of ${fmt(info.n_total)}`,
        badge: badgeParts.join(' · '),
        badgeParts,
        title: lines.join('\n'),
        active: true
    };
}

/**
 * The part stepper next to the badge, from the /data/subset reply: null when
 * there is only one part (or no subset), else what it shows.
 * @returns {{label: string, part: number, parts: number, display: number,
 *            canPrev: boolean, canNext: boolean, title: string}|null}
 */
export function describeParts(info) {
    if (!info || !info.subset || !(info.parts > 1)) return null;
    const part = info.part || 0;
    return {
        label: `Part ${fmt(part + 1)} of ${fmt(info.parts)}`,
        part, parts: info.parts, display: part + 1,
        canPrev: part > 0, canNext: part < info.parts - 1,
        title: `The ${fmt(info.n_eligible)} cells ${info.subset.where ? 'passing the filter ' : ''}are split into `
            + `${fmt(info.parts)} parts of up to ${fmt(info.subset.n)}; together the parts show every one of them once.`
            + (info.subset.balance ? ' Each part is as balanced as the cells not yet shown allow, so late parts hold the largest groups only.' : '')
    };
}

/**
 * The spec for another part of the same partition, or null if there is no
 * such part. `target` is 0-based; out-of-range targets are clamped only when
 * `clamp` is set (typed part numbers), otherwise refused (the buttons).
 */
export function partSpec(info, target, clamp = false) {
    const parts = describeParts(info);
    if (!parts) return null;
    let part = Math.trunc(Number(target));
    if (!Number.isFinite(part)) return null;
    if (clamp) part = Math.min(Math.max(part, 0), parts.parts - 1);
    if (part < 0 || part >= parts.parts || part === parts.part) return null;
    return canonicalSubset({ ...info.subset, part });
}

/** Where the cells a subset does not load are: the status strip's "not in part 3 of 957". */
export function outsideDetail(info) {
    const parts = describeParts(info);
    return parts ? `not in part ${fmt(parts.display)} of ${fmt(parts.parts)}` : 'not in the cell subset';
}

/** SearchBuilder string conditions and the subset op that means the same (both lower-case the text). */
const STRING_CONDITIONS = {
    contains: 'contains', '!contains': 'not_contains',
    starts: 'starts_with', '!starts': 'not_starts_with',
    ends: 'ends_with', '!ends': 'not_ends_with'
};

/**
 * Translate a cell table's SearchBuilder filter into subset conditions, so
 * the server can apply it to EVERY cell (the table itself only holds the
 * cells already loaded).
 *
 * Only what the server can evaluate with the same meaning is translated:
 * conditions over obs columns (text: =, !=, contains, starts with, ends with
 * and their negations, empty, not empty; numbers: =, !=, <, <=, >, >=,
 * between, empty, not empty), joined by AND or OR in groups nested up to
 * MAX_GROUP_DEPTH deep. Anything else is reported in `unsupported` and NOT
 * silently dropped by the caller. A dropped member of an AND only makes the
 * subset broader than the table; a dropped member of an OR would make it
 * narrower, so an OR with a condition that cannot be translated is not
 * copied at all.
 *
 * @param {{criteria?: Array, logic?: string}} details - SearchBuilder getDetails()
 * @param {Array<{type: string, key: string, column?: string}>} columns - the table's columns
 * @param {(column: Object) => string} columnKey - getColumnKey from table-data.js
 * @param {Set<string>} [booleanCols] - obs columns holding booleans (shown as Yes/No)
 * @returns {{where: Array, unsupported: string[]}}
 */
export function searchBuilderToWhere(details, columns, columnKey, booleanCols = new Set()) {
    const unsupported = [];
    const byKey = new Map((columns || []).map(c => [columnKey(c), c]));

    function leaf(crit) {
        const column = byKey.get(crit.origData) || byKey.get(crit.data);
        const label = crit.data || crit.origData || '?';
        if (!column || column.type !== 'obs') {
            unsupported.push(`${label} (only obs columns can filter the subset)`);
            return null;
        }
        const col = column.key;
        const cond = crit.condition;
        const values = Array.isArray(crit.value) ? crit.value : [];
        const isNum = crit.type === 'num' || crit.type === 'num-fmt' || crit.type === 'html-num';
        const isBool = booleanCols.has(col);
        if (cond === 'null' || cond === '!null') {
            if (isBool) {
                unsupported.push(`${label} ${cond === 'null' ? 'is empty' : 'is not empty'} (on a Yes/No column)`);
                return null;
            }
            return { col, op: cond === 'null' ? 'empty' : 'not_empty' };
        }
        if (!isNum) {
            if ((cond === '=' || cond === '!=') && values.length) {
                let v = values[0];
                if (isBool) v = { yes: 'true', no: 'false' }[String(v).toLowerCase()] ?? v;
                return { col, op: cond === '=' ? 'in' : 'not_in', values: [String(v)] };
            }
            if (STRING_CONDITIONS[cond]) {
                const text = values.length ? String(values[0]) : '';
                if (isBool) {
                    unsupported.push(`${label} ${cond} (text conditions on a Yes/No column)`);
                    return null;
                }
                if (!text || text.length > MAX_NEEDLE) {
                    unsupported.push(`${label} ${cond} (${text ? `text over ${MAX_NEEDLE} characters` : 'no text typed'})`);
                    return null;
                }
                return { col, op: STRING_CONDITIONS[cond], value: text };
            }
            unsupported.push(`${label} ${cond || ''} (no equivalent in a subset)`);
            return null;
        }
        const nums = values.map(Number);
        if (['<', '<=', '>', '>=', '=', '!='].includes(cond) && Number.isFinite(nums[0])) {
            return { col, op: cond === '=' ? '==' : cond, value: nums[0] };
        }
        if (cond === 'between' && nums.length >= 2 && nums.every(Number.isFinite)) {
            return { col, op: 'between', value: [nums[0], nums[1]] };
        }
        unsupported.push(`${label} ${cond || ''}`);
        return null;
    }

    /** The items a group translates to (an array), or null when an OR cannot be. */
    function group(det, depth) {
        const items = [];
        let lost = false;
        for (const crit of (det && Array.isArray(det.criteria)) ? det.criteria : []) {
            if (crit && Array.isArray(crit.criteria)) {
                if (!crit.criteria.length) continue;             // an empty group filters nothing
                if (depth >= MAX_GROUP_DEPTH) {
                    unsupported.push(`a group of conditions nested more than ${MAX_GROUP_DEPTH} deep`);
                    lost = true;
                    continue;
                }
                const inner = group(crit, depth + 1);
                if (inner === null) { lost = true; continue; }
                if (inner.length) items.push(crit.logic === 'OR' && inner.length > 1 ? { any: inner } : (inner.length > 1 ? { all: inner } : inner[0]));
                continue;
            }
            const one = crit ? leaf(crit) : null;
            if (one) items.push(one); else lost = true;
        }
        // a member lost from an OR would narrow it: give the whole OR up
        if (det && det.logic === 'OR' && lost) return null;
        return items;
    }

    const top = group(details, 0);
    if (top === null) return { where: [], unsupported };
    const isOr = details && details.logic === 'OR' && top.length > 1;
    return { where: isOr ? [{ any: top }] : top, unsupported };
}
