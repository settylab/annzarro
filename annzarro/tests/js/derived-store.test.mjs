/**
 * The generic derived-value store (static/js/utils/derived-store.js): the
 * byte-budget cache, jobs, estimate, tiers and states of score-store.js made
 * independent of what a value is. These tests use a second kind of value (a
 * grouping's codes plus moments: mixed typed arrays) and check that the page's
 * one limiter is shared by stores of different kinds.
 *
 * Run:  node --test annzarro/tests/js/derived-store.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const D = await import('../../../static/js/utils/derived-store.js');

const settle = () => new Promise(resolve => setTimeout(resolve, 5));

/** A fake grouping server: every compute waits for `finish(i)`. */
function fakeApi({ tier = 'auto' } = {}) {
    const calls = { estimate: [], compute: [] };
    const waiting = [];
    return {
        calls,
        api: {
            async estimate(req) {
                calls.estimate.push(req);
                return { estimate: { seconds: 1, tier, auto_max_s: 60, max_s: 600 } };
            },
            compute(req) {
                calls.compute.push(req);
                return new Promise((resolve, reject) => {
                    waiting.push({ req, resolve, reject });
                    req.signal.addEventListener('abort', () =>
                        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
                });
            }
        },
        finish(i, values, header = {}) { waiting[i].resolve({ header, values }); },
        fail(i, error) { waiting[i].reject(error); }
    };
}

/** codes (Uint32, 4 bytes a cell) plus moments (Float64, 8 bytes a value) plus plain level names. */
const grouping = (cells, moments = 2) => ({
    codes: new Uint32Array(cells),
    moments: new Float64Array(moments),
    levels: ['a', 'b']
});
const spec = (hash, extra = {}) => ({ recipe: { hash }, dataset: 'd', subset: null, hash, ...extra });
const owner = () => ({ visible: () => true });

test('bytesOf counts every typed array of a mixed value, and nothing else', () => {
    assert.equal(D.bytesOf(new Float32Array(10)), 40);
    assert.equal(D.bytesOf(grouping(100, 3)), 400 + 24);
    assert.equal(D.bytesOf({ a: [new Uint8Array(5), new Int16Array(2)], b: 'text' }), 9);
    assert.equal(D.bytesOf(null), 0);
});

test('a store of mixed values keeps them whole and evicts by their total bytes', async () => {
    const fake = fakeApi();
    const store = D.createDerivedStore({ api: fake.api, budget: 1000 });
    const o = owner();
    for (const [i, name] of ['k1', 'k2', 'k3'].entries()) {
        store.attach(name, spec(name), o);
        await settle();
        fake.finish(i, grouping(100, 2));       // 416 bytes each
        await settle();
    }
    assert.equal(store.snapshot('k3').state, 'ready');
    assert.ok(store.snapshot('k3').values.codes instanceof Uint32Array);
    assert.ok(store.snapshot('k3').values.moments instanceof Float64Array);
    assert.deepEqual(store.snapshot('k3').values.levels, ['a', 'b']);
    assert.ok(store.cache.bytes <= 1000);
    assert.equal(store.cache.size, 2);
    assert.equal(store.cache.has('k1'), false);
    assert.equal(store.stats().evictions, 1);
});

test('a value larger than the whole budget is handed to the draw and not stored', async () => {
    const fake = fakeApi();
    const store = D.createDerivedStore({ api: fake.api, budget: 100 });
    store.attach('big', spec('big'), owner());
    await settle();
    fake.finish(0, grouping(1000));
    await settle();
    assert.equal(store.snapshot('big').state, 'ready');
    assert.equal(store.cache.size, 0);
});

test('one request for however many dependants, and the last one leaving aborts it', async () => {
    const fake = fakeApi();
    const store = D.createDerivedStore({ api: fake.api });
    const a = owner();
    const b = owner();
    store.attach('k', spec('k'), a);
    store.attach('k', spec('k'), b);
    await settle();
    assert.equal(fake.calls.compute.length, 1);
    store.detach('k', a);
    assert.equal(fake.calls.compute[0].signal.aborted, false);
    store.detach('k', b);
    assert.equal(fake.calls.compute[0].signal.aborted, true);
});

test('an empty value settles as noscore with the store\'s own wording', async () => {
    const fake = fakeApi();
    const store = D.createDerivedStore({
        api: fake.api, isEmpty: (out) => !out.values.codes.length, emptyMessage: 'No groups could be made.'
    });
    store.attach('k', spec('k'), owner());
    await settle();
    fake.finish(0, grouping(0));
    await settle();
    const snap = store.snapshot('k');
    assert.equal(snap.state, 'noscore');
    assert.equal(snap.message, 'No groups could be made.');
});

test('a refusal reason is the store\'s to name', async () => {
    const fake = fakeApi();
    const store = D.createDerivedStore({ api: fake.api, refusalReason: 'grouping_too_expensive' });
    store.attach('k', spec('k'), owner());
    await settle();
    fake.fail(0, Object.assign(new Error('too much'), { status: 413, reason: 'grouping_too_expensive', estimate: { tier: 'refused' } }));
    await settle();
    assert.equal(store.snapshot('k').state, 'refused');
});

test('createLimiter: takes up to max, refuses beyond, and tells waiters on release', () => {
    const limiter = D.createLimiter(2);
    let told = 0;
    limiter.onFree(() => { told++; });
    assert.equal(limiter.tryTake(), true);
    assert.equal(limiter.tryTake(), true);
    assert.equal(limiter.tryTake(), false);
    assert.equal(limiter.active, 2);
    limiter.release();
    assert.equal(limiter.active, 1);
    assert.equal(told, 1);
    assert.equal(limiter.tryTake(), true);
});

test('one limiter across two stores of different kinds never runs more than its max', async () => {
    const limiter = D.createLimiter(2);
    const one = fakeApi();
    const two = fakeApi();
    const scores = D.createDerivedStore({ api: one.api, limiter });
    const groups = D.createDerivedStore({ api: two.api, limiter });
    const o = owner();
    scores.attach('s1', spec('s1'), o);
    scores.attach('s2', spec('s2'), o);
    groups.attach('g1', spec('g1'), o);
    groups.attach('g2', spec('g2'), o);
    await settle();
    assert.equal(one.calls.compute.length + two.calls.compute.length, 2);
    assert.equal(limiter.active, 2);
    // finishing a job in one store starts the waiting job of the other as well as its own
    one.finish(0, new Float32Array(3));
    await settle();
    assert.equal(limiter.active, 2);
    assert.equal(one.calls.compute.length + two.calls.compute.length, 3);
    // drain
    for (let i = 0; i < 4; i++) {
        for (const [fake, n] of [[one, one.calls.compute.length], [two, two.calls.compute.length]]) {
            for (let j = 0; j < n; j++) { try { fake.finish(j, new Float32Array(3)); } catch { /* done */ } }
        }
        await settle();
    }
    assert.equal(limiter.active, 0);
    assert.equal(one.calls.compute.length + two.calls.compute.length, 4);
});

test('a store gives its slot back when its job is aborted, failed or finished', async () => {
    const limiter = D.createLimiter(1);
    const fake = fakeApi();
    const store = D.createDerivedStore({ api: fake.api, limiter });
    const o = owner();
    store.attach('a', spec('a'), o);
    store.attach('b', spec('b'), o);
    await settle();
    assert.equal(limiter.active, 1);
    store.cancel('a');
    await settle();
    assert.equal(limiter.active, 1);       // b took it
    assert.equal(fake.calls.compute.length, 2);
    fake.fail(1, Object.assign(new Error('boom'), { status: 500 }));
    await settle();
    assert.equal(limiter.active, 0);
});

test('without a limiter the store makes its own of maxActive', async () => {
    const fake = fakeApi();
    const store = D.createDerivedStore({ api: fake.api, maxActive: 1 });
    const o = owner();
    store.attach('a', spec('a'), o);
    store.attach('b', spec('b'), o);
    await settle();
    assert.equal(fake.calls.compute.length, 1);
});
