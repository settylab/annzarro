/**
 * A one-row section of the Cell-Gene Plot holds ONE choice (aggregation-unify-080.md 10, decision 46): how its genes are
 * combined (the mean of the gene rows, their sum, their mean z-scored across groups) or a score method of its source.
 * Color and Size read it, each with its own statistic and layer:
 *
 *   - a value statistic (mean, sum, SD, z-score mean) of a score row is taken over the per-cell score;
 *   - % expressing of a score row is the share of cells expressing ANY gene of the set (10.1a): the source's `detected`
 *     score on the channel's threshold, of its up genes, `above: 0`, on the gene rows' own size legend;
 *   - the default is the mean of the gene rows (stored as nothing); a source with down genes starts on its score;
 *   - under z-score mean Color the section is the default and nothing else;
 *   - the per-channel steps of an earlier build are not read: no notice, no problem, the default.
 *
 * Run:  node --test annzarro/tests/js/cell-gene-one-step.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    normalizeCellGene, addSection, setSectionRows, sectionGenes, planFeatures, buildMatrix, effectiveRowStep, stepFor, setRowStep,
    regradeRows, rowStepEntries, rowQuantity
} from '../../../static/js/panels/cell-gene/sections.js';
import { rowStepGrade as modelGrade, statisticColumn, combineRows, longRows, MOMENT_STRIDE } from '../../../static/js/utils/cell-gene-model.js';
import { ROW_SYMBOLS, SCORE_SYMBOLS, STAT_SYMBOLS, MEASURE_SYMBOLS } from '../../../static/js/utils/aggregation-symbols.js';

const golden = (name) => JSON.parse(readFileSync(new URL(`../data/golden/${name}.json`, import.meta.url), 'utf8'));
const RECIPE = { genes: ['G1', 'G2', 'G3'], down: [], method: 'zscore_mean', input: 'X' };
const scoreRecipe = (column, layer, extra = null) => (extra && extra.anyGene
    ? { genes: [...RECIPE.genes], down: [], method: column, input: layer, detect_above: extra.detect_above }
    : { ...RECIPE, method: column, input: layer });
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
const cellsOf = (gene, g, c) => CELLS[gene][g][c];

/** What the score route computes of a cell, by method: the mean of its genes, or `detected` (the share of the genes above t). */
function scoreOf(wire, g, c) {
    const genes = wire.recipe.genes;
    if (wire.column === 'detected') return genes.filter((gene) => cellsOf(gene, g, c) > wire.recipe.detect_above).length / genes.length;
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
const channels = (cfg) => ({ color: cfg.color, size: cfg.size });

// ------------------------------------------------------------------ (1) a score row under a % channel: any gene

test('(1) a score step: Color reads the score, Size the share of cells expressing any gene, on the gene rows\' legend', () => {
    const cfg = oneRow({}, { genes: 'zscore_mean' });
    const p = planOf(cfg, { genes: GENES, down: 0 }, 1);
    const row = p.rows.find((r) => r.kind === 'set');
    assert.ok(row.color.key && !row.color.any, 'Color plans the score feature');
    assert.ok(row.size.key && row.size.any, 'Size plans the share of cells expressing any gene');
    const scores = p.features.filter((f) => f.wire.kind === 'score');
    assert.deepEqual(scores.map((f) => f.wire.column).sort(), ['detected', 'zscore_mean']);
    const detected = scores.find((f) => f.wire.column === 'detected').wire;
    assert.equal(detected.recipe.detect_above, 1, 'the channel threshold in force: the grouping\'s when the measure has none');
    assert.equal(detected.above, 0);
    assert.deepEqual(detected.recipe.down, []);
    assert.deepEqual(detected.recipe.genes, GENES);
    assert.equal(detected.layer, 'counts', 'Size\'s own layer');
    const own = oneRow({ size: { stat: 'pct_expressing', layer: 'counts', detect_above: 2 } }, { genes: 'zscore_mean' });
    assert.equal(planOf(own, { genes: GENES, down: 0 }, 1).features.find((f) => f.wire.column === 'detected').wire.recipe.detect_above, 2, 'the measure\'s own threshold wins');
    const { out } = matrixOf(cfg);
    const any = [0, 1].map((g) => (100 * CELLS.G1[g].filter((_, c) => GENES.some((gene) => cellsOf(gene, g, c) > 0)).length) / GROUPS[g].n);
    close(rowOf(out.size.values, 0), any, '100 * n_above / n');
    assert.equal(out.rows[0].own.size.id, out.size.id, 'the gene rows\' size legend');
    assert.match(out.rows[0].own.size.label, /^% of cells expressing at least one of Sig's 3 genes \(> 0\) · counts$/);
    assert.equal(out.rows[0].own.size.how, 'any gene');
});

test('(2) a one-gene set\'s "any gene" is that gene\'s % expressing', () => {
    const recipe = { genes: ['G2'], down: [], method: 'zscore_mean', input: 'X' };
    const cfg = oneRow({}, { genes: 'zscore_mean' });
    const sections = [{ section: cfg.sections[0], genes: ['G2'], down: 0, title: 'Sig',
        scoreRecipe: (column, layer, extra) => ({ ...recipe, method: column, input: layer, ...(extra && extra.anyGene ? { detect_above: extra.detect_above } : {}) }) }];
    const p = planFeatures({ sections, color: cfg.color, size: cfg.size, threshold: 0 });
    const by = new Map(p.features.map((f) => [f.key, f.wire.kind === 'gene' ? momentsOf(CELLS[f.wire.name], f.wire.detect_above)
        : momentsOf(GROUPS.map((_, g) => CELLS.G2[g].map((x) => (x > f.wire.recipe.detect_above ? 1 : 0))), f.wire.above)]));
    const out = buildMatrix(p, (key) => by.get(key) || null, GROUPS, cfg);
    close(rowOf(out.size.values, 0), Array.from(statisticColumn('pct_expressing', momentsOf(CELLS.G2, 0), 2)), 'the gene row\'s own value');
});

test('(3) the default row under % is the mean of its genes\' % expressing, and asks for no score', () => {
    const { plan, out } = matrixOf(oneRow());
    assert.ok(!plan.features.some((f) => f.wire.kind === 'score'), 'no score request');
    const fractions = GENES.map((g) => statisticColumn('pct_expressing', momentsOf(CELLS[g], 0), 2));
    close(rowOf(out.size.values, 0), [0, 1].map((k) => fractions.reduce((a, c) => a + c[k], 0) / 3), 'size');
    assert.equal(out.rows[0].own.size.id, out.size.id);
    assert.equal(out.rows[0].symbol, '', 'a following row carries no symbol');
});

// ------------------------------------------------------------------ (4) grading names the channel

test('(4) score entries are greyed under mean of expressing cells and rows_sum under SD, each reason naming the channel', () => {
    const list = (color, size, methods) => rowStepEntries({ channels: { color, size }, methods });
    const find = (entries, value) => entries.find((e) => e.value === value);
    const mean = { stat: 'mean' };
    const under = list(mean, { stat: 'mean_expressing' }, [{ value: 'mean' }, { value: 'zscore_mean' }]);
    assert.ok(find(under, 'mean').disabled && find(under, 'zscore_mean').disabled);
    assert.match(find(under, 'mean').title, /^mean cannot be computed with mean of expressing cells \(Size\): /);
    assert.ok(find(under, 'rows_sum').disabled, 'and the sum of such means');
    const sd = list(mean, { stat: 'sd' }, [{ value: 'mean' }]);
    assert.equal(find(sd, 'rows_sum').title, 'Sum of the gene rows cannot be computed with SD (Size): a sum of spreads is not the spread of the set.');
    assert.ok(!find(sd, 'mean').disabled, 'a score under SD is the SD of the per-cell score');
    const pct = list(mean, { stat: 'pct_expressing' }, [{ value: 'mean' }]);
    assert.ok(!find(pct, 'mean').disabled, 'a score under % is the share of cells expressing any gene');
    const count = list({ stat: 'count' }, { stat: 'count' }, [{ value: 'mean' }]);
    assert.ok(count.every((e) => !e.disabled), 'Cell count does not grade: it ignores genes');
    assert.deepEqual([...new Set(pct.map((e) => e.heading))], ['Combine the gene rows', 'Score each cell']);
    assert.deepEqual(pct.slice(0, 3).map((e) => [e.value, e.symbol]), [['rows_mean', ROW_SYMBOLS.rows_mean], ['rows_sum', ROW_SYMBOLS.rows_sum], ['rows_z', ROW_SYMBOLS.rows_z]]);
    assert.equal(find(pct, 'mean').symbol, SCORE_SYMBOLS.mean);
});

test('grading, per channel: Cell count never grades; down genes; sums with no honest name; a score has no mean over expressing cells', () => {
    assert.deepEqual(modelGrade('rows_sum', 'count'), { ok: true });
    assert.deepEqual(modelGrade('rows_mean', 'mean', { down: 1 }), { ok: false, reason: 'down' });
    assert.deepEqual(modelGrade('mean', 'mean', { down: 1 }), { ok: true });
    assert.deepEqual(modelGrade('rows_sum', 'sd'), { ok: false, reason: 'sum_sd' });
    assert.deepEqual(modelGrade('rows_sum', 'mean_expressing'), { ok: false, reason: 'sum_mean_expressing' });
    assert.deepEqual(modelGrade('sum', 'mean_expressing'), { ok: false, reason: 'score_mean_expressing' });
    assert.deepEqual(modelGrade('rows_sum', 'pct_expressing'), { ok: true });
});

// ------------------------------------------------------------------ (5) z-score mean Color

test('(5) under z-score mean Color only the default stands: every other entry is greyed, a held step returns to it', () => {
    const cfg = oneRow({ color: { stat: 'zscore_mean', layer: 'logged' } }, { genes: 'rows_sum' });
    const entries = rowStepEntries({ channels: channels(cfg), methods: [{ value: 'zscore_mean' }, { value: 'mean' }] });
    assert.deepEqual(entries.filter((e) => !e.disabled).map((e) => e.value), ['rows_mean']);
    assert.equal(entries.find((e) => e.value === 'mean').title, "Color is z-score mean: a set's row is its z-score mean score.");
    const eff = effectiveRowStep(cfg.sections[0], channels(cfg), 0);
    assert.deepEqual(eff, { genes: 'rows_mean', moved: { reason: 'zscore', which: 'color' } });
    assert.equal(stepFor(eff.genes, cfg.color), 'zscore_mean', 'Color reads the z-score mean score');
    assert.equal(stepFor(eff.genes, cfg.size), 'rows_mean', 'Size reads the mean of the gene rows');
    // moving Color to z-score mean returns a held step to the default, in the same edit, said by the caller
    const held = setRowStep(oneRow(), 0, 'rows_sum');
    const { config, moved } = regradeRows({ ...held, color: { stat: 'zscore_mean', layer: 'logged' } });
    assert.equal('genes' in config.sections[0], false);
    assert.deepEqual(moved, [{ section: 0, from: 'rows_sum', reason: 'zscore', which: 'color' }]);
    const p = planOf({ ...held, color: { stat: 'zscore_mean', layer: 'logged' } });
    assert.deepEqual(p.features.filter((f) => f.wire.kind === 'score').map((f) => f.wire.column), ['zscore_mean'], 'Color: one score feature, no mean of the gene rows beside it');
});

// ------------------------------------------------------------------ (6) down genes

test('(6) down genes: the rows family is greyed with its reason, and a new one-row section starts on the z-score mean score', () => {
    const cfg = oneRow();
    assert.deepEqual(effectiveRowStep(cfg.sections[0], channels(cfg), 1), { genes: 'zscore_mean', moved: null });
    const stored = setRowStep(cfg, 0, 'rows_sum');
    assert.deepEqual(effectiveRowStep(stored.sections[0], channels(cfg), 1), { genes: 'zscore_mean', moved: { reason: 'down', which: 'color' } });
    const entries = rowStepEntries({ channels: channels(cfg), down: 1 });
    assert.ok(entries.filter((e) => e.heading === 'Combine the gene rows').every((e) => e.disabled));
    assert.equal(entries[0].title, 'Mean of the gene rows cannot be computed with down genes (Color): it would count them as up genes. Score each cell instead.');
    assert.ok(entries.some((e) => e.value === 'zscore_mean' && !e.disabled));
    const p = planOf(cfg, sectionGenes({ genes: ['UP1', 'UP2'], down: ['DN1'] }, () => true));
    const row = p.rows.find((r) => r.kind === 'set');
    assert.ok(row.color.key && row.color.keys === undefined, 'Color reads one score feature and no gene features averaged');
    assert.ok(row.size.any, 'and % is the share of cells expressing any up gene');
    assert.equal(row.up, 2);
    assert.equal(row.down, 1);
    const plain = planOf(cfg, sectionGenes({ genes: ['UP1', 'UP2'] }, () => true));
    assert.equal(plain.features.filter((f) => f.wire.kind === 'score').length, 0, 'without down genes, no score request');
});

test('sectionGenes counts the down genes it keeps', () => {
    const counted = sectionGenes({ genes: ['UP1', 'UP2'], down: ['DN1'] }, (g) => g !== 'UP2');
    assert.deepEqual(counted.genes, ['UP1', 'DN1']);
    assert.equal(counted.down, 1);
    assert.equal(sectionGenes({ genes: ['A'] }, () => true).down, 0);
});

// ------------------------------------------------------------------ (7) old input is not read

test('(7) the per-channel steps and legacy kinds of an earlier build are not read: no throw, no problem, no notice, the default', () => {
    const olds = [
        { source: 'sig', rows: 'set', color: { genes: 'rows_sum' }, size: { genes: 'mean', above: 0.5 } },
        { source: 'sig', rows: 'set', color: { agg: 'mean_of_zscores' } },
        { source: 'sig', rows: 'set', size: { agg: 'score_pct_above', column: 'sum', layer: 'logged', above: 2 } },
        { source: 'sig', rows: 'set', color: 'junk', size: 12, genes: 'median' },
        { source: 'sig', rows: 'set', color: null }
    ];
    for (const section of olds) {
        const { config, problems, notices } = normalizeCellGene({ ...LOGGED, sections: [section] });
        assert.deepEqual(problems, [], JSON.stringify(section));
        assert.deepEqual(notices, []);
        assert.equal('color' in config.sections[0] || 'size' in config.sections[0] || 'genes' in config.sections[0], false, 'dropped, and absent when written');
        assert.deepEqual(effectiveRowStep(config.sections[0], channels(config), 0), { genes: 'rows_mean', moved: null });
    }
    assert.doesNotThrow(() => normalizeCellGene({ sections: [null, 7, { source: 'sig', rows: 'set', genes: { not: 'a step' } }] }));
});

test('a new-shape link round-trips: the one gene step is kept, the default is not written', () => {
    const raw = { ...base(), sections: [{ source: 'sig', rows: 'set', genes: 'zscore_mean' }] };
    const { config, problems, notices } = normalizeCellGene(JSON.parse(JSON.stringify(raw)));
    assert.deepEqual(config, raw);
    assert.deepEqual(problems, []);
    assert.deepEqual(notices, []);
    assert.equal('genes' in normalizeCellGene({ ...raw, sections: [{ source: 'sig', rows: 'set', genes: 'rows_mean' }] }).config.sections[0], false);
    const cfg = oneRow();
    assert.deepEqual(setRowStep(setRowStep(cfg, 0, 'rows_z'), 0, 'rows_mean').sections[0], cfg.sections[0], 'back to the default stores nothing');
});

test('the golden link with one-row sections loads on the defaults, with no notice and no problem', () => {
    const { config, problems, notices } = normalizeCellGene(golden('cell_gene_6'));
    assert.deepEqual(problems, []);
    assert.deepEqual(notices, []);
    const sets = config.sections.filter((s) => s.rows === 'set');
    assert.equal(sets.length, 3);
    for (const s of sets) assert.equal('genes' in s || 'color' in s || 'size' in s, false);
});

// ------------------------------------------------------------------ (8) symbols

test('(8) the row symbols collide with no score or statistic symbol', () => {
    const key = (s) => `${s.over ? 'bar:' : ''}${s.text}`;
    const others = new Set([...Object.values(SCORE_SYMBOLS), ...Object.values(STAT_SYMBOLS), ...Object.values(MEASURE_SYMBOLS)].map(key));
    for (const [step, symbol] of Object.entries(ROW_SYMBOLS)) assert.ok(!others.has(key(symbol)), `${step} ${key(symbol)}`);
    assert.deepEqual(Object.keys(ROW_SYMBOLS), ['rows_mean', 'rows_sum', 'rows_z']);
});

// ------------------------------------------------------------------ the values, as before

test('the default row is the mean of its gene rows and shares their colour bar and size legend', () => {
    const { plan, out } = matrixOf(oneRow());
    assert.ok(!plan.features.some((f) => f.wire.kind === 'score'), 'no score request');
    const meanOf = (stat) => {
        const cols = GENES.map((g) => statisticColumn(stat, momentsOf(CELLS[g], 0), 2));
        return [0, 1].map((k) => cols.reduce((a, c) => a + c[k], 0) / cols.length);
    };
    close(rowOf(out.color.raw, 0), meanOf('mean'), 'color');
    assert.equal(out.rows[0].own.color.id, out.color.id, 'one colour bar with the gene rows');
});

test('under Size SD the row is the mean of the genes\' SDs, not a mean expression', () => {
    const { out } = matrixOf(oneRow({ size: { stat: 'sd', layer: 'counts' } }));
    const sds = GENES.map((g) => statisticColumn('sd', momentsOf(CELLS[g]), 2));
    close(rowOf(out.size.values, 0), [0, 1].map((k) => sds.reduce((a, c) => a + c[k], 0) / 3), 'size');
});

test('Genes detected per cell is the sum of the genes\' fractions, on its own scale', () => {
    const { out } = matrixOf(oneRow({}, { genes: 'rows_sum' }));
    const fractions = GENES.map((g) => statisticColumn('pct_expressing', momentsOf(CELLS[g]), 2));
    close(rowOf(out.size.values, 0), [0, 1].map((k) => fractions.reduce((a, c) => a + c[k] / 100, 0)), 'size');
    assert.notEqual(out.rows[0].own.size.id, out.size.id, 'not on the 0 to 100 legend');
    assert.match(out.rows[0].own.size.label, /^Genes detected per cell/);
    assert.equal(out.rows[0].symbol, '+', 'a changed row carries its symbol');
});

test('a Cell count channel draws the groups\' sizes for a one-row section, and asks for nothing', () => {
    const { plan, out } = matrixOf(oneRow({ color: { stat: 'count' } }, { genes: 'zscore_mean' }));
    assert.equal(plan.rows[0].color.keys, undefined);
    assert.equal(plan.rows[0].color.key, undefined);
    assert.deepEqual(rowOf(out.color.raw, 0), [3, 2]);
});

test('a value channel of a score row is the statistic of the per-cell score, on a colour bar of its own', () => {
    const scored = matrixOf(oneRow({}, { genes: 'mean' })).out;
    const rows = matrixOf(oneRow()).out;
    close(rowOf(scored.color.raw, 0), rowOf(rows.color.raw, 0), 'mean score then mean over cells equals the mean of the gene rows (no missing value)');
    assert.notEqual(scored.rows[0].own.color.id, scored.color.id, 'a score has its own colour bar');
    assert.equal(scored.rows[0].own.color.label, 'genes: mean; cells: mean · logged');
    assert.equal(scored.rows[0].own.color.how, 'mean score');
    assert.equal(rowQuantity({ genes: 'zscore_mean' }, { stat: 'sd', layer: 'logged' }).label, 'genes: z-score mean; cells: SD · logged');
});

test('mean of the gene rows as z-scores: each gene row z-scored across groups, then averaged', () => {
    const z = combineRows('rows_z', 'mean', GENES.map((g) => momentsOf(CELLS[g])), 2);
    close(Array.from(z), [-1 / 3, 1 / 3], 'rows_z');
});

test('the CSV says each one-row section\'s gene step per channel, beside the cell step in the column header', () => {
    const { out } = matrixOf(oneRow({}, { genes: 'zscore_mean' }));
    assert.equal(out.rows[0].own.color.how, 'z-score mean score');
    assert.equal(out.rows[0].own.size.how, 'any gene');
    const rows = longRows({ groups: [{ label: 'A', n: 3 }], rows: [{ section: 'Sig', label: 'G1' }, { section: 'Sig', label: 'Sig', combined: { color: 'z-score mean', size: 'any gene' } }],
        columns: [{ stat: 'mean', layer: 'logged', scaling: 'none', values: Float64Array.of(1, 2) }] });
    assert.deepEqual(rows[0].slice(0, 6), ['Section', 'Row', 'Group', 'Cells', 'Color: genes combined by', 'Size: genes combined by']);
    assert.deepEqual(rows[2].slice(4, 6), ['z-score mean', 'any gene']);
});

test('re-grading: Sum of the gene rows goes back to the mean when Size becomes SD, said once', () => {
    const cfg = setRowStep(oneRow(), 0, 'rows_sum');
    const { config, moved } = regradeRows({ ...cfg, size: { stat: 'sd', layer: 'counts' } });
    assert.equal('genes' in config.sections[0], false);
    assert.deepEqual(moved, [{ section: 0, from: 'rows_sum', reason: 'sum_sd', which: 'size' }]);
    const same = regradeRows({ ...cfg, size: { stat: 'mean', layer: 'counts' } });
    assert.equal(same.config.sections[0].genes, 'rows_sum');
    assert.deepEqual(same.moved, []);
});
