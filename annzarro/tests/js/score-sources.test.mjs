/**
 * Dependants of a signature's score and what an edit does to them
 * (static/js/utils/score-sources.js, score-notices.js): the applied recipe,
 * live updates under `live_max_s`, edits held behind Update score from it, the
 * previous score kept meanwhile, deletion, a new subset, and every sentence of
 * the notices.
 *
 * Run:  node --test annzarro/tests/js/score-sources.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../../../static/js/utils/score-store.js');
const D = await import('../../../static/js/utils/score-sources.js');
const N = await import('../../../static/js/utils/score-notices.js');
const G = await import('../../../static/js/utils/gene-signature.js');

const settle = () => new Promise(resolve => setTimeout(resolve, 5));

function world({ estimateSeconds = () => 2, tierOf = () => 'auto', cells = 3 } = {}) {
    const calls = { estimate: [], compute: [] };
    const waiting = [];
    const api = {
        async estimate({ recipe }) {
            calls.estimate.push(recipe.genes.slice());
            if (recipe.input === 'nope') throw Object.assign(new Error("This dataset has no layer 'nope'."), { status: 404, reason: 'key_not_found' });
            const seconds = estimateSeconds(recipe);
            return { estimate: { seconds, tier: tierOf(seconds), auto_max_s: 60, max_s: 600, live_max_s: 5 } };
        },
        compute(req) {
            calls.compute.push(req);
            return new Promise((resolve, reject) => {
                waiting.push({ req, resolve });
                req.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
            });
        }
    };
    const store = S.createScoreStore({ api });
    const sigs = new Map();
    const ctx = { dataset: 'd.zarr', subset: null };
    const timers = [];
    const sources = D.createScoreSources({
        store,
        signatures: { get: (id) => sigs.get(id) || null, off: () => false },
        context: () => ({ ...ctx }),
        liveDelayMs: 10,
        setTimer: (fn, ms) => { const t = { fn, ms, off: false }; timers.push(t); return t; },
        clearTimer: (t) => { if (t) t.off = true; }
    });
    const add = (id, title, genes, extra = {}) => {
        const sig = { title, recipe: () => G.normalizeRecipe({ genes: sig.genes, ...extra }).recipe, genes };
        sigs.set(id, sig);
        return sig;
    };
    const fire = async () => {          // let the edit pause end
        for (const t of timers.splice(0)) if (!t.off) await t.fn();
        await settle();
    };
    const finish = (i, n = cells, header = { n_used: 2 }) => waiting[i].resolve({ header, values: new Float32Array(n).fill(i + 1) });
    return { calls, store, sources, sigs, ctx, add, fire, finish, waiting };
}

const watch = (w, id, extra = {}) => {
    const states = [];
    const handle = w.sources.watch(id, { onChange: (s) => states.push(s), kind: 'plot', ...extra });
    return { handle, states };
};

test('a closed or restored signature computes when a dependant reads it, with nothing else open', async () => {
    const w = world();
    w.add('S1', 'T cell score', ['CD3D', 'CD3E']);
    const { handle } = watch(w, 'S1');
    assert.equal(handle.read().state, 'estimating', 'the first read starts the work');
    await settle();
    assert.equal(handle.read().state, 'computing');
    w.finish(0);
    await settle();
    const snap = handle.read();
    assert.equal(snap.state, 'ready');
    assert.equal(snap.values.length, 3);
    assert.equal(snap.title, 'T cell score');
});

test('two plots of one signature share the score: one estimate, one request', async () => {
    const w = world();
    w.add('S1', 'T', ['A']);
    const a = watch(w, 'S1'), b = watch(w, 'S1');
    a.handle.read(); b.handle.read();
    await settle();
    w.finish(0);
    await settle();
    assert.equal(w.calls.compute.length, 1);
    assert.equal(a.handle.read().state, 'ready');
    assert.equal(b.handle.read().state, 'ready');
    assert.equal(a.handle.sharers(), 2);
});

test('renaming changes nothing the score depends on: no request, the new title shows', async () => {
    const w = world();
    const sig = w.add('S1', 'T', ['A']);
    const { handle } = watch(w, 'S1');
    handle.read();
    await settle();
    w.finish(0);
    await settle();
    sig.title = 'T cell score';
    assert.equal(handle.read().title, 'T cell score');
    assert.equal(handle.read().state, 'ready');
    assert.equal(w.calls.compute.length, 1);
});

test('an edit under live_max_s updates the dependants after a short pause, keeping the previous score meanwhile', async () => {
    const w = world({ estimateSeconds: () => 2 });
    const sig = w.add('S1', 'T', ['A']);
    const { handle, states } = watch(w, 'S1');
    handle.read();
    await settle();
    w.finish(0);
    await settle();
    sig.genes = ['A', 'B'];
    w.sources.recipeChanged('S1');
    assert.equal(handle.read().state, 'ready', 'still the previous recipe until the pause ends');
    assert.equal(handle.read().held, null, 'a live edit is not held');
    await w.fire();                                  // pause ends, estimate 2 s < 5 s
    const mid = handle.read();
    assert.equal(mid.state, 'updating');
    assert.equal(mid.previous, true);
    assert.equal(mid.values[0], 1, 'the previous values');
    await settle();
    w.finish(1);
    await settle();
    const done = handle.read();
    assert.equal(done.state, 'ready');
    assert.equal(done.values[0], 2);
    assert.ok(states.length > 0, 'the dependant was told');
});

test('an edit at live_max_s or more is held behind Update score; the dependants keep the previous score', async () => {
    const w = world({ estimateSeconds: (r) => (r.genes.length > 1 ? 40 : 2) });
    const sig = w.add('S1', 'T', ['A']);
    const { handle } = watch(w, 'S1');
    handle.read();
    await settle();
    w.finish(0);
    await settle();
    sig.genes = ['A', 'B'];
    w.sources.recipeChanged('S1');
    sig.genes = ['A', 'B', 'C'];
    w.sources.recipeChanged('S1');
    sig.genes = ['A', 'B', 'C', 'D'];
    w.sources.recipeChanged('S1');
    await w.fire();
    const snap = handle.read();
    assert.equal(snap.state, 'ready');
    assert.deepEqual(snap.held, { edits: 3, seconds: 40 }, '3 changes not applied, about 40 s');
    assert.equal(snap.values[0], 1, 'the previous score is still shown');
    assert.equal(w.calls.compute.length, 1, 'nothing was computed for the edits');
    assert.deepEqual(w.sources.status('S1').held, { edits: 3, seconds: 40 });
    // Update score
    assert.equal(w.sources.update('S1'), true);
    assert.equal(handle.read().held, null);
    assert.equal(handle.read().state, 'updating');
    await settle();
    assert.equal(w.calls.compute.length, 2);
    assert.deepEqual(w.calls.compute[1].recipe.genes, ['A', 'B', 'C', 'D']);
});

test('an edit undone before the pause ends costs nothing, and one undone while held clears the hold', async () => {
    const w = world({ estimateSeconds: () => 40 });
    const sig = w.add('S1', 'T', ['A']);
    const { handle } = watch(w, 'S1');
    handle.read();
    await settle();
    w.finish(0);
    await settle();
    sig.genes = ['A', 'B'];
    w.sources.recipeChanged('S1');
    await w.fire();
    assert.ok(handle.read().held);
    sig.genes = ['A'];                       // Undo
    w.sources.recipeChanged('S1');
    assert.equal(handle.read().held, null);
    await w.fire();
    assert.equal(w.calls.compute.length, 1);
});

test('a held edit that lands in the 60 s to 10 minute tier asks for one click after Update score', async () => {
    const w = world({ estimateSeconds: (r) => (r.genes.length > 1 ? 120 : 2), tierOf: (s) => (s > 60 ? 'confirm' : 'auto') });
    const sig = w.add('S1', 'T', ['A']);
    const { handle } = watch(w, 'S1');
    handle.read();
    await settle();
    w.finish(0);
    await settle();
    sig.genes = ['A', 'B'];
    w.sources.recipeChanged('S1');
    await w.fire();
    w.sources.update('S1');
    handle.read();
    await settle();
    const snap = handle.read();
    assert.equal(snap.state, 'awaiting');
    assert.equal(snap.estimate.seconds, 120);
    assert.equal(handle.compute(), true);
    await settle();
    assert.equal(w.calls.compute.at(-1).confirm, true);
});

test('a signature that is gone is "deleted", and one that returns resolves again from the cache', async () => {
    const w = world();
    const sig = w.add('S1', 'T', ['A']);
    const { handle } = watch(w, 'S1');
    handle.read();
    await settle();
    w.finish(0);
    await settle();
    w.sigs.delete('S1');
    assert.equal(handle.read().state, 'deleted');
    assert.equal(handle.read().title, 'T', 'it says which signature');
    w.sigs.set('S1', sig);
    assert.equal(handle.read().state, 'ready');
    assert.equal(w.calls.compute.length, 1);
});

test('a signature with no genes has no score and asks nothing of the server', async () => {
    const w = world();
    w.add('S1', 'T', []);
    const { handle } = watch(w, 'S1');
    assert.equal(handle.read().state, 'nogenes');
    await settle();
    assert.equal(w.calls.estimate.length, 0);
});

test('a new subset or dataset is a new key; the previous values are not shown for other cells', async () => {
    const w = world();
    w.add('S1', 'T', ['A']);
    const { handle } = watch(w, 'S1');
    handle.read();
    await settle();
    w.finish(0);
    await settle();
    w.ctx.subset = 'k2';
    w.sources.contextChanged();
    const snap = handle.read();
    assert.notEqual(snap.state, 'ready');
    assert.equal(snap.values, undefined, 'values of other cells are not kept');
    await settle();
    assert.equal(w.calls.compute.length, 2);
    assert.equal(w.calls.compute[1].subset, 'k2');
    // the old key is not needed by anyone now: its score stays cached for Back
    w.ctx.subset = null;
    w.sources.contextChanged();
    assert.equal(handle.read().state, 'ready');
    assert.equal(w.calls.compute.length, 2, 'going back makes no request');
});

test('releasing the last dependant aborts the work', async () => {
    const w = world();
    w.add('S1', 'T', ['A']);
    const { handle } = watch(w, 'S1');
    handle.read();
    await settle();
    handle.release();
    await settle();
    assert.equal(w.calls.compute[0].signal.aborted, true);
    assert.equal(w.sources.appliedOf('S1'), null, 'the applied recipe is forgotten with the last dependant');
});

test('a signature turned off by the administrator says so', async () => {
    const store = S.createScoreStore({ api: { estimate: async () => ({}), compute: async () => ({}) } });
    const sources = D.createScoreSources({ store, signatures: { get: () => null, off: () => true },
        context: () => ({ dataset: 'd', subset: null }) });
    const handle = sources.watch('S1', { onChange() {}, kind: 'plot' });
    assert.equal(handle.read().state, 'off');
});

// ---------------------------------------------------------------- wording

test('each state has its sentence, tag and actions (design 7.3)', () => {
    const t = (state, extra = {}, role = 'colour') => N.describeScore({ state, title: 'T cell score', ...extra }, { role });
    const computing = t('computing', { progress: { done: 31, total: 50 } });
    assert.equal(computing.headline, "Computing 'T cell score': 31 of 50 genes. This plot has no color.");
    assert.equal(computing.tag.text, 'Score computing');
    assert.deepEqual(computing.actions, [['score-cancel', 'Cancel']]);
    assert.equal(N.describeScore({ state: 'computing', title: 'T cell score', progress: { done: 1, total: 2 } }, { role: 'x' }).headline,
        "Computing 'T cell score': 1 of 2 genes.", 'an axis does not talk about colour');
    assert.equal(N.describeScore({ state: 'computing', title: 'T' }, { sharers: 3 }).actions[0][1], 'Cancel for 3 plots');
    assert.equal(t('queued').headline, "'T cell score' is waiting for another score to finish. This plot has no color.");
    assert.equal(t('awaiting', { estimate: { seconds: 125 } }).headline, "'T cell score' will take about 2 minutes. This plot has no color.");
    assert.deepEqual(t('awaiting', { estimate: { seconds: 125 } }).actions[0], ['score-compute', 'Compute']);
    assert.equal(t('cancelled').headline, "'T cell score' was cancelled. This plot has no color.");
    const refused = t('refused', { estimate: { seconds: 1500 }, message: 'This score would take about 25 minutes; the limit is 10. Use fewer genes.' });
    assert.equal(refused.headline, "'T cell score' would take about 25 minutes, so it was not run.");
    assert.match(refused.text, /Use fewer genes/);
    assert.deepEqual(refused.actions.map(a => a[0]), ['score-open', 'score-choose']);
    // a refusal for something else than cost never quotes the estimate: a limit of the grouping, one the page has its words for
    const cheap = { seconds: 1.2, tier: 'auto', max_s: 600 };
    const size = t('refused', { reason: 'too_many_values', estimate: cheap });
    assert.doesNotMatch(size.headline, /would take|second/i, size.headline);
    assert.match(size.text, /too many values/);
    const cost = t('refused', { reason: 'score_too_expensive', estimate: { seconds: 1500, tier: 'refused', max_s: 600 }, message: 'x' });
    assert.equal(cost.headline, "'T cell score' would take about 25 minutes, so it was not run.");
    const lie = t('refused', { reason: 'score_too_expensive', estimate: { seconds: 1.2, tier: 'refused', max_s: 600 }, message: 'x' });
    assert.doesNotMatch(lie.headline, /second/i, 'a cost refusal under the limit does not claim a duration');
    const failed = t('failed', { message: 'The server stopped responding.' });
    assert.equal(failed.headline, "'T cell score' could not be computed: The server stopped responding.");
    assert.deepEqual(failed.actions[0], ['score-retry', 'Retry']);
    assert.equal(t('deleted').headline, "Signature 'T cell score' was deleted.");
    assert.deepEqual(t('deleted').actions, [['score-choose', 'Choose another']]);
    assert.equal(t('nogenes').headline, "'T cell score' has no genes yet.");
    assert.equal(t('noscore', { reason: 'no_gene_present' }).headline, "None of the genes of 'T cell score' are in this dataset.");
    assert.equal(t('off').headline, 'Gene signatures are turned off on this server.');
    assert.equal(t('updating').headline, "Showing the previous 'T cell score'. Updating.");
    const held = t('ready', { held: { edits: 3, seconds: 40 } });
    assert.equal(held.headline, "Showing the previous 'T cell score'. 3 changes are not applied. About 40 seconds.");
    assert.deepEqual(held.actions, [['score-update', 'Update score']]);
    assert.equal(held.blocksAxis, false, 'a held edit never hides a plot');
    assert.equal(t('ready'), null, 'a ready score says nothing');
    for (const state of ['computing', 'queued', 'awaiting', 'cancelled', 'refused', 'failed', 'deleted', 'nogenes', 'noscore', 'updating', 'off']) {
        assert.ok(t(state).tag.text.length <= 20, `${state}: the strip tag is short`);
    }
});

test('how long a score takes is said in seconds up to a minute and a half, then minutes', () => {
    assert.equal(N.durationText(1), 'about 1 second');
    assert.equal(N.durationText(40), 'about 40 seconds');
    assert.equal(N.durationText(125), 'about 2 minutes');
    assert.equal(N.durationText(1500), 'about 25 minutes');
    assert.equal(N.durationText(null), 'a while');
});

test('of several scores a plot states the worst', () => {
    const t = (state) => N.describeScore({ state, title: 'T' }, {});
    assert.equal(N.worstNotice([t('computing'), t('failed'), null]).state, 'failed');
    assert.equal(N.worstNotice([null, null]), null);
    assert.equal(N.worstNotice([t('updating'), t('computing')]).state, 'computing');
    // a state the list does not rank is the least urgent, never the most
    assert.equal(N.worstNotice([{ state: 'someday' }, t('updating')]).state, 'updating');
    assert.equal(N.worstNotice([{ state: 'someday' }]).state, 'someday');
});

test('who uses a source: plots and tables by method and by layer; Inspect and its export are not consumers', () => {
    const w = world();
    w.add('S1', 'T', ['A']);
    const watchAs = (kind, role, sub, layer) => w.sources.watch('S1', { onChange: () => {}, kind, role, sub, layer });
    watchAs('plot', 'color', 'mean', 'X');
    watchAs('plot', 'x', 'mean', 'counts');
    watchAs('table', 'column', 'mean', 'X');
    watchAs('plot', 'hover:S1:zscore_mean:', 'zscore_mean', null);
    const inspect = watchAs('inspect', 'inspect', 'sum', 'X');
    const exporting = watchAs('inspect-export', 'inspect-export', 'fraction_of_genes', 'X');
    const byValue = (rows) => Object.fromEntries(rows.map(r => [r.value, [r.plots, r.tables]]));
    assert.deepEqual(byValue(w.sources.usage('S1', 'method')), { mean: [2, 1], zscore_mean: [1, 0] });
    assert.deepEqual(byValue(w.sources.usage('S1', 'layer')), { X: [1, 1], counts: [1, 0], null: [1, 0] });
    assert.deepEqual(w.sources.consumersOf('S1').map(h => h.role), ['color', 'x', 'column', 'hover:S1:zscore_mean:']);
    inspect.release();
    exporting.release();
    assert.deepEqual(w.sources.usage('nobody', 'method'), []);
});

test('a grouping is a consumer counted apart from plots and tables', () => {
    const w = world();
    w.add('S1', 'T', ['A']);
    const as = (kind, sub, layer) => w.sources.watch('S1', { onChange: () => {}, kind, sub, layer });
    as('plot', 'mean', 'X');
    as('table', 'mean', 'X');
    const g1 = as('grouping', 'mean', 'X');
    as('grouping', 'sum', 'counts');
    const rows = Object.fromEntries(w.sources.usage('S1', 'method').map(r => [r.value, [r.plots, r.tables, r.groupings]]));
    assert.deepEqual(rows, { mean: [1, 1, 1], sum: [0, 0, 1] });
    assert.equal(w.sources.consumersOf('S1').length, 4);
    g1.release();
    assert.equal(w.sources.consumersOf('S1').length, 3);
});

test('watch requires a known consumer kind', () => {
    const w = world();
    w.add('S1', 'T', ['A']);
    assert.throws(() => w.sources.watch('S1', { onChange() {} }), /Unknown consumer kind 'undefined'/);
    assert.throws(() => w.sources.watch('S1', { onChange() {}, kind: 'heatmap' }), /Unknown consumer kind 'heatmap'/);
    assert.equal(w.sources.handlesOf('S1').length, 0, 'a refused watch leaves no handle behind');
});

test('each aggregation of a signature is its own score; the same aggregation is shared; an edit follows both', async () => {
    const w = world();
    const sig = w.add('S1', 'T', ['A']);
    const z = watch(w, 'S1', { sub: 'zscore_mean' }), m1 = watch(w, 'S1', { sub: 'mean' }), m2 = watch(w, 'S1', { sub: 'mean' });
    const none = watch(w, 'S1');                              // no sub: the default
    for (const h of [z, m1, m2, none]) h.handle.read();
    await settle();
    assert.deepEqual(w.calls.compute.map(c => c.recipe.method).sort(), ['mean', 'zscore_mean'], 'two scores, not four');
    w.finish(0); w.finish(1);
    await settle();
    assert.equal(z.handle.read().key, none.handle.read().key, 'no sub is the z-score mean');
    assert.notEqual(z.handle.read().key, m1.handle.read().key);
    assert.equal(m1.handle.read().key, m2.handle.read().key);
    assert.equal(z.handle.read().state, 'ready');
    // the aggregation is not part of the signature: an edit is one edit for both
    sig.genes = ['A', 'B'];
    w.sources.recipeChanged('S1');
    await w.fire();
    await settle();
    assert.equal(w.calls.compute.length, 4, 'both aggregations recomputed once');
});

// a score of another length than the cells shown is never waited on in silence ---------------------

test('a score for other cells is asked for again once, then stated as failed with Retry', async () => {
    const w = world({ cells: 3 });
    w.ctx.cells = 5;                                  // five cells are shown; the server answers three values
    w.add('S1', 'T cell score', ['CD3D']);
    const { handle } = watch(w, 'S1');
    handle.read();
    await settle(); await settle();
    w.finish(0, 3);
    await settle();
    // the first look discards it and asks again
    handle.read();
    await settle();
    assert.equal(w.waiting.length, 2, 'one more request for the current cells');
    w.finish(1, 3);
    await settle();
    const snap = handle.read();
    assert.equal(snap.state, 'failed');
    assert.equal(snap.reason, 'cells_mismatch');
    assert.equal(snap.message, 'the score has 3 values for 5 cells');
    assert.equal(snap.values, undefined, 'the values are not shown');
    const words = N.describeScore({ ...snap, title: 'T cell score' });
    assert.equal(words.headline, "'T cell score' could not be computed: the score has 3 values for 5 cells.");
    assert.deepEqual(words.actions.map(a => a[0]), ['score-retry', 'score-open']);
    // Retry asks once more, and when the cells now fit the score is shown
    w.ctx.cells = 3;
    assert.equal(handle.retry(), true);
    await settle(); await settle();
    w.finish(2, 3);
    await settle();
    assert.equal(handle.read().state, 'ready');
});

test('a score whose length fits is untouched, and an unknown cell count checks nothing', async () => {
    const w = world();
    w.add('S1', 'T', ['CD3D']);
    const { handle } = watch(w, 'S1');
    w.ctx.cells = 3;
    handle.read(); await settle(); await settle();
    w.finish(0, 3);
    await settle();
    assert.equal(handle.read().state, 'ready');
    assert.equal(w.waiting.length, 1);
    w.ctx.cells = null;
    assert.equal(handle.read().state, 'ready');
});

test('the consumer\'s layer is the request\'s input: two layers are two scores, one layer shared, none is the signature\'s own', async () => {
    const w = world();
    w.add('S1', 'T', ['A'], { input: 'X' });
    const hs = [watch(w, 'S1', { layer: 'counts' }), watch(w, 'S1', { layer: 'counts' }), watch(w, 'S1', { layer: 'log1p' }),
        watch(w, 'S1'), watch(w, 'S1', { layer: 'X' })];
    for (const h of hs) h.handle.read();
    await settle();
    w.finish(0); w.finish(1);                      // two at a time: the third waits for a slot
    await settle();
    assert.deepEqual(w.calls.compute.map(c => c.recipe.input).sort(), ['X', 'counts', 'log1p'], 'X given twice (own and explicit) is one score');
    assert.equal(hs[0].handle.read().key, hs[1].handle.read().key);
    assert.equal(hs[3].handle.read().key, hs[4].handle.read().key);
});

test('a layer the dataset does not have is its own state, from the server\'s not-found reply', async () => {
    const w = world();
    w.add('S1', 'T', ['A']);
    const { handle } = watch(w, 'S1', { layer: 'nope' });
    handle.read();
    await settle();
    const snap = handle.read();
    assert.equal(snap.state, 'nolayer');
    assert.equal(snap.layer, 'nope');
    const note = N.describeScore({ ...snap, title: 'T' }, { role: 'x' });
    assert.equal(note.headline, "Layer 'nope' is not in this dataset, so 'T' has no score.");
    assert.equal(note.tag.text, 'Layer not found');
    assert.deepEqual(note.actions.map(a => a[0]), ['score-open', 'score-choose']);
});

test('decision 31: a consumer on any method and layer is simply valid: no "Not offered" state, the adapter asks nothing', async () => {
    const w = world();
    w.add('S1', 'T', ['A']);
    // a signature adapter that still says what it would offer is not asked: there is no such question any more
    const sources = D.createScoreSources({ store: w.store, signatures: { get: (id) => w.sigs.get(id) || null, off: () => false,
        offers: () => { throw new Error('offers is not asked'); } }, context: () => ({ ...w.ctx }) });
    const handle = sources.watch('S1', { onChange() {}, kind: 'plot', sub: 'mean', layer: 'counts' });
    handle.read();
    await settle();
    w.finish(0);
    await settle();
    const snap = handle.read();
    assert.equal(snap.state, 'ready');
    assert.equal(snap.lapsed, undefined);
    assert.equal(N.describeScore({ ...snap, title: 'T' }, { role: 'x' }), null, 'a ready score says nothing');
});
