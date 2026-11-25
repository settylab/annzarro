/**
 * The numbers of the Cell-Gene Plot: every statistic, every scaling and every gene-set row, derived in the browser
 * from the moments the server sends (SHR-19, SHR-21, CXG-9, CXG-10, CXG-16, CXG-17, CXG-20). Changing the
 * statistic, the scaling or the colour map therefore costs no request.
 *
 * Pure and DOM-free, so Node tests hold it against scanpy (tests/data/oracle/dotplot_matrixplot.json, 1e-9 relative).
 * It writes no word the user reads: labels are passed in (`names`) by the panel, from utils/vocabulary.js.
 *
 * **Moments.** One feature in all groups is one Float64Array of `groups x 5`: `[n, sum, sumsq, nAbove, sumAbove]` per
 * group, the finite values only, as `feature_moments` of the group stream arrives (one slice of its block). `nAbove`
 * and `sumAbove` are taken at the feature's own `detect_above`, so the threshold lives in the request, not here.
 *
 * **Missing.** A value is NaN when a group has no cell to stand on (no finite value of that gene in it), and it is
 * never 0 (SHR-20). The one exception is the operator's P3: the mean of expressing cells of a group with cells but
 * none expressing is 0, as scanpy writes it, and `noExpressingCells` marks those so the hover and the CSV can say so.
 * That rule is written once, in `meanOfExpressing`.
 *
 * **Matrices** are `{values, rows, groups}` with `values[row * groups + group]`, Float64Array, NaN for missing.
 * A row is a gene, or one aggregated row of a section.
 */
import { csvField } from './csv-format.js';
import { VOCABULARY } from './vocabulary.js';
import { STATISTIC_IDS } from './cell-grouping.js';
import { limit } from './limits.js';

const W = VOCABULARY.cellGene;

/** Fields per group in a feature's moments. */
// export-unused-ok: consumed by X3a (it slices a feature out of the stream's moments block)
export const MOMENT_STRIDE = 5;
const N = 0;
const SUM = 1;
const SUMSQ = 2;
const N_ABOVE = 3;
const SUM_ABOVE = 4;

/**
 * Rounding in `sumsq / n - mean^2` is about 2e-16 of `sumsq / n`; a variance below this share of it is a constant
 * and its spread is 0, so a constant gene never gets a spread of 1e-8 from rounding and never divides by it.
 */
const FLAT = 1e-12;

/** The scalings of CXG-10, in the frozen schema's order. */
// export-unused-ok: consumed by X3a (the Scale select lists them)
export const SCALINGS = Object.freeze(['none', 'var', 'group', 'z_groups', 'z_pooled']);

/** The scalings that z-score the statistic (against the groups, or against all grouped cells). */
export const Z_SCALINGS = Object.freeze(['z_groups', 'z_pooled']);

/**
 * Whether a Scale option applies under a Color statistic (aggregation-unify-080 2.2): under z-score mean the colour is a
 * z-score already, so the two z Scale options would redraw the same picture under a second name. A statement of the model, not
 * of the select: the select disables the option with `reason`, and normalizeCellGene moves a stored one to None.
 * @returns {{ok: true}|{ok: false, reason: string}}
 */
export function scalingGrade(scaling, colorStat) {
    if (colorStat === 'zscore_mean' && Z_SCALINGS.includes(scaling)) return { ok: false, reason: W.scaleWhy.zscore };
    return { ok: true };
}

/**
 * The Cell-Gene Plot's modes, one row each (aggregation-unify-080.md 5.1.3). `channels` lists the measures the mode
 * draws (Color, Size); the control grid shows exactly those. A new mode is a row here, with nothing else to change in
 * the grid. The stored `value`s are the configuration's `mode`.
 */
export const MODE_INFO = Object.freeze([
    Object.freeze({ value: 'dots', label: 'Dots', channels: Object.freeze(['color', 'size']) }),
    Object.freeze({ value: 'heatmap', label: 'Heatmap', channels: Object.freeze(['color']) })
]);

/**
 * Whether a mode draws a channel, so whether the control grid shows that channel's row. An unknown mode shows nothing.
 * @param {string} mode - a MODE_INFO value
 * @param {string} channel - 'color' or 'size'
 * @param {ReadonlyArray<{value: string, channels: ReadonlyArray<string>}>} [info] - the registry (tests pass their own)
 * @returns {boolean}
 */
export function modeShowsChannel(mode, channel, info = MODE_INFO) {
    const row = info.find((m) => m.value === mode);
    return !!row && row.channels.includes(channel);
}

/**
 * The gene step of a one-row section that combines its gene rows (decision 40, one-row-ux-080.md): each gene's statistic
 * per group, exactly as the gene rows show it, then the mean, the sum or the mean of their z-scores across groups. Any
 * other gene step is a score method of the section's source: each cell is scored, then the channel's statistic is taken
 * over the group's cells.
 */
export const ROW_STEPS = Object.freeze(['rows_mean', 'rows_sum', 'rows_z']);

/** A new one-row section's gene step: the mean of its gene rows (the same as Color and Size, decision 40). */
export const DEFAULT_ROW_STEP = 'rows_mean';

/** Whether a gene step combines the gene rows (else it scores each cell). */
export const combinesRows = (step) => ROW_STEPS.includes(step);

/**
 * Whether a section's one gene step can serve a channel (aggregation-unify-080.md 10.1). Cell count does not depend on
 * genes, so it never grades. A source with down genes cannot be combined from its rows (they would count as up); a sum of
 * SDs is not the spread of the set, and a sum of means over each gene's own expressing cells is the mean of no cells; a
 * score has no mean over its expressing cells (a % channel shows the share of cells expressing any gene instead). Under
 * z-score mean a set's row is its z-score mean score: only the default step stands (aggregation-unify-080.md 2.3, 10.1).
 * @param {string} step - one of ROW_STEPS or a score method
 * @param {string} stat - the channel's statistic
 * @param {{down?: number}} [opts] - the section's down genes in the dataset
 * @returns {{ok: true}|{ok: false, reason: 'down'|'zscore'|'sum_sd'|'sum_mean_expressing'|'score_mean_expressing'}}
 */
export function rowStepGrade(step, stat, { down = 0 } = {}) {
    if (stat === 'count') return { ok: true };
    // the default step: the mean of the gene rows, or the z-score mean score for a source with down genes
    if (stat === 'zscore_mean') return step === (down > 0 ? 'zscore_mean' : DEFAULT_ROW_STEP) ? { ok: true } : { ok: false, reason: 'zscore' };
    if (combinesRows(step)) {
        if (down > 0) return { ok: false, reason: 'down' };
        if (step === 'rows_sum' && (stat === 'sd' || stat === 'mean_expressing')) return { ok: false, reason: `sum_${stat}` };
    } else if (stat === 'mean_expressing') {
        return { ok: false, reason: 'score_mean_expressing' };
    }
    return { ok: true };
}

/** The statistics read at an expression threshold. */
const THRESHOLDED = Object.freeze(['pct_expressing', 'mean_expressing']);


// --- the statistics ---------------------------------------------------------------------------------------------

/** The mean of expressing cells; P3: 0 when no cell expresses (the caller has checked that a cell exists). */
function meanOfExpressing(nAbove, sumAbove) {
    return nAbove > 0 ? sumAbove / nAbove : 0;
}

/** Population SD (ddof 0) from the sums; 0 for a constant (see FLAT). */
function spreadOf(n, sum, sumsq) {
    const mean = sum / n;
    const meanSquare = sumsq / n;
    const variance = meanSquare - mean * mean;
    return variance <= FLAT * meanSquare ? 0 : Math.sqrt(variance);
}

/** One statistic of one group from its five moments at `o`; NaN when the group has no value. */
function valueOf(stat, m, o) {
    const n = m[o + N];
    if (!(n > 0)) return NaN;
    switch (stat) {
        case 'zscore_mean':        // the moments are those of the z-scored gene (server transform zscore): a mean
        case 'mean': return m[o + SUM] / n;
        case 'pct_expressing': return 100 * m[o + N_ABOVE] / n;
        case 'mean_expressing': return meanOfExpressing(m[o + N_ABOVE], m[o + SUM_ABOVE]);
        case 'sum': return m[o + SUM];
        case 'sd': return spreadOf(n, m[o + SUM], m[o + SUMSQ]);
        default: throw new Error(`unknown statistic ${stat}`);
    }
}

/**
 * One statistic of one feature in every group.
 * @param {string} stat - zscore_mean, mean, pct_expressing, mean_expressing, sum, sd or count
 * @param {Float64Array|null} moments - groups x 5; null for `count`, which needs no feature
 * @param {number} groups
 * @param {Float64Array} [sizes] - the groups' cell counts, for `count`
 * @returns {Float64Array} one value per group, NaN where the group has no value
 */
// export-unused-ok: consumed by X3a (the cell-gene panel) and X4a (hover and drawing)
export function statisticColumn(stat, moments, groups, sizes) {
    if (!STATISTIC_IDS.includes(stat)) throw new Error(`unknown statistic ${stat}`);
    const out = new Float64Array(groups);
    if (stat === 'count') {
        if (!sizes || sizes.length !== groups) throw new Error('count needs the groups\' cell counts');
        out.set(sizes);
        return out;
    }
    for (let g = 0; g < groups; g++) out[g] = valueOf(stat, moments, g * MOMENT_STRIDE);
    return out;
}

/**
 * The groups whose value is the P3 zero: a mean of expressing cells over cells, none of which expresses. 1 where so.
 * Other statistics carry no such note (a mean of zeros is a measured 0).
 * @returns {Uint8Array}
 */
// export-unused-ok: consumed by X4a (hover text "no expressing cells") and X5 (the CSV note)
export function noExpressingCells(stat, moments, groups) {
    const out = new Uint8Array(groups);
    if (stat !== 'mean_expressing') return out;
    for (let g = 0; g < groups; g++) {
        const o = g * MOMENT_STRIDE;
        if (moments[o + N] > 0 && !(moments[o + N_ABOVE] > 0)) out[g] = 1;
    }
    return out;
}

/**
 * Whether a statistic can be computed on a layer of this kind (OD 8, SHR-27): % expressing and mean of expressing cells
 * cannot on a layer with negative values. `kind` is the `kind` of `/api/v1/data/matrix_kind`.
 * @returns {{available: true}|{available: false, reason: 'negative_values'}}
 */
// export-unused-ok: consumed by X3a (menus leave the statistic out, with the reason)
export function statisticAvailability(stat, kind) {
    if ((stat === 'pct_expressing' || stat === 'mean_expressing') && kind === 'signed') return { available: false, reason: 'negative_values' };
    return { available: true };
}

// --- the pooled reference and the scalings ----------------------------------------------------------------------

/**
 * The mean and SD of one gene over the cells that are in a group (OD 12), summed from the groups' moments. A cell
 * excluded for having no value, lying outside thresholds, `rest: 'exclude'` or being in a hidden small group is not in
 * a counted group, so it is not here.
 * @param {Float64Array} moments
 * @param {number} groups
 * @param {Uint8Array} [counted] - 1 for a group whose cells count; every group counts when absent
 * @returns {{mean: number, sd: number}} NaN when no counted cell has a value
 */
// export-unused-ok: consumed by X3a (it builds the references that `scale` takes for z_pooled)
export function pooledReference(moments, groups, counted) {
    let n = 0;
    let sum = 0;
    let sumsq = 0;
    for (let g = 0; g < groups; g++) {
        if (counted && !counted[g]) continue;
        const o = g * MOMENT_STRIDE;
        n += moments[o + N];
        sum += moments[o + SUM];
        sumsq += moments[o + SUMSQ];
    }
    if (!(n > 0)) return { mean: NaN, sd: NaN };
    return { mean: sum / n, sd: spreadOf(n, sum, sumsq) };
}

const isFlat = (lo, hi) => hi - lo <= FLAT * Math.max(Math.abs(lo), Math.abs(hi));

/** Min to max over the entries `first, first + step, ...` (`count` of them), written into `out`; flat gives 0. */
function minToMax(values, out, first, step, count) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0, i = first; k < count; k++, i += step) {
        const v = values[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    const flat = isFlat(lo, hi);
    for (let k = 0, i = first; k < count; k++, i += step) {
        const v = values[i];
        out[i] = Number.isNaN(v) ? NaN : flat ? 0 : (v - lo) / (hi - lo);
    }
}

/** z-score of one row's groups against their own mean and population SD, flat gives 0. */
function zAcrossGroups(values, out, first, count) {
    let n = 0;
    let sum = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let g = 0; g < count; g++) {
        const v = values[first + g];
        if (Number.isNaN(v)) continue;
        n += 1;
        sum += v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    const mean = sum / n;
    let sd = 0;
    if (n > 0 && !isFlat(lo, hi)) {
        let squares = 0;
        for (let g = 0; g < count; g++) {
            const v = values[first + g];
            if (!Number.isNaN(v)) squares += (v - mean) * (v - mean);
        }
        sd = Math.sqrt(squares / n);
    }
    for (let g = 0; g < count; g++) {
        const v = values[first + g];
        out[first + g] = Number.isNaN(v) ? NaN : sd === 0 ? 0 : (v - mean) / sd;
    }
}

/**
 * A matrix under one of the scalings of CXG-10. Groups with no value are skipped in every minimum, maximum, mean and
 * SD and stay missing; a constant row or column gives 0; the SD is the population SD; nothing is clipped. Returns a new
 * array and leaves `matrix` alone.
 * @param {{values: Float64Array, rows: number, groups: number}} matrix
 * @param {string} scaling - one of SCALINGS
 * @param {{mean: number, sd: number}[]} [references] - per row, for `z_pooled` (pooledReference of that gene)
 * @returns {Float64Array}
 */
// export-unused-ok: consumed by X3a (the model behind the Scale select) and X4a (drawing)
export function scale(matrix, scaling, references) {
    if (!SCALINGS.includes(scaling)) throw new Error(`unknown scaling ${scaling}`);
    const { values, rows, groups } = matrix;
    const out = new Float64Array(values.length);
    if (scaling === 'none') {
        out.set(values);
    } else if (scaling === 'var') {
        for (let r = 0; r < rows; r++) minToMax(values, out, r * groups, 1, groups);
    } else if (scaling === 'group') {
        for (let g = 0; g < groups; g++) minToMax(values, out, g, groups, rows);
    } else if (scaling === 'z_groups') {
        for (let r = 0; r < rows; r++) zAcrossGroups(values, out, r * groups, groups);
    } else {
        if (!references || references.length !== rows) throw new Error('z_pooled needs the pooled reference of every row');
        for (let r = 0; r < rows; r++) {
            const { mean, sd } = references[r];
            for (let g = 0; g < groups; g++) {
                const v = values[r * groups + g];
                out[r * groups + g] = Number.isNaN(v) || Number.isNaN(sd) ? NaN : sd === 0 ? 0 : (v - mean) / sd;
            }
        }
    }
    return out;
}

// --- gene-set rows (SHR-21, decision 40) ------------------------------------------------------------------------

/**
 * The one value per group of a one-row section that combines its gene rows: each gene's `stat` per group (what its gene
 * row shows), then over the genes:
 * - `rows_mean`: the mean of the genes with a value in that group;
 * - `rows_sum`: their sum; under % expressing the sum of the genes' fractions, the expected number of the set's genes
 *   detected in a cell (decision 40: "Genes detected per cell", never on the 0 to 100 scale);
 * - `rows_z`: each gene row as a z-score across the groups (population SD, a flat row 0), then the mean.
 * A gene with no value in a group is skipped there; a group where no gene has one is missing (NaN, never 0).
 * @param {string} step - one of ROW_STEPS
 * @param {string} stat - the channel's statistic (not count: that row is the groups' sizes)
 * @param {Float64Array[]} input - the genes' moments, one per gene
 * @param {number} groups
 * @returns {Float64Array}
 */
export function combineRows(step, stat, input, groups) {
    if (!combinesRows(step)) throw new Error(`${step} does not combine gene rows`);
    if (!Array.isArray(input)) throw new Error(`${step} needs the genes' moments`);
    const total = new Float64Array(groups);
    const seen = new Uint32Array(groups);
    const column = new Float64Array(groups);
    const fraction = stat === 'pct_expressing' && step === 'rows_sum' ? 0.01 : 1;
    for (const moments of input) {
        for (let g = 0; g < groups; g++) column[g] = valueOf(stat, moments, g * MOMENT_STRIDE);
        if (step === 'rows_z') zAcrossGroups(column, column, 0, groups);
        for (let g = 0; g < groups; g++) {
            const v = column[g];
            if (Number.isNaN(v)) continue;
            total[g] += v * fraction;
            seen[g] += 1;
        }
    }
    const out = new Float64Array(groups);
    for (let g = 0; g < groups; g++) out[g] = seen[g] === 0 ? NaN : step === 'rows_sum' ? total[g] : total[g] / seen[g];
    return out;
}

// --- limits (CXG-17) --------------------------------------------------------------------------------------------

/**
 * Whether the matrix may be requested (CXG-17): at most `genes_per_section` genes in a section (2,000 by default),
 * `matrix_values` cells of the drawn matrix (groups x rows) and `matrix_values` values the server accumulates (groups
 * x planned features; 400,000 by default). The limits are the server's, read when asked (utils/limits.js). A gene read
 * on two layers, or at two thresholds, is two features (finding 9), so the second limit is reached first when Color
 * and Size read differently.
 * @param {{groups: number, sections: {rows: number, genes: number}[], features?: number}} shape - `rows` is what the
 *   section draws; `features` the distinct features the request carries (sections.js planFeatures)
 * @returns {{ok: true}|{ok: false, reason: 'too_many_genes', section: number, count: number, limit: number}
 *   |{ok: false, reason: 'matrix_too_large'|'too_many_values', count: number, limit: number}}
 */
// export-unused-ok: consumed by X3a (nothing is requested above the limit, and the panel says which number to reduce)
export function matrixLimits({ groups, sections, features = 0 }) {
    const perSection = limit('genes_per_section');
    for (let s = 0; s < sections.length; s++) {
        if (sections[s].genes > perSection) {
            return { ok: false, reason: 'too_many_genes', section: s, count: sections[s].genes, limit: perSection };
        }
    }
    const values = limit('matrix_values');
    const rows = sections.reduce((a, s) => a + s.rows, 0);
    if (rows * groups > values) return { ok: false, reason: 'matrix_too_large', count: rows * groups, limit: values };
    if (features * groups > values) return { ok: false, reason: 'too_many_values', count: features * groups, limit: values };
    return { ok: true };
}

/**
 * How often the request reads each gene: `reads` gene features over `genes` distinct genes, and why a gene is read more
 * than once: on different `layers`, or at different `thresholds` of one layer (null when each gene is read once).
 * @param {Array<{kind: string, name?: string, layer?: string, detect_above?: number}>} wires - the request's features
 * @returns {{genes: number, reads: number, cause: ('layers'|'thresholds'|null)}}
 */
export function geneReads(wires) {
    const layersOf = new Map();
    let reads = 0;
    for (const w of wires) {
        if (w.kind !== 'gene') continue;
        reads++;
        if (!layersOf.has(w.name)) layersOf.set(w.name, new Set());
        layersOf.get(w.name).add(w.layer);
    }
    const genes = layersOf.size;
    if (reads <= genes) return { genes, reads, cause: null };
    for (const set of layersOf.values()) if (set.size > 1) return { genes, reads, cause: 'layers' };
    return { genes, reads, cause: 'thresholds' };
}

// --- CSV (CXG-20) -----------------------------------------------------------------------------------------------

/**
 * A column's header: statistic (with its threshold when it uses one), layer and scaling, with the section first for a section's own aggregated quantity,
 * which is named by its `label` (an aggregation has no statistic of its own).
 * @param {{stat?: string, label?: string, layer?: string, detectAbove?: number, scaling: string, section?: string}} column
 */
// export-unused-ok: consumed by X4a (colour bar and legend titles name statistic, layer and scaling the same way)
export function columnHeader({ stat, label, layer, detectAbove, scaling, section }) {
    const parts = [];
    if (section) parts.push(section);
    // a thresholded statistic names its threshold, so two thresholds stay two columns apart (WP-4)
    const thresholded = !label && THRESHOLDED.includes(stat) && typeof detectAbove === 'number' && Number.isFinite(detectAbove);
    parts.push(thresholded ? `${W.statistic[stat]} (> ${detectAbove})` : label || W.statistic[stat]);
    if (layer) parts.push(layer);
    parts.push(W.scaled[scaling]);
    return parts.join(' · ');
}

const figure = (v) => (Number.isFinite(v) ? String(v) : '');

/**
 * The matrix in long form, as text fields: the header, then one row per matrix row and group, one column per
 * statistic, a missing value an empty field. A column whose `noExpressing` flags a cell adds a final note column saying
 * so (P3). The CSV and Show as table are these rows (one column specification). When a row is a one-row section
 * (decision 40), "Color: genes combined by" (and Size's) say its gene step, after the cells; a statistic column's
 * header is the cell step.
 * @param {{groups: {label: string, n: number}[], rows: {section: string, label: string, combined?: {color?: string, size?: string}}[],
 *   columns: {stat?: string, label?: string, layer?: string, detectAbove?: number, scaling: string, section?: string, values: Float64Array,
 *   noExpressing?: Uint8Array}[]}} table - `values[row * groups + group]`
 * @returns {string[][]}
 */
export function longRows({ groups, rows, columns }) {
    const noted = columns.some((c) => c.noExpressing);
    const channels = ['color', 'size'].filter((which) => rows.some((row) => row.combined && row.combined[which]));
    const head = [W.csv.section, W.csv.row, W.csv.group, W.csv.cells, ...channels.map((which) => W.csv.genesCombined[which]), ...columns.map(columnHeader)];
    if (noted) head.push(W.csv.note);
    const out = [head];
    for (let r = 0; r < rows.length; r++) {
        const combined = channels.map((which) => (rows[r].combined && rows[r].combined[which]) || '');
        for (let g = 0; g < groups.length; g++) {
            const i = r * groups.length + g;
            const fields = [rows[r].section, rows[r].label, groups[g].label, String(groups[g].n), ...combined, ...columns.map((c) => figure(c.values[i]))];
            if (noted) fields.push(columns.some((c) => c.noExpressing && c.noExpressing[i]) ? W.noExpressingCells : '');
            out.push(fields);
        }
    }
    return out;
}

/** The fields of a long row that are names (section, row, group), written as text in the CSV. */
const NAME_FIELDS = 3;

/**
 * longRows as CSV text: a name that looks like a formula is kept as written (csv-format.js csvField).
 * @param {Parameters<typeof longRows>[0]} table
 * @returns {string}
 */
export function longCsv(table) {
    const lines = longRows(table).map((fields, k) => fields.map((f, j) => csvField(f, { text: k > 0 && j < NAME_FIELDS })).join(','));
    return `${lines.join('\n')}\n`;
}
