/**
 * The allocation probe (static/js/utils/alloc-probe.js): buffers are
 * allocated before the data is requested; a RangeError releases everything,
 * names the subset to use, and stops the draw before any request.
 *
 * Run:  node --test annzarro/tests/js/alloc-probe.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
    BYTES, PROBE_MIN_BYTES, setAllocator, allocate, isAllocationFailure, probe, largePlotParts, blockParts,
    niceFloor, suggestSize, probeMessage, probeForDraw, AllocationProbeError
} = await import('../../../static/js/utils/alloc-probe.js');
const { check, panelCost, readLimits, memorySettings, Ledger, GB } = await import('../../../static/js/utils/memory-guard.js');

/** An allocator that gives at most `limit` bytes in total (a browser with a cap) and counts calls. */
function capped(limit) {
    const s = { used: 0, calls: 0, given: [] };
    const fn = (type, length) => {
        s.calls++;
        const bytes = length * BYTES[type];
        if (s.used + bytes > limit) throw new RangeError('Array buffer allocation failed');
        s.used += bytes;
        const a = { type, length, buffer: { detached: false, transfer() { s.used -= bytes; this.detached = true; } } };
        s.given.push(a);
        return a;
    };
    return Object.assign(fn, { s });
}

test('largePlotParts: response bodies are transient, build buffers are kept', () => {
    const p = largePlotParts(1000, { colour: 'categorical' });
    assert.deepEqual(p.filter(x => x.transient).map(x => [x.name, x.type]), [['x-body', 'f32'], ['y-body', 'f32'], ['colour-body', 'u16']]);
    assert.deepEqual(p.filter(x => !x.transient).map(x => [x.name, x.type]), [['key', 'u16'], ['X', 'f32'], ['Y', 'f32']]);
    assert.ok(largePlotParts(10, { colour: 'numeric', log: true }).some(x => x.name === 'logged'));
    assert.ok(!largePlotParts(10, { colour: 'none' }).some(x => x.name === 'colour-body'));
});

test('probe succeeds: the kept buffers come back, the transient ones are released at once', () => {
    const a = capped(1e9);
    const r = probe(largePlotParts(1000, { colour: 'numeric' }), { alloc: a });
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r.buffers).sort(), ['X', 'Y', 'key']);
    // 3 bodies of 4 kB are gone; key 2 kB + X, Y 4 kB each are held
    assert.equal(a.s.used, 2000 + 4000 + 4000);
    r.release();
    assert.equal(a.s.used, 0);
});

test('probe fails on a RangeError: everything allocated so far is released, the failing part named', () => {
    // fits the bodies and the key, not X
    const n = 1000;
    const a = capped(3 * 4 * n + 2 * n + 100);
    const r = probe(largePlotParts(n, { colour: 'numeric' }), { alloc: a });
    assert.equal(r.ok, false);
    assert.equal(r.failed, 'X');
    assert.equal(r.failedBytes, 4 * n);
    assert.ok(isAllocationFailure(r.error));
    assert.equal(a.s.used, 0);
    assert.deepEqual(r.buffers, {});
});

test('an error that is not a RangeError is not swallowed', () => {
    assert.throws(() => probe(blockParts(10), { alloc: () => { throw new TypeError('boom'); } }), TypeError);
});

test('the injected allocator: setAllocator and the page hook', () => {
    setAllocator(() => { throw new RangeError('x'); });
    try {
        assert.equal(probe(blockParts(10)).ok, false);
    } finally {
        setAllocator(null);
    }
    assert.equal(allocate('u8', 4).length, 4);
    globalThis.__annzarroAllocator = () => { throw new RangeError('hook'); };
    try {
        assert.equal(probe(blockParts(10)).ok, false);
    } finally {
        delete globalThis.__annzarroAllocator;
    }
    assert.equal(probe(blockParts(10)).ok, true);
});

test('niceFloor and probeMessage', () => {
    assert.equal(niceFloor(62500000), 50000000);
    assert.equal(niceFloor(199), 100);
    assert.equal(niceFloor(2400), 2000);
    assert.equal(probeMessage(250000000, 50000000, 1000000000),
        'This browser cannot hold 250,000,000 points; use a subset (20 parts of 50,000,000)');
    assert.equal(probeMessage(200, 50, 200), 'This browser cannot hold 200 points; use a subset (4 parts of 50)');
    assert.equal(probeMessage(10, 10, 10), 'This browser cannot hold 10 points; use a subset (1 part of 10)');
    assert.equal(probeMessage(10, null), 'This browser cannot hold 10 points; use a much smaller subset');
});

test('suggestSize: the largest probed size that fits, cut and rounded down', () => {
    const opts = { colour: 'categorical' };
    // 22 B per point at the peak for this colour (3 bodies 10 B + key 2 + X, Y 8)
    const a = capped(22 * 120e6);
    const size = suggestSize(250e6, m => largePlotParts(m, opts), { alloc: a, floor: 1000 });
    assert.ok(size > 0 && size <= 120e6 * 0.8, size);
    assert.equal(size, niceFloor(size));
    assert.equal(a.s.used, 0);
    // nothing fits
    assert.equal(suggestSize(250e6, m => largePlotParts(m, opts), { alloc: capped(10), floor: 1000 }), null);
});

test('probeForDraw: buffers when they fit; an AllocationProbeError with the subset when not', () => {
    const ok = probeForDraw({ n: 500, colour: 'numeric', alloc: capped(1e9) });
    assert.equal(ok.X.length, 500);
    assert.throws(() => probeForDraw({ n: 250e6, colour: 'categorical', eligible: 1e9, alloc: capped(22 * 120e6) }), (e) => {
        assert.ok(e instanceof AllocationProbeError);
        assert.equal(e.name, 'AllocationProbeError');
        assert.match(e.message, /^This browser cannot hold 250,000,000 points; use a subset \(\d+ parts of [\d,]+\)$/);
        assert.equal(e.n, 250e6);
        return true;
    });
});

test('after a failed probe no data request is issued', async () => {
    // the draw's order (large-plot.js _drawLargePlot): probe, then the requests
    const requests = [];
    const request = async (what) => { requests.push(what); return what; };
    async function draw(alloc) {
        const pre = probeForDraw({ n: 1000, colour: 'numeric', alloc });
        await Promise.all(['x', 'y', 'colour'].map(request));
        return pre;
    }
    await assert.rejects(draw(capped(100)), /cannot hold 1,000 points/);
    assert.deepEqual(requests, []);
    await draw(capped(1e9));
    assert.deepEqual(requests, ['x', 'y', 'colour']);
});

test('the RAM budget still refuses on a small machine, whatever the probe could do', () => {
    const st = memorySettings({ host_memory_bytes: 16 * GB });
    const limits = readLimits({ performance: {}, navigator: {} }, st);
    const need = panelCost({ kind: 'cell-plot', n: 400e6, large: true }).peak;
    const r = check(need, new Ledger().totals(), limits, st);
    assert.equal(r.verdict, 'block');
    assert.equal(r.binding, 'total');
    assert.ok(PROBE_MIN_BYTES > 0);
});
