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
// driven by the pytest wrapper test_js_array_stats.py so a single `pytest` run
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
