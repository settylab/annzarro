/**
 * Categorical columns with many categories (annzarro/core/categories.py).
 *
 * A barcode or cell-id column stored as a categorical has one category per
 * cell. Colouring by it used to download every category (gigabytes at 95.6M
 * cells) and then fail; a column with a few thousand categories drew one
 * trace and one legend entry per category and hung the panel.
 *
 *   - up to LEGEND_CATEGORIES (100): one trace and legend entry per category,
 *     as before;
 *   - up to the colour limit (Config.DEFAULTS.CATEGORY_COLOUR_LIMIT, 10,000):
 *     categories share BUCKET_COLOURS (64) colours, category k gets colour
 *     k mod 64, one trace per colour, and the legend is one line ("1,344
 *     categories"); the hover still names each point's category;
 *   - above it: not coloured. The panel says the column has N distinct
 *     values, too many to colour by, and to show it in the hover or a table,
 *     which read labels only for the cells shown.
 *
 * Pure apart from reading Config, so Node tests cover it.
 */
import { Config } from '../config.js';

/** Categories listed one per legend entry; more get the one-line legend. */
export const LEGEND_CATEGORIES = 100;

/** Colours shared by the categories of a column with more than LEGEND_CATEGORIES. */
export const BUCKET_COLOURS = 64;

/** Server reason for a column refused for colour (core/categories.py). */
export const TOO_MANY_CATEGORIES = 'too_many_categories';

/** Most categories a column may have to be coloured by. */
export function categoryColourLimit() {
    const v = Config.DEFAULTS && Config.DEFAULTS.CATEGORY_COLOUR_LIMIT;
    return typeof v === 'number' && v >= 1 ? v : 10000;
}

const fmt = (n) => Number(n).toLocaleString('en-US');

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
 * What a panel says about a column it does not colour by, after the column's
 * name ("obs.barcode: too many categories to colour by -- ..."); also the
 * server's `detail` (core/categories.py).
 */
export function tooManyCategoriesDetail(count, limit = categoryColourLimit()) {
    return `${fmt(count)} distinct values (the limit is ${fmt(limit)}): show it in the hover or in a table instead`;
}

/** The whole sentence, column included (logs, the Error's message). */
export function tooManyCategoriesMessage(column, count, limit = categoryColourLimit()) {
    return `${column} has ${fmt(count)} distinct values, too many to colour by (the limit is ${fmt(limit)})`;
}

/**
 * An Error a colour load throws for such a column, shaped like the server's
 * 413 reply (`error.data.reason`), so coverage.js classifies both the same.
 */
export function tooManyCategoriesError(column, count, limit = categoryColourLimit()) {
    const err = new Error(tooManyCategoriesMessage(column, count, limit));
    err.status = 413;
    err.data = { reason: TOO_MANY_CATEGORIES, column, count, limit, purpose: 'colour',
                 detail: tooManyCategoriesDetail(count, limit) };
    return err;
}

/**
 * Null when `axis` (a colour setting) can be coloured by, otherwise the Error
 * to throw before anything is requested.
 * @param {{type: string, key: string}} axis
 * @param {Object} structure
 */
export function colourRefusal(axis, structure) {
    if (!axis || (axis.type !== 'obs' && axis.type !== 'var')) return null;
    const count = categoryCount(structure, axis.type, axis.key);
    const limit = categoryColourLimit();
    if (count === null || count <= limit) return null;
    return tooManyCategoriesError(`${axis.type}.${axis.key}`, count, limit);
}

/** True when a column with `n` categories gets the shared palette and one-line legend. */
export function bucketed(n) {
    return n > LEGEND_CATEGORIES;
}

/** The one legend line for a bucketed column. */
export function bucketLegendName(n) {
    return `${fmt(n)} categories (colours shared)`;
}
