// One name for one setting on every plot (options-vocabulary.js): no kind can declare its own label for a shared concept.
import { test } from "node:test";
import assert from "node:assert/strict";

const V = await import("../../../static/js/panels/plot-utilities/options-vocabulary.js");
const S = await import("../../../static/js/panels/plot-utilities/options-schema.js");
await import("../../../static/js/panels/plot-utilities/aesthetics-kinds.js");

const KINDS = ["cell-gene", "cell-count", "cell-plot", "gene-plot"];

test("every field whose concept the vocabulary names carries that one label, in every kind", () => {
  for (const kind of KINDS) {
    for (const f of S.fieldsOf(kind)) {
      const want = V.LABELS[V.CONCEPTS[f.id] || f.id];
      if (want) assert.equal(f.label, want, `${kind}.${f.id}`);
    }
  }
});

test("a concept has one label across the kinds, whatever the vocabulary names", () => {
  const seen = new Map();
  for (const kind of KINDS) {
    for (const f of S.fieldsOf(kind)) {
      if (!f.concept) continue;
      const first = seen.get(f.concept);
      if (first === undefined) seen.set(f.concept, [f.label, `${kind}.${f.id}`]);
      else assert.equal(f.label, first[0], `${f.concept}: ${kind}.${f.id} vs ${first[1]}`);
    }
  }
  assert.ok(seen.size > 20);
});

test("the names the operator chose", () => {
  assert.equal(V.LABELS.fontSize, "Font size (px)");
  assert.equal(V.LABELS.textColor, "Text color");
  assert.equal(V.LABELS.bgColor, "Background");
  assert.equal(V.LABELS.grid, "Grid lines");
  assert.equal(V.LABELS.gridWidth, "Grid line width (px)");
  assert.equal(S.fieldOf("cell-plot", "showGrid").label, "Grid lines");
  assert.equal(S.fieldOf("cell-count", "gridWidth").label, "Grid line width (px)");
});
