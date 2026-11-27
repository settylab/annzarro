/**
 * SO-7 of decision 34: Methods ▾ on the Cell Grouping and the Cell Table (offered-removal-080.md 10.2).
 *
 * - The parameters of the statistics are one table (METHOD_PARAMS): Expressed above, used by Fraction of cells and mean of
 *   expressing cells, listed after the last of them.
 * - A grouping's Methods fields round-trip through its recipe (omitted at 0, outside the grouping's hash); a Cell
 *   Table's through its configuration's `methods` (omitted at default).
 * - A Cell-Gene measure with no threshold of its own plans its features at the grouping's value; with one stored, at
 *   that one. Its box is an override: empty while it follows the grouping, which its model names.
 * - A new plot's Size stores no threshold, so it follows the grouping.
 *
 * Run:  node --test annzarro/tests/js/cell-methods.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const G = await import('../../../static/js/utils/group-statistics.js');
const { normalizeGrouping, groupingHasher } = await import('../../../static/js/utils/cell-grouping.js');
const S = await import('../../../static/js/panels/cell-gene/sections.js');
const C = await import('../../../static/js/panels/cell-gene/controls.js');
const { VOCABULARY } = await import('../../../static/js/utils/vocabulary.js');

const OBS = { type: 'obs', key: 'cell_type' };
const roundTrip = (x) => JSON.parse(JSON.stringify(x));

test('the parameter table holds Expressed above, used by the two thresholded statistics and listed after the last', () => {
    assert.deepEqual(G.METHOD_PARAMS.map((p) => p.key), ['detect_above']);
    const [t] = G.METHOD_PARAMS;
    assert.equal(t.label, 'Expressed above');
    assert.equal(t.default, 0);
    assert.deepEqual(t.users, ['fraction_of_cells', 'mean_expressing']);
    assert.equal(t.after, 'mean_expressing');
    assert.ok(G.STATISTIC_INFO.some((m) => m.value === t.after), 'listed under a statistic of the table');
    assert.equal(t.line({ detect_above: 2 }), 'Used by fraction of cells and mean of expressing cells. Now: above 2.');
    assert.equal(t.line({}), 'Used by fraction of cells and mean of expressing cells. Now: above 0.');
});

test('a grouping\'s Methods fields round-trip through its recipe, omitted at 0 and outside its hash', () => {
    const raw = { version: 1, partitionings: [{ source: OBS }], detect_above: 2 };
    const { recipe, problems } = normalizeGrouping(raw);
    assert.deepEqual(problems, []);
    assert.equal(recipe.detect_above, 2);
    const again = normalizeGrouping(roundTrip(recipe)).recipe;
    assert.deepEqual(again, recipe, 'a link of the recipe reads the same');
    // Methods ▾ writes through setFields: undefined (Reset, or 0 typed) takes the field out
    const reset = normalizeGrouping({ ...recipe, detect_above: 0 }).recipe;
    assert.ok(!('detect_above' in reset), 'omitted at its default');
    const hash = groupingHasher(recipe);
    assert.equal(hash(recipe), hash(reset), 'the groups do not change with Expressed above');
    assert.equal(G.methodsSummary(recipe), 'expressed above 2');
    assert.equal(G.methodsSummary(reset), '');
});

test('a Cell Table\'s Methods fields round-trip through its configuration, omitted at default', () => {
    assert.deepEqual(G.cleanMethods({ detect_above: 2 }), { detect_above: 2 });
    assert.deepEqual(G.cleanMethods(roundTrip({ detect_above: 0.25 })), { detect_above: 0.25 });
    for (const bad of [undefined, null, [], 'x', { detect_above: 0 }, { detect_above: -1 }, { detect_above: 'two' }, { detect_above: NaN }]) {
        assert.deepEqual(G.cleanMethods(bad), {}, `${JSON.stringify(bad)} is the default`);
    }
    assert.deepEqual(G.cleanMethods({ detect_above: 1, other: 3 }), { detect_above: 1 }, 'only known parameters are kept');
});

test('"Used by" names each reading panel with the statistics and layers it reads; viewers are not users', () => {
    const handles = [
        { kind: 'plot', panelId: 'cg1', option: { statistics: [{ stat: 'fraction_of_cells', layer: 'counts' }, { stat: 'mean', layer: 'logged' }, { stat: 'count' }] } },
        { kind: 'plot', panelId: 'cg1', option: { statistics: [{ stat: 'fraction_of_cells', layer: 'counts' }] } },
        { kind: 'inspect', panelId: 'grp', option: { statistics: [{ stat: 'mean', layer: 'X' }] } },
        { kind: 'plot', panelId: 'cp2', option: {} }
    ];
    const titles = { cg1: 'Cell-Gene Plot 1', cp2: 'Cell Count Plot 2' };
    assert.deepEqual(G.methodsUsedBy(handles, (id) => titles[id] || ''),
        ['Cell-Gene Plot 1 (fraction of cells · counts, mean · logged, cell count)', 'Cell Count Plot 2']);
    assert.deepEqual(G.methodsUsedBy([], () => ''), []);
});

test('a measure with no threshold of its own plans at the grouping\'s value; with one stored, at that one', () => {
    const sections = [{ section: { source: 's1', rows: 'genes' }, genes: ['G1', 'G2'], title: 'Sig', scoreRecipe: () => null }];
    const color = { stat: 'mean', layer: 'logged' };
    const follows = S.planFeatures({ sections, color, size: { stat: 'fraction_of_cells', layer: 'counts' }, threshold: 2 });
    const counts = (plan) => plan.features.filter((f) => f.wire.layer === 'counts').map((f) => f.wire.detect_above);
    assert.deepEqual(counts(follows), [2, 2]);
    const own = S.planFeatures({ sections, color, size: { stat: 'fraction_of_cells', layer: 'counts', detect_above: 0.5 }, threshold: 2 });
    assert.deepEqual(counts(own), [0.5, 0.5], 'the override wins');
    const drawn = S.withGroupingThreshold({ color, size: { stat: 'fraction_of_cells', layer: 'counts' } }, 2);
    assert.equal(drawn.size.detect_above, 2, 'the legend names the threshold in force');
});

test('the override box\'s model: empty while it follows the grouping, which it names; the wording is the vocabulary\'s', () => {
    const base = { datasetLayers: ['X', 'counts'], kinds: { X: 'signed', counts: 'counts' } };
    const follows = C.measureModel({ ...base, spec: { stat: 'fraction_of_cells', layer: 'counts' }, threshold: 1, grouping: { title: 'Grouping 1', value: 1 } });
    assert.equal(follows.threshold, 1);
    assert.equal(follows.own, null);
    assert.deepEqual(follows.grouping, { title: 'Grouping 1', value: 1 });
    const own = C.measureModel({ ...base, spec: { stat: 'fraction_of_cells', layer: 'counts', detect_above: 3 }, threshold: 3, grouping: { title: 'Grouping 1', value: 1 } });
    assert.equal(own.own, 3);
    const obs = C.measureModel({ ...base, spec: { stat: 'fraction_of_cells', layer: 'counts' }, threshold: 0 });
    assert.equal(obs.grouping, null, 'an obs axis has no grouping to follow');
    const W = VOCABULARY.cellGene.sources;
    assert.equal(W.thresholdAuto(1), 'auto (grouping: 1)');
    assert.equal(W.thresholdOverrides('Grouping 1', 0), 'Overrides Grouping 1 (above 0). Clear to follow it.');
});

test('a new plot\'s Size stores no threshold: it follows the grouping (decision 35)', () => {
    const m = G.defaultMeasures(['X', 'logged', 'counts'], { X: 'signed', logged: 'log', counts: 'counts' });
    assert.deepEqual(m.size, { stat: 'fraction_of_cells', layer: 'counts' });
    assert.ok(!('detect_above' in m.color));
});
