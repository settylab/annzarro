/**
 * The model of what a signature offers plots and tables (static/js/utils/signature-options.js) and how it sits in
 * the stored recipe: which methods and layers are offered, the menu they make, the cache key per option, and that
 * switching an option off keeps every consumer's setting valid.
 *
 * Run:  node --test annzarro/tests/js/signature-options.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const O = await import('../../../static/js/utils/signature-options.js');
const G = await import('../../../static/js/utils/gene-signature.js');

const recipe = (raw) => G.normalizeRecipe({ genes: ['A', 'B'], ...raw }).recipe;
// The option fields as the offered model (options-model.js, kept until SO-3/SO-4 remove its last callers) reads them: a
// recipe no longer carries `offered` or `layers` (decision 31), so these tests hand the model the normalised options.
const offer = (raw) => ({ ...recipe(raw), ...O.normalizeOptions(raw) });

test('the aggregations are listed by common use with z-score mean first, each with a one-line definition', () => {
    assert.deepEqual(O.METHODS, ['zscore_mean', 'mean', 'sum', 'control_adjusted', 'fraction_of_genes', 'fraction_of_total']);
    assert.equal(O.DEFAULT_METHOD, 'zscore_mean');
    for (const m of O.METHOD_INFO) assert.ok(m.definition.length > 20 && !m.definition.includes('\n'), m.value);
    const py = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'core', 'gene_score.py'), 'utf8');
    const methods = /METHODS = \(([^)]*)\)/.exec(py)[1].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean);
    assert.deepEqual(methods, [...O.METHODS], 'the server computes exactly these, in this order');
});

test('a stored list is cleaned: unknown ids dropped, duplicates once, never empty, the default always offered', () => {
    assert.deepEqual(offer({ offered: ['nope', 'sum', 'sum', 5, null] }).offered, ['sum']);
    assert.equal(offer({ offered: ['sum'] }).method, 'sum', 'the default method is the first offered when z-score mean is switched off');
    assert.deepEqual(offer({ offered: [] }).offered, ['zscore_mean']);
    assert.deepEqual(offer({ offered: 'sum' }).offered, ['zscore_mean', 'mean', 'sum'], 'not a list: the default');
    assert.deepEqual(offer({ layers: ['b', '', 7, 'b', 'X'], input: 'a' }).layers, ['a', 'b', 'X']);
    assert.deepEqual(offer({ layers: 'counts' }).layers, ['X']);
});

test('an older link without the new fields reads as the defaults, and normalising changes nothing more', () => {
    const old = { genes: ['B', 'A'], down: [], input: 'X', method: 'zscore_mean', clip: 10, seed: null, version: 1 };
    const r = G.normalizeRecipe(old).recipe;
    assert.equal('offered' in r || 'layers' in r, false, 'nothing is offered since decision 31');
    assert.equal(r.method, 'zscore_mean');
    assert.equal(r.bins, 25);
    assert.equal(r.controls, 50);
    assert.deepEqual(recipe(JSON.parse(JSON.stringify(G.storedRecipe(r)))), r);
});

test('each method has its own key; a parameter moves only the methods that read it', () => {
    const base = recipe({});
    const key = (r, method) => G.recipeHash({ ...r, method });
    const keys = O.METHODS.map(m => key(base, m));
    assert.equal(new Set(keys).size, O.METHODS.length, 'distinct per method');
    const moved = (patch) => O.METHODS.filter(m => key(base, m) !== key(recipe(patch), m));
    assert.deepEqual(moved({ clip: 3 }), ['zscore_mean']);
    assert.deepEqual(moved({ clip: null }), ['zscore_mean']);
    assert.deepEqual(moved({ seed: 4 }), ['control_adjusted']);
    assert.deepEqual(moved({ bins: 10 }), ['control_adjusted']);
    assert.deepEqual(moved({ detect_above: 2 }), ['fraction_of_genes']);
    assert.deepEqual(moved({ controls: 20 }), ['control_adjusted']);
    assert.deepEqual(moved({ input: 'counts' }), [...O.METHODS], 'a layer moves every method');
    assert.deepEqual(moved({ genes: ['A', 'B', 'C'] }), [...O.METHODS]);
    assert.deepEqual(moved({ offered: ['zscore_mean', 'sum'], layers: ['X', 'counts'] }), [], 'an old link\'s offered lists change no score');
    assert.deepEqual(O.paramsOf(base, 'mean'), {});
    assert.deepEqual(O.paramsOf(base, 'control_adjusted'), { bins: 25, controls: 50, seed: 0 });
});

test('bins and controls outside their range read as the default', () => {
    for (const bad of [1, 201, 2.5, '25', null, true]) assert.equal(recipe({ bins: bad }).bins, 25, String(bad));
    for (const bad of [0, 1001, -1, 0.5]) assert.equal(recipe({ controls: bad }).controls, 50, String(bad));
    assert.equal(recipe({ bins: 2 }).bins, 2);
    assert.equal(recipe({ bins: 200 }).bins, 200);
    assert.deepEqual(G.parseWholeText('7', G.BINS_RANGE), { ok: true, value: 7 });
    assert.deepEqual(G.parseWholeText('1', G.BINS_RANGE), { ok: false, error: 'Enter a whole number from 2 to 200.' });
    assert.deepEqual(G.parseWholeText('2000', G.CONTROLS_RANGE), { ok: false, error: 'Enter a whole number from 1 to 1,000.' });
});


// A layer whose values are mostly above 0 ("scaled": half of them are negative, so half are above 0 is fine), and one
// whose values are almost all far above 0 (a smoothed layer): quantiles of the non-zero values at every 2 percent.
const quant = (lo, hi) => Array.from({ length: 51 }, (_, i) => lo + (hi - lo) * i / 50);
const SCALED = { min: -2.1, max: 3.4, density: 1, quantiles: quant(-2.1, 3.4) };       // as many above 0 as below
const SMOOTH = { min: 0.01, max: 3.4, density: 1, quantiles: quant(0.01, 3.4) };        // every value above 0
const SPARSE = { min: 1, max: 40, density: 0.05, quantiles: quant(1, 40) };             // 5% of values are non-zero

test('the share of values above a threshold is read from the sample and follows the threshold', () => {
    assert.equal(O.shareAbove(null, 0), null);
    assert.equal(O.shareAbove({ density: null, quantiles: null }, 0), null);
    assert.ok(Math.abs(O.shareAbove(SCALED, 0) - 0.62) < 0.02, 'about 62% of -2.1..3.4 is above 0');
    assert.equal(O.shareAbove(SMOOTH, 0), 1);
    assert.ok(Math.abs(O.shareAbove(SMOOTH, 1.7) - 0.5) < 0.02);
    assert.equal(O.shareAbove(SMOOTH, 3.4), 0, 'nothing is above the largest value');
    assert.equal(O.shareAbove(SPARSE, 0), 0.05, 'zeros are never above a threshold of 0 or more');
    let last = 1;
    for (const t of [0, 0.5, 1, 2, 3, 4]) { const x = O.shareAbove(SCALED, t); assert.ok(x <= last + 1e-12); last = x; }
});

test('each method is graded on each kind of layer: ok, warn once on the layer row, or cannot and left out of menus', () => {
    const g = (m, kind) => O.gradeOption(m, 'L', kind).grade;
    for (const m of ['zscore_mean', 'mean', 'sum', 'control_adjusted']) {
        assert.equal(g(m, 'counts'), 'warn');
        for (const kind of ['log', 'normalised', 'signed', 'other', 'unknown', undefined]) assert.equal(g(m, kind), 'ok', `${m} ${kind}`);
    }
    assert.equal(O.gradeOption('sum', 'raw_counts', 'counts').reason, "Sum on 'raw_counts' follows sequencing depth.");
    assert.deepEqual(['log', 'normalised', 'counts', 'signed', 'other', 'unknown'].map(k => g('fraction_of_total', k)), ['warn', 'ok', 'ok', 'cannot', 'ok', 'ok']);
    assert.equal(O.gradeOption('fraction_of_total', 'X', 'signed').reason, "% of total cannot be computed on 'X': it has negative values.");
    assert.equal(O.gradeOption('fraction_of_total', 'X', 'log').reason, "% of total on 'X' is compressed by the log: it is usually read from counts.");
    // fraction of genes is not a property of the kind: with nothing sampled it is ok on every kind
    for (const kind of ['log', 'normalised', 'counts', 'signed', 'other', 'unknown']) assert.equal(g('fraction_of_genes', kind), 'ok', kind);
});

test('fraction of genes is graded against the threshold: cannot when it makes the score constant, and re-graded when it moves', () => {
    const at = (stats, detectAbove, kind = 'signed') => O.gradeOption('fraction_of_genes', 'kompot_smoothed', kind, false, { stats, detectAbove });
    assert.equal(at(SCALED, 0).grade, 'ok', 'a scaled layer has about half its values above 0');
    assert.equal(at(SMOOTH, 0).grade, 'cannot');
    assert.equal(at(SMOOTH, 0).code, 'detect_high');
    assert.equal(at(SMOOTH, 0).reason, "Fraction of genes cannot be computed on 'kompot_smoothed': almost every value is above 0 (values here range from 0.01 to 3.4). Raise Expressed above.");
    assert.equal(at(SMOOTH, 1).grade, 'ok', 'raised: it becomes meaningful');
    assert.equal(at(SMOOTH, 3.39).code, 'detect_low', 'raised too far: almost nothing is above it');
    assert.equal(at(SMOOTH, 3.39).reason, "Fraction of genes cannot be computed on 'kompot_smoothed': almost no value is above 3.39 (values here range from 0.01 to 3.4). Lower Expressed above.");
    assert.equal(at(SPARSE, 0).grade, 'ok', 'sparse counts: 5% of all values, fine');
    assert.equal(at({ ...SPARSE, density: 0.004 }, 0).code, 'detect_low');
    assert.equal(at({ ...SCALED, min: -2.1, max: 3.4, density: 1, quantiles: quant(-2.1, -0.01) }, 0).reason,
        "Fraction of genes cannot be computed on 'kompot_smoothed': almost no value is above 0 (values here range from \u22122.1 to 3.4).", 'at 0 there is nothing to lower');
    assert.equal(at(null, 0).grade, 'ok', 'nothing sampled yet: nothing said');
});

test('every method is listed on every layer; what cannot be computed is disabled with its reason as the title', () => {
    const kinds = { X: 'signed', counts: 'counts' };
    const stats = { X: SMOOTH, counts: SPARSE };
    const onX = O.scoreMethodChoices({ recipe: recipe({}), layer: 'X', kinds, stats });
    assert.deepEqual(onX.map(o => o.value), [...O.METHODS], 'all six, always');
    assert.deepEqual(onX.filter(o => o.disabled).map(o => o.value), ['fraction_of_genes', 'fraction_of_total']);
    assert.ok(onX.filter(o => o.disabled).every(o => o.title === o.reason && / cannot be computed on 'X': /.test(o.title)));
    // raise the threshold: fraction of genes can be chosen again
    assert.equal(O.scoreMethodChoices({ recipe: recipe({ detect_above: 1 }), layer: 'X', kinds, stats }).find(o => o.value === 'fraction_of_genes').disabled, false);
    // a warning rides on the option as a note, and it stays usable
    const mean = O.scoreMethodChoices({ recipe: recipe({}), layer: 'counts', kinds, stats }).find(o => o.value === 'mean');
    assert.deepEqual([mean.disabled, mean.grade, mean.note], [false, 'warn', "Mean on 'counts' follows sequencing depth."]);
    const layers = O.scoreLayerChoices({ recipe: recipe({}), method: 'fraction_of_total', datasetLayers: ['X', 'counts'], kinds, stats });
    assert.deepEqual(layers.map(o => [o.value, o.disabled]), [['X', true], ['counts', false]]);
});

test('what a layer looks like has one word, and use is said in words', () => {
    assert.deepEqual(['counts', 'normalised', 'log', 'signed', 'other', 'unknown'].map(O.kindWord),
        ['counts', 'normalized', 'log-normalized', 'scaled', 'other', '']);
    assert.equal(O.useText({}), '');
    assert.equal(O.useText({ plots: 1 }), '1 plot');
    assert.equal(O.useText({ plots: 2, tables: 1 }), '2 plots, 1 table');
    assert.equal(O.useText({ tables: 3 }), '3 tables');
});

test('no reason the grader gives says "offered": each names the method and says why', () => {
    const stats = { X: { min: 0.01, max: 3.4, density: 1, quantiles: Array.from({ length: 51 }, (_, i) => 0.01 + 3.39 * i / 50) } };
    const reasons = [];
    for (const m of O.METHODS) {
        for (const kind of ['counts', 'log', 'normalised', 'signed', 'other', undefined]) {
            for (const hasDown of [false, true]) {
                for (const detectAbove of [0, 3.39]) {
                    const g = O.gradeOption(m, 'X', kind, hasDown, { stats: stats.X, detectAbove });
                    if (g.reason) reasons.push([m, g]);
                }
            }
        }
    }
    assert.ok(reasons.length > 10);
    for (const [m, g] of reasons) {
        assert.ok(!/offer/i.test(g.reason), g.reason);
        const label = O.METHOD_INFO.find(i => i.value === m).label;
        assert.ok(g.reason.startsWith(`${label} `), `names the method first: ${g.reason}`);
        if (g.grade === 'cannot') assert.match(g.reason, / cannot be computed (on 'X'|with down genes): /);
    }
    assert.equal(O.gradeOption('sum', 'X', 'log', true).reason, 'Sum cannot be computed with down genes: a signed sum depends on how many genes each side has.');
});

test('a method with parameters can be reset on its own', () => {
    assert.ok(O.isMethodDefault(recipe({}), 'zscore_mean') && O.isMethodDefault(recipe({}), 'mean'));
    assert.ok(!O.isMethodDefault(recipe({ clip: 3 }), 'zscore_mean') && !O.isMethodDefault(recipe({ clip: null }), 'zscore_mean'));
    assert.ok(!O.isMethodDefault(recipe({ seed: 2 }), 'control_adjusted') && O.isMethodDefault(recipe({ seed: 0 }), 'control_adjusted'));
    assert.ok(!O.isMethodDefault(recipe({ detect_above: 0.5 }), 'fraction_of_genes'));
    assert.deepEqual(O.PARAM_DEFAULTS.control_adjusted, { bins: 25, controls: 50, seed: null });
});

test('the detection threshold is a number from 0 up and reads as 0 otherwise', () => {
    assert.equal(recipe({ detect_above: 2.5 }).detect_above, 2.5);
    for (const bad of [-1, NaN, Infinity, '1', null, true]) assert.equal(recipe({ detect_above: bad }).detect_above, 0, String(bad));
    assert.deepEqual(G.parseThresholdText(' 1.5 '), { ok: true, value: 1.5 });
    assert.deepEqual(G.parseThresholdText('0'), { ok: true, value: 0 });
    for (const bad of ['', '-1', 'x', '1e999']) assert.deepEqual(G.parseThresholdText(bad), { ok: false, error: 'Enter a number from 0 up.' }, bad);
    assert.deepEqual(O.paramsOf(recipe({}), 'fraction_of_genes'), { detect_above: 0 });
});

// ---------------------------------------------------------------------------------------------------------------
// The shared schema of the option fields: a signature stores them flat in its recipe, a gene table under
// `scoreOptions`; one definition, one normaliser.

test('the option fields are one schema: the same keys in a signature recipe and in the options a table stores', () => {
    // `offered` and `layers` are read from old links only; `methods` is reserved for custom methods (after 0.8.0)
    assert.deepEqual([...O.OPTION_KEYS], ['input', 'method', 'offered', 'layers', 'clip', 'seed', 'bins', 'controls', 'detect_above', 'methods']);
    const options = O.writableOptions({});
    assert.deepEqual(Object.keys(options).sort(), O.OPTION_KEYS.filter(k => !['offered', 'layers', 'methods'].includes(k)).sort());
    const r = recipe({});
    for (const key of Object.keys(options)) assert.deepEqual(r[key], options[key], key);
    assert.deepEqual(O.pickOptions(r), options, 'what a recipe holds of it is exactly the options a table stores');
});

test('normalising the options: anything invalid takes its default, the default method is always offered', () => {
    const o = O.normalizeOptions({ method: 'nonsense', offered: ['sum', 'bogus'], layers: ['counts', '', 7], input: '', clip: -1, bins: 1,
        controls: 5000, seed: -3, detect_above: 'x' });
    assert.equal(o.method, 'sum', 'a method that is not offered gives way to one that is');
    assert.deepEqual(o.offered, ['sum']);
    assert.deepEqual(o.layers, ['X', 'counts']);
    assert.equal(o.input, 'X');
    assert.deepEqual([o.clip, o.bins, o.controls, o.seed, o.detect_above], [10, 25, 50, null, 0]);
    assert.deepEqual(O.normalizeOptions(null), O.normalizeOptions(undefined));
    assert.deepEqual(O.normalizeOptions(o), o, 'normalising is idempotent');
    assert.equal(O.normalizeOptions({ clip: null }).clip, null, 'no clipping is a setting');
});

test('stored options are plain copies, and the defaults are recognised so a table stores nothing for them', () => {
    const o = O.normalizeOptions({ offered: ['mean', 'sum'], layers: ['X', 'counts'] });
    const stored = O.storedOptions(o);
    stored.offered.push('x'); stored.layers.push('y');
    assert.deepEqual(o.offered, ['mean', 'sum']);
    assert.equal(O.isDefaultOptions({}), true);
    assert.equal(O.isDefaultOptions(null), true);
    assert.equal(O.isDefaultOptions(O.normalizeOptions({ clip: 3 })), false);
    assert.equal(O.isDefaultOptions({ offered: ['zscore_mean', 'mean', 'sum'] }), true, 'the default offer, spelled out');
    assert.equal(O.isDefaultOptions({ layers: ['X', 'counts'] }), false);
});

test('a later field (up and down genes) joins the schema in one place: OPTION_KEYS is what every consumer reads', () => {
    // pickOptions keeps only schema keys, so a field outside the schema never reaches a table's stored options
    assert.deepEqual(O.pickOptions({ genes: ['A'], down: ['B'], clip: 4, title: 'x', method: 'mean' }), { clip: 4, method: 'mean' });
});
