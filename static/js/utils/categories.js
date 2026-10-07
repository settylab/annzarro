/**
 * Colouring by a categorical column with many categories, up to one per
 * cell (annzarro/core/categories.py).
 *
 * Up to GROUP_COLOURS (64) categories: one trace and one legend entry per
 * category, as always. Past that, colour GROUPS: the column's categories are
 * ranked by how many cells of the WHOLE column they hold (ties by stored
 * code), and rank r is drawn in colour r mod 64, so the 64 largest
 * categories each lead a colour. The rank is the column's, computed once by
 * the server and cached, so a category keeps its colour in every panel,
 * subset, part, table filter and zoom. One trace per colour (64 at most), and
 * one legend entry per colour naming its categories on the plot, largest
 * first: "S1, S7, S12 +18 more". The hover names each point's exact category.
 *
 * Colouring this way needs each cell's rank (categories=ranked) and the
 * labels of the few categories a legend names, never the column's label
 * list.
 *
 * Pure, so Node tests cover it.
 */

/** Colours of the palette a column with more categories is grouped into. */
export const GROUP_COLOURS = 64;

/** Category names a group's legend entry lists before "+N more". */
export const LEGEND_NAMES = 3;

/**
 * Most groups a subset may be balanced across (annzarro/core/categories.py
 * MAX_BALANCE_GROUPS): one group per cell is no balance.
 */
export const MAX_BALANCE_GROUPS = 10000;

/**
 * Most distinct values offered as a list to pick from (a table filter's
 * "equals" dropdown, the subset filter's suggestions); a column with more is
 * filtered by typing the value.
 */
export const VALUE_LIST_MAX = 10000;

/** True when a column with `n` categories is drawn in colour groups. */
export function grouped(n) {
    return n > GROUP_COLOURS;
}

/**
 * The number of categories of an obs/var column, from the dataset
 * structure's columns_info (the server reads it from the categories array's
 * shape), or null when the column is not categorical or the server does not
 * say.
 * @param {Object} structure  /data/dataset_structure reply
 * @param {'obs'|'var'} slot
 * @param {string} key
 */
export function categoryCount(structure, slot, key) {
    const info = structure && structure[slot] && structure[slot].columns_info
        && structure[slot].columns_info[key];
    const n = info && info.n_categories;
    return typeof n === 'number' ? n : null;
}

/**
 * Frequency ranks from per-category counts: `rankOf[k]` is category k's rank
 * (0 = most cells; ties by k), -1 for a category with no cells; `order[r]` is
 * the category at rank r; `used` the number of categories with cells.
 * @param {ArrayLike<number>} counts
 */
export function frequencyRanks(counts) {
    // A counting sort over the counts (stable, so ties keep category order):
    // linear in categories and cells, where a comparison sort of a million
    // categories took a noticeable fraction of a second.
    const k = counts.length;
    let max = 0;
    for (let i = 0; i < k; i++) if (counts[i] > max) max = counts[i];
    const start = new Uint32Array(max + 2);       // start[c]: first rank of count c, from the largest
    for (let i = 0; i < k; i++) if (counts[i] > 0) start[max - counts[i] + 1]++;
    for (let c = 1; c <= max + 1; c++) start[c] += start[c - 1];
    const used = start[max + 1];
    const order = new Int32Array(used);
    const rankOf = new Int32Array(k).fill(-1);
    for (let i = 0; i < k; i++) {
        const c = counts[i];
        if (c > 0) { const r = start[max - c]++; order[r] = i; rankOf[i] = r; }
    }
    return { rankOf, order, used };
}

/** The colour group of rank `r`. */
export function groupOf(rank) {
    return rank % GROUP_COLOURS;
}

/**
 * The legend entry of a colour group: the names of its categories on the
 * plot, largest (lowest rank) first, then "+N more".
 * @param {Array<*>} names  the group's categories present, in rank order
 */
export function groupLegendName(names) {
    const shown = names.slice(0, LEGEND_NAMES).map(String);
    const more = names.length - shown.length;
    return more > 0 ? `${shown.join(', ')} +${more.toLocaleString('en-US')} more` : shown.join(', ');
}
