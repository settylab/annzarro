// The canonical text of a category (plan 1.6, S3), pinned by tests/data/level_id_vectors.json, which
// tests/core/test_level_id_vectors.py runs against canonical_label. Here:
//   * the float vectors are checked against the engine's own Number.prototype.toString, so the file cannot pin
//     a form JavaScript does not write;
//   * canonLabel in static/js/utils/level-id.js is checked against every vector not marked python-only. Until G6
//     creates that module the check is skipped; once the module exists without canonLabel, it FAILS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(fs.readFileSync(path.join(here, "..", "data", "level_id_vectors.json"), "utf8"));
const MODULE = path.join(here, "..", "..", "..", "static", "js", "utils", "level-id.js");

function decode(v) {
  if (v.kind === "int") return Number(v.value);
  if (v.kind === "float" && typeof v.value === "string") return Number(v.value);
  return v.value;
}

test("float vectors are what JavaScript writes", () => {
  const floats = doc.categories.filter((v) => v.kind === "float" && Number.isFinite(decode(v)));
  assert.ok(floats.length >= 9);
  for (const v of floats) {
    const x = decode(v);
    assert.equal("c:" + (Object.is(x, -0) ? "0" : String(x)), v.id, v.name);
  }
});

test("integers that fit a Number are their digits", () => {
  for (const v of doc.categories.filter((c) => c.kind === "int" && c.only !== "python")) {
    assert.equal("c:" + String(Number(v.value)), v.id, v.name);
  }
});

test("group keys are JSON.stringify of the key", () => {
  for (const v of doc.group_keys) {
    assert.equal(JSON.stringify(v.key), v.json, v.name);
    assert.deepEqual(JSON.parse(v.json), v.key, v.name);
  }
});

test("canonLabel matches every vector", async (t) => {
  if (!fs.existsSync(MODULE)) {
    t.skip("utils/level-id.js does not exist yet (G6 adds canonLabel)");
    return;
  }
  const mod = await import(pathToFileURL(MODULE).href);
  assert.equal(typeof mod.canonLabel, "function", "utils/level-id.js exists but exports no canonLabel (plan 1.6, S3)");
  for (const v of doc.categories.filter((c) => c.only !== "python")) {
    assert.equal(mod.canonLabel(decode(v)), v.id, v.name);
  }
});
