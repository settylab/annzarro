/**
 * X3a: the Cell-Gene Plot panel's models, without a page.
 *
 *   - the configuration (plan 1.6, `cell-gene` version 1): the golden configs read unchanged, defaults, unknown fields
 *     kept, a hand-edited link cleaned;
 *   - its references (CAT-9): the cell axis (a grouping) and each section's source follow a remap, round trip;
 *   - the section list (UX 3.2, CXG-3 to CXG-8): add, duplicate, remove, move, Genes / One row, the title, the counts
 *     "48 genes · 3 not in this dataset", the over-2,000 sentence;
 *   - a one-row section's Color and Size (OD 15, CXG-5, decision 31): a kind under "From the genes" and "From the
 *     score", then a score kind's method and layer, the help line, the threshold;
 *   - the request (CXG-9, CXG-18): a section's genes asked for once whatever reads them, a gene in two sections once,
 *     only summaries ask for no score, a change of statistic on the same layer asks for nothing new;
 *   - the matrix (SHR-21, CXG-8, CXG-16): gene rows and aggregated rows from the moments, missing never 0;
 *   - the controls (UX 3.1, CXG-2, CXG-11): the Groups choices (categorical obs columns, groupings, a loop unavailable
 *     with its reason) and the Color and Size statistic and layer choices, every one listed and graded whatever the
 *     grouping's retired `offered`/`layers` say (decision 31; tests/js/cell-gene-ungated.test.mjs has the rest).
 *
 * Run:  node --test annzarro/tests/js/cell-gene-panel.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    registerReferences, remapReferences, dependsOn, usersOf, setReferenceHost, referencedFields, wouldLoop
} from '../../../static/js/utils/panel-references.js';
import { normalizeGrouping } from '../../../static/js/utils/cell-grouping.js';
import { statisticColumn, setRow, MOMENT_STRIDE } from '../../../static/js/utils/cell-gene-model.js';
import { VOCABULARY } from '../../../static/js/utils/vocabulary.js';
import { stableStringify } from '../../../static/js/utils/url-history.js';
import {
    normalizeCellGene, cellGeneReferences, addSection, duplicateSection, removeSection, moveSection, setSectionRows,
    setSectionTitle, setRowAggregation, rowAggregationOf, sectionGenes, sectionLine, tooManyGenesText, aggregationEntries,
    aggregationAfter, aggregationHelp, planFeatures, buildMatrix, sectionTitle
} from '../../../static/js/panels/cell-gene/sections.js';
import {
    statisticList, layerList, axisChoices, axisSourceId, axisRecipe
} from '../../../static/js/panels/cell-gene/controls.js';

const golden = (name) => JSON.parse(readFileSync(new URL(`../data/golden/${name}.json`, import.meta.url), 'utf8'));
const W = VOCABULARY.cellGene;

registerReferences('cell-gene', cellGeneReferences);

// ------------------------------------------------------------------ the configuration

test('the golden configs read unchanged (plan 1.6: every later normaliser reads them unchanged)', () => {
    for (const name of ['cell_gene_1', 'cell_gene_6']) {
        const raw = golden(name);
        const { config, problems } = normalizeCellGene(raw);
        assert.deepEqual(config, raw, name);
        assert.deepEqual(problems, [], name);
    }
});

test('a new plot: version 1, dots, no sections, mean and % expressing on X, nothing else written', () => {
    const { config } = normalizeCellGene({});
    assert.deepEqual(config, { version: 1, mode: 'dots', sections: [],
        color: { stat: 'mean', layer: 'X' }, size: { stat: 'pct_expressing', layer: 'X' } });
    assert.equal('cellAxis' in config, false);
    assert.equal('scale' in config, false, 'scale none is the default and is not written');
});

test('a hand-edited link is cleaned, and says what it dropped; unknown fields are kept', () => {
    const { config, problems } = normalizeCellGene({
        version: 1, mode: 'pie', cellAxis: { type: 'obs', key: '' }, scale: 'loud', swap: 'yes', futureField: { a: 1 },
        sections: [{ source: 'gene-signature-1', rows: 'genes' }, { rows: 'set' }, 'nonsense',
            { source: 'gene-signature-2', rows: 'set', color: { agg: 'median' }, size: { agg: 'score_mean', column: 'mean', layer: 'X', zzz: 1 } }],
        color: { stat: 'median', layer: 'X' }, size: { stat: 'sd', layer: '', detect_above: 'x' }
    });
    assert.equal(config.mode, 'dots');
    assert.equal('cellAxis' in config, false);
    assert.equal('scale' in config, false);
    assert.equal('swap' in config, false);
    assert.deepEqual(config.futureField, { a: 1 });
    assert.deepEqual(config.sections.map((s) => s.source), ['gene-signature-1', 'gene-signature-2']);
    assert.equal('color' in config.sections[1], false, 'an unknown aggregation falls back to the default (not written)');
    assert.deepEqual(config.sections[1].size, { agg: 'score_mean', column: 'mean', layer: 'X', zzz: 1 });
    assert.deepEqual(config.color, { stat: 'mean', layer: 'X' });
    assert.deepEqual(config.size, { stat: 'sd', layer: 'X' });
    assert.ok(problems.length >= 4, problems.join(' / '));
});

test('a score aggregation without its method is not kept: the default summary stands', () => {
    const { config } = normalizeCellGene({ sections: [{ source: 's', rows: 'set', color: { agg: 'score_mean' } }] });
    assert.equal('color' in config.sections[0], false);
    assert.deepEqual(rowAggregationOf(config.sections[0], 'color'), { agg: 'mean_of_means' });
    assert.deepEqual(rowAggregationOf(config.sections[0], 'size'), { agg: 'mean_of_pct_expressing' });
});

// ------------------------------------------------------------------ references

function pageOf(panels) {
    return { panel: (id) => panels[id] || null, ids: () => Object.keys(panels) };
}

test('references: the cell axis grouping and every section source, as axis and section (CAT-9)', () => {
    const cfg = normalizeCellGene({ cellAxis: { type: 'cell-group', key: 'g1' },
        sections: [{ source: 's1', rows: 'genes' }, { source: 't1', rows: 'set', size: { agg: 'score_mean', column: 'mean', layer: 'X' } }] }).config;
    const refs = cellGeneReferences(cfg);
    assert.deepEqual(refs.map((r) => [r.id, r.via]), [['g1', 'axis'], ['s1', 'section'], ['t1', 'section']]);
    assert.deepEqual(referencedFields(cfg, 'cell-gene'), ['cellAxis', 'sections']);
    // an obs column names no panel
    const obs = normalizeCellGene({ cellAxis: { type: 'obs', key: 'cell_type' }, sections: [] }).config;
    assert.deepEqual(cellGeneReferences(obs), []);
    // hand-edited junk never throws
    assert.deepEqual(cellGeneReferences({ cellAxis: 7, sections: 'x' }), []);
});

test('a remap round trip of the cell axis and the sections: ids that swap places land each in its own place', () => {
    const cfg = normalizeCellGene({ cellAxis: { type: 'cell-group', key: 'g1' },
        sections: [{ source: 's1', rows: 'genes' }, { source: 's2', rows: 'set' }, { source: 's1', rows: 'set' }] }).config;
    const before = JSON.parse(JSON.stringify(cfg));
    remapReferences([cfg], { g1: 'g9', s1: 's2', s2: 's1' });
    assert.equal(cfg.cellAxis.key, 'g9');
    assert.deepEqual(cfg.sections.map((s) => s.source), ['s2', 's1', 's2']);
    remapReferences([cfg], { g9: 'g1', s1: 's2', s2: 's1' });
    assert.deepEqual(cfg, before);
});

test('the plot depends on its grouping and its sources, and uses them; nothing depends on a plot', () => {
    const plot = normalizeCellGene({ cellAxis: { type: 'cell-group', key: 'g1' }, sections: [{ source: 's1', rows: 'genes' }] }).config;
    setReferenceHost(pageOf({
        g1: { type: 'cell-grouping', config: normalizeGrouping({}).recipe },
        s1: { type: 'gene-signature', config: { genes: ['A'] } },
        p1: { type: 'cell-gene', config: plot }
    }));
    assert.deepEqual(dependsOn('p1'), ['g1', 's1']);
    assert.deepEqual(usersOf('g1'), [{ panelId: 'p1', kind: 'cell-gene' }]);
    assert.deepEqual(usersOf('s1'), [{ panelId: 'p1', kind: 'cell-gene' }]);
    assert.equal(wouldLoop('p1', 'g1'), false);
    setReferenceHost(pageOf({}));
});

// ------------------------------------------------------------------ the section list

const base = () => normalizeCellGene({}).config;

test('Add genes adds a section as Genes; duplicate, move, remove and the title are one edit each, never in place', () => {
    let cfg = base();
    const c0 = cfg;
    cfg = addSection(cfg, 's1');
    assert.notEqual(cfg, c0);
    assert.deepEqual(c0.sections, []);
    assert.deepEqual(cfg.sections, [{ source: 's1', rows: 'genes' }]);
    cfg = addSection(cfg, 't1');
    cfg = duplicateSection(cfg, 0);
    assert.deepEqual(cfg.sections.map((s) => s.source), ['s1', 's1', 't1']);
    assert.notEqual(cfg.sections[0], cfg.sections[1], 'a duplicate is a copy');
    cfg = moveSection(cfg, 2, 0);
    assert.deepEqual(cfg.sections.map((s) => s.source), ['t1', 's1', 's1']);
    assert.equal(moveSection(cfg, 0, 5), cfg, 'out of range: nothing changes');
    cfg = setSectionTitle(cfg, 0, '  DE genes  ');
    assert.equal(cfg.sections[0].title, 'DE genes');
    cfg = setSectionTitle(cfg, 0, '');
    assert.equal('title' in cfg.sections[0], false, 'an empty title is the source title again');
    cfg = removeSection(cfg, 1);
    assert.deepEqual(cfg.sections.map((s) => s.source), ['t1', 's1']);
});

test('Genes and One row: a set row keeps its aggregations, which a switch back to Genes keeps too', () => {
    let cfg = addSection(base(), 's1');
    cfg = setSectionRows(cfg, 0, 'set');
    assert.equal(cfg.sections[0].rows, 'set');
    cfg = setRowAggregation(cfg, 0, 'size', { agg: 'score_pct_above', column: 'mean', layer: 'X', above: 1.5 });
    cfg = setSectionRows(cfg, 0, 'genes');
    cfg = setSectionRows(cfg, 0, 'set');
    assert.deepEqual(cfg.sections[0].size, { agg: 'score_pct_above', column: 'mean', layer: 'X', above: 1.5 });
    cfg = setRowAggregation(cfg, 0, 'color', { agg: 'mean_of_means' });
    assert.equal('color' in cfg.sections[0], false, 'the default is not written');
});

test('a section\'s title is its own, or its source\'s', () => {
    assert.equal(sectionTitle({ source: 's1', title: 'Mine' }, () => 'B cell score'), 'Mine');
    assert.equal(sectionTitle({ source: 's1' }, () => 'B cell score'), 'B cell score');
});

test('a section\'s genes: up then down, each once, in the source\'s order; absent genes counted (CXG-7, CXG-8)', () => {
    const have = new Set(['Cd19', 'Cd79a', 'Ms4a1', 'Cd3e']);
    const out = sectionGenes({ genes: ['Ms4a1', 'Cd19', 'Nope1', 'Cd79a'], down: ['Cd3e', 'Nope2', 'Cd19'] }, (g) => have.has(g));
    assert.deepEqual(out.genes, ['Ms4a1', 'Cd19', 'Cd79a', 'Cd3e']);
    assert.equal(out.missing, 2);
    assert.equal(out.total, 6);
    assert.equal(sectionLine({ kind: 'table', total: 48, missing: 3 }), '48 genes · 3 not in this dataset');
    assert.equal(sectionLine({ kind: 'signature', total: 1, missing: 0 }), '1 gene');
    assert.equal(sectionLine({ kind: 'signature', total: 12, missing: 0 }), '12 genes');
});

test('over 2,000 genes: the section says so and names what to do (CXG-17)', () => {
    assert.equal(tooManyGenesText('DE genes', 5120), 'DE genes has 5,120 genes; a section shows up to 2,000. Filter the table.');
    assert.equal(tooManyGenesText('DE genes', 2000), null);
});

// ------------------------------------------------------------------ one row: Color and Size

test('Color and Size: a kind From the genes or From the score; a score kind\'s method and layer are selects of their own (OD 15, UX 3.2)', () => {
    const list = aggregationEntries();
    assert.deepEqual(list.map((g) => g.heading), [W.aggregationHeading.summary, W.aggregationHeading.score]);
    assert.deepEqual(list[0].entries.map((e) => e.label), [
        "Mean of the genes' means", "Sum of the genes' means", "Mean of the genes' z-scores", "Mean of the genes' % expressing"]);
    assert.deepEqual(list[1].entries.map((e) => e.label), ['Score, averaged', '% of cells with score above']);
});

test('a threshold choice keeps the threshold it had, and a new one starts at 0', () => {
    const held = { agg: 'score_pct_above', column: 'mean', layer: 'X', above: 2 };
    assert.deepEqual(aggregationAfter(held, 'kind', 'score_pct_above').agg, held);
    assert.deepEqual(aggregationAfter(held, 'method', 'zscore_mean').agg, { ...held, column: 'zscore_mean' }, 'the method changes, the threshold stays');
    assert.deepEqual(aggregationAfter({ agg: 'mean_of_means' }, 'kind', 'score_pct_above').agg,
        { agg: 'score_pct_above', column: 'zscore_mean', layer: 'X' }, 'none written: 0');
});

test('the help line under the select: the aggregation\'s, with the layer for a summary (UX 3.2)', () => {
    assert.equal(aggregationHelp({ agg: 'mean_of_means' }, 'logged_counts'),
        `${W.aggregationHelp.mean_of_means} On logged_counts.`);
    assert.equal(aggregationHelp({ agg: 'score_mean', column: 'mean', layer: 'X' }, 'logged_counts'), W.aggregationHelp.score_mean);
    assert.equal(aggregationHelp({ agg: 'score_pct_above', column: 'mean', layer: 'X' }, 'X'), W.aggregationHelp.score_pct_above);
});

// ------------------------------------------------------------------ the request

const RECIPE = { genes: ['G1', 'G2', 'G3'], down: [], method: 'zscore_mean', input: 'X' };
const scoreRecipe = (column, layer) => ({ ...RECIPE, method: column, input: layer });

function plan(cfg, extra = {}) {
    const sections = cfg.sections.map((section) => ({ section, genes: ['G1', 'G2', 'G3'], title: 'Sig', scoreRecipe }));
    return planFeatures({ sections, color: cfg.color, size: cfg.mode === 'dots' ? cfg.size : null, threshold: 0, ...extra });
}

const kinds = (p) => p.features.map((f) => f.wire.kind);

test('a section of genes asks for each gene once: color mean and size % expressing on one layer share it (OD 15)', () => {
    const cfg = addSection(base(), 's1');
    const p = plan(cfg);
    assert.deepEqual(p.features.map((f) => f.wire), [
        { kind: 'gene', name: 'G1', layer: 'X', detect_above: 0 },
        { kind: 'gene', name: 'G2', layer: 'X', detect_above: 0 },
        { kind: 'gene', name: 'G3', layer: 'X', detect_above: 0 }]);
    assert.deepEqual(p.features.map((f) => f.key), p.features.map((f) => stableStringify(f.wire)));
    assert.deepEqual(p.statistics, [{ stat: 'mean', layer: 'X' }, { stat: 'pct_expressing', layer: 'X' }]);
});

test('the same genes as rows and as one row, in two sections, are asked for once (CXG-9, CXG-18)', () => {
    let cfg = addSection(addSection(base(), 's1'), 's1');
    cfg = setSectionRows(cfg, 1, 'set');
    const p = plan(cfg);
    assert.equal(p.features.length, 3);
    assert.deepEqual(kinds(p), ['gene', 'gene', 'gene']);
    assert.equal(p.rows.length, 4);
});

test('choosing only From the genes sends no score request; a score aggregation adds one score feature (CXG-9)', () => {
    let cfg = setSectionRows(addSection(base(), 's1'), 0, 'set');
    for (const agg of ['mean_of_means', 'sum_of_means', 'mean_of_zscores', 'mean_of_pct_expressing']) {
        for (const which of ['color', 'size']) {
            const p = plan(setRowAggregation(cfg, 0, which, { agg }));
            assert.ok(!kinds(p).includes('score'), `${which} ${agg}`);
        }
    }
    cfg = setRowAggregation(cfg, 0, 'size', { agg: 'score_pct_above', column: 'mean', layer: 'logged', above: 1 });
    const p = plan(cfg);
    const scores = p.features.filter((f) => f.wire.kind === 'score');
    assert.equal(scores.length, 1);
    assert.deepEqual(scores[0].wire, { kind: 'score', recipe: scoreRecipe('mean', 'logged'), column: 'mean', layer: 'logged', above: 1 });
    // score_mean on the same option as color asks for the same score: one feature
    const both = plan(setRowAggregation(cfg, 0, 'color', { agg: 'score_mean', column: 'mean', layer: 'logged' }));
    assert.equal(both.features.filter((f) => f.wire.kind === 'score').length, 1);
});

test('adding one gene to a section adds one feature, and the others keep their keys (CXG-18)', () => {
    const cfg = addSection(base(), 's1');
    const before = plan(cfg).features.map((f) => f.key);
    const after = planFeatures({ sections: [{ section: cfg.sections[0], genes: ['G1', 'G2', 'G3', 'G4'], title: 'Sig', scoreRecipe }],
        color: cfg.color, size: cfg.size, threshold: 0 }).features.map((f) => f.key);
    assert.deepEqual(after.slice(0, 3), before);
    assert.equal(after.length, 4);
});

test('a change of statistic on the same layer and threshold asks for nothing new (CXG-18)', () => {
    const cfg = addSection(base(), 's1');
    const keys = (c) => plan(c).features.map((f) => f.key).sort().join('|');
    const k0 = keys(cfg);
    for (const stat of ['sum', 'sd', 'mean_expressing', 'pct_expressing', 'count']) {
        assert.equal(keys({ ...cfg, color: { stat, layer: 'X' } }), k0, stat);
    }
    assert.equal(keys({ ...cfg, scale: 'z_pooled' }), k0);
    assert.equal(keys({ ...cfg, mode: 'heatmap' }), k0, 'heatmap: the color\'s features alone, the same ones here');
    assert.notEqual(keys({ ...cfg, color: { stat: 'mean', layer: 'logged' } }), k0, 'another layer is other features');
});

test('each of color and size has its own threshold; a statistic that uses none shares the other\'s features (CXG-9)', () => {
    const cfg = { ...addSection(base(), 's1'), size: { stat: 'pct_expressing', layer: 'X', detect_above: 0.5 } };
    const p = plan(cfg);
    assert.deepEqual([...new Set(p.features.map((f) => f.wire.detect_above))], [0.5], 'mean reads the size\'s features');
    const two = plan({ ...cfg, color: { stat: 'mean_expressing', layer: 'X', detect_above: 1 } });
    assert.deepEqual([...new Set(two.features.map((f) => f.wire.detect_above))].sort(), [0.5, 1]);
    const grouped = plan(addSection(base(), 's1'), { threshold: 0.25 });
    assert.deepEqual([...new Set(grouped.features.map((f) => f.wire.detect_above))], [0.25], 'the grouping\'s threshold by default');
});

test('cell count reads no feature', () => {
    const cfg = { ...addSection(base(), 's1'), mode: 'heatmap', color: { stat: 'count' } };
    assert.deepEqual(plan(cfg).features, []);
});

test('a section with no usable gene asks for nothing and draws one empty row saying why (CXG-8)', () => {
    const cfg = addSection(base(), 's1');
    const p = planFeatures({ sections: [{ section: cfg.sections[0], genes: [], title: 'Sig', empty: 'No gene of Sig is in this dataset', scoreRecipe }],
        color: cfg.color, size: cfg.size, threshold: 0 });
    assert.deepEqual(p.features, []);
    assert.deepEqual(p.rows.map((r) => [r.kind, r.label]), [['empty', 'No gene of Sig is in this dataset']]);
});

// ------------------------------------------------------------------ the matrix

/** Moments of one feature in G groups from per-group cell values. */
function momentsOf(groups, t = 0) {
    const m = new Float64Array(groups.length * MOMENT_STRIDE);
    groups.forEach((cells, g) => {
        for (const x of cells) {
            if (!Number.isFinite(x)) continue;
            const o = g * MOMENT_STRIDE;
            m[o] += 1; m[o + 1] += x; m[o + 2] += x * x;
            if (x > t) { m[o + 3] += 1; m[o + 4] += x; }
        }
    });
    return m;
}

test('the matrix: gene rows from their moments, an aggregated row from its genes, a missing gene never 0', () => {
    let cfg = addSection(addSection(base(), 's1'), 's1');
    cfg = setSectionRows(cfg, 1, 'set');
    const p = plan(cfg);
    const G = 2;
    const m = {
        G1: momentsOf([[0, 2, 4], [1, 1]]),
        G2: momentsOf([[3, 3], [0, 0, 6]]),
        G3: null                                // the server could not find it
    };
    const by = new Map(p.features.map((f) => [f.key, m[f.wire.name]]));
    const out = buildMatrix(p, (key) => by.get(key) || null, [{ n: 3 }, { n: 3 }], cfg);
    assert.equal(out.rows.length, 4);
    assert.deepEqual(Array.from(out.color.raw.subarray(0, G)), Array.from(statisticColumn('mean', m.G1, G)));
    assert.deepEqual(Array.from(out.size.values.subarray(G, 2 * G)), Array.from(statisticColumn('pct_expressing', m.G2, G)));
    assert.ok(out.color.raw.subarray(2 * G, 3 * G).every(Number.isNaN), 'a gene with no moments has no value, not 0');
    const set = setRow('mean_of_means', [m.G1, m.G2], G);
    assert.deepEqual(Array.from(out.color.raw.subarray(3 * G)), Array.from(set));
    assert.equal(out.rows[3].own.color.label, W.aggregation.mean_of_means);
    assert.ok(out.rows[3].own.color.id === out.color.id, 'the mean of the genes\' means is the genes\' quantity: one color bar');
    assert.notEqual(out.rows[3].own.size.id, undefined);
});

test('the matrix: count needs no feature; scaled values are the model\'s, raw kept for hover', () => {
    const cfg = { ...addSection(base(), 's1'), scale: 'var' };
    const p = plan(cfg);
    const by = new Map(p.features.map((f, i) => [f.key, momentsOf([[i], [i + 1, i + 3]])]));
    const out = buildMatrix(p, (key) => by.get(key), [{ n: 1 }, { n: 2 }], cfg);
    assert.deepEqual(Array.from(out.color.values.subarray(0, 2)), [0, 1]);
    assert.notDeepEqual(Array.from(out.color.raw.subarray(0, 2)), [0, 1]);
    const counted = buildMatrix(plan({ ...cfg, color: { stat: 'count' }, scale: 'none' }), (key) => by.get(key), [{ n: 1 }, { n: 2 }],
        { ...cfg, color: { stat: 'count' }, scale: 'none' });
    assert.deepEqual(Array.from(counted.color.raw.subarray(0, 2)), [1, 2]);
});

// ------------------------------------------------------------------ the controls

const STRUCTURE = {
    obs: { columns: ['_index', 'cell_type', 'condition', 'depth', 'is_doublet', 'batch', 'label'],
        columns_info: { cell_type: { type: 'categorical', n_categories: 6 }, condition: { type: 'categorical', n_categories: 2 },
            depth: { type: 'float64' }, is_doublet: { type: 'bool' }, batch: { type: 'int64' }, label: { type: 'string' } } }
};

test('Groups: an obs column is a categorical one; groupings follow, a loop unavailable with its reason (CXG-2, decision 15)', () => {
    const choices = axisChoices({ structure: STRUCTURE, self: 'p1', groupings: [{ id: 'g1', title: 'Grouping 1' }, { id: 'g2', title: 'Grouping 2' }],
        loops: (a, b) => b === 'g2' });
    assert.deepEqual(choices.obs, ['cell_type', 'condition', 'is_doublet', 'label']);
    assert.deepEqual(choices.groupings, [
        { id: 'g1', title: 'Grouping 1', disabled: false, reason: null },
        { id: 'g2', title: 'Grouping 2', disabled: true, reason: 'Uses Grouping 2, which depends on this plot' }]);
});

test('the cell axis as the page\'s group sources read it: a grouping by its id, an obs column as the plot\'s own axis', () => {
    assert.equal(axisSourceId('p1', { type: 'cell-group', key: 'g1' }, 'axis:'), 'g1');
    assert.equal(axisSourceId('p1', { type: 'obs', key: 'cell_type' }, 'axis:'), 'axis:p1');
    assert.equal(axisSourceId('p1', undefined, 'axis:'), null);
    const r = axisRecipe({ type: 'obs', key: 'cell_type' });
    assert.deepEqual(r.partitionings, [{ source: { type: 'obs', key: 'cell_type' } }]);
    assert.equal(axisRecipe({ type: 'obs', key: 'cell_type' }), r, 'the same object until it changes');
});

test('Color and Size list every statistic and every layer, graded, then Cell count, whatever the grouping stored (CXG-11, decision 31)', () => {
    // a grouping saved before decision 31 with its own offer: read, and gating nothing
    const recipe = normalizeGrouping({ offered: ['mean', 'pct_expressing', 'sd'], layers: ['logged'] }).recipe;
    assert.deepEqual(recipe.offered, ['mean', 'pct_expressing', 'sd'], 'kept as stored until the next edit');
    const kinds = { X: 'signed', logged: 'log' };
    const datasetLayers = ['X', 'logged', 'counts'];
    const stats = statisticList({ kinds, held: { stat: 'mean', layer: 'X' } });
    assert.deepEqual(stats.map((e) => e.value), ['mean', 'pct_expressing', 'mean_expressing', 'sum', 'sd', 'count']);
    assert.equal(stats.find((e) => e.value === 'pct_expressing').disabled, true, '% expressing cannot be read on a signed X (OD 8)');
    assert.equal(stats.find((e) => e.value === 'mean').label, 'Mean');
    assert.equal(stats.find((e) => e.value === 'count').label, 'Cell count');
    const layers = layerList({ datasetLayers, kinds, stat: 'mean', held: { stat: 'mean', layer: 'X' } });
    assert.deepEqual(layers.map((e) => e.value), datasetLayers, 'every layer of the dataset');
    const pct = layerList({ datasetLayers, kinds, stat: 'pct_expressing', held: { stat: 'pct_expressing', layer: 'logged' } });
    assert.deepEqual(pct.filter((e) => !e.disabled).map((e) => e.value), ['logged', 'counts']);
    assert.deepEqual(layerList({ datasetLayers, kinds, stat: 'count', held: { stat: 'count' } }), [], 'Cell count reads no layer');
});

test('nothing is "no longer offered": a held statistic and layer read as plain choices', () => {
    const held = { stat: 'sd', layer: 'logged' };
    const stat = statisticList({ kinds: {}, held }).find((e) => e.value === 'sd');
    assert.equal(stat.label, 'SD');
    assert.equal(stat.lapsed, undefined);
    const layer = layerList({ datasetLayers: ['X', 'logged'], kinds: {}, stat: 'sd', held }).find((e) => e.value === 'logged');
    assert.equal(layer.label, 'logged');
    assert.equal(layer.lapsed, undefined);
});

test('⋯ Duplicate: the copy follows the section, titled "<name> (copy)", with settings of its own', () => {
    let cfg = { ...base(), sections: [{ source: 's1', rows: 'set', color: { agg: 'mean_of_means' } }, { source: 't1', rows: 'genes' }] };
    cfg = duplicateSection(cfg, 0, 'Pathway');
    assert.deepEqual(cfg.sections.map((s) => s.source), ['s1', 's1', 't1']);
    assert.equal(cfg.sections[1].title, 'Pathway (copy)');
    assert.equal('title' in cfg.sections[0], false, 'the original keeps its source title');
    assert.notEqual(cfg.sections[1].color, cfg.sections[0].color, 'its settings are its own objects');
    cfg = setSectionRows(cfg, 1, 'genes');
    assert.equal(cfg.sections[0].rows, 'set', 'changing the copy leaves the original');
    // a copy of a copy, and a copy with no name given
    assert.equal(duplicateSection(cfg, 1, 'Pathway (copy)').sections[2].title, 'Pathway (copy) (copy)');
    assert.equal('title' in duplicateSection(cfg, 2).sections[3], false, 'no name given: the source title, as before');
});
