// The nearest-point grid behind hover and click in large-plot mode
// (static/js/utils/point-index.js): correct against brute force, 8 B per point,
// and fast to build and query.
//
// Run: `node --test annzarro/tests/js/point-index.test.mjs`.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const js = p => pathToFileURL(path.resolve(__dirname, "../../../static/js", p)).href;
const { buildPointIndex, nearestPoint, pointOfRow, POINTS_PER_CELL } = await import(js("utils/point-index.js"));

function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

function cloud(n, seed, { duplicates = 0, clusters = 0 } = {}) {
  const r = lcg(seed), X = new Float32Array(n), Y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (clusters && r() < 0.7) {
      const c = Math.floor(r() * clusters);
      X[i] = c * 3 + (r() - 0.5) * 0.2; Y[i] = c * 2 + (r() - 0.5) * 0.2;
    } else { X[i] = r() * 100 - 50; Y[i] = r() * 40 - 20; }
  }
  for (let i = 0; i < duplicates; i++) { const a = Math.floor(r() * n), b = Math.floor(r() * n); X[a] = X[b]; Y[a] = Y[b]; }
  return { X, Y, rows: Uint32Array.from({ length: n }, (_, i) => i * 3 + 1) };
}

function brute(X, Y, cx, cy, rx, ry) {
  let best = -1, bestD = 1;
  for (let p = 0; p < X.length; p++) {
    const dx = (X[p] - cx) / rx, dy = (Y[p] - cy) / ry, d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = p; }
  }
  return { best, bestD };
}

function distOf(X, Y, p, cx, cy, rx, ry) { const dx = (X[p] - cx) / rx, dy = (Y[p] - cy) / ry; return dx * dx + dy * dy; }

for (const [name, opts] of [["uniform", {}], ["with duplicates", { duplicates: 400 }], ["clustered", { clusters: 6 }]]) {
  test(`nearest point equals brute force: ${name}, inside, on the edges and outside`, () => {
    const n = 5000, { X, Y, rows } = cloud(n, 7, opts), idx = buildPointIndex(X, Y, rows), r = lcg(99);
    let hits = 0;
    for (let q = 0; q < 1500; q++) {
      // inside the cloud, and well outside it (empty cells, off the grid)
      const cx = (r() * 1.6 - 0.8) * 100, cy = (r() * 1.6 - 0.8) * 40;
      const rx = 0.2 + r() * 4, ry = 0.1 + r() * 2;
      const want = brute(X, Y, cx, cy, rx, ry), got = nearestPoint(idx, cx, cy, rx, ry);
      if (want.best < 0) assert.equal(got, -1, `query ${q}`);
      else {
        hits++;
        assert.notEqual(got, -1, `query ${q}`);
        // duplicates tie: same distance, either point
        assert.equal(distOf(X, Y, got, cx, cy, rx, ry), want.bestD, `query ${q}`);
      }
    }
    assert.ok(hits > 100, `only ${hits} queries found a point`);
  });
}

test("a query on a point's own position finds it (or an identical duplicate); the extremes are reachable", () => {
  const { X, Y, rows } = cloud(2000, 3, { duplicates: 50 }), idx = buildPointIndex(X, Y, rows);
  for (let p = 0; p < X.length; p += 7) {
    const got = nearestPoint(idx, X[p], Y[p], 0.01, 0.01);
    assert.ok(got >= 0 && X[got] === X[p] && Y[got] === Y[p], `point ${p}`);
  }
  let lo = 0, hi = 0;
  for (let p = 1; p < X.length; p++) { if (X[p] < X[lo]) lo = p; if (X[p] > X[hi]) hi = p; }
  for (const p of [lo, hi]) assert.equal(X[nearestPoint(idx, X[p], Y[p], 0.01, 0.01)], X[p]);
});

test("no points, one point and all points identical", () => {
  const empty = buildPointIndex(new Float32Array(0), new Float32Array(0), new Uint32Array(0));
  assert.equal(nearestPoint(empty, 0, 0, 5, 5), -1);
  const one = buildPointIndex(Float32Array.of(2), Float32Array.of(3), Uint32Array.of(9));
  assert.equal(nearestPoint(one, 2.1, 3, 1, 1), 0);
  assert.equal(nearestPoint(one, 9, 9, 1, 1), -1);
  const same = buildPointIndex(new Float32Array(300).fill(1), new Float32Array(300).fill(1), new Uint32Array(300));
  assert.ok(nearestPoint(same, 1, 1, 0.5, 0.5) >= 0);
});

test("the pointer radius is an ellipse in data units: pixel distance, not data distance", () => {
  const idx = buildPointIndex(Float32Array.of(0, 10), Float32Array.of(0, 0), Uint32Array.of(0, 1));
  // x is stretched (1 px = 1 unit), so (10, 0) is 10 px away; y is the same
  assert.equal(nearestPoint(idx, 8, 0, 3, 3), 1);
  assert.equal(nearestPoint(idx, 5, 0, 3, 3), -1);
  assert.equal(nearestPoint(idx, 5, 0, 6, 1), 0);
});

test("memory: 8 B per point plus the cell table; rows map a point to its dataset row", () => {
  const n = 100000, { X, Y, rows } = cloud(n, 5), idx = buildPointIndex(X, Y, rows);
  const perPoint = idx.bytes / n;
  assert.ok(perPoint <= 8 + 4 / POINTS_PER_CELL * 1.2, `${perPoint} B/point`);
  assert.ok(idx.order instanceof Uint32Array && idx.offsets instanceof Uint32Array);
  const p = nearestPoint(idx, X[1234], Y[1234], 0.001, 0.001);
  assert.equal(idx.rows[p], rows[p]);
  assert.equal(pointOfRow(idx, rows[777]), 777);
  assert.equal(pointOfRow(idx, 0), -1);
});

test("build and query cost: 2M points build in about a second, a query in microseconds", () => {
  const n = 2000000, { X, Y, rows } = cloud(n, 11, { clusters: 12 });
  const t0 = performance.now(), idx = buildPointIndex(X, Y, rows), build = performance.now() - t0;
  const r = lcg(1), q0 = performance.now();
  for (let q = 0; q < 2000; q++) nearestPoint(idx, (r() - 0.5) * 100, (r() - 0.5) * 40, 0.1, 0.05);
  const query = (performance.now() - q0) / 2000;
  console.log(`  2M points: build ${build.toFixed(0)} ms (${(build / n * 1e6).toFixed(0)} ns/point), query ${query.toFixed(3)} ms`);
  assert.ok(build < 3000, `${build} ms`);
  assert.ok(query < 5, `${query} ms`);
});
