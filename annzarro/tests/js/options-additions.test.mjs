// The renderer additions of the pop-over unification (U2): what the schema says about a field beyond its type.
import { test } from "node:test";
import assert from "node:assert/strict";

const S = await import("../../../static/js/panels/plot-utilities/options-schema.js");

const KIND = "unify-test";
const M0 = { l: 80, r: 80, t: 80, b: 60, pad: 4 };
const FIELDS = [
  { id: "legendTitleSize", section: "legend", type: "number", path: "legendTitleSize", label: "Title size", dflt: null, min: 6, max: 40, step: 1,
    placeholder: (c) => (c.fontSize || 12) + 2, stepFrom: true },
  { id: "tickCount", section: "axes", type: "number", path: "tickCount", label: "Ticks", dflt: null, min: 2, max: 30, step: 1, placeholder: "auto", stepFrom: true },
  { id: "showTickMarks", section: "axes", type: "check", path: "showTickMarks", label: "Tick marks", dflt: null, shown: (c) => c.showAxisLabels !== false },
  { id: "showScaleBar", section: "axes", type: "check", path: "showScaleBar", label: "Scale bar", dflt: false,
    disabled: (c) => (c.z ? "The scale bar is for 2D plots." : !c.equalAspect ? "Needs Equal aspect." : "") },
  { id: "flipX", section: "axes", type: "check", path: "flipX", label: "Flip x", dflt: false, copy: false, look: false },
  { id: "legendTitleAlign", section: "legend", type: "select", path: "legendTitleAlign", label: "Title align", dflt: null,
    choices: [[null, "Auto"], ["markers", "Markers"], ["right", "Right"]] },
  { id: "scaleBarSize", section: "axes", type: "range", path: "scaleBarSize", label: "Size", dflt: 1, min: 0.25, max: 4, step: 0.05, percent: true },
  { id: "margins", section: "margins", type: "margins", path: "margins", unlinkedPath: "marginsUnlinked", label: "Margins", dflt: M0, min: 0, max: 200 },
  { id: "pointSize", section: "panel:points", type: "number", path: "pointSize", label: "Point size", dflt: null, element: () => ({}) }
];
S.registerKind(KIND, {
  order: ["presets", "axes", "panel:points", "legend", "margins"], common: false,
  preset: (config, name) => (name === "bare" ? { ...config, bare: true } : { ...config, bare: undefined })
});
S.registerPanelFields(KIND, FIELDS);
const f = (id) => S.fieldOf(KIND, id);

test("an empty number box's placeholder is a value or a function of the configuration", () => {
  assert.equal(S.placeholderOf(f("tickCount"), {}), "auto");
  assert.equal(S.placeholderOf(f("legendTitleSize"), {}), 14);
  assert.equal(S.placeholderOf(f("legendTitleSize"), { fontSize: 20 }), 22);
  assert.equal(S.placeholderOf(f("fontSize") || { id: "x" }, {}), null);
  assert.equal(f("legendTitleSize").stepFrom, true);
});

test("shown is the value a control has while nothing is stored", () => {
  assert.equal(S.shownOf(f("showTickMarks"), { showAxisLabels: false }), false);
  assert.equal(S.shownOf(f("showTickMarks"), {}), true);
  assert.equal(S.readField({}, f("showTickMarks"), KIND), null, "nothing stored reads as the default, null");
  assert.equal(S.shownOf(f("showScaleBar"), {}), undefined, "a field without the rule has none");
});

test("disabled says why, or is empty", () => {
  assert.equal(S.disabledOf(f("showScaleBar"), { z: true }), "The scale bar is for 2D plots.");
  assert.equal(S.disabledOf(f("showScaleBar"), {}), "Needs Equal aspect.");
  assert.equal(S.disabledOf(f("showScaleBar"), { equalAspect: true }), "");
  assert.equal(S.disabledOf(f("tickCount"), {}), "");
});

test("a select's null choice writes absent and reads as the default", () => {
  const c = S.writeField({ legendTitleAlign: "right" }, f("legendTitleAlign"), null, KIND);
  assert.ok(!("legendTitleAlign" in c));
  assert.equal(S.readField(c, f("legendTitleAlign"), KIND), null);
  assert.equal(S.readField({ legendTitleAlign: "markers" }, f("legendTitleAlign"), KIND), "markers");
  assert.equal(S.readField({ legendTitleAlign: "bogus" }, f("legendTitleAlign"), KIND), null);
});

test("a percent range keeps a fraction and shows a whole percent", () => {
  assert.equal(S.toPercent(0.25), 25);
  assert.equal(S.toPercent(1.5), 150);
  assert.equal(S.fromPercent(150), 1.5);
  const c = S.writeField({}, f("scaleBarSize"), S.fromPercent(200), KIND);
  assert.equal(c.scaleBarSize, 2);
  assert.equal(S.writeField(c, f("scaleBarSize"), S.fromPercent(100), KIND).scaleBarSize, undefined, "the default is absent");
});

test("look: false fields are left out of what Reset puts back", () => {
  const ids = S.resettable(S.fieldsOf(KIND)).map((x) => x.id);
  assert.ok(!ids.includes("flipX"));
  assert.ok(ids.includes("tickCount"));
  assert.ok(!S.lookPaths(KIND).includes("flipX"), "and a view is never copied");
});

test("the margins composite reads linked and unlinked, and writes only what differs", () => {
  const m = f("margins");
  assert.deepEqual(S.readMargins({}, m, KIND), { sides: M0, unlinked: false });
  const linked = S.writeMargins({}, m, { sides: { ...M0, t: 20, r: 20, b: 20, l: 20 }, unlinked: false }, KIND);
  assert.deepEqual(linked.margins, { l: 20, r: 20, t: 20, b: 20, pad: 4 });
  assert.ok(!("marginsUnlinked" in linked));
  const un = S.writeMargins(linked, m, { sides: { ...M0, t: 5 }, unlinked: true }, KIND);
  assert.equal(un.marginsUnlinked, true);
  assert.equal(S.readMargins(un, m, KIND).sides.t, 5);
  assert.equal(S.isSet(un, m, KIND), true);
  const back = S.writeMargins(un, m, { sides: M0, unlinked: false }, KIND);
  assert.ok(!("margins" in back) && !("marginsUnlinked" in back), "the defaults are absent again");
  assert.equal(S.isSet(back, m, KIND), false);
  const clamped = S.writeMargins({}, m, { sides: { ...M0, t: 999 }, unlinked: true }, KIND);
  assert.equal(clamped.margins.t, 200);
});

test("a kind's own presets replace the generic values", () => {
  assert.equal(S.hasOwnPresets(KIND), true);
  assert.equal(S.hasOwnPresets("cell-gene"), false);
  assert.equal(S.applyPreset({}, "bare", KIND).bare, true);
  assert.equal(S.applyPreset({ bare: true }, "default", KIND).bare, undefined);
});

test("a field's element and domId are plain keys of the schema", () => {
  assert.equal(typeof f("pointSize").element, "function");
  assert.ok(S.sectionsOf(KIND).some((s) => s.id === "panel:points" && s.fields.length === 1));
});
