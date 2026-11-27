/**
 * C2a: a count plot's reply read with its groupings' names (group-sources.js `replyOf`) after its config changed. The
 * names of a reply follow the renames of the recipe now, which a grouping's recipe has and a grid's config does not:
 * reading a grid's reply must never take the grid's config for a grouping's recipe.
 *
 * Run:  node --test annzarro/tests/js/group-sources-grid.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const GS = await import('../../../static/js/utils/group-sources.js');
const { createGroupStore } = await import('../../../static/js/utils/group-store.js');
const { createLimiter } = await import('../../../static/js/utils/derived-store.js');
const CP = await import('../../../static/js/utils/count-plot-model.js');

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const obs = (key) => ({ source: { type: 'obs', key } });

test('a grid\'s reply is read with its names after a style edit of its config, and after a mode change', async () => {
    const waiting = [];
    const api = {
        async estimate() { return { estimate: { seconds: 0.1, tier: 'live', live_max_s: 5, auto_max_s: 60, max_s: 600 } }; },
        compute(req) { return new Promise((resolve) => waiting.push({ req, resolve })); }
    };
    const store = createGroupStore({ api, limiter: createLimiter(2) });
    const shape = CP.gridShape({ isNumeric: () => false, levelCount: () => 2 });
    const plot = { raw: { version: 1, mode: 'bar', x: obs('cell_type') } };
    const timers = [];
    const sources = GS.createGroupSources({
        store, context: () => ({ dataset: 'd', subset: null, cells: 6 }), liveDelayMs: 10,
        setTimer: (fn) => { timers.push(fn); return fn; }, clearTimer: () => {},
        host: { source: (id) => (id === 'c1' ? { title: 'Count 1', kind: 'count', recipe: () => plot.raw, shape } : null),
            upstream: () => null, cycleOf: () => null, titleOf: (id) => id, kindOf: () => 'plot', sourceTitle: () => undefined }
    });
    const h = sources.watch('c1', { consumer: { kind: 'plot', panelId: 'c1' }, option: {}, visible: () => true, onChange: () => {} });
    h.read();
    await settle();
    const axes = [{ levels: [{ id: 'c:B cell', n: 4 }, { id: 'c:T cell', n: 2 }], n_outside: [0, 0] }];
    waiting[0].resolve({ header: { type: 'result', shape: 'grid', n_shown: 6, n_counted: 6, axes }, values: { counts: Uint32Array.from([4, 2]) } });
    await settle();
    const first = h.read();
    assert.equal(first.state, 'ready');
    assert.deepEqual(sources.replyOf('c1', first.values.reply).axes[0].levels, ['c:B cell', 'c:T cell']);
    for (const raw of [{ ...plot.raw, arrangement: 'fill' }, { ...plot.raw, mode: 'pie' }]) {
        plot.raw = raw;
        sources.sourceChanged('c1');
        for (const fn of timers.splice(0)) await fn();
        await settle();
        const snap = h.read();
        assert.equal(snap.state, 'ready', raw.mode);
        assert.deepEqual(sources.replyOf('c1', snap.values.reply).axes[0].levels, ['c:B cell', 'c:T cell'], raw.mode);
    }
});
