import { test } from "node:test";
import assert from "node:assert/strict";

const { safeHref, safeColour, densityLabel, shapeLabel, memberType, columnType, citationText, createInfoLoader } =
  await import("../../../static/js/utils/dataset-info.js");

test("only http, https and mailto addresses become links", () => {
  assert.equal(safeHref("https://example.org/a?b=1"), "https://example.org/a?b=1");
  assert.equal(safeHref("  http://example.org "), "http://example.org");
  assert.equal(safeHref("mailto:a@b.org"), "mailto:a@b.org");
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>", "ftp://x.org", "//x.org", "file:///etc/passwd",
    "https://a b", "vbscript:x", "", null, undefined, "https:/missing"]) {
    assert.equal(safeHref(bad), null, String(bad));
  }
});

test("shapes and types are worded from the metadata", () => {
  assert.equal(shapeLabel([200000, 2]), "200,000 × 2");
  assert.equal(shapeLabel(null), "");
  assert.equal(memberType({ encoding: "array", dtype: "float32" }), "float32");
  assert.equal(memberType({ encoding: "csr_matrix", dtype: "float32" }), "csr_matrix, float32");
  assert.equal(memberType({ encoding: "dataframe", columns: 1 }), "dataframe, 1 column");
  assert.equal(columnType({ kind: "categorical", categories: 8 }), "categorical, 8 categories");
  assert.equal(columnType({ kind: "categorical", categories: 1 }), "categorical, 1 category");
  assert.equal(columnType({ kind: "float", dtype: "float64" }), "float, float64");
  assert.equal(columnType({ kind: "string", dtype: "string" }), "string");
});

test("the citation to copy names the DOI once", () => {
  assert.equal(citationText(null), "");
  assert.equal(citationText({ citation: "Doe 2026.", doi: "10.1/x", doi_url: "https://doi.org/10.1/x" }), "Doe 2026. https://doi.org/10.1/x");
  assert.equal(citationText({ citation: "Doe 2026, doi 10.1/x", doi: "10.1/x", doi_url: "https://doi.org/10.1/x" }), "Doe 2026, doi 10.1/x");
  assert.equal(citationText({ authors: ["A", "B"], title: "T", doi: "10.1/x", doi_url: "https://doi.org/10.1/x" }), "A, B. T. https://doi.org/10.1/x");
  assert.equal(citationText({ title: "T", doi: "not-a-doi" }), "T. doi:not-a-doi");
});

function fake(answers) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const answer = answers.shift();
    return { ok: answer.ok !== false, status: answer.status || 200, json: async () => answer.body };
  };
  return { calls, loader: createInfoLoader({ url: "/api/v1/datasets/info", fetchImpl }) };
}

test("a part is asked for once and shared while it is in flight", async () => {
  const { calls, loader } = fake([{ body: { about: { present: true } } }]);
  const [a, b] = await Promise.all([loader.load("/d/x.zarr", "about"), loader.load("/d/x.zarr", "about")]);
  assert.deepEqual(a, { present: true });
  assert.equal(a, b);
  await loader.load("/d/x.zarr", "about");
  assert.deepEqual(calls, ["/api/v1/datasets/info?path=%2Fd%2Fx.zarr&parts=about"]);
  assert.deepEqual(loader.peek("/d/x.zarr", "about"), { present: true });
});

test("a failure is not kept, so asking again asks again", async () => {
  const { calls, loader } = fake([{ ok: false, status: 422, body: { error: "Cannot read" } }, { body: { readme: { present: false } } }]);
  await assert.rejects(loader.load("p", "readme"), (e) => e.message === "Cannot read" && e.status === 422);
  assert.deepEqual(await loader.load("p", "readme"), { present: false });
  assert.equal(calls.length, 2);
});

test("forget drops one dataset or all", async () => {
  const { calls, loader } = fake([{ body: { about: 1 } }, { body: { about: 2 } }, { body: { about: 3 } }]);
  await loader.load("a", "about");
  await loader.load("b", "about");
  loader.forget("a");
  assert.equal(await loader.load("a", "about"), 3);
  assert.equal(loader.peek("b", "about"), 2);
  loader.forget();
  assert.equal(loader.peek("b", "about"), undefined);
  assert.equal(calls.length, 3);
});

test("a colour is only ever a plain colour", () => {
  for (const ok of ["#fff", "#FF00ffcc", "rgb(1, 2, 3)", "rgba(1,2,3,0.5)", "red", "rebeccapurple"]) assert.equal(safeColour(ok), ok, ok);
  for (const bad of ["red; background:url(x)", "url(http://x)", "var(--x)", "expression(alert(1))", "rgb(1,2,3);", "#ggg", "#12345",
    "calc(1px)", "x".repeat(60), "", null, undefined, "red blue", "\\\"onload=1"]) assert.equal(safeColour(bad), null, String(bad));
});

test("density and the richer types", () => {
  assert.equal(densityLabel(0.25), "25%");
  assert.equal(densityLabel(0.0001234), "0.012%");
  assert.equal(densityLabel(0.00004), "<0.01%");
  assert.equal(densityLabel(0), "0%");
  assert.equal(densityLabel(null), "");
  assert.equal(memberType({ encoding: "csr_matrix", dtype: "float32", nnz: 4, density: 0.25 }), "csr_matrix, float32, 4 stored values (25% dense)");
  assert.equal(memberType({ encoding: "csr_matrix", dtype: "float32", nnz: 1, density: null }), "csr_matrix, float32, 1 stored value");
  assert.equal(memberType({ encoding: "dataframe", columns: 2, column_names: ["u", "v"] }), "dataframe, 2 columns: u, v");
  assert.equal(memberType({ encoding: "dataframe", columns: 60, column_names: ["u"] }), "dataframe, 60 columns: u, …");
  assert.equal(memberType({ encoding: "awkward-array", length: 1200 }), "awkward-array, length 1,200");
  assert.equal(columnType({ kind: "categorical", categories: 3, ordered: true, codes_dtype: "int8" }), "categorical, 3 categories, ordered, codes int8");
  assert.equal(columnType({ kind: "integer", dtype: "int64", nullable: true }), "integer, int64, nullable");
});

const { setName } = await import("../../../static/js/utils/dataset-info-dialog.js");

test("a short dataset name is plain text; a long one keeps its last characters in their own span", () => {
  const made = [];
  const doc = { createElement: () => { const e = { children: [], set textContent(v) { this._t = v; this.children = []; }, get textContent() { return this._t; }, append(...c) { this.children.push(...c); } }; made.push(e); return e; } };
  const node = { ownerDocument: doc, children: [], set textContent(v) { this._t = v; this.children = []; }, get textContent() { return this._t; }, append(...c) { this.children.push(...c); } };
  setName(node, "liver.zarr");
  assert.equal(node.textContent, "liver.zarr");
  assert.equal(node.children.length, 0);
  const long = "projects/liver/2026-10_batch3/bm_aging_liver_hepatocyte_atlas_final_v7_approved_for_sharing.zarr";
  setName(node, long);
  assert.deepEqual(node.children.map((c) => c.className), ["dataset-info-name-head", "dataset-info-name-tail"]);
  assert.equal(node.children[0].textContent + node.children[1].textContent, long);
  assert.equal(node.children[1].textContent.length, 28);
});

const { drawReadme } = await import("../../../static/js/utils/dataset-info.js");
const { MAX_CHARS } = await import("../../../static/js/utils/safe-markdown.js");

test("a README longer than the renderer takes says that it was cut", () => {
  const node = () => ({ children: [], className: "", textContent: "", innerHTML: "", appendChild(c) { this.children.push(c); return c; },
    append(...c) { this.children.push(...c); }, setAttribute() {} });
  const doc = { createElement: node, createTextNode: (t) => ({ textContent: t }) };
  const notes = (readme) => {
    const container = { ...node(), ownerDocument: doc };
    drawReadme(container, readme);
    return container.children.filter((c) => /dsi-truncated/.test(c.className)).map((c) => c.textContent);
  };
  const short = "# Title\n\nshort";
  assert.deepEqual(notes({ present: true, text: short, bytes: short.length, truncated: false }), []);
  const long = "a ".repeat(MAX_CHARS);   // 2 × MAX_CHARS characters, sent whole by the server
  const [note] = notes({ present: true, text: long, bytes: long.length, truncated: false });
  assert.match(note, /^Showing the first 200,000 characters of 391 KB\.$/);
  const [cut] = notes({ present: true, text: "x", bytes: 300 * 1024, limit_bytes: 256 * 1024, truncated: true });
  assert.equal(cut, "Showing the first 256 KB of 300 KB.");
});
