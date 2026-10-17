import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { renderSafeMarkdown, safeUrl, escapeHtml, MAX_CHARS } = await import("../../../static/js/utils/safe-markdown.js");
const CASES = JSON.parse(readFileSync(new URL("../data/safe_markdown_cases.json", import.meta.url), "utf8"));

const TAG_RE = /<[^>]*>/g;
const ALLOWED_TAG = new RegExp(
  "^</?(p|h[1-6]|ul|ol|li|strong|em|code|br)>$" +
  "|^<a href=\"(https?://|mailto:)[^\"<>\\s]*\" rel=\"noopener noreferrer\"( target=\"_blank\")?>$|^</a>$", "i");

function assertSafe(html) {
  for (const tag of html.match(TAG_RE) || []) assert.match(tag, ALLOWED_TAG, `unexpected markup ${tag} in ${html}`);
  const text = html.replace(TAG_RE, "");
  assert.ok(!text.includes("<") && !text.includes(">"), `a bare angle bracket survives in ${html}`);
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|#39;)/.test(html), `an unescaped ampersand in ${html}`);
}

// A fixed pseudo-random sequence, so a failure reproduces
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

for (const c of CASES) {
  test(`shared case: ${c.name}`, () => {
    const options = c.options.heading_base ? { headingBase: c.options.heading_base } : {};
    assert.equal(renderSafeMarkdown(c.markdown, options), c.html);
    assertSafe(c.html);
  });
}

test("unsafe URLs are refused", () => {
  for (const u of ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x", "//evil.example",
    "/relative", "ftp://x.org", "https://", "https:// x", "", "java\tscript:alert(1)", "&#106;avascript:alert(1)",
    "file:///etc/passwd", null, undefined]) {
    assert.equal(safeUrl(u), null, String(u));
  }
});

test("safe URLs pass", () => {
  for (const u of ["https://example.org", "HTTP://EXAMPLE.ORG/a?b=c&d=e#f", "mailto:me@example.org"]) assert.equal(safeUrl(u), u);
});

test("escapeHtml covers the five characters", () => {
  assert.equal(escapeHtml(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
});

test("random hostile text never makes unexpected markup", () => {
  const next = rng(20261017);
  const pick = (a) => a[Math.floor(next() * a.length)];
  const pieces = ["<", ">", "\"", "'", "&", "&lt;", "&#x3c;", "[", "]", "(", ")", "*", "**", "_", "`", "\n", "\n\n", "  ",
    "\\", "#", "- ", "1. ", "javascript:", "https://e.org", "mailto:a@b.c", "<script>", "</script>", "onerror=", "x",
    "a b", "\t", "\x00", "![", "](", "<img src=x onerror=1>", "<a href=\"javascript:1\">", "&#106;", "%3c", "‮"];
  for (let i = 0; i < 3000; i++) {
    let text = "";
    const n = 1 + Math.floor(next() * 40);
    for (let j = 0; j < n; j++) text += pick(pieces);
    assertSafe(renderSafeMarkdown(text, { headingBase: 1 + Math.floor(next() * 6) }));
  }
});

test("heading levels are capped at six", () => {
  assert.ok(renderSafeMarkdown("# a", { headingBase: 9 }).startsWith("<h6>"));
  assert.equal(renderSafeMarkdown("###### a", { headingBase: 3 }), "<h6>a</h6>");
});

test("input is capped", () => {
  assert.ok(renderSafeMarkdown("a".repeat(MAX_CHARS * 3)).length < MAX_CHARS + 100);
  assert.equal(renderSafeMarkdown("abcdef", { maxChars: 3 }), "<p>abc</p>");
});

test("hostile input is bounded in time", () => {
  const texts = ["**a".repeat(60000), "[".repeat(100000), "*".repeat(100000), "_a".repeat(80000), "`".repeat(100000),
    "[a](".repeat(50000), "*a ".repeat(70000), "- ".repeat(60000), "#".repeat(100000), "\\\n".repeat(50000),
    "**" + "a ".repeat(5000) + "*".repeat(50000)];
  for (const text of texts) {
    const started = Date.now();
    assertSafe(renderSafeMarkdown(text));
    assert.ok(Date.now() - started < 3000, "a pattern backtracks without a bound");
  }
});

test("non-strings give nothing", () => {
  for (const v of [null, undefined, 5, [], {}]) assert.equal(renderSafeMarkdown(v), "");
});
