/**
 * WP-4 (FB-2a): the Cell-Gene Plot's Color and Size each pick a statistic and a layer, and the browser's matrix limit
 * counts what the server counts.
 *
 *   - the layer menus list every layer and the statistic menus every statistic (decision 31, which retired the offered
 *     lists of operator ruling Q1 and the plot's own `offer`);
 *   - a new plot's Color is the mean on the log-normalised layer and its Size Fraction of cells on the counts layer, threshold
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
const enabled = (list) => list.filter((o) => !o.disabled).map((o) => o.value);

// ------------------------------------------------------------------ every statistic and layer (decision 31)

test('every layer is listed for Color and Size; Fraction of cells is disabled on a signed X with its reason', () => {
    const list = C.layerList({ datasetLayers: LAYERS, kinds: KINDS, stat: 'fraction_of_cells', held: { stat: 'fraction_of_cells', layer: 'logged' } });
    assert.deepEqual(list.map((o) => o.value), ['X', 'logged', 'counts']);
    assert.deepEqual(enabled(list), ['logged', 'counts'], 'Fraction of cells cannot be read on a signed X (SHR-27)');
    const x = list.find((o) => o.value === 'X');
    assert.equal(x.title, G.negativeValuesSentence('fraction_of_cells', 'X'), 'disabled with its reason');
    assert.ok(!list.some((o) => /offer/i.test(o.label)), 'no Offer other…');
});

test('with no kinds known every layer is listed and none is disabled: nothing is guessed (OD 8)', () => {
    const list = C.layerList({ datasetLayers: LAYERS, kinds: {}, stat: 'fraction_of_cells', held: { stat: 'fraction_of_cells', layer: 'X' } });
    assert.deepEqual(enabled(list), LAYERS);
});

test('the statistic select grades each statistic on the held layer: a warn pair carries its note, Cell count is last', () => {
    const list = C.statisticList({ kinds: KINDS, held: { stat: 'fraction_of_cells', layer: 'counts' } });
    assert.deepEqual(list.map((o) => o.value), ['zscore_mean', 'mean', 'fraction_of_cells', 'mean_expressing', 'sum', 'sd', 'count']);
    assert.match(list.find((o) => o.value === 'mean').title, /sequencing depth/);
    const onX = C.statisticList({ kinds: KINDS, held: { stat: 'mean', layer: 'X' } });
    const pct = onX.find((o) => o.value === 'fraction_of_cells');
    assert.equal(pct.disabled, true);
    assert.equal(pct.title, G.negativeValuesSentence('fraction_of_cells', 'X'));
});

test('a held layer the dataset lacks stays listed and marked, so the select shows what is drawn', () => {
    const list = C.layerList({ datasetLayers: LAYERS, kinds: {}, stat: 'mean', held: { stat: 'mean', layer: 'imputed' } });
    const held = list.find((o) => o.value === 'imputed');
    assert.equal(held.label, 'imputed (not in this dataset)');
    assert.equal(held.lapsed, true);
    assert.ok(!list.some((o) => /offered/.test(o.label)), 'nothing is "no longer offered"');
});

test('a stored `offer` (WP-4, retired by decision 31) loads with no problem and is not written back', () => {
    for (const offer of [{ layers: ['X', 'counts', 3], offered: ['mean', 'nope'] }, 'all', { layers: ['logged'] }]) {
        const { config, problems } = S.normalizeCellGene({ cellAxis: { type: 'obs', key: 'cell_type' }, offer });
        assert.ok(!('offer' in config), JSON.stringify(offer));
        assert.deepEqual(problems, []);
    }
});

// ------------------------------------------------------------------ a new plot's defaults (Q2)

test('a new plot: Color mean on the log-normalised layer, Size Fraction of cells on counts, when kinds identify both', () => {
    // Size stores no threshold: it follows the grouping's Expressed above, 0 by default (decision 35)
    assert.deepEqual(G.defaultMeasures(LAYERS, KINDS),
        { color: { stat: 'mean', layer: 'logged' }, size: { stat: 'fraction_of_cells', layer: 'counts' } });
    assert.deepEqual(G.defaultMeasures(['X', 'raw', 'lognorm'], { X: 'signed', raw: 'other', lognorm: 'log' }),
        { color: { stat: 'mean', layer: 'X' }, size: { stat: 'fraction_of_cells', layer: 'X' } }, 'no counts layer: X for both');
    assert.deepEqual(G.defaultMeasures(['X', 'n1', 'n2'], { X: 'log', n1: 'counts', n2: 'log' }),
        { color: { stat: 'mean', layer: 'X' }, size: { stat: 'fraction_of_cells', layer: 'n1' } });
});

// ------------------------------------------------------------------ the request and the limit (finding 9)

test('Color and Size on two layers: each gene once per layer, and the reads say why they double', () => {
    const genes = ['A', 'B', 'C'];
    const sections = [{ section: { source: 's', rows: 'genes' }, genes, title: 's', scoreRecipe: () => null }];
    const plan = S.planFeatures({ sections, color: { stat: 'mean', layer: 'logged' }, size: { stat: 'fraction_of_cells', layer: 'counts', detect_above: 0 } });
    const wires = plan.features.map((f) => f.wire);
    assert.equal(wires.length, 6);
    for (const g of genes) {
        assert.deepEqual(wires.filter((w) => w.name === g).map((w) => w.layer).sort(), ['counts', 'logged']);
    }
    assert.deepEqual(M.geneReads(wires), { genes: 3, reads: 6, cause: 'layers' });
    const twoThresholds = S.planFeatures({ sections, color: { stat: 'fraction_of_cells', layer: 'logged' }, size: { stat: 'fraction_of_cells', layer: 'logged', detect_above: 1 } });
    assert.deepEqual(M.geneReads(twoThresholds.features.map((f) => f.wire)), { genes: 3, reads: 6, cause: 'thresholds' });
    const one = S.planFeatures({ sections, color: { stat: 'mean', layer: 'logged' }, size: { stat: 'fraction_of_cells', layer: 'logged' } });
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

test('a thresholded column names its threshold: "Fraction of cells (> 1) · counts"', () => {
    assert.equal(M.columnHeader({ stat: 'fraction_of_cells', layer: 'counts', detectAbove: 1, scaling: 'none' }), 'Fraction of cells (> 1) · counts · not scaled');
    assert.equal(M.columnHeader({ stat: 'mean', layer: 'logged', detectAbove: 1, scaling: 'none' }), 'Mean · logged · not scaled', 'a mean uses no threshold');
    const model = {
        mode: 'dots', groups: [{ label: 'a', n: 4 }], rows: [{ kind: 'gene', label: 'A', section: { index: 0, title: 's' } }],
        color: { id: 'c', stat: 'mean', layer: 'logged', scaling: 'none', values: Float64Array.of(1), raw: Float64Array.of(1) },
        size: { id: 's', stat: 'fraction_of_cells', layer: 'counts', detectAbove: 1, values: Float64Array.of(50) }
    };
    const head = M.longRows(O.tableOf(model))[0];
    assert.ok(head.includes('Fraction of cells (> 1) · counts · not scaled'), head.join(' | '));
});
