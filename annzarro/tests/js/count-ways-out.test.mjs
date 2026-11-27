/**
 * T-CAP (aggregation-unify-080.md 14.8): the ways out of a hard cap, `waysOut` of utils/count-plot-model.js. Pure: a
 * refused plan in, the buttons out, each one that would draw, the least destructive first, at most three.
 *
 * Run:  node --test annzarro/tests/js/count-ways-out.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { Policy } = await import('../../../static/js/policy.js');
const M = await import('../../../static/js/utils/count-plot-model.js');

async function serve(values) {
    globalThis.fetch = async () => ({
        ok: true, status: 200, headers: { get: () => 'v-test' },
        json: async () => ({ version: `v-${JSON.stringify(values)}`, values })
    });
    await Policy.load();
}
test.afterEach(async () => { await serve({}); });

const obs = (key, extra = {}) => ({ source: { type: 'obs', key }, ...extra });
const LEVELS = { sample: 46, cell_type: 14, age: 12, condition: 2, huge: 300 };
const NUMERIC = new Set(['depth', 'pseudotime']);
const ctx = { isNumeric: (s) => NUMERIC.has(s.key), levelCount: (p) => LEVELS[p.source.key] ?? null, subset: null };
const config = (raw) => M.normalizeCountPlot({ version: 1, ...raw }).config;
const ways = (raw, c = ctx) => {
    const cfg = config(raw);
    return { cfg, plan: M.planGrid(cfg, c), ways: M.waysOut(cfg, M.planGrid(cfg, c), c) };
};

test('46 levels under grid_2d_split 8: split by another column, then each view that reads the split and passes', () => {
    const r = ways({ mode: 'hist2d', x: obs('depth'), y: obs('pseudotime'), split: obs('sample') });
    assert.deepEqual([r.plan.reason, r.plan.counts.at(-1), r.plan.limits.at(-1), r.plan.over], ['too_many_levels', 46, 8, ['split']]);
    assert.deepEqual(r.ways, [{ kind: 'picker', field: 'split' }, { kind: 'mode', mode: 'bar' }]);
});

test('every way is checked: a view that would itself be refused is not offered', () => {
    // 300 levels: over the 200 a Bar's split takes (and a Heatmap has no split to put them in): only the picker is left
    const r = ways({ mode: 'hist2d', x: obs('depth'), y: obs('pseudotime'), split: obs('huge') });
    assert.deepEqual(r.ways, [{ kind: 'picker', field: 'split' }]);
    for (const w of ways({ mode: 'hist2d', x: obs('depth'), y: obs('pseudotime'), split: obs('sample') }).ways.filter((x) => x.kind === 'mode')) {
        const shown = M.planGrid({ ...r.cfg, mode: w.mode, split: obs('sample') }, ctx);
        assert.equal(shown.state, 'ready', w.mode);
    }
});

test('a histogram split by 300 levels is over a Bar\'s split too: the picker only; a Heatmap is never offered for a split', () => {
    const r = ways({ mode: 'histogram', x: obs('depth'), split: obs('huge') });
    assert.deepEqual(r.ways, [{ kind: 'picker', field: 'split' }]);
    for (const mode of ['hist2d', 'density2d', 'histogram', 'density']) {
        const w = ways({ mode, x: obs('depth'), y: obs('pseudotime'), split: obs('huge') });
        assert.ok(!w.ways.some((x) => x.mode === 'heatmap'), mode);
    }
});

test('bins over the cap: Fewer bins, as many as the cap allows', () => {
    const r = ways({ mode: 'hist2d', x: obs('depth', { binning: { method: 'equal_width', bins: 600 } }), y: obs('pseudotime') });
    assert.equal(r.plan.reason, 'too_many_bins');
    assert.deepEqual(r.ways, [{ kind: 'bins', bins: { x: 512 } }]);
    const both = ways({ mode: 'hist2d', x: obs('depth', { binning: { method: 'equal_width', bins: 600 } }),
        y: obs('pseudotime', { binning: { method: 'equal_width', bins: 700 } }) });
    assert.deepEqual(both.ways, [{ kind: 'bins', bins: { x: 512, y: 512 } }]);
    const applied = M.withFewerBins(both.cfg, both.ways[0].bins);
    assert.equal(M.planGrid(applied, ctx).state, 'ready');
    assert.equal(applied.x.binning.bins, 512);
});

test('a manual binning has no count to lower: no Fewer bins for it', () => {
    const r = ways({ mode: 'histogram', x: obs('depth', { binning: { method: 'manual', thresholds: Array.from({ length: 2100 }, (_, i) => i) } }) });
    assert.equal(r.plan.reason, 'too_many_bins');
    assert.deepEqual(r.ways, []);
});

test('a grid over grid_cells: fewer bins on the binned axes, the largest count whose grid fits', async () => {
    await serve({ 'limits.grid_cells': 10000 });
    const r = ways({ mode: 'hist2d', x: obs('depth', { binning: { method: 'equal_width', bins: 100 } }),
        y: obs('pseudotime', { binning: { method: 'equal_width', bins: 100 } }), split: obs('condition') });
    assert.equal(r.plan.reason, 'grid_too_large');
    assert.deepEqual(r.ways, [{ kind: 'bins', bins: { x: 70, y: 70 } }]);           // 70 x 70 x 2 = 9,800 <= 10,000
    assert.equal(M.planGrid(M.withFewerBins(r.cfg, r.ways[0].bins), ctx).state, 'ready');
});

test('no way out where no edit of the config lifts the cap', () => {
    const sets = Array.from({ length: 17 }, (_, i) => ({ source: { type: 'table', key: `t${i}` } }));
    const cfg = config({ mode: 'upset', sets });
    const plan = M.planGrid(cfg, { ...ctx, memberFor: () => ({ levels: ['@in'] }) });
    assert.equal(plan.reason, 'too_many_sets');
    assert.deepEqual(M.waysOut(cfg, plan, ctx), []);
    assert.deepEqual(M.waysOut(cfg, null, ctx), []);
    assert.deepEqual(M.waysOut(cfg, { state: 'ready' }, ctx), []);
});

test('a Most frequent level over its cap is not a split: it has its own way out (Remove)', () => {
    const r = ways({ mode: 'hist2d', x: obs('depth'), y: obs('pseudotime'), value: { kind: 'top_level', factor: obs('sample') } });
    assert.deepEqual([r.plan.reason, r.plan.over], ['too_many_levels', ['factor']]);
    assert.deepEqual(r.ways, []);
});

test('at most three, and the picker comes first', () => {
    const r = ways({ mode: 'density2d', x: obs('depth'), y: obs('pseudotime'), split: obs('sample') });
    assert.ok(r.ways.length <= 3);
    assert.equal(r.ways[0].kind, 'picker');
});

test('the caps are the served ones: at grid_2d_split 64 the 46 levels draw and there is nothing to offer', async () => {
    await serve({ 'limits.grid_2d_split': 64 });
    const r = ways({ mode: 'hist2d', x: obs('depth'), y: obs('pseudotime'), split: obs('sample') });
    assert.equal(r.plan.state, 'ready');
    assert.deepEqual(r.ways, []);
});

test('inputSizes: a binned number by its bins, a category by the count the page knows (null when it does not)', () => {
    const cfg = config({ mode: 'hist2d', x: obs('depth'), y: obs('pseudotime', { binning: { method: 'equal_width', bins: 30 } }), split: obs('condition') });
    assert.deepEqual(M.inputSizes(cfg, ctx), { x: 100, y: 30, split: 2 });
    const unknown = M.inputSizes(cfg, { ...ctx, levelCount: () => null });
    assert.equal(unknown.split, null);
});

test('a grid over grid_cells the route counted: the others are what its count says, and Fewer bins must make it fit', () => {
    const cfg = config({ mode: 'hist2d', x: obs('depth'), y: obs('pseudotime'), split: obs('condition') });
    const refusal = { state: 'refused', reason: 'grid_too_large', mode: 'hist2d', inputs: ['x', 'y', 'split'], counts: [20000], limits: [4000], over: [], others: 2 };
    const unknownLevels = { ...ctx, levelCount: () => null };
    // the page does not know the split's levels: the route's count (20,000 over 100 x 100) says they make 2
    return (async () => {
        await serve({ 'limits.grid_cells': 4000 });
        assert.deepEqual(M.waysOut(cfg, refusal, unknownLevels), [{ kind: 'bins', bins: { x: 44, y: 44 } }]);
        // nothing binned: no way out
        const cat = config({ mode: 'bar', x: obs('cell_type'), split: obs('condition') });
        assert.deepEqual(M.waysOut(cat, { ...refusal, mode: 'bar', inputs: ['x', 'split'], others: 9000 }, ctx), []);
    })();
});
