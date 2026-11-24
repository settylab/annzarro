/**
 * What the group grid of a Cell Grouping shows (UX 2.5, GRP-6, GRP-18), as data: the rows (colour, name, cells, share,
 * the small mark), the search, the cross-table of two factors, the numbers as text, and the CSV, whose columns are the
 * grid's.
 *
 * Pure (no DOM, no page state): a reply of the group store and the recipe in, rows and text out, so Node tests hold
 * every case. panels/cell-grouping/group-grid.js draws it.
 *
 * A group is identified by its key (the typed ids of its levels), never by its position.
 */
import { csvField } from '../../utils/csv-format.js';

const keyText = (key) => key.join('\u0001');

/**
 * The rows of the list: one per group of the reply, in its order.
 * @param {Object} opts
 * @param {Object} opts.reply - the store's reply: `groups` ({key, n}) and `n_shown`
 * @param {string[]} opts.names - the name of each group (utils/group-sources.js `namesOf`)
 * @param {string[]} opts.colors - the colour of each group
 * @param {{threshold: number, mode: string}} opts.small - the small-groups setting; a group is marked only when kept
 * @returns {{index: number, key: string[], keyText: string, name: string, color: string, n: number, share: number, small: boolean}[]}
 */
export function groupRows({ reply, names, colors, small }) {
    const total = Number(reply.n_shown) || 0;
    const marks = small && small.mode === 'keep' ? small.threshold : 0;
    return (reply.groups || []).map((g, index) => ({
        index, key: g.key, keyText: keyText(g.key), name: names[index], color: colors[index], n: g.n,
        share: total > 0 ? g.n / total : 0, small: g.n < marks
    }));
}

/** A share of the cells shown as the grid writes it: "7.6%", "100%", "<0.1%", and never a 0 that is not one. */
export function shareText(share) {
    if (!(share > 0)) return '0%';
    if (share < 0.0005) return '<0.1%';
    return `${(share * 100).toFixed(1)}%`.replace('.0%', '%');
}

/** The groups whose name has the text, in any case; all of them for an empty search. */
export function filterRows(rows, text) {
    const needle = String(text || '').trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(needle));
}

/** The reasons a cell is in no group, as the rows of the grid while "in no group" is open. */
export function reasonRows(reasons) {
    return reasons.map((name, index) => ({ index, key: [], keyText: '', name, color: null, n: null, share: null, small: false }));
}

// ================================================================================================ the cross-table

/**
 * The cross-table of a grouping of exactly two factors (UX 2.5): the first factor's levels down, the second's
 * across, the cells of each combination. A combination with no cell is not a group (SHR-7): it reads 0, muted.
 * Made from the groups, so it costs the groups and not the product of the levels.
 * @param {Object} opts
 * @param {Object} opts.reply
 * @param {(factor: number, id: string) => string} opts.levelName - a level's label
 * @returns {?{rows: {id: string, label: string, total: number}[], cols: {id: string, label: string}[],
 *   count: (r: number, c: number) => number, holds: number, combinations: number, text: string}} null unless there are two factors
 */
export function crossTable({ reply, levelName }) {
    const parts = reply.partitionings;
    if (!Array.isArray(parts) || parts.length !== 2) return null;
    const pairs = (reply.groups || []).filter((g) => g.key.length === 2);
    const used = [new Set(), new Set()];
    for (const g of pairs) { used[0].add(g.key[0]); used[1].add(g.key[1]); }
    const levels = parts.map((p, i) => (p.levels || []).filter((id) => used[i].has(id)));
    const at = levels.map((list) => new Map(list.map((id, k) => [id, k])));
    const nc = levels[1].length;
    const counts = new Map();
    const totals = new Array(levels[0].length).fill(0);
    for (const g of pairs) {
        const r = at[0].get(g.key[0]);
        counts.set(r * nc + at[1].get(g.key[1]), g.n);
        totals[r] += g.n;
    }
    const holds = pairs.length;
    const combinations = levels[0].length * nc;
    return {
        rows: levels[0].map((id, r) => ({ id, label: levelName(0, id), total: totals[r] })),
        cols: levels[1].map((id) => ({ id, label: levelName(1, id) })),
        count: (r, c) => counts.get(r * nc + c) || 0,
        holds, combinations,
        text: `${holds.toLocaleString('en-US')} of ${combinations.toLocaleString('en-US')} combinations hold cells.`
    };
}

// ================================================================================================ columns and CSV

/** The columns of the list: the group's own. The colour has no column of its own. */
export function listColumns() {
    return [{ id: 'name', header: 'Name' }, { id: 'cells', header: 'Cells' }, { id: 'share', header: 'Share' }];
}

/**
 * The list as CSV (GRP-18): the key (the typed ids as JSON, which a name cannot give back), then exactly the grid's
 * columns. Every group, whatever the search shows. The share is a percent with its sign.
 * @param {{rows: Object[], columns: {id: string, header: string}[]}} opts
 * @returns {string}
 */
export function listCsv({ rows, columns }) {
    const lines = [['Key', ...columns.map((c) => c.header)].map((h) => csvField(h, { text: true })).join(',')];
    for (const r of rows) {
        lines.push([csvField(JSON.stringify(r.key), { text: true }), csvField(r.name, { text: true }), String(r.n),
            `${Number((r.share * 100).toFixed(2))}%`].join(','));
    }
    return `${lines.join('\n')}\n`;
}

/** The cross-table as CSV: the first factor's name in the corner, its levels down, the second's across. */
export function crossCsv(cross, factorNames) {
    const head = [factorNames[0] || '', ...cross.cols.map((c) => c.label)];
    const lines = [head.map((h) => csvField(h, { text: true })).join(',')];
    cross.rows.forEach((row, r) => {
        lines.push([csvField(row.label, { text: true }), ...cross.cols.map((_, c) => String(cross.count(r, c)))].join(','));
    });
    return `${lines.join('\n')}\n`;
}
