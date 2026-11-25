// V1b (aggregation-unify-080.md 15): the Count Plot's statistics come from the shared table, its shares are fractions (0 to 1),
// and its threshold follows the grouping's Expressed above.
import { test } from "node:test";
import assert from "node:assert/strict";

const M = await import("../../../static/js/utils/count-plot-model.js");
const K = await import("../../../static/js/panels/cell-count/controls-model.js");
const { VOCABULARY } = await import("../../../static/js/utils/vocabulary.js");
const { STATISTIC_INFO } = await import("../../../static/js/utils/group-statistics.js");
const { STAT_SYMBOLS } = await import("../../../static/js/utils/aggregation-symbols.js");

const obs = (key) => ({ source: { type: "obs", key } });
const norm = (config) => M.normalizeCountPlot({ version: 1, ...config });
const gene = { type: "layer", key: "X", column: "Mrpl15" };

const strings = (v, out = []) => {
  if (typeof v === "string") out.push(v);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
};

test("no word of the Count Plot says Share, or has a % but \"% of total\"", () => {
  const said = strings(VOCABULARY.countPlot);
  // a function's output too: the titles a value axis takes
  const C = VOCABULARY.countPlot;
  const made = [C.share("all", {}), C.share("x", { x: "X" }), C.share("split", { split: "S" }), C.share("row", { y: "Y" }),
    ...M.MEASURE_STATS.map((s) => C.measure(s, "Gene · X", 0)), ...strings(VOCABULARY.countSets || {})];
  const bad = [...said, ...made].filter((t) => /\bshare\b/i.test(t) && !/(frequent)/i.test(t));
  assert.deepEqual(bad, []);
  const percent = [...said, ...made].filter((t) => t.includes("%") && !t.includes("% of total"));
  assert.deepEqual(percent, []);
  assert.equal(C.arrangement.fill, "Filled");
  assert.equal(C.share("x", { x: "cell_type" }), "Fraction within each cell_type");
  assert.equal(C.csv.share, "Fraction");
});

test("the measure's statistic menu is the shared table in order with its symbols, z-score mean greyed, then the plot's own two", () => {
  const menu = K.measureStatChoices("mean").options;
  const shared = STATISTIC_INFO.map((s) => s.value);
  assert.deepEqual(menu.slice(0, shared.length).map((o) => o.value), shared);
  assert.deepEqual(menu.slice(0, shared.length).map((o) => o.symbol), shared.map((id) => STAT_SYMBOLS[id]));
  assert.deepEqual(menu.slice(0, shared.length).map((o) => o.name), STATISTIC_INFO.map((s) => s.menu), "the names the Cell-Gene button lists");
  const z = menu.find((o) => o.value === "zscore_mean");
  assert.equal(z.disabled, true);
  assert.match(z.title, /Not available for a Count Plot statistic yet/);
  assert.deepEqual(menu.slice(shared.length).map((o) => o.value), ["fraction_of_total", "zscore"]);
  assert.equal(menu.find((o) => o.value === "zscore").name, "Mean, as z-score against all counted cells");
  assert.equal(menu.find((o) => o.value === "fraction_of_cells").symbol.text, "c⁺");
  // a held statistic read from the old id is the new one
  assert.equal(K.measureStatChoices("pct_above").chosen, "fraction_of_cells");
});

test("pct_above and stat:pct_above are read as fraction_of_cells, and a colour range typed in the old units is dropped", () => {
  const { config, problems } = norm({ mode: "bar", x: obs("cell_type"), value: { kind: "measure" }, measure: { stat: "pct_above", source: gene, above: 1 },
    color: { map: "Viridis", min: 0, max: 80, center: 50 } });
  assert.deepEqual(problems, []);
  assert.equal(config.measure.stat, "fraction_of_cells");
  assert.deepEqual(config.color, { map: "Viridis" }, "the map stays, the range goes");
  const h = norm({ mode: "bar", x: obs("cell_type"), value: { kind: "measure" }, measure: { stat: "mean", source: gene }, view: "3d", height: "stat:pct_above",
    color: { min: 0, max: 100 } }).config;
  assert.equal(h.height, "stat:fraction_of_cells");
  assert.equal(h.color, undefined);
  // a share's range was a fraction already, and a new id keeps its range
  assert.deepEqual(norm({ mode: "bar", x: obs("cell_type"), value: { kind: "share" }, color: { min: 0, max: 0.5 } }).config.color, { min: 0, max: 0.5 });
  assert.deepEqual(norm({ mode: "bar", x: obs("cell_type"), value: { kind: "measure" }, measure: { stat: "fraction_of_cells", source: gene }, color: { min: 0, max: 1 } }).config.color, { min: 0, max: 1 });
});

test("the threshold: the plot's own wins; a gene over a Cell Grouping follows its Expressed above; any other measure or axis keeps the plot's own", () => {
  const groups = { source: { type: "cell-group", key: "cell-grouping-1" } };
  const ctx = { groupingThreshold: (source) => (source.key === "cell-grouping-1" ? 1 : null) };
  const over = (extra) => norm({ mode: "bar", x: groups, value: { kind: "measure" }, measure: { stat: "fraction_of_cells", source: gene, ...extra } }).config;
  assert.deepEqual(M.measureThreshold(over({}), ctx), { value: 1, own: false, grouping: { key: "cell-grouping-1", value: 1 } });
  assert.equal(M.measureThreshold(over({ above: 3 }), ctx).value, 3, "the plot's own overrides");
  assert.equal(M.measureThreshold(over({ above: 3 }), ctx).own, true);
  assert.equal(M.measureThreshold(over({}), { groupingThreshold: () => 0 }).value, undefined, "0 is the server's default: nothing is sent");
  assert.equal(M.measureThreshold(over({}), { groupingThreshold: () => 0 }).grouping.value, 0, "but the box reads auto (grouping: 0)");
  const scoreMeasure = norm({ mode: "bar", x: groups, value: { kind: "measure" }, measure: { stat: "fraction_of_cells", source: { type: "obs", key: "depth" } } }).config;
  assert.equal(M.measureThreshold(scoreMeasure, ctx).value, undefined, "an obs column is not in expression units");
  const obsAxis = norm({ mode: "bar", x: obs("cell_type"), value: { kind: "measure" }, measure: { stat: "fraction_of_cells", source: gene } }).config;
  assert.equal(M.measureThreshold(obsAxis, ctx).value, undefined, "an obs axis has no grouping");
  // the request carries it
  const plan = M.planGrid(over({}), { ...ctx, isNumeric: () => false, levelCount: () => 5 });
  assert.equal(plan.request.measures[0].above, 1);
  const own = M.planGrid(over({ above: 2 }), { ...ctx, isNumeric: () => false, levelCount: () => 5 });
  assert.equal(own.request.measures[0].above, 2);
});

test("a threshold stays only with the statistics that read Expressed above", () => {
  assert.equal(K.usesThreshold("fraction_of_cells"), true);
  assert.equal(K.usesThreshold("pct_above"), true);
  assert.equal(K.usesThreshold("mean_expressing"), true);
  for (const stat of ["mean", "sum", "sd", "fraction_of_total", "zscore"]) assert.equal(K.usesThreshold(stat), false, stat);
});
