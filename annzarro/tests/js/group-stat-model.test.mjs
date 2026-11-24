/**
 * The Gene Plot's statistic of a group (static/js/utils/group-stat-model.js, utils/cell-groups-client.js
 * createGenesApi; SO-8b): the setting a link carries, the statistics derived from the moments the route sends (equal to
 * the Cell-Gene Plot's, in units 0 to 1 for a fraction), the request body, the group reference's states, the graded
 * selects and the api's reading of the route's refusals.
 *
 * Run:  node --test annzarro/tests/js/group-stat-model.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../../../static/js/utils/group-stat-model.js');
const { statisticColumn } = await import('../../../static/js/utils/cell-gene-model.js');
const { resolveGroup, keepGroup } = await import('../../../static/js/utils/group-reference.js');
const { createGenesApi } = await import('../../../static/js/utils/cell-groups-client.js');
const { REASON } = await import('../../../static/js/utils/options-model.js');

const B = ['c:B cell'];
const setting = (extra = {}) => ({ type: 'group-stat', key: 'cell-grouping-A', column: M.columnOf(B), stat: 'mean', layer: 'logged',
    groupWas: ['B cell'], ...extra });

// five moments for four genes: n, sum, sumsq, n_above, sum_above
const MOMENTS = Float64Array.from([
    10, 20, 60, 8, 19,          // expressed in most cells
    10, 0, 0, 0, 0,             // never expressed: n_above 0
    0, 0, 0, 0, 0,              // no cell with a value: NaN
    4, 6, 10, 2, 5
]);

test('a setting survives a link: the group key, the statistic, the layer and the reference come back', () => {
    const back = JSON.parse(JSON.stringify(setting({ follow: true })));
    assert.deepEqual(back, setting({ follow: true }));
    assert.deepEqual(M.groupKeyOf(back), B);
    assert.equal(M.statOf(back), 'mean');
    assert.equal(M.layerOf(back), 'logged');
    assert.deepEqual(M.referenceOf(back), { group: B, groupWas: ['B cell'], follow: true });
    // a link that names no group, or a text that is not a key, names none
    assert.equal(M.groupKeyOf(setting({ column: '' })), null);
    assert.equal(M.groupKeyOf(setting({ column: 'not json' })), null);
    assert.equal(M.groupKeyOf(setting({ column: '"a"' })), null);
    assert.equal(M.referenceOf(setting({ column: '[]' })), null);
    // a statistic or layer a link lacks (or this page does not know) is the default
    assert.equal(M.statOf({}), 'mean');
    assert.equal(M.statOf({ stat: 'count' }), 'mean');
    assert.equal(M.layerOf({}), 'X');
    assert.equal(M.columnOf(['g:["c:T cell"]', 'c:ctrl']), '["g:[\\"c:T cell\\"]","c:ctrl"]', 'the canonical JSON of the key');
});

test('every statistic from the moments equals the Cell-Gene Plot\'s, in its units (% expressing is 0 to 100)', () => {
    for (const stat of M.STAT_IDS) {
        const want = statisticColumn(stat, MOMENTS, 4);
        const got = M.statValues(stat, MOMENTS, 4);
        for (let i = 0; i < 4; i++) {
            const expected = want[i];
            if (Number.isNaN(expected)) assert.ok(Number.isNaN(got[i]), `${stat} gene ${i} is missing`);
            else assert.equal(got[i], expected, `${stat} gene ${i}`);
        }
    }
    assert.deepEqual([...M.statValues('pct_expressing', MOMENTS, 4)].map((v) => (Number.isNaN(v) ? null : v)), [80, 0, null, 50]);
    assert.equal(M.statValues('mean', MOMENTS, 4)[0], 2);
    assert.equal(M.statValues('mean_expressing', MOMENTS, 4)[1], 0, 'cells but none expressing: 0, as the Cell-Gene Plot writes it');
    assert.throws(() => M.statValues('count', MOMENTS, 4), /unknown statistic/);
    assert.throws(() => M.statValues('mean', MOMENTS, 5), /five numbers/);
});

test('the request is the grouping\'s own with the group, the layer and the grouping\'s Expressed above', () => {
    const grouping = { shape: 'grouping', partitionings: [{ source: { type: 'obs', key: 'cell_type' } }], small: { threshold: 10, mode: 'keep' },
        subset: null, want: { codes: false, histograms: [] }, sets: { s0: { encoding: 'bitset-base64', length: 8, data: 'AQ==' } } };
    const body = M.genesRequest(grouping, B, 'logged', 0.5);
    assert.deepEqual(body, { shape: 'genes', partitionings: grouping.partitionings, small: grouping.small, group: B, layer: 'logged',
        thresholds: [0.5], sets: grouping.sets });
    assert.equal(M.genesRequest({ ...grouping, sets: undefined }, B, 'X', 0).sets, undefined);
    assert.equal(M.thresholdOf({}), 0);
    assert.equal(M.thresholdOf({ detect_above: 2 }), 2);
    // a change of statistic is no change of request; a change of the group, the layer or the threshold is
    const hash = (...a) => M.momentsHash('k', ...a);
    assert.equal(hash(B, 'logged', 0), hash(B, 'logged', 0));
    assert.notEqual(hash(B, 'logged', 0), hash(B, 'logged', 0.5));
    assert.notEqual(hash(B, 'logged', 0), hash(B, 'counts', 0));
    assert.notEqual(hash(B, 'logged', 0), hash(['c:T cell'], 'logged', 0));
});

test('a group is ok, changed (its default labels differ) or gone, as the group reference says', () => {
    const labelled = (labels) => ({ byKey: new Map(labels), separator: ' | ' });
    const ref = M.referenceOf(setting());
    const key = M.columnOf(B);
    assert.equal(resolveGroup(ref, labelled([[key, ['B cell']]]), new Map()).state, 'ok');
    const changed = resolveGroup(ref, labelled([[key, ['B lymphocyte']]]), new Map());
    assert.deepEqual([changed.state, changed.was, changed.now, changed.say], ['changed', 'B cell', 'B lymphocyte', true]);
    const gone = resolveGroup(ref, labelled([]), new Map());
    assert.deepEqual([gone.state, gone.was], ['gone', 'B cell']);
    // Keep: the labels now, following the key
    assert.deepEqual(keepGroup(ref, labelled([[key, ['B lymphocyte']]])), { group: B, groupWas: ['B lymphocyte'], follow: true });
    assert.equal(resolveGroup({ ...ref, groupWas: ['B lymphocyte'], follow: true }, labelled([[key, ['B lymphocyte']]]), new Map()).state, 'ok');
});

test('the statistic select lists every statistic but Cell count, graded on the layer; the layer select every layer', () => {
    const stat = M.statMenu(setting({ layer: 'X' }), { X: 'signed', logged: 'log' });
    assert.deepEqual(stat.options.map((o) => o.value), ['mean', 'pct_expressing', 'mean_expressing', 'sum', 'sd']);
    assert.equal(stat.chosen, 'mean');
    const byValue = Object.fromEntries(stat.options.map((o) => [o.value, o]));
    assert.equal(byValue.pct_expressing.disabled, true, '% expressing cannot be computed on a signed layer');
    assert.ok(byValue.pct_expressing.title.includes('negative values'));
    assert.equal(byValue.mean.disabled, false);
    const layers = M.layerMenu(setting({ stat: 'pct_expressing', layer: 'logged' }), { X: 'signed', logged: 'log' }, ['X', 'logged']);
    assert.deepEqual(layers.options.map((o) => [o.value, o.disabled]), [['X', true], ['logged', false]]);
    assert.equal(layers.chosen, 'logged');
    // a held impossible pair stays, marked
    assert.ok(M.statMenu(setting({ stat: 'pct_expressing', layer: 'X' }), { X: 'signed' }).options.find((o) => o.value === 'pct_expressing').text.includes('not available'));
});

test('the pair after a touch: the one touched wins, the other moves only when impossible, said once', () => {
    const kinds = { X: 'signed', logged: 'log' };
    const layers = ['X', 'logged'];
    const moved = M.pairAfter(setting({ layer: 'X' }), 'stat', 'pct_expressing', kinds, layers);
    assert.deepEqual([moved.stat, moved.layer], ['pct_expressing', 'logged']);
    assert.equal(moved.say, REASON.moved('Layer', 'logged', '% expressing', "'X'"));
    const kept = M.pairAfter(setting({ layer: 'logged' }), 'stat', 'sd', kinds, layers);
    assert.deepEqual([kept.stat, kept.layer, kept.say], ['sd', 'logged', '']);
    const layer = M.pairAfter(setting({ stat: 'pct_expressing', layer: 'logged' }), 'layer', 'X', kinds, layers);
    assert.notEqual(layer.stat, 'pct_expressing', 'the statistic moved off what X cannot give');
    assert.equal(layer.layer, 'X');
});

// ---------------------------------------------------------------------------------------------- the api

const refused = (reason, extra = {}) => ({ header: { type: 'result', refused: { reason, message: `m:${reason}`, estimate: { seconds: 90 }, ...extra }, reason }, values: {} });

test('the api states an estimate it cannot decide as auto, and the exact figure\'s tier from the stream', async () => {
    const groupsApi = {
        estimate: async () => ({ estimate: { tier: 'refused', seconds: 9999, coverage: { known: false } } }),
        compute: async () => refused('confirmation_required')
    };
    const api = createGenesApi(groupsApi);
    assert.equal((await api.estimate({})).estimate.tier, 'auto', 'a group not yet known: the whole layer is only an upper bound');
    assert.equal((await createGenesApi({ ...groupsApi, estimate: async () => ({ estimate: { tier: 'refused', coverage: { known: true } } }) }).estimate({})).estimate.tier, 'refused');
    await assert.rejects(api.compute({}), (e) => e.status === 409 && e.reason === 'confirmation_required' && e.estimate.seconds === 90);
    const tooBig = createGenesApi({ ...groupsApi, compute: async () => refused('groups_too_expensive') });
    await assert.rejects(tooBig.compute({}), (e) => e.status === 413 && e.reason === 'groups_too_expensive');
    // any other refusal is the result's (the store states it as refused with the reason)
    const other = await createGenesApi({ ...groupsApi, compute: async () => refused('too_many_groups') }).compute({});
    assert.equal(other.header.refused.reason, 'too_many_groups');
    const ok = await createGenesApi({ ...groupsApi, compute: async () => ({ header: { n_var: 4, n_shown: 100 }, values: { moments: MOMENTS } }) }).compute({});
    assert.equal(ok.values.moments, MOMENTS);
    assert.equal(ok.values.reply.n_shown, 100, 'the cells shown the store checks against the page\'s');
});
