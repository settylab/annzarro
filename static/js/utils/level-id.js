/**
 * Level ids (plan 1.6): the typed text a group's key is made of. The server produces every id of a categorical
 * factor and the browser copies them; this module writes an id itself only for a value it holds (a boolean, an integer
 * or a float64) and reads the kinds back.
 *
 * `canonLabel` is pinned by tests/data/level_id_vectors.json, which core/cell_groups.py's `canonical_label` runs too.
 * A rule here enters links for good: change it and every stored link changes meaning.
 *
 * Pure, so Node tests cover it.
 */

/** The reserved ids. A category that is called "other" is `c:other`, never `@other`. */
export const RESERVED = Object.freeze({
    zero: '@zero', in: '@in', out: '@out', other: '@other', na: '@na', small: '@small'
});

const RESERVED_IDS = new Set(Object.values(RESERVED));

/**
 * The id of a category value: `c:` and the value's canonical text, or `@na` for a null or NaN.
 * A string is used as it is; a boolean is `true` or `false`; an integer is its digits; a finite float is written as
 * `Number.prototype.toString` writes it, so `3.0` is `3`, `1e21` is `1e+21` and `-0` is `0`; the infinities are
 * `Infinity` and `-Infinity`.
 * @param {string|boolean|number|bigint|null|undefined} value
 * @returns {string}
 */
// export-unused-ok: C1 writes the members of a set from a value, and level-id-vectors.test.mjs pins it
export function canonLabel(value) {
    if (value === null || value === undefined) return RESERVED.na;
    switch (typeof value) {
        case 'string': return `c:${value}`;
        case 'boolean': return `c:${value}`;
        case 'bigint': return `c:${value.toString()}`;
        case 'number':
            if (Number.isNaN(value)) return RESERVED.na;
            return `c:${Object.is(value, -0) ? '0' : String(value)}`;
        default: return RESERVED.na;
    }
}

/** The id of bin `i`, counted from 0 in ascending order. */
export function binId(i) {
    return `bin:${i}`;
}

/** The canonical JSON of a group key: an array of strings, nothing escaped but `"`, `\` and control characters. */
// export-unused-ok: G7 and G8a write the key of a group used as a source
export function canonKey(key) {
    return JSON.stringify(key);
}

/** The id of a level that is a group of another grouping. */
// export-unused-ok: G8a lists the groups of a grouping as the levels of a factor
export function groupLevelId(key) {
    return `g:${canonKey(key)}`;
}

/**
 * What an id is.
 * @param {string} id
 * @returns {{kind: 'category', text: string}|{kind: 'bin', index: number}|{kind: 'group', key: string[]}|{kind: 'reserved', id: string}|null}
 *   null for text that is none of them
 */
export function parseLevelId(id) {
    if (typeof id !== 'string') return null;
    if (RESERVED_IDS.has(id)) return { kind: 'reserved', id };
    if (id.startsWith('c:')) return { kind: 'category', text: id.slice(2) };
    if (id.startsWith('bin:')) {
        const digits = id.slice(4);
        return /^\d+$/.test(digits) ? { kind: 'bin', index: Number(digits) } : null;
    }
    if (id.startsWith('g:')) {
        try {
            const key = JSON.parse(id.slice(2));
            return Array.isArray(key) && key.every((k) => typeof k === 'string') ? { kind: 'group', key } : null;
        } catch {
            return null;
        }
    }
    return null;
}
