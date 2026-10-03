// Streaming reads of the JSON routes for datasets too large for one string
// (static/js/utils/json-stream.js, static/js/utils/packed-names.js).
//
// A /cells body of a 95.6M-cell dataset is 2.1 GB, past V8's maximum string
// length, so the names and categorical codes are read from the byte stream.
// These tests feed the readers bodies cut into chunks at every byte position
// (a string, an escape or a `null` split across two network reads) and check
// they give exactly what JSON.parse gives.
//
// Run: `node --test annzarro/tests/js/packed-names.test.mjs` (node >= 18).
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { PackedNames, categoryCodesFromJSON } = await import(
  pathToFileURL(path.resolve(__dirname, "../../../static/js/utils/packed-names.js")).href
);

/** A Response whose body arrives in chunks of `size` bytes. */
function chunked(text, size) {
  const bytes = new TextEncoder().encode(text);
  let pos = 0;
  return new Response(new ReadableStream({
    pull(ctrl) {
      if (pos >= bytes.length) { ctrl.close(); return; }
      ctrl.enqueue(bytes.slice(pos, pos + size));
      pos += size;
    }
  }));
}

const NAMES = ["AAAC-1", "cell \"quoted\"", "back\\slash", "naïve 細胞", "", "x#y", "tab\tin"];

test("names: identical to JSON.parse for every chunk size", async () => {
  const body = JSON.stringify({ cells: NAMES, dataset_path: "/d/x.zarr" });
  for (let size = 1; size <= body.length; size++) {
    const names = await PackedNames.fromJSON(chunked(body, size), "cells");
    assert.equal(names.length, NAMES.length, `chunk ${size}`);
    assert.deepEqual([...names], NAMES, `chunk ${size}`);
  }
});

test("names: index access, indexOf, includes, at, slice", async () => {
  const names = await PackedNames.fromJSON(chunked(JSON.stringify({ cells: NAMES }), 7), "cells");
  assert.equal(names[1], NAMES[1]);
  assert.equal(names.at(-1), NAMES[NAMES.length - 1]);
  assert.equal(names.indexOf("naïve 細胞"), 3);
  assert.equal(names.indexOf(""), 4);
  assert.equal(names.indexOf("missing"), -1);
  assert.equal(names.includes("x#y"), true);
  assert.deepEqual(names.slice(1, 3), NAMES.slice(1, 3));
  assert.deepEqual(names.map(n => n.length), NAMES.map(n => n.length));
});

test("names: other keys and nested arrays are ignored", async () => {
  const body = JSON.stringify({ dataset_path: "/a", other: ["no"], meta: { cells: ["nested"] }, cells: ["a", "b"] });
  const names = await PackedNames.fromJSON(chunked(body, 3), "cells");
  assert.deepEqual([...names], ["a", "b"]);
});

test("categorical codes: dataset order, missing values, every chunk size", async () => {
  const cats = ["T cell", "B \"cell\"", "NK", "unused"];
  const values = ["NK", null, "T cell", "B \"cell\"", "NK", "late", null, "T cell"];
  const body = JSON.stringify({ categories: { ct: cats }, data: { ct: values }, dataset_path: "/d" });
  for (let size = 1; size <= body.length; size += 3) {
    const { codes, categories, MISSING } = await categoryCodesFromJSON(chunked(body, size), "ct");
    assert.deepEqual(categories, [...cats, "late"], `chunk ${size}`);
    const back = Array.from(codes, c => (c === MISSING ? null : categories[c]));
    assert.deepEqual(back, values, `chunk ${size}`);
  }
});

test("categorical codes: data before categories (key order not assumed)", async () => {
  const body = '{"data": {"ct": ["b", "a", "b"]}, "categories": {"ct": ["a", "b"]}}';
  const { codes, categories } = await categoryCodesFromJSON(chunked(body, 5), "ct");
  assert.deepEqual(categories, ["a", "b"]);
  assert.deepEqual(Array.from(codes), [1, 0, 1]);
});

// --- names kept on the server (static/js/utils/remote-names.js) -------------
const { RemoteNames } = await import(
  pathToFileURL(path.resolve(__dirname, "../../../static/js/utils/remote-names.js")).href
);

test("remote names: fetched one at a time, cached, array-like from the cache", async () => {
  const all = ["c0", "c1", "c2", "c3"];
  const calls = [];
  const names = RemoteNames.wrap(new RemoteNames(all.length,
    async (idx) => { calls.push(["name", ...idx]); return idx.map(i => all[i]); },
    async (n) => { calls.push(["index", n]); return all.indexOf(n); }));
  assert.equal(names.length, 4);
  assert.equal(names[2], undefined, "not fetched yet");
  assert.equal(await names.nameAt(2), "c2");
  assert.equal(names[2], "c2");
  assert.equal(names.indexOf("c2"), 2, "learned from nameAt");
  assert.equal(await names.resolve("c3"), 3);
  assert.equal(await names.resolve("c3"), 3);
  assert.equal(await names.resolve("nope"), -1);
  assert.equal(await names.resolve("nope"), -1);
  assert.deepEqual(calls, [["name", 2], ["index", "c3"], ["index", "nope"]], "each asked once");
  assert.equal(names.includes("c3"), true);
  assert.equal(await names.nameAt(9), undefined);
});

test("remote names: walking every name throws a clear error", () => {
  const names = RemoteNames.wrap(new RemoteNames(50000000, async () => [], async () => -1));
  for (const walk of [() => [...names], () => names.map(x => x), () => names.slice(0, 2)]) {
    assert.throws(walk, /not loaded .*turn on a subset/);
  }
});
