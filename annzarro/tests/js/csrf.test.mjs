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

// --- csrfFetch: one retry with the current token ---------------------------------------

import { csrfFetch, resetRefreshedToken } from "../../../static/js/utils/csrf.js";

const answer = (status, body) => ({
  status, ok: status < 400,
  clone() { return this; },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  json: async () => body,
});
const REFUSED = answer(403, { reason: "csrf_failed", error: "The page is out of date. Reload it and try again." });

// a scripted server: `script(url, init)` answers each call; calls are recorded
function scripted(script) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => { calls.push({ url, init }); return script(url, init, calls); } };
}

test("a refusal as out of date takes the current token and repeats the request once", async () => {
  resetRefreshedToken();
  const { calls, fetchImpl } = scripted((url, init) => {
    if (/auth\/me$/.test(url)) return answer(200, { csrf: "fresh" });
    return init.headers["X-AnnZarro-CSRF"] === "fresh" ? answer(200, { status: "success" }) : REFUSED;
  });
  const reply = await csrfFetch("/api/v1/sessions/save", { method: "POST", body: "{}" }, { fetchImpl, doc: page("stale") });
  assert.equal(reply.status, 200);
  assert.deepEqual(calls.map((c) => c.init?.headers?.["X-AnnZarro-CSRF"]), ["stale", undefined, "fresh"]);
  // later calls start with the fresh token
  const second = await csrfFetch("/api/v1/cache/reset", { method: "POST" }, { fetchImpl, doc: page("stale") });
  assert.equal(second.status, 200);
  assert.equal(calls.at(-1).init.headers["X-AnnZarro-CSRF"], "fresh");
  resetRefreshedToken();
});

test("a second refusal is handed to the caller, whose message says to reload", async () => {
  resetRefreshedToken();
  const { calls, fetchImpl } = scripted((url) => (/auth\/me$/.test(url) ? answer(200, { csrf: "fresh" }) : REFUSED));
  const reply = await csrfFetch("/api/v1/sessions/save", { method: "POST" }, { fetchImpl, doc: page("stale") });
  assert.equal(reply.status, 403);
  assert.equal(calls.filter((c) => !/auth\/me$/.test(c.url)).length, 2, "tried twice, not more");
  assert.match((await reply.json()).error, /Reload it/);
  resetRefreshedToken();
});

test("nothing is repeated when the token is not the problem", async () => {
  resetRefreshedToken();
  // login off: no token was sent, the refusal is about the Origin
  let { calls, fetchImpl } = scripted(() => REFUSED);
  await csrfFetch("/api/v1/cache/reset", { method: "POST" }, { fetchImpl, doc: page("") });
  assert.equal(calls.length, 1);
  // the server has the same token: a repeat would fail the same way
  ({ calls, fetchImpl } = scripted((url) => (/auth\/me$/.test(url) ? answer(200, { csrf: "same" }) : REFUSED)));
  await csrfFetch("/api/v1/cache/reset", { method: "POST" }, { fetchImpl, doc: page("same") });
  assert.equal(calls.length, 2);
  // a 403 for another reason (not an admin), and a login that ended
  ({ calls, fetchImpl } = scripted(() => answer(403, { reason: "admin_only", error: "x" })));
  await csrfFetch("/api/v1/cache/reset", { method: "POST" }, { fetchImpl, doc: page("tok") });
  assert.equal(calls.length, 1);
  ({ calls, fetchImpl } = scripted((url) => (/auth\/me$/.test(url) ? answer(401, {}) : REFUSED)));
  const reply = await csrfFetch("/api/v1/cache/reset", { method: "POST" }, { fetchImpl, doc: page("tok") });
  assert.equal(reply.status, 403);
  assert.equal(calls.length, 2);
  resetRefreshedToken();
});

test("an HTML refusal (logout) is recognised too", async () => {
  resetRefreshedToken();
  const { calls, fetchImpl } = scripted((url, init) => {
    if (/auth\/me$/.test(url)) return answer(200, { csrf: "fresh" });
    return init.headers["X-AnnZarro-CSRF"] === "fresh" ? answer(302, "") : answer(403, "<p>The page is out of date.</p>");
  });
  const reply = await csrfFetch("/logout", { method: "POST" }, { fetchImpl, doc: page("stale") });
  assert.equal(reply.status, 302);
  assert.equal(calls.length, 3);
  resetRefreshedToken();
});
