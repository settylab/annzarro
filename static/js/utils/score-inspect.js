/**
 * Inspecting a gene score: the distribution of the score over the cells shown,
 * the figures of each gene (for the flags and the CSV; the panel does not list
 * every gene again), the plain-words flags, and the CSV of the gene figures. Pure (no DOM, no page state), so Node tests cover all of it; the
 * panel (panels/score-options/inspect-section.js) draws it.
 *
 * The score is the Float32Array the score store holds. Cells whose score is
 * NaN (every gene missing there) or not finite are counted as missing and left
 * out of the histogram and the summary figures; they are never drawn as zeros.
 */

/** Bars in the histogram. */
export const BINS = 30;

/** A gene detected in fewer than this share of cells is "barely detected". */
export const RARE_DETECTED = 0.01;

/** A z-score gene clipped in at least this share of cells is said to dominate those cells. */
export const CLIPPED_DOMINATES = 0.01;

/**
 * The distribution of a score.
 * @param {ArrayLike<number>} values
 * @param {{bins?: number}} [opts]
 * @returns {{n: number, finite: number, missing: number, min: (number|null), max: (number|null),
 *   mean: (number|null), sd: (number|null), edges: number[], counts: number[]}}
 *   `edges` has `counts.length + 1` entries; the last bin includes its upper edge. A score with one
 *   distinct value has one bin.
 */
export function distribution(values, { bins = BINS } = {}) {
    const n = values.length;
    let min = Infinity;
    let max = -Infinity;
    let finite = 0;
    let mean = 0;
    let m2 = 0;
    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (!Number.isFinite(v)) continue;
        finite++;
        if (v < min) min = v;
        if (v > max) max = v;
        const d = v - mean;                 // Welford: stable for a million cells
        mean += d / finite;
        m2 += d * (v - mean);
    }
    const missing = n - finite;
    if (!finite) return { n, finite, missing, min: null, max: null, mean: null, sd: null, edges: [], counts: [] };
    const sd = Math.sqrt(m2 / finite);
    if (min === max) return { n, finite, missing, min, max, mean, sd, edges: [min, max], counts: [finite] };
    const count = Math.max(1, Math.floor(bins));
    const width = (max - min) / count;
    const counts = new Array(count).fill(0);
    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (!Number.isFinite(v)) continue;
        let b = Math.floor((v - min) / width);
        if (b >= count) b = count - 1;
        else if (b < 0) b = 0;
        counts[b]++;
    }
    const edges = new Array(count + 1);
    for (let i = 0; i < count; i++) edges[i] = min + i * width;
    edges[count] = max;
    return { n, finite, missing, min, max, mean, sd, edges, counts };
}

/** A number in three significant digits, as the panel prints figures: 0.0213, 1.2, 41, 1.2e+4. */
/** Below this a figure is float rounding, not a value (a z-score's mean is 1e-10, never 0). */
const FLOAT_NOISE = 1e-6;

export function fmtNum(x) {
    if (x === null || x === undefined || !Number.isFinite(x)) return '';
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (a < FLOAT_NOISE) return '0';                         // 2e-10 is the mean of a z-score, not a value to show
    if (a >= 10000 || a < 0.001) return x.toExponential(1).replace('e+', 'e');
    return String(Number(x.toPrecision(3)));
}

/** A share (0 to 1) as a percentage: "41.2%", "0.4%", "<0.1%". */
export function fmtPercent(fraction) {
    if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '';
    if (fraction === 0) return '0%';
    const p = fraction * 100;
    if (p < 0.1) return '<0.1%';
    return `${p.toFixed(1)}%`;
}

/** What one bin says when pointed at: "1.2 to 1.8: 312 cells (11.6%)". */
export function binText(dist, i) {
    const lo = dist.edges[i];
    const hi = dist.edges[i + 1];
    const count = dist.counts[i];
    const share = dist.finite ? count / dist.finite : 0;
    const range = dist.counts.length === 1 && lo === hi ? `${fmtNum(lo)}` : `${fmtNum(lo)} to ${fmtNum(hi)}`;
    return `${range}: ${count.toLocaleString('en-US')} cell${count === 1 ? '' : 's'} (${fmtPercent(share)})`;
}

/**
 * The sentence under the histogram that counts what is not drawn.
 * @returns {string}
 */
export function missingText(dist) {
    if (!dist.missing) return 'No cell is missing a score.';
    const n = dist.missing.toLocaleString('en-US');
    return `${n} cell${dist.missing === 1 ? ' has' : 's have'} no score (every gene is missing there) and ${dist.missing === 1 ? 'is' : 'are'} not in the histogram.`;
}

// ---------------------------------------------------------------------------
// the genes

/**
 * Per-gene rows from the server's `result` frame, each with plain-words flags.
 *
 * - **Barely detected**: non-zero in under 1% of cells, so the few cells that
 *   express it set what it adds to the score.
 * - **Dominates**: in a z-score mean every gene has the same spread before
 *   clipping, so a gene dominates cells where it reaches the clip (clipped in
 *   at least 1% of cells). In a plain mean a gene dominates when its spread is
 *   at least half of all genes' spread together (variance share, and well above an equal share), or at least
 *   five times its equal share and a fifth of the total.
 * - **Left out**: constant in a z-score mean, or with no value in any cell.
 *
 * @param {Array<Object>} genes - `header.genes`
 * @param {string} method - 'zscore_mean' or 'mean'
 * @returns {Array<{name: string, status: string, detected: (number|null), mean: (number|null), sd: (number|null),
 *   clipped: (number|null), flags: Array<{kind: string, text: string}>}>}
 */
export function geneRows(genes, method) {
    const list = Array.isArray(genes) ? genes : [];
    const used = list.filter(g => g.status === 'used');
    let total = 0;
    for (const g of used) total += (g.sd || 0) ** 2;
    return list.map((g) => {
        const flags = [];
        const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
        const row = { name: g.name, status: g.status, detected: num(g.detected), mean: num(g.mean), sd: num(g.sd),
            clipped: num(g.clipped), flags };
        if (g.status === 'constant') {
            flags.push({ kind: 'left-out', text: method === 'zscore_mean'
                ? 'Left out: the same value in every cell.' : 'The same value in every cell, so it adds nothing to the differences.' });
        } else if (g.status === 'no_values') {
            flags.push({ kind: 'left-out', text: 'Left out: no value in any cell.' });
        } else {
            if (row.detected !== null && row.detected < RARE_DETECTED) {
                flags.push({ kind: 'rare', text: `Barely detected: non-zero in ${fmtPercent(row.detected)} of cells, so a few cells set what it adds.` });
            }
            if (method === 'zscore_mean') {
                if (row.clipped !== null && row.clipped >= CLIPPED_DOMINATES) {
                    flags.push({ kind: 'dominates', text: `Dominates: clipped in ${fmtPercent(row.clipped)} of cells, where it outweighs the other genes.` });
                }
            } else if (used.length >= 2 && total > 0 && row.sd !== null) {
                const share = row.sd ** 2 / total;
                if ((share >= 0.5 && share > 1.5 / used.length) || (share >= 0.2 && share >= 5 / used.length)) {
                    flags.push({ kind: 'dominates', text: `Dominates: its spread is about ${Math.round(share * 100)}% of all genes' spread together.` });
                }
            }
        }
        return row;
    });
}

/** Sentence on how many genes carry a flag, or ''. */
export function flagSummary(rows) {
    const count = (kind) => rows.filter(r => r.flags.some(f => f.kind === kind)).length;
    const parts = [];
    const dom = count('dominates');
    const rare = count('rare');
    const out = count('left-out');
    if (dom) parts.push(`${dom} gene${dom === 1 ? '' : 's'} dominate${dom === 1 ? 's' : ''} the score`);
    if (rare) parts.push(`${rare} ${rare === 1 ? 'is' : 'are'} barely detected`);
    if (out) parts.push(`${out} ${out === 1 ? 'was' : 'were'} left out`);
    return parts.length ? `${parts.join(', ')}.`.replace(/^./, c => c.toUpperCase()) : '';
}

/** The most genes a flag names; the CSV of the figures holds the rest. */
export const FLAG_NAMES_MAX = 20;

/**
 * The genes carrying one kind of flag ('dominates', 'rare' or 'left-out'), in the order of the rows, at most
 * FLAG_NAMES_MAX of them, with how many more there are.
 * @param {Array<Object>} rows - from geneRows
 * @param {string} kind
 * @returns {{names: string[], more: number}}
 */
export function flaggedGenes(rows, kind) {
    const all = rows.filter(r => r.flags.some(f => f.kind === kind)).map(r => r.name);
    return { names: all.slice(0, FLAG_NAMES_MAX), more: Math.max(0, all.length - FLAG_NAMES_MAX) };
}

// ---------------------------------------------------------------------------
// CSV

/**
 * One CSV field. Quoted when it holds a comma, quote or line break. Text that a spreadsheet would
 * run as a formula (it starts with = + - @ and is not a plain number) gets a leading apostrophe.
 */
export function csvField(value, { text = false } = {}) {
    if (value === null || value === undefined) return '';
    let s = String(value);
    if (text && /^[=+\-@\t\r]/.test(s) && !Number.isFinite(Number(s))) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A float64 figure from the server, as shortest text. */
function figure(x) {
    return typeof x === 'number' && Number.isFinite(x) ? String(x) : '';
}

/**
 * The per-gene figures of several combinations in the LONG form: one row per combination and gene, in the order the
 * server sent, with the combination named in the first column. Long, not one block of columns per combination, because
 * the figures of each combination are read from its own layer (a gene can be constant in one and not in another) and
 * the number of columns would otherwise grow with every combination; one fixed header filters, sorts and pivots in any
 * spreadsheet or script. Shares are fractions (0.412), not percentages. A source with down genes says which side each
 * gene is on; without any the file has no such column.
 * @param {Array<{label: string, genes: Array<Object>}>} blocks
 */
export function longGeneCsv(blocks) {
    const withDirection = blocks.some(b => (b.genes || []).some(g => g.direction === 'down'));
    const lines = [`combination,gene,${withDirection ? 'direction,' : ''}status,detected_fraction,mean,sd,clipped_fraction`];
    for (const b of blocks) {
        for (const g of b.genes || []) {
            lines.push([csvField(b.label), csvField(g.name, { text: true }), ...(withDirection ? [g.direction === 'down' ? 'down' : 'up'] : []),
                csvField(g.status), figure(g.detected), figure(g.mean), figure(g.sd), figure(g.clipped)].join(','));
        }
    }
    return `${lines.join('\r\n')}\r\n`;
}

/** The file name of an export: one combination keeps its name; several are named for the signature alone. */
export function exportFileName(title, what, combos) {
    return combos.length === 1 ? fileName(title, `${combos[0].method}_${combos[0].layer}_${what}`) : fileName(title, what);
}

/** A file name from a signature title and what the file holds: "T cell score-genes.csv" made safe. */
export function fileName(title, what, ext = 'csv') {
    const base = String(title || 'signature').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').replace(/^_+|_+$/g, '') || 'signature';
    return `${base}_${what}.${ext}`;
}
