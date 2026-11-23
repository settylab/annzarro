/**
 * What a Cell Grouping offers its consumers (static/js/utils/group-statistics.js, GRP-9, SHR-25 to SHR-27): the
 * statistics as a method table over the shared options model, the default layer X that is always offered, the grading of
 * a statistic on a layer from the matrix kind, the sentence of SHR-27 and a size that waits for a layer, and who uses
 * what, counted from consumer kinds.
 *
 * Run:  node --test annzarro/tests/js/group-statistics.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../../../static/js/utils/group-statistics.js');
const { VOCABULARY } = await import('../../../static/js/utils/vocabulary.js');
const { STATISTIC_IDS, normalizeGrouping } = await import('../../../static/js/utils/cell-grouping.js');

const SENTENCE = (stat, layer) => `${stat} is not available on ${layer}: ${layer} has negative values. Choose a layer.`;
const model = S.GROUP_STATISTICS_MODEL;

test('the table is the grouping\'s statistics, named by the vocabulary, with cell count outside it', () => {
    assert.deepEqual(S.STATISTIC_INFO.map(m => m.value), ['mean', 'pct_expressing', 'mean_expressing', 'sum', 'sd']);
    for (const info of S.STATISTIC_INFO) {
        assert.equal(info.label, VOCABULARY.cellGene.statistic[info.value], `${info.value} has the vocabulary's name`);
        assert.ok(STATISTIC_IDS.includes(info.value), `${info.value} is a statistic id of the recipe`);
        assert.ok(info.definition.length > 20 && info.unit);
    }
    assert.deepEqual(S.DEFAULT_STATISTICS, ['mean', 'pct_expressing']);
    assert.equal(S.ALWAYS_OFFERED, 'count');
});

test('a grouping with no offered fields offers mean and % expressing on X, and says so in one row', () => {
    assert.deepEqual(model.offeredMethods({}), ['mean', 'pct_expressing']);
    assert.deepEqual(model.offeredLayers({}), ['X']);
    assert.equal(model.inputOf({}), 'X', 'a grouping has no input; the default layer is X');
    assert.equal(model.offeredSummary({}), 'mean, % expressing · X');
    assert.equal(model.offeredSummary({ offered: ['mean', 'pct_expressing', 'sd'], layers: ['logged'] }), 'mean, % expressing, SD · X, logged');
    assert.equal(model.offeredSummaryShort({}), '2 methods · X');
    assert.equal(model.isDefaultOffer({}), true);
    assert.equal(model.isDefaultOffer({ offered: ['mean'] }), false);
    assert.deepEqual(model.defaultFields(), { offered: ['mean', 'pct_expressing'], layers: ['X'] });
});

test('X is always offered, whatever layers the recipe names', () => {
    assert.deepEqual(model.offeredLayers({ layers: ['logged'] }), ['X', 'logged']);
    assert.deepEqual(model.offeredLayers({ layers: ['counts', 'X', 'counts'] }), ['X', 'counts']);
    // a recipe that comes back from normalizeGrouping with these fields reads the same
    const { recipe } = normalizeGrouping({ version: 1, partitionings: [], layers: ['logged'], offered: ['sum'] });
    assert.deepEqual(model.offeredLayers(recipe), ['X', 'logged']);
    assert.deepEqual(model.offeredMethods(recipe), ['sum']);
});

test('the threshold is one field shared by % expressing and mean of expressing cells', () => {
    assert.deepEqual(model.usersOfParam('detect_above'), ['pct_expressing', 'mean_expressing']);
    assert.deepEqual(model.paramsOf({}, 'pct_expressing'), { detect_above: 0 });
    assert.deepEqual(model.paramsOf({ detect_above: 0.5 }, 'mean_expressing'), { detect_above: 0.5 });
    assert.deepEqual(model.paramsOf({ detect_above: 0.5 }, 'mean'), {});
    const r = { offered: ['mean', 'pct_expressing', 'mean_expressing'], detect_above: 0.5 };
    assert.equal(model.offeredSummary(r), 'mean, % expressing (above 0.5), mean of expressing cells (above 0.5) · X');
    assert.equal(model.isMethodDefault({ detect_above: 0.5 }, 'pct_expressing'), false);
    assert.equal(model.isMethodDefault({}, 'pct_expressing'), true);
});

test('every value of the threshold line names that value', () => {
    for (const t of [0, 0.1, 0.5, 1, 2.5, 10, 123]) {
        const line = S.thresholdLine({ detect_above: t });
        assert.ok(line.includes(`above ${t}`), `${t}: ${line}`);
        assert.ok(line.includes('% expressing') && line.includes('mean of expressing cells'), 'it names the statistics that use it');
    }
    assert.ok(S.thresholdLine({}).includes('above 0'), 'no threshold reads as 0');
});

test('on a signed X, % expressing and mean of expressing cells cannot be computed, with the sentence of SHR-27', () => {
    const kinds = { X: 'signed' };
    const all = { offered: ['mean', 'pct_expressing', 'mean_expressing', 'sum', 'sd'] };
    const graded = model.gradedOptions(all, ['X'], kinds);
    const by = Object.fromEntries(graded.map(o => [o.method, o]));
    assert.equal(by.pct_expressing.grade, 'cannot');
    assert.equal(by.pct_expressing.reason, SENTENCE('% expressing', 'X'));
    assert.equal(by.mean_expressing.grade, 'cannot');
    assert.equal(by.mean_expressing.reason, SENTENCE('Mean of expressing cells', 'X'));
    for (const m of ['mean', 'sum', 'sd']) assert.equal(by[m].grade, 'ok', `${m} is fine on a signed layer`);
    assert.deepEqual(model.offeredOptions(all, ['X'], kinds).map(o => o.method), ['mean', 'sum', 'sd'], 'menus leave them out');
    assert.equal(S.statisticGrade('pct_expressing', 'X', 'signed').code, 'negative_values');
    assert.equal(S.statisticGrade('pct_expressing', 'X', 'log').grade, 'ok');
    assert.equal(S.statisticGrade('pct_expressing', 'X', undefined).grade, 'ok', 'an unknown kind is not guessed');
});

test('the sentence names the layer in force, for every layer name', () => {
    for (const layer of ['X', 'logged_counts', 'raw_counts', 'a b', 'scaled.2']) {
        assert.equal(S.statisticGrade('pct_expressing', layer, 'signed').reason, SENTENCE('% expressing', layer));
        assert.equal(S.statisticGrade('mean_expressing', layer, 'signed').reason, SENTENCE('Mean of expressing cells', layer));
        assert.equal(S.negativeValuesSentence('pct_expressing', layer), SENTENCE('% expressing', layer));
    }
});

test('the layer row says which statistics are not available on it, once', () => {
    const lines = model.layerLines('X', {}, 'signed', undefined);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].grade, 'cannot');
    assert.equal(lines[0].text, '% expressing and mean of expressing cells are not available on X: X has negative values.');
    assert.deepEqual(model.layerLines('X', { offered: ['mean', 'sum'] }, 'signed'), [], 'nothing offered is affected');
    assert.deepEqual(model.layerLines('logged', {}, 'log'), []);
});

test('mean, sum and SD on raw counts and a sum on a log layer warn, in one line each, and are offered', () => {
    const all = { offered: ['mean', 'pct_expressing', 'mean_expressing', 'sum', 'sd'], layers: ['counts', 'logged'] };
    const kinds = { X: 'log', counts: 'counts', logged: 'log' };
    const graded = model.gradedOptions(all, ['X', 'counts', 'logged'], kinds);
    const at = (m, l) => graded.find(o => o.method === m && o.layer === l);
    for (const m of ['mean', 'sum', 'sd']) {
        assert.equal(at(m, 'counts').grade, 'warn', `${m} on counts`);
        assert.equal(at(m, 'counts').code, 'depth');
        assert.match(at(m, 'counts').reason, /sequencing depth/);
        assert.equal(at(m, 'counts').note, at(m, 'counts').reason, 'a warning is a title, not a notice');
    }
    for (const m of ['pct_expressing', 'mean_expressing']) assert.equal(at(m, 'counts').grade, 'ok');
    assert.equal(at('sum', 'logged').grade, 'warn');
    assert.equal(at('sum', 'logged').code, 'log');
    assert.equal(at('mean', 'logged').grade, 'ok');
    assert.equal(model.offeredOptions(all, ['X', 'counts', 'logged'], kinds).length, graded.length, 'warnings stay in the menus');
    assert.equal(model.layerLines('counts', all, 'counts', undefined)[0].code, 'depth');
});

test('with several offered layers, a method names the signed one on its layer only', () => {
    const r = { offered: ['pct_expressing'], layers: ['logged'] };
    const kinds = { X: 'signed', logged: 'log' };
    const options = model.offeredOptions(r, ['X', 'logged'], kinds);
    assert.deepEqual(options.map(o => o.id), ['pct_expressing@logged']);
    assert.deepEqual(model.methodLines('pct_expressing', ['X', 'logged'], r, kinds), [], 'said on the layer\'s row, not under the method');
    assert.equal(model.gradedOptions(r, ['X', 'logged'], kinds).find(o => o.layer === 'X').reason, SENTENCE('% expressing', 'X'));
});

test('a size waits for a layer on a signed X: no statistic, the sentence, until another layer is picked', () => {
    const r = {};
    assert.deepEqual(S.sizeDefault(r, { X: 'signed' }), { stat: null, layer: null, say: SENTENCE('% expressing', 'X'), pending: false });
    assert.deepEqual(S.sizeDefault(r, { X: 'log' }), { stat: 'pct_expressing', layer: 'X', say: '', pending: false });
    assert.deepEqual(S.sizeDefault(r, {}), { stat: null, layer: 'X', say: '', pending: true }, 'a kind not known yet draws nothing and says nothing');
    // picking a layer the grouping offers gives the size
    const offered = { layers: ['logged'] };
    const kinds = { X: 'signed', logged: 'log' };
    assert.equal(S.sizeDefault(offered, kinds).stat, null, 'the first offered layer is still X');
    assert.deepEqual(S.sizeDefault(offered, kinds, 'logged'), { stat: 'pct_expressing', layer: 'logged', say: '', pending: false });
    // no layer is gated (decision 31): one whose kind is not known yet waits, whatever the recipe stored
    assert.deepEqual(S.sizeDefault(offered, kinds, 'nowhere'), { stat: null, layer: 'nowhere', say: '', pending: true });
    assert.deepEqual(S.sizeDefault({ offered: ['mean'] }, kinds, 'logged'), { stat: 'pct_expressing', layer: 'logged', say: '', pending: false });
});

test('"used by" counts consumers by kind, per statistic and per layer, and viewers not at all', () => {
    const handles = [
        { kind: 'plot', option: { statistics: [{ stat: 'mean', layer: 'X' }, { stat: 'pct_expressing', layer: 'X' }] } },
        { kind: 'plot', option: { statistics: [{ stat: 'mean', layer: 'X' }] } },
        { kind: 'table', option: { statistics: [{ stat: 'mean', layer: 'logged' }] } },
        { kind: 'inspect', option: { statistics: [{ stat: 'mean', layer: 'X' }] } },
        { kind: 'grouping', option: { codes: true } },
        { kind: 'plot', option: { statistics: [{ stat: 'mean', layer: 'X' }, { stat: 'mean', layer: 'X' }] } }
    ];
    const use = S.statisticUsage(handles);
    const stat = (v) => use.statistics.find(r => r.value === v);
    assert.deepEqual([stat('mean').plots, stat('mean').tables], [3, 1], 'a consumer counts once for a statistic however often it reads it');
    assert.deepEqual([stat('pct_expressing').plots, stat('pct_expressing').tables], [1, 0]);
    assert.equal(stat('sum'), undefined);
    const layer = (v) => use.layers.find(r => r.value === v);
    assert.deepEqual([layer('X').plots, layer('X').tables], [3, 0]);
    assert.deepEqual([layer('logged').plots, layer('logged').tables], [0, 1]);
    assert.throws(() => S.statisticUsage([{ kind: 'dial', option: { statistics: [] } }]), /Unknown consumer kind/);
    assert.deepEqual(S.statisticUsage([]), { statistics: [], layers: [] });
    // a consumer of codes only reads no statistic
    assert.deepEqual(S.statisticUsage([{ kind: 'plot', option: { codes: true } }]), { statistics: [], layers: [] });
});

test('a section edit becomes a recipe edit that keeps a default grouping\'s recipe unchanged', () => {
    const patch = (p) => S.recipePatch(p);
    assert.deepEqual(patch({ offered: ['mean', 'pct_expressing'] }), { offered: undefined }, 'the default list is not stored');
    assert.deepEqual(patch({ offered: ['mean', 'sum'] }), { offered: ['mean', 'sum'] });
    assert.deepEqual(patch({ layers: ['X'], input: 'X' }), { layers: undefined }, 'X is implied and `input` is not a field of a grouping');
    assert.deepEqual(patch({ layers: ['X', 'logged'], input: 'X' }), { layers: ['logged'] });
    assert.deepEqual(patch({ detect_above: 0 }), { detect_above: undefined });
    assert.deepEqual(patch({ detect_above: 0.5 }), { detect_above: 0.5 });
    assert.deepEqual(patch({ method: 'mean', offered: ['mean'] }), { offered: ['mean'] }, 'there is no `method` either');
    // a full reset, as the section sends it
    assert.deepEqual(patch({ detect_above: 0, offered: ['mean', 'pct_expressing'], layers: ['X'] }),
        { detect_above: undefined, offered: undefined, layers: undefined });
    // every result is accepted by the recipe's own normaliser with no problem
    for (const p of [{ offered: ['sum'] }, { layers: ['X', 'logged'] }, { detect_above: 2 }]) {
        const next = { version: 1, partitionings: [] };
        for (const [k, v] of Object.entries(patch(p))) if (v !== undefined) next[k] = v;
        assert.deepEqual(normalizeGrouping(next).problems, []);
    }
});

test('the summary of the collapsed row is a function of the recipe alone', () => {
    // the scaling test: no work grows with groups or levels, so the row costs the same at any size
    const recipe = { offered: ['mean', 'pct_expressing', 'sum'], layers: ['logged'], detect_above: 1 };
    const t0 = performance.now();
    for (let i = 0; i < 20000; i++) model.offeredSummary(recipe);
    assert.ok(performance.now() - t0 < 1500);
});
