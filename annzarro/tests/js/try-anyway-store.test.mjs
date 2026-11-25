/**
 * "Try anyway" in the stores (aggregation-unify-080.md 14): a time-refused estimate the server says may be tried is
 * run only when asked for (accept, or the panel's tick), always with `force`; a size refusal never is; a tried run the
 * server stops at its deadline is the state `stopped`; the panel's tick (utils/ask-policy.js) skips the question.
 *
 * Run:  node --test annzarro/tests/js/try-anyway-store.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../../../static/js/utils/score-store.js');
const { createAskPolicy, askPolicy } = await import('../../../static/js/utils/ask-policy.js');

const settle = () => new Promise(resolve => setTimeout(resolve, 5));
const TRY = { allowed: true, max_s: 1800, why: null };

function fakeApi({ tier = 'refused', seconds = 3000, tried = TRY } = {}) {
    const calls = { compute: [] };
    const waiting = [];
    return {
        calls, waiting,
        api: {
            async estimate() { return { estimate: { seconds, tier, auto_max_s: 60, max_s: 600, live_max_s: 5, try: tried } }; },
            compute(req) {
                calls.compute.push(req);
                return new Promise((resolve, reject) => {
                    waiting.push({ resolve, reject });
                    req.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
                });
            }
        }
    };
}
const spec = (hash) => ({ recipe: { genes: ['A'], down: [] }, dataset: 'd.zarr', subset: null, hash });
const owner = (panelId = 'p1') => ({ visible: () => true, panelId });
const keyOf = (hash) => S.scoreKey({ hash, dataset: 'd.zarr', subset: null });

test.afterEach(() => askPolicy.clearAll());

test('a time refusal that may be tried waits, and nothing is sent', async () => {
    const f = fakeApi();
    const store = S.createScoreStore({ api: f.api });
    const snap = store.attach(keyOf('h'), spec('h'), owner());
    await settle();
    assert.equal(store.snapshot(keyOf('h')).state, 'refused');
    assert.equal(store.snapshot(keyOf('h')).estimate.try.allowed, true);
    assert.equal(f.calls.compute.length, 0);
    assert.ok(snap);
});

test('accept on a refused estimate that may be tried sends force and confirm', async () => {
    const f = fakeApi();
    const store = S.createScoreStore({ api: f.api });
    const k = keyOf('h');
    store.attach(k, spec('h'), owner());
    await settle();
    assert.equal(store.accept(k), true);
    await settle();
    assert.equal(f.calls.compute.length, 1);
    assert.equal(f.calls.compute[0].force, true);
    assert.equal(f.calls.compute[0].confirm, true);
    assert.equal(store.snapshot(k).forced, true);
});

test('accept on a refusal that may not be tried does nothing', async () => {
    const f = fakeApi({ tried: { allowed: false, max_s: 1800, why: 'too_long' } });
    const store = S.createScoreStore({ api: f.api });
    const k = keyOf('h');
    store.attach(k, spec('h'), owner());
    await settle();
    assert.equal(store.accept(k), false);
    await settle();
    assert.equal(f.calls.compute.length, 0);
    assert.equal(store.snapshot(k).state, 'refused');
});

test('an ordinary confirm run does not send force', async () => {
    const f = fakeApi({ tier: 'confirm', seconds: 200 });
    const store = S.createScoreStore({ api: f.api });
    const k = keyOf('h');
    store.attach(k, spec('h'), owner());
    await settle();
    assert.equal(store.snapshot(k).state, 'awaiting');
    store.accept(k);
    await settle();
    assert.equal(f.calls.compute[0].force, false);
    assert.equal(f.calls.compute[0].confirm, true);
});

test('the server ending a tried run at its deadline is the state stopped, with the limit', async () => {
    const f = fakeApi();
    const store = S.createScoreStore({ api: f.api });
    const k = keyOf('h');
    store.attach(k, spec('h'), owner());
    await settle();
    store.accept(k);
    await settle();
    f.waiting[0].reject(Object.assign(new Error('The run reached its limit.'), { reason: 'try_time_exceeded', limit_s: 1800 }));
    await settle();
    const snap = store.snapshot(k);
    assert.equal(snap.state, 'stopped');
    assert.equal(snap.reason, 'try_time_exceeded');
    assert.ok(S.SETTLED.includes('stopped'));
});

test("a panel's 'confirm' tick skips the question; its 'try' tick also runs a refused estimate; no tick asks", async () => {
    const confirm = fakeApi({ tier: 'confirm', seconds: 200 });
    askPolicy.set('p1', 'confirm');
    const a = S.createScoreStore({ api: confirm.api });
    a.attach(keyOf('c'), spec('c'), owner('p1'));
    await settle();
    assert.equal(confirm.calls.compute.length, 1);
    assert.equal(confirm.calls.compute[0].force, false);
    assert.equal(a.snapshot(keyOf('c')).unasked, true);

    // 'confirm' does not run a refused tier
    const refused = fakeApi();
    const b = S.createScoreStore({ api: refused.api });
    b.attach(keyOf('r'), spec('r'), owner('p1'));
    await settle();
    assert.equal(refused.calls.compute.length, 0);
    assert.equal(b.snapshot(keyOf('r')).state, 'refused');

    // 'try' does, and says so
    askPolicy.set('p1', 'try');
    await settle();
    b.poke();
    await settle();
    assert.equal(refused.calls.compute.length, 1);
    assert.equal(refused.calls.compute[0].force, true);
    assert.equal(b.snapshot(keyOf('r')).unasked, true);

    // another panel without a tick still asks
    const other = fakeApi({ tier: 'confirm', seconds: 200 });
    const c = S.createScoreStore({ api: other.api });
    c.attach(keyOf('o'), spec('o'), owner('p2'));
    await settle();
    assert.equal(c.snapshot(keyOf('o')).state, 'awaiting');
    assert.equal(other.calls.compute.length, 0);
});

test("a 'try' tick never runs what may not be tried (a size or an over-ten-times refusal)", async () => {
    askPolicy.set('p1', 'try');
    const f = fakeApi({ tried: { allowed: false, max_s: 1800, why: 'too_long' } });
    const store = S.createScoreStore({ api: f.api });
    store.attach(keyOf('h'), spec('h'), owner('p1'));
    await settle();
    store.poke();
    await settle();
    assert.equal(f.calls.compute.length, 0);
    assert.equal(store.snapshot(keyOf('h')).state, 'refused');
});

test('the policy: levels, covers, one panel at a time, listeners, clear on a dataset change', () => {
    const p = createAskPolicy();
    let told = 0;
    p.onChange(() => { told++; });
    assert.equal(p.get('a'), null);
    p.set('a', 'confirm');
    assert.equal(p.covers('a', 'confirm'), true);
    assert.equal(p.covers('a', 'try'), false);
    p.set('a', 'try');
    assert.equal(p.covers('a', 'confirm'), true);
    assert.equal(p.get('b'), null);
    assert.throws(() => p.set('a', 'always'));
    p.clear('a');
    assert.equal(p.get('a'), null);
    p.set('a', 'try'); p.set('b', 'confirm');
    p.clearAll();
    assert.deepEqual(p.panels(), []);
    assert.ok(told >= 4);
});
