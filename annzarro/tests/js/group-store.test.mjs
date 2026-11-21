/**
 * The group store (static/js/utils/group-store.js): group results in the browser on the derived store, with a cache
 * of 256 MiB for group tables and moments, one entry per feature (CXG-18), and codes outside it, on the memory guard's
 * ledger and held while a consumer holds them (CAT-4, CMP-12). The server is a fake api.
 *
 * Run:  node --test annzarro/tests/js/group-store.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../../../static/js/utils/group-store.js');
const { createLimiter } = await import('../../../static/js/utils/derived-store.js');
const { Ledger } = await import('../../../static/js/utils/memory-guard.js');

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

const GROUPS = 2;
const CELLS = 6;
const request = { shape: 'grouping', partitionings: [{ source: { type: 'obs', key: 'cell_type' } }],
    small: { threshold: 10, mode: 'keep' }, subset: null, want: { codes: false, histograms: [] } };
const gene = (name, layer = 'X') => ({ key: `${name}|${layer}`, wire: { kind: 'gene', name, layer, detect_above: 0 } });
/** The moments the fake server gives a feature in a group: its name, then the group, then the moment. */
const momentOf = (name, g, m) => name.charCodeAt(0) * 100 + g * 10 + m;

/** A fake server, and the store over it. */
function world({ seconds = () => 1, tierOf = (s) => (s < 5 ? 'live' : s < 60 ? 'auto' : s < 600 ? 'confirm' : 'refused'),
    budget, cells = CELLS, codes = null } = {}) {
    const calls = { estimate: [], compute: [] };
    const waiting = [];
    const ledger = { held: new Map(), holds: 0, releases: 0 };
    const api = {
        async estimate({ recipe, dataset }) {
            calls.estimate.push({ recipe, dataset });
            const s = seconds(recipe);
            return { estimate: { seconds: s, tier: tierOf(s), live_max_s: 5, auto_max_s: 60, max_s: 600 } };
        },
        compute(req) {
            calls.compute.push(req);
            return new Promise((resolve, reject) => {
                waiting.push({ req, resolve, reject });
                req.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
            });
        }
    };
    const store = S.createGroupStore({
        api, budget, limiter: createLimiter(2),
        codes: codes || {
            hold(key, bytes) { ledger.holds++; ledger.held.set(key, bytes); },
            pin() {},
            release(key) { ledger.releases++; ledger.held.delete(key); }
        }
    });
    /** The server's answer to computation i: what it was asked for, computed. */
    const reply = (i, { n = cells } = {}) => {
        const body = waiting[i].req.recipe;
        const features = body.features || [];
        const header = { type: 'result', version: 1, shape: body.shape, n_shown: n, n_grouped: n,
            partitionings: [{ kind: 'categorical', levels: [{ id: 'c:B cell', n: 4 }, { id: 'c:T cell', n: 2 }],
                categories: ['c:B cell', 'c:T cell'] }],
            groups: [{ key: ['c:B cell'], n: 4 }, { key: ['c:T cell'], n: 2 }], small: {} };
        const values = {};
        if (body.want.codes) values.codes = Uint8Array.from({ length: n }, (_, c) => c % GROUPS);
        if (features.length) {
            header.features = features.map((f) => ({ id: f.id, status: f.name === 'Absent' ? 'missing' : 'ok' }));
            header.moments = ['n', 'sum', 'sumsq', 'n_above', 'sum_above'];
            const m = new Float64Array(features.length * GROUPS * 5);
            features.forEach((f, fi) => { for (let g = 0; g < GROUPS; g++) for (let k = 0; k < 5; k++) m[(fi * GROUPS + g) * 5 + k] = momentOf(f.name, g, k); });
            values.feature_moments = m;
        }
        return { header, values };
    };
    const finish = async (i, opts) => { waiting[i].resolve(reply(i, opts)); await settle(); };
    const fail = async (i, error) => { waiting[i].reject(error); await settle(); };
    const ctx = { dataset: 'd.zarr', subset: null };
    /** A consumer of a need: attaches it under the key group-sources would use. */
    const consume = (need, { visible = true, subset = ctx.subset } = {}) => {
        const key = `${need.hash}\u0001${ctx.dataset}\u0001${subset || ''}`;
        const owner = { visible: typeof visible === 'function' ? visible : () => visible };
        const first = store.attach(key, { recipe: need, dataset: ctx.dataset, subset, hash: need.hash }, owner);
        return { key, owner, first, snap: () => store.snapshot(key), leave: () => store.detach(key, owner) };
    };
    return { store, calls, waiting, ledger, finish, fail, consume, reply };
}

const need = (extra = {}) => S.groupNeed({ request, key: 'g1', ...extra });

test('the cache is 256 MiB and holds what the codes are not', () => {
    const { store } = world();
    assert.equal(store.cache.budget, 256 * 1024 * 1024);
});

test('a grouping is computed once for every consumer of its key, and read as the levels and groups', async () => {
    const w = world();
    const a = w.consume(need({ codes: true }));
    const b = w.consume(need({ codes: true }));
    await settle();
    assert.equal(w.calls.compute.length, 1);
    assert.equal(w.calls.compute[0].recipe.want.codes, true);
    assert.equal(a.snap().state, 'computing');
    await w.finish(0);
    const snap = a.snap();
    assert.equal(snap.state, 'ready');
    assert.equal(b.snap().values, snap.values, 'one value for both');
    assert.equal(snap.values.reply.n_shown, CELLS);
    assert.deepEqual(snap.values.reply.partitionings[0].levels, ['c:B cell', 'c:T cell']);
    assert.deepEqual(snap.values.reply.partitionings[0].counts, [4, 2]);
    assert.deepEqual(snap.values.reply.groups, [{ key: ['c:B cell'], n: 4 }, { key: ['c:T cell'], n: 2 }]);
    assert.deepEqual([...snap.values.codes], [0, 1, 0, 1, 0, 1]);
    assert.equal(a.snap().values, snap.values, 'a read builds nothing');
});

test('an unchanged key makes no request: a consumer that comes back reads the cache', async () => {
    const w = world();
    const one = w.consume(need({ features: [gene('Cd3e')] }));
    await settle();
    await w.finish(0);
    one.leave();
    const two = w.consume(need({ features: [gene('Cd3e')] }));
    await settle();
    assert.equal(w.calls.compute.length, 1);
    assert.equal(w.calls.estimate.length, 1);
    assert.equal(two.first.state, 'ready');
    assert.equal(two.snap().values.features[0].moments[0], momentOf('Cd3e', 0, 0));
});

test('one entry per feature: adding a gene asks for that gene only, and the others are the cached ones', async () => {
    const w = world();
    const two = w.consume(need({ features: [gene('Cd3e'), gene('Ms4a1')] }));
    await settle();
    assert.deepEqual(w.calls.compute[0].recipe.features,
        [{ id: 'f0', kind: 'gene', name: 'Cd3e', layer: 'X', detect_above: 0 }, { id: 'f1', kind: 'gene', name: 'Ms4a1', layer: 'X', detect_above: 0 }]);
    await w.finish(0);
    const three = w.consume(need({ features: [gene('Cd3e'), gene('Ms4a1'), gene('Nkg7')] }));
    await settle();
    assert.equal(w.calls.compute.length, 2);
    assert.deepEqual(w.calls.compute[1].recipe.features, [{ id: 'f0', kind: 'gene', name: 'Nkg7', layer: 'X', detect_above: 0 }]);
    assert.equal(w.calls.compute[1].recipe.want.codes, false);
    await w.finish(1);
    const got = three.snap().values.features;
    assert.equal(got.length, 3);
    assert.equal(got[0].moments, two.snap().values.features[0].moments, 'the cached entry itself');
    // feature i of a reply is its own [groups, 5] slice, in group order
    assert.deepEqual([...got[1].moments], [0, 1].flatMap((g) => [0, 1, 2, 3, 4].map((k) => momentOf('Ms4a1', g, k))));
    assert.deepEqual([...got[2].moments.subarray(5, 10)], [0, 1, 2, 3, 4].map((k) => momentOf('Nkg7', 1, k)));
    assert.equal(got[2].status.status, 'ok');
    // another layer or threshold is another feature
    w.consume(need({ features: [gene('Cd3e', 'logged')] }));
    await settle();
    assert.equal(w.calls.compute.length, 3);
    // removing a gene asks for nothing
    const one = w.consume(need({ features: [gene('Nkg7')] }));
    await settle();
    assert.equal(w.calls.compute.length, 3);
    assert.equal(one.snap().state, 'ready');
});

test('a feature the dataset lacks is an entry with its status and no moments of its own reading', async () => {
    const w = world();
    const c = w.consume(need({ features: [gene('Absent')] }));
    await settle();
    await w.finish(0);
    assert.equal(c.snap().values.features[0].status.status, 'missing');
});

test('codes are outside the cache, on the ledger while a consumer holds them, and released with the last', async () => {
    const cells = 100000;
    const w = world({ cells });
    const plot = w.consume(need({ codes: true }));
    await settle();
    await w.finish(0);
    assert.ok(w.store.cache.bytes < cells, `the cache holds no codes (${w.store.cache.bytes} bytes)`);
    assert.deepEqual([...w.ledger.held.values()], [cells]);
    assert.equal(w.store.stats().codesBytes, cells);
    // a second consumer of the same codes (a table column beside the plot) holds them too: no request, no second entry
    const table = w.consume(need({ codes: true, features: [] }));
    assert.equal(table.first.state, 'ready');
    assert.equal(table.snap().values.codes, plot.snap().values.codes);
    assert.equal(w.ledger.holds, 1);
    plot.leave();
    assert.equal(w.ledger.held.size, 1, 'held while one consumer holds them');
    table.leave();
    assert.equal(w.ledger.held.size, 0);
    assert.equal(w.ledger.releases, 1);
    assert.equal(w.store.stats().codesBytes, 0);
    // codes come back from the server; the cached group table does not need to
    const again = w.consume(need({ codes: true }));
    await settle();
    assert.equal(w.calls.compute.length, 2);
    assert.equal(w.calls.compute[1].recipe.want.codes, true);
    await w.finish(1);
    assert.equal(again.snap().state, 'ready');
    assert.equal(w.ledger.held.size, 1);
});

test('codes and features share the group table: features of a key with codes held ask only for what is missing', async () => {
    const w = world();
    w.consume(need({ codes: true }));
    await settle();
    await w.finish(0);
    const both = w.consume(need({ codes: true, features: [gene('Cd3e')] }));
    await settle();
    assert.equal(w.calls.compute[1].recipe.want.codes, false, 'the codes held are not asked again');
    await w.finish(1);
    assert.equal(both.snap().values.codes.length, CELLS);
    assert.equal(w.ledger.holds, 1);
});

test('a consumer off screen starts nothing and holds nothing', async () => {
    const w = world();
    const off = w.consume(need({ codes: true }), { visible: false });
    await settle();
    assert.equal(w.calls.estimate.length + w.calls.compute.length, 0);
    assert.equal(off.snap().state, 'idle');
    assert.equal(w.ledger.holds, 0);
});

test('the states: estimating, queued, computing with progress, ready', async () => {
    const w = world();
    const seen = [];
    w.store.on((key, snap) => seen.push(snap.state));
    const c = w.consume(need());
    await settle();
    w.waiting[0].req.onProgress(300, 600, { type: 'progress' });
    assert.deepEqual(c.snap().progress, { done: 300, total: 600 });
    await w.finish(0);
    assert.deepEqual([...new Set(seen)], ['estimating', 'queued', 'computing', 'ready']);
});

test('asks first: awaiting, and Compute sends confirm', async () => {
    const w = world({ seconds: () => 120 });
    const c = w.consume(need());
    await settle();
    assert.equal(c.snap().state, 'awaiting');
    assert.equal(c.snap().estimate.seconds, 120);
    assert.equal(w.calls.compute.length, 0);
    assert.equal(w.store.accept(c.key), true);
    await settle();
    assert.equal(w.calls.compute[0].confirm, true);
    await w.finish(0);
    assert.equal(c.snap().state, 'ready');
});

test('refused by cost (413 groups_too_expensive), failed (read_busy) with Retry, cancelled', async () => {
    const w = world();
    const c = w.consume(need());
    await settle();
    await w.fail(0, Object.assign(new Error('Too expensive.'), { status: 413, reason: 'groups_too_expensive', estimate: { seconds: 900 } }));
    assert.equal(c.snap().state, 'refused');
    assert.equal(c.snap().reason, 'groups_too_expensive');

    const d = w.consume(need({ features: [gene('Cd3e')] }));
    await settle();
    await w.fail(1, Object.assign(new Error('The server stayed busy.'), { reason: 'read_busy' }));
    assert.equal(d.snap().state, 'failed');
    assert.equal(d.snap().reason, 'read_busy');
    assert.equal(w.store.retry(d.key), true);
    await settle();
    assert.equal(w.calls.compute.length, 3);
    await w.finish(2);
    assert.equal(d.snap().state, 'ready');

    const e = w.consume(need({ features: [gene('Nkg7')] }));
    await settle();
    assert.equal(w.store.cancel(e.key), true);
    await settle();
    assert.equal(e.snap().state, 'cancelled');
});

test('too many groups settles with the refusal in the header and nothing cached', async () => {
    const w = world();
    const c = w.consume(need());
    await settle();
    w.waiting[0].resolve({ header: { type: 'result', shape: 'grouping', n_shown: CELLS, reason: 'too_many_groups',
        refused: { reason: 'too_many_groups', count: 6840, limit: 2000 } }, values: {} });
    await settle();
    const snap = c.snap();
    assert.equal(snap.state, 'refused', 'a refusal, never the empty state');
    assert.equal(snap.reason, 'too_many_groups');
    assert.equal(snap.header.refused.count, 6840);
    assert.equal(snap.values, null);
    assert.equal(w.store.cache.size, 0);
});

test('a refusal and a reply with no groups are told apart', async () => {
    const w = world();
    const refused = w.consume(need());
    const empty = w.consume(need({ features: [gene('Cd3e')] }));
    await settle();
    w.waiting[0].resolve({ header: { type: 'result', shape: 'grouping', n_shown: CELLS, reason: 'too_many_groups',
        refused: { reason: 'too_many_groups', count: 6840, limit: 2000 } }, values: {} });
    w.waiting[1].resolve({ header: { type: 'result', shape: 'grouping', n_shown: CELLS, n_grouped: 0, partitionings: [{ levels: [] }],
        groups: [], features: [{ id: 'f0', status: 'ok' }] }, values: { feature_moments: new Float64Array(0) } });
    await settle();
    const a = refused.snap();
    const b = empty.snap();
    assert.equal(a.state, 'refused');
    assert.equal(b.state, 'ready');
    assert.deepEqual(b.values.reply.groups, []);
    assert.notEqual(a.state, b.state);
    // and both differ from a refusal by cost, which is refused too, by its own reason
    const costly = w.consume(need({ features: [gene('Nkg7')] }));
    await settle();
    await w.fail(2, Object.assign(new Error('Too expensive.'), { status: 413, reason: 'groups_too_expensive' }));
    assert.equal(costly.snap().state, 'refused');
    assert.equal(costly.snap().reason, 'groups_too_expensive');
});

test('the last consumer leaving stops the request', async () => {
    const w = world();
    const c = w.consume(need({ codes: true }));
    await settle();
    assert.equal(w.calls.compute.length, 1);
    c.leave();
    await settle();
    assert.equal(w.store.stats().aborted, 1);
    assert.equal(w.ledger.holds, 0);
});

test('an evicted feature is asked for again, alone', async () => {
    const w = world({ budget: GROUPS * 5 * 8 * 2 + 256 });      // two features' moments and the group table (under 256 bytes)
    const first = w.consume(need({ features: [gene('Aa'), gene('Bb')] }));
    await settle();
    await w.finish(0);
    first.leave();
    w.consume(need({ features: [gene('Cc')] }));
    await settle();
    await w.finish(1);                                        // Aa goes
    w.consume(need({ features: [gene('Aa'), gene('Bb')] }));
    await settle();
    assert.deepEqual(w.calls.compute[2].recipe.features.map((f) => f.name), ['Aa']);
});

test('a value for other cells is discarded and asked for again', async () => {
    const w = world();
    const c = w.consume(need({ codes: true }));
    await settle();
    await w.finish(0, { n: 5 });
    assert.equal(c.snap().values.reply.n_shown, 5);
    assert.equal(w.store.discard(c.key), true);
    await settle();
    assert.equal(w.calls.compute.length, 2);
    await w.finish(1);
    assert.equal(c.snap().values.reply.n_shown, CELLS);
    assert.equal(w.ledger.holds, 2);
    assert.equal(w.ledger.held.size, 1);
});

test('the estimate of a need covers all of it', async () => {
    const w = world();
    const n = need({ codes: true, features: [gene('Cd3e')] });
    await w.store.estimateFor(n, 'd.zarr', n.hash);
    assert.equal(w.calls.estimate[0].recipe.want.codes, true);
    assert.deepEqual(w.calls.estimate[0].recipe.features.map((f) => f.name), ['Cd3e']);
});

test('a grid is one entry, never with codes', async () => {
    const w = world();
    const grid = { shape: 'grid', mode: '1d', partitionings: [{ source: { type: 'obs', key: 'cell_type' } }], subset: null,
        want: { codes: false, histograms: [] } };
    const c = w.consume(S.groupNeed({ request: grid, key: 'grid-1' }));
    await settle();
    w.waiting[0].resolve({ header: { type: 'result', shape: 'grid', n_shown: CELLS,
        axes: [{ levels: [{ id: 'c:B cell', n: 4 }, { id: 'c:T cell', n: 2 }] }] }, values: { counts: Uint32Array.from([4, 2]) } });
    await settle();
    const snap = c.snap();
    assert.equal(snap.state, 'ready');
    assert.deepEqual([...snap.values.counts], [4, 2]);
    assert.deepEqual(snap.values.reply.axes[0].levels, ['c:B cell', 'c:T cell']);
    assert.equal(snap.values.codes, null);
});

test('codes take one byte a cell up to 255 groups, two above', () => {
    assert.equal(S.codeBytes(1000, 255), 1000);
    assert.equal(S.codeBytes(1000, 256), 2000);
});

test('a read of a ready key does no work that grows with its features', async () => {
    const w = world();
    const features = Array.from({ length: 2000 }, (_, i) => gene(`G${i}`));
    const c = w.consume(need({ features }));
    await settle();
    await w.finish(0);
    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) c.snap();
    const perRead = (performance.now() - t0) / 10000;
    assert.ok(perRead < 0.01, `a read took ${perRead.toFixed(4)} ms at 2,000 features`);
});

test('codes are pinned while a consumer on screen holds them; hidden they may be evicted, and come back when shown', async () => {
    const ledger = new Ledger();
    const w = world({ codes: ledger, cells: 1000 });
    let shown = true;
    const plot = w.consume(need({ codes: true }), { visible: () => shown });
    await settle();
    await w.finish(0);
    assert.equal(plot.snap().state, 'ready');
    const [name] = [...ledger.holdings.keys()];
    assert.deepEqual(ledger.holdings.get(name), { bytes: 1000, pinned: true, evict: ledger.holdings.get(name).evict });
    assert.equal(ledger.evict(), 0, 'pinned codes are never evicted');
    // hidden: still held and counted, but evictable
    shown = false;
    w.store.poke();
    assert.equal(ledger.holdings.get(name).pinned, false);
    assert.equal(ledger.heldBytes(), 1000);
    // shown again before any eviction: pinned again, nothing asked
    shown = true;
    w.store.poke();
    assert.equal(ledger.holdings.get(name).pinned, true);
    // hidden, and the guard needs the room: evicted, the consumer's value goes, and nothing is asked while hidden
    shown = false;
    w.store.poke();
    assert.equal(ledger.evict(), 1000);
    assert.equal(ledger.holdings.size, 0);
    assert.equal(w.store.stats().codesBytes, 0);
    await settle();
    assert.notEqual(plot.snap().state, 'ready');
    assert.equal(plot.snap().values, null);
    assert.equal(w.calls.compute.length, 1);
    // shown again: asked for again, the codes only (the group table is cached), and pinned once they are back
    shown = true;
    w.store.poke();
    await settle();
    assert.equal(w.calls.compute.length, 2);
    assert.equal(w.calls.compute[1].recipe.want.codes, true);
    await w.finish(1);
    assert.equal(plot.snap().state, 'ready');
    assert.equal(ledger.holdings.get(name).pinned, true);
    // released with the last holder
    plot.leave();
    assert.equal(ledger.holdings.size, 0);
});

test('two holders: pinned while either is on screen', async () => {
    const ledger = new Ledger();
    const w = world({ codes: ledger });
    let one = true;
    let two = false;
    w.consume(need({ codes: true }), { visible: () => one });
    w.consume(need({ codes: true, features: [gene('Cd3e')] }), { visible: () => two });
    await settle();
    await w.finish(0);
    // the second waits off screen; give it the codes held for the first
    two = true;
    w.store.poke();
    await settle();
    await w.finish(1);
    const [name] = [...ledger.holdings.keys()];
    one = false;
    w.store.poke();
    assert.equal(ledger.holdings.get(name).pinned, true);
    two = false;
    w.store.poke();
    assert.equal(ledger.holdings.get(name).pinned, false);
});

// --- the review's scenarios (G7b) -----------------------------------------------------------------------------------

test('M7: a consumer on screen that joins a hidden holder pins the codes at once, and unpins them when it leaves', async () => {
    const ledger = new Ledger();
    const w = world({ codes: ledger });
    let hiddenShown = true;
    const hidden = w.consume(need({ codes: true }), { visible: () => hiddenShown });
    await settle();
    await w.finish(0);
    hiddenShown = false;
    w.store.poke();
    const [name] = [...ledger.holdings.keys()];
    assert.equal(ledger.holdings.get(name).pinned, false);
    const shown = w.consume(need({ codes: true }), { visible: true });
    assert.equal(ledger.holdings.get(name).pinned, true, 'pinned on attach, with no poke');
    assert.equal(ledger.evict(), 0, 'a plot on screen is drawing them');
    shown.leave();
    assert.equal(ledger.holdings.get(name).pinned, false, 'unpinned when the plot on screen leaves');
    hidden.leave();
    assert.equal(ledger.holdings.size, 0);
});

test('H5: the store keeps the frame\'s queue, seconds running, entries and stage with the progress', async () => {
    const w = world();
    const c = w.consume(need());
    await settle();
    w.waiting[0].req.onProgress(0, 600, { type: 'start', queue: { ahead: 1, sharing: 0 } });
    assert.deepEqual(c.snap().progress, { done: 0, total: 600, queue: { ahead: 1, sharing: 0 } });
    w.waiting[0].req.onProgress(300, 600, { type: 'progress', stage: 'features', entries_done: 300, entries_total: 600,
        running_s: 2.25, queue: { ahead: 0, sharing: 1 } });
    assert.deepEqual(c.snap().progress, { done: 300, total: 600, stage: 'features', entries_done: 300, entries_total: 600,
        running_s: 2.25, queue: { ahead: 0, sharing: 1 } });
});

test('two keys that miss the same parts share one request: a link opens two plots and the codes come once', async () => {
    const w = world();
    // a gene of the grouping is cached; then a Cell Plot (codes) and a Cell-Gene Plot (codes and that gene) open
    const first = w.consume(need({ features: [gene('Cd3e')] }));
    await settle();
    await w.finish(0);
    first.leave();
    const plot = w.consume(need({ codes: true }));
    const cellGene = w.consume(need({ codes: true, features: [gene('Cd3e')] }));
    await settle();
    assert.equal(w.calls.compute.length, 2, 'one request for the codes both miss');
    assert.equal(w.calls.compute[1].recipe.want.codes, true);
    assert.equal(w.calls.compute[1].recipe.features, undefined);
    await w.finish(1);
    assert.equal(plot.snap().state, 'ready');
    assert.equal(cellGene.snap().state, 'ready');
    assert.equal(plot.snap().values.codes, cellGene.snap().values.codes, 'one copy of the codes');
    // one of them leaving while it computes does not stop it for the other
    plot.leave();
    cellGene.leave();
    const a = w.consume(need({ codes: true }));
    const b = w.consume(need({ codes: true, features: [gene('Cd3e')] }));
    await settle();
    assert.equal(w.calls.compute.length, 3);
    a.leave();
    await settle();
    assert.equal(w.waiting[2].req.signal.aborted, false, 'the other still waits on it');
    await w.finish(2);
    assert.equal(b.snap().state, 'ready');
    b.leave();
    assert.equal(w.store.stats().codesBytes, 0);
});
