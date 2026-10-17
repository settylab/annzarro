import { test } from "node:test";
import assert from "node:assert/strict";

const { safeHref, shapeLabel, memberType, columnType, citationText, createInfoLoader } =
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
