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
const { check, panelCost, readLimits, memorySettings, Ledger, GB, DEFAULT_MODEL } = await import('../../../static/js/utils/memory-guard.js');

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

test('largePlotParts: 81 B per point in all, the build buffers kept, the rest transient', () => {
    const n = 1000;
    const p = largePlotParts(n);
    const total = p.reduce((a, x) => a + x.length * BYTES[x.type], 0);
    assert.equal(total, 81 * n);
    assert.deepEqual(p.filter(x => !x.transient).map(x => [x.name, x.type]), [['key', 'u16'], ['X', 'f32'], ['Y', 'f32']]);
    assert.ok(p.filter(x => x.transient).every(x => x.name.startsWith('peak-')));
    assert.ok(largePlotParts(10, { log: true }).some(x => x.name === 'logged'));
    // the model's figure, not a hand list: 250M points is 20.25 GB
    const big = largePlotParts(250e6, { bytesPerPoint: 81 }).reduce((a, x) => a + x.length * BYTES[x.type], 0);
    assert.equal(big, 81 * 250e6);
    // blocks are cut into chunks
    assert.ok(largePlotParts(250e6).filter(x => x.transient).length > 20);
});

test('probe succeeds: the kept buffers come back, the transient block is released at once', () => {
    const a = capped(1e9);
    const r = probe(largePlotParts(1000), { alloc: a });
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r.buffers).sort(), ['X', 'Y', 'key']);
    assert.equal(a.s.used, 2000 + 4000 + 4000);
    r.release();
    assert.equal(a.s.used, 0);
});

test('probe fails on a RangeError: everything allocated so far is released, the failing part named', () => {
    // 250M points need 20.25 GB; a browser that gives 12 GB refuses, before any data
    const a = capped(12e9);
    const r = probe(largePlotParts(250e6), { alloc: a });
    assert.equal(r.ok, false);
    assert.match(r.failed, /^peak-\d+$/);
    assert.ok(isAllocationFailure(r.error));
    assert.equal(a.s.used, 0);
    assert.deepEqual(r.buffers, {});
    // the benchmark laptop's tab holds 16.64 GB of ArrayBuffers: 200M (16.2 GB) fits, 210M (17.0 GB) does not (81 B a point: 73 for the draw, 8 for the point index)
    assert.equal(probe(largePlotParts(200e6), { alloc: capped(16.64e9) }).ok, true);
    assert.equal(probe(largePlotParts(210e6), { alloc: capped(16.64e9) }).ok, false);
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
    const opts = {};
    const a = capped(65 * 120e6);
    const size = suggestSize(250e6, m => largePlotParts(m, opts), { alloc: a, floor: 1000 });
    assert.ok(size > 0 && size <= 120e6 * 0.8, size);
    assert.equal(size, niceFloor(size));
    assert.equal(a.s.used, 0);
    // nothing fits
    assert.equal(suggestSize(250e6, m => largePlotParts(m, opts), { alloc: capped(10), floor: 1000 }), null);
});

test('probeForDraw: buffers when they fit; an AllocationProbeError with the subset when not', () => {
    const ok = probeForDraw({ n: 500, alloc: capped(1e9) });
    assert.equal(ok.X.length, 500);
    assert.throws(() => probeForDraw({ n: 250e6, eligible: 1e9, alloc: capped(65 * 120e6) }), (e) => {
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
        const pre = probeForDraw({ n: 1000, alloc });
        await Promise.all(['x', 'y', 'colour'].map(request));
        return pre;
    }
    await assert.rejects(draw(capped(1000)), /cannot hold 1,000 points/);
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

test('a redraw beside the plot it replaces asks only for what its first step adds', () => {
    // the tab holds 16.64 GB of ArrayBuffers; a drawn gene plot holds 69 B per point of them (61 for the plot, 8 for its point index)
    const held = (n) => 69 * n;
    const beside = (n) => probeForDraw({ n, bytesPerPoint: 14, alloc: capped(16.64e9 - held(n)) });
    assert.equal(beside(200e6).key.length, 200e6);
    assert.throws(() => beside(225e6), AllocationProbeError);
    // the subset suggested is sized for a fresh draw: the old plot's bytes are freed when it draws
    assert.throws(() => probeForDraw({ n: 225e6, bytesPerPoint: 14, credit: held(225e6), alloc: capped(16.64e9 - held(225e6)) }), (e) => {
        assert.ok(e.size >= 100e6, e.size);
        assert.ok(e.size * 81 <= 16.64e9);
        assert.match(e.message, /\(3 parts of 100,000,000\)$/);
        return true;
    });
});

test('the model counts the 8 B point index once per quantity: off 65+8, ArrayBuffers 73+8, held plot 61+8', () => {
    const L = DEFAULT_MODEL.large;
    assert.equal(L.off, 65 + 8);
    assert.equal(L.arrayBuffers, 73 + 8);
    assert.equal(L.heldPerPoint, 61 + 8);
    // the redraw's first step adds no index: the old plot's is already in heldPerPoint
    assert.equal(L.redrawBeside, 14);
    // the probe sized from the model asks for the full 81 B
    const total = largePlotParts(1000, { bytesPerPoint: L.arrayBuffers }).reduce((a, x) => a + x.length * BYTES[x.type], 0);
    assert.equal(total, 81 * 1000);
});
