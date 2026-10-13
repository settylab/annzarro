// The admin API client (static/js/admin/admin-api.js): the CSRF header and JSON
// on unsafe calls, the re-authentication retry, the login redirect, the 429
// notice, and the error mapping.
// Run: `node --test annzarro/tests/js/admin-api.test.mjs`.
import assert from "node:assert/strict";
import test from "node:test";
import {
  AdminError, CSRF_HEADER, createAdminApi, mapError, readCsrfToken,
} from "../../../static/js/admin/admin-api.js";
import { reply } from "./fake-dom.mjs";

// An api over a scripted fetch: `answers` is consumed one per call.
function harness({ answers, csrf = "tok123", root = "", requestReauth, onSlowDown } = {}) {
  const calls = [];
  const queue = [...answers];
  const navigations = [];
  const api = createAdminApi({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (!next) throw new Error(`unscripted call to ${url}`);
      if (next instanceof Error) throw next;
      return next;
    },
    root, csrf, requestReauth, onSlowDown,
    navigate: (u) => navigations.push(u),
    location: { href: "https://h.example/admin#users", origin: "https://h.example" },
  });
  return { api, calls, navigations };
}

test("a GET sends no CSRF header or body and is not cached", async () => {
  const { api, calls } = harness({ answers: [reply(200, [{ username: "alice" }])] });
  assert.deepEqual(await api.users.list(), [{ username: "alice" }]);
  const { url, init } = calls[0];
  assert.equal(url, "/api/v1/admin/users");
  assert.equal(init.method, "GET");
  assert.equal(init.headers[CSRF_HEADER], undefined);
  assert.equal(init.headers["Content-Type"], undefined);
  assert.equal(init.body, undefined);
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.cache, "no-store");
});

test("every unsafe method carries the token and a JSON body", async () => {
  const { api, calls } = harness({ answers: Array.from({ length: 5 }, () => reply(200, {})) });
  await api.users.add({ username: "carol", generate: true });
  await api.policy.set({ "panel.gene-set.enabled": false });
  await api.users.remove("bob", { reassign_to: "alice" });
  await api.dataRoots.add("/srv/atlases/lab2");
  await api.health.clearCache();
  const methods = calls.map((c) => c.init.method);
  assert.deepEqual(methods, ["POST", "PUT", "DELETE", "POST", "POST"]);
  for (const { init } of calls) {
    assert.equal(init.headers[CSRF_HEADER], "tok123");
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.doesNotThrow(() => JSON.parse(init.body));
  }
  assert.deepEqual(JSON.parse(calls[0].init.body), { username: "carol", generate: true });
  // no body given: still a JSON object, so the server's JSON check passes
  assert.equal(calls[4].init.body, "{}");
});

test("the token may be a getter, so a rotated token is used", async () => {
  let token = "one";
  const calls = [];
  const api = createAdminApi({
    fetchImpl: async (u, init) => { calls.push(init); return reply(200, {}); },
    root: "", csrf: () => token,
  });
  await api.users.unlock("bob");
  token = "two";
  await api.users.unlock("bob");
  assert.deepEqual(calls.map((c) => c.headers[CSRF_HEADER]), ["one", "two"]);
});

test("an unsafe call without a token fails before any request", async () => {
  const { api, calls } = harness({ answers: [], csrf: "" });
  await assert.rejects(api.users.unlock("bob"), (e) => e instanceof AdminError && e.reason === "csrf_missing");
  assert.equal(calls.length, 0);
  // reads still work without one
  const h2 = harness({ answers: [reply(200, [])], csrf: "" });
  await h2.api.users.list();
});

test("paths are built under the mount point and names are escaped", async () => {
  const { api, calls } = harness({ answers: [reply(200, {}), reply(200, {}), reply(200, {})], root: "/explore" });
  await api.users.setAdmin("a/b c", true);
  await api.panelSets.list({ owner: "bob", offset: 0, limit: 100, empty: "" });
  await api.adminFetch("/api/v1/auth/me");
  assert.equal(calls[0].url, "/explore/api/v1/admin/users/a%2Fb%20c/admin");
  assert.deepEqual(JSON.parse(calls[0].init.body), { is_admin: true });
  assert.equal(calls[1].url, "/explore/api/v1/admin/panel-sets?owner=bob&offset=0&limit=100");
  assert.equal(calls[2].url, "/explore/api/v1/auth/me");
});

test("reauth_required opens the modal once and retries the same request", async () => {
  const asked = [];
  const { api, calls } = harness({
    answers: [
      reply(403, { error: "Re-authentication required", reason: "reauth_required", reauth_url: "/admin#reauth" }),
      reply(200, { removed: "bob" }),
    ],
    requestReauth: async (info) => { asked.push(info); },
  });
  assert.deepEqual(await api.users.remove("bob", { reassign_to: "alice" }), { removed: "bob" });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].reauth_url, "/admin#reauth");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, calls[0].url);
  assert.equal(calls[1].init.method, "DELETE");
  assert.equal(calls[1].init.body, calls[0].init.body);
});

test("a second reauth_required after the retry is an error, not a loop", async () => {
  const again = reply(403, { reason: "reauth_required" });
  const { api, calls } = harness({ answers: [again, reply(403, { reason: "reauth_required" })], requestReauth: async () => {} });
  await assert.rejects(api.users.unlock("bob"), (e) => e.reason === "reauth_required" && e.status === 403);
  assert.equal(calls.length, 2);
});

test("cancelling the modal ends the call with reauth_cancelled", async () => {
  const { api, calls } = harness({
    answers: [reply(403, { reason: "reauth_required" })],
    requestReauth: async () => { throw new Error("cancelled"); },
  });
  await assert.rejects(api.users.unlock("bob"), (e) => e instanceof AdminError && e.reason === "reauth_cancelled");
  assert.equal(calls.length, 1);
});

test("calls that hit the lapsed window together share one modal", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let opened = 0;
  const lapsed = () => reply(403, { reason: "reauth_required" });
  const { api, calls } = harness({
    answers: [lapsed(), lapsed(), reply(200, { a: 1 }), reply(200, { b: 2 })],
    requestReauth: async () => { opened += 1; await gate; },
  });
  const both = Promise.all([api.users.unlock("a"), api.users.unlock("b")]);
  await new Promise((r) => setImmediate(r));
  release();
  const results = await both;
  assert.equal(opened, 1);
  assert.equal(calls.length, 4);
  assert.equal(results.length, 2);
});

test("the reauth call itself never opens the modal, and a bad password is a plain error", async () => {
  let opened = 0;
  const { api, calls } = harness({
    answers: [reply(401, { error: "Wrong password", reason: "bad_password" }), reply(200, { reauth_until: "2026-10-11T10:00:00+00:00" })],
    requestReauth: async () => { opened += 1; },
  });
  await assert.rejects(api.reauth("nope"), (e) => e.reason === "bad_password" && e.status === 401);
  assert.deepEqual(await api.reauth("right"), { reauth_until: "2026-10-11T10:00:00+00:00" });
  assert.equal(opened, 0);
  assert.equal(calls[0].url, "/api/v1/admin/reauth");
  assert.deepEqual(JSON.parse(calls[0].init.body), { password: "nope" });
  assert.equal(calls[0].init.headers[CSRF_HEADER], "tok123");
});

test("login_required goes to the login page, once, and does not open the modal", async () => {
  let opened = 0;
  const { api, navigations } = harness({
    answers: [reply(401, { reason: "login_required" }), reply(401, { reason: "login_required" })],
    requestReauth: async () => { opened += 1; },
  });
  await assert.rejects(api.users.list(), (e) => e.status === 401 && e.reason === "login_required");
  await assert.rejects(api.audit.list());
  assert.deepEqual(navigations, ["/login?next=%2Fadmin#users"]);
  assert.equal(opened, 0);
});

test("429 tells the page to slow down and carries Retry-After", async () => {
  const waits = [];
  const { api } = harness({
    answers: [reply(429, { error: "Slow down", reason: "admin_rate_limited" }, { "Retry-After": "7" })],
    onSlowDown: (w) => waits.push(w),
  });
  await assert.rejects(api.users.list(), (e) => e.reason === "admin_rate_limited" && e.retryAfter === 7);
  assert.deepEqual(waits, [7]);
});

test("error mapping: the server's sentence wins, the table fills in, statuses are the fallback", () => {
  assert.equal(mapError(409, { error: "Bob is the last admin", reason: "last_admin" }).message, "Bob is the last admin");
  assert.match(mapError(409, { reason: "last_admin" }).message, /without an administrator/);
  assert.match(mapError(403, { reason: "csrf_failed" }).message, /Reload/);
  assert.match(mapError(403, {}).message, /administrators/);
  assert.match(mapError(404, null).message, /Not found/);
  assert.match(mapError(500, null).message, /server had a problem/);
  assert.match(mapError(418, null).message, /HTTP 418/);
  const e = mapError(400, { errors: { "limits.x": "out_of_range" }, reason: "invalid" });
  assert.deepEqual(e.fieldErrors, { "limits.x": "out_of_range" });
  assert.equal(mapError(502, null).reason, "http_502");
  assert.deepEqual(mapError(500, null).fieldErrors, {});
});

test("a dropped connection and an HTML error page become readable errors", async () => {
  const net = harness({ answers: [new Error("Failed to fetch")] });
  await assert.rejects(net.api.users.list(), (e) => e.reason === "network" && e.status === 0);
  const html = { status: 502, ok: false, headers: { get: () => null }, text: async () => "<html>Bad gateway</html>" };
  const proxy = harness({ answers: [html] });
  await assert.rejects(proxy.api.users.list(), (e) => e.status === 502 && e.reason === "http_502");
});

test("an empty 2xx body is null", async () => {
  const { api } = harness({ answers: [reply(204, undefined)] });
  assert.equal(await api.users.unlock("bob"), null);
});

test("the CSRF token is read from the page's meta tag", () => {
  const doc = (content) => ({
    querySelector: (s) => (s === 'meta[name="annzarro-csrf"]' && content !== null ? { getAttribute: () => content } : null),
  });
  assert.equal(readCsrfToken(doc("abc")), "abc");
  assert.equal(readCsrfToken(doc("")), "");
  assert.equal(readCsrfToken(doc(null)), "");
});
