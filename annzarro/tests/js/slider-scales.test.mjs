/**
 * The slider scales (static/js/utils/slider-scales.js): point size and
 * opacity on log tracks, colour min/max in quantile space.
 *
 * Each mapping must be monotone, hit its ends exactly (opacity 1.0 must be
 * reachable) and invert: value -> position -> value gives the value back.
 *
 * Run:  node --test annzarro/tests/js/slider-scales.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SLIDER_STEPS, POINT_SIZE_RANGE, OPACITY_RANGE, pointSizeScale, opacityScale, logScale,
    quantileScale, mirroredScale, sortedSample, capTies, trackValue, valueAt, roundSig
} from '../../../static/js/utils/slider-scales.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const positions = Array.from({ length: 101 }, (_, i) => i / 100);

function assertMonotone(scale, label) {
    let prev = -Infinity;
    for (const p of positions) {
        const v = scale.fromPos(p);
        assert.ok(v >= prev, `${label}: fromPos(${p}) = ${v} < ${prev}`);
        prev = v;
    }
}

for (const [label, scale, range] of [['size', pointSizeScale, POINT_SIZE_RANGE], ['opacity', opacityScale, OPACITY_RANGE]]) {
    test(`${label}: log track is monotone with exact ends`, () => {
        assertMonotone(scale, label);
        assert.equal(scale.fromPos(0), range.min);
        assert.equal(scale.fromPos(1), range.max);
        assert.equal(valueAt(scale, SLIDER_STEPS), range.max);
        assert.equal(scale.toPos(range.min), 0);
        assert.equal(scale.toPos(range.max), 1);
    });

    test(`${label}: value -> position -> value round-trips`, () => {
        for (const p of positions) {
            const v = scale.fromPos(p);
            assert.ok(close(scale.toPos(v), p), `${label} toPos(fromPos(${p}))`);
            assert.ok(close(scale.fromPos(scale.toPos(v)), v), `${label} fromPos(toPos(${v}))`);
        }
    });

    test(`${label}: values off the track pin the thumb to its ends`, () => {
        assert.equal(scale.toPos(range.min / 2), 0);
        assert.equal(scale.toPos(range.max * 2), 1);
        assert.equal(scale.toPos(0), 0);
        assert.equal(scale.toPos(NaN), 0);
    });
}

test('opacity 1.0 is reached exactly at the right end of the track', () => {
    assert.equal(valueAt(opacityScale, SLIDER_STEPS), 1);
    assert.equal(roundSig(valueAt(opacityScale, SLIDER_STEPS)), 1);
    assert.equal(trackValue(opacityScale, 1), SLIDER_STEPS);
});

test('the bottom 10% of the tracks is the low range large plots need', () => {
    // at 95.6M cells: size about 0.3-2 px, opacity about 0.005-0.2
    const size10 = valueAt(pointSizeScale, SLIDER_STEPS / 10);
    const opacity10 = valueAt(opacityScale, SLIDER_STEPS / 10);
    assert.ok(size10 > 0.2 && size10 < 0.4, `size at 10%: ${size10}`);
    assert.ok(opacity10 > 0.002 && opacity10 < 0.005, `opacity at 10%: ${opacity10}`);
    // and the useful ranges span a good part of the track, not its bottom tenth
    assert.ok(pointSizeScale.toPos(2) - pointSizeScale.toPos(0.3) > 0.35);
    assert.ok(opacityScale.toPos(0.2) - opacityScale.toPos(0.005) > 0.5);
});

test('old linear values (links saved before the log track) keep their value', () => {
    // the track shows them as near as it can; the setting itself is not touched
    for (const v of [0.5, 1, 5, 12.3, 20]) {
        const t = trackValue(pointSizeScale, v);
        assert.ok(Math.abs(valueAt(pointSizeScale, t) - v) / v < 0.005, `size ${v}`);
    }
    for (const v of [0.01, 0.05, 0.7, 1]) {
        const t = trackValue(opacityScale, v);
        assert.ok(Math.abs(valueAt(opacityScale, t) - v) / v < 0.005, `opacity ${v}`);
    }
});

test('logScale ends are exact for any bounds', () => {
    const s = logScale(0.003, 7);
    assert.equal(s.fromPos(0), 0.003);
    assert.equal(s.fromPos(1), 7);
    assert.equal(s.fromPos(-1), 0.003);
    assert.equal(s.fromPos(2), 7);
});

test('roundSig keeps two significant digits', () => {
    assert.equal(roundSig(0.0036812), 0.0037);
    assert.equal(roundSig(12.345), 12);
    assert.equal(roundSig(0), 0);
});

// --- colour: quantile scale ---

/** A skewed column like FN1 on Tahoe: 99th percentile 30, max 725. */
function skewed(n = 20000) {
    const v = new Float32Array(n);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) v[i] = Math.round(Math.exp(rnd() * 3.4));   // 1..30
    v[0] = 725; v[1] = 400; v[2] = 1;
    return v;
}

test('quantile: monotone, exact ends, inverse round-trip', () => {
    const values = Float64Array.from({ length: 5000 }, (_, i) => Math.sinh((i - 2500) / 400));
    const s = quantileScale(values);
    assertMonotone(s, 'quantile');
    assert.equal(s.fromPos(0), Math.sinh(-2500 / 400));
    assert.equal(s.fromPos(1), Math.sinh(2499 / 400));
    assert.equal(s.toPos(s.min, 'low'), 0);
    assert.equal(s.toPos(s.max, 'high'), 1);
    for (const p of positions) {
        const v = s.fromPos(p);
        assert.ok(close(s.toPos(v), p, 1e-9), `toPos(fromPos(${p}))`);
        assert.ok(close(s.fromPos(s.toPos(v)), v, 1e-9), `fromPos(toPos(${v}))`);
    }
});

test('quantile: a skewed column uses the track, a linear track would not', () => {
    const v = skewed();
    const s = quantileScale(v);
    assert.equal(s.min, 1);
    assert.equal(s.max, 725);
    // linear: 30 of 725 is 4% of the track. In quantile space it is near the top.
    assert.ok(s.toPos(30, 'high') > 0.9, `30 at ${s.toPos(30, 'high')}`);
    // 10% of the track is a low value, not 10% of 725
    assert.ok(s.fromPos(0.1) < 10, `10% -> ${s.fromPos(0.1)}`);
});

test('quantile: ties hold a stretch; min thumbs take its left end, max thumbs its right', () => {
    const values = [...Array(100).keys(), 50];      // 50 twice: a run under the cap
    const s = quantileScale(values);
    const lo = s.toPos(50, 'low'), hi = s.toPos(50, 'high');
    assert.ok(lo < hi);
    assert.equal(s.fromPos(lo), 50);
    assert.equal(s.fromPos(hi), 50);
    assert.equal(s.fromPos((lo + hi) / 2), 50);
});

test('quantile: the zeros of a sparse gene hold at most TIE_SHARE of the track', () => {
    // expressed in 1% of cells: without the cap, 99% of the track would read 0
    const v = new Float32Array(100000);
    for (let i = 0; i < 1000; i++) v[i * 100] = 1 + i / 100;
    const s = quantileScale(v);
    assert.equal(s.min, 0);
    assert.ok(s.toPos(0, 'high') <= 0.021, `zeros end at ${s.toPos(0, 'high')}`);
    assert.ok(s.fromPos(0.5) > 4 && s.fromPos(0.5) < 7, `middle: ${s.fromPos(0.5)}`);
    assert.equal(s.fromPos(1), Math.fround(1 + 999 / 100));
});

test('capTies leaves continuous values alone and bounds a few-valued column', () => {
    const q = Float64Array.from([1, 2, 3, 4, 5]);
    assert.equal(capTies(q), q);
    const few = capTies(Float64Array.from([0, 0, 0, 0, 1, 1, 2]));
    assert.deepEqual([...few], [0, 1, 2]);
});

test('quantile: a long array is sampled, keeping its exact min and max', () => {
    const n = 1_000_003, v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = (i * 7919) % 1000;
    v[123457] = -5; v[777777] = 5000;          // off the sampling stride
    const q = sortedSample(v, 10000);
    assert.ok(q.length <= 10100, `sample of ${q.length}`);
    assert.equal(q[0], -5);
    assert.equal(q[q.length - 1], 5000);
    const s = quantileScale(v, { maxSample: 10000 });
    assert.equal(s.fromPos(0), -5);
    assert.equal(s.fromPos(1), 5000);
});

test('quantile: NaN, null and empty strings are missing, not zero', () => {
    const s = quantileScale([NaN, null, '', undefined, 3, 4]);
    assert.equal(s.min, 3);
    assert.equal(s.max, 4);
    assert.equal(quantileScale([NaN, null]), null);
    assert.equal(quantileScale(new Float32Array([NaN, Infinity])), null);
});

test('quantile: a constant column is flagged and maps to its value', () => {
    const s = quantileScale([2.5, 2.5, 2.5]);
    assert.equal(s.constant, true);
    assert.equal(s.fromPos(0), 2.5);
    assert.equal(s.fromPos(1), 2.5);
    assert.equal(s.toPos(2.5, 'low'), 0);
    assert.equal(s.toPos(2.5, 'high'), 1);
});

test('centred at 0: the min thumb mirrors the max thumb position for position', () => {
    const values = [-3, -1, -0.5, 0.2, 0.4, 2, 8];
    const abs = quantileScale(values, { transform: Math.abs });
    const min = mirroredScale(abs);
    assert.equal(abs.max, 8);
    assert.equal(min.fromPos(0), -8);
    assert.equal(min.fromPos(1), -abs.min);
    for (const p of positions) {
        assert.ok(close(min.fromPos(1 - p), -abs.fromPos(p)), `p=${p}`);
        const v = min.fromPos(p);
        assert.ok(close(min.fromPos(min.toPos(v)), v), `round-trip ${v}`);
    }
    assertMonotone(min, 'mirrored');
    // a min thumb on -max sits at the left end, on -min at the right end
    assert.equal(min.toPos(-8, 'low'), 0);
    assert.equal(min.toPos(-abs.min, 'high'), 1);
});
