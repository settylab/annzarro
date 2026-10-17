import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.document = { querySelector: () => null };
const { aboutText } = await import("../../../static/js/utils/about-dialog.js");

test("a plain AnnZarro page shows no site name", () => {
  assert.deepEqual(aboutText("AnnZarro", "0.5.5"), { version: "0.5.5", site: null });
});

test("a custom app name is kept and trimmed", () => {
  assert.deepEqual(aboutText("  Lab Atlas ", "0.5.5"), { version: "0.5.5", site: "Lab Atlas" });
});

test("no version yet gives an empty line, not 'null'", () => {
  assert.deepEqual(aboutText("AnnZarro", null), { version: "", site: null });
});
