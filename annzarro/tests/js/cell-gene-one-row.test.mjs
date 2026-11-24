/**
 * A one-row section of the Cell-Gene Plot (decision 40, one-row-ux-080.md option B).
 *
 *   - The channel (the plot's Color or Size) is the cell step: its statistic, its layer and its threshold. The row
 *     chooses only the gene step: combine the gene rows (mean, sum, mean of z-scores), or score each cell by a method of
 *     its source on the channel's layer. Nothing about a row stores a layer.
 *   - Contradictions are disabled entries with a reason in the shared phrasing ("X cannot be computed with Y: why"):
 *     anything under Cell count, the rows family with down genes, Sum under SD and mean of expressing cells. Sum under %
 *     expressing is offered as "Genes detected per cell", on its own scale.
 *   - A signature with down genes is never summarised as if its down genes were up: its row is its score.
 *   - The default is the mean of the gene rows: it shares their colour bar and size legend, and asks for no score.
 *   - Links from before decision 40: every legacy kind loads, with a notice exactly where the values change.
 *
 * Run:  node --test annzarro/tests/js/cell-gene-one-row.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    normalizeCellGene, addSection, setSectionRows, sectionGenes, planFeatures, buildMatrix, effectiveRowStep, setRowStep,
    regradeRows, rowStepEntries, rowStepAfter, rowStepHelp, rowQuantity
} from '../../../static/js/panels/cell-gene/sections.js';
import { statisticColumn, combineRows, longRows, MOMENT_STRIDE } from '../../../static/js/utils/cell-gene-model.js';

const golden = (name) => JSON.parse(readFileSync(new URL(`../data/golden/${name}.json`, import.meta.url), 'utf8'));
const RECIPE = { genes: ['UP1', 'UP2'], down: ['DN1'], method: 'zscore_mean', input: 'X' };
const scoreRecipe = (column, layer) => ({ ...RECIPE, method: column, input: layer });
const LOGGED = { color: { stat: 'mean', layer: 'logged' }, size: { stat: 'pct_expressing', layer: 'counts' } };
const base = (fields = {}) => normalizeCellGene({ ...LOGGED, ...fields }).config;
const oneRow = (fields = {}, section = {}) => {
    const cfg = setSectionRows(addSection(base(fields), 'sig'), 0, 'set');
    return { ...cfg, sections: [{ ...cfg.sections[0], ...section }] };
};
const GENES = ['G1', 'G2', 'G3'];

function planOf(cfg, counted = { genes: GENES, down: 0 }, threshold = 0) {
    return planFeatures({ sections: cfg.sections.map((section) => ({ section, genes: counted.genes, down: counted.down, title: 'Sig', scoreRecipe })),
        color: cfg.color, size: cfg.mode === 'heatmap' ? null : cfg.size, threshold });
}

/** Moments of each group from per-cell values, `[n, sum, sumsq, nAbove, sumAbove]`. */
function momentsOf(groups, t = 0) {
    const m = new Float64Array(groups.length * MOMENT_STRIDE);
    groups.forEach((values, g) => {
        for (const x of values) {
            const o = g * MOMENT_STRIDE;
            m[o] += 1; m[o + 1] += x; m[o + 2] += x * x;
            if (x > t) { m[o + 3] += 1; m[o + 4] += x; }
        }
    });
    return m;
}

// per gene, per group, per cell: two groups of three and two cells, no missing value
const CELLS = {
    G1: [[0, 2, 4], [1, 0]],
    G2: [[3, 3, 0], [0, 6]],
    G3: [[1, 0, 0], [2, 2]]
};
const GROUPS = [{ n: 3 }, { n: 2 }];

/** The matrix of `cfg` with genes read from CELLS and a score of each cell computed by `scoreOf` from its genes. */
function matrixOf(cfg, scoreOf = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length) {
    const p = planOf(cfg);
    const by = new Map(p.features.map((f) => {
        if (f.wire.kind === 'gene') return [f.key, momentsOf(CELLS[f.wire.name], f.wire.detect_above)];
        const perCell = GROUPS.map((_, g) => CELLS.G1[g].map((_, c) => scoreOf(GENES.map((gene) => CELLS[gene][g][c]))));
        return [f.key, momentsOf(perCell, f.wire.above)];
    }));
    return { plan: p, out: buildMatrix(p, (key) => by.get(key) || null, GROUPS, cfg) };
}
const rowOf = (values, r, G = 2) => Array.from(values.subarray(r * G, (r + 1) * G));
const close = (a, b, what) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-12, `${what}: ${a} vs ${b}`));

// ------------------------------------------------------------------ down genes (the latent bug)

test('sectionGenes counts the down genes it keeps', () => {
    const counted = sectionGenes(RECIPE, (g) => g !== 'UP2');
    assert.deepEqual(counted.genes, ['UP1', 'DN1']);
    assert.equal(counted.down, 1);
    assert.equal(sectionGenes({ genes: ['A'] }, () => true).down, 0);
});

test('a one-row section of a signature with down genes is its score, not a mean that counts down genes as up', () => {
    const cfg = oneRow({ size: { stat: 'pct_expressing', layer: 'logged' } });
    const p = planOf(cfg, sectionGenes(RECIPE, () => true));
    const row = p.rows.find((r) => r.kind === 'set');
    assert.ok(row.color.key, 'Color reads one score feature');
    assert.equal(row.color.keys, undefined, 'and no gene features averaged');
    const scores = p.features.filter((f) => f.wire.kind === 'score');
    assert.deepEqual(scores.map((f) => [f.wire.column, f.wire.layer]), [['zscore_mean', 'logged']], 'the source default method on the channel layer, one feature for both');
    const plain = planOf(cfg, sectionGenes({ genes: ['UP1', 'UP2'] }, () => true));
    assert.equal(plain.features.filter((f) => f.wire.kind === 'score').length, 0, 'without down genes, no score request');
});

test('(5) down genes: the rows family is disabled with its reason, and a new one-row section starts on z-score mean', () => {
    const cfg = oneRow();
    assert.deepEqual(effectiveRowStep(cfg.sections[0], 'color', cfg.color, 1), { genes: 'zscore_mean', moved: null });
    const stored = setRowStep(cfg, 0, 'color', { genes: 'rows_sum' });
    assert.deepEqual(effectiveRowStep(stored.sections[0], 'color', cfg.color, 1), { genes: 'zscore_mean', moved: 'down' });
    const [rows, score] = rowStepEntries({ stat: 'mean', down: 1 });
    assert.ok(rows.entries.every((e) => e.disabled), 'every Combine the gene rows entry is disabled');
    assert.equal(rows.entries[0].title, 'Mean of the gene rows cannot be computed with down genes: it would count them as up genes. Score each cell instead.');
    assert.ok(score.entries.some((e) => e.value === 'zscore_mean' && !e.disabled));
});

// ------------------------------------------------------------------ inherit and lock

test('(1) a legacy score row on counts under Color mean · logged reads logged, stores no layer, and says so once', () => {
    const { config, notices, problems } = normalizeCellGene({ ...LOGGED, sections: [{ source: 'sig', rows: 'set',
        color: { agg: 'score_mean', column: 'zscore_mean', layer: 'counts' } }] });
    assert.deepEqual(problems, []);
    assert.deepEqual(config.sections[0].color, { genes: 'zscore_mean' });
    assert.ok(!JSON.stringify(config.sections).includes('layer'), 'nothing about a row stores a layer');
    assert.equal(notices.length, 1);
    assert.deepEqual(notices[0].section, 0);
    assert.match(notices[0].was, /counts/);
    const scores = planOf(config).features.filter((f) => f.wire.kind === 'score');
    assert.deepEqual(scores.map((f) => f.wire.layer), ['logged']);
});

test('(2) the default row is the mean of its gene rows and shares their colour bar and size legend', () => {
    const { plan, out } = matrixOf(oneRow());
    assert.ok(!plan.features.some((f) => f.wire.kind === 'score'), 'no score request');
    const meanOf = (stat, layerT) => {
        const cols = GENES.map((g) => statisticColumn(stat, momentsOf(CELLS[g], layerT), 2));
        return [0, 1].map((k) => cols.reduce((a, c) => a + c[k], 0) / cols.length);
    };
    close(rowOf(out.color.raw, 0), meanOf('mean', 0), 'color');
    close(rowOf(out.size.values, 0), meanOf('pct_expressing', 0), 'size');
    assert.equal(out.rows[0].own.color.id, out.color.id, 'one colour bar with the gene rows');
    assert.equal(out.rows[0].own.size.id, out.size.id, 'one size legend with the gene rows');
});

test('(3) under Size SD the row is the mean of the genes\' SDs, not a mean expression', () => {
    const { out } = matrixOf(oneRow({ size: { stat: 'sd', layer: 'counts' } }));
    const sds = GENES.map((g) => statisticColumn('sd', momentsOf(CELLS[g]), 2));
    close(rowOf(out.size.values, 0), [0, 1].map((k) => sds.reduce((a, c) => a + c[k], 0) / 3), 'size');
});

test('(4) grading: Sum is Genes detected per cell under %, disabled under SD and mean of expressing cells; Cell count disables all', () => {
    const entries = (stat) => rowStepEntries({ stat });
    const sumOf = (stat) => entries(stat)[0].entries.find((e) => e.value === 'rows_sum');
    assert.deepEqual(sumOf('pct_expressing'), { value: 'rows_sum', label: 'Genes detected per cell' });
    assert.deepEqual(sumOf('mean'), { value: 'rows_sum', label: 'Sum of the gene rows' });
    assert.equal(sumOf('sd').title, 'Sum of the gene rows cannot be computed with SD: a sum of spreads is not the spread of the set.');
    assert.ok(sumOf('sd').disabled && sumOf('mean_expressing').disabled);
    assert.match(sumOf('mean_expressing').title, /^Sum of the gene rows cannot be computed with mean of expressing cells: /);
    const count = entries('count');
    assert.ok(count.every((g) => g.entries.every((e) => e.disabled && /cannot be computed with cell count: cell count does not depend on genes\.$/.test(e.title))));
    assert.deepEqual(entries('mean').map((g) => g.heading), ['Combine the gene rows', 'Score each cell']);
});

test('Genes detected per cell is the sum of the genes\' fractions, on its own scale', () => {
    const cfg = setRowStep(oneRow(), 0, 'size', { genes: 'rows_sum' });
    const { out } = matrixOf(cfg);
    const fractions = GENES.map((g) => statisticColumn('pct_expressing', momentsOf(CELLS[g]), 2));
    close(rowOf(out.size.values, 0), [0, 1].map((k) => fractions.reduce((a, c) => a + c[k] / 100, 0)), 'size');
    assert.notEqual(out.rows[0].own.size.id, out.size.id, 'not on the 0 to 100 legend');
    assert.match(out.rows[0].own.size.label, /^Genes detected per cell/);
});

test('(6) a score under Size % expressing takes the row\'s own threshold in score units, not the grouping\'s', () => {
    let cfg = setRowStep(oneRow(), 0, 'size', { genes: 'mean' });
    const above = (c) => planOf(c, { genes: GENES, down: 0 }, 2).features.find((f) => f.wire.kind === 'score').wire.above;
    assert.equal(above(cfg), 0, 'empty is 0, whatever the grouping says');
    cfg = setRowStep(cfg, 0, 'size', rowStepAfter(effectiveRowStep(cfg.sections[0], 'size', cfg.size), 'above', 0.5));
    assert.deepEqual(cfg.sections[0].size, { genes: 'mean', above: 0.5 });
    assert.equal(above(cfg), 0.5);
    const { out } = matrixOf(cfg);
    const perCell = GROUPS.map((_, g) => CELLS.G1[g].map((_, c) => GENES.reduce((a, gene) => a + CELLS[gene][g][c], 0) / 3));
    close(rowOf(out.size.values, 0), Array.from(statisticColumn('pct_expressing', momentsOf(perCell, 0.5), 2)), 'size');
});

test('a Cell count channel draws the groups\' sizes for a one-row section, and asks for nothing', () => {
    const cfg = oneRow({ color: { stat: 'count' } });
    const { plan, out } = matrixOf(cfg);
    assert.equal(plan.rows[0].color.keys, undefined);
    assert.deepEqual(rowOf(out.color.raw, 0), [3, 2]);
});

test('(7) the mean score of each cell, then the mean over cells, equals the mean of the gene rows (no missing value)', () => {
    const rows = matrixOf(oneRow()).out;
    const scored = matrixOf(setRowStep(oneRow(), 0, 'color', { genes: 'mean' })).out;
    close(rowOf(scored.color.raw, 0), rowOf(rows.color.raw, 0), 'genes mean then cells mean');
    assert.notEqual(scored.rows[0].own.color.id, scored.color.id, 'a score has its own colour bar');
    assert.equal(scored.rows[0].own.color.label, 'genes: mean; cells: Mean · logged');
});

test('mean of the gene rows as z-scores: each gene row z-scored across groups, then averaged', () => {
    const z = combineRows('rows_z', 'mean', GENES.map((g) => momentsOf(CELLS[g])), 2);
    // two groups: each gene row is +1 and -1; G1 (means 2, 0.5) is +1, -1; G2 (2, 3) and G3 (1/3, 2) are -1, +1
    close(Array.from(z), [-1 / 3, 1 / 3], 'rows_z');
});

test('the CSV says each one-row section\'s gene step per channel, beside the cell step in the column header', () => {
    const cfg = setRowStep(oneRow(), 0, 'color', { genes: 'zscore_mean' });
    const { out } = matrixOf(cfg);
    assert.equal(out.rows[0].own.color.how, 'z-score mean score');
    assert.equal(out.rows[0].own.size.how, 'Mean of the gene rows');
    const rows = longRows({ groups: [{ label: 'A', n: 3 }], rows: [{ section: 'Sig', label: 'G1' }, { section: 'Sig', label: 'Sig', combined: { color: 'z-score mean', size: 'Mean of the gene rows' } }],
        columns: [{ stat: 'mean', layer: 'logged', scaling: 'none', values: Float64Array.of(1, 2) }] });
    assert.deepEqual(rows[0].slice(0, 6), ['Section', 'Row', 'Group', 'Cells', 'Color: genes combined by', 'Size: genes combined by']);
    assert.deepEqual(rows[1].slice(4, 6), ['', '']);
    assert.deepEqual(rows[2].slice(4, 6), ['z-score mean', 'Mean of the gene rows']);
    const plain = longRows({ groups: [{ label: 'A', n: 3 }], rows: [{ section: 'Sig', label: 'G1' }], columns: [] });
    assert.equal(plain[0].length, 4, 'no one-row section: no such column');
});

// ------------------------------------------------------------------ the channel moves

test('(10) re-grading: Sum of the gene rows goes back to the mean when Size becomes SD, said once', () => {
    const cfg = setRowStep(oneRow(), 0, 'size', { genes: 'rows_sum' });
    const { config, moved } = regradeRows({ ...cfg, size: { stat: 'sd', layer: 'counts' } }, 'size');
    assert.equal('size' in config.sections[0], false);
    assert.deepEqual(moved, [{ section: 0, from: 'rows_sum', reason: 'sum_sd' }]);
    const same = regradeRows({ ...cfg, size: { stat: 'mean', layer: 'counts' } }, 'size');
    assert.equal(same.config.sections[0].size.genes, 'rows_sum');
    assert.deepEqual(same.moved, []);
});

test('the help line says what one value is, and the inherited statistic', () => {
    assert.equal(rowStepHelp({ genes: 'rows_mean' }, { stat: 'mean', layer: 'logged' }, 'Pathway', 8),
        "Each gene's Mean · logged in the group, averaged over the 8 genes of Pathway. Same scale as the gene rows.");
    assert.equal(rowStepHelp({ genes: 'zscore_mean', above: 0.5 }, { stat: 'pct_expressing', layer: 'counts' }, 'Pathway', 8),
        "Each cell's z-score mean score of Pathway on counts, then the group's % of cells above 0.5. Its settings: Pathway ▸ Methods ▾.");
    assert.equal(rowQuantity({ genes: 'zscore_mean', above: 0.5 }, { stat: 'pct_expressing', layer: 'counts' }).label,
        'genes: z-score mean; cells: % of cells above 0.5 · counts');
});

// ------------------------------------------------------------------ links from before decision 40

test('(8) every legacy kind reads into a gene step, with a notice exactly where the values change', () => {
    const read = (agg, channel, which = 'color') => {
        const fields = { ...LOGGED, [which]: channel, sections: [{ source: 'sig', rows: 'set', [which]: agg }] };
        const { config, notices, problems } = normalizeCellGene(fields);
        assert.deepEqual(problems, [], JSON.stringify(agg));
        return { step: config.sections[0][which] || null, notice: notices.length === 1, none: notices.length === 0 };
    };
    const mean = { stat: 'mean', layer: 'logged' };
    const sd = { stat: 'sd', layer: 'logged' };
    const pct = { stat: 'pct_expressing', layer: 'logged' };
    assert.deepEqual(read({ agg: 'mean_of_means' }, mean), { step: null, notice: false, none: true });
    assert.deepEqual(read({ agg: 'mean_of_means' }, sd), { step: null, notice: true, none: false });
    assert.deepEqual(read({ agg: 'sum_of_means' }, mean), { step: { genes: 'rows_sum' }, notice: false, none: true });
    assert.deepEqual(read({ agg: 'sum_of_means' }, sd), { step: null, notice: true, none: false }, 'Sum under SD is the default');
    assert.deepEqual(read({ agg: 'mean_of_pct_expressing' }, pct, 'size'), { step: null, notice: false, none: true });
    assert.deepEqual(read({ agg: 'mean_of_pct_expressing' }, mean, 'size'), { step: null, notice: true, none: false });
    assert.deepEqual(read({ agg: 'mean_of_zscores' }, mean), { step: { genes: 'rows_z' }, notice: true, none: false });
    assert.deepEqual(read({ agg: 'score_mean', column: 'mean', layer: 'logged' }, mean), { step: { genes: 'mean' }, notice: false, none: true });
    assert.deepEqual(read({ agg: 'score_mean', column: 'mean', layer: 'X' }, mean), { step: { genes: 'mean' }, notice: true, none: false });
    assert.deepEqual(read({ agg: 'score_pct_above', column: 'sum', layer: 'logged', above: 2 }, pct, 'size'),
        { step: { genes: 'sum', above: 2 }, notice: false, none: true });
    assert.deepEqual(read({ agg: 'score_pct_above', column: 'sum', layer: 'logged' }, mean), { step: { genes: 'sum' }, notice: true, none: false });
    assert.deepEqual(read({ agg: 'mean_of_means' }, { stat: 'count' }), { step: null, notice: true, none: false });
    // a section shown as genes keeps its steps for later, with no notice: nothing it draws changed
    const genes = normalizeCellGene({ ...LOGGED, color: sd, sections: [{ source: 'sig', rows: 'genes', color: { agg: 'mean_of_means' } }] });
    assert.deepEqual(genes.notices, []);
});

test('the golden link with one-row sections reads into gene steps, with no notice (its values are unchanged)', () => {
    const { config, problems, notices } = normalizeCellGene(golden('cell_gene_6'));
    assert.deepEqual(problems, []);
    assert.deepEqual(notices, []);
    const sets = config.sections.filter((s) => s.rows === 'set');
    assert.equal(sets.length, 3);
    for (const s of sets) {
        assert.equal('color' in s, false, 'mean of the means under Color mean is the default');
        assert.deepEqual(s.size, { genes: 'zscore_mean', above: 1 });
    }
});

test('a new-shape link round-trips unchanged', () => {
    const raw = { ...base(), sections: [{ source: 'sig', rows: 'set', color: { genes: 'zscore_mean' }, size: { genes: 'mean', above: 0.5 } }] };
    const { config, problems, notices } = normalizeCellGene(JSON.parse(JSON.stringify(raw)));
    assert.deepEqual(config, raw);
    assert.deepEqual(problems, []);
    assert.deepEqual(notices, []);
    const bad = normalizeCellGene({ ...raw, sections: [{ source: 'sig', rows: 'set', color: { genes: 'median' }, size: { genes: 'rows_mean', above: 3 } }] });
    assert.equal('color' in bad.config.sections[0], false);
    assert.deepEqual(bad.config.sections[0].size, { genes: 'rows_mean' }, 'a combining step has no threshold');
    assert.equal(bad.problems.length, 1);
});
