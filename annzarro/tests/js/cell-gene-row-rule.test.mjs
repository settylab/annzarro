/**
 * A one-row section of the Cell-Gene Plot is the set treated as one gene (aggregation-unify-080.md 11.1): it has no
 * setting, and each channel shows it by the fixed rule of its statistic (cell-gene-model.js ROW_RULE), on the channel's
 * layer and threshold. One case per row of the rule table; the per-row steps of earlier builds are not read.
 *
 * Run:  node --test annzarro/tests/js/cell-gene-row-rule.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    normalizeCellGene, addSection, setSectionRows, sectionGenes, planFeatures, buildMatrix, rowQuantity, rowReading
} from '../../../static/js/panels/cell-gene/sections.js';
import { ROW_RULE, statisticColumn, longRows, MOMENT_STRIDE } from '../../../static/js/utils/cell-gene-model.js';
import { STATISTIC_IDS } from '../../../static/js/utils/cell-grouping.js';

const golden = (name) => JSON.parse(readFileSync(new URL(`../data/golden/${name}.json`, import.meta.url), 'utf8'));
const RECIPE = { genes: ['G1', 'G2', 'G3'], down: [], method: 'zscore_mean', input: 'X' };
const scoreRecipe = (column, layer, extra = null) => (extra && extra.anyGene
    ? { genes: [...RECIPE.genes], down: [], method: column, input: layer, detect_above: extra.detect_above }
    : { ...RECIPE, method: column, input: layer });
const LOGGED = { color: { stat: 'mean', layer: 'logged' }, size: { stat: 'fraction_of_cells', layer: 'counts' } };
const base = (fields = {}) => normalizeCellGene({ ...LOGGED, ...fields }).config;
const oneRow = (fields = {}) => setSectionRows(addSection(base(fields), 'sig'), 0, 'set');
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
const cellsOf = (gene, g, c) => CELLS[gene][g][c];

/** What the score route computes of a cell, by method: the mean of its genes, or `detected` (the share of the genes above t). */
function scoreOf(wire, g, c) {
    const genes = wire.recipe.genes;
    if (wire.column === 'fraction_of_genes') return genes.filter((gene) => cellsOf(gene, g, c) > wire.recipe.detect_above).length / genes.length;
    return genes.reduce((a, gene) => a + cellsOf(gene, g, c), 0) / genes.length;
}

/** The matrix of `cfg` with genes read from CELLS and the score features computed by `scoreOf`. */
function matrixOf(cfg) {
    const p = planOf(cfg);
    const by = new Map(p.features.map((f) => {
        if (f.wire.kind === 'gene') return [f.key, momentsOf(CELLS[f.wire.name], f.wire.detect_above)];
        const perCell = GROUPS.map((_, g) => CELLS.G1[g].map((_, c) => scoreOf(f.wire, g, c)));
        return [f.key, momentsOf(perCell, f.wire.above)];
    }));
    return { plan: p, out: buildMatrix(p, (key) => by.get(key) || null, GROUPS, cfg, { titleOf: () => 'Sig' }) };
}
const rowOf = (values, r, G = 2) => Array.from(values.subarray(r * G, (r + 1) * G));
const close = (a, b, what) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-12, `${what}: ${a} vs ${b}`));


/** A section of the three genes, with `down` of them down genes, planned and drawn from CELLS. */
const meanOver = (stat, genes, t = 0) => {
    const cols = genes.map((g) => statisticColumn(stat, momentsOf(CELLS[g], t), 2));
    return [0, 1].map((k) => cols.reduce((a, c) => a + c[k], 0) / cols.length);
};

test('the rule table has one row per statistic', () => {
    assert.deepEqual(Object.keys(ROW_RULE).sort(), [...STATISTIC_IDS].sort());
    for (const stat of STATISTIC_IDS) assert.ok(ROW_RULE[stat], stat);
});

test('x\u0304 Mean: the mean over the genes of each gene\'s mean, no request beyond the gene rows, on the gene rows\' bar', () => {
    const { plan, out } = matrixOf(oneRow({ size: { stat: 'sd', layer: 'logged' } }));
    assert.ok(!plan.features.some((f) => f.wire.kind === 'score'));
    close(rowOf(out.color.raw, 0), meanOver('mean', GENES), 'color');
    assert.equal(out.rows[0].own.color.id, out.color.id);
});

test('x\u0304 Mean with down genes: the signature\'s mean score stands in, one score feature and no gene features', () => {
    const cfg = oneRow();
    const p = planOf(cfg, { genes: ['UP1', 'UP2', 'DN1'], down: 1 });
    const row = p.rows.find((r) => r.kind === 'set');
    assert.ok(row.color.key && row.color.keys === undefined);
    assert.deepEqual(p.features.filter((f) => f.wire.kind === 'score').map((f) => f.wire.column).sort(), ['fraction_of_genes', 'mean']);
    assert.equal(p.features.filter((f) => f.wire.kind === 'gene').length, 0);
    assert.equal(rowQuantity(row.color.step, cfg.color).id, 'mean|logged|', 'on the gene rows\' bar');
});

test('z\u0304 Z-score mean: the group mean of the set\'s z-score mean score, one feature, the gene rows\' bar', () => {
    const cfg = oneRow({ color: { stat: 'zscore_mean', layer: 'logged' } });
    const p = planOf(cfg);
    assert.deepEqual(p.features.filter((f) => f.wire.kind === 'score').map((f) => f.wire.column).sort(), ['fraction_of_genes', 'zscore_mean']);
    const row = p.rows[0];
    assert.equal(rowQuantity(row.color.step, cfg.color).id, 'zscore_mean|logged|');
});

test('Fraction of cells: the share of cells expressing at least one gene (`detected`, above 0, the channel\'s threshold)', () => {
    const cfg = oneRow();
    const p = planOf(cfg, { genes: GENES, down: 0 }, 1);
    const detected = p.features.find((f) => f.wire.column === 'fraction_of_genes').wire;
    assert.equal(detected.recipe.detect_above, 1);
    assert.equal(detected.above, 0);
    assert.equal(detected.layer, 'counts');
    assert.deepEqual(detected.recipe.genes, GENES);
    const own = oneRow({ size: { stat: 'fraction_of_cells', layer: 'counts', detect_above: 2 } });
    assert.equal(planOf(own, { genes: GENES, down: 0 }, 1).features.find((f) => f.wire.column === 'fraction_of_genes').wire.recipe.detect_above, 2);
    const { out } = matrixOf(cfg);
    const any = [0, 1].map((g) => (CELLS.G1[g].filter((_, c) => GENES.some((gene) => cellsOf(gene, g, c) > 0)).length) / GROUPS[g].n);
    close(rowOf(out.size.values, 0), any, 'n_above / n');
    assert.equal(out.rows[0].own.size.id, out.size.id);
    assert.match(out.rows[0].own.size.label, /^Fraction of cells expressing at least one of Sig's 3 genes \(> 0\) \u00b7 counts$/);
    assert.equal(out.rows[0].own.size.how, 'any gene');
});

test('a one-gene set\'s "any gene" is that gene\'s Fraction of cells', () => {
    const recipe = { genes: ['G2'], down: [], method: 'zscore_mean', input: 'X' };
    const cfg = oneRow();
    const sections = [{ section: cfg.sections[0], genes: ['G2'], down: 0, title: 'Sig',
        scoreRecipe: (column, layer, extra) => ({ ...recipe, method: column, input: layer, ...(extra && extra.anyGene ? { detect_above: extra.detect_above } : {}) }) }];
    const p = planFeatures({ sections, color: cfg.color, size: cfg.size, threshold: 0 });
    const by = new Map(p.features.map((f) => [f.key, f.wire.kind === 'gene' ? momentsOf(CELLS[f.wire.name], f.wire.detect_above)
        : momentsOf(GROUPS.map((_, g) => CELLS.G2[g].map((x) => (x > f.wire.recipe.detect_above ? 1 : 0))), f.wire.above)]));
    const out = buildMatrix(p, (key) => by.get(key) || null, GROUPS, cfg);
    close(rowOf(out.size.values, 0), Array.from(statisticColumn('fraction_of_cells', momentsOf(CELLS.G2, 0), 2)), 'the gene row\'s own value');
});

test('x\u0304\u207a Mean of expressing cells: the mean over the genes of each gene\'s, the gene rows\' scale', () => {
    const { plan, out } = matrixOf(oneRow({ size: { stat: 'mean_expressing', layer: 'counts' } }));
    assert.ok(!plan.features.some((f) => f.wire.kind === 'score'));
    close(rowOf(out.size.values, 0), meanOver('mean_expressing', GENES), 'size');
    assert.equal(out.rows[0].own.size.id, out.size.id);
});

test('\u03a3 Sum: the sum over the genes of each gene\'s sum, on a scale of its own', () => {
    const { out } = matrixOf(oneRow({ size: { stat: 'sum', layer: 'counts' } }));
    const cols = GENES.map((g) => statisticColumn('sum', momentsOf(CELLS[g]), 2));
    close(rowOf(out.size.values, 0), [0, 1].map((k) => cols.reduce((a, c) => a + c[k], 0)), 'size');
    assert.notEqual(out.rows[0].own.size.id, out.size.id);
    assert.equal(out.rows[0].own.size.how, 'Sum of the gene rows');
});

test('\u03c3 SD: the mean over the genes of each gene\'s SD, the gene rows\' scale', () => {
    const { out } = matrixOf(oneRow({ size: { stat: 'sd', layer: 'counts' } }));
    close(rowOf(out.size.values, 0), meanOver('sd', GENES), 'size');
    assert.equal(out.rows[0].own.size.id, out.size.id);
});

test('n Cell count: the group\'s size, no genes asked for', () => {
    const { plan, out } = matrixOf(oneRow({ color: { stat: 'count' } }));
    assert.equal(plan.rows[0].color.keys, undefined);
    assert.equal(plan.rows[0].color.key, undefined);
    assert.deepEqual(rowOf(out.color.raw, 0), [3, 2]);
});

test('down genes: x\u0304\u207a, \u03a3, \u03c3 and % use the up genes only', () => {
    for (const stat of ['mean_expressing', 'sum', 'sd']) {
        const cfg = oneRow({ color: { stat, layer: 'logged' }, size: { stat: 'sd', layer: 'logged' } });
        const p = planOf(cfg, { genes: ['UP1', 'UP2', 'DN1'], down: 1 });
        const names = new Set(p.features.filter((f) => f.wire.kind === 'gene').map((f) => f.wire.name));
        assert.deepEqual([...names].sort(), ['UP1', 'UP2'], stat);
    }
    const pct = planOf(oneRow(), { genes: ['UP1', 'UP2', 'DN1'], down: 1 });
    const any = pct.features.find((f) => f.wire.column === 'fraction_of_genes').wire;
    assert.deepEqual(any.recipe.genes, GENES, 'the fixture recipe names its genes; the panel gives the up genes only');
});

test('the tooltip states the rule of each channel', () => {
    const cfg = oneRow();
    assert.equal(rowReading({ color: cfg.color, size: cfg.size }), "Color: the mean of the genes' means. Size: the fraction of cells expressing at least one gene.");
    assert.equal(rowReading({ color: { stat: 'zscore_mean' }, size: { stat: 'sum' } }), "Color: the z-score mean score of the set. Size: the sum of the genes' sums.");
    assert.match(rowReading({ color: cfg.color, size: null }, 2), /signature's mean score \(up minus down\)/);
});

test('the settings of an earlier build (per-channel steps, a section step) are not read: no throw, no problem, no notice, absent after a write', () => {
    const olds = [
        { source: 'sig', rows: 'set', color: { genes: 'rows_sum' }, size: { genes: 'mean', above: 0.5 } },
        { source: 'sig', rows: 'set', genes: 'zscore_mean' },
        { source: 'sig', rows: 'set', color: { agg: 'mean_of_zscores' }, size: 12 },
        { source: 'sig', rows: 'set', genes: { not: 'a step' } }
    ];
    for (const section of olds) {
        const { config, problems, notices } = normalizeCellGene({ ...LOGGED, sections: [section] });
        assert.deepEqual(problems, [], JSON.stringify(section));
        assert.deepEqual(notices, []);
        assert.deepEqual(config.sections[0], { source: 'sig', rows: 'set' });
    }
    assert.doesNotThrow(() => normalizeCellGene({ sections: [null, 7] }));
});

test('the golden link with one-row sections loads with no setting on them', () => {
    const { config, problems, notices } = normalizeCellGene(golden('cell_gene_6'));
    assert.deepEqual(problems, []);
    assert.deepEqual(notices, []);
    for (const s of config.sections.filter((x) => x.rows === 'set')) assert.deepEqual(Object.keys(s).sort(), ['rows', 'source']);
});

test('the CSV says how each channel combined the genes', () => {
    const { out } = matrixOf(oneRow());
    assert.equal(out.rows[0].own.color.how, 'Mean of the gene rows');
    assert.equal(out.rows[0].own.size.how, 'any gene');
    const rows = longRows({ groups: [{ label: 'A', n: 3 }], rows: [{ section: 'Sig', label: 'G1' }, { section: 'Sig', label: 'Sig', combined: { color: 'Mean of the gene rows', size: 'any gene' } }],
        columns: [{ stat: 'mean', layer: 'logged', scaling: 'none', values: Float64Array.of(1, 2) }] });
    assert.deepEqual(rows[0].slice(0, 6), ['Section', 'Row', 'Group', 'Cells', 'Color: genes combined by', 'Size: genes combined by']);
    assert.deepEqual(rows[2].slice(4, 6), ['Mean of the gene rows', 'any gene']);
});

test('sectionGenes counts the down genes it keeps', () => {
    const counted = sectionGenes({ genes: ['UP1', 'UP2'], down: ['DN1'] }, (g) => g !== 'UP2');
    assert.deepEqual(counted.genes, ['UP1', 'DN1']);
    assert.equal(counted.down, 1);
});
