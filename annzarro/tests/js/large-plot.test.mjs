// When a Cell Plot uses the large-plot mode (static/js/panels/plot-utilities/
// large-plot.js) and what it tells the user. The mode turns hover, click and
// table filters off, so it must only start where the regular path cannot draw
// (default above 5M points, configurable) and must always say so on the panel.
//
// Run: `node --test annzarro/tests/js/large-plot.test.mjs` (node >= 18).
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const js = p => pathToFileURL(path.resolve(__dirname, "../../../static/js", p)).href;
const { largePlotReason, largePlotPoints, largePlotNotice } = await import(js("panels/plot-utilities/large-plot.js"));
const { Config, readUiSettings } = await import(js("config.js"));

const settings = (over = {}) => ({
  x: { type: "obsm", key: "X_umap", column: "0" },
  y: { type: "obsm", key: "X_umap", column: "1" },
  color: { type: "obs", key: "cell_type", column: "" },
  z: null, tableFilter: "none", ...over
});

test("default threshold is 5M points: at 5M the regular path is kept", () => {
  assert.equal(largePlotPoints(), 5000000);
  assert.notEqual(largePlotReason(settings(), 5000000), null);
  assert.equal(largePlotReason(settings(), 5000001), null);
});

test("the threshold follows Config (server ui.defaults.large_plot_points)", () => {
  const saved = Config.DEFAULTS.LARGE_PLOT_POINTS;
  try {
    Config.DEFAULTS.LARGE_PLOT_POINTS = 1000;
    assert.equal(largePlotReason(settings(), 1001), null);
    assert.notEqual(largePlotReason(settings(), 1000), null);
  } finally {
    Config.DEFAULTS.LARGE_PLOT_POINTS = saved;
  }
  assert.equal(readUiSettings({ ui: { defaults: { large_plot_points: 2e7 } } }).largePlotPoints, 2e7);
  assert.equal(readUiSettings({ ui_large_plot_points: 3 }).largePlotPoints, 3);
  assert.equal(readUiSettings({}).largePlotPoints, null);
});

test("settings the mode cannot draw keep the regular path", () => {
  const n = 9e7;
  assert.match(largePlotReason(settings({ z: { type: "obsm", key: "X_umap", column: "2" } }), n), /3D/);
  assert.match(largePlotReason(settings({ tableFilter: "cell-table-1" }), n), /table filter/);
  assert.match(largePlotReason(settings({ x: { type: "obsp", key: "c", column: "a" } }), n), /x from obsp/);
});

test("the panel notice names the mode, the point count and the way out", () => {
  assert.equal(largePlotNotice(95624334),
    "Large-plot mode (95.6M points): hover, click and table filters are off; use a subset for them");
});
