/**
 * What the group grid of a Cell Grouping shows (UX 2.5, GRP-6, GRP-18), as data: the rows (colour, name, cells, share,
 * the small mark), the search, the cross-table of two factors, the focused gene's columns and the gate that decides
 * when they are asked for, the numbers as text, and the CSV, whose columns are the grid's.
 *
 * Pure (no DOM, no page state): a reply of the group store and the recipe in, rows and text out, so Node tests hold
 * every case. panels/cell-grouping/group-grid.js draws it.
 *
 * A group is identified by its key (the typed ids of its levels), never by its position: the focused gene's values
 * come from a reply of their own and are matched to the groups by key, so a reply that lists the groups in another
 * order, or lacks one, can never put a value on the wrong group.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { csvField } from '../../utils/csv-format.js';
import { STATISTIC_IDS } from '../../utils/cell-grouping.js';
import { statisticColumn, statisticAvailability } from '../../utils/cell-gene-model.js';

const W = VOCABULARY.cellGene;
/** The statistics offered when the recipe names none (UX 2.7). */
const DEFAULT_OFFERED = Object.freeze(['mean', 'pct_expressing']);
/** The live limit of an estimate when the server does not say (the derived sources' own). */
const LIVE_MAX_S = 5;
const DASH = '—';

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

// ================================================================================================ the focused gene

/** The first offered layer (UX 2.7): X unless the recipe offers others. */
export function layerOf(recipe) {
    return (recipe.layers && recipe.layers[0]) || 'X';
}

/** The request for the focused gene's moments, as the group stream takes it (plan 1.6). */
export function featureWire(gene, recipe) {
    return { kind: 'gene', name: gene, layer: layerOf(recipe), detect_above: recipe.detect_above || 0 };
}

const lowerFirst = (text) => (/^[A-Z][a-z]/.test(text) ? `${text[0].toLowerCase()}${text.slice(1)}` : text);

/**
 * The columns the focused gene adds: the offered statistics on the first offered layer, in the recipe's order. The
 * cell count is the grid's own column. A statistic the layer cannot give (% expressing on a signed layer) is left out.
 * @param {{gene: string, recipe: Object, kind?: ?string}} opts - `kind`: what the layer's numbers look like, when known
 * @returns {{id: string, stat: string, header: string}[]}
 */
export function focusColumns({ gene, recipe, kind = null }) {
    const offered = (recipe.offered || DEFAULT_OFFERED).filter((id) => id !== 'count' && STATISTIC_IDS.includes(id));
    return offered.filter((stat) => !kind || statisticAvailability(stat, kind).available)
        .map((stat) => ({ id: stat, stat, header: `${gene} ${lowerFirst(W.statistic[stat])}` }));
}

/** Whether an estimate is in the live tier: under the server's live limit, and neither asking first nor refused. */
export function isLive(estimate) {
    if (!estimate || estimate.tier === 'confirm' || estimate.tier === 'refused') return false;
    const limit = typeof estimate.live_max_s === 'number' ? estimate.live_max_s : LIVE_MAX_S;
    return Number(estimate.seconds) < limit;
}

/**
 * What the focused gene's columns do now (GRP-6): nothing with no gene focused; nothing asked while the panel is off
 * screen; a button, and no request, once an estimate said slow, until the user presses it.
 * @param {{gene: ?string, visible: boolean, blocked: boolean, forced: boolean}} state
 * @returns {'nogene'|'wait'|'estimate'|'button'|'compute'}
 */
export function gateOf({ gene, visible, blocked, forced }) {
    if (!gene) return 'nogene';
    if (forced) return 'compute';
    if (blocked) return 'button';
    return visible ? 'estimate' : 'wait';
}

/**
 * The focused gene's statistics per row, from its moments.
 * @param {Object} opts
 * @param {{id: string, stat: string}[]} opts.columns
 * @param {{keyText: string}[]} opts.rows - the grid's rows
 * @param {{groups: {key: string[]}[]}} opts.featureReply - the reply the moments came with: their groups, in their order
 * @param {Float64Array} opts.moments - the groups of `featureReply` x 5
 * @returns {Float64Array[]} one per column, one value per row, NaN where the group has no value
 */
export function focusValues({ columns, rows, featureReply, moments }) {
    const groups = featureReply.groups || [];
    const at = new Map(groups.map((g, i) => [keyText(g.key), i]));
    return columns.map((c) => {
        const per = statisticColumn(c.stat, moments, groups.length);
        const out = new Float64Array(rows.length);
        rows.forEach((r, i) => { const g = at.get(r.keyText); out[i] = g === undefined ? NaN : per[g]; });
        return out;
    });
}

/**
 * One number format for a whole column, so its figures line up: % expressing to one decimal (58.0, 100.0); any other
 * statistic with as many decimals as its smallest non-zero figure needs for three figures (at most 6). A dash for a
 * group with no value.
 * @param {string} stat
 * @param {ArrayLike<number>} values - the column
 * @returns {(x: number) => string}
 */
export function columnFormat(stat, values) {
    let decimals = 1;
    if (stat !== 'pct_expressing') {
        let least = Infinity;
        for (let i = 0; i < values.length; i++) {
            const v = Math.abs(values[i]);
            if (Number.isFinite(v) && v > 0 && v < least) least = v;
        }
        decimals = Number.isFinite(least) ? Math.min(6, Math.max(0, 2 - Math.floor(Math.log10(least)))) : 0;
    }
    return (x) => (typeof x === 'number' && Number.isFinite(x)
        ? x.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : DASH);
}

// ================================================================================================ columns and CSV

/** The columns of the list: the group's own, then the focused gene's (UX 2.5). The colour has no column of its own. */
export function listColumns({ focus }) {
    return [{ id: 'name', header: 'Name' }, { id: 'cells', header: 'Cells' }, { id: 'share', header: 'Share' },
        ...focus.map((c) => ({ id: c.id, header: c.header, focus: true }))];
}

/** A figure for a CSV: as long as it takes to read back; empty where a group has no value. */
const figure = (x) => (Number.isFinite(x) ? String(x) : '');

/**
 * The list as CSV (GRP-18): the key (the typed ids as JSON, which a name cannot give back), then exactly the grid's
 * columns. Every group, whatever the search shows. The share is a percent with its sign.
 * @param {{rows: Object[], columns: {id: string, header: string}[], values: Float64Array[]}} opts - `values`: per
 *   focused column, per row (`focusValues`)
 * @returns {string}
 */
export function listCsv({ rows, columns, values }) {
    const lines = [['Key', ...columns.map((c) => c.header)].map((h) => csvField(h, { text: true })).join(',')];
    const focused = columns.filter((c) => c.focus);
    for (const r of rows) {
        const fields = [csvField(JSON.stringify(r.key), { text: true }), csvField(r.name, { text: true }), String(r.n),
            `${Number((r.share * 100).toFixed(2))}%`];
        focused.forEach((c, k) => fields.push(figure(values[k][r.index])));
        lines.push(fields.join(','));
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
