/**
 * Derived sources (static/js/utils/derived-sources.js): handles, the applied
 * recipe, held edits and usage, independent of what a source is. These tests
 * use a fake source that is not a gene score: a recipe of items read in two
 * VARIANTS ('a' and 'b'), whose values are mixed typed arrays (a grouping's
 * codes and counts), through the derived store of utils/derived-store.js.
 *
 * Run:  node --test annzarro/tests/js/derived-sources.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const DS = await import('../../../static/js/utils/derived-store.js');
const D = await import('../../../static/js/utils/derived-sources.js');

const settle = () => new Promise(resolve => setTimeout(resolve, 5));

/**
 * A fake source kind. Its recipe is `{items, scale, shift}`; variant 'a' reads `items` and `scale`, variant 'b'
 * reads `items` and `shift`. An empty item list asks nothing of the server ('noitems').
 */
function world({ estimateSeconds = () => 1, tierOf = () => 'auto', cells = 4 } = {}) {
    const calls = { estimate: [], compute: [], hashOf: 0, hash: 0 };
    const waiting = [];
    const api = {
        async estimate({ recipe }) {
            calls.estimate.push(recipe);
            const seconds = estimateSeconds(recipe);
            return { estimate: { seconds, tier: tierOf(seconds), auto_max_s: 60, max_s: 600, live_max_s: 5 } };
        },
        compute(req) {
            calls.compute.push(req);
            return new Promise((resolve, reject) => {
                waiting.push({ req, resolve, reject });
                req.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
            });
        }
    };
    const store = DS.createDerivedStore({ api, isEmpty: (out) => !out.values });
    const recipes = new Map();
    const ctx = { dataset: 'd.zarr', subset: null, cells };
    const timers = [];
    const sources = D.createDerivedSources({
        store,
        sources: { get: (id) => recipes.get(id) || null, off: () => false },
        context: () => ({ ...ctx }),
        kind: 'fake',
        thing: 'grouping',
        copyOf: (r) => ({ ...r, items: [...r.items] }),
        variantOf: (r, option) => {
            const recipe = { items: r.items, variant: option.variant, ...(option.variant === 'a' ? { scale: r.scale } : { shift: r.shift }) };
            return recipe.items.length ? { recipe, fields: { variant: option.variant } } : { recipe, none: { state: 'noitems' } };
        },
        hashOf: (r) => {
            calls.hashOf++;
            const items = r.items.join(',');           // the long part, walked once per recipe
            return (variant) => {
                calls.hash++;
                return `${items}|${variant.variant}|${variant.scale ?? ''}|${variant.shift ?? ''}`;
            };
        },
        editHashOf: (r, hash) => ['a', 'b'].map(v => hash({ items: r.items, variant: v, scale: r.scale, shift: r.shift })).join('#'),
        keyOf: ({ hash, dataset, subset }) => `${hash}\u0001${dataset}\u0001${subset || ''}`,
        countOf: (values) => values.codes.length,
        liveDelayMs: 10,
        setTimer: (fn, ms) => { const t = { fn, ms, off: false }; timers.push(t); return t; },
        clearTimer: (t) => { if (t) t.off = true; }
    });
    const add = (id, title, items, extra = {}) => {
        const src = { title, items, scale: 1, shift: 0, ...extra };
        src.recipe = () => ({ items: src.items, scale: src.scale, shift: src.shift });
        recipes.set(id, src);
        return src;
    };
    const fire = async () => {
        for (const t of timers.splice(0)) if (!t.off) await t.fn();
        await settle();
    };
    const finish = (i, n = ctx.cells) => waiting[i].resolve({ header: { n }, values: { codes: new Uint8Array(n).fill(i + 1), counts: new Float64Array(3) } });
    const watch = (id, variant, consumer = {}) => {
        const states = [];
        const handle = sources.watch(id, { consumer: { kind: 'plot', role: 'color', ...consumer }, option: { variant }, onChange: (s) => states.push(s) });
        return { handle, states };
    };
    return { calls, store, sources, recipes, ctx, add, fire, finish, waiting, watch };
}

/** Read a handle and let its request go out and come back. */
async function ready(w, handle, i) {
    handle.read();
    await settle();
    w.finish(i);
    await settle();
    return handle.read();
}

test('two variants of one source are two keys; one variant is shared; values are the store\'s typed arrays', async () => {
    const w = world();
    w.add('G1', 'Groups', ['x', 'y']);
    const a1 = w.watch('G1', 'a'), a2 = w.watch('G1', 'a'), b = w.watch('G1', 'b');
    for (const h of [a1, a2, b]) h.handle.read();
    await settle();
    assert.deepEqual(w.calls.compute.map(c => c.recipe.variant).sort(), ['a', 'b'], 'two requests, not three');
    w.finish(0); w.finish(1);
    await settle();
    const snap = a1.handle.read();
    assert.equal(snap.state, 'ready');
    assert.ok(snap.values.codes instanceof Uint8Array);
    assert.equal(snap.kind, 'fake', 'the source kind when the source does not say');
    assert.equal(snap.variant, 'a', 'the variant\'s own fields are in the snapshot');
    assert.equal(a1.handle.read().key, a2.handle.read().key);
    assert.notEqual(a1.handle.read().key, b.handle.read().key);
    assert.equal(a1.handle.sharers(), 2);
    assert.equal(b.handle.sharers(), 1);
});

test('live: an edit under live_max_s is applied after the pause; the previous values are kept meanwhile', async () => {
    const w = world();
    const src = w.add('G1', 'Groups', ['x']);
    const { handle, states } = w.watch('G1', 'a');
    await ready(w, handle, 0);
    src.items = ['x', 'y'];
    w.sources.sourceChanged('G1');
    assert.equal(w.sources.status('G1').checking, true, 'the estimate decides');
    assert.equal(handle.read().state, 'ready', 'the applied recipe until the pause ends');
    await w.fire();
    const mid = handle.read();
    assert.equal(mid.state, 'updating');
    assert.equal(mid.values.codes[0], 1, 'the previous values');
    w.finish(1);
    await settle();
    assert.equal(handle.read().state, 'ready');
    assert.equal(handle.read().values.codes[0], 2);
    assert.deepEqual(w.calls.compute[1].recipe.items, ['x', 'y']);
    assert.ok(states.length > 0, 'the consumer was told');
});

test('held: an edit at live_max_s or more waits for Update; edits are counted, nothing is computed', async () => {
    const w = world({ estimateSeconds: (r) => (r.items.length > 1 ? 30 : 1) });
    const src = w.add('G1', 'Groups', ['x']);
    const { handle } = w.watch('G1', 'a');
    await ready(w, handle, 0);
    src.items = ['x', 'y'];
    w.sources.sourceChanged('G1');
    src.items = ['x', 'y', 'z'];
    w.sources.sourceChanged('G1');
    w.sources.sourceChanged('G1');                    // told again of a recipe it knows: not another edit
    await w.fire();
    const snap = handle.read();
    assert.equal(snap.state, 'ready');
    assert.deepEqual(snap.held, { edits: 2, seconds: 30 });
    assert.equal(snap.values.codes[0], 1);
    assert.deepEqual(w.sources.heldOf('G1'), { edits: 2, seconds: 30 });
    assert.equal(w.calls.compute.length, 1);
    // Update
    assert.equal(w.sources.update('G1'), true);
    assert.equal(handle.read().held, null);
    assert.equal(handle.read().state, 'updating');
    await settle();
    assert.equal(w.calls.compute.length, 2);
    assert.deepEqual(w.calls.compute[1].recipe.items, ['x', 'y', 'z']);
    assert.equal(w.sources.update('nothing'), false, 'no source: nothing to update');
});

test('an edit only one variant reads asks for that variant alone; one no consumer reads asks for nothing', async () => {
    const w = world();
    const src = w.add('G1', 'Groups', ['x']);
    const a = w.watch('G1', 'a');
    a.handle.read();
    await settle();
    w.finish(0);
    await settle();
    // only 'a' is read: changing what only 'b' reads is kept as the applied recipe, with no request
    src.shift = 7;
    w.sources.sourceChanged('G1');
    assert.equal(w.sources.status('G1').checking, false);
    assert.equal(w.sources.appliedOf('G1').shift, 7, 'the setting is kept');
    await w.fire();
    assert.equal(w.calls.compute.length, 1);
    assert.equal(w.calls.estimate.length, 1);
    // a 'b' consumer now reads shift 7; changing scale asks for 'a' only
    const b = w.watch('G1', 'b');
    b.handle.read();
    await settle();
    w.finish(1);
    await settle();
    src.scale = 2;
    w.sources.sourceChanged('G1');
    await w.fire();
    w.finish(2);
    await settle();
    assert.deepEqual(w.calls.compute.map(c => c.recipe.variant), ['a', 'b', 'a']);
    assert.equal(b.handle.read().state, 'ready');
    assert.equal(a.handle.read().values.codes[0], 3);
});

test('cancel: stops the work for every sharer; Retry asks again', async () => {
    const w = world();
    w.add('G1', 'Groups', ['x']);
    const a = w.watch('G1', 'a', { host: 'P1' }), a2 = w.watch('G1', 'a', { host: 'P2' });
    a.handle.read(); a2.handle.read();
    await settle();
    assert.equal(a.handle.read().state, 'computing');
    assert.equal(a.handle.sharers(), 2, 'two hosts wait on one request');
    assert.equal(a.handle.cancel(), true);
    await settle();
    assert.equal(w.calls.compute[0].signal.aborted, true);
    assert.equal(a.handle.read().state, 'cancelled');
    assert.equal(a2.handle.read().state, 'cancelled', 'cancelled for both');
    assert.equal(a.handle.cancel(), false, 'nothing left to cancel');
    assert.equal(a.handle.retry(), true);
    await settle();
    w.finish(1);
    await settle();
    assert.equal(a2.handle.read().state, 'ready');
});

test('subset change: a new key, no values of other cells; going back is cached', async () => {
    const w = world();
    w.add('G1', 'Groups', ['x']);
    const { handle } = w.watch('G1', 'b');
    await ready(w, handle, 0);
    w.ctx.subset = 's2';
    w.ctx.cells = 2;
    w.sources.contextChanged();
    const snap = handle.read();
    assert.notEqual(snap.state, 'ready');
    assert.notEqual(snap.state, 'updating', 'the previous values were of other cells');
    assert.equal(snap.values, undefined);
    await settle();
    assert.equal(w.calls.compute[1].subset, 's2');
    w.finish(1, 2);
    await settle();
    assert.equal(handle.read().values.codes.length, 2);
    w.ctx.subset = null;
    w.ctx.cells = 4;
    w.sources.contextChanged();
    assert.equal(handle.read().state, 'ready');
    assert.equal(w.calls.compute.length, 2, 'going back makes no request');
});

test('values of another length than the cells shown are asked for again once, then failed in the source\'s words', async () => {
    const w = world({ cells: 4 });
    w.add('G1', 'Groups', ['x']);
    const { handle } = w.watch('G1', 'a');
    handle.read();
    await settle();
    w.finish(0, 3);
    await settle();
    handle.read();
    await settle();
    assert.equal(w.waiting.length, 2);
    w.finish(1, 3);
    await settle();
    const snap = handle.read();
    assert.equal(snap.state, 'failed');
    assert.equal(snap.reason, 'cells_mismatch');
    assert.equal(snap.message, 'the grouping has 3 values for 4 cells');
});

test('nothing to ask, a deleted source, a gate and an option the provider does not know', async () => {
    const w = world();
    const src = w.add('G1', 'Groups', []);
    const { handle } = w.watch('G1', 'a');
    assert.equal(handle.read().state, 'noitems');
    await settle();
    assert.equal(w.calls.estimate.length, 0);
    src.items = ['x'];
    w.recipes.delete('G1');
    assert.equal(handle.read().state, 'deleted');
    assert.equal(handle.read().title, 'Groups', 'it says which source');
    // a gate: the source's input is not known yet; its actions are the gate's
    const done = [];
    src.gate = (panelId) => (panelId === 'P9' ? { state: 'awaiting', why: 'upstream' } : null);
    src.actions = { accept: () => done.push('accept'), cancel: () => done.push('cancel'), retry: () => done.push('retry') };
    w.recipes.set('G1', src);
    const gated = w.watch('G1', 'a', { panelId: 'P9' });
    assert.equal(gated.handle.read().state, 'awaiting');
    assert.equal(gated.handle.read().why, 'upstream');
    assert.equal(gated.handle.compute(), true);
    assert.deepEqual(done, ['accept']);
    // an option the provider does not know (left over from another source type): nothing asked
    const sources = D.createDerivedSources({
        store: w.store, sources: { get: () => src }, context: () => ({ dataset: 'd', subset: null }),
        isOption: (o) => ['a', 'b'].includes(o.variant), variantOf: () => assert.fail('not asked'),
        hashOf: () => assert.fail('not hashed'), editHashOf: () => '', keyOf: () => 'k', copyOf: (r) => r
    });
    const odd = sources.watch('G1', { consumer: { kind: 'plot' }, option: { variant: 'c' }, onChange() {} });
    assert.equal(odd.read().state, 'estimating');
    assert.equal(odd.read().key, null);
});

test('a gate\'s own fields reach the snapshot unchanged: a mixed cycle keeps its ring and its kinds', () => {
    const w = world();
    const src = w.add('G1', 'Groups', ['x']);
    const cycle = ['Table 1', 'Groups', 'Table 2'];
    const cycleKinds = ['table', 'cell-grouping', 'table'];
    src.gate = () => ({ state: 'cycle', cycle, cycleKinds });
    const { handle } = w.watch('G1', 'a', { panelId: 'P1' });
    const snap = handle.read();
    assert.equal(snap.state, 'cycle');
    assert.deepEqual(snap.cycle, cycle);
    assert.deepEqual(snap.cycleKinds, cycleKinds);
    assert.equal(snap.key, null, 'nothing is asked while gated');
    assert.equal(w.calls.estimate.length, 0);
});

test('usage and consumers by role: viewers are not consumers; an unknown kind throws and leaves nothing', () => {
    const w = world();
    w.add('G1', 'Groups', ['x']);
    w.watch('G1', 'a', { kind: 'plot', role: 'x' });
    w.watch('G1', 'a', { kind: 'table', role: 'column' });
    w.watch('G1', 'b', { kind: 'grouping', role: 'factor' });
    const viewer = w.watch('G1', 'b', { kind: 'inspect', role: 'inspect' });
    const rows = Object.fromEntries(w.sources.usage('G1', (o) => o.variant).map(r => [r.value, [r.plots, r.tables, r.groupings]]));
    assert.deepEqual(rows, { a: [1, 1, 0], b: [0, 0, 1] });
    assert.deepEqual(w.sources.consumersOf('G1').map(h => h.role), ['x', 'column', 'factor']);
    assert.equal(w.sources.handlesOf('G1').length, 4);
    viewer.handle.release();
    assert.throws(() => w.sources.watch('G1', { consumer: { kind: 'heatmap' }, option: { variant: 'a' }, onChange() {} }),
        /Unknown consumer kind 'heatmap'/);
    assert.equal(w.sources.handlesOf('G1').length, 3);
    assert.deepEqual(w.sources.usage('nobody', (o) => o.variant), []);
});

test('the last release aborts the work and forgets the applied recipe', async () => {
    const w = world();
    w.add('G1', 'Groups', ['x']);
    const { handle } = w.watch('G1', 'a');
    handle.read();
    await settle();
    handle.release();
    await settle();
    assert.equal(w.calls.compute[0].signal.aborted, true);
    assert.equal(w.sources.appliedOf('G1'), null);
    assert.deepEqual(w.sources.handlesOf('G1'), []);
});

test('reads never hash: 0 hasher calls over 100 reads in each state, and over status and usage', async () => {
    const w = world({ estimateSeconds: (r) => (r.items.length > 1 ? 30 : 1) });
    const src = w.add('G1', 'Groups', ['x']);
    const a = w.watch('G1', 'a'), b = w.watch('G1', 'b');
    a.handle.read(); b.handle.read();
    const count = () => w.calls.hashOf + w.calls.hash;
    const hundredReads = (label) => {
        const before = count();
        for (let i = 0; i < 100; i++) {
            a.handle.read(); b.handle.read();
            w.sources.status('G1');
            w.sources.usage('G1', (o) => o.variant);
            a.handle.sharers();
        }
        assert.equal(count() - before, 0, `${label}: hasher calls over 100 reads`);
    };
    await settle();
    hundredReads('computing');
    w.finish(0); w.finish(1);
    await settle();
    hundredReads('ready');
    src.items = ['x', 'y'];
    w.sources.sourceChanged('G1');
    hundredReads('checking an edit');
    await w.fire();
    assert.ok(a.handle.read().held, 'held');
    hundredReads('held');
    w.sources.update('G1');
    await settle();
    hundredReads('updating');
    // 100 progress frames tell the consumers, which read again (their onChange is given a read): still no hashing
    const job = w.waiting.at(-1);
    const told = a.states.length + b.states.length;
    const before = count();
    for (let i = 0; i < 100; i++) job.req.onProgress(i, 100);
    w.sources.contextChanged();
    assert.ok(a.states.length + b.states.length - told >= 100, 'the consumers were told');
    assert.equal(count() - before, 0, 'notifying consumers does not hash');
});
