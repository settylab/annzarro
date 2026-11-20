/**
 * The kinds of consumer that read a derived source (a signature's score today, a cell grouping later), and what
 * each counts as. One table, so that "who uses this source" is the same answer everywhere: a plot or a table or a
 * grouping uses a source; Inspect and its export only look at it.
 *
 * A consumer says its kind when it starts watching (`sources.watch(id, {kind, ...})`). It is separate from the
 * handle's `role`, which names the slot inside a plot ('color', 'x', 'hover:...') and is not counted.
 */

/** @type {Readonly<Record<string, Readonly<{counts: (string|null)}>>>} `counts`: the field of a usage row; null: not a consumer */
export const CONSUMER_KINDS = Object.freeze({
    plot: Object.freeze({ counts: 'plots' }),
    table: Object.freeze({ counts: 'tables' }),
    grouping: Object.freeze({ counts: 'groupings' }),
    inspect: Object.freeze({ counts: null }),
    'inspect-export': Object.freeze({ counts: null })
});

/** The fields of a usage row that count consumers, in display order. */
export const COUNT_FIELDS = Object.freeze(['plots', 'tables', 'groupings']);

function entry(kind) {
    if (typeof kind !== 'string' || !Object.hasOwn(CONSUMER_KINDS, kind)) throw new Error(`Unknown consumer kind '${kind}'`);
    return CONSUMER_KINDS[kind];
}

/** The usage-row field a kind is counted in, or null when it does not count. Throws for an unknown kind. */
export function countsAs(kind) {
    return entry(kind).counts;
}

/** Whether a kind is a consumer of the source (counted in "used by"), as opposed to a viewer. Throws for an unknown kind. */
export function isConsumer(kind) {
    return entry(kind).counts !== null;
}

/** A usage row with no consumers yet. */
export function emptyUsage(value) {
    return { value, plots: 0, tables: 0, groupings: 0 };
}
