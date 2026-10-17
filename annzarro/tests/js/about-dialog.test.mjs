import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.document = { querySelector: () => null };
const { aboutText } = await import("../../../static/js/utils/about-dialog.js");

test("a plain AnnZarro page shows no site name", () => {
  assert.deepEqual(aboutText("AnnZarro", "0.5.5"), { version: "0.5.5", site: null });
});

test("a custom app name is kept and trimmed", () => {
  assert.deepEqual(aboutText("  Lab Atlas ", "0.5.5"), { version: "0.5.5", site: "Lab Atlas" });
});

test("no version yet gives an empty line, not 'null'", () => {
  assert.deepEqual(aboutText("AnnZarro", null), { version: "", site: null });
});

const { aboutSectionId, openAboutAt } = await import("../../../static/js/utils/about-dialog.js");

test("a section id is about- plus a lower-case kind, nothing else", () => {
  assert.equal(aboutSectionId("imprint"), "about-imprint");
  for (const bad of ["", null, undefined, "Imprint", "a b", "x\"y", "../x", "a1"]) assert.equal(aboutSectionId(bad), null);
});

function fakeDocument({ shown = false, withSection = true } = {}) {
  const calls = [];
  const summary = { focus: (o) => calls.push(["focus", o]) };
  const section = withSection ? { open: false, scrollIntoView: (o) => calls.push(["scroll", o]), querySelector: (s) => (s === "summary" ? summary : null) } : null;
  const listeners = [];
  const modal = { classList: { contains: (c) => c === "show" && shown }, addEventListener: (type, fn, opts) => listeners.push([type, fn, opts]) };
  const doc = { getElementById: (id) => (id === "about-modal" ? modal : id === "about-imprint" ? section : null) };
  const win = { bootstrap: { Modal: { getOrCreateInstance: () => ({ show: () => calls.push(["show"]) }) } } };
  return { doc, win, calls, section, listeners };
}

test("opening at a section shows the dialog, then expands and focuses the section", () => {
  const { doc, win, calls, section, listeners } = fakeDocument();
  assert.equal(openAboutAt("imprint", doc, win), true);
  assert.deepEqual(calls, [["show"]]);
  assert.equal(listeners[0][0], "shown.bs.modal");
  assert.deepEqual(listeners[0][2], { once: true });
  listeners[0][1]();
  assert.equal(section.open, true);
  assert.deepEqual(calls.slice(1).map((c) => c[0]), ["scroll", "focus"]);
});

test("an open dialog just moves to the section", () => {
  const { doc, win, calls, section } = fakeDocument({ shown: true });
  assert.equal(openAboutAt("imprint", doc, win), true);
  assert.equal(section.open, true);
  assert.ok(!calls.some((c) => c[0] === "show"));
});

test("a kind the dialog has no section for is left to the link", () => {
  const { doc, win } = fakeDocument({ withSection: false });
  assert.equal(openAboutAt("imprint", doc, win), false);
  assert.equal(openAboutAt("../x", doc, win), false);
});
