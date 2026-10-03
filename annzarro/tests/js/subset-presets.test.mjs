/**
 * The subset dialog's size presets and load-time estimate
 * (static/js/utils/subset-presets.js): the 1-2-5 ladder, the parts each
 * size makes, and the estimate model with its defaults, its calibration to
 * this session's timings and its extrapolation flag.
 *
 * Run:  node --test annzarro/tests/js/subset-presets.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
    presetSizes, partsFor, shortCount, estimateLoad, formatSeconds, DEFAULT_MODEL, EXTRAPOLATE_FACTOR,
    recordLoad, recordServer, serverSeconds, loadSamples, resetLoadSamples
} = await import('../../../static/js/utils/subset-presets.js');

test('the ladder is 1-2-5 from 1k, below the eligible cells, fast to complete', () => {
    assert.deepEqual(presetSizes(1000000),
        [1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000]);
    const big = presetSizes(95624334);
    assert.equal(big[0], 1000);
    assert.equal(big[big.length - 1], 50000000);
    assert.equal(big.length, 15);
    for (let i = 1; i < big.length; i++) assert.ok(big[i] > big[i - 1]);
    for (const n of big) assert.match(String(n), /^[125]0*$/);
    // a rung equal to the eligible count is "All", not a preset
    assert.ok(!presetSizes(100000).includes(100000));
});

test('a small dataset still gets the three largest rungs below it', () => {
    assert.deepEqual(presetSizes(200), [20, 50, 100]);
    assert.deepEqual(presetSizes(1500), [200, 500, 1000]);
    assert.deepEqual(presetSizes(2), [1]);
    assert.deepEqual(presetSizes(1), []);
    assert.deepEqual(presetSizes(0), []);
});

test('parts are ceil(eligible / n), as the server counts them', () => {
    assert.equal(partsFor(95624334, 100000), 957);
    assert.equal(partsFor(1000000, 100000), 10);
    assert.equal(partsFor(1000001, 100000), 11);
    assert.equal(partsFor(200, 500), 1);
    assert.equal(partsFor(0, 10), 1);
});

test('short labels', () => {
    assert.deepEqual([1000, 20000, 1000000, 1500000, 95624334, 20].map(shortCount),
        ['1k', '20k', '1M', '1.5M', '95.6M', '20']);
    assert.equal(shortCount(9562433), '9.6M');
});

test('the default estimate reproduces the benchmark it was fitted to', () => {
    resetLoadSamples();
    const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
    near(estimateLoad(100000, { nTotal: 1000000 }).seconds, 1.10, 0.1);
    near(estimateLoad(100000, { nTotal: 95624334 }).seconds, 3.00, 0.1);
    near(estimateLoad(1000000, { nTotal: 1000000 }).seconds, 6.08, 0.1);
    const large = estimateLoad(95624334, { nTotal: 95624334 });
    assert.equal(large.large, true);
    near(large.seconds, 9.03, 1.0);
    assert.equal(large.calibrated, false);
    // within the benchmark's range: 1M regular, 95.6M large
    assert.equal(large.extrapolated, false);
    assert.equal(estimateLoad(4000000, { nTotal: 1e8 }).extrapolated, false);
    assert.equal(estimateLoad(4000001, { nTotal: 1e8 }).extrapolated, true);
});

test('the estimate grows with n on each path', () => {
    resetLoadSamples();
    const ctx = { nTotal: 95624334, threshold: 5000000 };
    for (const sizes of [presetSizes(5000001).filter(n => n <= 5000000), [1e7, 2e7, 5e7, 95624334]]) {
        const t = sizes.map(n => estimateLoad(n, ctx).seconds);
        for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1], `${sizes[i]}: ${t[i]} <= ${t[i - 1]}`);
    }
    // ... and stays monotone once calibrated
    const samples = [{ n: 2000, seconds: 0.2, kind: 'first', large: false },
                     { n: 400000, seconds: 1.0, kind: 'first', large: false }];
    const t = [1000, 10000, 100000, 1000000].map(n => estimateLoad(n, { ...ctx, samples }).seconds);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1]);
});

test('large-plot mode starts above the configured threshold', () => {
    assert.equal(estimateLoad(5000000, { threshold: 5000000 }).large, false);
    assert.equal(estimateLoad(5000001, { threshold: 5000000 }).large, true);
    assert.equal(estimateLoad(150, { threshold: 100 }).large, true);
});

test('calibration: big plots set the per-point cost, small ones the fixed cost', () => {
    const ctx = { nTotal: 0, threshold: 5000000 };
    const base = (n) => estimateLoad(n, { ...ctx, samples: [] }).seconds;
    // a machine twice as slow per point as the benchmark
    const slow = [{ n: 1000000, seconds: 2 * DEFAULT_MODEL.regular.first.perPoint * 1000000, kind: 'first', large: false }];
    const est = estimateLoad(1000000, { ...ctx, samples: slow });
    assert.equal(est.calibrated, true);
    assert.equal(est.extrapolated, false);
    assert.ok(est.seconds > 1.7 * base(1000000));
    // a tiny plot alone speaks for the fixed cost, not the slope: the
    // default slope stays, with the benchmark's range
    const tiny = [{ n: 200, seconds: 0.1, kind: 'first', large: false }];
    const far = estimateLoad(1000000, { ...ctx, samples: tiny });
    assert.equal(far.calibrated, true);
    assert.equal(far.extrapolated, false);
    assert.equal(far.measuredUpTo, DEFAULT_MODEL.regular.measuredUpTo);
    assert.ok(far.seconds < base(1000000));
    assert.ok(far.seconds > base(1000000) - DEFAULT_MODEL.regular.first.fixed);
    assert.equal(estimateLoad(5000000, { ...ctx, samples: tiny }).extrapolated, true);
});

test('recolour timings calibrate against the recolour model', () => {
    const r = DEFAULT_MODEL.regular.recolour;
    const samples = [{ n: 1000000, seconds: 3 * (r.fixed + r.perPoint * 1e6), kind: 'recolour', large: false }];
    const est = estimateLoad(1000000, { threshold: 5000000, samples });
    const base = estimateLoad(1000000, { threshold: 5000000, samples: [] });
    assert.ok(est.seconds > 2.5 * base.seconds);
});

test('extrapolated beyond EXTRAPOLATE_FACTOR x the largest measured n, and per path', () => {
    const samples = [{ n: 100000, seconds: 1.0, kind: 'first', large: false }];
    const ctx = { threshold: 5000000, samples };
    assert.equal(estimateLoad(100000 * EXTRAPOLATE_FACTOR, ctx).extrapolated, false);
    assert.equal(estimateLoad(100000 * EXTRAPOLATE_FACTOR + 1, ctx).extrapolated, true);
    assert.equal(estimateLoad(1000, ctx).extrapolated, false);
    const large = estimateLoad(1e7, ctx);
    assert.equal(large.calibrated, false);      // no large-plot draw yet: the benchmark's range
    assert.equal(large.measuredUpTo, DEFAULT_MODEL.large.measuredUpTo);
    assert.equal(large.extrapolated, false);
    assert.equal(estimateLoad(4e8, ctx).extrapolated, true);
    assert.equal(estimateLoad(1e5, ctx).measuredUpTo, 100000);
});

test('a measured server time can raise the modelled one, not lower it', () => {
    const at = (serverTime) => estimateLoad(1000, { nTotal: 95624334, samples: [], serverTime }).seconds;
    const modelled = DEFAULT_MODEL.serverPerCell * 95624334;
    assert.equal(at(0.01), at(null));
    assert.ok(Math.abs((at(modelled + 5) - at(null)) - 5) < 1e-9);
});

test('the session record keeps sane samples only, and the server time per dataset', () => {
    resetLoadSamples();
    recordLoad({ n: 100, seconds: 0.5 });
    recordLoad({ n: 0, seconds: 0.5 });
    recordLoad({ n: 100, seconds: NaN });
    recordLoad({ n: 100, seconds: 0.5, kind: 'zoom' });
    recordLoad({ n: 2e7, seconds: 2, large: true, kind: 'first' });
    assert.deepEqual(loadSamples().map(s => [s.n, s.large]), [[100, false], [2e7, true]]);
    for (let i = 0; i < 100; i++) recordLoad({ n: 1 + i, seconds: 1 });
    assert.equal(loadSamples().length, 64);
    recordServer('/a.zarr', 1000, 0.25);
    assert.equal(serverSeconds('/a.zarr'), 0.25);
    assert.equal(serverSeconds('/b.zarr'), null);
    // the session's samples are the default ones
    assert.equal(estimateLoad(50, { threshold: 5000000 }).calibrated, true);
    resetLoadSamples();
    assert.equal(estimateLoad(50, { threshold: 5000000 }).calibrated, false);
});

test('times are rounded so they do not look precise', () => {
    assert.deepEqual([0.2, 1.4, 6.08, 12, 28, 59, 75, 900].map(formatSeconds),
        ['<1 s', '~1 s', '~6 s', '~10 s', '~30 s', '~60 s', '~1 min', '~15 min']);
});
