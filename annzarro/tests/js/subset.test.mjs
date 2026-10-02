// The cell subset in the browser (static/js/utils/subset.js): the spec and
// its wire form, what deep links carry, what the header says, and which
// cell-table filters can be applied to every cell.
//
// Run: `node --test annzarro/tests/js/subset.test.mjs`. Also driven by the
// pytest wrapper test_js_panels.py.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = (rel) => import(pathToFileURL(path.resolve(__dirname, "../../../static/js", rel)).href);

const {
  canonicalSubset, subsetParam, normalizeViewSubset, sameSubset, describeSubset,
  searchBuilderToWhere, MAX_SEED
} = await load("utils/subset.js");
const { normalizeView } = await load("utils/deeplink.js");

test("canonical spec: fixed key order, defaults, sorted unique text values", () => {
  assert.deepEqual(canonicalSubset({ seed: 3, n: 10 }), { n: 10, seed: 3 });
  assert.deepEqual(canonicalSubset({ n: 5 }), { n: 5, seed: 0 });
  assert.deepEqual(
    canonicalSubset({ n: null, where: [{ col: "c", op: "in", values: ["b", "a", "b", 3] }] }),
    { n: null, seed: 0, where: [{ col: "c", op: "in", values: ["3", "a", "b"] }] });
  assert.deepEqual(
    canonicalSubset({ n: 1, where: [{ col: "x", op: "between", value: ["9", 2] }] }).where,
    [{ col: "x", op: "between", value: [2, 9] }]);
  assert.equal(subsetParam({ seed: 1, n: 2 }), '{"n":2,"seed":1}');
  assert.equal(subsetParam(null), "all");
  assert.equal(canonicalSubset(null), null);
});

test("malformed specs are refused with a sentence", () => {
  for (const bad of [{ n: 0 }, { n: 1.5 }, { n: "10" }, { n: 5, seed: -1 }, { n: 5, seed: MAX_SEED + 1 },
                     { n: null, balance: "g" }, { n: 5, where: [{ col: "x", op: ">", value: "" }] },
                     { n: 5, where: [{ col: "x", op: "in", values: [] }] },
                     { n: 5, where: [{ op: "in", values: ["a"] }] }, { n: 5, where: [{ col: "x", op: "~" }] }]) {
    assert.throws(() => canonicalSubset(bad), Error, JSON.stringify(bad));
  }
});

test("deep links: absent stays absent, null is every cell, junk is dropped", () => {
  assert.equal(normalizeViewSubset(undefined), undefined);
  assert.equal(normalizeViewSubset(null), null);
  assert.equal(normalizeViewSubset("all"), null);
  assert.equal(normalizeViewSubset({ n: -4 }), undefined);
  assert.deepEqual(normalizeViewSubset({ seed: 2, n: 7 }), { n: 7, seed: 2 });

  assert.equal("subset" in normalizeView({ constants: {} }), false);
  assert.equal(normalizeView({ subset: null }).subset, null);
  assert.deepEqual(normalizeView({ subset: { n: 100000, seed: 0 } }).subset, { n: 100000, seed: 0 });
  assert.equal("subset" in normalizeView({ subset: { n: "lots" } }), false);
});

test("sameSubset compares meaning, not spelling", () => {
  assert.ok(sameSubset({ seed: 0, n: 5 }, { n: 5 }));
  assert.ok(sameSubset(null, "all"));
  assert.ok(!sameSubset({ n: 5 }, { n: 5, seed: 1 }));
  assert.ok(!sameSubset(null, { n: 5 }));
});

test("header text: counts, seed, filter, and every cell", () => {
  const info = { subset: { n: 100000, seed: 0 }, n: 100000, n_total: 1160000, n_eligible: 1160000 };
  const d = describeSubset(info);
  assert.equal(d.count, "100,000 of 1,160,000");
  assert.equal(d.badge, "Subset · seed 0");
  assert.ok(d.active);
  assert.match(d.title, /Showing 100,000 of 1,160,000 cells \(seed 0\)/);

  const filtered = describeSubset({ subset: { n: 10, seed: 4, balance: "batch",
    where: [{ col: "cluster", op: "in", values: ["3", "5"] }] }, n: 10, n_total: 500, n_eligible: 42 });
  assert.match(filtered.title, /seed 4, balanced by batch, cluster in \{3, 5\}/);
  assert.match(filtered.title, /42 cells pass the filter/);

  const all = describeSubset({ subset: null, n: 8090, n_total: 8090 });
  assert.equal(all.count, "8,090");
  assert.equal(all.badge, "All cells");
  assert.ok(!all.active);
  assert.equal(describeSubset(null, 12).count, "12");
});

test("a cell table's AND filter on obs columns becomes subset conditions", () => {
  const columns = [{ type: "obs", key: "cluster" }, { type: "obs", key: "n counts" },
                   { type: "obsm", key: "X_umap", column: "0" }, { type: "obs", key: "doublet" }];
  const key = (c) => `${c.type}_${c.key}_${c.column || "main"}`.replace(/\s+/g, "_");
  const details = { logic: "AND", criteria: [
    { condition: "=", data: "cluster", origData: "obs_cluster_main", type: "string", value: ["5"] },
    { condition: "between", data: "n counts", origData: "obs_n_counts_main", type: "num", value: ["10", "20"] },
    { condition: ">=", data: "n counts", origData: "obs_n_counts_main", type: "num", value: ["3"] },
    { condition: "=", data: "doublet", origData: "obs_doublet_main", type: "string", value: ["No"] },
    { condition: "contains", data: "cluster", origData: "obs_cluster_main", type: "string", value: ["1"] },
    { condition: ">", data: "X_umap:0", origData: "obsm_X_umap_0", type: "num", value: ["1"] },
    { condition: "!between", data: "n counts", origData: "obs_n_counts_main", type: "num", value: ["1", "2"] },
    { logic: "OR", criteria: [] }
  ] };
  const { where, unsupported } = searchBuilderToWhere(details, columns, key, new Set(["doublet"]));
  assert.deepEqual(where, [
    { col: "cluster", op: "in", values: ["5"] },
    { col: "n counts", op: "between", value: [10, 20] },
    { col: "n counts", op: ">=", value: 3 },
    { col: "doublet", op: "in", values: ["false"] }
  ]);
  assert.equal(unsupported.length, 4);
  assert.ok(unsupported.some(u => /X_umap/.test(u)));
  assert.ok(unsupported.some(u => /nested/.test(u)));
});

test("an OR filter is not translated at all", () => {
  const r = searchBuilderToWhere({ logic: "OR", criteria: [
    { condition: "=", origData: "obs_a_main", type: "string", value: ["x"] },
    { condition: "=", origData: "obs_a_main", type: "string", value: ["y"] }] },
    [{ type: "obs", key: "a" }], (c) => `${c.type}_${c.key}_main`);
  assert.deepEqual(r.where, []);
  assert.match(r.unsupported[0], /OR/);
});
