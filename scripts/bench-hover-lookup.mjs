// Latency of the large-plot hover lookup (static/js/utils/point-index.js nearestPoint) over real
// positions, against the box scan it replaced, with a check that both give the same point.
// Reported, never asserted: run it through the bench lock for timings.
// Usage: node scripts/bench-hover-lookup.mjs <x.f32> <y.f32>   (little-endian float32, one per point)
import { readFileSync } from 'node:fs';
import { buildPointIndex, nearestPoint } from '../static/js/utils/point-index.js';

const [fx, fy] = process.argv.slice(2);
if (!fx || !fy) { console.error('usage: node scripts/bench-hover-lookup.mjs <x.f32> <y.f32>'); process.exit(2); }
const load = (f) => { const b = readFileSync(f); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const X = load(fx), Y = load(fy), n = X.length;
const rows = Uint32Array.from({ length: n }, (_, i) => i);
let t = performance.now();
const index = buildPointIndex(X, Y, rows);
const buildMs = performance.now() - t;

// the box scan this function used before the ring search
function boxScan(index, cx, cy, rx, ry) {
  const { X, Y, order, offsets, gx, gy, x0, y0, sx, sy } = index;
  const clamp = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v);
  const cx0 = Math.floor((cx - rx - x0) * sx), cx1 = Math.floor((cx + rx - x0) * sx);
  const cy0 = Math.floor((cy - ry - y0) * sy), cy1 = Math.floor((cy + ry - y0) * sy);
  if (cx1 < 0 || cy1 < 0 || cx0 > gx - 1 || cy0 > gy - 1) return -1;
  const ax = clamp(cx0, gx - 1), bx = clamp(cx1, gx - 1);
  let best = -1, bestD = 1;
  for (let row = clamp(cy0, gy - 1); row <= clamp(cy1, gy - 1); row++) {
    const end = offsets[row * gx + bx + 1];
    for (let j = offsets[row * gx + ax]; j < end; j++) {
      const p = order[j], dx = (X[p] - cx) / rx, dy = (Y[p] - cy) / ry, d = dx * dx + dy * dy;
      if (d < bestD || (d === bestD && best >= 0 && p < best)) { bestD = d; best = p; }
    }
  }
  return best;
}

let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
for (let i = 0; i < n; i++) { const x = X[i], y = Y[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const q = (v) => { v.sort((a, b) => a - b); const at = (f) => +v[Math.min(v.length - 1, Math.floor(f * v.length))].toFixed(3); return { p50_ms: at(0.5), p99_ms: at(0.99), max_ms: at(1) }; };
const out = { n, build_ms: Math.round(buildMs) };
for (const zoom of [1, 8, 64]) {
  const rx = (x1 - x0) / zoom * 10 / 800, ry = (y1 - y0) / zoom * 10 / 600;   // a 10 px radius on an 800 x 600 plot
  const box = [], ring = [];
  let differ = 0;
  for (let k = 0; k < 2000; k++) {
    const i = Math.floor(rnd() * n);
    const cx = X[i] + (rnd() - 0.5) * rx, cy = Y[i] + (rnd() - 0.5) * ry;
    t = performance.now(); const a = boxScan(index, cx, cy, rx, ry); box.push(performance.now() - t);
    t = performance.now(); const b = nearestPoint(index, cx, cy, rx, ry); ring.push(performance.now() - t);
    if (a !== b) differ++;
  }
  out[`zoom${zoom}`] = { box: q(box), ring: q(ring), differ };
}
console.log(JSON.stringify(out, null, 1));
