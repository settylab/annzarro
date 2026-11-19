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
    assert.deepEqual(O.METHODS, ['zscore_mean', 'mean', 'sum', 'detected', 'fraction_of_total', 'control_adjusted']);
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
    assert.deepEqual(menu.map(o => o.id), ['zscore_mean', 'mean', 'sum']);
    assert.deepEqual(menu.map(o => o.label), ['Z-score mean', 'Mean', 'Sum']);
    assert.ok(menu.every(o => o.layer === 'X' && o.definition));
    assert.equal(O.offeredSummary(r), 'Offered: z-score mean, mean, sum · layer X');
});

test('with several layers the menu is every offered method of every offered layer, and names the layer', () => {
    const r = recipe({ offered: ['mean', 'control_adjusted', 'zscore_mean'], layers: ['counts'], input: 'X' });
    assert.deepEqual(r.offered, ['zscore_mean', 'mean', 'control_adjusted'], 'in menu order');
    assert.deepEqual(r.layers, ['X', 'counts'], 'the default layer first');
    const menu = O.offeredOptions(r);
    assert.equal(menu.length, 6);
    assert.deepEqual(menu.slice(0, 3).map(o => o.id), ['zscore_mean@X', 'mean@X', 'control_adjusted@X']);
    assert.equal(menu[3].label, 'Z-score mean · counts');
    assert.equal(O.offeredSummary(r), 'Offered: z-score mean, mean, control-adjusted · layers X, counts');
    // an offered layer the dataset lacks is not in the menu
    assert.deepEqual(O.offeredOptions(r, ['X']).map(o => o.layer), ['X', 'X', 'X']);
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
