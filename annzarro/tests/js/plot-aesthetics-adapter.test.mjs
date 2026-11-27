// The settings adapter of the Cell Plot and Gene Plot (U3): the renderer's next configuration written onto the plot's settings.
import { test } from "node:test";
import assert from "node:assert/strict";

const { createSettingsAdapter } = await import("../../../static/js/panels/plot-utilities/plot-aesthetics-adapter.js");
const { writeField, fieldOf, writeAuto } = await import("../../../static/js/panels/plot-utilities/options-schema.js");
await import("../../../static/js/panels/plot-utilities/aesthetics-kinds.js");

const KIND = "cell-plot";
const init = (s) => { s.fontSize = s.fontSize || 12; s.fontFamily = s.fontFamily || "Arial, Helvetica, sans-serif"; };

function setup(settings = {}) {
  const log = { hooks: [], notes: [], relooks: 0 };
  init(settings);
  const adapter = createSettingsAdapter({
    kind: KIND, settings, initialize: init,
    hooks: { fontSize: () => log.hooks.push("fontSize"), fontFamily: () => log.hooks.push("fontFamily"),
             textColor: () => log.hooks.push("color"), bgColor: () => log.hooks.push("color") },
    relook: () => { log.relooks += 1; },
    notify: (k, v) => log.notes.push([k, v])
  });
  return { settings, adapter, log };
}
const set = (settings, id, v) => writeField(settings, fieldOf(KIND, id), v, KIND);

test("a changed field is written, its hook runs once and its change is notified", () => {
  const { settings, adapter, log } = setup();
  const changed = adapter.commit(set(settings, "fontSize", 18), "font size");
  assert.deepEqual(changed, ["fontSize"]);
  assert.equal(settings.fontSize, 18);
  assert.deepEqual(log.hooks, ["fontSize"]);
  assert.deepEqual(log.notes, [["fontSize", 18]]);
  assert.equal(log.relooks, 0);
});

test("a value at its default is written absent in the next configuration but kept in the settings", () => {
  const { settings, adapter } = setup({ fontSize: 18 });
  adapter.commit(set(settings, "fontSize", 12), "font size");
  assert.equal(settings.fontSize, 12, "the plot has always stored its defaults");
});

test("a colour set is stored and Auto (null) removes it", () => {
  const { settings, adapter, log } = setup();
  adapter.commit(set(settings, "textColor", "#ff0000"), "color");
  assert.equal(settings.textColor, "#ff0000");
  adapter.commit(set(settings, "textColor", null), "color");
  assert.ok(!("textColor" in settings));
  assert.deepEqual(log.hooks, ["color", "color"]);
});

test("nothing changed: no hook, no event", () => {
  const { settings, adapter, log } = setup();
  assert.deepEqual(adapter.commit({ ...settings }, "font size"), []);
  assert.deepEqual(log.hooks.concat(log.notes), []);
});

test("a look change takes the plot off Default; a view change is not asked of the adapter", () => {
  const { settings, adapter } = setup({ styleDefault: true });
  const next = set(settings, "fontSize", 14);
  delete next.styleDefault;                       // what the renderer does for a look field
  adapter.commit(next, "font size");
  assert.equal(settings.styleDefault, false);
});

test("a reset draws the plot from its settings once and says which group", () => {
  const { settings, adapter, log } = setup({ fontSize: 18, textColor: "#ff0000" });
  let next = set(settings, "fontSize", null);
  next = set(next, "textColor", null);
  adapter.commit(next, "reset text");
  assert.equal(settings.fontSize, 12);
  assert.ok(!("textColor" in settings));
  assert.equal(log.relooks, 1);
  assert.deepEqual(log.hooks, []);
  assert.deepEqual(log.notes, [["reset text", null]]);
});

test("the point size writes its value and its Auto switch together, and Auto alone leaves the value to the plot", () => {
  const { settings, adapter, log } = setup({ pointSize: 5.1, autoPointSize: true });
  log.hooks = [];
  const f = fieldOf(KIND, "pointSize");
  // a value set ends Auto
  let next = writeAuto(set(settings, "pointSize", 2.35), f, false);
  adapter.commit(next, "point size");
  assert.equal(settings.pointSize, 2.35);
  assert.equal(settings.autoPointSize, false, "stored as false, as the plot always did");
  // Auto alone: the value stays until the plot's hook works it out
  next = writeAuto(settings, f, true);
  assert.deepEqual(adapter.commit(next, "point size"), ["pointSize"]);
  assert.equal(settings.autoPointSize, true);
  assert.equal(settings.pointSize, 2.35);
});

test("the point size is a scaled field that is neither copied nor reset", () => {
  const f = fieldOf(KIND, "pointSize");
  assert.equal(f.type, "scaled");
  assert.equal(f.look, false);
  assert.equal(f.snap(0.41, { z: null }, true) > 0, true);
  assert.equal(f.snap(1.234567, { z: [1] }, true), 1.2, "3D: two significant digits off the track");
  assert.equal(f.snap(1.234567, { z: [1] }, false), 1.234567, "3D: typed as it is");
});
