/**
 * Slider scales: map a range input's track position to a value.
 *
 * A linear track is no use at the low end of large plots. At 95.6M cells
 * the useful point size is about 0.3-2 px (the bottom 10% of a 0.1-20
 * track), the useful opacity about 0.005-0.2, and a skewed gene keeps
 * everything worth seeing in the bottom few percent of its data range. So:
 *
 *   - point size and opacity move on a log scale;
 *   - colour min/max move in quantile space: the track position is a
 *     percentile of the coloured values.
 *
 * Only the track is rescaled. Settings, saved sessions and links keep the
 * real value (px, alpha, colour value), so old links open unchanged; a
 * value outside a track's range only pins the thumb to that end.
 *
 * Positions are fractions in [0, 1]; the range inputs run 0..SLIDER_STEPS.
 */

export const SLIDER_STEPS = 1000;

/*
 * Bounds measured in Chromium with Plotly 2.20 scattergl, on SwiftShader and
 * on the Metal GPU (same result), at device scale factor 1 and 2:
 *
 *   - size: the drawn marker grows in steps of about 0.4 px and is
 *     monotone from 0.2 px up. Below 0.2 it is NOT: 0.1 px draws three times
 *     the ink of 0.2 px (0.25 vs 0.07 px^2 at DSF 1, 1.0 vs 0.3 at DSF 2), so
 *     the track stops at 0.2.
 *   - opacity: WebGL keeps alpha in 8 bits. 0.001 draws nothing, even 100
 *     points stacked; 0.002 is the smallest that draws (one alpha level).
 *     1.0 is the track's right end, so it is reached exactly.
 */
export const POINT_SIZE_RANGE = Object.freeze({ min: 0.2, max: 20 });
export const OPACITY_RANGE = Object.freeze({ min: 0.002, max: 1 });

const clamp01 = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p);

/**
 * A log scale over [min, max] (both > 0). The ends are exact: position 0
 * is `min` and position 1 is `max`, not exp(log(max)) with rounding error.
 */
export function logScale(min, max) {
  const lo = Math.log(min), span = Math.log(max) - lo;
  return {
    min, max,
    fromPos(p) {
      p = clamp01(p);
      if (p === 0) return min;
      if (p === 1) return max;
      return Math.exp(lo + p * span);
    },
    toPos(v) {
      if (!(v > min)) return 0;
      if (v >= max) return 1;
      return (Math.log(v) - lo) / span;
    }
  };
}

export const pointSizeScale = logScale(POINT_SIZE_RANGE.min, POINT_SIZE_RANGE.max);
export const opacityScale = logScale(OPACITY_RANGE.min, OPACITY_RANGE.max);

/** Round to `digits` significant digits (for a value read off a track). */
export function roundSig(v, digits = 2) {
  if (!Number.isFinite(v) || v === 0) return v;
  return Number(v.toPrecision(digits));
}

/** The 0..SLIDER_STEPS track value showing `v` on `scale`. */
export function trackValue(scale, v, side) {
  return Math.round(scale.toPos(v, side) * SLIDER_STEPS);
}

/** The value at track value `t` (0..SLIDER_STEPS) on `scale`. */
export function valueAt(scale, t) {
  return scale.fromPos(Number(t) / SLIDER_STEPS);
}

/** Default number of values a quantile scale keeps. */
export const QUANTILE_SAMPLE = 100000;

/**
 * The sorted finite values of `values` (an Array or typed array), at most
 * about `maxSample` of them: an even stride through the data when it is
 * longer, plus its exact minimum and maximum, so the scale's ends are the
 * data's ends. `transform` (e.g. Math.abs) is applied to each value first.
 */
export function sortedSample(values, maxSample = QUANTILE_SAMPLE, transform = null) {
  const n = values ? values.length : 0;
  // null and '' are missing values in a plain Array (Number() would make them 0)
  const typed = ArrayBuffer.isView(values);
  const read = (i) => {
    let v = values[i];
    if (!typed) { if (v === null || v === undefined || v === '') return NaN; v = Number(v); }
    return transform ? transform(v) : v;
  };
  let lo = Infinity, hi = -Infinity, finite = 0;
  for (let i = 0; i < n; i++) {
    const v = read(i);
    if (v - v !== 0) continue;           // NaN or +-Infinity
    finite++;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (finite === 0) return new Float64Array(0);
  const stride = Math.max(1, Math.floor(n / maxSample));
  const out = stride > 1 ? [lo, hi] : [];
  for (let i = 0; i < n; i += stride) {
    const v = read(i);
    if (v - v === 0) out.push(v);
  }
  return Float64Array.from(out).sort();
}

/** Largest share of the track one repeated value may hold. */
export const TIE_SHARE = 0.02;

/**
 * `q` (sorted) with every run of equal values cut to at most `cap` copies,
 * the largest cap under which no run is more than `share` of the result.
 * Continuous values have no runs and pass unchanged; the zeros of a sparse
 * gene do. Without this, a gene expressed in 1% of cells would read 0 over
 * 99% of the track: the low-end problem again, in quantile space.
 */
export function capTies(q, share = TIE_SHARE) {
  const runs = [];
  let longest = 0;
  for (let i = 0; i < q.length;) {
    let j = i + 1;
    while (j < q.length && q[j] === q[i]) j++;
    runs.push(j - i);
    longest = Math.max(longest, j - i);
    i = j;
  }
  // cap = share * sum(min(run, cap)) has one fixed point; iterate down to it
  let cap = q.length;
  for (;;) {
    let kept = 0;
    for (const r of runs) kept += Math.min(r, cap);
    const next = Math.max(1, Math.floor(share * kept));
    if (next >= cap) break;
    cap = next;
  }
  if (cap >= longest) return q;
  const out = [];
  let i = 0;
  for (const r of runs) {
    for (let k = 0; k < Math.min(r, cap); k++) out.push(q[i]);
    i += r;
  }
  return Float64Array.from(out);
}

/**
 * A quantile scale over the values: position p is the p-quantile, linear
 * between neighbouring sorted values. Returns null when no value is finite.
 *
 * Tied values (e.g. the zeros of a sparse gene) hold a stretch of the
 * track, at most TIE_SHARE of it (capTies). `toPos(v, 'low')` puts the thumb at the stretch's left end and
 * `toPos(v, 'high')` at its right end, so a min thumb at the data minimum
 * sits at the left of the track and a max thumb at the maximum at the right.
 * `constant` is true when every value is the same.
 */
export function quantileScale(values, { maxSample = QUANTILE_SAMPLE, transform = null } = {}) {
  const q = capTies(sortedSample(values, maxSample, transform));
  const m = q.length;
  if (m === 0) return null;
  const last = m - 1;
  return {
    min: q[0], max: q[last], constant: q[0] === q[last], size: m,
    fromPos(p) {
      p = clamp01(p);
      if (last === 0) return q[0];
      const h = p * last, i = Math.floor(h);
      if (i >= last) return q[last];
      const f = h - i;
      return f === 0 || q[i] === q[i + 1] ? q[i] : q[i] + f * (q[i + 1] - q[i]);
    },
    toPos(v, side = 'low') {
      if (last === 0) return side === 'high' ? 1 : 0;
      if (!(v >= q[0])) return 0;
      if (v > q[last]) return 1;
      // first index with q[i] >= v
      let a = 0, b = last;
      while (a < b) { const c = (a + b) >> 1; if (q[c] < v) a = c + 1; else b = c; }
      if (q[a] === v) {
        if (side !== 'high') return a / last;
        let e = a + 1, f = m;            // first index with q[i] > v
        while (e < f) { const c = (e + f) >> 1; if (q[c] > v) f = c; else e = c + 1; }
        return (e - 1) / last;
      }
      return (a - 1 + (v - q[a - 1]) / (q[a] - q[a - 1])) / last;
    }
  };
}

/**
 * The min thumb of a colour scale centred at 0: the mirror of `absScale`
 * (a quantile scale of |value|). The track runs from -max|value| on the
 * left to 0 on the right, so the min thumb at position 1 - p shows exactly
 * minus what the max thumb shows at p.
 */
export function mirroredScale(absScale) {
  return {
    min: -absScale.max, max: -absScale.min, constant: absScale.constant,
    fromPos: (p) => { const v = absScale.fromPos(1 - clamp01(p)); return v === 0 ? 0 : -v; },
    toPos: (v, side = 'low') => 1 - absScale.toPos(-v, side === 'high' ? 'low' : 'high')
  };
}
