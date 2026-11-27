import { test } from "node:test";
import assert from "node:assert/strict";

const { placePopover, pressInside, nextTabIndex, nextMenuIndex, createRegistry, SHEET_BELOW } =
  await import("../../../static/js/ui/popover.js");

const VP = { width: 1200, height: 800 };
const box = (left, top, w = 80, h = 30) => ({ left, top, right: left + w, bottom: top + h });

test("opens below the anchor, left-aligned, 4 px gap", () => {
  const p = placePopover(box(100, 100), { width: 320, height: 200 }, VP);
  assert.equal(p.side, "below");
  assert.equal(p.left, 100);
  assert.equal(p.top, 134);
  assert.equal(p.width, 320);
});

test("flips above when it does not fit below and there is more room above", () => {
  const p = placePopover(box(100, 700), { width: 320, height: 300 }, VP);
  assert.equal(p.side, "above");
  assert.equal(p.top, 700 - 4 - 300);
});

test("stays below when it does not fit anywhere but below has more room", () => {
  const p = placePopover(box(100, 100), { width: 320, height: 900 }, VP);
  assert.equal(p.side, "below");
  assert.equal(p.maxHeight, Math.floor(Math.min(800 * 0.8, 800 - 8 - 130 - 4)));
});

test("max height is 80% of the viewport and the room on the chosen side", () => {
  assert.equal(placePopover(box(0, 0), { width: 320, height: 2000 }, VP).maxHeight, 640);
  const p = placePopover(box(100, 600), { width: 320, height: 2000 }, VP);
  assert.equal(p.side, "above");
  assert.equal(p.maxHeight, 600 - 4 - 8);
});

test("a flipped surface that scrolls is flush with the anchor", () => {
  const p = placePopover(box(100, 700), { width: 320, height: 2000 }, VP);
  assert.equal(p.top + p.maxHeight, 700 - 4);
});

test("clamps to the right edge with an 8 px margin", () => {
  const p = placePopover(box(1150, 100), { width: 320, height: 100 }, VP);
  assert.equal(p.left, 1200 - 8 - 320);
});

test("clamps to the left edge with an 8 px margin", () => {
  assert.equal(placePopover(box(-50, 100), { width: 320, height: 100 }, VP).left, 8);
});

test("never wider than the viewport minus margins", () => {
  const p = placePopover(box(10, 10), { width: 440, height: 100 }, { width: 500, height: 800 });
  assert.equal(p.width, 440);
  const q = placePopover(box(10, 10), { width: 440, height: 100 }, { width: 480, height: 800 });
  assert.equal(q.width, 440);
});

test("under 480 px it is a full-width sheet", () => {
  const p = placePopover(box(300, 10), { width: 320, height: 100 }, { width: SHEET_BELOW - 1, height: 800 });
  assert.equal(p.sheet, true);
  assert.equal(p.left, 8);
  assert.equal(p.width, SHEET_BELOW - 1 - 16);
  assert.equal(placePopover(box(300, 10), { width: 320, height: 100 }, { width: SHEET_BELOW, height: 800 }).sheet, false);
});

test("an anchor in a tile smaller than the surface does not matter: the viewport bounds it", () => {
  const p = placePopover(box(5, 5, 20, 20), { width: 440, height: 300 }, VP);
  assert.equal(p.left, 8);
  assert.equal(p.side, "below");
});

test("press target decides: a press inside makes the click inside whatever the click's target", () => {
  assert.equal(pressInside(true, false), true);
  assert.equal(pressInside(false, true), false);
});

test("a click with no press (synthetic) falls back to its own target", () => {
  assert.equal(pressInside(null, true), true);
  assert.equal(pressInside(null, false), false);
  assert.equal(pressInside(undefined, false), false);
});

test("Tab wraps from last to first, Shift+Tab from first to last", () => {
  assert.equal(nextTabIndex(2, 3, false), 0);
  assert.equal(nextTabIndex(0, 3, true), 2);
  assert.equal(nextTabIndex(0, 3, false), 1);
  assert.equal(nextTabIndex(1, 3, true), 0);
});

test("Tab from outside the list enters at the first (last for Shift)", () => {
  assert.equal(nextTabIndex(-1, 3, false), 0);
  assert.equal(nextTabIndex(-1, 3, true), 2);
  assert.equal(nextTabIndex(0, 0, false), -1);
});

test("menu arrows wrap; Home and End jump; other keys stay", () => {
  assert.equal(nextMenuIndex(2, 3, "ArrowDown"), 0);
  assert.equal(nextMenuIndex(0, 3, "ArrowUp"), 2);
  assert.equal(nextMenuIndex(-1, 3, "ArrowDown"), 0);
  assert.equal(nextMenuIndex(-1, 3, "ArrowUp"), 2);
  assert.equal(nextMenuIndex(1, 3, "Home"), 0);
  assert.equal(nextMenuIndex(1, 3, "End"), 2);
  assert.equal(nextMenuIndex(1, 3, "a"), 1);
  assert.equal(nextMenuIndex(0, 0, "Home"), -1);
});

test("registry: opening a second closes the first, once", () => {
  const r = createRegistry();
  const log = [];
  assert.equal(r.open("a", () => log.push("a")), null);
  assert.equal(r.current(), "a");
  assert.equal(r.open("b", () => log.push("b")), "a");
  assert.deepEqual(log, ["a"]);
  assert.equal(r.current(), "b");
});

test("registry: closing the open one empties it; closing a stale one does not", () => {
  const r = createRegistry();
  r.open("a", () => {});
  r.open("b", () => {});
  r.closed("a");
  assert.equal(r.current(), "b");
  r.closed("b");
  assert.equal(r.current(), null);
});

test("registry: re-opening the same token closes nothing", () => {
  const r = createRegistry();
  let n = 0;
  r.open("a", () => n++);
  r.open("a", () => n++);
  assert.equal(n, 0);
});
