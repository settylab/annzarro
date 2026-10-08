/**
 * The browser memory guard (static/js/utils/memory-guard.js): its settings,
 * the ceilings it reads from the browser, the cost models, the ledger of
 * what the open panels hold, the check, the subset prediction across every
 * open plot, and the crash marker.
 *
 * Run:  node --test annzarro/tests/js/memory-guard.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
    GB, MB, memorySettings, readLimits, HEAP_USABLE_SHARE, FALLBACK_HEAP_GB, MAX_WEBGL_CONTEXTS, CONTEXTS_PER_PLOT,
    REMOTE_TOTAL_GB, LARGEST_TESTED_POINTS, colourKind, panelCost, exportCost, snapshotCost, recolourCost, Ledger, check, headroom, largestFitting,
    predictSubsetChange, formatGB, headroomLine, markPending, clearPending, takeCrashed, learnedMargin,
    learnFromCrash, DEFAULT_MODEL, DEFAULT_SETTINGS, zero
} = await import('../../../static/js/utils/memory-guard.js');

/** Chrome 153 on the benchmark laptop (heapcap_rerun.jsonl). */
const CHROME = { performance: { memory: { jsHeapSizeLimit: 4395630592, usedJSHeapSize: 1e8 } }, navigator: { deviceMemory: 8 } };
const FIREFOX = { performance: {}, navigator: {} };

function storage() {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m };
}

test('ui.memory settings: defaults, YAML booleans, and malformed values fall back', () => {
    assert.deepEqual(memorySettings(undefined), { ...DEFAULT_SETTINGS, hostBytes: null });
    assert.equal(memorySettings({ host_memory_bytes: 16e9 }).hostBytes, 16e9);
    assert.equal(memorySettings({ host_memory_bytes: 'x' }).hostBytes, null);
    assert.equal(memorySettings({ enforce: 'warn' }).enforce, 'warn');
    assert.equal(memorySettings({ enforce: 'OFF' }).enforce, 'off');
    // YAML 1.1: an unquoted `enforce: off` arrives as false
    assert.equal(memorySettings({ enforce: false }).enforce, 'off');
    assert.equal(memorySettings({ enforce: 'sometimes' }).enforce, 'block');
    assert.equal(memorySettings({ heap_gb: '2.5' }).heapGb, 2.5);
    assert.equal(memorySettings({ heap_gb: -1 }).heapGb, null);
    assert.equal(memorySettings({ total_gb: 0 }).totalGb, null);
    assert.equal(memorySettings({ margin: 0 }).margin, 0);
    assert.equal(memorySettings({ margin: 'x' }).margin, DEFAULT_SETTINGS.margin);
    assert.equal(memorySettings({ margin: 50 }).margin, DEFAULT_SETTINGS.margin);
});

test('ceilings: Chrome reports its heap limit, other browsers fall back, config overrides', () => {
    const s = memorySettings({});
    const chrome = readLimits(CHROME, s);
    // what may be FILLED: the benchmark tab died at 4.03 GB used
    assert.ok(Math.abs(chrome.heap.bytes - 4027182277) < 10, chrome.heap.bytes);
    assert.equal(chrome.browserLimit, true);
    // the server reported no RAM: a browser on another computer, 16 GB
    assert.equal(chrome.total.bytes, REMOTE_TOTAL_GB * GB);
    assert.match(chrome.total.source, /another computer/);
    assert.equal(chrome.contexts, MAX_WEBGL_CONTEXTS);

    const ff = readLimits(FIREFOX, s);
    assert.equal(ff.heap.bytes, FALLBACK_HEAP_GB * GB * HEAP_USABLE_SHARE);
    assert.match(ff.heap.source, /reports none/);
    assert.equal(ff.browserLimit, false);

    const cfg = readLimits(CHROME, memorySettings({ heap_gb: 2, total_gb: 6 }));
    assert.equal(cfg.heap.bytes, 2 * GB * HEAP_USABLE_SHARE);
    assert.match(cfg.heap.source, /heap_gb/);
    assert.equal(cfg.total.bytes, 6 * GB);

    // a small device gets a total budget of half its memory; 8 GB (the API's cap) the remote default
    assert.equal(readLimits({ ...CHROME, navigator: { deviceMemory: 4 } }, s).total.bytes, 2 * GB);
    assert.equal(readLimits({ ...CHROME, navigator: { deviceMemory: 8 } }, s).total.bytes, REMOTE_TOTAL_GB * GB);
    // on the server's computer: its RAM less a quarter, at least 4 GB
    const host = (gb) => readLimits(CHROME, memorySettings({ host_memory_bytes: gb * GB })).total;
    assert.equal(host(128).bytes, 96 * GB);
    assert.match(host(128).source, /this computer's 128 GB less 32 GB/);
    assert.equal(host(16).bytes, 12 * GB);
    assert.equal(host(8).bytes, 4 * GB);
    assert.equal(host(3).bytes, 0);
    // total_gb wins over both
    assert.equal(readLimits(CHROME, memorySettings({ total_gb: 40, host_memory_bytes: 128 * GB })).total.bytes, 40 * GB);
});

test('colour kind: categorical obs columns, numeric everything else, none', () => {
    const structure = { obs: { columns_info: { cell_type: { type: 'categorical' }, n_genes: { type: 'numeric' } } } };
    assert.equal(colourKind({ color: { type: 'none' } }, structure), 'none');
    assert.equal(colourKind({ color: { type: 'obs', key: 'cell_type' } }, structure), 'categorical');
    assert.equal(colourKind({ color: { type: 'obs', key: 'n_genes' } }, structure), 'numeric');
    assert.equal(colourKind({ color: { type: 'layer', key: 'X', column: 'CD3E' } }, structure), 'numeric');
    // structure unknown: the costliest
    assert.equal(colourKind({ color: { type: 'obs', key: 'cell_type' } }, null), 'numeric');
});

test('panel cost: large-plot mode keeps almost nothing on the heap, its points outside it; regular is far costlier', () => {
    const big = panelCost({ kind: 'cell-plot', n: 95624334, large: true });
    // 0.08 B/point measured (2.5M-10M, after a forced GC); 35 MB peak drawing 200M
    assert.ok(big.resident.heap < 0.02 * GB, formatGB(big.resident.heap));
    const huge = panelCost({ kind: 'cell-plot', n: 2e8, large: true });
    assert.ok(huge.peak.heap < 0.1 * GB, formatGB(huge.peak.heap));
    // what the heap no longer holds is charged outside it: 13 GB at 200M (renderer RSS 13.56 GB measured)
    assert.ok(Math.abs(huge.resident.off - 13 * GB) < 0.1 * GB, formatGB(huge.resident.off));
    assert.equal(big.resident.contexts, CONTEXTS_PER_PLOT);
    const reg = panelCost({ kind: 'cell-plot', n: 5e6, colour: 'numeric' });
    // 3.36 GB measured at 5M by gene (run maximum, with the app's 0.17 GB)
    assert.ok(Math.abs(reg.peak.heap + DEFAULT_MODEL.app.heap - 3.36 * GB) < 0.05 * GB, formatGB(reg.peak.heap));
    // cost grows with points, and with colour
    for (const kind of ['cell-plot', 'gene-plot']) {
        assert.ok(panelCost({ kind, n: 2e6 }).peak.heap > panelCost({ kind, n: 1e6 }).peak.heap);
    }
    const n = 1e6;
    const h = c => panelCost({ kind: 'cell-plot', n, colour: c }).peak.heap;
    assert.ok(h('numeric') > h('categorical') && h('categorical') > h('none'));
    assert.ok(panelCost({ kind: 'cell-plot', n, threeD: true }).peak.heap > h('numeric'));
    // peak never below resident
    for (const p of [{ kind: 'cell-plot', n, large: true }, { kind: 'cell-plot', n }, { kind: 'cell-table', n }]) {
        const c = panelCost(p);
        assert.ok(c.peak.heap >= c.resident.heap);
    }
    // tables hold no WebGL context; other panels cost their fixed part only
    assert.equal(panelCost({ kind: 'cell-table', n }).resident.contexts, 0);
    assert.equal(panelCost({ kind: 'gene-set', n }).resident.heap, DEFAULT_MODEL.panelFixed.heap);
});

test('export cost is the points, not the pixels; as shown is the pixels only', () => {
    const big = exportCost({ n: 95624334, large: true, width: 1200, height: 800, scale: 2 });
    const small = exportCost({ n: 95624334, large: true, width: 600, height: 400, scale: 1 });
    // a quarter-size image at scale 1 saves only the canvas
    assert.ok(small.heap + small.off > 0.95 * (big.heap + big.off));
    // large: Plotly's calc again, its positions in typed arrays (36 B/point outside the heap)
    assert.ok(big.off > 3.4 * GB, formatGB(big.off));
    assert.ok(exportCost({ n: 1e6 }).heap > exportCost({ n: 1e6, large: true }).heap);
    const shown = snapshotCost({ width: 1200, height: 800, ratio: 2 });
    assert.ok(shown.heap < 20 * MB && shown.contexts === 0);
    assert.ok(recolourCost({ n: 1e6 }).heap > recolourCost({ n: 1e6, large: true }).heap);
});

test('ledger: reserved panels count at their peak next to what they held, committed at their resident cost', () => {
    const L = new Ledger();
    const base = L.totals();
    assert.equal(base.heap, DEFAULT_MODEL.app.heap);
    let changes = 0;
    L.onChange(() => changes++);
    const p = { kind: 'cell-plot', n: 1e6, colour: 'numeric' };
    L.reserve('a', p);
    const c = panelCost(p);
    assert.equal(L.totals().heap, base.heap + c.peak.heap);
    L.commit('a');
    assert.equal(L.totals().heap, base.heap + c.resident.heap);
    // a redraw at more points: the old plot stays until the new one is drawn
    const q = { ...p, n: 2e6 };
    L.reserve('a', q);
    assert.equal(L.totals().heap, base.heap + c.resident.heap + panelCost(q).peak.heap);
    L.cancel('a');
    assert.equal(L.totals().heap, base.heap + c.resident.heap);
    assert.equal(L.totals({ exclude: ['a'] }).heap, base.heap);
    L.setCacheBytes(300 * MB);
    assert.equal(L.totals().off, base.off + c.resident.off + 300 * MB);
    assert.equal(L.plotCount(), 1);
    L.remove('a');
    assert.equal(L.totals().heap, base.heap);
    assert.equal(L.plotCount(), 0);
    assert.ok(changes >= 6);
    // removing what is not there changes nothing
    const before = changes;
    L.remove('nope');
    assert.equal(changes, before);
});

test('check: block, warn and off; the binding ceiling; risky actions; WebGL contexts', () => {
    const limits = readLimits(CHROME, memorySettings({}));
    const held = { heap: 1 * GB, off: 0, gpu: 0, contexts: 2 };
    const fits = check({ heap: 1 * GB, off: 0, gpu: 0, contexts: 2 }, held, limits, memorySettings({}));
    assert.equal(fits.verdict, 'ok');
    assert.equal(fits.fits, true);
    assert.equal(fits.risky, false);

    const big = { heap: 2.6 * GB, off: 0, gpu: 0, contexts: 0 };
    const blocked = check(big, held, limits, memorySettings({}), { panels: 2 });
    assert.equal(blocked.verdict, 'block');
    assert.equal(blocked.binding, 'heap');
    // the sentence: needs, free, panels, of what, and that it is an estimate
    assert.match(blocked.why, /^needs ~3\.1 GB of browser JS memory; 3\.0 GB free with 2 plots open \(of 4\.0 GB, estimated\)$/);
    assert.equal(check(big, held, limits, memorySettings({ enforce: 'warn' })).verdict, 'warn');
    assert.equal(check(big, held, limits, memorySettings({ enforce: 'off' })).verdict, 'ok');
    assert.equal(check(big, held, limits, memorySettings({ enforce: 'off' })).fits, false);

    // fits, but past 70% of the ceiling: risky (the crash marker is left)
    const risky = check({ heap: 1.6 * GB, off: 0, gpu: 0, contexts: 0 }, held, limits, memorySettings({}));
    assert.equal(risky.fits, true);
    assert.equal(risky.risky, true);

    // a total budget binds when it is the tighter one
    const tight = readLimits(CHROME, memorySettings({ total_gb: 3 }));
    const off = check({ heap: 0.5 * GB, off: 2 * GB, gpu: 0, contexts: 0 }, held, tight, memorySettings({ total_gb: 3 }));
    assert.equal(off.binding, 'total');
    assert.match(off.why, /browser memory;/);

    // contexts: 16 minus those in use
    const full = check({ heap: 0, off: 0, gpu: 0, contexts: 2 }, { ...held, contexts: 15 }, limits, memorySettings({}));
    assert.equal(full.verdict, 'block');
    assert.equal(full.binding, 'contexts');
    assert.match(full.why, /WebGL canvases/);

    // a measured total above the estimate is believed
    const measured = check({ heap: 1 * GB, off: 0, gpu: 0, contexts: 0 }, held, limits, memorySettings({}), { observed: 3.2 * GB });
    assert.equal(measured.measured, true);
    assert.equal(measured.verdict, 'block');
    assert.match(measured.why, /measured\)$/);
});

test('one every-cell plot: the total budget binds large-plot mode, from the RAM where known; the size alone is not a cap', () => {
    // v0.4.1 keeps large-plot positions outside the V8 heap: 200M drew with 35 MB of heap
    // and 13.6 GB of renderer memory on a 128 GB computer
    const L = new Ledger();
    const verdict = (memory, n) => {
        const st = memorySettings(memory);
        return check(panelCost({ kind: 'cell-plot', n, large: true }).peak, L.totals(), readLimits(CHROME, st), st);
    };
    // browser on the server's computer, 128 GB: 200M draws
    assert.equal(verdict({ host_memory_bytes: 128 * GB }, 200e6).verdict, 'ok');
    // 16 GB: refused on the total, with its numbers
    const small = verdict({ host_memory_bytes: 16 * GB }, 200e6);
    assert.equal(small.verdict, 'block');
    assert.equal(small.binding, 'total');
    assert.match(small.why, /^needs ~16 GB of browser memory; 12 GB free \(of 12 GB, estimated\)$/);
    // a browser on another computer: 16 GB by default, which binds just above 200M
    // (13 GB at 200M, times the margin)
    const st = memorySettings({});
    const remote = (n) => check(panelCost({ kind: 'cell-plot', n, large: true }).peak, L.totals(), readLimits(CHROME, st), st);
    assert.equal(remote(150e6).verdict, 'ok');
    assert.equal(remote(205e6).binding, 'total');
    // above the size tested nothing is refused for the size alone: the budget decides
    // (here 1 TB, so it fits) and the draw's allocation probe asks the browser
    const big = verdict({ host_memory_bytes: 1024 * GB }, 250e6);
    assert.equal(big.verdict, 'ok');
    assert.equal(big.binding, null);
    assert.equal(LARGEST_TESTED_POINTS, 200000000);   // information only
    // ... and the RAM budget still refuses what the machine cannot hold
    const bigSmall = verdict({ host_memory_bytes: 128 * GB }, 2e9);
    assert.equal(bigSmall.verdict, 'block');
    assert.equal(bigSmall.binding, 'total');
    // the guard off lets everything through
    assert.equal(verdict({ host_memory_bytes: 1024 * GB, enforce: 'off' }, 250e6).verdict, 'ok');
});

test('largestFitting: the largest n that fits, or one below the range', () => {
    assert.equal(largestFitting(n => n <= 1234, 1, 1e6), 1234);
    assert.equal(largestFitting(() => true, 1, 50), 50);
    assert.equal(largestFitting(() => false, 1, 50), 0);
    assert.equal(largestFitting(() => true, 5, 4), 4);
});

test('a subset change redraws every Cell Plot and cell table at once; gene panels stay', () => {
    const threshold = 5e6;
    const panels = [
        { id: 'a', kind: 'cell-plot', n: 1e5, colour: 'numeric' },
        { id: 'b', kind: 'cell-plot', n: 1e5, colour: 'categorical' },
        { id: 'g', kind: 'gene-plot', n: 3e4, colour: 'numeric' },
        { id: 't', kind: 'cell-table', n: 1e5 }
    ];
    const one = predictSubsetChange(1e6, panels.slice(0, 1), threshold);
    const two = predictSubsetChange(1e6, panels.slice(0, 2), threshold);
    const all = predictSubsetChange(1e6, panels, threshold);
    assert.equal(all.changed, 3);
    assert.ok(two.peak.heap > 1.5 * one.peak.heap);
    // peak: old and new of every changed panel; after: the new ones and the gene plot as it was
    const gene = panelCost(panels[2]).resident.heap;
    const expectAfter = panelCost({ ...panels[0], n: 1e6 }).resident.heap + panelCost({ ...panels[1], n: 1e6 }).resident.heap
        + panelCost({ ...panels[3], n: 1e6 }).resident.heap + gene;
    assert.ok(Math.abs(all.after.heap - expectAfter) < 1);
    assert.ok(all.peak.heap > all.after.heap);
    // above the threshold the plots switch to large-plot mode: every cell is cheaper per point there
    const big = predictSubsetChange(20e6, panels.slice(0, 1), threshold);
    assert.ok(big.after.heap < panelCost({ ...panels[0], n: 20e6 }).resident.heap);
    // a plot that cannot use large-plot mode (3D) is costed as regular
    const threeD = predictSubsetChange(20e6, [{ ...panels[0], threeD: true }], threshold, DEFAULT_MODEL, p => !p.threeD);
    assert.ok(threeD.after.heap > big.after.heap);
    // nothing open: nothing to pay
    assert.deepEqual(predictSubsetChange(1e8, [], threshold).peak, zero());
});

test('more open plots, fewer cells fit: the largest subset shrinks as panels are added', () => {
    const limits = readLimits(CHROME, memorySettings({}));
    // the regular path, where the heap still binds (large-plot mode keeps its points outside it)
    const threshold = 1e9;
    const maxFor = (count) => {
        const L = new Ledger();
        for (let i = 0; i < count; i++) L.commit(`p${i}`, { kind: 'cell-plot', n: 1e5, colour: 'numeric', large: false });
        const now = L.totals();
        const ids = L.panels().map(p => p.id);
        const base = L.totals({ exclude: ids });
        return largestFitting(n => {
            const { peak } = predictSubsetChange(n, L.panels(), threshold);
            const need = { heap: base.heap + peak.heap - now.heap, off: 0, gpu: 0, contexts: 0 };
            return check(need, now, limits, memorySettings({})).fits;
        }, 1, 2e8);
    };
    const m1 = maxFor(1), m2 = maxFor(2), m4 = maxFor(4);
    assert.ok(m1 > m2 && m2 > m4, `${m1} ${m2} ${m4}`);
    // regular plots by gene: a few million points (5M measured at 3.36 GB)
    assert.ok(m1 > 2e6 && m1 < 6e6, m1);
});

test('words: GB rounding and the headroom line', () => {
    assert.equal(formatGB(4027182277), '4.0 GB');
    assert.equal(formatGB(12.4 * GB), '12 GB');
    assert.equal(formatGB(123 * MB), '120 MB');
    assert.equal(formatGB(0.2 * MB), '1 MB');
    const limits = readLimits(CHROME, memorySettings({}));
    const line = headroomLine({ heap: 1 * GB, off: 0, gpu: 0, contexts: 0 }, limits, { panels: 1 });
    assert.equal(line, 'Browser memory: 3.0 GB of 4.0 GB JS memory free, 15 GB of 16 GB in total with 1 plot open (estimated)');
    const tight = readLimits(CHROME, memorySettings({ total_gb: 8 }));
    assert.match(headroomLine({ heap: 1 * GB, off: 2 * GB, gpu: 0, contexts: 0 }, tight, { panels: 2, measured: true }),
        /, 5\.0 GB of 8\.0 GB in total with 2 plots open \(measured\)$/);
    assert.equal(headroom({ heap: 1 * GB, off: 0, gpu: 0, contexts: 3 }, limits).contexts, MAX_WEBGL_CONTEXTS - 3);
});

test('crash marker: what was running when the tab died, read once; a crash earns margin', () => {
    const s = storage();
    assert.equal(takeCrashed(s), null);
    markPending(s, { panel: 'cell-plot-a', n: 95624334, action: 'draw' });
    const got = takeCrashed(s);
    assert.equal(got.panel, 'cell-plot-a');
    assert.equal(got.action, 'draw');
    assert.equal(takeCrashed(s), null);
    // a finished action leaves nothing
    markPending(s, { panel: 'x' });
    clearPending(s);
    assert.equal(takeCrashed(s), null);
    // a marker from a tab left open for days is not this crash
    markPending(s, { panel: 'old' });
    assert.equal(takeCrashed(s, Date.now() + 2 * 24 * 3600 * 1000), null);
    // storage that throws (private window) is not an error
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
    markPending(broken, { panel: 'x' });
    assert.equal(takeCrashed(broken), null);
    assert.equal(learnedMargin(broken), 0);
    // each crash adds 0.25 margin, up to 1
    assert.equal(learnedMargin(s), 0);
    assert.equal(learnFromCrash(s), 0.25);
    for (let i = 0; i < 6; i++) learnFromCrash(s);
    assert.equal(learnedMargin(s), 1);
});

test('overlapping draws of one panel: the first one ending does not settle the second', () => {
    // seen on a new panel: init and the dataset's arrival both start a draw;
    // the first is aborted after the second reserved
    const L = new Ledger();
    const p = { kind: 'cell-plot', n: 1e6, colour: 'numeric' };
    const t1 = L.reserve('a', p);
    const t2 = L.reserve('a', p);
    assert.notEqual(t1, t2);
    L.cancel('a', t1);                  // the aborted first draw
    assert.equal(L.pending.has('a'), true, 'the second draw is still reserved');
    L.commit('a', null, t2);
    assert.ok(L.get('a'), 'and its end commits the panel');
    assert.equal(L.pending.has('a'), false);
    // an older draw that finishes after a newer one started still records the plot
    const t3 = L.reserve('b', p);
    const t4 = L.reserve('b', { ...p, n: 2e6 });
    L.commit('b', null, t3);
    assert.equal(L.get('b').n, 1e6);
    assert.equal(L.pending.get('b').token, t4, 'the newer draw stays reserved');
    L.commit('b', null, t4);
    assert.equal(L.get('b').n, 2e6);
    // removing a panel drops its unsettled draws too
    L.reserve('c', p);
    L.remove('c');
    L.commit('c', null, 999);
    assert.equal(L.get('c'), null);
});

// v0.4.0's large-plot costs (20.2 B/point on the V8 heap): the in-place
// redraw arithmetic is checked where the heap binds, as it did then
const HEAP_BOUND = { ...DEFAULT_MODEL, large: { resident: 20.2, peak: 20.2, off: 45, gpu: 19 },
    export: { ...DEFAULT_MODEL.export, large: { heap: 20.2, off: 16, gpu: 19 } } };

test('heap-bound model, 95.6M every cell: a recolour or part step is allowed, a second plot, a full export and 182M are not', async () => {
    // the regression on 12f93f8: a large-mode recolour is a full redraw, and the
    // guard added the new plot's peak to the old plot it replaces (4.43 GB
    // against 4.03). Measured at 95.6M: 1.94 GB before, 1.96 GB peak, 1.94 GB
    // after: the two never coexist.
    const { drawNeed, replacesInPlace } = await import('../../../static/js/utils/memory-guard.js');
    const N = 95624334;
    const s = memorySettings({});
    const limits = readLimits(CHROME, s);
    const L = new Ledger(HEAP_BOUND);
    L.commit('a', { kind: 'cell-plot', n: N, large: true, colour: 'numeric' });
    const old = L.get('a');
    const heldWithOld = addCostLocal(L.totals({ exclude: ['a'] }), old.resident);

    // recolour (gene -> category): redraw in place
    const peak = panelCost({ kind: 'cell-plot', n: N, large: true, colour: 'categorical' }, HEAP_BOUND).peak;
    assert.equal(replacesInPlace(old, true), true);
    const recolour = check({ ...drawNeed(peak, old, true, s.margin), contexts: 0 }, heldWithOld, limits, s);
    assert.equal(recolour.verdict, 'ok', recolour.why);
    // the margin stays on the new plot: a same-size redraw is charged
    // 1.2 x peak - old = 0.39 GB, not nothing
    assert.ok(Math.abs(recolour.needBytes - (1.2 * peak.heap - old.resident.heap)) < 1e3, recolour.needBytes);
    assert.ok(recolour.needBytes > 0.35 * GB);
    // the old double count would refuse it
    assert.equal(check({ ...peak, contexts: 0 }, heldWithOld, limits, s).verdict, 'block');

    // a part step or a larger subset in large-plot mode: replaces too
    const step = predictSubsetChange(N, L.panels(), 1e6, HEAP_BOUND);
    const now = L.totals();
    const base = L.totals({ exclude: ['a'] });
    const need = { heap: base.heap + step.peak.heap - now.heap, off: 0, gpu: 0, contexts: 0 };
    assert.equal(check(need, now, limits, s).verdict, 'ok');

    // a second every-cell plot: refused
    const second = panelCost({ kind: 'cell-plot', n: N, large: true }, HEAP_BOUND).peak;
    assert.equal(check(drawNeed(second, null, true, s.margin), L.totals(), limits, s).verdict, 'block');
    // a full-resolution export (the measured F1 crash): refused
    assert.equal(check(exportCost({ n: N, large: true, width: 1200, height: 800, scale: 2 }, HEAP_BOUND), L.totals(), limits, s).verdict, 'block');
    // 182M first draw (the measured V8 OOM): refused
    const first = panelCost({ kind: 'cell-plot', n: 182e6, large: true }, HEAP_BOUND).peak;
    assert.equal(check(first, new Ledger(HEAP_BOUND).totals(), limits, s).verdict, 'block');
    // a regular plot redrawn keeps old + new (not measured as a replace)
    assert.equal(replacesInPlace({ large: false, resident: zero() }, false), false);
    assert.deepEqual(drawNeed(first, { large: false, resident: first }, true, s.margin), first);
});

test('heap-bound model: a larger redraw in place is charged its whole growth with the margin; 150M recolours, 175M is never drawn', async () => {
    const { drawNeed } = await import('../../../static/js/utils/memory-guard.js');
    const s = memorySettings({});
    const limits = readLimits(CHROME, s);
    const at = (n) => { const L = new Ledger(HEAP_BOUND); L.commit('a', { kind: 'cell-plot', n, large: true }); return L; };
    // a subset step up, 50M -> 95.6M: 1.2 x 1.94 - 1.02 = 1.31 GB
    const L = at(50e6);
    const old = L.get('a');
    const peak = panelCost({ kind: 'cell-plot', n: 95624334, large: true }, HEAP_BOUND).peak;
    const need = drawNeed(peak, old, true, s.margin);
    assert.ok(Math.abs(1.2 * need.heap - (1.2 * peak.heap - old.resident.heap)) < 1e3);
    assert.ok(1.2 * need.heap > 1.3 * GB);
    // a step down is charged the margin of the new plot only if it exceeds the old: 0
    assert.equal(drawNeed(panelCost({ kind: 'cell-plot', n: 10e6, large: true }, HEAP_BOUND).peak, old, true, s.margin).heap, 0);
    // recolour at 150M: 3.21 held + 0.61 = 3.81 of 4.03, allowed
    const L150 = at(150e6);
    const o150 = L150.get('a');
    const held150 = { ...L150.totals({ exclude: ['a'] }), heap: L150.totals({ exclude: ['a'] }).heap + o150.resident.heap };
    const p150 = panelCost({ kind: 'cell-plot', n: 150e6, large: true }, HEAP_BOUND).peak;
    assert.equal(check({ ...drawNeed(p150, o150, true, s.margin), contexts: 0 }, held150, limits, s).verdict, 'ok');
    // 175M: the first draw is refused (4.25 vs 3.86), so its recolour never arises
    assert.equal(check(panelCost({ kind: 'cell-plot', n: 175e6, large: true }, HEAP_BOUND).peak, new Ledger(HEAP_BOUND).totals(), limits, s).verdict, 'block');
});

function addCostLocal(a, b) {
    return { heap: a.heap + b.heap, off: a.off + b.off, gpu: a.gpu + b.gpu, contexts: a.contexts };
}

test('hover labels: the measured cost, no count cap, the guard decides', async () => {
    const { labelCost } = await import('../../../static/js/utils/memory-guard.js');
    // the two measurements the model was fitted to (heap after GC, hover on minus off, 1M points)
    const barcode = labelCost({ points: 1e6, labels: 999998, chars: 21.9 }).heap;
    const cat65k = labelCost({ points: 1e6, labels: 65000, chars: 8 }).heap;
    // resident +114.1 / +37.9 MB, plus the reply's JSON while loading (3 B + 1 B per character per label)
    assert.ok(Math.abs(barcode - (114.1 + 24.9) * MB) < 3 * MB, `${barcode / MB} MB`);
    assert.ok(Math.abs(cat65k - (37.9 + 0.7) * MB) < 3 * MB, `${cat65k / MB} MB`);
    const s = memorySettings({});
    const chrome = readLimits(CHROME, s);
    const held = { heap: 0.6 * GB, off: 0.2 * GB, gpu: 0, contexts: 2 };
    // 2.5M barcodes on 2.5M points: past the old 2M cap, and it fits a desktop browser
    const big = check(labelCost({ points: 2.5e6, labels: 2.5e6, chars: 22 }), held, chrome, s);
    assert.equal(big.verdict, 'ok');
    // a browser that cannot hold them: refused with the guard's usual numbers
    const small = readLimits(CHROME, memorySettings({ heap_gb: 0.8 }));
    const refused = check(labelCost({ points: 2.5e6, labels: 2.5e6, chars: 22 }), held, small, s, { panels: 1 });
    assert.equal(refused.verdict, 'block');
    assert.match(refused.why, /^needs ~[\d.]+ (GB|MB) of browser JS memory; [\d.]+ (GB|MB) free with 1 plot open/);
});
