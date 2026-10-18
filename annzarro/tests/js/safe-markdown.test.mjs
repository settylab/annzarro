import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { renderSafeMarkdown, safeUrl, escapeHtml, MAX_CHARS } = await import("../../../static/js/utils/safe-markdown.js");
const CASES = JSON.parse(readFileSync(new URL("../data/safe_markdown_cases.json", import.meta.url), "utf8"));

const TAG_RE = /<[^>]*>/g;
const ALLOWED_TAG = new RegExp(
  "^</?(p|h[1-6]|ul|ol|li|strong|em|code|br|pre|blockquote|table|thead|tbody|tr)>$|^<hr>$|^</(div|th|td)>$" +
  "|^<div class=\"md-table\">$|^<t[hd]( class=\"md-(left|center|right)\")?>$|^<td class=\"md-more\" colspan=\"\\d+\">$" +
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

const CAP = MAX_CHARS;
const ADVERSARIAL = {
  "**a": "**a".repeat(Math.floor(CAP / 3)), "*a": "*a".repeat(CAP / 2), "_a": "_a".repeat(CAP / 2),
  "*** and x": "***" + "x ".repeat(CAP / 2), "[": "[".repeat(CAP), "[a](": "[a](".repeat(CAP / 4),
  backtick: "`" + "a".repeat(CAP - 1), "stars in one paragraph": "*".repeat(10000),
  "many short lines": Array(CAP / 5).fill("**a b").join("\n"), "bold lines apart": Array(Math.floor(CAP / 6)).fill("**a b").join("\n\n"),
  "emphasis then spaces": "**" + " a".repeat(CAP / 2),
};
for (const [name, text] of Object.entries(ADVERSARIAL)) {
  test(`worst case at the cap is fast: ${name}`, () => {
    const started = performance.now();
    const html = renderSafeMarkdown(text);
    const ms = performance.now() - started;
    console.log(`safe-markdown ${name}: ${ms.toFixed(0)} ms`);
    assert.ok(ms < 1000, `${ms} ms`);
    assertSafe(html);
  });
}

const rep = (body, count) => Array(count).fill(body).join("\n");
const HOSTILE_BLOCKS = {
  "fence with a 100k-line body": "```\n" + rep("x", 100000),
  "closed fence, 100k lines": "```\n" + rep("<b>", 90000) + "\n```",
  "table with 100k rows": "| a | b |\n|---|---|\n" + rep("| 1 | 2 |", 20000),
  "table with 100k columns": "|" + "a|".repeat(50000) + "\n|" + "-|".repeat(50000) + "\n",
  "100k pipes": "|".repeat(CAP),
  "table of long cells": "| a |\n|---|\n" + rep("| " + "*a ".repeat(600) + " |", 100),
  "nested quotes": rep(">".repeat(50) + " x", 3000),
  "100k indented lines": rep("    x", 30000),
  "100k rules": rep("---", 50000),
  "100k fences opening": rep("```", 60000),
  "alternating table headers": rep("a | b\n--- | ---", 30000),
  "100k addresses": "http://a ".repeat(CAP / 9),
  "100k addresses, one per paragraph": "http://a\n\n".repeat(CAP / 10),
  "one huge address": "https://e.org/" + "a".repeat(CAP),
  "addresses glued together": "http://".repeat(Math.floor(CAP / 7)),
  "100k angle autolinks": "<http://a>".repeat(CAP / 10),
  "javascript addresses": "<javascript:alert(1)> javascript:alert(1) ".repeat(Math.floor(CAP / 44)),
  "address with parentheses": "https://e.org/" + "(".repeat(50000) + ")".repeat(50000),
};
for (const [name, text] of Object.entries(HOSTILE_BLOCKS)) {
  test(`hostile block structure is bounded: ${name}`, () => {
    const started = performance.now();
    const html = renderSafeMarkdown(text);
    const ms = performance.now() - started;
    console.log(`safe-markdown ${name}: ${ms.toFixed(0)} ms, ${html.length} bytes`);
    assert.ok(ms < 1000, `${ms} ms`);
    assert.ok(html.length < 12 * CAP);      // an address becomes a link, about ten times its length
    assertSafe(html);
  });
}

test("a long table and a long code block say how much was cut", () => {
  let html = renderSafeMarkdown("| a |\n|---|\n" + rep("| 1 |", 700));
  assert.equal((html.match(/<tr>/g) || []).length, 1 + 500 + 1);
  assert.ok(html.includes("\u2026 200 more rows"));
  html = renderSafeMarkdown("```\n" + rep("x", 2500) + "\n```");
  assert.ok(html.includes("\u2026 500 more lines"));
  assert.equal((html.match(/x\n/g) || []).length, 2000);
  const wide = renderSafeMarkdown("|" + "a|".repeat(40) + "\n|" + "-|".repeat(40) + "\n|" + "1|".repeat(40));
  assert.equal((wide.match(/<th>/g) || []).length, 30);
  assert.equal((wide.match(/<td>/g) || []).length, 30);
});

test("cells cannot carry markup or scripts", () => {
  const html = renderSafeMarkdown("| <b>x</b> |\n|---|\n| <img src=x onerror=alert(1)> [a](javascript:alert(1)) |");
  assert.ok(!html.includes("<b>") && !html.includes("<img") && !html.includes('href="javascript'));
  assertSafe(html);
});

test("no script address is ever linked", () => {
  for (const text of ["javascript:alert(1)", "<javascript:alert(1)>", "<JaVaScRiPt:alert(1)>", "data:text/html,x", "vbscript:x",
    "http://x.org\"><script>alert(1)</script>", "file:///etc/passwd", "ftp://x.org"]) {
    const html = renderSafeMarkdown(text);
    assert.ok(!/href="(?!https?:\/\/|mailto:)/.test(html), html);
    assert.ok(!html.includes("<script"));
  }
});
