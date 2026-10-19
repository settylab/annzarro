// The arithmetic of the table's line-selection tool (static/js/utils/line-select.js).
// Run: `node --test annzarro/tests/js/line-select.test.mjs`.
import assert from "node:assert/strict";
import test from "node:test";
import {
  addCriterion, axisMap, clipLine, configDepth, crossRight, derivedColumn, derivedName, derivedValues, fitInside, plotMode,
  lineCondition, lineOnScreen, numberCriterion, numberText, plotRefusal, rightPolygon, round, sameExpr, snap45,
} from "../../../static/js/utils/line-select.js";

const W = 400, H = 300;
// x: 0..40 left to right, y: 0..30 bottom to top
const xMap = (range = [0, 40]) => axisMap(range, W, false);
const yMap = (range = [0, 30]) => axisMap(range, H, true);

/** The rows (data points) a condition keeps, judged against the line on the SCREEN (null: on the line). */
function keptOnScreen(p1, p2, xm, ym, points) {
  return points.map(([X, Y]) => {
    const c = crossRight(p1, p2, { x: xm.toPx(X), y: ym.toPx(Y) });
    return Math.abs(c) < 1e-6 ? null : c <= 0;
  });
}
/** The condition's rows, with the rows on the line taken from the screen verdict. */
function agree(cond, p1, p2, xm, ym, points) {
  const screen = keptOnScreen(p1, p2, xm, ym, points);
  return [keptByCondition(cond, points).map((k, i) => (screen[i] === null ? null : k)), screen];
}
/** The rows the condition keeps, judged on the data. */
function keptByCondition(cond, points) {
  return points.map(([X, Y]) => {
    const f = cond.kind === "horizontal" ? Y : cond.kind === "vertical" ? X : Y - cond.m * X;
    const b = cond.kind === "slope" ? cond.b : cond.value;
    return cond.op === "<=" ? f <= b : f >= b;
  });
}

const grid = [];
for (let X = 1; X < 40; X += 3.7) for (let Y = 1; Y < 30; Y += 2.9) grid.push([X, Y]);

test("the axis maps invert each other, y runs up the data and down the screen", () => {
  const x = xMap(), y = yMap();
  assert.equal(x.toData(0), 0);
  assert.equal(x.toData(W), 40);
  assert.equal(y.toData(0), 30, "the top of the plot is the end of the y range");
  assert.equal(y.toData(H), 0);
  assert.ok(Math.abs(y.toPx(y.toData(77)) - 77) < 1e-9);
  assert.equal(xMap([40, 0]).toData(0), 40, "a reversed axis runs backwards");
});

test("drawn left to right, a rising line filters out what is below it (right of it)", () => {
  const x = xMap(), y = yMap();
  // screen (0,300) -> (400,0): data (0,0) -> (40,30); to the right is the lower-right region
  const p1 = { x: 0, y: H }, p2 = { x: W, y: 0 };
  const c = lineCondition(p1, p2, x, y);
  assert.equal(c.kind, "slope");
  assert.equal(c.m, 0.75);
  assert.equal(c.b, 0);
  assert.equal(c.op, ">=", "y - 0.75x >= 0 stays: above the line");
  assert.deepEqual(...agree(c, p1, p2, x, y, grid));
});

test("drawn the other way the other side is filtered out", () => {
  const x = xMap(), y = yMap();
  const p1 = { x: W, y: 0 }, p2 = { x: 0, y: H };
  const c = lineCondition(p1, p2, x, y);
  assert.equal(c.op, "<=");
  assert.deepEqual(...agree(c, p1, p2, x, y, grid));
});

test("every direction keeps the side that is not on the right, on all four axis orientations", () => {
  const starts = [{ x: 50, y: 40 }, { x: 350, y: 250 }, { x: 200, y: 150 }, { x: 30, y: 280 }];
  const tips = [{ x: 380, y: 60 }, { x: 40, y: 20 }, { x: 210, y: 290 }, { x: 15, y: 10 }, { x: 390, y: 270 }];
  for (const xr of [[0, 40], [40, 0]]) {
    for (const yr of [[0, 30], [30, 0]]) {
      const xm = xMap(xr), ym = yMap(yr);
      for (const p1 of starts) {
        for (const p2 of tips) {
          const c = lineCondition(p1, p2, xm, ym);
          if (!c) continue;
          const [got, want] = agree(c, p1, p2, xm, ym, grid);
          assert.deepEqual(got, want, `x ${xr} y ${yr} (${p1.x},${p1.y}) -> (${p2.x},${p2.y})`);
        }
      }
    }
  }
});

test("a reversed x axis changes the slope's sign, not the side that is kept on the screen", () => {
  // the same screen line and gesture: the data line differs, the kept SCREEN region does not
  const p1 = { x: 100, y: 250 }, p2 = { x: 300, y: 50 };
  const a = lineCondition(p1, p2, xMap([0, 40]), yMap());
  const b = lineCondition(p1, p2, xMap([40, 0]), yMap());
  assert.equal(a.kind, "slope");
  assert.equal(b.kind, "slope");
  assert.ok(a.m > 0 && b.m < 0, "the slope in the data changes sign");
  assert.equal(a.op, b.op, "the screen side kept is the same: above the line, either way");
});

test("horizontal and vertical lines are conditions on the axis itself", () => {
  const x = xMap(), y = yMap();
  // drawn left to right: right = below on the screen = smaller y: keep y >= 15
  const h = lineCondition({ x: 50, y: 150 }, { x: 350, y: 150 }, x, y);
  assert.deepEqual(h, { kind: "horizontal", value: 15, op: ">=" });
  // drawn right to left: right = above
  const h2 = lineCondition({ x: 350, y: 150 }, { x: 50, y: 150 }, x, y);
  assert.deepEqual(h2, { kind: "horizontal", value: 15, op: "<=" });
  // drawn downwards: right = towards smaller x on the screen (the user's right when facing down is the screen's left)
  const v = lineCondition({ x: 100, y: 20 }, { x: 100, y: 280 }, x, y);
  assert.deepEqual(v, { kind: "vertical", value: 10, op: ">=" });
  const v2 = lineCondition({ x: 100, y: 280 }, { x: 100, y: 20 }, x, y);
  assert.deepEqual(v2, { kind: "vertical", value: 10, op: "<=" });
  for (const [c, p1, p2] of [[h, { x: 50, y: 150 }, { x: 350, y: 150 }], [v, { x: 100, y: 20 }, { x: 100, y: 280 }]]) {
    assert.deepEqual(...agree(c, p1, p2, x, y, grid));
  }
});

test("a reversed y axis flips a horizontal line's inequality", () => {
  const p1 = { x: 50, y: 150 }, p2 = { x: 350, y: 150 };
  assert.equal(lineCondition(p1, p2, xMap(), yMap([0, 30])).op, ">=");
  assert.equal(lineCondition(p1, p2, xMap(), yMap([30, 0])).op, "<=");
});

test("points too close make no line", () => {
  assert.equal(lineCondition({ x: 10, y: 10 }, { x: 11, y: 10 }, xMap(), yMap()), null);
  assert.equal(lineCondition({ x: 10, y: 10 }, { x: 10, y: 10 }, xMap(), yMap()), null);
});

test("the slope and intercept are rounded once, and the rounded line is the drawn one", () => {
  const x = xMap(), y = yMap();
  const p1 = { x: 37, y: 211 }, p2 = { x: 353, y: 67 };
  const c = lineCondition(p1, p2, x, y);
  assert.equal(c.m, round(c.m));
  assert.equal(c.b, round(c.b));
  const [a, b] = lineOnScreen(c, x, y);
  // the rounded line passes through the mouse points to a hundredth of a pixel
  for (const p of [p1, p2]) {
    const d = Math.abs(crossRight(a, b, p)) / Math.hypot(b.x - a.x, b.y - a.y);
    assert.ok(d < 0.01, `distance ${d}`);
  }
});

test("Shift snaps to multiples of 45 degrees, exactly on the axes", () => {
  const p1 = { x: 100, y: 100 };
  const horiz = snap45(p1, { x: 200, y: 108 });
  assert.equal(horiz.y, 100, "horizontal is exactly horizontal");
  assert.ok(Math.abs(horiz.x - (100 + Math.hypot(100, 8))) < 1e-9, "the length is kept");
  const vert = snap45(p1, { x: 93, y: 40 });
  assert.equal(vert.x, 100);
  assert.ok(vert.y < 100);
  const diag = snap45(p1, { x: 190, y: 40 });
  assert.ok(Math.abs((diag.x - 100) + (diag.y - 100)) < 1e-9, "up and to the right at 45 degrees");
  assert.ok(diag.x > 100 && diag.y < 100);
  const back = snap45(p1, { x: 20, y: 105 });
  assert.equal(back.y, 100);
  assert.ok(back.x < 100);
  assert.deepEqual(snap45(p1, p1), p1);
});

test("snapped lines are axis-parallel conditions", () => {
  const x = xMap(), y = yMap();
  const p1 = { x: 100, y: 100 };
  assert.equal(lineCondition(p1, snap45(p1, { x: 300, y: 109 }), x, y).kind, "horizontal");
  assert.equal(lineCondition(p1, snap45(p1, { x: 94, y: 250 }), x, y).kind, "vertical");
  assert.equal(lineCondition(p1, snap45(p1, { x: 300, y: 290 }), x, y).kind, "slope");
});

test("the filtered polygon is the plot area on the right of the line", () => {
  // left to right along the middle: the right is the bottom half
  const poly = rightPolygon({ x: 0, y: 150 }, { x: W, y: 150 }, W, H);
  const area = poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2;
  assert.equal(Math.abs(area), W * 150);
  assert.ok(poly.every(p => p.y >= 150));
  // a line along an edge leaves nothing on one side
  assert.deepEqual(rightPolygon({ x: 0, y: 0 }, { x: W, y: 0 }, W, H).length, 4, "the whole area is below the top edge");
  assert.deepEqual(rightPolygon({ x: W, y: 0 }, { x: 0, y: 0 }, W, H), [], "and nothing is above it");
});

test("the line is clipped to the plot area", () => {
  const seg = clipLine({ x: 100, y: 100 }, { x: 200, y: 100 }, W, H);
  assert.deepEqual(seg, [{ x: 0, y: 100 }, { x: W, y: 100 }]);
  assert.equal(clipLine({ x: 0, y: -10 }, { x: 100, y: -10 }, W, H), null, "a line outside misses it");
});

test("a derived column is named from its columns and slope, and identical ones match", () => {
  const nameOf = (c) => c.key;
  const y = { type: "obsm", key: "UMAP_2", column: "" }, x = { type: "obsm", key: "UMAP_1", column: "" };
  assert.equal(derivedName("UMAP_2", "UMAP_1", 0.83), "UMAP_2 − 0.83·UMAP_1");
  assert.equal(derivedName("UMAP_2", "UMAP_1", -0.5), "UMAP_2 + 0.5·UMAP_1");
  assert.equal(derivedName("b", "a", 1), "b − a");
  const c1 = derivedColumn(y, x, 0.83, nameOf);
  const c2 = derivedColumn({ ...y }, { ...x }, 0.83, nameOf);
  assert.ok(sameExpr(c1, c2));
  assert.ok(!sameExpr(c1, derivedColumn(y, x, 0.84, nameOf)));
  assert.ok(!sameExpr(c1, derivedColumn(x, y, 0.83, nameOf)));
  assert.equal(c1.type, "derived");
  assert.deepEqual(JSON.parse(JSON.stringify(c1)), c1, "plain data: a session, a panel set and a link carry it");
});

test("numbers in names have no exponent", () => {
  assert.equal(numberText(0.00000123456789), "0.00000123457");
  assert.equal(numberText(12345.6789), "12345.7");
  assert.equal(round(-0), 0);
});

test("derived values are y - m*x, and null where a value is missing", () => {
  assert.deepEqual(derivedValues([4, 6, null, NaN, 5], [1, 2, 3, 4, null], 2), [2, 2, null, null, null]);
});

test("a condition joins the filter through an outer AND", () => {
  const a = numberCriterion("A", "k_a", ">=", 1);
  const b = numberCriterion("B", "k_b", "<=", 2);
  const c = numberCriterion("C", "k_c", ">=", 3);
  assert.deepEqual(addCriterion(undefined, a), { criteria: [a], logic: "AND" }, "the first condition");
  assert.deepEqual(addCriterion({ criteria: [], logic: "OR" }, a), { criteria: [a], logic: "AND" });
  assert.deepEqual(addCriterion({ criteria: [a], logic: "AND" }, b), { criteria: [a, b], logic: "AND" }, "extends an AND");
  assert.deepEqual(addCriterion({ criteria: [a], logic: "OR" }, b), { criteria: [a, b], logic: "AND" },
    "one condition: its logic means nothing");
  const wrapped = addCriterion({ criteria: [a, b], logic: "OR" }, c);
  assert.deepEqual(wrapped, { criteria: [{ criteria: [a, b], logic: "OR" }, c], logic: "AND" }, "wraps an OR");
  assert.deepEqual(addCriterion({ criteria: [a, b], logic: "AND" }, a), { criteria: [a, b], logic: "AND" },
    "the same condition is not added twice");
});

test("the group depth of a filter", () => {
  const a = numberCriterion("A", "k_a", ">=", 1);
  assert.equal(configDepth(undefined), 1);
  assert.equal(configDepth({ criteria: [a], logic: "AND" }), 1);
  assert.equal(configDepth({ criteria: [{ criteria: [a], logic: "OR" }, a], logic: "AND" }), 2);
  const inner = addCriterion({ criteria: [{ criteria: [a, a], logic: "AND" }, a], logic: "OR" },
    numberCriterion("B", "k_b", "<=", 2));
  assert.equal(configDepth(inner), 3);
});

test("plots that cannot take a line say why", () => {
  const ok = { drawn: true, is3d: false, isLarge: false, xType: "linear", yType: "linear", xSource: "obsm", ySource: "obsm",
    tableSources: ["obs", "obsm", "obsp", "layer"], xLabel: "UMAP_1", yLabel: "UMAP_2" };
  assert.equal(plotRefusal(ok), null);
  assert.match(plotRefusal({ ...ok, yType: "category", yLabel: "cell_type" }), /y axis \(cell_type\) is not numeric/);
  assert.match(plotRefusal({ ...ok, xType: "log" }), /logarithmic/);
  assert.match(plotRefusal({ ...ok, xType: "date" }), /not numeric/);
  assert.match(plotRefusal({ ...ok, is3d: true }), /3D/);
  assert.match(plotRefusal({ ...ok, drawn: false }), /not drawn/);
  assert.match(plotRefusal({ ...ok, isLarge: true }), /large-plot mode/);
  assert.match(plotRefusal({ ...ok, ySource: "var" }), /not something this table has columns of/);
});

test("a snapped end is pulled back inside the plot area, keeping its direction", () => {
  const p1 = { x: 350, y: 150 };
  const end = snap45(p1, { x: 450, y: 160 });
  assert.ok(end.x > W, "snapped it is out of the area");
  const fit = fitInside(p1, end, W, H);
  assert.equal(fit.x, W);
  assert.equal(fit.y, 150, "still horizontal");
  const diag = fitInside({ x: 380, y: 280 }, { x: 480, y: 380 }, W, H);
  assert.equal(diag.x, 400);
  assert.equal(diag.y, 300);
  assert.deepEqual(fitInside(p1, { x: 300, y: 100 }, W, H), { x: 300, y: 100 }, "inside stays");
});

test("what the tool does over a plot: apply, say nothing, or warn", () => {
  const ok = { drawn: true, is3d: false, isLarge: false, xType: "linear", yType: "linear", xSource: "obsm", ySource: "obsm",
    tableSources: ["obs", "obsm", "obsp", "layer"], xLabel: "UMAP_1", yLabel: "UMAP_2" };
  assert.deepEqual(plotMode(ok), { mode: "ok", why: null });
  // 3D has no x/y axis in the layout (drawn is false there): still "none", and never "not drawn"
  assert.deepEqual(plotMode({ ...ok, is3d: true, drawn: false }), { mode: "none", why: null });
  assert.match(plotRefusal({ ...ok, is3d: true, drawn: false }), /3D/);
  assert.equal(plotMode({ ...ok, isLarge: true }).mode, "none");
  assert.equal(plotMode({ ...ok, drawn: false }).mode, "none");
  const w = plotMode({ ...ok, xType: "category", xLabel: "cell_type" });
  assert.equal(w.mode, "warn");
  assert.match(w.why, /^This plot's x axis \(cell_type\) is not numeric/);
});
