/**
 * The per-group statistics (static/js/utils/group-statistics.js, SHR-25 to SHR-27, decision 31): the statistics as a
 * method table over the shared options model, the grading of a statistic on a layer from the matrix kind (every
 * statistic on every layer, an impossible pair disabled with the sentence of SHR-27), a size that waits for a layer,
 * and who uses what, counted from consumer kinds.
 *
 * Run:  node --test annzarro/tests/js/group-statistics.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../../../static/js/utils/group-statistics.js');
const { VOCABULARY } = await import('../../../static/js/utils/vocabulary.js');
const { STATISTIC_IDS } = await import('../../../static/js/utils/cell-grouping.js');

const SENTENCE = (stat, layer) => `${stat} cannot be computed on '${layer}': it has negative values. Choose a layer.`;
const model = S.GROUP_STATISTICS_MODEL;

test('the table is the grouping\'s statistics, named by the vocabulary, with cell count outside it', () => {
    assert.deepEqual(S.STATISTIC_INFO.map(m => m.value), ['zscore_mean', 'mean', 'pct_expressing', 'mean_expressing', 'sum', 'sd']);
    for (const info of S.STATISTIC_INFO) {
        assert.equal(info.label, VOCABULARY.cellGene.statistic[info.value], `${info.value} has the vocabulary's name`);
        assert.ok(STATISTIC_IDS.includes(info.value), `${info.value} is a statistic id of the recipe`);
        assert.ok(info.definition.length > 20 && info.unit);
    }
    assert.deepEqual(S.DEFAULT_STATISTICS, ['mean', 'pct_expressing']);
    assert.equal(S.CELL_COUNT, 'count');
});

test('the threshold is one field shared by % expressing and mean of expressing cells', () => {
    assert.deepEqual(model.paramsOf({}, 'pct_expressing'), { detect_above: 0 });
    assert.deepEqual(model.paramsOf({ detect_above: 0.5 }, 'mean_expressing'), { detect_above: 0.5 });
    assert.deepEqual(model.paramsOf({ detect_above: 0.5 }, 'mean'), {});
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
    const choices = S.statisticChoices({ layer: 'X', kinds });
    const by = Object.fromEntries(choices.map(o => [o.value, o]));
    assert.equal(by.pct_expressing.grade, 'cannot');
    assert.equal(by.pct_expressing.reason, SENTENCE('% expressing', 'X'));
    assert.equal(by.pct_expressing.title, SENTENCE('% expressing', 'X'), 'the reason is the option\'s title');
    assert.equal(by.mean_expressing.grade, 'cannot');
    assert.equal(by.mean_expressing.reason, SENTENCE('Mean of expressing cells', 'X'));
    for (const m of ['mean', 'sum', 'sd']) assert.equal(by[m].grade, 'ok', `${m} is fine on a signed layer`);
    assert.deepEqual(choices.filter(o => o.disabled).map(o => o.value), ['pct_expressing', 'mean_expressing'], 'listed, and disabled');
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

test('mean, sum and SD on raw counts and a sum on a log layer warn, each with its note, and stay usable', () => {
    const kinds = { X: 'log', counts: 'counts', logged: 'log' };
    const at = (m, l) => S.statisticChoices({ layer: l, kinds }).find(o => o.value === m);
    for (const m of ['mean', 'sum', 'sd']) {
        assert.equal(at(m, 'counts').grade, 'warn', `${m} on counts`);
        assert.equal(at(m, 'counts').code, 'depth');
        assert.equal(at(m, 'counts').reason, `${VOCABULARY.cellGene.statistic[m]} on 'counts' follows sequencing depth.`);
        assert.equal(at(m, 'counts').note, at(m, 'counts').reason, 'a warning is a title, not a notice');
    }
    for (const m of ['pct_expressing', 'mean_expressing']) assert.equal(at(m, 'counts').grade, 'ok');
    assert.equal(at('sum', 'logged').grade, 'warn');
    assert.equal(at('sum', 'logged').code, 'log');
    assert.equal(at('mean', 'logged').grade, 'ok');
    assert.equal(at('sum', 'logged').reason, "Sum on 'logged' is a sum of log values, not a total of the counts: it is usually read from counts.");
    assert.ok(['counts', 'logged'].every(l => S.statisticChoices({ layer: l, kinds }).every(o => !o.disabled)), 'warnings stay usable');
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
