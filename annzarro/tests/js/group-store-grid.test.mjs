/**
 * C2a: a count plot's grid through the group store (static/js/utils/group-store.js). A grid has no codes to want, and
 * the route refuses a field a shape does not take (`unknown_field`), so a grid request is sent, and estimated, with no
 * `want`; a grouping's still says what it wants back.
 *
 * Run:  node --test annzarro/tests/js/group-store-grid.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../../../static/js/utils/group-store.js');
const { createLimiter } = await import('../../../static/js/utils/derived-store.js');

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function world() {
    const calls = { estimate: [], compute: [] };
    const api = {
        async estimate({ recipe }) { calls.estimate.push(recipe); return { estimate: { seconds: 0.1, tier: 'live', live_max_s: 5, auto_max_s: 60, max_s: 600 } }; },
        compute(req) { calls.compute.push(req.recipe); return new Promise(() => {}); }
    };
    const store = S.createGroupStore({ api, limiter: createLimiter(2), codes: { hold() {}, pin() {}, release() {} } });
    const consume = (need) => store.attach(`${need.hash}\u0001d\u0001`, { recipe: need, dataset: 'd', subset: null, hash: need.hash }, { visible: () => true });
    return { calls, consume };
}

test('a grid is estimated and sent with no want; a grouping still says what it wants', async () => {
    const w = world();
    const grid = { shape: 'grid', mode: 'categorical', partitionings: [{ source: { type: 'obs', key: 'cell_type' } }], subset: null };
    w.consume(S.groupNeed({ request: grid, key: 'grid1' }));
    await settle();
    assert.ok(w.calls.estimate.length && w.calls.compute.length, JSON.stringify(w.calls));
    for (const sent of [...w.calls.estimate, ...w.calls.compute]) {
        assert.ok(!('want' in sent), JSON.stringify(sent));
        assert.equal(sent.shape, 'grid');
    }
    const grouping = { shape: 'grouping', partitionings: [{ source: { type: 'obs', key: 'condition' } }], small: { threshold: 10, mode: 'keep' },
        subset: null, want: { codes: false, histograms: [] } };
    w.consume(S.groupNeed({ request: grouping, key: 'g1', codes: true }));
    await settle();
    const last = w.calls.compute[w.calls.compute.length - 1];
    assert.deepEqual(last.want, { codes: true, histograms: [] });
});
