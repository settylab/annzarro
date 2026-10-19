// Flipped axes: a view setting of a plot (static/js/panels/plot-utilities/plot-make-helper.js).
// Run: `node --test annzarro/tests/js/axis-flip.test.mjs`.
import assert from "node:assert/strict";
import test from "node:test";
import {
  autorangeValue, createLayout, flipRelayout, isAutorange, isFlipped, keptViewRanges, orientRange, rangesForSize,
  equalAspectZoom,
} from "../../../static/js/panels/plot-utilities/plot-make-helper.js";
import { stableAxisRanges } from "../../../static/js/panels/plot-utilities/plot-make.js";
import { STYLE_KEYS, pickStyle, adoptStyle, presetChanges } from "../../../static/js/panels/plot-utilities/plot-options.js";

const field = (type, key, column = "") => ({ type, key, column });
const settings = (over = {}) => ({
  x: field("obsm", "spatial", "0"), y: field("obsm", "spatial", "1"), z: null, showGrid: true, ...over,
});

test("a flip is a 2D setting that is on only when it is true", () => {
  assert.equal(isFlipped(settings(), "y"), false);
  assert.equal(isFlipped(settings({ flipY: true }), "y"), true);
  assert.equal(isFlipped(settings({ flipY: true }), "x"), false);
  assert.equal(isFlipped(settings({ flipY: true, z: field("obs", "n") }), "y"), false, "not in 3D");
  assert.equal(autorangeValue(settings({ flipY: true }), "y"), "reversed");
  assert.equal(autorangeValue(settings({ flipY: true }), "x"), true);
  assert.equal(isAutorange(true) && isAutorange("reversed") && !isAutorange(false), true);
});

test("the layout fits a flipped axis backwards, the other as before", () => {
  const l = createLayout(settings({ flipY: true }));
  assert.equal(l.yaxis.autorange, "reversed");
  assert.equal(l.xaxis.autorange, undefined);
  const plain = createLayout(settings());
  assert.equal(plain.yaxis.autorange, undefined, "an old link loads unflipped");
});

test("a kept zoom is drawn the way the axis runs, whichever way it was saved", () => {
  const viewport2D = { axes: undefined, xrange: [0, 10], yrange: [20, 5] };
  const s = settings({ flipY: true, viewport2D });
  // the zoom only counts for the fields it was made on
  s.viewport2D.axes = JSON.stringify([s.x, s.y]);
  const l = createLayout(s);
  assert.ok(l.yaxis.range === undefined || l.yaxis.range[0] > l.yaxis.range[1]);
  assert.deepEqual(orientRange([5, 20], true), [20, 5]);
  assert.deepEqual(orientRange([20, 5], false), [5, 20]);
  assert.deepEqual(orientRange(["a", "b"], true), ["a", "b"], "not numbers: as they are");
});

test("pinned ranges and fitted axes follow the flip", () => {
  const data = { x: { values: [1, 2, 3] }, y: { values: [10, 20, 30] } };
  assert.deepEqual(stableAxisRanges(data, settings({ flipY: true })), { "xaxis.autorange": true, "yaxis.autorange": "reversed" });
  const pinned = stableAxisRanges(data, settings({ flipY: true, hideNaN: true }));
  assert.ok(pinned["xaxis.range"][0] < pinned["xaxis.range"][1]);
  assert.ok(pinned["yaxis.range"][0] > pinned["yaxis.range"][1]);
});

test("switching a flip refits a fitted axis and swaps the ends of a zoomed one", () => {
  const fl = { xaxis: { autorange: true, range: [0, 10] }, yaxis: { autorange: false, range: [2, 8] } };
  assert.deepEqual(flipRelayout(settings({ flipY: true }), fl), { "xaxis.autorange": true, "xaxis.range": [0, 10], "yaxis.range": [8, 2] });
  const back = { xaxis: { autorange: "reversed", range: [10, 0] }, yaxis: { autorange: false, range: [8, 2] } };
  assert.deepEqual(flipRelayout(settings(), back), { "xaxis.autorange": true, "xaxis.range": [0, 10], "yaxis.range": [2, 8] });
});

test("Equal aspect keeps the zoom's direction through a resize", () => {
  const fl = { xaxis: { range: [0, 100], _length: 200, type: "linear" },
    yaxis: { range: [50, 0], _length: 100, type: "linear", scaleanchor: "x" } };
  fl.xaxis.autorange = false; fl.yaxis.autorange = false;
  const zoom = equalAspectZoom(fl);
  assert.ok(zoom.perPixel[1] < 0, "a flipped axis has a negative scale");
  const bigger = { xaxis: { _length: 400 }, yaxis: { _length: 200, scaleanchor: "x" } };
  const r = rangesForSize(zoom, bigger);
  assert.ok(r["yaxis.range"][0] > r["yaxis.range"][1], "still runs backwards");
});

test("the flip is a view setting: no style copy, no preset, no session style carries it", () => {
  assert.ok(!STYLE_KEYS.includes("flipX") && !STYLE_KEYS.includes("flipY"));
  const src = settings({ flipY: true, flipX: true, showGrid: false });
  assert.ok(!("flipY" in pickStyle(src)));
  const dst = settings();
  adoptStyle(dst, pickStyle(src));
  assert.equal(dst.flipY, undefined);
  assert.equal(dst.showGrid, false);
  for (const name of ["default", "publication", "bare", "Default", "Publication", "Bare"]) {
    const changes = presetChanges(name);
    assert.ok(!("flipX" in changes) && !("flipY" in changes), name);
  }
});

test("a flip travels with the settings as plain JSON (a link, a session, a panel set)", () => {
  const s = settings({ flipY: true, flipX: false });
  const back = JSON.parse(JSON.stringify(s));
  assert.equal(isFlipped(back, "y"), true);
  assert.equal(isFlipped(back, "x"), false);
  assert.equal(isFlipped(JSON.parse(JSON.stringify(settings())), "y"), false);
});
