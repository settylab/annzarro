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
  assert.match(largePlotReason(settings({ z: { type: "obsm", key: "X_umap", column: "2" } }), n), /^3D/);
  assert.match(largePlotReason(settings({ tableFilter: "cell-table-1" }), n), /table filter/);
  assert.match(largePlotReason(settings({ x: { type: "obsp", key: "c", column: "a" } }), n), /x axis from obsp/);
});

test("the panel notice names the mode, the point count and the way out", () => {
  assert.equal(largePlotNotice(95624334),
    "Large-plot mode (95.6M points): hover, click and table filters are off; use a subset for them");
});

// --- the panel's controls above and below the threshold ------------------
const { updateLargePlotControls, largePlotTooltip } = await import(js("panels/plot-utilities/large-plot-controls.js"));

/** A control: just what updateLargePlotControls touches. */
function el(desc) {
  const attrs = {};
  if (desc.title) attrs.title = desc.title;
  const classes = new Set(desc.classes || []);
  return { ...desc, disabled: !!desc.disabled, dataset: {},
    classList: { contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c) },
    getAttribute: k => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = v; },
    removeAttribute: k => { delete attrs[k]; } };
}
function panel() {
  const types = ["obs", "obsm", "obsp", "layer"];
  const select = (axis, extra = []) => el({ tag: "select", cls: "axis-type-select", axis,
    options: [...extra, ...types].map(v => el({ value: v })) });
  const items = [select("x"), select("y"), select("z"), select("color", ["none"]),
    el({ tag: "select", cls: "hover-columns-select", title: "Columns listed in the hover label" }),
    el({ tag: "select", cls: "table-filter-select" }),
    el({ tag: "button", id: "z-axis-toggle-7" }),
    el({ tag: "button", id: "highlight-focused-cell-7", classes: ["btn", "active", "btn-primary"] })];
  const match = (e, sel) => {
    const m = sel.trim().match(/^(\w+)(?:\.([\w-]+))?(?:\[data-axis="(\w+)"\])?(?:\[id\^="([\w-]+)"\])?$/);
    return m && e.tag === m[1] && (!m[2] || e.cls === m[2]) && (!m[3] || e.axis === m[3])
      && (!m[4] || (e.id || "").startsWith(m[4]));
  };
  return { items, querySelectorAll: s => items.filter(e => s.split(",").some(p => match(e, p))) };
}
const opt = (p, axis, v) => p.items.find(e => e.axis === axis).options.find(o => o.value === v);
const byCls = (p, c) => p.items.find(e => e.cls === c);

test("above the threshold: unsupported types, 3D, Hover and table filter off with the tooltip", () => {
  const p = panel();
  updateLargePlotControls(p, true, 5000000);
  const tip = largePlotTooltip(5000000);
  assert.equal(tip, "Not available above 5M points (large-plot mode); turn on a subset to use it");
  for (const axis of ["x", "y", "color"]) {
    assert.equal(opt(p, axis, "obsp").disabled, true, axis);
    assert.equal(opt(p, axis, "obsp").getAttribute("title"), tip);
    for (const v of ["obs", "obsm", "layer"]) assert.equal(opt(p, axis, v).disabled, false, `${axis} ${v}`);
  }
  assert.equal(opt(p, "color", "none").disabled, false);
  for (const c of ["hover-columns-select", "table-filter-select"]) {
    assert.equal(byCls(p, c).disabled, true, c);
    assert.equal(byCls(p, c).getAttribute("title"), tip);
  }
  assert.equal(p.items.find(e => e.axis === "z").disabled, true);
  assert.equal(p.items.find(e => e.id === "z-axis-toggle-7").disabled, true);
  const hl = p.items.find(e => e.id === "highlight-focused-cell-7");
  assert.equal(hl.disabled, true);
  assert.equal(hl.getAttribute("title"), tip);
  // its on/off state is kept; styles.css draws it as off while data-large-off is set
  assert.equal(hl.classList.contains("active"), true);
  assert.equal(hl.dataset.largeOff, "1");
});

test("below the threshold (or a subset on) everything comes back, with its own tooltip", () => {
  const p = panel();
  updateLargePlotControls(p, true, 5000000);
  updateLargePlotControls(p, true, 5000000);            // idempotent
  updateLargePlotControls(p, false, 5000000);
  for (const axis of ["x", "y", "color"]) {
    assert.equal(opt(p, axis, "obsp").disabled, false);
    assert.equal(opt(p, axis, "obsp").getAttribute("title"), null);
  }
  assert.equal(byCls(p, "hover-columns-select").disabled, false);
  assert.equal(byCls(p, "hover-columns-select").getAttribute("title"), "Columns listed in the hover label");
  assert.equal(byCls(p, "table-filter-select").disabled, false);
  assert.equal(p.items.find(e => e.id === "z-axis-toggle-7").disabled, false);
  const hl = p.items.find(e => e.id === "highlight-focused-cell-7");
  assert.equal(hl.disabled, false);
  assert.equal(hl.classList.contains("active"), true, "the highlight comes back as it was");
  assert.equal(hl.dataset.largeOff, undefined);
  assert.equal(hl.getAttribute("title"), null);
});

test("a highlight toggle that was off stays off when the mode ends", () => {
  const p = panel();
  const hl = p.items.find(e => e.id === "highlight-focused-cell-7");
  hl.classList.remove("active");
  updateLargePlotControls(p, true, 100);
  updateLargePlotControls(p, false, 100);
  assert.equal(hl.classList.contains("active"), false);
  assert.equal(hl.disabled, false);
});

test("a control that was already disabled stays disabled when the mode ends", () => {
  const p = panel();
  byCls(p, "table-filter-select").disabled = true;
  updateLargePlotControls(p, true, 100);
  updateLargePlotControls(p, false, 100);
  assert.equal(byCls(p, "table-filter-select").disabled, true);
});

test("unsupported settings above the threshold are refused with the ways out, not drawn", async () => {
  const { largePlotRefusal } = await import(js("panels/plot-utilities/large-plot.js"));
  assert.equal(largePlotRefusal(settings({ color: { type: "obsp", key: "d", column: "c1" } }), 95624334),
    "Colour by an obsp column is not available for 95.6M points: turn on a subset, or choose an obs column or a gene");
  assert.equal(largePlotRefusal(settings({ tableFilter: "cell-table-1" }), 95624334),
    "A table filter is not available for 95.6M points: turn on a subset, or set the table filter to None");
  assert.equal(largePlotRefusal(settings({ z: { type: "obsm", key: "X_umap", column: "2" } }), 6e6),
    "3D is not available for 6M points: turn on a subset, or turn 3D off");
  assert.equal(largePlotRefusal(settings({ x: { type: "obsp", key: "d", column: "c" } }), 6e6),
    "An x axis from obsp is not available for 6M points: turn on a subset, or choose an embedding (obsm), an obs column or a gene");
  assert.equal(largePlotRefusal(settings(), 6e6), null);
});
