// Every request of the page to this server that changes state carries the CSRF token.
//
// The server tests cannot see a call that forgot it: their client adds the token itself
// (tests/conftest.py). So this scans static/js for fetch() calls with an unsafe method that
// neither go through csrfFetch nor pass csrfHeaders(). The admin pages use adminFetch
// (static/js/admin/), which adds the header itself; vendored code is not ours.
// Run: `node --test annzarro/tests/js/csrf-callers.test.mjs`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../static/js");
const SKIP = new Set(["vendor", "admin"]);
const UNSAFE = /method\s*:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/i;

function* sources(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) yield* sources(path.join(dir, entry.name));
    } else if (entry.name.endsWith(".js")) {
      yield path.join(dir, entry.name);
    }
  }
}

// the text of the call that starts at the "(" at `open`
function callText(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

export function unsafeFetchesWithoutToken(text) {
  const found = [];
  for (const match of text.matchAll(/(?<![\w.])fetch\s*\(/g)) {
    const call = callText(text, match.index + match[0].length - 1);
    if (UNSAFE.test(call) && !call.includes("csrfHeaders(")) {
      found.push(text.slice(0, match.index).split("\n").length);
    }
  }
  return found;
}

test("the scan finds an unsafe fetch without the token, and accepts the ones that carry it", () => {
  assert.deepEqual(unsafeFetchesWithoutToken("await fetch(url, { method: 'POST', body })"), [1]);
  assert.deepEqual(unsafeFetchesWithoutToken("x\nfetch(url, {\n method: \"DELETE\" })"), [2]);
  assert.deepEqual(unsafeFetchesWithoutToken("fetch(url, { method: 'POST', headers: csrfHeaders() })"), []);
  assert.deepEqual(unsafeFetchesWithoutToken("csrfFetch(url, { method: 'POST' })"), []);
  assert.deepEqual(unsafeFetchesWithoutToken("fetch(url)"), []);
});

test("no call site in static/js changes state without the token", () => {
  const missing = [];
  for (const file of sources(JS)) {
    for (const line of unsafeFetchesWithoutToken(fs.readFileSync(file, "utf8"))) {
      missing.push(`${path.relative(JS, file)}:${line}`);
    }
  }
  assert.deepEqual(missing, [], "use csrfFetch() from utils/csrf.js for requests to this server");
});
