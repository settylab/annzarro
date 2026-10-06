// Large-array guard for BUG #2 (the color-scale min/max stack overflow).
//
// `Math.min(...arr)` / `Math.max(...arr)` spread every element as a separate call
// argument; on a ~100k+ cell gene-expression column V8 throws
// "Maximum call stack size exceeded" right before the plot renders. The fix moved
// every color-scale min/max onto the loop-based helpers in
// static/js/utils/array-stats.js. This test pins that the helpers stay
// stack-safe and correct, so the overflow class cannot regress.
//
// Run: `node --test annzarro/tests/js/array-stats.test.mjs` (node >= 18). Also
// driven by the pytest wrapper test_js_suites.py so a single `pytest` run
// covers it.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.resolve(
  __dirname,
  "../../../static/js/utils/array-stats.js"
);

const { arrayMin, arrayMax, arrayMinMax } = await import(
  pathToFileURL(MODULE_PATH).href
);

const BIG = 200_000; // safely past V8's spread/argument limit (~65k-125k)

test("known small array: correct min/max", () => {
  const a = [3, -1, 7, 0, 2.5];
  assert.equal(arrayMin(a), -1);
  assert.equal(arrayMax(a), 7);
  assert.deepEqual(arrayMinMax(a), { min: -1, max: 7 });
});

test("NaN values are skipped", () => {
  const a = [NaN, 4, NaN, -2, NaN];
  assert.equal(arrayMin(a), -2);
  assert.equal(arrayMax(a), 4);
});

test("empty / all-NaN match Math.min()/Math.max() with no args", () => {
  assert.equal(arrayMin([]), Infinity);
  assert.equal(arrayMax([]), -Infinity);
  assert.deepEqual(arrayMinMax([NaN, NaN]), { min: Infinity, max: -Infinity });
});

test("200k-element column does not overflow the stack (BUG #2)", () => {
  const a = new Float64Array(BIG);
  for (let i = 0; i < BIG; i++) a[i] = Math.sin(i) * 1000;
  a[123] = NaN; // realistic: filtered-out value mid-column

  // The whole point: these must NOT throw at this size.
  const mn = arrayMin(a);
  const mx = arrayMax(a);
  const mm = arrayMinMax(a);

  assert.ok(mn >= -1000 && mn <= -999);
  assert.ok(mx <= 1000 && mx >= 999);
  assert.equal(mm.min, mn);
  assert.equal(mm.max, mx);
});

test("the naive spread really does overflow at this size (bug is real)", () => {
  const a = new Float64Array(BIG).fill(1);
  // Documents *why* the helpers exist: the old idiom throws here.
  assert.throws(() => Math.min(...a), RangeError);
});

// --- inferValueType: numerical vs categorical from PRESENT values -----------
test("a mostly-missing numeric column is numerical, not 190 categories", async () => {
  const { inferValueType } = await import(pathToFileURL(MODULE_PATH).href);
  // a rank defined for 190 of 16,285 genes, the rest missing (null from JSON)
  const col = Array.from({ length: 16285 }, (_, i) => (i % 85 === 0 ? i / 85 : null));
  assert.equal(inferValueType(col), "numerical");
  // and when the defined values only start after the first 100 rows
  const late = Array.from({ length: 5000 }, (_, i) => (i > 4000 ? i * 0.5 : NaN));
  assert.equal(inferValueType(late), "numerical");
});

test("labels, booleans and empty columns stay categorical", async () => {
  const { inferValueType } = await import(pathToFileURL(MODULE_PATH).href);
  assert.equal(inferValueType(["HSC", "GMP", null, "HSC"]), "categorical");
  assert.equal(inferValueType([true, false, null, true]), "categorical");
  assert.equal(inferValueType([null, undefined, NaN]), "categorical");
  assert.equal(inferValueType([]), "categorical");
  assert.equal(inferValueType(["1.5", "2", null]), "numerical");
});

// --- log colour scale with a floor -----------------------------------------
test("log colour: floor clamps zeros and negatives, missing stays missing", async () => {
  const { logColorValues, logColorbarTicks } = await import(pathToFileURL(MODULE_PATH).href);
  const { values, floor } = logColorValues([0, 1e-6, 1e-3, -2, NaN, 0.1], 1e-5);
  assert.equal(floor, 1e-5);
  assert.deepEqual(values.map(v => (Number.isNaN(v) ? "NaN" : Math.round(v * 1000) / 1000)), [-5, -5, -3, -5, "NaN", -1]);
  // no floor given: the smallest positive value
  assert.equal(logColorValues([0, 0.004, 0.012]).floor, 0.004);
  // nothing positive: nothing to draw
  assert.equal(logColorValues([0, -1]).floor, null);
  // ticks at whole decades in original units (view A walk row: 1e-6 .. 0.0126)
  assert.deepEqual(logColorbarTicks(-6, -1.9), { tickvals: [-6, -5, -4, -3, -2], ticktext: ["1e-6", "1e-5", "1e-4", "0.001", "0.01"] });
  // inside one decade there are no whole decades: evenly spaced values instead
  // of none (Plotly then labelled the bar in log10 units)
  assert.deepEqual(logColorbarTicks(-2.3, -1.9).ticktext, ["0.006", "0.007", "0.008", "0.009", "0.01"]);
  assert.equal(logColorbarTicks(1, 1), null);
});

test("log colour bar: 1-2-5 ticks over a short range, every n-th decade over a long one", async () => {
  const { logColorbarTicks } = await import(pathToFileURL(MODULE_PATH).href);
  // data 1 .. 82 drew ticks at 1 and 10 only
  const t = logColorbarTicks(0, Math.log10(82));
  assert.deepEqual(t.ticktext, ["1", "2", "5", "10", "20", "50"]);
  t.tickvals.forEach((x, i) => assert.ok(Math.abs(10 ** x - Number(t.ticktext[i])) < 1e-9, t.ticktext[i]));
  // three decades: 1-3-10, at most 8 ticks
  assert.deepEqual(logColorbarTicks(0, 3).ticktext, ["1", "3", "10", "30", "100", "300", "1000"]);
  assert.deepEqual(logColorbarTicks(Math.log10(2e-6), Math.log10(6e-6)).ticktext, ["2e-6", "3e-6", "4e-6", "5e-6", "6e-6"]);
  assert.deepEqual(logColorbarTicks(-30, 82).ticktext, ["1e-20", "1", "1e20", "1e40", "1e60", "1e80"]);
  for (const [a, b] of [[0, 0.01], [-3.2, 7.9], [-12, -11.5], [0.3, 0.46]]) {
    const n = logColorbarTicks(a, b).tickvals.length;
    assert.ok(n >= 3 && n <= 8, `${a}..${b}: ${n} ticks`);
  }
});

test("log colour: Min/Max are data values, drawn in log10", async () => {
  const { colorBoundToData, colorBoundFromData } = await import(pathToFileURL(MODULE_PATH).href);
  assert.equal(colorBoundFromData(82, true, "max").value, Math.log10(82));
  assert.equal(colorBoundToData(Math.log10(82), true), 82);
  assert.equal(colorBoundFromData(82, false, "max").value, 82);
  assert.equal(colorBoundToData(1.5, false), 1.5);
  assert.equal(colorBoundToData(null, true), null);
  // at or below zero: Min starts at the floor, with a note; Max is refused
  const min = colorBoundFromData(0, true, "min", 1e-5);
  assert.equal(min.value, -5);
  assert.match(min.note, /at or below 0.*floor, 0\.00001\./);
  assert.equal(colorBoundFromData(-1, true, "min").value, null, "no floor known: from the data");
  const max = colorBoundFromData(0, true, "max", 1e-5);
  assert.equal(max.value, null);
  assert.match(max.refused, /Max must be above 0/);
});

test("log colour: saved views store data values; older views (log10 under Log) still open", async () => {
  const { storedColorRange, restoreColorRange } = await import(pathToFileURL(MODULE_PATH).href);
  const settings = { color: { type: "obs", key: "n", log: true }, colorMin: 0, colorMax: Math.log10(82) };
  const stored = storedColorRange(settings);
  assert.deepEqual(stored, { colorMin: 1, colorMax: 82, colorRangeUnits: "data" });
  // round trip: what getConfig writes, a new panel reads back as drawn units
  const back = restoreColorRange({ ...settings, ...stored });
  assert.equal(back.colorMin, 0);
  assert.equal(back.colorMax, Math.log10(82));
  assert.ok(!("colorRangeUnits" in back));
  // a link saved before: Min 1, Max 82 under Log meant 10 .. 1e82 and still does
  const old = restoreColorRange({ color: { log: true }, colorMin: 1, colorMax: 82 });
  assert.deepEqual([old.colorMin, old.colorMax], [1, 82]);
  // linear views are the same in either form
  const lin = restoreColorRange({ color: { log: false }, colorMin: -1, colorMax: 3, colorRangeUnits: "data" });
  assert.deepEqual([lin.colorMin, lin.colorMax], [-1, 3]);
  assert.deepEqual(storedColorRange({ color: {}, colorMin: -1, colorMax: 3 }), { colorMin: -1, colorMax: 3, colorRangeUnits: "data" });
  // a stored bound at or below 0 under Log draws from the data's end
  assert.equal(restoreColorRange({ color: { log: true }, colorMin: 0, colorRangeUnits: "data" }).colorMin, null);
});
