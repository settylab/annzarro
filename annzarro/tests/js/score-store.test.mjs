/**
 * The score store (static/js/utils/score-store.js): keys, the byte-bounded
 * cache, one request per key, abort when nobody needs a score, the cost tiers
 * read from the estimate, the two-at-a-time limit and the order of the queue.
 *
 * The server is a fake `api`; time is the event loop (`settle`).
 *
 * Run:  node --test annzarro/tests/js/score-store.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../../../static/js/utils/score-store.js');

const settle = () => new Promise(resolve => setTimeout(resolve, 5));
const vec = (n, v = 1) => new Float32Array(n).fill(v);

/** A fake server: each compute waits for `release(i)`; the estimate says what `tier` says. */
function fakeApi({ tier = 'auto', seconds = 2, fail = null } = {}) {
    const calls = { estimate: [], compute: [] };
    const waiting = [];
    return {
        calls,
        api: {
            async estimate(req) {
                calls.estimate.push(req);
                return { estimate: { seconds, tier, auto_max_s: 60, max_s: 600, live_max_s: 5, layout: 'csc' } };
            },
            compute(req) {
                calls.compute.push(req);
                return new Promise((resolve, reject) => {
                    const entry = { req, resolve, reject };
                    waiting.push(entry);
                    req.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
                });
            }
        },
        // finish the i-th computation
        finish(i, n = 3, header = {}) {
            waiting[i].resolve({ header: { n_used: 2, ...header }, values: vec(n, i + 1) });
        },
        failWith(i, error) { waiting[i].reject(Object.assign(new Error(error.message), error)); },
        progress(i, done, total) { waiting[i].req.onProgress(done, total); },
        waiting
    };
}

const spec = (hash, extra = {}) => ({ recipe: { genes: ['A'], down: [] }, dataset: 'd.zarr', subset: null, hash, ...extra });
const keyOf = (hash, subset = null) => S.scoreKey({ hash, dataset: 'd.zarr', subset });
const owner = (visible = true) => ({ visible: () => visible });

test('the key holds the recipe hash, the dataset and the cells shown, and nothing else', () => {
    const a = S.scoreKey({ hash: 'h', dataset: 'd.zarr', subset: 'k1' });
    assert.notEqual(a, S.scoreKey({ hash: 'h2', dataset: 'd.zarr', subset: 'k1' }));
    assert.notEqual(a, S.scoreKey({ hash: 'h', dataset: 'e.zarr', subset: 'k1' }));
    assert.notEqual(a, S.scoreKey({ hash: 'h', dataset: 'd.zarr', subset: 'k2' }));
    assert.notEqual(a, S.scoreKey({ hash: 'h', dataset: 'd.zarr', subset: null }));
    assert.equal(S.scoreKey({ hash: 'h', dataset: 'd.zarr' }), S.scoreKey({ hash: 'h', dataset: 'd.zarr', subset: null }));
    // the cost of a recipe does not depend on the cells shown
    assert.equal(S.estimateKey({ hash: 'h', dataset: 'd.zarr' }), S.estimateKey({ hash: 'h', dataset: 'd.zarr' }));
});

test('the cache evicts the least recently used score when the budget is full', () => {
    const cache = new S.ScoreCache(100);       // bytes
    assert.equal(cache.put('a', { values: vec(10) }), true);       // 40 bytes
    assert.equal(cache.put('b', { values: vec(10) }), true);       // 80
    cache.get('a');                                              // a is now the newest
    assert.equal(cache.put('c', { values: vec(10) }), true);       // 120 > 100: b goes, not a
    assert.deepEqual(cache.keys(), ['a', 'c']);
    assert.equal(cache.bytes, 80);
    assert.equal(cache.evictions, 1);
    assert.equal(cache.has('b'), false);
});

test('an entry larger than the whole budget is not stored, and costs the others nothing', () => {
    const cache = new S.ScoreCache(100);
    cache.put('a', { values: vec(10) });
    assert.equal(cache.put('huge', { values: vec(1000) }), false);
    assert.deepEqual(cache.keys(), ['a']);
    assert.equal(cache.bytes, 40);
});

test('a score put again replaces the old one and the bytes follow', () => {
    const cache = new S.ScoreCache(1000);
    cache.put('a', { values: vec(10) });
    cache.put('a', { values: vec(20) });
    assert.equal(cache.size, 1);
    assert.equal(cache.bytes, 80);
    cache.delete('a');
    assert.equal(cache.bytes, 0);
});

test('a score is held as a Float32Array, outside the JS heap', async () => {
    const f = fakeApi();
    const store = S.createScoreStore({ api: f.api });
    const key = keyOf('h');
    store.attach(key, spec('h'), owner());
    await settle();
    f.finish(0, 4);
    await settle();
    const snap = store.snapshot(key);
    assert.equal(snap.state, 'ready');
    assert.ok(snap.values instanceof Float32Array);
    assert.equal(snap.values.length, 4);
});

test('however many dependants need a score there is one estimate and one request', async () => {
    const f = fakeApi();
    const store = S.createScoreStore({ api: f.api });
    const key = keyOf('h');
    const owners = [owner(), owner(), owner()];
    for (const o of owners) store.attach(key, spec('h'), o);
    await settle();
    assert.equal(f.calls.estimate.length, 1);
    assert.equal(f.calls.compute.length, 1);
    f.finish(0);
    await settle();
    for (const o of owners) assert.equal(store.snapshot(key).state, 'ready', 'every dependant sees it');
    assert.equal(store.stats().compute, 1);
});

test('a key already in the cache makes no request at all (a history step with an unchanged key)', async () => {
    const f = fakeApi();
    const store = S.createScoreStore({ api: f.api });
    const key = keyOf('h');
    const first = owner();
    store.attach(key, spec('h'), first);
    await settle();
    f.finish(0);
    await settle();
    store.detach(key, first);                       // the plot goes (Back)
    const again = owner();
    const snap = store.attach(key, spec('h'), again);     // and comes back with the same key
    await settle();
    assert.equal(snap.state, 'ready');
    assert.equal(f.calls.estimate.length, 1);
    assert.equal(f.calls.compute.length, 1);
});

test('the work stops when the last dependant leaves, and not before', async () => {
    const f = fakeApi();
    const store = S.createScoreStore({ api: f.api });
    const key = keyOf('h');
    const a = owner(), b = owner();
    store.attach(key, spec('h'), a);
    store.attach(key, spec('h'), b);
    await settle();
    assert.equal(store.stats().active, 1);
    store.detach(key, a);
    await settle();
    assert.equal(store.stats().aborted, 0, 'one dependant still needs it');
    assert.equal(f.calls.compute[0].signal.aborted, false);
    store.detach(key, b);
    await settle();
    assert.equal(f.calls.compute[0].signal.aborted, true);
    assert.equal(store.stats().aborted, 1);
    assert.equal(store.stats().active, 0);
    assert.deepEqual(store.jobKeys(), []);
    assert.equal(store.cache.size, 0, 'an aborted computation stores nothing');
});

test('the tier comes from the estimate: auto computes, confirm asks once, refused is answered by the server', async () => {
    // auto
    let f = fakeApi({ tier: 'auto', seconds: 59 });
    let store = S.createScoreStore({ api: f.api });
    store.attach(keyOf('a'), spec('a'), owner());
    await settle();
    assert.equal(store.snapshot(keyOf('a')).state, 'computing');

    // confirm: nothing is computed until the user says so
    f = fakeApi({ tier: 'confirm', seconds: 130 });
    store = S.createScoreStore({ api: f.api });
    store.attach(keyOf('c'), spec('c'), owner());
    await settle();
    let snap = store.snapshot(keyOf('c'));
    assert.equal(snap.state, 'awaiting');
    assert.equal(snap.estimate.seconds, 130);
    assert.equal(f.calls.compute.length, 0);
    assert.equal(store.confirm(keyOf('c')), true);
    await settle();
    assert.equal(f.calls.compute.length, 1);
    assert.equal(f.calls.compute[0].confirm, true, 'the click is sent to the server as confirm: true');

    // refused: the server is asked and answers 413 in its own words
    f = fakeApi({ tier: 'refused', seconds: 1500 });
    store = S.createScoreStore({ api: f.api });
    store.attach(keyOf('r'), spec('r'), owner());
    await settle();
    f.failWith(0, { status: 413, reason: 'score_too_expensive', message: 'This score would take about 25 minutes; the limit is 10. Use fewer genes.' });
    await settle();
    snap = store.snapshot(keyOf('r'));
    assert.equal(snap.state, 'refused');
    assert.match(snap.message, /about 25 minutes/);
});

test('the limits are not written in the store: a different estimate moves the tier', async () => {
    // the store never compares seconds with a number; it reads `tier` from the reply
    const f = fakeApi({ tier: 'confirm', seconds: 3 });       // 3 s, yet the server says confirm
    const store = S.createScoreStore({ api: f.api });
    store.attach(keyOf('h'), spec('h'), owner());
    await settle();
    assert.equal(store.snapshot(keyOf('h')).state, 'awaiting');
});

test('a 409 from the server (it wants the click) turns a computing job into awaiting', async () => {
    const f = fakeApi({ tier: 'auto' });
    const store = S.createScoreStore({ api: f.api });
    store.attach(keyOf('h'), spec('h'), owner());
    await settle();
    f.failWith(0, { status: 409, reason: 'confirmation_required', message: 'x', estimate: { seconds: 90, tier: 'confirm' } });
    await settle();
    assert.equal(store.snapshot(keyOf('h')).state, 'awaiting');
});

test('Cancel stops the shared work for everyone, and Compute starts it again', async () => {
    const f = fakeApi();
    const store = S.createScoreStore({ api: f.api });
    const key = keyOf('h');
    store.attach(key, spec('h'), owner());
    store.attach(key, spec('h'), owner());
    await settle();
    f.progress(0, 31, 50);
    assert.deepEqual(store.snapshot(key).progress, { done: 31, total: 50 });
    assert.equal(store.cancel(key), true);
    await settle();
    assert.equal(f.calls.compute[0].signal.aborted, true);
    assert.equal(store.snapshot(key).state, 'cancelled');
    assert.equal(store.stats().active, 0);
    assert.equal(store.confirm(key), true);
    await settle();
    assert.equal(f.calls.compute.length, 2);
    f.finish(1);
    await settle();
    assert.equal(store.snapshot(key).state, 'ready');
});

test('a failure keeps its reason, and Retry asks again', async () => {
    const f = fakeApi();
    const store = S.createScoreStore({ api: f.api });
    const key = keyOf('h');
    store.attach(key, spec('h'), owner());
    await settle();
    f.failWith(0, { message: 'The server stopped responding.', reason: 'read_failed' });
    await settle();
    let snap = store.snapshot(key);
    assert.equal(snap.state, 'failed');
    assert.equal(snap.message, 'The server stopped responding.');
    assert.equal(store.retry(key), true);
    await settle();
    assert.equal(f.calls.compute.length, 2);
    f.finish(1);
    await settle();
    snap = store.snapshot(key);
    assert.equal(snap.state, 'ready');
});

test('a score the server could not make (no gene in the dataset) is a state, not an error', async () => {
    const f = fakeApi();
    const store = S.createScoreStore({ api: f.api });
    const key = keyOf('h');
    store.attach(key, spec('h'), owner());
    await settle();
    f.waiting[0].resolve({ header: { scored: false, reason: 'no_gene_present', message: 'None of the signature\'s genes is in this dataset.' }, values: null });
    await settle();
    const snap = store.snapshot(key);
    assert.equal(snap.state, 'noscore');
    assert.equal(snap.reason, 'no_gene_present');
    assert.equal(store.cache.size, 0);
});

test('two scores compute at a time; the rest queue, those on screen first', async () => {
    const f = fakeApi();
    const store = S.createScoreStore({ api: f.api, maxActive: 2 });
    const hidden = owner(false);
    store.attach(keyOf('off'), spec('off'), hidden);       // first asked, but off screen
    store.attach(keyOf('a'), spec('a'), owner());
    store.attach(keyOf('b'), spec('b'), owner());
    store.attach(keyOf('c'), spec('c'), owner());
    await settle();
    assert.equal(store.stats().active, 2);
    assert.equal(f.calls.compute.length, 2);
    assert.deepEqual(f.calls.compute.map(c => c.recipe.genes.length), [1, 1]);
    assert.equal(store.snapshot(keyOf('c')).state, 'queued');
    assert.equal(store.snapshot(keyOf('off')).state, 'idle', 'off screen: nothing starts, not even the estimate');
    f.finish(0);
    await settle();
    assert.equal(f.calls.compute.length, 3, 'a slot frees and the next on-screen score starts');
    assert.equal(store.snapshot(keyOf('c')).state, 'computing');
    assert.equal(f.calls.estimate.length, 3, 'no estimate for the one off screen');
});

test('a score off screen starts when its dependant comes into view', async () => {
    const f = fakeApi();
    const store = S.createScoreStore({ api: f.api });
    let visible = false;
    store.attach(keyOf('h'), spec('h'), { visible: () => visible });
    await settle();
    assert.equal(f.calls.estimate.length, 0);
    visible = true;
    store.poke();
    await settle();
    assert.equal(store.snapshot(keyOf('h')).state, 'computing');
});

test('a score evicted while a dependant still wants it is computed again on need', async () => {
    const f = fakeApi();
    const store = S.createScoreStore({ api: f.api, budget: 40 });          // one score of 10 values
    store.attach(keyOf('a'), spec('a'), owner());
    await settle();
    f.finish(0, 10);
    await settle();
    assert.equal(store.snapshot(keyOf('a')).state, 'ready');
    store.attach(keyOf('b'), spec('b'), owner());
    await settle();
    f.finish(1, 10);
    await settle();
    assert.equal(store.cache.has(keyOf('a')), false, 'a was evicted for b');
    const snap = store.snapshot(keyOf('a'));
    assert.notEqual(snap.state, 'ready');
    await settle();
    assert.equal(f.calls.compute.length, 3, 'rebuilt on need');
});

test('estimates are kept: a second signature with the same recipe asks nothing', async () => {
    const f = fakeApi();
    const store = S.createScoreStore({ api: f.api });
    await store.estimateFor({ genes: ['A'], down: [] }, 'd.zarr', 'h');
    await store.estimateFor({ genes: ['A'], down: [] }, 'd.zarr', 'h');
    assert.equal(f.calls.estimate.length, 1);
    await store.estimateFor({ genes: ['A'], down: [] }, 'e.zarr', 'h');
    assert.equal(f.calls.estimate.length, 2);
});

test('abortAll stops every request; a dependant still waiting sees it cancelled', async () => {
    const f = fakeApi();
    const store = S.createScoreStore({ api: f.api });
    store.attach(keyOf('a'), spec('a'), owner());
    store.attach(keyOf('b'), spec('b'), owner());
    await settle();
    store.abortAll();
    await settle();
    assert.ok(f.calls.compute.every(c => c.signal.aborted));
    assert.equal(store.stats().active, 0);
    assert.equal(store.snapshot(keyOf('a')).state, 'cancelled');
    assert.equal(f.calls.compute.length, 2, 'nothing starts again by itself');
});
