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

/**
 * Labels past which a grouped colouring in the regular path asks first. The
 * hover needs every point's label: with a category per point that is one
 * label per point, about 29 MB at 1M points. Measured at 1M points (M3 Max,
 * one trace in data order, df11b6f): a one-per-cell column took 7.0 s and
 * 772 MB of heap to colour, a 65,000-category column 6.6 s and 680 MB, 64
 * plain categories 2.4 s and 276 MB. So from 500,000 distinct labels the plot
 * is drawn grey and the panel offers "Colour anyway".
 */
export const COLOUR_ASK_LABELS = 500000;

/** Reason of the Error a colour load throws while it waits to be asked. */
export const COLOUR_COST = 'colour_cost';

const _allowed = new Set();

/** Let panel `id` colour by `column` despite its cost (the "Colour anyway" action). */
export function allowColour(id, column) {
    _allowed.add(`${id}\u0000${column}`);
}

/** Whether panel `id` was allowed to colour by `column`. */
export function colourAllowed(id, column) {
    return _allowed.has(`${id}\u0000${column}`);
}

/**
 * Null when colouring by a column needs no asking, otherwise the Error a
 * colour load throws instead (the plot is drawn grey, the panel's status
 * line says what colouring costs and offers "Colour anyway").
 * @param {string} column  e.g. 'obs.barcode'
 * @param {number|null} categories  the column's number of categories
 * @param {number} points  points in the plot
 */
export function colourCostError(column, categories, points) {
    if (categories === null || !grouped(categories)) return null;
    const labels = Math.min(categories, points);
    if (labels <= COLOUR_ASK_LABELS) return null;
    const mb = Math.max(1, Math.round(labels * 29 / 1e6));   // measured: 28.9 MB for 1M barcodes
    const detail = `${labels.toLocaleString('en-US')} distinct values on ${points.toLocaleString('en-US')} points: `
        + `colouring loads about ${mb} MB of labels for the hover and takes a few seconds longer`;
    const err = new Error(`${column} not coloured yet: ${detail}`);
    err.data = { reason: COLOUR_COST, column, detail, labels };
    return err;
}
