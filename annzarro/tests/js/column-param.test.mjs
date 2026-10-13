// The columns parameter of /data/obs and /data/var (static/js/utils/column-param.js).
// Run: `node --test annzarro/tests/js/column-param.test.mjs`.
import assert from "node:assert/strict";
import test from "node:test";
import { columnsParam } from "../../../static/js/utils/column-param.js";

test("plain names keep the comma-separated form", () => {
  assert.equal(columnsParam("cell_type"), "cell_type");
  assert.equal(columnsParam(["a", "b"]), "a,b");
  assert.equal(columnsParam(["orig.ident", "a[0]", "f(x)", "with space", "50%", "a/b"]), "orig.ident,a[0],f(x),with space,50%,a/b");
});

test("a name with a comma, or one that reads as JSON, is sent as a JSON list", () => {
  assert.equal(columnsParam("a,b"), '["a,b"]');
  assert.equal(columnsParam(["x", "a,b"]), '["x","a,b"]');
  assert.equal(columnsParam(["2024"]), '["2024"]');
  assert.equal(columnsParam(["[1]"]), '["[1]"]');
  assert.deepEqual(JSON.parse(columnsParam(["a,b", '"q"'])), ["a,b", '"q"']);
});
