// Guard for the frontend's URLs under a reverse-proxy path prefix (#18,
// static/js/utils/app-url.js).
//
// The server renders its mount point into <meta name="annzarro-root"> ("" at
// the root, "/explore" under a prefix). Pinned here:
//
//   * the root is normalised, and anything but a plain absolute path (another
//     host, a protocol-relative URL) falls back to the root;
//   * every API endpoint in Config.API, the typeahead names endpoint included,
//     and the logout link are built under the prefix.
//
// Run: `node --test annzarro/tests/js/app-url.test.mjs`. Also driven by the
// pytest wrapper test_js_panels.py.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JS = path.resolve(__dirname, "../../../static/js");

function fakeDocument(root) {
  return {
    querySelector(selector) {
      if (root === null || selector !== 'meta[name="annzarro-root"]') return null;
      return { getAttribute: (name) => (name === "content" ? root : null) };
    },
  };
}

// config.js reads the mount point once, when it loads
globalThis.document = fakeDocument("/explore");

const { normalizeRoot, appRoot, appUrl } = await import(
  pathToFileURL(path.join(JS, "utils/app-url.js")).href
);
const { Config } = await import(pathToFileURL(path.join(JS, "config.js")).href);
const { authIndicator } = await import(
  pathToFileURL(path.join(JS, "utils/session-permissions.js")).href
);

test("the mount point is normalised", () => {
  assert.equal(normalizeRoot(""), "");
  assert.equal(normalizeRoot("/"), "");
  assert.equal(normalizeRoot(undefined), "");
  assert.equal(normalizeRoot("/explore"), "/explore");
  assert.equal(normalizeRoot("/explore/"), "/explore");
  assert.equal(normalizeRoot("/lab/annzarro"), "/lab/annzarro");
});

test("a mount point that is not a plain path falls back to the root", () => {
  for (const bad of ["//evil.example", "https://evil.example/x", "explore", "/a b", "/a?x", "/a#b", "/a\\b"]) {
    assert.equal(normalizeRoot(bad), "", bad);
  }
});

test("appRoot reads the meta tag, and is the root without one", () => {
  assert.equal(appRoot(fakeDocument("/explore")), "/explore");
  assert.equal(appRoot(fakeDocument("")), "");
  assert.equal(appRoot(fakeDocument(null)), "");
  assert.equal(appRoot({}), "");
});

test("appUrl puts a path under the mount point", () => {
  assert.equal(appUrl("/api/v1/config", "/explore"), "/explore/api/v1/config");
  assert.equal(appUrl("/api/v1/config", ""), "/api/v1/config");
  assert.equal(appUrl("logout", "/explore/"), "/explore/logout");
  assert.equal(appUrl("/logout"), "/explore/logout");
});

test("every API endpoint is under the prefix, the names typeahead included", () => {
  const entries = Object.entries(Config.API);
  assert.ok(entries.length > 10);
  for (const [name, url] of entries) {
    assert.ok(url.startsWith("/explore/api/v1/"), `${name}: ${url}`);
  }
  assert.equal(Config.API.NAMES, "/explore/api/v1/data/names");
});

test("the logout link is under the prefix", () => {
  const badge = authIndicator({ auth_enabled: true, username: "alice" });
  assert.equal(badge.href, "/explore/logout");
});
