// The fonts of the plots (utils/fonts.js): Open Sans the default, one list on every plot, Arial kept for plots saved before.
import { test } from "node:test";
import assert from "node:assert/strict";

const F = await import("../../../static/js/utils/fonts.js");
const S = await import("../../../static/js/panels/plot-utilities/options-schema.js");
const PO = await import("../../../static/js/panels/plot-utilities/plot-options.js");
await import("../../../static/js/panels/plot-utilities/aesthetics-kinds.js");

const KINDS = ["cell-gene", "cell-count", "cell-plot", "gene-plot"];
const fontField = (kind) => S.fieldOf(kind, "fontFamily");

test("Open Sans is the default of every plot and every plot offers the same list in the same order", () => {
  for (const kind of KINDS) {
    const f = fontField(kind);
    assert.equal(S.defaultOf(f, kind), F.DEFAULT_FONT, kind);
    assert.deepEqual(f.choices, F.FONT_CHOICES, kind);
  }
  assert.equal(F.FONT_CHOICES[0][1], "Open Sans");
  assert.ok(F.FONT_CHOICES.some(([v, l]) => l === "Arial" && v === F.ARIAL), "Arial stays in the list");
});

test("the Publication preset sets Arial on every plot", () => {
  for (const kind of ["cell-gene", "cell-count"]) {
    const next = S.applyPreset({}, "publication", kind);
    assert.equal(S.readField(next, fontField(kind), kind), F.ARIAL, kind);
  }
  assert.equal(PO.PUBLICATION_FONT, F.ARIAL);
});

test("a plot with no stored font that is not on Default is a plot saved with Arial as the default", () => {
  assert.equal(F.legacyFont({ x: 1 }).fontFamily, F.ARIAL);
  assert.equal(F.legacyFont({ fontFamily: F.DEFAULT_FONT }).fontFamily, F.DEFAULT_FONT, "a stored font stays");
  assert.equal(F.legacyFont({ styleDefault: true }).fontFamily, undefined, "from the chooser (on Default): the default");
  });

test("a Cell-Gene Plot is old until fontModel says it was saved with Open Sans the default", () => {
  const old = F.legacyFont({ version: 1, look: { fontSize: 14 } }, true);
  assert.equal(old.look.fontFamily, F.ARIAL);
  assert.equal(old.fontModel, F.FONT_MODEL);
  const again = F.legacyFont({ ...old, look: { fontSize: 14 } }, true);       // the Open Sans choice is stored as absent: not old
  assert.equal(again.look.fontFamily, undefined);
  const fresh = F.legacyFont({ styleDefault: true }, true);
  assert.equal(fresh.fontModel, F.FONT_MODEL);
  assert.equal(fresh.look, undefined);
});
