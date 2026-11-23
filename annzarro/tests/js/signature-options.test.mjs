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
    assert.deepEqual(O.METHODS, ['zscore_mean', 'mean', 'sum', 'control_adjusted', 'detected', 'fraction_of_total']);
    assert.equal(O.DEFAULT_METHOD, 'zscore_mean');
    for (const m of O.METHOD_INFO) assert.ok(m.definition.length > 20 && !m.definition.includes('\n'), m.value);
    const py = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'core', 'gene_score.py'), 'utf8');
    const methods = /METHODS = \(([^)]*)\)/.exec(py)[1].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean);
    assert.deepEqual(methods, [...O.METHODS], 'the server computes exactly these, in this order');
});

test('by default z-score mean, mean and sum are offered on the default layer and nothing else', () => {
    const r = offer({});
    assert.deepEqual(r.offered, ['zscore_mean', 'mean', 'sum']);
    assert.deepEqual(r.layers, ['X']);
    const menu = O.offeredOptions(r);
    assert.deepEqual(menu.map(o => o.method), ['zscore_mean', 'mean', 'sum']);
    assert.deepEqual(menu.map(o => o.label), ['z-score mean', 'mean', 'sum'], 'menus use the short names, with no layer when one is offered');
    assert.deepEqual(menu.map(o => o.fullLabel), ['z-score mean · X', 'mean · X', 'sum · X']);
    assert.ok(menu.every(o => o.layer === 'X' && o.definition && o.grade === 'ok'));
    assert.equal(O.offeredSummary(r), 'z-score mean, mean, sum · X');
    assert.equal(O.offeredSummaryShort(r), '3 methods · X');
});

test('with several layers the menu is every offered method of every offered layer, and names the layer', () => {
    const r = offer({ offered: ['mean', 'control_adjusted', 'zscore_mean'], layers: ['counts'], input: 'X' });
    assert.deepEqual(r.offered, ['zscore_mean', 'mean', 'control_adjusted'], 'in menu order');
    assert.deepEqual(r.layers, ['X', 'counts'], 'in the order they were offered');
    const menu = O.offeredOptions(r);
    assert.equal(menu.length, 6);
    // by method, and within a method the layers in the order offered: the first entry is where a new consumer starts
    assert.deepEqual(menu.map(o => o.id), ['zscore_mean@X', 'zscore_mean@counts', 'mean@X', 'mean@counts', 'control_adjusted@X', 'control_adjusted@counts']);
    assert.equal(menu[1].label, 'z-score mean · counts');
    assert.equal(O.offeredSummary(r), 'z-score mean, mean, control-adjusted · X, counts');
    assert.equal(O.offeredSummaryShort(r), '3 methods · 2 layers');
    // an offered layer the dataset lacks is not in the menu
    assert.deepEqual(O.offeredOptions(r, ['X']).map(o => o.layer), ['X', 'X', 'X']);
    // the id is the same whether one layer or two are offered: a consumer stores {column, layer}, never the id
    assert.equal(O.offeredOptions(offer({}))[1].id, 'mean@X');
    // nothing is reordered for a default: the first entry is the first offered method on the first offered layer
    const d = O.offeredOptions(offer({ offered: ['sum', 'zscore_mean'], layers: ['b', 'X'], input: 'b' }));
    assert.deepEqual(d.map(o => o.id), ['zscore_mean@b', 'zscore_mean@X', 'sum@b', 'sum@X']);
    assert.ok(d.every(o => !('isDefault' in o)), 'no default flag');
    assert.deepEqual(d[0] && [d[0].method, d[0].layer], ['zscore_mean', 'b']);
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

test('isOffered says what a consumer may pick, and a method switched off is simply not offered', () => {
    const r = offer({ offered: ['zscore_mean', 'detected'], layers: ['counts'] });
    assert.ok(O.isOffered(r, 'detected') && O.isOffered(r, 'zscore_mean', 'counts') && O.isOffered(r, 'detected', 'X'));
    assert.ok(!O.isOffered(r, 'mean') && !O.isOffered(r, 'sum', 'X') && !O.isOffered(r, 'detected', 'other'));
    // switching off never changes the stored consumers: the helpers answer, nothing is deleted
    assert.ok(!O.isOffered(offer({ offered: ['zscore_mean'] }), 'control_adjusted'));
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
    assert.deepEqual(moved({ detect_above: 2 }), ['detected']);
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
    assert.equal(O.gradeOption('sum', 'raw_counts', 'counts').reason, "On 'raw_counts' this follows sequencing depth.");
    assert.deepEqual(['log', 'normalised', 'counts', 'signed', 'other', 'unknown'].map(k => g('fraction_of_total', k)), ['warn', 'ok', 'ok', 'cannot', 'ok', 'ok']);
    assert.equal(O.gradeOption('fraction_of_total', 'X', 'signed').reason, "Not offered on 'X': it has negative values.");
    // fraction detected is not a property of the kind: with nothing sampled it is ok on every kind
    for (const kind of ['log', 'normalised', 'counts', 'signed', 'other', 'unknown']) assert.equal(g('detected', kind), 'ok', kind);
});

test('fraction detected is graded against the threshold: cannot when it makes the score constant, and re-graded when it moves', () => {
    const at = (stats, detectAbove, kind = 'signed') => O.gradeOption('detected', 'kompot_smoothed', kind, false, { stats, detectAbove });
    assert.equal(at(SCALED, 0).grade, 'ok', 'a scaled layer has about half its values above 0');
    assert.equal(at(SMOOTH, 0).grade, 'cannot');
    assert.equal(at(SMOOTH, 0).code, 'detect_high');
    assert.equal(at(SMOOTH, 0).reason, "On 'kompot_smoothed' almost every value is above 0. Raise Detected above (values here range from 0.01 to 3.4).");
    assert.equal(at(SMOOTH, 1).grade, 'ok', 'raised: it becomes meaningful');
    assert.equal(at(SMOOTH, 3.39).code, 'detect_low', 'raised too far: almost nothing is above it');
    assert.equal(at(SMOOTH, 3.39).reason, "On 'kompot_smoothed' almost no value is above 3.39. Lower Detected above (values here range from 0.01 to 3.4).");
    assert.equal(at(SPARSE, 0).grade, 'ok', 'sparse counts: 5% of all values, fine');
    assert.equal(at({ ...SPARSE, density: 0.004 }, 0).code, 'detect_low');
    assert.equal(at({ ...SCALED, min: -2.1, max: 3.4, density: 1, quantiles: quant(-2.1, -0.01) }, 0).reason,
        "On 'kompot_smoothed' almost no value is above 0. Fraction detected (values here range from \u22122.1 to 3.4).", 'at 0 there is nothing to lower');
    assert.equal(at(null, 0).grade, 'ok', 'nothing sampled yet: nothing said');
});

test('combinations that cannot be computed are left out of the menu but listed, with the reason, for the panel', () => {
    const r = offer({ offered: ['zscore_mean', 'detected', 'fraction_of_total'], layers: ['counts'] });
    const kinds = { X: 'signed', counts: 'counts' };
    const stats = { X: SMOOTH, counts: SPARSE };
    assert.deepEqual(O.offeredOptions(r, null, kinds, stats).map(o => o.id), ['zscore_mean@X', 'zscore_mean@counts', 'detected@counts', 'fraction_of_total@counts']);
    const all = O.gradedOptions(r, null, kinds, stats);
    assert.deepEqual(all.filter(o => o.grade === 'cannot').map(o => o.id), ['detected@X', 'fraction_of_total@X']);
    assert.ok(all.filter(o => o.grade === 'cannot').every(o => o.reason.startsWith('On \'X\'') || o.reason.startsWith("Not offered on 'X'")));
    assert.equal(O.offeredOptions(r).length, 6, 'with nothing known about the layers nothing is left out');
    // raise the threshold: the combination is back in the menu
    const raised = { ...r, detect_above: 1 };
    assert.ok(O.offeredOptions(raised, null, kinds, stats).some(o => o.id === 'detected@X'));
    // a warning rides on the option as a note, never as a notice
    const depth = O.gradedOptions(offer({ offered: ['mean'], layers: ['counts'] }), null, kinds, stats);
    assert.deepEqual(depth.map(o => [o.id, o.grade, o.note]), [['mean@X', 'ok', ''], ['mean@counts', 'warn', "On 'counts' this follows sequencing depth."]]);
});

test('a layer row says its properties once and only for what is offered', () => {
    const lines = (layer, kind, patch = {}, stats) => O.layerLines(layer, offer(patch), kind, stats).map(l => l.text);
    assert.deepEqual(lines('raw_counts', 'counts', { offered: ['mean', 'sum'] }), ['Raw counts: mean and sum follow sequencing depth.']);
    assert.deepEqual(lines('raw_counts', 'counts', { offered: ['zscore_mean', 'mean', 'sum'] }), ['Raw counts: z-score mean, mean and sum follow sequencing depth.']);
    assert.deepEqual(lines('raw_counts', 'counts', { offered: ['sum'] }), ['Raw counts: sum follows sequencing depth.']);
    assert.deepEqual(lines('raw_counts', 'counts', { offered: ['fraction_of_total'] }), [], 'counts is what % of total wants');
    assert.deepEqual(lines('n', 'normalised'), ['Normalized but not log-transformed: one highly expressed gene can dominate.']);
    assert.deepEqual(lines('l', 'log'), [], 'nothing offered cares');
    assert.deepEqual(lines('l', 'log', { offered: ['fraction_of_total'] }), ['Log values: % of total is compressed. It is usually read from counts.']);
    assert.deepEqual(lines('X', 'signed', { offered: ['zscore_mean', 'fraction_of_total'] }), ['Has negative values: % of total is not offered here.']);
    assert.deepEqual(lines('X', 'signed'), []);
    assert.deepEqual(lines('X', 'signed', { offered: ['detected'] }, SMOOTH),
        ["On 'X' almost every value is above 0. Raise Detected above (values here range from 0.01 to 3.4)."]);
    assert.deepEqual(lines('X', 'signed', { offered: ['detected'], detect_above: 1 }, SMOOTH), [], 'the threshold fixed it');
});

test('under a method only what every offered layer shares is said, once; the rest stays on the rows', () => {
    const r = (patch) => offer(patch);
    const text = (m, layers, patch, kinds, stats) => O.methodLines(m, layers, r(patch), kinds, stats).map(l => l.text);
    // raw_counts is the only offered layer: it applies to all of them
    assert.deepEqual(text('sum', ['raw_counts'], { offered: ['sum'] }, { raw_counts: 'counts' }), ["On 'raw_counts' this follows sequencing depth."]);
    // two offered layers, one affected: nothing under the method
    assert.deepEqual(text('sum', ['X', 'raw_counts'], { offered: ['sum'] }, { X: 'log', raw_counts: 'counts' }), []);
    // every offered layer has the issue
    assert.deepEqual(text('sum', ['a', 'b'], { offered: ['sum'] }, { a: 'counts', b: 'counts' }), ['On every offered layer this follows sequencing depth.']);
    // a layer that is fine says nothing
    assert.deepEqual(text('mean', ['X'], { offered: ['mean'] }, { X: 'log' }), []);
    assert.deepEqual(text('mean', ['X'], { offered: ['mean'] }), []);
    // a threshold message names figures of one layer: with several layers it stays on the rows
    assert.deepEqual(text('detected', ['a', 'b'], { offered: ['detected'] }, {}, { a: SMOOTH, b: SMOOTH }), []);
    assert.equal(text('detected', ['a'], { offered: ['detected'] }, {}, { a: SMOOTH }).length, 1);
    // down genes are said once whatever the layers
    assert.equal(text('sum', ['a', 'b'], { offered: ['sum'], genes: ['A'], down: ['B'] }).length, 1);
});

test('what a layer looks like has one word, and use is said in words', () => {
    assert.deepEqual(['counts', 'normalised', 'log', 'signed', 'other', 'unknown'].map(O.kindWord),
        ['counts', 'normalized', 'log-normalized', 'scaled', 'other', '']);
    assert.equal(O.useText({}), '');
    assert.equal(O.useText({ plots: 1 }), '1 plot');
    assert.equal(O.useText({ plots: 2, tables: 1 }), '2 plots, 1 table');
    assert.equal(O.useText({ tables: 3 }), '3 tables');
});

test('the summary names a parameter that is not at its default, after its method', () => {
    assert.equal(O.offeredSummary(offer({ clip: null })), 'z-score mean (not clipped), mean, sum · X');
    assert.equal(O.offeredSummary(offer({ clip: 3 })), 'z-score mean (clip ±3), mean, sum · X');
    assert.equal(O.offeredSummary(offer({ offered: ['zscore_mean', 'control_adjusted'], seed: 3, layers: ['logged_counts'], input: 'logged_counts' })),
        'z-score mean, control-adjusted (seed 3) · logged_counts');
    assert.equal(O.offeredSummary(offer({ offered: ['detected'], detect_above: 1 })), 'fraction detected (above 1) · X');
});

test('a method with parameters can be reset on its own', () => {
    assert.ok(O.isMethodDefault(recipe({}), 'zscore_mean') && O.isMethodDefault(recipe({}), 'mean'));
    assert.ok(!O.isMethodDefault(recipe({ clip: 3 }), 'zscore_mean') && !O.isMethodDefault(recipe({ clip: null }), 'zscore_mean'));
    assert.ok(!O.isMethodDefault(recipe({ seed: 2 }), 'control_adjusted') && O.isMethodDefault(recipe({ seed: 0 }), 'control_adjusted'));
    assert.ok(!O.isMethodDefault(recipe({ detect_above: 0.5 }), 'detected'));
    assert.deepEqual(O.PARAM_DEFAULTS.control_adjusted, { bins: 25, controls: 50, seed: null });
});

test('the detection threshold is a number from 0 up and reads as 0 otherwise', () => {
    assert.equal(recipe({ detect_above: 2.5 }).detect_above, 2.5);
    for (const bad of [-1, NaN, Infinity, '1', null, true]) assert.equal(recipe({ detect_above: bad }).detect_above, 0, String(bad));
    assert.deepEqual(G.parseThresholdText(' 1.5 '), { ok: true, value: 1.5 });
    assert.deepEqual(G.parseThresholdText('0'), { ok: true, value: 0 });
    for (const bad of ['', '-1', 'x', '1e999']) assert.deepEqual(G.parseThresholdText(bad), { ok: false, error: 'Enter a number from 0 up.' }, bad);
    assert.deepEqual(O.paramsOf(recipe({}), 'detected'), { detect_above: 0 });
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
