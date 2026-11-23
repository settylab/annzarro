/**
 * One painter per host and one binding per provider (static/js/utils/host-binding.js, FX-H: browser review H3 and
 * O2, operator decision 21).
 *
 * - The painter collects the notices of EVERY provider on a host and shows the worst; a second provider's event never
 *   wipes the first one's notice, and a notice's buttons go to the provider whose notice it is.
 * - A progress bar appears once a wait is long: the server's estimate over 10 s, or 10 s of waiting by the clock (a
 *   fake one here), or the server's `running_s`; determinate from stored entries, indeterminate in a queue.
 * - A binding keeps one record per (host, role), remakes it when the setting changes, releases it with the host, and
 *   waits for a pending value without leaving abort listeners behind.
 *
 * Run:  node --test annzarro/tests/js/host-binding.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const HB = await import('../../../static/js/utils/host-binding.js');
const SN = await import('../../../static/js/utils/source-notices.js');
const A = await import('../../../static/js/utils/source-actions.js');

const GROUPING = { thing: 'grouping', source: 'grouping', result: 'grouping', Computing: 'Computing', found: 'cells',
    act: { to: 'group', ing: 'grouping' } };
const SCORE = { thing: 'signature', source: 'source', result: 'score', Computing: 'Computing', progressUnit: 'genes' };

/** A fake clock and timer queue: `advance(ms)` runs what falls due. */
function fakeTime() {
    let t = 0;
    let seq = 0;
    const timers = new Map();
    return {
        now: () => t,
        setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: t + ms }); return id; },
        clearTimer: (id) => { timers.delete(id); },
        pending: () => timers.size,
        advance(ms) {
            const until = t + ms;
            for (;;) {
                const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
                if (!next || next[1].at > until) break;
                timers.delete(next[0]);
                t = next[1].at;
                next[1].fn();
            }
            t = until;
        }
    };
}

/** A painter whose paints are recorded: host -> [{notice, overlay}], and the strip's bars. */
function recordedPainter(time = fakeTime()) {
    const painted = [];
    const strips = [];
    const p = HB.createPainter({ now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer,
        paint: (host, notice, opts) => painted.push({ host, notice, overlay: opts.overlay }),
        strip: (host, bar, notice) => strips.push({ host, bar, sentence: notice ? SN.sentenceOf(notice) : null }) });
    return { p, painted, strips, time, last: () => painted[painted.length - 1], lastStrip: () => strips[strips.length - 1] };
}

/** A notice source whose entries the test sets. */
function source(p, id, vocabulary) {
    const on = new Map();
    p.register({ id, entries: (host) => (on.get(host) || []).map(([role, snap]) => ({ role, snap,
        notice: SN.describeSource(snap, { role: role === 'color' ? 'colour' : role }, vocabulary) })) });
    return { set: (host, list) => on.set(host, list) };
}

const host = (name = 'plot') => ({ name, isConnected: true, id: `plot-container-${name}` });

// ---------------------------------------------------------------- one painter per host (H3)

test("two providers on one host: the worst notice shows, and the other provider's event does not wipe it", () => {
    const { p, last } = recordedPainter();
    const score = source(p, 'plot-score', SCORE);
    const group = source(p, 'plot-group', GROUPING);
    const h = host();
    score.set(h, [['x', { state: 'ready', title: 'Sig', key: 'k1', values: [1] }]]);
    group.set(h, [['color', { state: 'awaiting', title: 'G1', key: 'g1', estimate: { seconds: 120 } }]]);
    p.paint(h);
    assert.equal(last().notice.state, 'awaiting');
    assert.match(last().notice.headline, /^'G1' will take about 2 minutes\./);
    assert.deepEqual(p.shownOf(h), { provider: 'plot-group', role: 'color', rec: null });
    // a score event (its handle changed, still ready): the painter paints the host again, and the grouping's notice stays
    score.set(h, [['x', { state: 'ready', title: 'Sig', key: 'k2', values: [2] }]]);
    p.paint(h);
    assert.equal(last().notice.state, 'awaiting', "a score's repaint keeps the grouping's notice");
    // the score becomes worse than the grouping: it shows, and owns the buttons
    score.set(h, [['x', { state: 'failed', title: 'Sig', key: 'k2', message: 'Gone' }]]);
    p.paint(h);
    assert.equal(last().notice.state, 'failed');
    assert.equal(p.shownOf(h).provider, 'plot-score');
    assert.equal(last().overlay, false, 'a failed x axis is said by its placeholder');
    // nothing left to say on the host: cleared
    score.set(h, []);
    group.set(h, []);
    p.paint(h);
    assert.equal(last().notice, null);
    assert.equal(p.shownOf(h), null);
});

test("a notice's button goes to the provider whose notice it is, not to the first that owns the host", () => {
    const { p } = recordedPainter();
    const score = source(p, 'plot-score', SCORE);
    const group = source(p, 'plot-group', GROUPING);
    const registry = A.actions.fresh();
    registry.routeBy((h) => { const s = p.shownOf(h); return s ? s.provider : null; });
    const ran = [];
    const provider = (id) => ({ id, owns: () => true, actions: { 'score-compute': { target: (h) => h, run: () => { ran.push(id); } } } });
    registry.register(provider('plot-score'));     // registered first: it used to answer every button
    registry.register(provider('plot-group'));
    const h = host();
    score.set(h, [['x', { state: 'ready', title: 'Sig', key: 'k', values: [1] }]]);
    group.set(h, [['color', { state: 'awaiting', title: 'G1', key: 'g', estimate: { seconds: 120 } }]]);
    p.paint(h);
    assert.equal(registry.run('score-compute', h), true);
    assert.deepEqual(ran, ['plot-group'], "the grouping's Compute computes the grouping");
    // no notice shown: the first owner answers, as before
    score.set(h, []);
    group.set(h, []);
    p.paint(h);
    registry.run('score-compute', h);
    assert.deepEqual(ran, ['plot-group', 'plot-score']);
});

test('a shown provider that does not own the host gets no button; a source id is registered once', () => {
    const { p } = recordedPainter();
    const group = source(p, 'plot-group', GROUPING);
    const registry = A.actions.fresh();
    registry.routeBy((h) => { const s = p.shownOf(h); return s ? s.provider : null; });
    registry.register({ id: 'plot-score', owns: () => true, actions: { 'score-compute': { target: (h) => h, run() {} } } });
    registry.register({ id: 'plot-group', owns: () => false, actions: { 'score-compute': { target: (h) => h, run() {} } } });
    const h = host();
    group.set(h, [['color', { state: 'awaiting', title: 'G1', key: 'g', estimate: { seconds: 120 } }]]);
    p.paint(h);
    assert.equal(registry.available('score-compute', h), false, "another provider never answers a notice that is not its own");
    assert.throws(() => p.register({ id: 'plot-group', entries: () => [] }), /already registered/);
});

// ---------------------------------------------------------------- the 10 s rule (operator decision 21)

test('a short job keeps its text line; at 10 s by the clock it gets a bar, with no frame to ask for it', () => {
    const { p, last, time } = recordedPainter();
    const score = source(p, 'plot-score', SCORE);
    const h = host();
    score.set(h, [['color', { state: 'computing', title: 'Sig', key: 'k', estimate: { seconds: 3 }, progress: { done: 1, total: 4 } }]]);
    p.paint(h);
    assert.equal(last().notice.progress, undefined, 'under 10 s: no bar');
    assert.equal(time.pending(), 1, 'the 10 s mark is armed');
    time.advance(9000);
    assert.equal(last().notice.progress, undefined);
    time.advance(1100);
    assert.deepEqual(last().notice.progress, { determinate: true, value: 1, max: 4 }, 'from the count when the frame has no entries');
    assert.equal(time.pending(), 0, 'nothing more to wait for');
});

test('an estimate over 10 s shows the bar at once; one of 10 s or less waits for the clock', () => {
    const { p, last } = recordedPainter();
    const score = source(p, 'plot-score', SCORE);
    const h = host();
    score.set(h, [['color', { state: 'computing', title: 'Sig', key: 'k', estimate: { seconds: 10 }, progress: { done: 0, total: 0 } }]]);
    p.paint(h);
    assert.equal(last().notice.progress, undefined, 'exactly 10 s is not over 10 s');
    score.set(h, [['color', { state: 'computing', title: 'Sig', key: 'k', estimate: { seconds: 11 }, progress: { done: 0, total: 0 } }]]);
    p.paint(h);
    assert.deepEqual(last().notice.progress, { determinate: false }, 'nothing counted yet: indeterminate, never 0% of nothing');
});

test("the server's running_s counts too, and entries win over the gene count", () => {
    const { p, last } = recordedPainter();
    const score = source(p, 'plot-score', SCORE);
    const h = host();
    score.set(h, [['color', { state: 'computing', title: 'Sig', key: 'k', estimate: { seconds: 2 },
        progress: { done: 61, total: 200, entries_done: 300, entries_total: 1200, running_s: 10 } }]]);
    p.paint(h);
    assert.deepEqual(last().notice.progress, { determinate: true, value: 300, max: 1200 });
});

test('a queue wait shows an indeterminate bar with its place in line, and no fake percentage', () => {
    const { p, last, time } = recordedPainter();
    const score = source(p, 'plot-score', SCORE);
    const h = host();
    const queued = { state: 'computing', title: 'Sig', key: 'k', estimate: { seconds: 30 },
        progress: { done: 0, total: 200, entries_done: 0, entries_total: 1200, running_s: 0, queue: { ahead: 2, sharing: 0 } } };
    score.set(h, [['color', queued]]);
    p.paint(h);
    assert.equal(last().notice.state, 'queued');
    assert.equal(last().notice.headline, 'Waiting for the server: 2 computations ahead. This plot has no color.');
    assert.deepEqual(last().notice.progress, { determinate: false });
    // the page's own limiter queue and an estimate in flight: indeterminate too, once long
    score.set(h, [['color', { state: 'queued', title: 'Sig', key: 'k2' }]]);
    p.paint(h);
    assert.equal(last().notice.progress, undefined);
    time.advance(10005);
    assert.deepEqual(last().notice.progress, { determinate: false });
});

test('a new key restarts the clock; a job that is done stops it', () => {
    const { p, last, time } = recordedPainter();
    const score = source(p, 'plot-score', SCORE);
    const h = host();
    score.set(h, [['color', { state: 'computing', title: 'Sig', key: 'k1', progress: { done: 1, total: 2 } }]]);
    p.paint(h);
    time.advance(8000);
    score.set(h, [['color', { state: 'computing', title: 'Sig', key: 'k2', progress: { done: 1, total: 2 } }]]);
    p.paint(h);
    time.advance(3000);
    assert.equal(last().notice.progress, undefined, 'the edit started a new job: 3 s, not 11 s');
    time.advance(7100);
    assert.ok(last().notice.progress, 'its own 10 s');
    score.set(h, [['color', { state: 'ready', title: 'Sig', key: 'k2', values: [1] }]]);
    p.paint(h);
    assert.equal(last().notice, null);
    assert.equal(time.pending(), 0);
});

test('a load that keeps its drawing is never covered: after 10 s of running its bar is in the strip, and it goes when the job does', () => {
    const { p, last, strips, lastStrip, time } = recordedPainter();
    const on = new Map();
    p.register({ id: 'plot-score', entries: (h) => (on.get(h) || []) });
    const h = host();
    const snap = { state: 'computing', title: 'Sig', key: 'k', estimate: { seconds: 3 }, progress: { done: 1, total: 4 } };
    const quietEntry = (s) => ({ role: 'color', snap: s, notice: null, quiet: SN.describeSource(s, { role: 'colour' }, SCORE) });
    on.set(h, [quietEntry(snap)]);
    p.paint(h);
    assert.equal(last().notice, null, 'nothing over the plot');
    assert.equal(strips.length, 0, 'a short wait: no bar anywhere');
    time.advance(10005);
    assert.equal(last().notice, null, 'still nothing over the plot');
    assert.deepEqual(lastStrip().bar, { determinate: true, value: 1, max: 4 });
    assert.equal(lastStrip().sentence, "Computing 'Sig': 1 of 4 genes. This plot has no color.");
    // a new job with a long estimate: not on the estimate alone (the clock rule only), then at 10 s; a queue is indeterminate
    on.set(h, [quietEntry({ ...snap, key: 'k2', estimate: { seconds: 40 }, progress: { done: 0, total: 4, queue: { ahead: 1, sharing: 0 } } })]);
    p.paint(h);
    assert.equal(lastStrip().bar, null, 'a quiet load shows no bar on its estimate alone');
    time.advance(10005);
    assert.deepEqual(lastStrip().bar, { determinate: false });
    // the server's running_s is the clock too
    on.set(h, [quietEntry({ ...snap, key: 'k3', estimate: { seconds: 2 }, progress: { done: 2, total: 4, running_s: 12 } })]);
    p.paint(h);
    assert.deepEqual(lastStrip().bar, { determinate: true, value: 2, max: 4 });
    // done: the strip's bar goes, once
    on.set(h, [{ role: 'color', snap: { state: 'ready', key: 'k2', values: [1] }, notice: null }]);
    p.paint(h);
    assert.equal(lastStrip().bar, null);
    const n = strips.length;
    p.paint(h);
    assert.equal(strips.length, n, 'nothing to take away twice');
    assert.equal(time.pending(), 0);
});

// ---------------------------------------------------------------- one binding per provider (O2)

/** A fake handle: its snapshot is set by the test; onChange is the binding's. */
function fakeSources() {
    const handles = [];
    return {
        handles,
        open(hostEl, role, setting, onChange) {
            const handle = { snap: { state: 'computing', title: setting.key, key: `${setting.key}:1`, progress: { done: 0, total: 0 } },
                released: false, read() { return this.snap; }, release() { this.released = true; }, sharers: () => 1,
                set(snap) { this.snap = snap; onChange(snap); } };
            handles.push(handle);
            return { sourceId: setting.key, handle };
        }
    };
}

function binding(over = {}) {
    const { p, painted, time, last } = recordedPainter();
    const src = fakeSources();
    const refreshed = [];
    const b = HB.createHostBinding({
        id: 'plot-fake', open: src.open, matches: (rec, setting) => rec.sourceId === setting.key,
        describe: (snap, ctx) => SN.describeSource(snap, ctx, GROUPING), painter: p, paintMs: 100, setTimer: time.setTimer,
        refresh: (h) => refreshed.push(h), ...over
    });
    return { b, p, painted, time, last, src, refreshed };
}

test('a binding keeps one record per (host, role), remakes it for another setting and releases it with the host', () => {
    const { b, src, p, last } = binding();
    const h = host();
    const r1 = b.recordFor(h, 'color', { key: 'G1' });
    assert.equal(b.recordFor(h, 'color', { key: 'G1' }), r1, 'the same setting: the same record');
    assert.equal(r1.panelId, 'plot');
    const r2 = b.recordFor(h, 'color', { key: 'G2' });
    assert.notEqual(r2, r1);
    assert.equal(src.handles[0].released, true, 'the old handle is released when the setting moves');
    b.recordFor(h, 'x', { key: 'G3' });
    assert.deepEqual(b.hosts(), [h]);
    b.paint(h);
    assert.equal(last().notice.state, 'computing');
    assert.equal(p.shownOf(h).provider, 'plot-fake');
    assert.equal(b.shownRecord(h).role, p.shownOf(h).role);
    b.releaseHost(h);
    assert.ok(src.handles.every(x => x.released));
    assert.deepEqual(b.hosts(), []);
    assert.equal(last().notice, null, 'the last record gone: the host says nothing');
});

test("a burst of changes is painted once; a changed value redraws the panel; a hover role says nothing over the plot", () => {
    const { b, src, painted, time, refreshed } = binding();
    const h = host();
    const rec = b.recordFor(h, 'color', { key: 'G1' });
    b.recordFor(h, 'hover:G9:mean', { key: 'G9' });
    rec.drawnKey = 'G1:0';
    const before = painted.length;
    // an edit computes while the previous groups are still shown: frames repaint the notice, the plot is not redrawn
    for (let i = 0; i < 5; i++) {
        src.handles[0].set({ state: 'updating', title: 'G1', key: 'G1:1', values: [0], shownKey: 'G1:0', progress: { done: i, total: 5 } });
    }
    time.advance(150);
    assert.equal(painted.length, before + 1, 'five frames, one paint');
    assert.equal(painted[painted.length - 1].notice.headline, "Showing the previous 'G1'. Updating.");
    assert.deepEqual(refreshed, []);
    src.handles[0].set({ state: 'ready', title: 'G1', key: 'G1:1', values: [1] });
    time.advance(50);
    assert.deepEqual(refreshed, [h], 'the plot draws the new values');
    b.paint(h);
    assert.equal(painted[painted.length - 1].notice, null, 'ready, and the hover role (computing) is not stated');
});

test('a plot drawn without a value is drawn again when what its strip says changes, and only then', () => {
    const { b, src, time, refreshed } = binding({ stale: (rec, snap) => rec.drawnKey === null && rec.drawnKind !== SN.coverageKindOf(snap) });
    const h = host();
    const rec = b.recordFor(h, 'color', { key: 'G1' });
    rec.drawnKey = null;
    rec.drawnKind = 'pending';
    src.handles[0].set({ state: 'computing', title: 'G1', key: 'G1:1', progress: { done: 1, total: 2 } });
    time.advance(50);
    assert.deepEqual(refreshed, [], 'still on its way: the strip says the same');
    src.handles[0].set({ state: 'refused', title: 'G1', key: 'G1:1' });
    time.advance(50);
    assert.deepEqual(refreshed, [h], 'refused: "not ready yet" would be false now');
});

test('a record the host no longer reads goes at its next change', () => {
    let used = true;
    const { b, src } = binding({ stillUsed: () => used });
    const h = host();
    b.recordFor(h, 'color', { key: 'G1' });
    used = false;
    src.handles[0].set({ state: 'ready', title: 'G1', key: 'G1:1', values: [1] });
    assert.equal(src.handles[0].released, true);
    assert.equal(b.recordsOf(h).size, 0);
});

test('loadWhenReady waits on a pending value while a drawing is kept, and an abort leaves no listener behind', async () => {
    const { b, src } = binding();
    const h = { ...host(), _fullLayout: {}, data: [{}], querySelector: () => null };
    let attempts = 0;
    const load = async (quiet) => {
        attempts++;
        const rec = b.recordFor(h, 'color', { key: 'G1' });
        rec.quiet = quiet;
        const snap = rec.handle.read();
        if (snap.values) return snap.values;
        throw Object.assign(new Error('pending'), { name: 'SourceUnavailable', state: snap.state });
    };
    const got = b.loadWhenReady(load, { host: h, role: 'color' });
    await new Promise(r => setTimeout(r, 0));
    assert.equal(attempts, 1);
    src.handles[0].set({ state: 'ready', title: 'G1', key: 'G1:1', values: [7] });
    assert.deepEqual(await got, [7]);
    assert.equal(b.recordsOf(h).get('color').quiet, false);

    // an abort while waiting: rejected, and the signal holds no listener of the wait
    src.handles[0].snap = { state: 'computing', title: 'G1', key: 'G1:2' };
    const controller = new AbortController();
    let listeners = 0;
    const signal = controller.signal;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (...a) => { listeners++; add(...a); };
    signal.removeEventListener = (...a) => { listeners--; remove(...a); };
    const waiting = b.loadWhenReady(load, { host: h, role: 'color' }, signal);
    await new Promise(r => setTimeout(r, 0));
    src.handles[0].set({ state: 'computing', title: 'G1', key: 'G1:2', progress: { done: 1, total: 2 } });
    await new Promise(r => setTimeout(r, 0));
    assert.equal(listeners, 1, 'a wake removed its listener; only the current wait holds one');
    controller.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
});

test('a lasting state is said at once, with no drawing to keep', async () => {
    const { b, painted } = binding();
    const h = { ...host(), querySelector: () => null };
    const load = async () => {
        const rec = b.recordFor(h, 'color', { key: 'G1' });
        rec.handle.snap = { state: 'failed', title: 'G1', key: 'G1:1', reason: 'read_busy' };
        throw Object.assign(new Error('failed'), { name: 'SourceUnavailable', state: 'failed' });
    };
    await assert.rejects(b.loadWhenReady(load, { host: h, role: 'color' }), { message: 'failed' });
    const shown = painted[painted.length - 1].notice;
    assert.equal(shown.state, 'failed');
    assert.equal(shown.text, 'The server was busy with other computations and could not start this one in time. Try again in a moment.');
    assert.deepEqual(shown.actions.map(a => a[0]), ['score-retry', 'score-open']);
});

test("the page's painter routes the page's action registry", () => {
    const h = host('routed');
    const off = HB.painter.register({ id: 'test-route', entries: (x) => (x === h ? [{ role: 'color', snap: { state: 'failed' },
        notice: SN.describeSource({ state: 'failed', title: 'R' }, {}, GROUPING) }] : []) });
    try {
        HB.painter.paint(h);
        assert.equal(HB.painter.shownOf(h).provider, 'test-route');
        assert.equal(A.actions.available('score-retry', h), false, 'no registered provider has the id: nobody else answers');
    } finally {
        off();
        HB.painter.paint(h);
    }
});

// ---------------------------------------------------------------- no release and reopen loop

/** A binding whose records notify as soon as they are opened, as a real source does (the first snapshot). */
function notifyingBinding(over = {}) {
    const inner = fakeSources();
    const open = (hostEl, role, setting, onChange) => {
        const made = inner.open(hostEl, role, setting, onChange);
        const handle = inner.handles[inner.handles.length - 1];
        queueMicrotask(() => { if (!handle.released) handle.set({ state: 'computing', title: setting.key, key: `${setting.key}:1`, progress: { done: 1, total: 2 } }); });
        return made;
    };
    return { ...binding({ open, ...over }), inner };
}

/** A load as a plot makes it: one attempt opens the record and throws while its value is pending; it gives up when it runs away. */
function pendingLoad(b, h, key) {
    const run = { attempts: 0 };
    run.load = async (quiet) => {
        if (++run.attempts > 40) throw new Error('runaway: the record was reopened over and over');
        const rec = b.recordFor(h, 'color', { key });
        rec.quiet = quiet;
        throw Object.assign(new Error('pending'), { name: 'SourceUnavailable', state: rec.handle.read().state });
    };
    return run;
}

test('a host whose config does not hold the role releases the record once, and the waiting load ends instead of reopening it', async () => {
    const { b, inner } = notifyingBinding({ stillUsed: () => false });
    const h = { ...host(), _fullLayout: {}, data: [{}], querySelector: () => null };
    const run = pendingLoad(b, h, 'G1');
    await assert.rejects(b.loadWhenReady(run.load, { host: h, role: 'color' }), { name: 'AbortError' });
    assert.ok(run.attempts <= 2, `attempts: ${run.attempts}`);
    assert.equal(inner.handles.length, run.attempts, 'one handle per attempt, none reopened by the release');
    assert.ok(inner.handles.every((x) => x.released));
    assert.equal(b.recordsOf(h).size, 0);
});

test('a host that has gone ends the waiting load with no new record', async () => {
    const { b, inner } = notifyingBinding();
    const h = { ...host(), _fullLayout: {}, data: [{}], querySelector: () => null };
    const run = pendingLoad(b, h, 'G1');
    const waiting = b.loadWhenReady(run.load, { host: h, role: 'color' });
    await new Promise((r) => setTimeout(r, 0));
    h.isConnected = false;
    inner.handles[0].set({ state: 'computing', title: 'G1', key: 'G1:2', progress: { done: 1, total: 2 } });
    await assert.rejects(waiting, { name: 'AbortError' });
    assert.ok(run.attempts <= 2, `attempts: ${run.attempts}`);
    assert.equal(b.recordsOf(h).size, 0);
});

test('a setting that moves while a load waits ends that load; only the new one reads the new record', async () => {
    const { b } = notifyingBinding();
    const h = { ...host(), _fullLayout: {}, data: [{}], querySelector: () => null };
    const first = pendingLoad(b, h, 'G1');
    const waiting = b.loadWhenReady(first.load, { host: h, role: 'color' });
    await new Promise((r) => setTimeout(r, 0));
    const second = pendingLoad(b, h, 'G2');
    const next = b.loadWhenReady(second.load, { host: h, role: 'color' });
    await assert.rejects(waiting, { name: 'AbortError' });
    assert.ok(first.attempts <= 2, `the old load: ${first.attempts}`);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(b.recordsOf(h).get('color').setting.key, 'G2');
    b.releaseHost(h);
    await assert.rejects(next, { name: 'AbortError' });
    assert.ok(second.attempts <= 3, `the new load: ${second.attempts}`);
});
