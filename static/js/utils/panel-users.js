/**
 * Who uses a panel, in words (GRP-7, design-gene-signature 7.1): "Used by 2 plots, 1 table" in a panel, and the
 * question the panel menu asks before it deletes a closed panel in use. The users are panel-references.js `usersOf`,
 * counted by the kind their panel type declares; a type not in the table counts as a panel. Pure.
 */
import { VOCABULARY } from './vocabulary.js';

/** "A and B", "A, B and C". */
function listText(items) {
    if (items.length < 2) return items.join('');
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * What a user of a panel counts as, by its panel type (the types panel-references.js declares). A type not listed
 * counts as a panel.
 */
const USER_KINDS = Object.freeze({
    'cell-plot': 'plot', 'gene-plot': 'plot', 'cell-gene': 'plot', 'cell-count': 'plot',
    'cell-table': 'table', 'gene-table': 'table', 'cell-grouping': 'grouping'
});
const USER_NOUNS = Object.freeze({
    plot: ['plot', 'plots'], table: ['table', 'tables'], grouping: [VOCABULARY.word.grouping, VOCABULARY.plural.grouping], panel: ['panel', 'panels']
});

/**
 * The users of a panel counted by kind, in the order plots, tables, groupings, panels: ["2 plots", "1 table"].
 * @param {Array<{kind: string}>} users - panel-references.js `usersOf`
 * @returns {string[]}
 */
function userCounts(users) {
    const counts = new Map(Object.keys(USER_NOUNS).map((k) => [k, 0]));
    for (const u of users || []) {
        const kind = USER_KINDS[u.kind] || 'panel';
        counts.set(kind, counts.get(kind) + 1);
    }
    return [...counts].filter(([, n]) => n).map(([kind, n]) => `${n} ${USER_NOUNS[kind][n === 1 ? 0 : 1]}`);
}

/** "Used by 2 plots, 1 table" (GRP-7), from the users of panel-references.js `usersOf`. */
export function usedByText(users) {
    const parts = userCounts(users);
    return parts.length ? `Used by ${parts.join(', ')}` : '';
}

/** The question a delete in the panel menu asks of a panel in use: "Delete 'Grouping 1'? 2 plots and 1 table use it." */
export function deleteInUseText(title, users) {
    return `Delete '${title}'? ${listText(userCounts(users))} ${users.length === 1 ? 'uses' : 'use'} it.`;
}
