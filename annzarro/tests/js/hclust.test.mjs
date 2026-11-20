// X1: hierarchical clustering (static/js/utils/hclust.js, hclust-worker.js), against the scipy oracle.
// tests/data/oracle/linkage.json is the export of linkage.npz (tests/core/test_linkage_json.py keeps it current).
// The oracle inputs have no tied distances (more than 3e-7 relative apart), so the merge order is unique even
// with a Float32 distance matrix; ties are tested here with hand cases.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { clusterRows, createHclustClient, MAX_ROWS } from "../../../static/js/utils/hclust.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const oracle = JSON.parse(fs.readFileSync(path.join(here, "..", "data", "oracle", "linkage.json"), "utf8"));
const WORKER = pathToFileURL(path.join(here, "..", "..", "..", "static", "js", "utils", "hclust-worker.js")).href;

const flat = (X) => Float64Array.from(X.flat());
const near = (a, b, rel = 1e-5) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

for (const [name, c] of Object.entries(oracle.cases)) {
  for (const key of Object.keys(c.Z)) {
    const [distance, linkage] = key.split("_");
    test(`${name}: ${linkage} linkage on ${distance} distance matches scipy`, () => {
      const r = clusterRows(flat(c.X), c.rows, c.cols, { linkage, distance });
      assert.deepEqual(Array.from(r.order), c.leaves[key], "leaf order");
      assert.equal(r.excluded.length, 0);
      const Z = c.Z[key];
      assert.equal(r.merges.length, Z.length * 4);
      Z.forEach((row, i) => {
        assert.equal(r.merges[i * 4], row[0], `merge ${i}: left`);
        assert.equal(r.merges[i * 4 + 1], row[1], `merge ${i}: right`);
        assert.equal(r.merges[i * 4 + 3], row[3], `merge ${i}: size`);
        assert.ok(near(r.merges[i * 4 + 2], row[2]), `merge ${i}: height ${r.merges[i * 4 + 2]} vs ${row[2]}`);
      });
    });
  }
}

test("complete linkage on Pearson correlation is the default", () => {
  const c = oracle.cases.means_ct;
  const r = clusterRows(flat(c.X), c.rows, c.cols);
  assert.deepEqual(Array.from(r.order), c.leaves.correlation_complete);
});

test("Ward is refused with correlation distance, and nothing else is accepted silently", () => {
  const X = Float64Array.of(1, 2, 3, 4, 3, 1, 2, 5, 9, 1);
  assert.throws(() => clusterRows(X, 5, 2, { linkage: "ward", distance: "correlation" }), /Ward needs Euclidean/);
  assert.throws(() => clusterRows(X, 5, 2, { linkage: "single" }), /linkage/);
  assert.throws(() => clusterRows(X, 5, 2, { distance: "cosine" }), /distance/);
  assert.throws(() => clusterRows(X, 4, 2), /values/);
  assert.doesNotThrow(() => clusterRows(X, 5, 2, { linkage: "ward", distance: "euclidean" }));
});

test("a block over the limit is refused", () => {
  assert.equal(MAX_ROWS, 2000);
  assert.throws(() => clusterRows(new Float64Array(2001 * 2), 2001, 2), /2,000/);
  assert.doesNotThrow(() => clusterRows(new Float64Array(2000 * 2).map((_, i) => Math.sin(i)), 2000, 2, { distance: "euclidean" }));
});

test("ties break by original order", () => {
  // Four equally spaced points, every neighbouring distance 1, in both directions: the order stays as given.
  for (const col of [[0, 1, 2, 3], [3, 2, 1, 0]]) {
    const r = clusterRows(Float64Array.from(col.flatMap((v) => [v, 0])), 4, 2, { distance: "euclidean" });
    assert.deepEqual(Array.from(r.order), [0, 1, 2, 3]);
    assert.deepEqual(Array.from(r.merges), [0, 1, 1, 2, 2, 3, 1, 2, 4, 5, 3, 4]);
  }
  // Three identical rows, all distances 0: rows 0 and 1 merge first (original order picks the pair), and the
  // orientation is scipy's, the lower-numbered cluster to the left: the singleton 2 before the cluster of 0 and 1.
  // scipy.cluster.hierarchy.linkage on this input gives Z = [[0, 1, 0, 2], [2, 3, 0, 3]] and leaves 2, 0, 1.
  const same = clusterRows(Float64Array.of(1, 2, 3, 1, 2, 3, 1, 2, 3), 3, 3, { distance: "euclidean" });
  assert.deepEqual(Array.from(same.order), [2, 0, 1]);
  assert.deepEqual(Array.from(same.merges), [0, 1, 0, 2, 2, 3, 0, 3]);
  // The same input gives the same answer, however often it is asked.
  const again = clusterRows(Float64Array.from([3, 0, 2, 0, 1, 0, 0, 0]), 4, 2, { distance: "euclidean" });
  assert.deepEqual(Array.from(again.order), [0, 1, 2, 3]);
});

function pairDistance(a, b, distance) {
  const idx = a.map((_, j) => j).filter((j) => !Number.isNaN(a[j]) && !Number.isNaN(b[j]));
  const n = idx.length;
  if (distance === "euclidean") {
    return Math.sqrt(idx.reduce((s, j) => s + (a[j] - b[j]) ** 2, 0) * a.length / n);
  }
  const ma = idx.reduce((s, j) => s + a[j], 0) / n;
  const mb = idx.reduce((s, j) => s + b[j], 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (const j of idx) { sab += (a[j] - ma) * (b[j] - mb); saa += (a[j] - ma) ** 2; sbb += (b[j] - mb) ** 2; }
  return 1 - sab / Math.sqrt(saa * sbb);
}

test("distances are pairwise-complete: each pair on the columns where both have a value", () => {
  const rows = [
    [1, 2, 3, 4, NaN],
    [2, 4, 5, 9, 1],
    [NaN, 1, 3, 2, 8],
  ];
  for (const distance of ["correlation", "euclidean"]) {
    const d = (i, j) => pairDistance(rows[i], rows[j], distance);
    const pairs = [[0, 1], [0, 2], [1, 2]].map(([i, j]) => ({ i, j, h: d(i, j) })).sort((p, q) => p.h - q.h);
    const r = clusterRows(flat(rows), 3, 5, { linkage: "complete", distance });
    const [first, second, third] = pairs;
    assert.ok(near(r.merges[2], first.h), `${distance}: first merge ${r.merges[2]} vs ${first.h}`);
    assert.deepEqual([r.merges[0], r.merges[1]], [first.i, first.j]);
    assert.ok(near(r.merges[6], third.h), `${distance}: complete linkage joins at the largest pair, ${r.merges[6]} vs ${third.h}`);
    assert.ok(second.h <= third.h);
  }
});

const FULL = [[1, 2, 3, 4, 5], [2, 1, 4, 3, 6], [5, 4, 3, 2, 1], [1, 3, 2, 5, 4], [4, 5, 6, 1, 2], [2, 2, 1, 3, 9]];

test("a constant row takes no part under correlation and goes last; Euclidean keeps it", () => {
  const rows = [FULL[0], [7, 7, 7, 7, 7], FULL[1], FULL[2], [NaN, 3, 3, 3, NaN], FULL[3]];
  const r = clusterRows(flat(rows), 6, 5, { distance: "correlation" });
  assert.deepEqual(Array.from(r.excluded), [1, 4]);
  assert.deepEqual(Array.from(r.order.slice(-2)), [1, 4]);
  assert.equal(r.order.length, 6);
  assert.deepEqual(Array.from(r.order.slice(0, 4)).sort(), [0, 2, 3, 5]);
  assert.equal(r.merges.length, 3 * 4, "the four clustered rows make three merges");
  assert.deepEqual(Array.from(r.clustered), [0, 2, 3, 5]);
  const eu = clusterRows(flat(rows), 6, 5, { distance: "euclidean" });
  assert.equal(eu.excluded.length, 0);
});

test("rows with fewer than two values in common with another row are left out, in original order", () => {
  const rows = [FULL[0], [1, 2, NaN, NaN, NaN], FULL[1], [NaN, NaN, 3, 4, NaN], FULL[2], [5, NaN, NaN, NaN, NaN], FULL[3]];
  for (const distance of ["correlation", "euclidean"]) {
    const r = clusterRows(flat(rows), 7, 5, { distance });
    assert.deepEqual(Array.from(r.excluded), [1, 3, 5], distance);
    assert.deepEqual(Array.from(r.order.slice(4)), [1, 3, 5]);
    assert.deepEqual(Array.from(r.clustered), [0, 2, 4, 6]);
  }
});

test("one row, or none left to cluster, is a valid answer", () => {
  const one = clusterRows(Float64Array.of(1, 2, 3), 1, 3);
  assert.deepEqual(Array.from(one.order), [0]);
  assert.equal(one.merges.length, 0);
  const none = clusterRows(new Float64Array(0), 0, 3);
  assert.equal(none.order.length, 0);
  const allConstant = clusterRows(Float64Array.of(1, 1, 1, 2, 2, 2), 2, 3);
  assert.deepEqual(Array.from(allConstant.order), [0, 1]);
  assert.deepEqual(Array.from(allConstant.excluded), [0, 1]);
});

test("the input is not modified", () => {
  const c = oracle.cases.rand40;
  const X = flat(c.X);
  const copy = X.slice();
  clusterRows(X, c.rows, c.cols);
  assert.deepEqual(X, copy);
});

// A worker stand-in: the same module the browser loads, run in this thread behind a message port.
async function loadWorker() {
  const posted = [];
  const self_ = { postMessage: (m) => posted.push(m) };
  globalThis.self = self_;
  await import(`${WORKER}?x1=${Math.random()}`);
  return { handler: self_.onmessage, posted };
}

test("the worker answers a request with the same result, and reports an error as an error", async () => {
  const { handler, posted } = await loadWorker();
  const c = oracle.cases.means_ct;
  handler({ data: { id: 7, values: flat(c.X), rows: c.rows, cols: c.cols, linkage: "average", distance: "euclidean" } });
  assert.equal(posted.length, 1);
  assert.equal(posted[0].id, 7);
  assert.deepEqual(Array.from(posted[0].result.order), c.leaves.euclidean_average);
  handler({ data: { id: 8, values: flat(c.X), rows: c.rows, cols: c.cols, linkage: "ward", distance: "correlation" } });
  assert.equal(posted[1].id, 8);
  assert.match(posted[1].error, /Ward needs Euclidean/);
  assert.equal(posted[1].result, undefined);
});

function fakeWorker() {
  const w = { posts: 0, terminated: false };
  w.postMessage = (msg) => {
    w.posts++;
    queueMicrotask(() => {
      try {
        w.onmessage({ data: { id: msg.id, result: clusterRows(msg.values, msg.rows, msg.cols, msg) } });
      } catch (e) {
        w.onmessage({ data: { id: msg.id, error: String(e.message) } });
      }
    });
  };
  w.terminate = () => { w.terminated = true; };
  return w;
}

test("the client memoises by the input's content and settings", async () => {
  const c = oracle.cases.rand40;
  const w = fakeWorker();
  const client = createHclustClient(() => w);
  const a = await client.cluster(flat(c.X), c.rows, c.cols, { linkage: "complete", distance: "correlation" });
  const b = await client.cluster(flat(c.X), c.rows, c.cols, { linkage: "complete", distance: "correlation" });
  assert.equal(w.posts, 1, "same content, other array: one request");
  assert.equal(a, b);
  await client.cluster(flat(c.X), c.rows, c.cols, { linkage: "average", distance: "correlation" });
  assert.equal(w.posts, 2, "another linkage is another request");
  const moved = flat(c.X);
  moved[5] += 1e-9;
  await client.cluster(moved, c.rows, c.cols, { linkage: "complete", distance: "correlation" });
  assert.equal(w.posts, 3, "one changed value is another request");
  await client.cluster(flat(c.X), c.rows, c.cols);
  assert.equal(w.posts, 3, "the defaults are complete and correlation");
});

test("two identical requests in flight make one request, and an error is not remembered", async () => {
  const c = oracle.cases.rand40;
  const w = fakeWorker();
  const client = createHclustClient(() => w);
  const [a, b] = await Promise.all([client.cluster(flat(c.X), c.rows, c.cols), client.cluster(flat(c.X), c.rows, c.cols)]);
  assert.equal(w.posts, 1);
  assert.equal(a, b);
  const bad = { linkage: "ward", distance: "correlation" };
  await assert.rejects(client.cluster(flat(c.X), c.rows, c.cols, bad), /Ward needs Euclidean/);
  await assert.rejects(client.cluster(flat(c.X), c.rows, c.cols, bad), /Ward needs Euclidean/);
  assert.equal(w.posts, 3, "the failure was asked twice");
});

test("the client starts its worker on the first request and terminate() ends it", async () => {
  let made = 0;
  const w = fakeWorker();
  const client = createHclustClient(() => { made++; return w; });
  assert.equal(made, 0);
  await client.cluster(Float64Array.of(1, 2, 3, 4, 5, 6), 3, 2);
  assert.equal(made, 1);
  client.terminate();
  assert.equal(w.terminated, true);
  await assert.rejects(client.cluster(Float64Array.of(9, 8, 7, 6, 5, 4), 3, 2), /terminated/);
});

test("the memo is bounded", async () => {
  const w = fakeWorker();
  const client = createHclustClient(() => w);
  const input = (i) => Float64Array.of(i, 2, 3, 4, 5, 6 + i);
  for (let i = 0; i < 40; i++) await client.cluster(input(i), 3, 2);
  assert.equal(w.posts, 40);
  await client.cluster(input(39), 3, 2);
  assert.equal(w.posts, 40, "a recent input is remembered");
  await client.cluster(input(0), 3, 2);
  assert.equal(w.posts, 41, "the oldest was forgotten");
});
