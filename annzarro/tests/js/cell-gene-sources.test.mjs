/**
 * WP-4 (FB-2a): the Cell-Gene Plot's Color and Size each pick a statistic and a layer, and the browser's matrix limit
 * counts what the server counts.
 *
 *   - the layer menus list OFFERED layers only (operator ruling Q1). On an obs-column axis the layers that matrix-kind
 *     facts call log-normalised and counts count as offered, and "Offer other…" edits the plot's own offered list;
 *   - a new plot's Color is the mean on the log-normalised layer and its Size % expressing on the counts layer, threshold
 *     0, when matrix-kind facts (never names) identify both; X otherwise (Q2);
 *   - a pair a layer cannot give is disabled with its reason, a warn pair carries its note (SHR-27);
 *   - matrixLimits counts groups x planned features against the server's 400,000 (finding 9), and says why two layers
 *     double them;
 *   - a thresholded CSV column names its threshold.
 *
 * Run:  node --test annzarro/tests/js/cell-gene-sources.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const G = await import('../../../static/js/utils/group-statistics.js');
const C = await import('../../../static/js/panels/cell-gene/controls.js');
const S = await import('../../../static/js/panels/cell-gene/sections.js');
const M = await import('../../../static/js/utils/cell-gene-model.js');
const ST = await import('../../../static/js/panels/cell-gene/states.js');
const O = await import('../../../static/js/panels/cell-gene/options.js');

const LAYERS = ['X', 'logged', 'counts'];
const KINDS = Object.freeze({ X: 'signed', logged: 'log', counts: 'counts' });
const enabled = (list) => list.filter((o) => !o.disabled && o.value !== S.OFFER_OTHER).map((o) => o.value);

// ------------------------------------------------------------------ what an obs axis offers (Q1)

test('on an obs axis the log-normalised and counts layers count as offered, so Size can be % expressing on counts', () => {
    const recipe = G.axisOfferRecipe({}, LAYERS, KINDS);
    assert.deepEqual(G.GROUP_STATISTICS_MODEL.offeredLayers(recipe), ['X', 'logged', 'counts']);
    const list = C.layerList({ recipe, datasetLayers: LAYERS, kinds: KINDS, stat: 'pct_expressing', held: { stat: 'pct_expressing', layer: 'logged' } });
    assert.deepEqual(list.map((o) => o.value), ['X', 'logged', 'counts', S.OFFER_OTHER]);
    assert.deepEqual(enabled(list), ['logged', 'counts'], '% expressing cannot be read on a signed X (SHR-27)');
    const x = list.find((o) => o.value === 'X');
    assert.equal(x.title, G.negativeValuesSentence('pct_expressing', 'X'), 'disabled with its reason');
    assert.equal(list[list.length - 1].label, 'Offer other…');
});

test('the identification is by matrix kind, never by name; with no kinds known an obs axis offers X alone', () => {
    const named = G.axisOfferRecipe({}, ['X', 'a', 'b'], { X: 'signed', a: 'counts', b: 'log' });
    assert.deepEqual(G.GROUP_STATISTICS_MODEL.offeredLayers(named), ['X', 'b', 'a'], 'log-normalised first, then counts');
    const unknown = G.axisOfferRecipe({}, LAYERS, {});
    assert.deepEqual(G.GROUP_STATISTICS_MODEL.offeredLayers(unknown), ['X']);
    const list = C.layerList({ recipe: unknown, datasetLayers: LAYERS, kinds: {}, stat: 'mean', held: { stat: 'mean', layer: 'X' } });
    assert.deepEqual(list.map((o) => o.value), ['X', S.OFFER_OTHER]);
});

test('the statistic select grades each statistic on the held layer: a warn pair carries its note, Cell count is last', () => {
    const recipe = G.axisOfferRecipe({}, LAYERS, KINDS);
    const list = C.statisticList({ recipe, kinds: KINDS, held: { stat: 'pct_expressing', layer: 'counts' } });
    assert.deepEqual(list.map((o) => o.value), ['mean', 'pct_expressing', 'count', S.OFFER_OTHER]);
    assert.match(list.find((o) => o.value === 'mean').title, /sequencing depth/);
    const onX = C.statisticList({ recipe, kinds: KINDS, held: { stat: 'mean', layer: 'X' } });
    const pct = onX.find((o) => o.value === 'pct_expressing');
    assert.equal(pct.disabled, true);
    assert.equal(pct.title, G.negativeValuesSentence('pct_expressing', 'X'));
});

test('a held layer that is not offered stays listed and marked, so the select shows what is drawn (SHR-26)', () => {
    const recipe = G.axisOfferRecipe({}, LAYERS, {});
    const list = C.layerList({ recipe, datasetLayers: LAYERS, kinds: {}, stat: 'mean', held: { stat: 'mean', layer: 'counts' } });
    const held = list.find((o) => o.value === 'counts');
    assert.equal(held.label, 'counts (no longer offered)');
    assert.equal(held.lapsed, true);
    const stats = C.statisticList({ recipe: G.axisOfferRecipe({}, LAYERS, {}), kinds: {}, held: { stat: 'sd', layer: 'X' } });
    assert.equal(stats.find((o) => o.value === 'sd').label, 'SD (no longer offered)');
});

test('Offer other… on an obs axis edits the plot\'s own offered list: an edit at the defaults writes nothing, a reset clears it', () => {
    const add = G.axisOfferPatch({}, { layers: ['X', 'logged', 'counts', 'imputed'], input: 'X' }, LAYERS.concat('imputed'), KINDS);
    assert.deepEqual(add, { layers: ['X', 'logged', 'counts', 'imputed'] });
    assert.deepEqual(G.GROUP_STATISTICS_MODEL.offeredLayers(G.axisOfferRecipe(add, LAYERS, KINDS)), ['X', 'logged', 'counts', 'imputed']);
    // unticking a default layer is kept as written, not read back as the defaults
    assert.deepEqual(G.axisOfferPatch({}, { layers: ['X', 'counts'], input: 'X' }, LAYERS, KINDS), { layers: ['X', 'counts'] });
    assert.deepEqual(G.axisOfferPatch(add, { layers: ['X', 'logged', 'counts'], input: 'X' }, LAYERS, KINDS), {});
    assert.deepEqual(G.axisOfferPatch({}, { offered: ['mean', 'pct_expressing', 'sd'] }, LAYERS, KINDS), { offered: ['mean', 'pct_expressing', 'sd'] });
    assert.deepEqual(G.axisOfferPatch(add, { offered: ['mean', 'pct_expressing'], layers: ['X'] }, LAYERS, KINDS), {}, 'Reset to defaults');
    // the configuration keeps the offer, cleaned
    const { config, problems } = S.normalizeCellGene({ offer: { layers: ['X', 'counts', 3], offered: ['mean', 'nope'] } });
    assert.deepEqual(config.offer, { layers: ['X', 'counts'], offered: ['mean'] });
    assert.equal(problems.length, 0);
    const bad = S.normalizeCellGene({ offer: 'all' });
    assert.ok(!('offer' in bad.config));
    assert.equal(bad.problems.length, 1);
});

test('Offer other… opens the grouping\'s Statistics offered on a grouping axis, the plot\'s own on an obs axis', () => {
    assert.equal(C.offerPlace({ type: 'obs', key: 'cell_type' }), 'plot');
    assert.equal(C.offerPlace({ type: S.GROUP_AXIS, key: 'g1' }), 'grouping');
    assert.equal(C.offerPlace(undefined), 'plot');
});

// ------------------------------------------------------------------ a new plot's defaults (Q2)

test('a new plot: Color mean on the log-normalised layer, Size % expressing on counts above 0, when kinds identify both', () => {
    assert.deepEqual(G.defaultMeasures(LAYERS, KINDS),
        { color: { stat: 'mean', layer: 'logged' }, size: { stat: 'pct_expressing', layer: 'counts', detect_above: 0 } });
    assert.deepEqual(G.defaultMeasures(['X', 'raw', 'lognorm'], { X: 'signed', raw: 'other', lognorm: 'log' }),
        { color: { stat: 'mean', layer: 'X' }, size: { stat: 'pct_expressing', layer: 'X' } }, 'no counts layer: X for both');
    assert.deepEqual(G.defaultMeasures(['X', 'n1', 'n2'], { X: 'log', n1: 'counts', n2: 'log' }),
        { color: { stat: 'mean', layer: 'X' }, size: { stat: 'pct_expressing', layer: 'n1', detect_above: 0 } });
});

// ------------------------------------------------------------------ the request and the limit (finding 9)

test('Color and Size on two layers: each gene once per layer, and the reads say why they double', () => {
    const genes = ['A', 'B', 'C'];
    const sections = [{ section: { source: 's', rows: 'genes' }, genes, title: 's', scoreRecipe: () => null }];
    const plan = S.planFeatures({ sections, color: { stat: 'mean', layer: 'logged' }, size: { stat: 'pct_expressing', layer: 'counts', detect_above: 0 } });
    const wires = plan.features.map((f) => f.wire);
    assert.equal(wires.length, 6);
    for (const g of genes) {
        assert.deepEqual(wires.filter((w) => w.name === g).map((w) => w.layer).sort(), ['counts', 'logged']);
    }
    assert.deepEqual(M.geneReads(wires), { genes: 3, reads: 6, cause: 'layers' });
    const twoThresholds = S.planFeatures({ sections, color: { stat: 'pct_expressing', layer: 'logged' }, size: { stat: 'pct_expressing', layer: 'logged', detect_above: 1 } });
    assert.deepEqual(M.geneReads(twoThresholds.features.map((f) => f.wire)), { genes: 3, reads: 6, cause: 'thresholds' });
    const one = S.planFeatures({ sections, color: { stat: 'mean', layer: 'logged' }, size: { stat: 'pct_expressing', layer: 'logged' } });
    assert.deepEqual(M.geneReads(one.features.map((f) => f.wire)), { genes: 3, reads: 3, cause: null });
});

test('matrixLimits refuses 12 groups x 20,000 rows x 2 layers (480,000 values) though rows x groups is 240,000', () => {
    const sections = Array.from({ length: 10 }, () => ({ rows: 2000, genes: 2000 }));
    assert.deepEqual(M.matrixLimits({ groups: 12, sections, features: 40000 }),
        { ok: false, reason: 'too_many_values', count: 480000, limit: 400000 });
    assert.deepEqual(M.matrixLimits({ groups: 12, sections, features: 20000 }), { ok: true });
    const gate = ST.gateMatrix({ sections, groups: 12, features: 40000, reads: { genes: 20000, reads: 40000, cause: 'layers' } });
    assert.equal(gate.ask, 'none');
    assert.equal(gate.tooLarge.reason, 'too_many_values');
    const said = ST.describePlot({ state: 'ready', values: {} }, { role: 'axis', sharers: 1 },
        { genes: 20000, cells: 1000, layer: 'logged', tooLarge: gate.tooLarge, ownJobAhead: () => null }, {});
    assert.match(said.headline, /480,000 values/);
    assert.match(said.text, /Color and Size read different layers, so each gene is read twice/);
});

test('the progress and the cost count both layers: "3 genes on 2 layers"', () => {
    const plot = { genes: 3, reads: { genes: 3, reads: 6, cause: 'layers' }, cells: 1200, layer: 'logged', tooLarge: null, ownJobAhead: () => null };
    const said = ST.describePlot({ state: 'awaiting', estimate: { seconds: 30, entries: 1e6, n_cells: 1200, lane: 'heavy' } },
        { role: 'axis', sharers: 1 }, plot, {});
    assert.match(said.headline, /Reading 3 genes on 2 layers over/);
});

// ------------------------------------------------------------------ the CSV header

test('a thresholded column names its threshold: "% expressing (> 1) · counts"', () => {
    assert.equal(M.columnHeader({ stat: 'pct_expressing', layer: 'counts', detectAbove: 1, scaling: 'none' }), '% expressing (> 1) · counts · not scaled');
    assert.equal(M.columnHeader({ stat: 'mean', layer: 'logged', detectAbove: 1, scaling: 'none' }), 'Mean · logged · not scaled', 'a mean uses no threshold');
    const model = {
        mode: 'dots', groups: [{ label: 'a', n: 4 }], rows: [{ kind: 'gene', label: 'A', section: { index: 0, title: 's' } }],
        color: { id: 'c', stat: 'mean', layer: 'logged', scaling: 'none', values: Float64Array.of(1), raw: Float64Array.of(1) },
        size: { id: 's', stat: 'pct_expressing', layer: 'counts', detectAbove: 1, values: Float64Array.of(50) }
    };
    const head = M.longRows(O.tableOf(model))[0];
    assert.ok(head.includes('% expressing (> 1) · counts · not scaled'), head.join(' | '));
});
