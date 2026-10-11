// The page's CSRF token (static/js/utils/csrf.js) and the calls that carry it.
// Run: `node --test annzarro/tests/js/csrf.test.mjs`.
import assert from "node:assert/strict";
import test from "node:test";
import { CSRF_HEADER, csrfHeaders, csrfToken } from "../../../static/js/utils/csrf.js";
import { signOut } from "../../../static/js/utils/session-permissions.js";

const page = (token) => ({
  querySelector: (selector) => (selector === 'meta[name="annzarro-csrf"]' && token !== null
    ? { getAttribute: (name) => (name === "content" ? token : null) } : null),
});

test("the token is read from the meta tag", () => {
  assert.equal(csrfToken(page("abc")), "abc");
  assert.equal(CSRF_HEADER, "X-AnnZarro-CSRF");
});

test("login off or a missing tag gives no token and no header", () => {
  assert.equal(csrfToken(page("")), "");
  assert.equal(csrfToken(page(null)), "");
  assert.deepEqual(csrfHeaders({}, page("")), {});
  assert.deepEqual(csrfHeaders({ "Content-Type": "application/json" }, page(null)), { "Content-Type": "application/json" });
});

test("the header is added beside what the call sets, which is left alone", () => {
  const own = { "Content-Type": "application/json" };
  assert.deepEqual(csrfHeaders(own, page("abc")), { "Content-Type": "application/json", "X-AnnZarro-CSRF": "abc" });
  assert.deepEqual(own, { "Content-Type": "application/json" });
  // a multipart upload names no Content-Type, so the browser can set the boundary
  assert.deepEqual(csrfHeaders({}, page("abc")), { "X-AnnZarro-CSRF": "abc" });
});

test("signing out is a POST with the token, then the login page", async () => {
  globalThis.document = page("tok");
  const calls = [];
  const went = [];
  await signOut(async (url, init) => { calls.push({ url, init }); return {}; }, (u) => went.push(u));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["X-AnnZarro-CSRF"], "tok");
  assert.match(calls[0].url, /\/logout$/);
  assert.match(went[0], /\/login$/);
});

test("a failed sign-out request still goes to the login page", async () => {
  globalThis.document = page("tok");
  const went = [];
  await signOut(async () => { throw new Error("offline"); }, (u) => went.push(u));
  assert.equal(went.length, 1);
});
