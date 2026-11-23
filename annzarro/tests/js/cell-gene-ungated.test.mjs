/**
 * SO-4 of decision 31: the Cell-Gene Plot and the Cell Grouping stop gating statistics and layers.
 *
 * - Color, Size and Height list all five statistics and Cell count, on every layer of the dataset, graded (a pair a
 *   layer cannot give is disabled with its reason); nothing is "offered", so nothing reads "Offer other…" or "(no
 *   longer offered)", on a grouping axis or an obs one.
 * - A one-row section's Color and Size are three selects: the kind (4 summaries, 2 score kinds), then for a score kind
 *   its method and layer.
 * - A grouping keeps its "Expressed above" (`detect_above`, decision 34) and a measure with no threshold of its own reads
 *   it, so an old link draws the same plot; the plot's own `offer` of WP-4 is read and dropped.
 *
 * Run:  node --test annzarro/tests/js/cell-gene-ungated.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const C = await import('../../../static/js/panels/cell-gene/controls.js');
const S = await import('../../../static/js/panels/cell-gene/sections.js');
const D = await import('../../../static/js/panels/cell-gene/draw.js');
const G = await import('../../../static/js/utils/group-statistics.js');
const { normalizeGrouping } = await import('../../../static/js/utils/cell-grouping.js');
const { MOMENT_STRIDE } = await import('../../../static/js/utils/cell-gene-model.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');

const LAYERS = ['X', 'logged', 'counts'];
const KINDS = { X: 'signed', logged: 'log', counts: 'counts' };
const golden = (name) => JSON.parse(readFileSync(new URL(`../data/golden/${name}.json`, import.meta.url), 'utf8'));
const values = (list) => list.map((o) => o.value);

// ------------------------------------------------------------------ Color, Size and Height (item 6)

test('statisticList: the 5 statistics and Cell count, and no "Offer other…"', () => {
    const list = C.statisticList({ kinds: KINDS, held: { stat: 'mean', layer: 'logged' } });
    assert.deepEqual(values(list), ['mean', 'pct_expressing', 'mean_expressing', 'sum', 'sd', 'count']);
    assert.ok(!list.some((o) => /offer/i.test(o.label)), 'no Offer other…');
    assert.ok(!list.some((o) => o.disabled), 'logged gives every statistic');
    // on X (signed) the two threshold statistics are disabled with the reason as their title
    const onX = C.statisticList({ kinds: KINDS, held: { stat: 'mean', layer: 'X' } });
    for (const stat of ['pct_expressing', 'mean_expressing']) {
        const e = onX.find((o) => o.value === stat);
        assert.equal(e.disabled, true, stat);
        assert.match(e.title, /negative values/);
    }
});

test('layerList: all 3 layers, X disabled for % expressing with its reason; none for Cell count', () => {
    const list = C.layerList({ datasetLayers: LAYERS, kinds: KINDS, stat: 'pct_expressing', held: { stat: 'pct_expressing', layer: 'logged' } });
    assert.deepEqual(values(list), LAYERS);
    const x = list.find((o) => o.value === 'X');
    assert.equal(x.disabled, true);
    assert.match(x.title, /negative values/);
    assert.ok(!list.find((o) => o.value === 'counts').disabled);
    assert.ok(!list.some((o) => /offer/i.test(o.label)));
    assert.deepEqual(C.layerList({ datasetLayers: LAYERS, kinds: KINDS, stat: 'count', held: { stat: 'count' } }), []);
});

test('a default grouping-axis plot on logged and counts reads "(no longer offered)" nowhere', () => {
    const d = G.defaultMeasures(LAYERS, KINDS);
    assert.deepEqual(d.color, { stat: 'mean', layer: 'logged' });
    assert.deepEqual(d.size, { stat: 'pct_expressing', layer: 'counts' }, 'no threshold of its own: it follows the grouping (decision 35)');
    for (const spec of [d.color, d.size]) {
        const m = C.measureModel({ spec, datasetLayers: LAYERS, kinds: KINDS, threshold: 0 });
        for (const o of [...m.stats, ...m.layers]) assert.ok(!/offered|not available/.test(o.label), o.label);
        assert.equal(m.layer, spec.layer);
    }
});

test('a stored impossible pair stays, marked "(not available)"; a layer the dataset lacks is marked so', () => {
    const held = { stat: 'pct_expressing', layer: 'X' };
    assert.equal(C.statisticList({ kinds: KINDS, held }).find((o) => o.value === 'pct_expressing').label, '% expressing (not available)');
    const x = C.layerList({ datasetLayers: LAYERS, kinds: KINDS, stat: held.stat, held }).find((o) => o.value === 'X');
    assert.equal(x.label, 'X (not available)');
    assert.equal(x.disabled, undefined, 'the held pair stays selectable');
    const gone = C.layerList({ datasetLayers: LAYERS, kinds: KINDS, stat: 'mean', held: { stat: 'mean', layer: 'imputed' } });
    assert.equal(gone[gone.length - 1].label, 'imputed (not in this dataset)');
});

test('pickLayer: the layer stays when it can give the statistic; else the first that can, said once', () => {
    assert.deepEqual(C.pickLayer({ datasetLayers: LAYERS, kinds: KINDS, stat: 'sd', preferred: 'X' }), { layer: 'X', say: '' });
    const moved = C.pickLayer({ datasetLayers: LAYERS, kinds: KINDS, stat: 'pct_expressing', preferred: 'X' });
    assert.equal(moved.layer, 'logged');
    assert.match(moved.say, /^Layer changed to logged: % expressing is not available on X\.$/);
});

// ------------------------------------------------------------------ one-row sections (item 7)

test('aggregationEntries: the kind select is 4 summaries and 2 score kinds, nothing offered', () => {
    const groups = S.aggregationEntries();
    assert.equal(groups.length, 2);
    assert.deepEqual(values(groups[0].entries), ['mean_of_means', 'sum_of_means', 'mean_of_zscores', 'mean_of_pct_expressing']);
    assert.deepEqual(values(groups[1].entries), ['score_mean', 'score_pct_above']);
    assert.deepEqual(groups[1].entries.map((e) => e.label), ['Score, averaged', '% of cells with score above']);
    assert.ok(!groups.flatMap((g) => g.entries).some((e) => /offer/i.test(e.label)));
});

test('aggregationAfter: a new score kind starts on z-score mean · X; method and layer move as one pair', () => {
    const fresh = S.aggregationAfter({ agg: 'mean_of_means' }, 'kind', 'score_mean');
    assert.deepEqual(fresh, { agg: { agg: 'score_mean', column: 'zscore_mean', layer: 'X' }, say: '' });
    const held = { agg: 'score_pct_above', column: 'mean', layer: 'logged', above: 2 };
    assert.deepEqual(S.aggregationAfter(held, 'kind', 'score_pct_above').agg, held, 'the same kind keeps its threshold');
    assert.deepEqual(S.aggregationAfter(held, 'kind', 'score_mean').agg, { agg: 'score_mean', column: 'mean', layer: 'logged' });
    assert.deepEqual(S.aggregationAfter(held, 'kind', 'sum_of_means').agg, { agg: 'sum_of_means' });
    // the method touched wins; the layer moves when the pair is impossible, and says so
    const choices = { after: (changed, value, pair) => (changed === 'method' && value === 'fraction_of_total' && pair.layer === 'X'
        ? { method: value, layer: 'counts', say: 'Layer changed to counts: % of total is not available on X.' }
        : { method: changed === 'method' ? value : pair.method, layer: changed === 'layer' ? value : pair.layer, say: '' }) };
    const onX = { agg: 'score_mean', column: 'mean', layer: 'X' };
    assert.deepEqual(S.aggregationAfter(onX, 'method', 'fraction_of_total', choices),
        { agg: { agg: 'score_mean', column: 'fraction_of_total', layer: 'counts' }, say: 'Layer changed to counts: % of total is not available on X.' });
    assert.deepEqual(S.aggregationAfter(onX, 'layer', 'logged', choices).agg, { agg: 'score_mean', column: 'mean', layer: 'logged' });
    assert.equal(S.aggregationAfter({ agg: 'mean_of_means' }, 'method', 'sum'), null, 'a summary has no method');
});

// ------------------------------------------------------------------ old links (section 6)

/** Moments of one feature in G groups from per-group cell values, at threshold t. */
function momentsOf(groups, t) {
    const m = new Float64Array(groups.length * MOMENT_STRIDE);
    groups.forEach((cells, g) => {
        const o = g * MOMENT_STRIDE;
        for (const x of cells) {
            m[o] += 1; m[o + 1] += x; m[o + 2] += x * x;
            if (x > t) { m[o + 3] += 1; m[o + 4] += x; }
        }
    });
    return m;
}

test('golden link: a grouping with detect_above 1 draws "% expressing (> 1)", read from the grouping (decision 34)', () => {
    const link = golden('link_cell_gene_grouping_detect_above');
    const grouping = normalizeGrouping(link.grouping);
    assert.deepEqual(grouping.problems, [], 'the retired offered and layers load with no problem said');
    assert.equal(grouping.recipe.detect_above, 1, 'the grouping keeps its method parameter');
    const { config, problems } = S.normalizeCellGene(link.plot);
    assert.deepEqual(problems, []);
    assert.ok(!('offer' in config), 'the plot\'s own offer of WP-4 is read and dropped');
    assert.ok(!('detect_above' in config.size), 'nothing is copied into the plot');

    // the plot reads the grouping's threshold for a measure with none of its own, as the panel does (baseThreshold)
    const sections = config.sections.map((section) => ({ section, genes: ['G1', 'G2'], title: 'Sig', scoreRecipe: () => null }));
    const plan = S.planFeatures({ sections, color: config.color, size: config.size, threshold: grouping.recipe.detect_above });
    assert.ok(plan.features.every((f) => f.wire.detect_above === 1), 'every gene is read above 1');
    const cells = [[0, 0.5, 2, 3], [1, 1.5, 4, 0]];
    const by = new Map(plan.features.map((f) => [f.key, momentsOf(cells, f.wire.detect_above)]));
    const drawn = S.withGroupingThreshold(config, grouping.recipe.detect_above);
    assert.equal(drawn.size.detect_above, 1, 'drawn at the grouping\'s threshold');
    assert.equal(S.withGroupingThreshold(config, 0), config, 'nothing to fill at 0');
    assert.equal(S.withGroupingThreshold(drawn, 2), drawn, 'a measure\'s own threshold wins');
    const matrix = S.buildMatrix(plan, (key) => by.get(key) || null, [{ n: 4 }, { n: 4 }], drawn);
    assert.equal(matrix.size.detectAbove, 1);
    assert.deepEqual(Array.from(matrix.size.values.subarray(0, 2)), [50, 50], 'a cell counts as expressing above 1 (above 0 it would be 75, 75)');
    const fig = D.buildFigure({ mode: 'dots', groups: [{ label: 'a', n: 4 }, { label: 'b', n: 4 }], rows: matrix.rows,
        color: { ...matrix.color, colorscale: 'Viridis' }, size: matrix.size }, PLOT_PALETTES.light);
    assert.match(JSON.stringify(fig), /% expressing \(> 1\)/);
});
