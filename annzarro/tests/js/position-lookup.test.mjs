// Where each point's name is in the plot's list of names, for the position
// update of a categorical Cell Plot (static/js/panels/plot-utilities/plot-update.js).
// Run: `node --test annzarro/tests/js/position-lookup.test.mjs`.
import assert from "node:assert/strict";
import test from "node:test";
import { positionLookup } from "../../../static/js/panels/plot-utilities/plot-update.js";
import { PackedNames } from "../../../static/js/utils/packed-names.js";
import { RemoteNames } from "../../../static/js/utils/remote-names.js";

test("answers as indexOf does, for an array and for packed names", () => {
  const names = ["c0", "c1", "c2", "c1"];
  for (const list of [names, PackedNames.fromArray(names)]) {
    const at = positionLookup(list);
    for (const name of ["c0", "c1", "c2", "c3", ""]) assert.equal(at(name), names.indexOf(name), name);
  }
});

test("cells kept on the server answer from their own index", () => {
  const all = ["c0", "c1", "c2"];
  const names = RemoteNames.wrap(new RemoteNames(all.length, async (idx) => idx.map(i => all[i]),
    async (n) => all.indexOf(n)));
  names._indexOf.set("c2", 2);
  const at = positionLookup(names);
  assert.equal(at("c2"), 2);
  assert.equal(at("c0"), -1, "not known in the browser: not looked up one by one here");
});

test("100,000 points in one pass, not one search each", () => {
  const n = 100000;
  const names = Array.from({ length: n }, (_, i) => `AAACCCAAGTT-${i}-1`);
  const points = names.slice().reverse();
  const start = Date.now();
  const at = positionLookup(names);
  const found = points.map(at);
  assert.equal(found[0], n - 1);
  assert.equal(found[n - 1], 0);
  assert.ok(Date.now() - start < 1000, `${Date.now() - start} ms`);
});
