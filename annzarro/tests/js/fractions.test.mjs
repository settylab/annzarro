// V1 (aggregation-unify-080.md 13): the fractions and "% of total" have one vocabulary, 0 to 1 for a fraction, old ids read as new.
import { test } from "node:test";
import assert from "node:assert/strict";

const { VOCABULARY } = await import("../../../static/js/utils/vocabulary.js");
const { STATISTIC_INFO } = await import("../../../static/js/utils/group-statistics.js");
const { METHOD_INFO, normalizeOptions, canonicalMethod } = await import("../../../static/js/utils/signature-options.js");
const { STAT_SYMBOLS, SCORE_SYMBOLS } = await import("../../../static/js/utils/aggregation-symbols.js");
const { statisticColumn, formatFraction } = await import("../../../static/js/utils/cell-gene-model.js");
const { normalizeCellGene } = await import("../../../static/js/panels/cell-gene/sections.js");
const { normalizeGrouping } = await import("../../../static/js/utils/cell-grouping.js");
const { statOf } = await import("../../../static/js/utils/group-stat-model.js");

const strings = (v, out = []) => {
  if (typeof v === "string") out.push(v);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
};

test("no user string says detected or % expressing, and the three shares have exactly their words", () => {
  const words = [...strings(VOCABULARY), ...STATISTIC_INFO.flatMap((s) => [s.label, s.menu, s.definition, s.unit]),
    ...METHOD_INFO.flatMap((m) => [m.label, m.menu, m.definition, m.unit])];
  const bad = words.filter((w) => /detect|% expressing|n\/N/i.test(w));
  assert.deepEqual(bad, []);
  const label = (list, id) => list.find((x) => x.value === id).label;
  assert.equal(label(STATISTIC_INFO, "fraction_of_cells"), "Fraction of cells");
  assert.equal(label(METHOD_INFO, "fraction_of_genes"), "Fraction of genes");
  assert.equal(label(METHOD_INFO, "fraction_of_total"), "% of total");
  assert.equal(STATISTIC_INFO.find((s) => s.value === "fraction_of_cells").unit, "0 to 1");
  assert.equal(METHOD_INFO.find((m) => m.value === "fraction_of_genes").unit, "0 to 1");
  assert.equal(METHOD_INFO.find((m) => m.value === "fraction_of_total").unit, "%");
});

test("Fraction of cells is n_above / n, with no factor", () => {
  // five moments: n, sum, sumsq, n_above, sum_above
  const m = Float64Array.of(8, 20, 90, 3, 15, 4, 0, 0, 0, 0);
  const got = statisticColumn("fraction_of_cells", m, 2);
  assert.equal(got[0], 3 / 8);
  assert.equal(got[1], 0);
});

test("an old link's pct_expressing is read as fraction_of_cells, its style fields in the old units are dropped, nothing is said", () => {
  const { config, problems, notices } = normalizeCellGene({ version: 1, size: { stat: "pct_expressing", layer: "X" }, dotMax: 80, dotMin: 5,
    color: { stat: "mean", layer: "X" }, limits: [0, 3] });
  assert.equal(config.size.stat, "fraction_of_cells");
  assert.ok(!("dotMax" in config) && !("dotMin" in config));
  assert.deepEqual(config.limits, [0, 3], "the colour is not the statistic: its range stays");
  assert.deepEqual(problems, []);
  assert.deepEqual(notices, []);
  const colour = normalizeCellGene({ version: 1, color: { stat: "pct_expressing", layer: "X" }, size: { stat: "mean", layer: "X" }, limits: [0, 80], center: 50, dotMax: 4 }).config;
  assert.equal(colour.color.stat, "fraction_of_cells");
  assert.ok(!("limits" in colour) && !("center" in colour));
  assert.equal(colour.dotMax, 4, "the size is not the statistic: its range stays");
  const height = normalizeCellGene({ version: 1, color: { stat: "mean", layer: "X" }, height: { stat: "pct_expressing", layer: "X" }, heightLimits: [0, 90] }).config;
  assert.ok(!("heightLimits" in height));
  // a link written with the new id keeps its ranges
  const fresh = normalizeCellGene({ version: 1, size: { stat: "fraction_of_cells", layer: "X" }, dotMax: 0.8 }).config;
  assert.equal(fresh.dotMax, 0.8);
});

test("a grouping's offered list and a group-statistic setting read the old id as the new", () => {
  const { recipe } = normalizeGrouping({ version: 1, partitionings: [{ source: { type: "obs", key: "c" } }], offered: ["mean", "pct_expressing"] });
  assert.deepEqual(recipe.offered, ["mean", "fraction_of_cells"]);
  assert.equal(statOf({ stat: "pct_expressing" }), "fraction_of_cells");
});

test("a signature method held as detected is read as fraction_of_genes, in a recipe and in a score setting", () => {
  assert.equal(canonicalMethod("detected"), "fraction_of_genes");
  assert.equal(canonicalMethod("mean"), "mean");
  const o = normalizeOptions({ method: "detected", detect_above: 1 });
  assert.equal(o.method, "fraction_of_genes");
  assert.deepEqual(normalizeOptions({ offered: ["mean", "detected"] }).offered, ["mean", "fraction_of_genes"]);
});

test("formatFraction: two decimals in legends, three in hover, zeros dropped unless kept, 0 and 1 plain, never a % sign", () => {
  assert.equal(formatFraction(0.25), "0.25");
  assert.equal(formatFraction(0.2), "0.2");
  assert.equal(formatFraction(0.342159, 3), "0.342");
  assert.equal(formatFraction(0.5, 3, true), "0.500");
  assert.equal(formatFraction(0), "0");
  assert.equal(formatFraction(1), "1");
  assert.equal(formatFraction(NaN), "");
  assert.ok(![0.01, 0.25, 0.999].some((v) => formatFraction(v).includes("%")));
});

test("a symbol carries a plus exactly when the measure reads Expressed above; no two ids of one table share a symbol", () => {
  for (const [list, symbols] of [[STATISTIC_INFO, STAT_SYMBOLS], [METHOD_INFO, SCORE_SYMBOLS]]) {
    const seen = new Map();
    for (const entry of list) {
      const symbol = symbols[entry.value];
      assert.ok(symbol, `${entry.value} has a symbol`);
      assert.equal(symbol.text.includes("⁺"), entry.needs.includes("detect_above"), `${entry.value}: ${symbol.text}`);
      assert.ok(!seen.has(symbol.text), `${entry.value} and ${seen.get(symbol.text)} share ${symbol.text}`);
      seen.set(symbol.text, entry.value);
    }
  }
  assert.equal(STAT_SYMBOLS.fraction_of_cells.text, "c⁺");
  assert.equal(SCORE_SYMBOLS.fraction_of_genes.text, "g⁺");
});

// ---- the dots look exactly as before: the same data at the old and the new scale draws the same sizes ------------------------

const D = await import("../../../static/js/panels/cell-gene/draw.js");
const { PLOT_PALETTES } = await import("../../../static/js/utils/plot-theme.js");

function figure(scale, { dotMin, dotMax } = {}) {
  const rows = 3, groups = 3;
  const size = Float64Array.from({ length: rows * groups }, (_, i) => scale * ((i % 9) + 1) / 10);
  const colour = Float64Array.from({ length: rows * groups }, (_, i) => i);
  return D.buildFigure({
    mode: "dots", groups: Array.from({ length: groups }, (_, g) => ({ label: `g${g}`, n: 50 })), rows: Array.from({ length: rows }, (_, r) => ({ label: `G${r}` })),
    color: { id: "mean|X", stat: "mean", layer: "X", scaling: "none", values: colour, colorscale: "Viridis" },
    size: { id: "frac|X", stat: "fraction_of_cells", layer: "X", detectAbove: 0, values: size, smallest: 4, largest: 24,
      ...(dotMin !== undefined ? { dotMin, dotMax } : {}) }
  }, PLOT_PALETTES.light);
}
const sizesOf = (fig) => ({
  dots: fig.data.find((t) => t.type === "scatter" && t.name !== "size legend").marker.size,
  legend: fig.data.find((t) => t.name === "size legend").marker.size
});

test("the same data at the old scale (0 to 100, dotMax 100) and at the new (0 to 1, dotMax 1) draws the same dot sizes and legend dots", () => {
  const old = sizesOf(figure(100, { dotMin: 0, dotMax: 100 }));
  const now = sizesOf(figure(1, { dotMin: 0, dotMax: 1 }));
  assert.deepEqual(now.dots, old.dots);
  assert.deepEqual(now.legend, old.legend);
  // and with the default range (the data's own): a dot at the largest value is the largest dot, as before
  const auto = sizesOf(figure(1));
  assert.deepEqual(auto.dots, sizesOf(figure(100)).dots);
  assert.equal(auto.dots.reduce((a, b) => (b > a ? b : a), 0), 24);
});

test("the size legend of a fraction reads 0.2 ... 1 and its title has no unit", () => {
  const fig = figure(1, { dotMin: 0.2, dotMax: 1 });
  const legend = fig.data.find((t) => t.name === "size legend");
  assert.deepEqual(legend.text, ["0.2", "0.4", "0.6", "0.8", "1"]);
  assert.ok(fig.layout.annotations.some((a) => /^Fraction of cells \(> 0\) · X$/.test(a.text)), "title: statistic, threshold, layer");
});

test("the hover of a fraction reads three decimals, never a percent", () => {
  const fig = D.buildFigure({
    mode: "dots", groups: [{ label: "g0", n: 50 }], rows: [{ label: "G0" }],
    color: { id: "mean|X", stat: "mean", layer: "X", scaling: "none", values: Float64Array.of(1), colorscale: "Viridis" },
    size: { id: "frac|X", stat: "fraction_of_cells", layer: "X", detectAbove: 0, values: Float64Array.of(0.342159) }
  }, PLOT_PALETTES.light);
  const text = fig.data.find((t) => t.type === "scatter" && t.name !== "size legend").text[0];
  assert.match(text, /Fraction of cells \(> 0\) · X: 0\.342$/);
  assert.ok(!text.includes("%"));
});
