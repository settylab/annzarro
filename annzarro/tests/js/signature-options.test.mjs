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

test('the aggregations are listed by common use with z-score mean first, each with a one-line definition', () => {
    assert.deepEqual(O.METHODS, ['zscore_mean', 'mean', 'sum', 'control_adjusted', 'detected', 'fraction_of_total']);
    assert.equal(O.DEFAULT_METHOD, 'zscore_mean');
    for (const m of O.METHOD_INFO) assert.ok(m.definition.length > 20 && !m.definition.includes('\n'), m.value);
    const py = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'core', 'gene_score.py'), 'utf8');
    const methods = /METHODS = \(([^)]*)\)/.exec(py)[1].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean);
    assert.deepEqual(methods, [...O.METHODS], 'the server computes exactly these, in this order');
});

test('by default z-score mean, mean and sum are offered on the default layer and nothing else', () => {
    const r = recipe({});
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
    const r = recipe({ offered: ['mean', 'control_adjusted', 'zscore_mean'], layers: ['counts'], input: 'X' });
    assert.deepEqual(r.offered, ['zscore_mean', 'mean', 'control_adjusted'], 'in menu order');
    assert.deepEqual(r.layers, ['X', 'counts'], 'the default layer first');
    const menu = O.offeredOptions(r);
    assert.equal(menu.length, 6);
    // the default first, then by method, and within a method the default layer before the others
    assert.deepEqual(menu.map(o => o.id), ['zscore_mean@X', 'zscore_mean@counts', 'mean@X', 'mean@counts', 'control_adjusted@X', 'control_adjusted@counts']);
    assert.equal(menu[1].label, 'z-score mean · counts');
    assert.equal(O.offeredSummary(r), 'z-score mean, mean, control-adjusted · X, counts (default X)');
    assert.equal(O.offeredSummaryShort(r), '3 methods · 2 layers');
    // an offered layer the dataset lacks is not in the menu
    assert.deepEqual(O.offeredOptions(r, ['X']).map(o => o.layer), ['X', 'X', 'X']);
    // the id is the same whether one layer or two are offered: a consumer stores {column, layer}, never the id
    assert.equal(O.offeredOptions(recipe({}))[1].id, 'mean@X');
    // the default option leads even when it is not the first method or layer
    const d = O.offeredOptions(recipe({ offered: ['zscore_mean', 'sum'], method: 'sum', layers: ['X', 'b'], input: 'b' }));
    assert.deepEqual(d.map(o => o.id), ['sum@b', 'zscore_mean@b', 'zscore_mean@X', 'sum@X']);
});

test('a stored list is cleaned: unknown ids dropped, duplicates once, never empty, the default always offered', () => {
    assert.deepEqual(recipe({ offered: ['nope', 'sum', 'sum', 5, null] }).offered, ['sum']);
    assert.equal(recipe({ offered: ['sum'] }).method, 'sum', 'the default method is the first offered when z-score mean is switched off');
    assert.deepEqual(recipe({ offered: [] }).offered, ['zscore_mean']);
    assert.deepEqual(recipe({ offered: 'sum' }).offered, ['zscore_mean', 'mean', 'sum'], 'not a list: the default');
    assert.deepEqual(recipe({ layers: ['b', '', 7, 'b', 'X'], input: 'a' }).layers, ['a', 'b', 'X']);
    assert.deepEqual(recipe({ layers: 'counts' }).layers, ['X']);
});

test('an older link without the new fields reads as the defaults, and normalising changes nothing more', () => {
    const old = { genes: ['B', 'A'], down: [], input: 'X', method: 'zscore_mean', clip: 10, seed: null, version: 1 };
    const r = G.normalizeRecipe(old).recipe;
    assert.deepEqual(r.offered, ['zscore_mean', 'mean', 'sum']);
    assert.equal(r.bins, 25);
    assert.equal(r.controls, 50);
    assert.deepEqual(recipe(JSON.parse(JSON.stringify(G.storedRecipe(r)))), r);
});

test('isOffered says what a consumer may pick, and a method switched off is simply not offered', () => {
    const r = recipe({ offered: ['zscore_mean', 'detected'], layers: ['counts'] });
    assert.ok(O.isOffered(r, 'detected') && O.isOffered(r, 'zscore_mean', 'counts') && O.isOffered(r, 'detected', 'X'));
    assert.ok(!O.isOffered(r, 'mean') && !O.isOffered(r, 'sum', 'X') && !O.isOffered(r, 'detected', 'other'));
    // switching off never changes the stored consumers: the helpers answer, nothing is deleted
    assert.ok(!O.isOffered(recipe({ offered: ['zscore_mean'] }), 'control_adjusted'));
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
    assert.deepEqual(moved({ offered: ['sum'], layers: ['counts'] }), [], 'what is offered changes no score');
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


test('each method is graded on each kind of layer: ok, warn once in the panel, or cannot and left out of menus', () => {
    const g = (m, kind) => O.gradeOption(m, 'L', kind).grade;
    for (const m of ['zscore_mean', 'mean', 'sum', 'control_adjusted']) {
        assert.equal(g(m, 'counts'), 'warn');
        for (const kind of ['log', 'normalised', 'signed', 'other', 'unknown', undefined]) assert.equal(g(m, kind), 'ok', `${m} ${kind}`);
    }
    assert.equal(O.gradeOption('sum', 'raw_counts', 'counts').reason, 'On raw_counts this follows sequencing depth.');
    assert.deepEqual(['log', 'normalised', 'counts', 'signed', 'other', 'unknown'].map(k => g('detected', k)), ['ok', 'ok', 'ok', 'cannot', 'ok', 'ok']);
    assert.deepEqual(['log', 'normalised', 'counts', 'signed', 'other', 'unknown'].map(k => g('fraction_of_total', k)), ['warn', 'ok', 'ok', 'cannot', 'ok', 'ok']);
    assert.equal(O.gradeOption('detected', 'X', 'signed').reason, 'Not offered on X: almost every value is non-zero, so every gene counts as detected.');
    assert.equal(O.gradeOption('fraction_of_total', 'X', 'signed').reason, 'Not offered on X: X has negative values.');
});

test('combinations that cannot be computed are left out of the menu but listed, with the reason, for the panel', () => {
    const r = recipe({ offered: ['zscore_mean', 'detected', 'fraction_of_total'], layers: ['counts'] });
    const kinds = { X: 'signed', counts: 'counts' };
    assert.deepEqual(O.offeredOptions(r, null, kinds).map(o => o.id), ['zscore_mean@X', 'zscore_mean@counts', 'detected@counts', 'fraction_of_total@counts']);
    const all = O.gradedOptions(r, null, kinds);
    assert.deepEqual(all.filter(o => o.grade === 'cannot').map(o => o.id), ['detected@X', 'fraction_of_total@X']);
    assert.ok(all.filter(o => o.grade === 'cannot').every(o => o.reason.startsWith('Not offered on X:')));
    assert.equal(O.offeredOptions(r).length, 6, 'with nothing known about the layers nothing is left out');
});

test('what a layer looks like has one word, and use is said in words', () => {
    assert.deepEqual(['counts', 'normalised', 'log', 'signed', 'other', 'unknown'].map(O.kindWord),
        ['counts', 'normalised', 'log-normalised', 'scaled', 'other', '']);
    assert.equal(O.useText({}), '');
    assert.equal(O.useText({ plots: 1 }), '1 plot');
    assert.equal(O.useText({ plots: 2, tables: 1 }), '2 plots, 1 table');
    assert.equal(O.useText({ tables: 3 }), '3 tables');
});

test('the summary names a parameter that is not at its default, after its method', () => {
    assert.equal(O.offeredSummary(recipe({ clip: null })), 'z-score mean (not clipped), mean, sum · X');
    assert.equal(O.offeredSummary(recipe({ clip: 3 })), 'z-score mean (clip ±3), mean, sum · X');
    assert.equal(O.offeredSummary(recipe({ offered: ['zscore_mean', 'control_adjusted'], seed: 3, layers: ['logged_counts'], input: 'logged_counts' })),
        'z-score mean, control-adjusted (seed 3) · logged_counts');
    assert.equal(O.offeredSummary(recipe({ offered: ['detected'], detect_above: 1 })), 'fraction detected (above 1) · X');
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
