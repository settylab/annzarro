/**
 * The tab's buffer ceiling (static/js/utils/memory-guard.js readLimits
 * buffers, panelBuffers, predictSubsetBuffers; memory-guard-ui.js
 * subsetCheck, maxSubsetCells, drawCheck, newPanelCheck).
 *
 * The case it answers: six Cell Plots of 100,000 cells on a 95.6M-cell
 * dataset, a computer with 128 GB. The RAM budget (the computer's memory
 * less a reserve, ~96 GB) let every cell through (six plots of ~7 GB), but a
 * Chrome tab holds about 16.6 GB of ArrayBuffers in all and Safari ends a
 * page at about 15 GB: the change ran the tab out, and after the crash the
 * dialog offered every cell again.
 *
 * Run:  node --test annzarro/tests/js/memory-guard-buffers.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = new Map();
const dispatched = [];
const kept = new Map();
const localStorage = { getItem: k => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)),
    removeItem: k => kept.delete(k) };
globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/', origin: 'http://localhost' }, Config: {}, localStorage };
globalThis.document = {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    removeEventListener() {},
    dispatchEvent(e) { dispatched.push(e.type); for (const fn of listeners.get(e.type) || []) fn(e); return true; },
    getElementById: () => null, createElement: () => ({}), querySelectorAll: () => []
};
globalThis.fetch = async () => ({ ok: false, statusText: 'test' });

const m = await import('../../../static/js/utils/memory-guard.js');
const ui = await import('../../../static/js/utils/memory-guard-ui.js');
const { Config } = await import('../../../static/js/config.js');
const { GB } = m;

const N = 95_624_334;
const THRESHOLD = 1_000_000;
const UA = {
    chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    electron: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) annzarro/0.6.0 Chrome/130.0.0.0 Electron/33.0.0 Safari/537.36',
    safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
    firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0'
};

test('the engine comes from the user agent', () => {
    assert.equal(m.browserEngine({ userAgent: UA.chrome }), 'v8');
    assert.equal(m.browserEngine({ userAgent: UA.edge }), 'v8');
    assert.equal(m.browserEngine({ userAgent: UA.electron }), 'v8');
    assert.equal(m.browserEngine({ userAgent: UA.safari }), 'webkit');
    assert.equal(m.browserEngine({ userAgent: UA.iosChrome }), 'webkit');
    assert.equal(m.browserEngine({ userAgent: UA.firefox }), 'gecko');
    assert.equal(m.browserEngine({}), null);
});

test('the buffer ceiling per engine, the setting, and what a crash taught', () => {
    const host = m.memorySettings({ host_memory_bytes: 128 * GB });
    assert.equal(m.readLimits({ navigator: { userAgent: UA.chrome } }, host).buffers.bytes, 16.6 * GB);
    assert.equal(m.readLimits({ navigator: { userAgent: UA.safari } }, host).buffers.bytes, 15 * GB);
    // Safari on a computer the guard cannot see: the smaller limit
    assert.equal(m.readLimits({ navigator: { userAgent: UA.safari } }, m.memorySettings({})).buffers.bytes, 7 * GB);
    assert.equal(m.readLimits({ navigator: { userAgent: UA.safari } }, m.memorySettings({ host_memory_bytes: 16 * GB })).buffers.bytes, 7 * GB);
    assert.equal(m.readLimits({ navigator: { userAgent: UA.firefox } }, host).buffers.bytes, 16.6 * GB);
    const set = m.readLimits({ navigator: { userAgent: UA.chrome } }, m.memorySettings({ buffers_gb: '3' }));
    assert.equal(set.buffers.bytes, 3 * GB);
    assert.match(set.buffers.source, /buffers_gb/);
    const crashed = m.readLimits({ navigator: { userAgent: UA.chrome } }, { ...host, crashedBuffers: 9 * GB });
    assert.equal(crashed.buffers.bytes, 9 * GB);
    assert.match(crashed.buffers.source, /ended a page/);
    // a crash above the ceiling changes nothing
    assert.equal(m.readLimits({ navigator: { userAgent: UA.chrome } }, { ...host, crashedBuffers: 40 * GB }).buffers.bytes, 16.6 * GB);
});

test('what a plot holds in buffers', () => {
    const L = m.DEFAULT_MODEL.large;
    assert.deepEqual(m.panelBuffers({ kind: 'cell-plot', n: N, large: true }), { resident: L.heldPerPoint * N, peak: L.arrayBuffers * N });
    assert.deepEqual(m.panelBuffers({ kind: 'cell-table', n: N }), { resident: 0, peak: 0 });
    const r = m.panelBuffers({ kind: 'cell-plot', n: 100000 });
    assert.equal(r.resident, m.DEFAULT_MODEL.regular.off * 100000);
    // a large plot redrawn large frees its old buffers step by step
    const old = { kind: 'cell-plot', n: N, large: true };
    assert.equal(m.bufferDrawNeed({ kind: 'cell-plot', n: N, large: true }, old), L.redrawBeside * N);
    assert.equal(m.bufferDrawNeed({ kind: 'cell-plot', n: N, large: true }, null), L.arrayBuffers * N);
});

test('a subset change: large plots take turns, each beside the ones drawn before it', () => {
    const L = m.DEFAULT_MODEL.large;
    const plots = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, kind: 'cell-plot', n: 100000, large: false }));
    const b = m.predictSubsetBuffers(N, plots, THRESHOLD);
    const old = m.DEFAULT_MODEL.regular.off * 100000;
    assert.equal(b.before, 6 * old);
    // the sixth plot draws while five hold their new buffers, beside its own old plot
    assert.ok(Math.abs(b.peak - (5 * L.heldPerPoint * N + L.arrayBuffers * N + old)) < 1, b.peak);
    assert.ok(Math.abs(b.after - 6 * L.heldPerPoint * N) < 1);
    // tables and gene plots hold no buffers that change
    const mixed = m.predictSubsetBuffers(N, [{ id: 't', kind: 'cell-table', n: 100000 }, plots[0]], THRESHOLD);
    assert.ok(Math.abs(mixed.peak - (L.arrayBuffers * N + old)) < 1);
    // a 3D plot does not draw large
    const flat = m.predictSubsetBuffers(N, [{ ...plots[0], threeD: true }], THRESHOLD, m.DEFAULT_MODEL, p => !p.threeD);
    assert.ok(flat.peak > L.arrayBuffers * N);
});

test('check() names the buffers when they bind, and a close call leaves a crash marker', () => {
    const limits = m.readLimits({ navigator: { userAgent: UA.chrome } }, m.memorySettings({ host_memory_bytes: 128 * GB }));
    const held = { heap: 0.2 * GB, off: 0.1 * GB, gpu: 0, contexts: 0 };
    const need = { heap: 0.05 * GB, off: 40 * GB, gpu: 0, contexts: 0 };
    const r = m.check(need, held, limits, m.DEFAULT_SETTINGS, { buffers: { need: 40 * GB, held: 0 }, panels: 6 });
    assert.equal(r.fits, false);
    assert.equal(r.binding, 'buffers');
    assert.match(r.why, /of browser buffers; .* free with 6 plots open/);
    assert.equal(m.shortWhy(r.why).includes('of browser buffers'), true);
    assert.equal(r.hopeless, true);       // 48 GB is above the ceiling itself
    assert.equal(m.emptyPageWhy(r, '95.6M points').endsWith('of buffers.'), true);
    const close = m.check({ heap: 0.05 * GB, off: 9 * GB, gpu: 0, contexts: 0 }, held, limits, m.DEFAULT_SETTINGS,
        { buffers: { need: 9 * GB, held: 1 * GB } });
    assert.equal(close.fits, true);
    assert.equal(close.risky, true);      // 1 + 10.8 GB of 16.6
    assert.equal(close.buffersPeakBytes, 10 * GB);
});

test('the words of each binding', () => {
    assert.equal(m.bindingLabel('heap'), 'JS memory');
    assert.equal(m.bindingLabel('total'), 'browser memory');
    assert.equal(m.bindingLabel('buffers'), 'browser buffers');
    assert.equal(m.bindingLabel('alloc'), 'browser buffers');
    assert.equal(m.bindingLabel('contexts'), 'WebGL canvases');
    assert.equal(m.refusalHeadline('heap'), 'Not drawn: not enough JS memory');
    assert.equal(m.refusalHeadline('contexts'), 'Not drawn: too many WebGL canvases');
    assert.equal(m.refusalHeadline('buffers', 'Not loaded'), 'Not loaded: not enough browser buffers');
});

function storage() {
    const s = new Map();
    return { getItem: k => (s.has(k) ? s.get(k) : null), setItem: (k, v) => s.set(k, String(v)), removeItem: k => s.delete(k) };
}

test('a crash teaches the buffers the page held, never below the floor, only ever lower', () => {
    const st = storage();
    assert.equal(m.readLearned(st), null);
    assert.equal(m.learnFromCrash(st, { n: N, buffers: 14 * GB }).buffers, 14 * GB);
    assert.equal(m.learnFromCrash(st, { n: N, buffers: 15 * GB }).buffers, 14 * GB);
    assert.equal(m.learnFromCrash(st, { n: N, buffers: 10 * GB }).buffers, 10 * GB);
    assert.equal(m.learnFromCrash(st, { n: N, buffers: 0.1 * GB }).buffers, m.MIN_LEARNED_BUFFERS);
    // a crash without buffers (a regular plot) keeps what was learned
    assert.equal(m.learnFromCrash(st, { n: N }).buffers, m.MIN_LEARNED_BUFFERS);
});

test('what a crash taught is scoped to its size, bounded, and forgotten', () => {
    const st = storage();
    const t0 = Date.UTC(2026, 9, 17);
    const e = m.learnFromCrash(st, { n: N, buffers: 15 * GB }, t0);
    assert.deepEqual(m.learnedFor(e, N), { margin: 0.25, buffers: 15 * GB });
    assert.deepEqual(m.learnedFor(e, N / 2), { margin: 0.25, buffers: 15 * GB });
    // a plot of 100,000 cells is not held to what a 95.6M-cell one taught
    assert.deepEqual(m.learnedFor(e, 100000), { margin: 0, buffers: null });
    assert.deepEqual(m.learnedFor(e, null), { margin: 0, buffers: null });
    // a smaller crash widens the scope down to it
    assert.equal(m.learnFromCrash(st, { n: 20e6 }, t0).n, 20e6);
    // forgotten after LEARNED_DAYS
    assert.equal(m.readLearned(st, t0 + (m.LEARNED_DAYS + 1) * 24 * 3600 * 1000), null);
    assert.equal(st.getItem(m.LEARNED_MARGIN_KEY), null);
    // forgotten when an action as large as the crash succeeds; a smaller one does not
    m.learnFromCrash(st, { n: N });
    assert.equal(m.learnedSucceeded(st, 100000), false);
    assert.ok(m.readLearned(st));
    assert.equal(m.learnedSucceeded(st, N), true);
    assert.equal(m.readLearned(st), null);
    // the unscoped form of 0.6.0 and before (a bare number) is dropped
    st.setItem(m.LEARNED_MARGIN_KEY, '1');
    assert.equal(m.readLearned(st), null);
    assert.equal(st.getItem(m.LEARNED_MARGIN_KEY), null);
});

// -- the page's checks, with the ledger of the operator's case --------------------

function sixPlots(n = 100000, large = false) {
    for (const e of ui.ledger.panels()) ui.ledger.remove(e.id);
    for (let i = 0; i < 6; i++) ui.ledger.commit(`cell-plot-${i}`, { kind: 'cell-plot', n, large, colour: 'numeric' });
}

test('six plots of 100k cells, 128 GB: every cell is refused for the buffers, and the largest size that fits is offered', () => {
    Config.DEFAULTS.MEMORY = { host_memory_bytes: 128 * GB, margin: 0.2 };
    sixPlots();
    const r = ui.subsetCheck(N, THRESHOLD);
    assert.equal(r.fits, false);
    assert.equal(r.binding, 'buffers');
    const most = ui.maxSubsetCells(N, THRESHOLD);
    const L = m.DEFAULT_MODEL.large;
    const lim = ui.limits().buffers.bytes;
    // the sixth plot draws beside five drawn ones, with the margin
    const expect = lim / ((1 + ui.settings().margin) * (5 * L.heldPerPoint + L.arrayBuffers));
    assert.ok(Math.abs(most - expect) / expect < 0.01, `${most} vs ${expect}`);
    assert.ok(ui.subsetCheck(most, THRESHOLD).fits);
    // one plot draws every cell
    for (let i = 1; i < 6; i++) ui.ledger.remove(`cell-plot-${i}`);
    assert.equal(ui.subsetCheck(N, THRESHOLD).fits, true);
    assert.equal(ui.maxSubsetCells(N, THRESHOLD), N);
});

test('a second large plot of every cell: the new-plot and draw checks count the first one', () => {
    Config.DEFAULTS.MEMORY = { host_memory_bytes: 128 * GB, margin: 0.2, buffers_gb: 12 };
    for (const e of ui.ledger.panels()) ui.ledger.remove(e.id);
    assert.equal(ui.drawCheck({ id: 'a', kind: 'cell-plot', n: N, large: true }).fits, true);
    ui.ledger.commit('a', { kind: 'cell-plot', n: N, large: true, colour: 'numeric' });
    // a redraw of the drawn plot replaces it
    assert.equal(ui.drawCheck({ id: 'a', kind: 'cell-plot', n: N, large: true, livePlot: true }).fits, true);
    const second = ui.drawCheck({ id: 'b', kind: 'cell-plot', n: N, large: true });
    assert.equal(second.fits, false);
    assert.equal(second.binding, 'buffers');
    // the RAM budget alone would have let it through
    assert.equal(ui.drawCheck({ id: 'b', kind: 'cell-plot', n: 100000 }).fits, true);
    ui.ledger.remove('a');
    Config.DEFAULTS.MEMORY = {};
});

test('another cell count makes every control ask again (MEMORY_EVENT), with no panel changed', async () => {
    dispatched.length = 0;
    globalThis.document.dispatchEvent(new CustomEvent('cellsChanged', { detail: { n: 100000 } }));
    await new Promise(r => setTimeout(r, 120));
    assert.ok(dispatched.includes(ui.MEMORY_EVENT), dispatched);
    dispatched.length = 0;
    globalThis.document.dispatchEvent(new CustomEvent('datasetChanged', { detail: {} }));
    await new Promise(r => setTimeout(r, 120));
    assert.ok(dispatched.includes(ui.MEMORY_EVENT), dispatched);
});

test('a closed plot: the checks are asked again once its buffers can have been freed', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        ui.ledger.commit('z', { kind: 'cell-plot', n: 1000, colour: 'numeric' });
        ui.forget('z');
        t.mock.timers.tick(60);
        dispatched.length = 0;
        t.mock.timers.tick(4000);
        t.mock.timers.tick(100);      // the event itself, 50 ms after the change
        assert.ok(dispatched.includes(ui.MEMORY_EVENT), dispatched);
    } finally {
        t.mock.timers.reset();
    }
});

test('the allocation probe refuses what the browser does not give, and only that', async () => {
    const probe = await import('../../../static/js/utils/alloc-probe.js');
    Config.DEFAULTS.MEMORY = { host_memory_bytes: 128 * GB, margin: 0.2 };
    for (const e of ui.ledger.panels()) ui.ledger.remove(e.id);
    try {
        // a browser that gives every block: a new plot of every cell is offered
        probe.setAllocator((type, length) => ({ length }));
        ui.freshProbes();
        const given = ui.newPanelCheck('cell-plot', { n: N, large: true });
        assert.equal(given.fits, true, given.why);
        // one that refuses: the probe says so
        probe.setAllocator(() => { throw new RangeError('Array buffer allocation failed'); });
        ui.freshProbes();
        const refused = ui.newPanelCheck('cell-plot', { n: N, large: true });
        assert.equal(refused.fits, false);
        assert.equal(refused.binding, 'alloc');
        assert.match(refused.why, /cannot allocate the ~7\.7 GB the new plot needs/);
        // a small plot is not probed
        assert.equal(ui.newPanelCheck('cell-plot', { n: 100000 }).fits, true);
    } finally {
        probe.setAllocator(null);
        ui.freshProbes();
        Config.DEFAULTS.MEMORY = {};
    }
});

test('a refusal only the crash margin makes says so and offers to reset it; a small plot is not held to it', () => {
    Config.DEFAULTS.MEMORY = { host_memory_bytes: 128 * GB, margin: 0.2 };
    for (const e of ui.ledger.panels()) ui.ledger.remove(e.id);
    // four crashes drawing every cell: margin 0.2 + 1
    for (let i = 0; i < 4; i++) m.learnFromCrash(localStorage, { n: N });
    try {
        const r = ui.drawCheck({ id: 'a', kind: 'cell-plot', n: N, large: true });
        assert.equal(r.fits, false);
        assert.equal(r.binding, 'buffers');          // 7.7 GB x 2.2 > 16.6 GB
        assert.ok(r.learned && r.learned.n === N, JSON.stringify(r.learned));
        assert.match(ui.refusalText(r, 'Close a plot.'), /tab ended on .*, AnnZarro keeps an extra margin for this size\. Reset it/);
        const panel = ui.refusalPanel({ result: r, kind: 'cell-plot', n: N, checkAt: () => ({ fits: false }), anyway: 'Draw anyway' });
        assert.deepEqual(panel.actions[0], ['memory-reset', 'Reset the margin']);
        assert.match(panel.why, /extra margin/);
        // the operator's case: a fresh page, nothing open, 100,000 cells
        const small = ui.newPanelCheck('cell-plot', { n: 100000 });
        assert.equal(small.fits, true);
        assert.equal(ui.settings(100000).margin, 0.2);
        // reset: drawn again without it
        ui.resetLearned();
        assert.equal(ui.learned(), null);
        assert.equal(ui.drawCheck({ id: 'a', kind: 'cell-plot', n: N, large: true }).fits, true);
    } finally {
        m.forgetLearned(localStorage);
        Config.DEFAULTS.MEMORY = {};
    }
});

test('a draw as large as the crash, drawn, forgets the margin', () => {
    m.learnFromCrash(localStorage, { n: 2e6 });
    ui.reserve('big', { kind: 'cell-plot', n: 3e6, large: true, colour: 'numeric' });
    ui.commit('big');
    assert.equal(ui.learned(), null);
    ui.forget('big');
});
