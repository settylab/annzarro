// The axis type a series needs, and when a kept zoom still applies
// (static/js/panels/plot-utilities/plot-make-helper.js).
// Run: `node --test annzarro/tests/js/axis-kind.test.mjs`.
import assert from "node:assert/strict";
import test from "node:test";
import {
  adoptUnrecordedViewport, applyAxisKinds, axesSignature, axisKind, createLayout, keptViewRanges, viewportFitsAxes,
} from "../../../static/js/panels/plot-utilities/plot-make-helper.js";

const field = (type, key, column = "") => ({ type, key, column });
const settings = (over = {}) => ({
  x: field("obs", "cell_type"), y: field("obsm", "X_umap", "1"), z: null, showGrid: true, ...over,
});

test("text series get a category axis, everything else a linear one", () => {
  assert.equal(axisKind({ type: "categorical" }), "category");
  assert.equal(axisKind({ type: "string" }), "category");
  assert.equal(axisKind({ type: "numerical" }), "linear");
  assert.equal(axisKind({ type: "constant" }), "linear");
  assert.equal(axisKind(null), "linear");
});

test("applyAxisKinds types each axis and revises it with its field, 2D and 3D", () => {
  const s = settings();
  const layout = createLayout(s);
  applyAxisKinds(layout, s, { x: { type: "categorical" }, y: { type: "numerical" } }, "ds");
  assert.equal(layout.xaxis.type, "category");
  assert.equal(layout.yaxis.type, "linear");
  const first = layout.xaxis.uirevision;
  const t = settings({ x: field("obs", "total_counts") });
  const next = createLayout(t);
  applyAxisKinds(next, t, { x: { type: "numerical" }, y: { type: "numerical" } }, "ds");
  assert.equal(next.xaxis.type, "linear");
  assert.notEqual(next.xaxis.uirevision, first);
  assert.notEqual(next.yaxis.uirevision, layout.yaxis.uirevision, "2D: both axes are one view");
  const again = createLayout(t);
  applyAxisKinds(again, t, { x: { type: "numerical" }, y: { type: "numerical" } }, "ds");
  assert.equal(again.xaxis.uirevision, next.xaxis.uirevision, "the same fields keep their zoom");
  assert.equal(again.yaxis.uirevision, next.yaxis.uirevision);

  const s3 = settings({ z: field("obs", "label") });
  const l3 = createLayout(s3);
  applyAxisKinds(l3, s3, { x: { type: "numerical" }, y: { type: "numerical" }, z: { type: "string" } }, "ds");
  assert.equal(l3.scene.zaxis.type, "category");
  assert.equal(l3.scene.xaxis.type, "linear");
  const t3 = settings({ z: field("obs", "score") });
  const n3 = createLayout(t3);
  applyAxisKinds(n3, t3, { x: { type: "numerical" }, y: { type: "numerical" }, z: { type: "numerical" } }, "ds");
  assert.equal(n3.scene.xaxis.uirevision, l3.scene.xaxis.uirevision, "3D: the untouched axis keeps its revision");
  assert.notEqual(n3.scene.zaxis.uirevision, l3.scene.zaxis.uirevision);
});

test("a kept zoom applies to the fields it was made on, and to a view that records none", () => {
  const s = settings({ x: field("obs", "total_counts") });
  s.viewport2D = { axes: axesSignature(s), xrange: [1, 2], yrange: [3, 4] };
  assert.equal(viewportFitsAxes(s), true);
  assert.deepEqual(keptViewRanges(s), { "xaxis.range": [1, 2], "yaxis.range": [3, 4] });
  assert.deepEqual(createLayout(s).xaxis.range, [1, 2]);
  s.x = field("obs", "score");
  assert.equal(viewportFitsAxes(s), false);
  assert.equal(keptViewRanges(s), null);
  assert.equal(createLayout(s).xaxis.range, undefined);
  s.viewport2D = { xrange: [1, 2], yrange: [3, 4] };      // saved before the record existed
  assert.equal(viewportFitsAxes(s), true);
});

test("a zoom saved without its fields is kept if it shows a point, and dropped if it shows none", () => {
  const s = settings({ x: field("obsm", "X_umap", "0") });
  const data = { x: { type: "numerical", values: [-3, 0, 2] }, y: { type: "numerical", values: [-2, 1, 2] } };
  s.viewport2D = { xrange: [-1, 1], yrange: [0, 3] };
  adoptUnrecordedViewport(s, data);
  assert.deepEqual(s.viewport2D, { xrange: [-1, 1], yrange: [0, 3], axes: axesSignature(s) });
  s.viewport2D = { xrange: [2832, 5944], yrange: [3455, 5558] };   // spatial units on the UMAP
  adoptUnrecordedViewport(s, data);
  assert.equal(s.viewport2D, null);
  const recorded = { axes: "other", xrange: [2832, 5944], yrange: [3455, 5558] };
  s.viewport2D = recorded;
  adoptUnrecordedViewport(s, data);
  assert.equal(s.viewport2D, recorded, "a recorded zoom is left to viewportFitsAxes");
  s.viewport2D = { xrange: [5, 6], yrange: [5, 6] };
  adoptUnrecordedViewport(s, { x: { type: "categorical", values: ["a"] }, y: data.y });
  assert.deepEqual(s.viewport2D, { xrange: [5, 6], yrange: [5, 6] }, "text axes are left as they are");
});

import { axisChangeRelayout } from "../../../static/js/panels/plot-utilities/plot-make-helper.js";

test("axisChangeRelayout retypes, revises and refits both 2D axes, and only the changed 3D axis", () => {
  const s = settings({ x: field("obs", "total_counts") });
  const data = { x: { type: "numerical" }, y: { type: "numerical" } };
  const both = "ds|obs.total_counts.|obsm.X_umap.1|-|linear";
  assert.deepEqual(axisChangeRelayout(s, data, ["x"], "ds"), {
    "xaxis.type": "linear", "xaxis.uirevision": both, "xaxis.autorange": true,
    "yaxis.type": "linear", "yaxis.uirevision": both, "yaxis.autorange": true,
  });
  const t = settings({ z: field("obs", "label") });
  const u = axisChangeRelayout(t, { ...data, z: { type: "string" } }, ["z"], "ds");
  assert.equal(u["scene.zaxis.type"], "category");
  assert.equal(u["scene.zaxis.autorange"], true);
  assert.equal(u["scene.xaxis.autorange"], undefined);
  assert.deepEqual(axisChangeRelayout(s, data, [], "ds"), {});
});

import {
  TEXT_AXIS_TIP, isTextColumn, largeThreshold, limitTextAxisOptions, textObsColumns,
} from "../../../static/js/panels/plot-utilities/large-plot-controls.js";

test("which obs columns are labels", () => {
  for (const type of ["categorical", "object", "str", "string", "StringDType()", "<U7", "|S4", "U10"]) {
    assert.equal(isTextColumn({ type }), true, type);
  }
  for (const type of ["float64", "int64", "uint8", "bool", "float32"]) assert.equal(isTextColumn({ type }), false, type);
  assert.equal(isTextColumn(undefined), false);
  const set = textObsColumns({ obs: { columns_info: { a: { type: "categorical" }, b: { type: "float64" }, c: { type: "object" } } } });
  assert.deepEqual([...set].sort(), ["a", "c"]);
  assert.equal(textObsColumns(null).size, 0);
});

test("limitTextAxisOptions greys label columns of an obs key select and restores them", () => {
  const options = ["a", "b"].map((value) => ({
    value, disabled: false, dataset: {}, title: "",
    getAttribute(n) { return n === "title" ? this.title : null; },
    setAttribute(n, v) { if (n === "title") this.title = v; },
    removeAttribute(n) { if (n === "title") this.title = ""; },
  }));
  const select = { options, dataset: { keyType: "obs" } };
  limitTextAxisOptions(select, true, new Set(["a"]));
  assert.deepEqual(options.map((o) => o.disabled), [true, false]);
  assert.equal(options[0].title, TEXT_AXIS_TIP);
  limitTextAxisOptions(select, false, new Set(["a"]));
  assert.deepEqual(options.map((o) => o.disabled), [false, false]);
  assert.equal(options[0].title, "");
  select.dataset.keyType = "obsm";       // an embedding's keys are never label columns
  limitTextAxisOptions(select, true, new Set(["a"]));
  assert.deepEqual(options.map((o) => o.disabled), [false, false]);
});

test("the large-plot threshold defaults to a million", () => {
  assert.equal(largeThreshold({ LARGE_PLOT_POINTS: 100 }), 100);
  assert.equal(largeThreshold({}), 1000000);
  assert.equal(largeThreshold(undefined), 1000000);
});
