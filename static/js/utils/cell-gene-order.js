/**
 * The order of the Cell-Gene Plot's rows and groups (CXG-7, CXG-13, CXG-22 to CXG-25): source order, the grouping's
 * order (SHR-10) or its groups by size, and hierarchical clustering within the scopes the panel offers. The clustering
 * itself is hclust.js's, run off the main thread by its client; this module decides what each block holds, sends the
 * blocks, and puts the answers back in place. It writes no word the user reads: the panel words the states and counts.
 *
 * **Input.** `values` is the colour matrix as displayed (after scaling; cell-gene-model.js's layout,
 * `values[row * groups + group]`, NaN missing). `sections` lists the matrix rows in order: a section of `kind: 'genes'`
 * has one row per entry of `genes`; a section of `kind: 'set'` is one aggregated row. `bars` are the colour bars the
 * rows are drawn against, `[{rows, lo, hi}]`, each row on exactly one; they come from the drawing (X4a's colourBars),
 * never from here, so what is clustered cannot drift from what is drawn. `groups` is the reply's groups, `[{key, n}]`
 * in SHR-10 order, and `partitionings` the grouping's number of factors.
 *
 * **What is compared** (operator ruling): the colours as drawn. Each value enters as its place on its own bar, 0 at
 * the low end and 1 at the high end, so a row with its own bar (UX 3.3, mixed quantities) counts relative to that bar,
 * not in raw units; under one shared bar this is the displayed values rescaled once, which changes no order. Every
 * drawn row counts, aggregated rows included, and a row drawn twice counts twice, as it weighs twice in the picture.
 *
 * **Rules.**
 * - Genes: `off` keeps the source order (CXG-7). `sections` clusters each gene section on its own, across the groups;
 *   sections never mix and never move, and an aggregated row is never clustered. One section is the whole axis.
 * - Groups: `off` keeps SHR-10's order, or sorts by cells (descending, ties in that order) with `sortBySize` (CXG-13).
 *   `all` clusters every group as one block, on every row; `first` clusters within each level of the first factor,
 *   whose blocks stay intact and in order, and acts as `off` for a grouping of one factor. Clustering wins over the
 *   size sort.
 * - The collected small group (`["@small"]`, last in the reply) is never clustered and never moves.
 * - A block over the dendrogram row limit (limits.dendrogram_rows) is not clustered (`too_many`) and keeps its order. A block of one row needs no work.
 *
 * The answer is recomputed from the settings and never stored (CXG-25). It is remembered for the matrix shown, so a
 * repaint asking again with the same `values` (and the same `sections`, `groups` and `bars` arrays) costs no work.
 */
import { createHclustClient } from './hclust.js';
import { limit } from './limits.js';

const SMALL = '@small';

const isCollected = (group) => group.key.length === 1 && group.key[0] === SMALL;
const iota = (n) => Int32Array.from({ length: n }, (_, i) => i);
const shift = (arr, by) => Int32Array.from(arr, (v) => v + by);
const plainBlock = (start, count, state) => ({ start, count, state });

/**
 * Each value as its place on its own colour bar, 0 at the low end and 1 at the high end; a bar with no range places
 * its rows at 0 and a missing value stays missing. Every row must be on exactly one bar.
 */
function placeOnBars(values, rows, groups, bars) {
    const placed = new Float64Array(values.length);
    const seen = new Uint8Array(rows);
    for (const { rows: members, lo, hi } of bars) {
        const span = hi - lo;
        for (const r of members) {
            if (!(r >= 0 && r < rows)) throw new Error(`Colour bars: there is no row ${r}.`);
            if (seen[r]) throw new Error(`Colour bars: row ${r} is on two bars.`);
            seen[r] = 1;
            for (let i = r * groups, end = i + groups; i < end; i++) {
                const v = values[i];
                placed[i] = Number.isNaN(v) ? NaN : span > 0 ? (v - lo) / span : 0;
            }
        }
    }
    const missing = seen.indexOf(0);
    if (missing >= 0) throw new Error(`Colour bars: row ${missing} is on no bar.`);
    return placed;
}

/** Runs of groups `[start, count]` to cluster under a scope, the collected group left out. */
function groupRuns(groups, scope) {
    const end = groups.length && isCollected(groups[groups.length - 1]) ? groups.length - 1 : groups.length;
    if (scope === 'all') return end ? [[0, end]] : [];
    const runs = [];
    for (let g = 0; g < end; g++) {
        if (g > 0 && groups[g].key[0] === groups[g - 1].key[0]) runs[runs.length - 1][1]++;
        else runs.push([g, 1]);
    }
    return runs;
}

function bySize(groups) {
    const ids = Array.from(groups.keys()).filter((g) => !isCollected(groups[g]));
    ids.sort((a, b) => groups[b].n - groups[a].n || a - b);
    const out = new Int32Array(groups.length);
    out.set(ids);
    if (ids.length < groups.length) out[ids.length] = groups.length - 1;
    return out;
}

/**
 * Cluster one block of `count` matrix rows (or groups) given as a row-major `count x cols` copy, and write its order
 * into `order` at `start`. Returns the block's description, with absolute indices; `merges` index into `clustered`.
 */
function clusterBlock(cluster, settings, matrix, start, count, cols, order) {
    if (count > settings.maxRows) return Promise.resolve(plainBlock(start, count, 'too_many'));
    if (count < 2) {
        return Promise.resolve({ ...plainBlock(start, count, 'clustered'), clustered: shift(iota(count), start),
            excluded: new Int32Array(0), merges: new Float64Array(0) });
    }
    return cluster(matrix(), count, cols, settings).then((r) => {
        for (let i = 0; i < count; i++) order[start + i] = start + r.order[i];
        return { ...plainBlock(start, count, 'clustered'), clustered: shift(r.clustered, start),
            excluded: shift(r.excluded, start), merges: r.merges };
    });
}

function compute(cluster, input, rows) {
    const { sections, groups, partitionings, sortBySize } = input;
    // the most rows clustered: the server's limits.dendrogram_rows, read once per ordering
    const settings = { linkage: input.cluster.linkage, distance: input.cluster.distance, maxRows: limit('dendrogram_rows') };
    const G = groups.length;
    const values = placeOnBars(input.values, rows, G, input.bars);
    const rowOrder = iota(rows);
    const jobs = [];

    let start = 0;
    const rowJobs = sections.map((s) => {
        const count = s.kind === 'set' ? 1 : s.genes.length;
        const from = start;
        start += count;
        if (s.kind === 'set' || input.cluster.genes !== 'sections') return Promise.resolve(plainBlock(from, count, 'off'));
        return clusterBlock(cluster, settings, () => values.subarray(from * G, (from + count) * G), from, count, G, rowOrder);
    });
    jobs.push(Promise.all(rowJobs));

    let scope = input.cluster.groups;
    if (scope === 'first' && !(partitionings >= 2)) scope = 'off';
    let groupOrder;
    let groupJobs;
    if (scope === 'off') {
        groupOrder = sortBySize ? bySize(groups) : iota(G);
        groupJobs = [Promise.resolve(plainBlock(0, G, 'off'))];
    } else {
        groupOrder = iota(G);
        const F = rows;
        const transposed = (from, count) => () => {
            const out = new Float64Array(count * F);
            for (let b = 0; b < count; b++) {
                for (let f = 0; f < F; f++) out[b * F + f] = values[f * G + from + b];
            }
            return out;
        };
        groupJobs = groupRuns(groups, scope).map(([from, count]) =>
            clusterBlock(cluster, settings, transposed(from, count), from, count, F, groupOrder));
        if (G && isCollected(groups[G - 1])) groupJobs.push(Promise.resolve(plainBlock(G - 1, 1, 'off')));
    }
    jobs.push(Promise.all(groupJobs));

    const leftOut = (blocks) => blocks.reduce((a, b) => a + (b.excluded ? b.excluded.length : 0), 0);
    return Promise.all(jobs).then(([rowBlocks, groupBlocks]) => ({
        rows: rowOrder, groups: groupOrder, rowBlocks, groupBlocks,
        rowsLeftOut: leftOut(rowBlocks), groupsLeftOut: leftOut(groupBlocks), groupsScope: scope
    }));
}

const settingsKey = (input) => {
    const c = input.cluster;
    return `${c.genes}|${c.groups}|${c.linkage}|${c.distance}|${input.partitionings}|${input.sortBySize ? 1 : 0}`;
};

/**
 * The orderer of one panel.
 * @param {{cluster?: (values, rows, cols, opts) => Promise}} [opts] - hclust's client by default
 * @returns {{order(input) => Promise<{rows: Int32Array, groups: Int32Array, rowBlocks: Object[], groupBlocks: Object[],
 *   rowsLeftOut: number, groupsLeftOut: number, groupsScope: 'off'|'all'|'first'}>}}
 *   `rows` and `groups` give the matrix index at each drawn position. A block is `{start, count, state}`, state `off`,
 *   `clustered` (with `clustered`, `excluded` and `merges`, scipy's linkage matrix flat, for a dendrogram) or `too_many`.
 */
// export-unused-ok: X3a orders its matrix with it; X4b draws the blocks' dendrograms, X5 words their states
export function createCellGeneOrder({ cluster } = {}) {
    let client = null;
    const run = cluster || ((...args) => {
        client = client || createHclustClient();
        return client.cluster(...args);
    });
    const shown = new WeakMap();
    return {
        order(input) {
            const rows = input.sections.reduce((a, s) => a + (s.kind === 'set' ? 1 : s.genes.length), 0);
            if (input.values.length !== rows * input.groups.length) {
                throw new Error(`The values do not make a ${rows} x ${input.groups.length} matrix.`);
            }
            const key = settingsKey(input);
            const known = shown.get(input.values);
            if (known && known.key === key && known.sections === input.sections && known.groups === input.groups
                && known.bars === input.bars) {
                return known.answer;
            }
            const answer = compute(run, input, rows);
            const entry = { key, sections: input.sections, groups: input.groups, bars: input.bars, answer };
            shown.set(input.values, entry);
            answer.catch(() => { if (shown.get(input.values) === entry) shown.delete(input.values); });
            return answer;
        }
    };
}
