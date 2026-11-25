/**
 * Z-score mean as a statistic of a cell group (design aggregation-unify-080, section 2, package S2).
 *
 *   - A gene row under Color z-score mean asks the server for the gene's z-score (`transform: 'zscore', clip: 10`), a
 *     feature of its own beside the raw one.
 *   - A one-row section under it is always the source's z-score mean score: ONE score feature, the same feature (key,
 *     quantity id, name) as a mean Color with the row overridden to z-score mean.
 *   - Every other gene step of the row is disabled with the reason; Size cannot be z-score mean (a sign), nor can a Gene
 *     Plot's cell group yet; the two z-scores of Scale are disabled under it (the colour already is one).
 *   - A gene with no spread has no value (status constant), never 0.
 *
 * Run:  node --test annzarro/tests/js/cell-gene-zscore.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizeCellGene, addSection, setSectionRows, setRowStep, planFeatures, buildMatrix, effectiveRowStep, rowStepEntries, rowQuantity, stepFor, rowReading,
} from '../../../static/js/panels/cell-gene/sections.js';
import { statisticColumn, scalingGrade, rowStepGrade, MOMENT_STRIDE } from '../../../static/js/utils/cell-gene-model.js';
import { STATISTIC_INFO, statisticChoices, statisticGrade } from '../../../static/js/utils/group-statistics.js';
import { STATISTIC_IDS } from '../../../static/js/utils/cell-grouping.js';
import { statMenu, statInfo, genesRequest, momentsHash } from '../../../static/js/utils/group-stat-model.js';

const RECIPE = { genes: ['UP1', 'UP2'], method: 'zscore_mean', input: 'X' };
const scoreRecipe = (column, layer) => ({ ...RECIPE, method: column, input: layer });
const Z = { stat: 'zscore_mean', layer: 'logged' };
const base = (fields = {}) => normalizeCellGene({ color: { stat: 'mean', layer: 'logged' }, size: { stat: 'pct_expressing', layer: 'counts' }, mode: 'heatmap', ...fields }).config;
const oneRow = (fields = {}, section = {}) => {
    const cfg = setSectionRows(addSection(base(fields), 'sig'), 0, 'set');
    return { ...cfg, sections: [{ ...cfg.sections[0], ...section }] };
};
const planOf = (cfg, genes = ['G1', 'G2']) => planFeatures({
    sections: cfg.sections.map((section) => ({ section, genes, down: 0, title: 'Sig', scoreRecipe })),
    color: cfg.color, size: cfg.mode === 'heatmap' ? null : cfg.size, threshold: 0
});
const wires = (plan) => plan.features.map((f) => f.wire);

test('the table lists z-score mean first, and every id is known', () => {
    assert.equal(STATISTIC_INFO[0].value, 'zscore_mean');
    assert.equal(STATISTIC_INFO[0].unit, 'SD');
    assert.deepEqual(STATISTIC_INFO[0].needs, []);
    assert.deepEqual([...STATISTIC_IDS], ['zscore_mean', 'mean', 'pct_expressing', 'mean_expressing', 'sum', 'sd', 'count']);
    assert.equal(statInfo('nonsense').value, 'mean', 'an unknown statistic still reads as the mean, not as the first row');
});

test('on counts it follows the sequencing depth, like the signature\'s z-score mean', () => {
    assert.equal(statisticGrade('zscore_mean', 'counts', 'counts').grade, 'warn');
    assert.equal(statisticGrade('zscore_mean', 'counts', 'counts').code, 'depth');
    assert.equal(statisticGrade('zscore_mean', 'logged', 'log').grade, 'ok');
    assert.equal(statisticGrade('zscore_mean', 'X', 'signed').grade, 'ok', 'a signed layer is no obstacle: no threshold is read');
});

test('(1) a gene row under Color z-score mean asks for the gene z-scored, a feature apart from the raw one', () => {
    const genes = (fields) => addSection(base(fields), 'sig');
    const z = wires(planOf(genes({ color: Z })));
    const raw = wires(planOf(genes()));
    assert.ok(z.length && z.every((w) => w.kind === 'gene' && w.transform === 'zscore' && w.clip === 10));
    assert.ok(raw.every((w) => w.transform === undefined && w.clip === undefined));
    const key = (cfg) => planFeatures({ sections: [{ section: addSection(cfg, 'sig').sections[0], genes: ['G1'], down: 0, title: 'S', scoreRecipe }], color: cfg.color, size: null }).features[0].key;
    assert.notEqual(key(base({ color: Z })), key(base()));
    // beside a Size that reads the raw gene on the same layer, the two are two features of one gene
    const both = planFeatures({ sections: [{ section: { source: 'sig', rows: 'genes' }, genes: ['G1'], down: 0, title: 'S', scoreRecipe }],
        color: { stat: 'zscore_mean', layer: 'logged' }, size: { stat: 'pct_expressing', layer: 'logged' }, threshold: 0 });
    assert.equal(both.features.length, 2);
    assert.deepEqual(both.features.map((f) => f.wire.transform || 'raw').sort(), ['raw', 'zscore']);
});

test('(2) a one-row section under Color z-score mean is one score feature, the one a mean Color with the override plans', () => {
    const under = planOf(oneRow({ color: Z }));
    assert.equal(under.features.length, 1);
    const [w] = wires(under);
    assert.equal(w.kind, 'score');
    assert.equal(w.column, 'zscore_mean');
    assert.equal(w.layer, 'logged');
    const overridden = planOf(setRowStep(oneRow(), 0, 'zscore_mean'));
    assert.equal(overridden.features.length, 1);
    assert.equal(under.features[0].key, overridden.features[0].key);
});

test('under Color z-score mean a stored gene step is the default, and Color reads the z-score mean score', () => {
    const cfg = oneRow({ color: Z }, { genes: 'rows_sum' });
    const step = effectiveRowStep(cfg.sections[0], { color: cfg.color, size: cfg.size });
    assert.equal(step.genes, 'rows_mean');
    assert.deepEqual(step.moved, { reason: 'zscore', which: 'color' });
    assert.equal(stepFor(step.genes, cfg.color), 'zscore_mean');
    const plain = oneRow({ color: Z });
    assert.equal(effectiveRowStep(plain.sections[0], { color: plain.color, size: plain.size }).moved, null);
    assert.deepEqual(wires(planOf(cfg)).map((x) => x.column), ['zscore_mean']);
});

test('(3) the row\'s steps are all disabled but the default, with the reason', () => {
    const cfg = oneRow({ color: Z });
    const entries = rowStepEntries({ channels: { color: cfg.color, size: null } });
    const enabled = entries.filter((e) => !e.disabled).map((e) => e.value);
    assert.deepEqual(enabled, ['rows_mean']);
    for (const e of entries.filter((x) => x.disabled)) assert.match(e.title, /z-score mean/i);
    assert.match(entries.find((e) => e.value === 'rows_sum').title, /a set's row is its z-score mean score/);
    assert.equal(rowStepGrade('mean', 'zscore_mean').ok, false);
    assert.equal(rowStepGrade('rows_mean', 'zscore_mean').ok, true);
    assert.equal(rowStepGrade('zscore_mean', 'zscore_mean', { down: 1 }).ok, true, 'a source with down genes: its score is the default');
    // other channels keep every step, z-score mean included
    assert.ok(rowStepEntries({ channels: { color: { stat: 'mean' }, size: null } }).every((e) => !e.disabled));
});

test('(4) Size cannot be z-score mean, and a Gene Plot cell group cannot yet; Color and Height can', () => {
    const kinds = { logged: 'log' };
    const z = (consumer) => statisticChoices({ layer: 'logged', kinds, consumer }).find((e) => e.value === 'zscore_mean');
    assert.equal(z('size').disabled, true);
    assert.match(z('size').title, /signed; dot size cannot show a sign/);
    for (const consumer of ['color', 'height', undefined]) assert.equal(z(consumer).disabled, false);
    // a Gene Plot's cell group: offered on a CSC layer, listed disabled with the reason on any other, and until known
    const g = (layout) => statisticChoices({ layer: 'logged', kinds, consumer: 'genes', layout }).find((e) => e.value === 'zscore_mean');
    assert.equal(g('csc').disabled, false);
    for (const layout of ['csr', 'dense']) {
        assert.equal(g(layout).disabled, true);
        assert.match(g(layout).title, /needs a whole-layer read on this store's layout; coming with the moments cache/);
    }
    assert.equal(g(undefined).disabled, true);
    // the Gene Plot lists it first, in the same place
    const menu = statMenu({ stat: 'mean', layer: 'logged' }, kinds, { logged: 'csr' });
    assert.equal(menu.options[0].value, 'zscore_mean');
    assert.equal(menu.options[0].disabled, true);
    assert.match(menu.options[0].title, /moments cache/);
    assert.equal(statMenu({ stat: 'mean', layer: 'logged' }, kinds, { logged: 'csc' }).options[0].disabled, false);
    // a stored Size of z-score mean reads as the default Size
    const read = normalizeCellGene({ color: { stat: 'mean', layer: 'X' }, size: { stat: 'zscore_mean', layer: 'X' } });
    assert.equal(read.config.size.stat, 'pct_expressing');
    assert.ok(read.problems.some((p) => /size/.test(p)));
});

test('(5) both paths to a set\'s z-score mean row have one id and one name', () => {
    const viaChannel = oneRow({ color: Z });
    const viaOverride = setRowStep(oneRow(), 0, 'zscore_mean');
    const q = (cfg) => rowQuantity({ genes: stepFor(effectiveRowStep(cfg.sections[0], { color: cfg.color }).genes, cfg.color) }, { ...cfg.color, detect_above: 0 });
    assert.deepEqual(q(viaChannel), q(viaOverride));
    assert.equal(q(viaChannel).id, 'zscore_mean|logged|');
    assert.equal(q(viaChannel).label, 'Z-score mean · logged');
    // under a z-score mean Color the row is on the gene rows' scale; under a mean Color it has a scale of its own
    assert.equal(q(viaChannel).id, `zscore_mean|logged|`);
    // another cell step keeps the two-step wording
    const sd = rowQuantity({ genes: 'zscore_mean' }, { stat: 'sd', layer: 'logged' });
    assert.match(sd.label, /genes: .*cells: /);
});

test('(6) Scale z-scores are disabled under z-score mean, and a link that holds both reads as no scale', () => {
    for (const s of ['z_groups', 'z_pooled']) {
        const g = scalingGrade(s, 'zscore_mean');
        assert.equal(g.ok, false);
        assert.equal(g.reason, 'Color is already a z-score.');
        assert.equal(scalingGrade(s, 'mean').ok, true);
    }
    for (const s of ['none', 'var', 'group']) assert.equal(scalingGrade(s, 'zscore_mean').ok, true);
    const read = normalizeCellGene({ color: Z, scale: 'z_pooled' });
    assert.equal(read.config.scale, undefined);
    assert.deepEqual(read.notices.filter((n) => n.scale).map((n) => n.was), ['z_pooled']);
    assert.equal(normalizeCellGene({ color: Z, scale: 'var' }).config.scale, 'var');
    assert.equal(normalizeCellGene({ color: { stat: 'mean', layer: 'X' }, scale: 'z_pooled' }).config.scale, 'z_pooled');
});

test('the statistic is the mean of the z-scores; a constant gene has none', () => {
    const m = new Float64Array(2 * MOMENT_STRIDE);
    m.set([4, 2, 3, 1, 1.5], 0);              // n, sum, sumsq, nAbove, sumAbove
    assert.equal(statisticColumn('zscore_mean', m, 2)[0], 0.5);
    assert.ok(Number.isNaN(statisticColumn('zscore_mean', m, 2)[1]), 'n = 0 (a constant gene) is missing, never 0');
});

test('a constant gene draws no value and says why; its Z-score mean CSV header names the scaling', () => {
    const plan = planFeatures({ sections: [{ section: { source: 'sig', rows: 'genes' }, genes: ['G1', 'G2'], down: 0, title: 'S', scoreRecipe }],
        color: { stat: 'zscore_mean', layer: 'logged' }, size: null, threshold: 0 });
    const keys = plan.features.map((f) => f.key);
    const moments = new Float64Array(MOMENT_STRIDE).fill(0);
    const real = Float64Array.from([5, 5, 7, 0, 0]);
    const held = new Map([[keys[0], real], [keys[1], moments]]);
    const out = buildMatrix(plan, (key) => held.get(key), [{ n: 5 }], { ...base({ color: Z }), mode: 'heatmap' }, { constantOf: (key) => key === keys[1] });
    assert.equal(out.color.values[0], 1);
    assert.ok(Number.isNaN(out.color.values[1]));
    assert.deepEqual([...out.color.constant], [0, 1]);
});

test('the one-row button\'s reading under z-score mean names the score and the cell step', () => {
    const channel = { stat: 'zscore_mean', layer: 'logged' };
    assert.match(rowReading('rows_mean', { color: channel, size: null }), /^Color: z-score mean score, then Z-score mean · logged\.$/);
});

test('the Gene Plot asks for the z-score of each gene as a request of its own', () => {
    const grouping = { shape: 'grouping', partitionings: [], small: { threshold: 10, mode: 'keep' } };
    const raw = genesRequest(grouping, ['c:B'], 'logged', 0);
    const z = genesRequest(grouping, ['c:B'], 'logged', 0, 'zscore');
    assert.equal(raw.transform, undefined);
    assert.deepEqual([z.transform, z.clip], ['zscore', 10]);
    assert.notEqual(momentsHash('g', ['c:B'], 'logged', 0), momentsHash('g', ['c:B'], 'logged', 0, 'zscore'));
    assert.equal(momentsHash('g', ['c:B'], 'logged', 0), momentsHash('g', ['c:B'], 'logged', 0, null), 'no transform: the key is as before');
});
