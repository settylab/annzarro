import { test } from "node:test";
import assert from "node:assert/strict";

const { createMatcher, highlight, matchesWord, MAX_PATTERN, MAX_TEXT } =
  await import("../../../static/js/utils/structure-search.js");

test("a plain query is a case-insensitive substring and its characters are literal", () => {
  const m = createMatcher("cell");
  assert.deepEqual(m.find("Cell type, cell_id"), [[0, 4], [11, 15]]);
  assert.deepEqual(createMatcher("a.c").find("abc a.c"), [[4, 7]]);
  assert.deepEqual(createMatcher("(x").find("f(x)"), [[1, 3]]);
  assert.equal(createMatcher("").empty, true);
});

test("case matching is a switch", () => {
  assert.deepEqual(createMatcher("Cell", { matchCase: true }).find("Cell cell"), [[0, 4]]);
  assert.deepEqual(createMatcher("cell", { matchCase: false }).find("Cell cell"), [[0, 4], [5, 9]]);
});

test("regular expressions find ranges, and empty matches are dropped", () => {
  const m = createMatcher("^X_\\w+$", { regex: true });
  assert.deepEqual(m.find("X_umap"), [[0, 6]]);
  assert.deepEqual(m.find("my X_umap"), []);
  assert.deepEqual(createMatcher("z*", { regex: true }).find("abc"), []);
  assert.deepEqual(createMatcher("b|c", { regex: true }).find("abc"), [[1, 2], [2, 3]]);
});

test("an invalid pattern is an error, not a throw", () => {
  for (const bad of ["(", "[a-", "*a", "a{2,1}"]) {
    const m = createMatcher(bad, { regex: true });
    assert.equal(m.ok, false, bad);
    assert.match(m.error, /^Invalid pattern/);
  }
  assert.equal(createMatcher("(", { regex: false }).ok, true);
});

test("a long pattern, a nested repeat and a long text are bounded", () => {
  assert.equal(createMatcher("a".repeat(MAX_PATTERN + 1)).ok, false);
  for (const bad of ["(a+)+$", "(a*)*b", "(\\w+\\s?)+", "(x+){2,}"]) {
    const m = createMatcher(bad, { regex: true });
    assert.equal(m.ok, false, bad);
    assert.match(m.error, /too slow/);
  }
  assert.equal(createMatcher("(ab)+", { regex: true }).ok, true);
  const long = "a".repeat(MAX_TEXT) + "needle";
  assert.deepEqual(createMatcher("needle").find(long), []);
});

test("a search that runs past its budget stops and finds nothing more", () => {
  let t = 0;
  const m = createMatcher("a", {}, { now: () => t, budget: 50 });
  assert.equal(m.find("a").length, 1);
  t = 40;
  assert.equal(m.find("a").length, 1);
  assert.equal(m.timedOut, false);
  t = 51;
  assert.deepEqual(m.find("a"), []);
  assert.equal(m.timedOut, true);
  t = 0;
  assert.deepEqual(m.find("a"), [], "stays stopped");
});

test("matches are worded", () => {
  assert.equal(matchesWord(1), "1 match");
  assert.equal(matchesWord(12), "12 matches");
  assert.equal(matchesWord(1200), "1,200 matches");
});

function textDoc() {
  const mk = (kind, extra) => ({ kind, ...extra });
  const doc = {
    createDocumentFragment: () => ({ kind: "frag", children: [], appendChild(c) { this.children.push(c); } }),
    createTextNode: (text) => mk("text", { text }),
    createElement: (tag) => ({ kind: tag, children: [], className: "", appendChild(c) { this.children.push(c); } }),
  };
  return doc;
}

test("the highlight is text nodes and mark elements, never markup", () => {
  const hostile = "<img src=x onerror=alert(1)>MARK";
  const frag = highlight(textDoc(), hostile, [[0, 4], [28, 32]]);
  assert.deepEqual(frag.children.map((c) => c.kind), ["mark", "text", "mark"]);
  assert.equal(frag.children[0].children[0].text, "<img");
  assert.equal(frag.children[1].text, hostile.slice(4, 28));
  assert.equal(frag.children[2].children[0].text, "MARK");
  assert.deepEqual(highlight(textDoc(), "abc", []).children.map((c) => c.text), ["abc"]);
  assert.deepEqual(highlight(textDoc(), "abc", [[0, 3]]).children.map((c) => c.kind), ["mark"]);
  assert.deepEqual(highlight(textDoc(), "abcd", [[2, 3], [1, 2]]).children.map((c) => c.kind), ["text", "mark", "text"], "overlapping ranges are skipped");
});
