/**
 * SO-1 of decision 31: the ungated, graded lists of methods and layers (utils/options-model.js), their two instances
 * (utils/signature-options.js for scores, utils/group-statistics.js for group statistics), and the readers of the
 * stored `offered`/`layers` that only work out the old default pair and never write the fields back.
 *
 * Run:  node --test annzarro/tests/js/offered-removal-model.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../../../static/js/utils/options-model.js');
const S = await import('../../../static/js/utils/signature-options.js');
const G = await import('../../../static/js/utils/group-statistics.js');

const LAYERS = ['X', 'logged', 'counts'];
const KINDS = { X: 'signed', logged: 'log', counts: 'counts' };
// 51 quantiles of the non-zero values: every value of `logged` is above 0.1, so "above 0" holds for all of them
const DENSE = { density: 1, min: 0.1, max: 5, quantiles: Array.from({ length: 51 }, (_, i) => 0.1 + (i * 4.9) / 50) };
const STATS = { logged: DENSE };
const ctx = { datasetLayers: LAYERS, kinds: KINDS, stats: STATS };
const find = (list, value) => list.find((e) => e.value === value);

test('all 6 methods are listed on each of the 3 layers, and all 3 layers for each of the 6 methods', () => {
    for (const layer of LAYERS) {
        const list = M.methodChoices({ source: S.SIGNATURE_MODEL, recipe: {}, layer, kinds: KINDS, stats: STATS });
        assert.deepEqual(list.map((e) => e.value), S.METHODS, `methods on ${layer}`);
    }
    for (const method of S.METHODS) {
        const list = M.layerChoices({ source: S.SIGNATURE_MODEL, recipe: {}, method, ...ctx });
        assert.deepEqual(list.map((e) => e.value), LAYERS, `layers for ${method}`);
    }
    // nothing the recipe stored changes what is listed
    const gated = M.methodChoices({ source: S.SIGNATURE_MODEL, recipe: { offered: ['sum'], layers: ['counts'] }, layer: 'X', kinds: KINDS });
    assert.equal(gated.length, 6);
});

test('% of total is disabled on X, with the reason as its title; the layer select says the same from the other side', () => {
    const list = M.methodChoices({ source: S.SIGNATURE_MODEL, recipe: {}, layer: 'X', kinds: KINDS, stats: STATS });
    const pct = find(list, 'fraction_of_total');
    assert.equal(pct.disabled, true);
    assert.match(pct.title, /negative values/);
    assert.equal(pct.grade, 'cannot');
    assert.equal(find(list, 'mean').disabled, false);
    const layers = M.layerChoices({ source: S.SIGNATURE_MODEL, recipe: {}, method: 'fraction_of_total', ...ctx });
    assert.equal(find(layers, 'X').disabled, true);
    assert.match(find(layers, 'X').title, /negative values/);
    assert.equal(find(layers, 'counts').disabled, false);
    // a warning stays enabled and carries its note as the title
    const warn = find(layers, 'logged');
    assert.equal(warn.disabled, false);
    assert.equal(warn.grade, 'warn');
    assert.ok(warn.title.length > 0);
});

test('fraction detected is disabled at threshold 0 on a dense layer, enabled once the threshold is raised', () => {
    const at0 = M.methodChoices({ source: S.SIGNATURE_MODEL, recipe: { detect_above: 0 }, layer: 'logged', kinds: KINDS, stats: STATS });
    assert.equal(find(at0, 'detected').disabled, true);
    assert.match(find(at0, 'detected').title, /^Fraction detected cannot be computed on 'logged': almost every value is above 0/);
    const at1 = M.methodChoices({ source: S.SIGNATURE_MODEL, recipe: { detect_above: 1 }, layer: 'logged', kinds: KINDS, stats: STATS });
    assert.equal(find(at1, 'detected').disabled, false);
});

test('a held pair that is impossible stays selectable and says "(not available)"', () => {
    const list = M.methodChoices({ source: S.SIGNATURE_MODEL, recipe: {}, layer: 'X', kinds: KINDS, held: 'fraction_of_total' });
    const held = find(list, 'fraction_of_total');
    assert.equal(held.disabled, false);
    assert.equal(held.lapsed, true);
    assert.match(held.label, /\(not available\)$/);
});

test('pairAfter: the select touched wins and the other one moves, with one sentence saying so', () => {
    const G2 = G.GROUP_STATISTICS_MODEL;
    const moved = G2.pairAfter('method', 'pct_expressing', { layer: 'X' }, ctx);
    assert.deepEqual([moved.method, moved.layer, moved.moved], ['pct_expressing', 'logged', 'layer']);
    assert.equal(moved.say, 'Layer changed to logged: % expressing is not available on X.');
    // a method that works on the layer keeps it, and nothing is said
    const kept = G2.pairAfter('method', 'mean', { layer: 'X' }, ctx);
    assert.deepEqual([kept.method, kept.layer, kept.moved, kept.say], ['mean', 'X', null, '']);
    // the layer touched wins: the method moves to the first usable one
    const other = G2.pairAfter('layer', 'X', { method: 'pct_expressing' }, ctx);
    assert.deepEqual([other.method, other.layer, other.moved], ['mean', 'X', 'method']);
    assert.equal(other.say, 'Method changed to mean: % expressing is not available on X.');
    // the free function is the same thing
    assert.deepEqual(M.pairAfter('method', 'pct_expressing', { layer: 'X' }, { source: G2, ...ctx }), moved);
    // nothing usable: the pair is left as the user made it
    const none = G2.pairAfter('method', 'pct_expressing', { layer: 'X' }, { datasetLayers: ['X'], kinds: { X: 'signed' } });
    assert.deepEqual([none.layer, none.moved, none.impossible], ['X', null, true]);
});

test('group statistics list all five and Cell count, which reads no layer', () => {
    const list = G.statisticChoices({ recipe: {}, layer: 'X', kinds: KINDS });
    assert.deepEqual(list.map((e) => e.value), ['mean', 'pct_expressing', 'mean_expressing', 'sum', 'sd', 'count']);
    assert.equal(find(list, 'pct_expressing').disabled, true);
    assert.equal(find(list, 'count').disabled, false);
    assert.deepEqual(G.GROUP_STATISTICS_MODEL.layerChoices({ method: 'count', ...ctx }), []);
    const toCount = G.GROUP_STATISTICS_MODEL.pairAfter('method', 'count', { layer: 'X' }, ctx);
    assert.deepEqual([toCount.method, toCount.layer], ['count', null]);
});

test('legacy {offered: [sum], layers: [counts]} reads as method sum on input counts, and neither field is written back', () => {
    const legacy = { offered: ['sum'], layers: ['counts'] };
    assert.deepEqual(M.legacyPair(S.SIGNATURE_MODEL, legacy), { method: 'sum', layer: 'counts' });
    const out = S.writableOptions(legacy);
    assert.equal(out.method, 'sum');
    assert.equal(out.input, 'counts');
    assert.ok(!('offered' in out) && !('layers' in out), 'no offered, no layers');
    // an input that was stored wins; the first offered method, in menu order, is the method
    assert.deepEqual(M.legacyPair(S.SIGNATURE_MODEL, { offered: ['mean', 'zscore_mean'], layers: ['logged'], input: 'X' }), { method: 'zscore_mean', layer: 'X' });
    // nothing stored: z-score mean on X
    assert.deepEqual(M.legacyPair(S.SIGNATURE_MODEL, {}), { method: 'zscore_mean', layer: 'X' });
    assert.deepEqual(M.legacyPair(S.SIGNATURE_MODEL, null), { method: 'zscore_mean', layer: 'X' });
    // the stripped copy is what a recipe stores: the input is not re-derived from a list that is gone
    assert.deepEqual(S.writableOptions(out), out);
    assert.deepEqual(M.withoutLegacy({ offered: ['sum'], layers: ['a'], clip: 3 }), { clip: 3 });
    // a gene table's options compare by parameters only
    assert.equal(S.isDefaultParams({ offered: ['sum'], layers: ['counts'], input: 'counts' }), true);
    assert.equal(S.isDefaultParams({ clip: 3 }), false);
});

test('scoreChoices(id): every method and layer of a signature whatever it stored, graded; the legacy pair kept apart', async () => {
    const panel = {
        getType: () => 'gene-signature', getId: () => 'sig1',
        getRecipe: () => ({ input: 'counts', method: 'sum', offered: ['sum'], layers: ['counts'], genes: ['A'] }),
        getGrading: () => ({ kinds: KINDS, stats: STATS })
    };
    globalThis.window = globalThis.window || globalThis;
    globalThis.PanelManager = { getPanel: (id) => (id === 'sig1' ? panel : null), getActivePanels: () => [panel], getAllPanels: () => [panel] };
    const SS = await import('../../../static/js/utils/score-source.js');
    assert.equal(SS.scoreChoices('nobody'), null);
    const c = SS.scoreChoices('sig1', {}, { datasetLayers: LAYERS });
    assert.deepEqual(c.methods.map((e) => e.value), S.METHODS);
    assert.deepEqual(c.layers.map((e) => e.value), LAYERS);
    assert.deepEqual(c.legacy, { method: 'sum', layer: 'counts' });
    // an unset consumer reads as the legacy pair; a held one is graded on its own layer
    assert.equal(find(c.methods, 'fraction_of_total').disabled, false, 'on counts it works');
    const onX = SS.scoreChoices('sig1', { method: 'mean', layer: 'X' }, { datasetLayers: LAYERS });
    assert.equal(find(onX.methods, 'fraction_of_total').disabled, true);
    assert.equal(onX.after('method', 'fraction_of_total', { layer: 'X' }).layer, 'logged', 'the first usable layer');
});
