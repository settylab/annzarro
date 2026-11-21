/**
 * The smoothing of a density (utils/kde.js, V3, CNT-10) against the diagonal-bandwidth oracle (R2): a Gaussian kernel
 * with a bandwidth per axis, evaluated at the grid's cell centres by smoothing the binned counts. Every case of
 * tests/data/oracle/kde.json is smoothed and compared within 2% of the oracle's peak, with the bandwidth floored at
 * 1.5 grid steps as the engine's grid is. The oracle is NOT scipy.stats.gaussian_kde (full covariance); `corr` is the
 * case where the two would differ.
 *
 * Run:  node --test annzarro/tests/js/kde.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const K = await import('../../../static/js/utils/kde.js');
const oracle = JSON.parse(readFileSync(new URL('../data/oracle/kde.json', import.meta.url), 'utf8'));

/** The engine's grid of a case: its counts, dense (x slowest), and the grid's own step (the oracle's, over `grid / bins`). */
const dense = (c) => { const a = new Float64Array(c.grid ** c.dims); c.cells.forEach((cell, i) => { a[cell] = c.counts[i]; }); return a; };
const fineStep = (c) => c.step.map((s) => (s * c.bins) / c.grid);
/** A density on the engine's grid read at the oracle's cell centres: a centre lies between two grid cells per axis. */
function atOracle(f, c) {
    const r = c.grid / c.bins;
    const at = (i) => (r === 1 ? [i] : [r * i + r / 2 - 1, r * i + r / 2]);
    const out = [];
    for (const ix of Array.from({ length: c.bins }, (_, i) => at(i))) {
        if (c.dims === 1) { out.push(ix.reduce((s, a) => s + f[a], 0) / ix.length); continue; }
        for (let j = 0; j < c.bins; j++) {
            const iy = at(j);
            let s = 0;
            for (const a of ix) for (const b of iy) s += f[a * c.grid + b];
            out.push(s / (ix.length * iy.length));
        }
    }
    return out;
}
const peak = (a) => { let m = 0; for (const v of a) if (v > m) m = v; return m; };
const worst = (got, want) => { let d = 0; for (let i = 0; i < want.length; i++) d = Math.max(d, Math.abs(got[i] - want[i])); return d / peak(want); };
const stepOf = (c, d) => c.step[d];

/** The bandwidth the engine's reply gives the browser: sigma and n of the pre-pass, Scott's rule, the adjust, the floor. */
const bandwidths = (c) => c.sigma.map((sigma, d) => K.bandwidthOf({ sigma, n: c.n, dims: c.dims, adjust: c.adjust, step: stepOf(c, d) }));

/**
 * Two references. `density_binned` is the oracle's definition (direct summation, diagonal bandwidth) over the values
 * snapped to the engine's grid centres, which is what counts can carry: the like-for-like check of the smoothing, held
 * to 2% of the peak in EVERY case. `density` is the same over the raw values: 2% where counts can reach it, and for three
 * 2D cases a measured cap. The cause is counts-only binning: a column with a spike of exactly equal values (the
 * fixture's 60% zeros in `depth`, the zeros of the logged genes) has the spike moved by up to half a bin, which no
 * smoothing of the counts can know. That is a property of the design, not of the smoothing; the lead approved the caps
 * as a stated deviation from the plan's 2%. A cap is a ceiling, and each is also asserted over 2% so one that is no
 * longer needed fails and goes.
 */
const BINNING_LIMITED = Object.freeze({ 'corr__a0.5': 0.03, 'score_depth__a0.5': 0.06, 'score_depth__a1': 0.04 });

const oracleRead = (c) => {
    // the oracle's own (floored) bandwidth, on the grid the count plot asks for, read at the oracle's centres
    const [sx, sy] = fineStep(c);
    const full = c.dims === 1
        ? K.smooth1(dense(c), sx, c.h_floor[0])
        : K.smooth2(dense(c), { nx: c.grid, ny: c.grid, stepX: sx, stepY: sy, hx: c.h_floor[0], hy: c.h_floor[1] });
    return { full, got: atOracle(full, c) };
};

for (const [name, c] of Object.entries(oracle.cases)) {
    test(`${name}: the smoothed counts match the binned diagonal-bandwidth oracle within 2% of its peak`, () => {
        const { got } = oracleRead(c);
        assert.equal(got.length, c.density_binned.length);
        const e = worst(got, c.density_binned);
        assert.ok(e < 0.02, `${name}: ${e}`);
    });
    test(`${name}: against the raw-value oracle, within 2% of its peak or its measured binning cap`, (t) => {
        const e = worst(oracleRead(c).got, c.density);
        if (BINNING_LIMITED[name] === undefined) return assert.ok(e < 0.02, `${name}: ${e}`);
        t.diagnostic(`${name}: ${(100 * e).toFixed(2)}% of the peak (binning limit)`);
        assert.ok(e >= 0.02 && e < BINNING_LIMITED[name], `${name}: ${e} is no longer a binning limit, or has grown`);
    });
}

test('the smoothing of the binned counts is exact: it equals the direct sum over the same counts', () => {
    const c = oracle.cases['corr__a1'];
    const { full } = oracleRead(c);
    const [sx, sy] = fineStep(c);
    const cells = c.cells.map((cell, i) => ({ ix: Math.floor(cell / c.grid), iy: cell % c.grid, n: c.counts[i] }));
    const m = cells.reduce((p, k) => p + k.n, 0);
    for (const [ix, iy] of [[10, 10], [128, 128], [140, 90], [200, 30], [255, 255]]) {
        let s = 0;
        for (const k of cells) {
            const u = ((ix - k.ix) * sx) / c.h_floor[0];
            const v = ((iy - k.iy) * sy) / c.h_floor[1];
            s += k.n * Math.exp(-0.5 * (u * u + v * v));
        }
        const direct = s / m / (c.h_floor[0] * c.h_floor[1] * 2 * Math.PI);
        assert.ok(Math.abs(full[ix * c.grid + iy] - direct) < 1e-5 * peak(full), `${ix},${iy}`);
    }
});

test('the bandwidth rule is Scott per dimension: sigma times n to the power of -1/(d+4), times the adjust', () => {
    for (const c of Object.values(oracle.cases)) {
        const h = bandwidths(c);
        c.sigma.forEach((_, d) => {
            assert.ok(Math.abs(h[d].raw - c.h[d]) < 1e-8 * Math.max(1, c.h[d]), 'the unfloored bandwidth is the oracle\'s');
            assert.ok(Math.abs(h[d].h - c.h_floor[d]) < 1e-8 * Math.max(1, c.h_floor[d]), 'the floored bandwidth is the oracle\'s');
        });
    }
});

test('the floor is 1.5 grid steps, applies per axis, and says so', () => {
    assert.equal(K.FLOOR_STEPS, 1.5);
    const low = K.bandwidthOf({ sigma: 1, n: 1e6, dims: 1, adjust: 1, step: 0.1 });
    assert.equal(low.floored, true);
    assert.ok(Math.abs(low.h - 0.15) < 1e-12);
    assert.ok(low.raw < 0.15);
    const fine = K.bandwidthOf({ sigma: 1, n: 100, dims: 1, adjust: 1, step: 0.01 });
    assert.equal(fine.floored, false);
    assert.equal(fine.h, fine.raw);
    // the 2D cases of the oracle where the floor bites on one axis only
    const flo = Object.values(oracle.cases).filter((c) => c.dims === 2).map(bandwidths).filter((h) => h.some((x) => x.floored));
    assert.ok(flo.length >= 2);
    assert.ok(flo.some((h) => h[0].floored !== h[1].floored), 'a floor on one axis and not the other');
});

test('a constant column (sigma 0) is smoothed at the floor, never at zero', () => {
    const b = K.bandwidthOf({ sigma: 0, n: 50, dims: 1, adjust: 1, step: 0.2 });
    assert.ok(b.floored && Math.abs(b.h - 0.3) < 1e-12);
});

test('a density integrates to 1 away from the range\'s edges, and its mass is never created or lost beyond them', () => {
    const counts = new Float64Array(512);
    counts[256] = 40;
    const f = K.smooth1(counts, 0.5, 5);
    let sum = 0;
    for (const v of f) sum += v * 0.5;
    assert.ok(Math.abs(sum - 1) < 1e-3, String(sum));
    // a spike at the edge loses the half of its kernel that lies outside the range, as the oracle does
    const edge = new Float64Array(512);
    edge[0] = 10;
    let half = 0;
    for (const v of K.smooth1(edge, 0.5, 5)) half += v * 0.5;
    assert.ok(Math.abs(half - 0.5) < 0.03, String(half));
});

test('no cells give zeros, not NaN', () => {
    assert.ok(K.smooth1(new Float64Array(64), 1, 3).every((v) => v === 0));
    assert.ok(K.smooth2(new Float64Array(64), { nx: 8, ny: 8, stepX: 1, stepY: 1, hx: 2, hy: 2 }).every((v) => v === 0));
});

test('the direct and the transform path agree: a kernel too wide to sum directly gives the same curve', () => {
    const c = oracle.cases['score__a1'];
    for (const h of [0.05, 0.4, 3, 12]) {
        const a = K.smooth1(dense(c), c.step[0], h, { method: 'direct' });
        const b = K.smooth1(dense(c), c.step[0], h, { method: 'fft' });
        assert.ok(worst(b, a) < 1e-9, `h ${h}: ${worst(b, a)}`);
    }
});

test('no result is negative, whatever the path', () => {
    const c = oracle.cases['depth__a0.5'];
    for (const m of ['direct', 'fft']) assert.ok(K.smooth1(dense(c), c.step[0], 8, { method: m }).every((v) => v >= 0));
});

test('smoothing does no work that grows with the cells: only with the grid', () => {
    const grid = new Float64Array(512 * 512);
    for (let i = 0; i < grid.length; i++) grid[i] = i % 7;
    const big = new Float64Array(512 * 512);
    for (let i = 0; i < big.length; i++) big[i] = (i % 7) * 1e6;
    const t = (g) => { const t0 = performance.now(); K.smooth2(g, { nx: 512, ny: 512, stepX: 1, stepY: 1, hx: 3, hy: 3 }); return performance.now() - t0; };
    t(grid);
    const a = t(grid);
    const b = t(big);
    assert.ok(b < 4 * a + 50, `a ${a} ms, a million times the cells ${b} ms`);
});
