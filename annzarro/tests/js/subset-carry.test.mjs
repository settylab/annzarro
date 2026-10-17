// The subset size carried across dataset switches (static/js/utils/subset-carry.js):
// the size kept and the dataset's size give the subset a switch asks for; only a
// size chosen by hand changes it; it is kept per server and user, and storage
// never throws. The header says when a small dataset shows every cell because of it.
//
// Run: `node --test annzarro/tests/js/subset-carry.test.mjs`.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = (rel) => import(pathToFileURL(path.resolve(__dirname, "../../../static/js", rel)).href);

const {
  carriedRequest, sizeAfterChoice, showsAll, carryNote, cleanSize,
  loadSubsetSize, saveSubsetSize, subsetSizeKey
} = await load("utils/subset-carry.js");
const { describeSubset } = await load("utils/subset.js");

const DEFAULTS = { size: 100000, seed: 0, threshold: 200000 };

const memory = () => {
  const m = new Map();
  return {
    m,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
};

test("a switch: a larger dataset is subsampled to the size, a smaller one shows every cell", () => {
  assert.deepEqual(carriedRequest(10000, 30000), { n: 10000, seed: 0 });
  assert.deepEqual(carriedRequest(10000, 30000, { seed: 7 }), { n: 10000, seed: 7 });
  assert.equal(carriedRequest(10000, 3000), null);
  assert.equal(carriedRequest(10000, 10000), null, "as many cells as the size: every cell");
  assert.deepEqual(carriedRequest(10000, 10001), { n: 10000, seed: 0 });
});

test("never chosen: the server's default, as before", () => {
  assert.equal(carriedRequest(undefined, 30000), "auto");
  assert.equal(carriedRequest(undefined, 5e6), "auto");
  assert.equal(carriedRequest("bogus", 5e6), "auto");
  assert.equal(carriedRequest(10000, null), "auto", "a dataset of unknown size");
});

test("every cell, chosen: every cell of every dataset", () => {
  assert.equal(carriedRequest("all", 3000), null);
  assert.equal(carriedRequest("all", 5e6), null);
});

test("a size the memory guard refuses falls back to the server's default", () => {
  assert.equal(carriedRequest("all", 5e7, { maxCells: 2e7 }), "auto");
  assert.equal(carriedRequest(3e7, 5e7, { maxCells: 2e7 }), "auto");
  assert.deepEqual(carriedRequest(1e6, 5e7, { maxCells: 2e7 }), { n: 1e6, seed: 0 });
  assert.equal(carriedRequest(1e6, 3000, { maxCells: 2e7 }), null);
});

test("a size chosen by hand is the new size; a filter, a balance and a part are not carried", () => {
  assert.equal(sizeAfterChoice({ n: 10000, seed: 0 }, 30000, undefined, DEFAULTS), 10000);
  assert.equal(sizeAfterChoice({ n: 5000, seed: 3, balance: "batch",
    where: [{ col: "cluster", op: "in", values: ["3"] }], part: 2 }, 30000, 10000, DEFAULTS), 5000);
  // and the request a later switch makes holds the size only
  assert.deepEqual(carriedRequest(5000, 30000), { n: 5000, seed: 0 });
  // a size on a dataset smaller than it is still the user's choice
  assert.equal(sizeAfterChoice({ n: 50000, seed: 0 }, 3000, 10000, DEFAULTS), 50000);
});

test("every cell chosen: a new intent only where the size kept would have subsampled", () => {
  // a larger dataset than the size: every cell is the new choice
  assert.equal(sizeAfterChoice(null, 30000, 10000, DEFAULTS), "all");
  assert.equal(sizeAfterChoice({ n: null, seed: 0, where: [{ col: "a", op: "empty" }] }, 30000, 10000, DEFAULTS), "all");
  // a dataset the size already shows in full: the size stays for the larger ones
  assert.equal(sizeAfterChoice(null, 3000, 10000, DEFAULTS), 10000);
  // never chosen: every cell of a dataset over the server's threshold is a choice, under it is not
  assert.equal(sizeAfterChoice(null, 500000, undefined, DEFAULTS), "all");
  assert.equal(sizeAfterChoice(null, 50000, undefined, DEFAULTS), undefined);
  assert.equal(sizeAfterChoice(null, 50000, "all", DEFAULTS), "all");
});

test("showsAll follows the server's threshold for a size never chosen", () => {
  assert.ok(showsAll(undefined, 200000, DEFAULTS));
  assert.ok(!showsAll(undefined, 200001, DEFAULTS));
  assert.ok(showsAll(undefined, 5e9, null), "no defaults known: no opinion, nothing to change");
  assert.ok(showsAll("all", 5e9));
  assert.ok(showsAll(10000, 10000) && !showsAll(10000, 10001));
});

test("the size is kept per server and user, and a broken or blocked storage never throws", () => {
  const st = memory();
  assert.equal(loadSubsetSize(st, "http://a", "local"), undefined);
  saveSubsetSize(st, "http://a", "local", 10000);
  saveSubsetSize(st, "http://a", "user:ada", "all");
  assert.equal(loadSubsetSize(st, "http://a", "local"), 10000);
  assert.equal(loadSubsetSize(st, "http://a", "user:ada"), "all");
  assert.equal(loadSubsetSize(st, "http://b", "local"), undefined);
  assert.equal(st.m.get(subsetSizeKey("http://a", "local")), '{"size":10000}');
  saveSubsetSize(st, "http://a", "local", undefined);
  assert.equal(loadSubsetSize(st, "http://a", "local"), undefined);

  st.setItem(subsetSizeKey("http://a", "local"), "{not json");
  assert.equal(loadSubsetSize(st, "http://a", "local"), undefined);
  st.setItem(subsetSizeKey("http://a", "local"), '{"size": -4}');
  assert.equal(loadSubsetSize(st, "http://a", "local"), undefined);
  st.setItem(subsetSizeKey("http://a", "local"), '{"size": 2.5}');
  assert.equal(loadSubsetSize(st, "http://a", "local"), undefined);

  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(loadSubsetSize(blocked, "http://a", "local"), undefined);
  assert.doesNotThrow(() => saveSubsetSize(blocked, "http://a", "local", 5));
  assert.doesNotThrow(() => saveSubsetSize(blocked, "http://a", "local", undefined));
  assert.equal(cleanSize(0), undefined);
  assert.equal(cleanSize("10000"), undefined);
});

test("the header says the size is still in effect on a dataset it shows in full", () => {
  assert.deepEqual(carryNote(undefined, 3000), null);
  assert.deepEqual(carryNote("all", 3000), null);
  assert.deepEqual(carryNote(10000, 30000), null, "a larger dataset is on the subset: nothing to add");
  const small = describeSubset({ subset: null, n: 3000, n_total: 3000 }, null, 10000);
  assert.equal(small.badge, "All cells (≤ 10,000)");
  assert.equal(small.count, "3,000");
  assert.ok(!small.active);
  assert.match(small.title, /no more cells than your subset size \(10,000\)/);
  assert.match(small.title, /Larger datasets you open show a subset of 10,000 cells/);
  assert.equal(describeSubset(null, 3000, 10000).badge, "All cells (≤ 10,000)");
  // without a size, or with every cell chosen, the badge is as it was
  assert.equal(describeSubset({ subset: null, n: 3000, n_total: 3000 }).badge, "All cells");
  assert.equal(describeSubset({ subset: null, n: 3000, n_total: 3000 }, null, "all").badge, "All cells");
  // every cell of a dataset larger than the size (a link said so): no claim about the size
  assert.equal(describeSubset({ subset: null, n: 30000, n_total: 30000 }, null, 10000).badge, "All cells");
});
