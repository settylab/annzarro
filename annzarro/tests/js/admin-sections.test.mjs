// The admin page's router, the re-auth modal and the six section stubs,
// rendered from mocked API data (admin-fixtures.json).
// Run: `node --test annzarro/tests/js/admin-sections.test.mjs`.
import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { readFileSync } from "node:fs";
import { find, findAll, installFakeDocument, uninstallFakeDocument } from "./fake-dom.mjs";
import { AdminError, createAdminApi } from "../../../static/js/admin/admin-api.js";
import { createReauthModal } from "../../../static/js/admin/reauth-modal.js";
import { SECTIONS, createRouter, sectionFromHash, showToast } from "../../../static/js/admin/admin-main.js";
import { chainText, detailText } from "../../../static/js/admin/audit.js";
import { cacheText, readersText, refusalText, sumRefusals } from "../../../static/js/admin/health.js";
import { deleteMessage, reassignMessage } from "../../../static/js/admin/panel-sets.js";

const F = JSON.parse(readFileSync(new URL("./admin-fixtures.json", import.meta.url), "utf8"));

// An api whose GETs are served from the fixtures.
function mockApi(overrides = {}) {
  const routes = {
    "/users": F.users, "/data-roots": F.dataRoots, "/health": F.health, "/panel-sets": F.panelSets,
    "/policy": F.policy, "/audit": F.audit, ...overrides,
  };
  const calls = [];
  const api = createAdminApi({
    csrf: "t", root: "",
    fetchImpl: async (url, init) => {
      const path = new URL(url, "http://x").pathname.replace("/api/v1/admin", "");
      calls.push([init.method, path]);
      const body = routes[path];
      const text = JSON.stringify(typeof body === "function" ? body(init) : body);
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => text };
    },
  });
  return { api, calls };
}

// Routers in these tests never start a real interval (it would keep node alive).
const noTimers = { setTimer: () => 0, clearTimer: () => {} };
const makeRouter = (options) => createRouter({ ...noTimers, ...options });

let doc;
beforeEach(() => { doc = installFakeDocument(); });
afterEach(() => { uninstallFakeDocument(); });

const page = () => ({ nav: doc.createElement("ul"), view: doc.createElement("main") });

test("the fragment picks the section, unknown or empty falls back to the first", () => {
  assert.deepEqual(SECTIONS.map((s) => s.id), ["users", "data", "health", "panel-sets", "settings", "audit"]);
  assert.equal(sectionFromHash("#settings"), "settings");
  assert.equal(sectionFromHash("panel-sets"), "panel-sets");
  assert.equal(sectionFromHash("#nope"), "users");
  assert.equal(sectionFromHash(""), "users");
  assert.equal(sectionFromHash(undefined), "users");
});

test("every section module has the registry shape", () => {
  for (const s of SECTIONS) {
    assert.equal(typeof s.id, "string");
    assert.equal(typeof s.title, "string");
    assert.equal(typeof s.mount, "function");
    assert.equal(typeof s.refresh, "function");
  }
});

test("the router builds the tabs, marks the active one and mounts the section", async () => {
  const { nav, view } = page();
  const { api } = mockApi();
  const router = makeRouter({ nav, view, api, ctx: { me: F.me } });
  assert.deepEqual(findAll(nav, (n) => n.tagName === "A").map((a) => a.textContent),
    ["Users", "Data sources", "Server health", "Panel sets", "Settings", "Audit log"]);
  assert.deepEqual(findAll(nav, (n) => n.tagName === "A").map((a) => a.getAttribute("href")),
    ["#users", "#data", "#health", "#panel-sets", "#settings", "#audit"]);
  await router.show("health");
  assert.equal(router.current(), "health");
  const active = findAll(nav, (n) => n.classes().includes("active"));
  assert.equal(active.length, 1);
  assert.equal(active[0].textContent, "Server health");
  assert.equal(active[0].getAttribute("aria-current"), "page");
  assert.match(view.textContent, /Workers/);
  await router.show("users");
  assert.equal(findAll(nav, (n) => n.classes().includes("active"))[0].textContent, "Users");
  assert.doesNotMatch(view.textContent, /Workers/);
  router.stop();
});

test("a section that fails shows the message with a Retry that loads it again", async () => {
  const { nav, view } = page();
  let fail = true;
  const { api } = mockApi({ "/users": () => { if (fail) throw new Error("x"); return F.users; } });
  // a failing fetch surfaces as a network AdminError
  const router = makeRouter({ nav, view, api, ctx: {} });
  await router.show("users");
  const alert = find(view, (n) => n.getAttribute("role") === "alert");
  assert.ok(alert);
  assert.match(alert.textContent, /Could not reach the server/);
  fail = false;
  await find(alert, (n) => n.tagName === "BUTTON").dispatch("click");
  await new Promise((r) => setImmediate(r));
  assert.match(view.textContent, /Users \(3\)/);
});

test("a slow section that was left does not paint over the one that replaced it", async () => {
  const { nav, view } = page();
  let release;
  const slow = new Promise((r) => { release = r; });
  const sections = [
    { id: "a", title: "A", mount: async (el) => { await slow; el.textContent = "A done"; }, refresh() {} },
    { id: "b", title: "B", mount: async (el) => { el.textContent = "B done"; }, refresh() {} },
  ];
  const router = makeRouter({ nav, view, api: {}, sections });
  const first = router.show("a");
  await router.show("b");
  release();
  await first;
  assert.equal(view.textContent, "B done");
});

test("autoRefreshMs sets a timer while the section is shown, skips hidden documents, and stops on leaving", async () => {
  const { nav, view } = page();
  let refreshed = 0;
  const timers = [];
  const cleared = [];
  const sections = [
    { id: "live", title: "Live", autoRefreshMs: 10000, mount: async () => {}, refresh: async () => { refreshed += 1; } },
    { id: "static", title: "Static", mount: async () => {}, refresh() {} },
  ];
  const router = makeRouter({
    nav, view, api: {}, sections,
    setTimer: (fn, ms) => { timers.push([fn, ms]); return timers.length; },
    clearTimer: (id) => cleared.push(id),
  });
  await router.show("live");
  assert.equal(timers.length, 1);
  assert.equal(timers[0][1], 10000);
  await timers[0][0]();
  assert.equal(refreshed, 1);
  doc.hidden = true;
  await timers[0][0]();
  assert.equal(refreshed, 1);
  await router.show("static");
  assert.deepEqual(cleared, [1]);
  assert.equal(timers.length, 1);
});

test("users: one row per user, admin and lock shown, hostile names stay text", async () => {
  const { nav, view } = page();
  const router = makeRouter({ nav, view, api: mockApi().api, ctx: { me: F.me } });
  await router.show("users");
  const rows = findAll(view, (n) => n.tagName === "TR").slice(1);
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent, /alice\(you\)/);
  assert.match(rows[0].textContent, /admin/);
  assert.match(rows[1].textContent, /bob/);
  assert.match(rows[1].textContent, /1 address/);
  assert.match(rows[2].textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(findAll(view, (n) => n.tagName === "IMG").length, 0);
  assert.match(view.textContent, /Users \(3\)/);
});

test("data directories: parents, sources, inactive roots with their reason", async () => {
  const { nav, view } = page();
  const router = makeRouter({ nav, view, api: mockApi().api });
  await router.show("data");
  assert.match(view.textContent, /\/srv\/atlases/);
  assert.match(view.textContent, /\/lab\/shared/);
  const rows = findAll(view, (n) => n.tagName === "TR").slice(1);
  assert.equal(rows.length, 4);
  assert.match(rows[0].textContent, /data_dir.*41/);
  assert.match(rows[2].textContent, /admin3alice, /);
  assert.match(rows[3].textContent, /inactive/);
  assert.match(rows[3].textContent, /outside every allowed parent/);
});

test("data directories with no parents says adding is off", async () => {
  const { nav, view } = page();
  const router = makeRouter({ nav, view, api: mockApi({ "/data-roots": { parents: [], roots: [] } }).api });
  await router.show("data");
  assert.match(view.textContent, /Adding directories is off\. Set server\.admin_data_roots\./);
  assert.match(view.textContent, /Nothing to show/);
});

test("health: workers, a stale badge, refusals summed over workers", async () => {
  const { nav, view } = page();
  const router = makeRouter({ nav, view, api: mockApi().api });
  await router.show("health");
  const rows = findAll(view, (n) => n.tagName === "TR").slice(1);
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /4121.*2 s.*12,031.*410\/1024 MB.*480 MB.*read_busy 3, session_quota_user 1/);
  assert.match(rows[1].textContent, /4122.*stale.*9,870.*idle/);
  assert.match(view.textContent, /Refusals by reason: read_busy 3, outside_data_dir 2, session_quota_user 1/);
  assert.match(view.textContent, /alice \d\d:\d\d \| bob/);
  assert.match(view.textContent, /Top readers now: bob 410 MB \(share 512 MB\)/);
  assert.ok(find(view, (n) => n.id === "admin-cache-clear"), "the Clear cache button is offered");
  assert.deepEqual(sumRefusals(F.health.workers), { read_busy: 3, session_quota_user: 1, outside_data_dir: 2 });
  assert.equal(refusalText({}), "-");
  assert.equal(refusalText({ a: 0 }), "-");
  const bar = find(view, (n) => n.classes().includes("progress-bar"));
  assert.match(bar.getAttribute("style"), /width: 40%/);
});

test("health: cache text names the name indices when they hold memory, readers are ranked over workers", () => {
  assert.equal(cacheText(null), "-");
  assert.equal(cacheText({ memory_mb: 480, name_index_mb: 0.2 }), cacheText({ memory_mb: 480 }));
  assert.match(cacheText({ memory_mb: 480, name_index_mb: 300 }), /480.*\+ .*300.* names/);
  const workers = [
    { read_guard: { share_mb: 512, by_requester: [{ who: "bob", mb: 100 }, { who: "eve", mb: 300 }] } },
    { read_guard: { share_mb: 512, by_requester: [{ who: "amy", mb: 200 }] } },
    { read_guard: null },
  ];
  assert.match(readersText(workers), /^eve .*\| amy .*\| bob /);
  assert.equal(readersText([{ read_guard: { by_requester: [] } }]), "none");
});

test("panel sets: totals, quota bars coloured by use, rows with size and modifier", async () => {
  const { nav, view } = page();
  const router = makeRouter({ nav, view, api: mockApi().api });
  await router.show("panel-sets");
  assert.match(view.textContent, /Panel sets \(1,204\)/);
  assert.match(view.textContent, /Server: 1,204 \/ 5,000 sets, 88 \/ 256 MB/);
  const bars = findAll(view, (n) => n.classes().includes("progress-bar"));
  assert.deepEqual(bars.map((b) => b.getAttribute("class").split(" ")[1]), ["bg-success", "bg-success", "bg-warning", "bg-success"]);
  assert.match(view.textContent, /\(none\)/);
  const rows = findAll(view, (n) => n.tagName === "TR").slice(1);
  assert.match(rows[0].textContent, /tcell_markers.*bob.*pbmc\.zarr.*12 KB/);
});

test("panel sets: messages say what happened and warn about the quota", () => {
  assert.deepEqual(reassignMessage({ moved: 2, unchanged: 0, over_quota: false }, "bob"),
    { text: "2 panel sets now belong to bob.", level: "success" });
  assert.deepEqual(reassignMessage({ moved: 1, unchanged: 3, over_quota: true }, "bob"),
    { text: "1 panel set now belongs to bob (3 already did). bob is now over the per-user limit.", level: "warning" });
  assert.equal(deleteMessage({ deleted: 1, missing: [] }), "1 panel set deleted.");
  assert.equal(deleteMessage({ deleted: 2, missing: ["x"] }), "2 panel sets deleted, 1 were already gone.");
});

test("panel sets: selecting rows reassigns them; delete asks twice", async () => {
  const { nav, view } = page();
  const sent = [];
  const toasts = [];
  const { api } = mockApi();
  api.panelSets.reassign = async (body) => { sent.push(["reassign", body]); return { moved: 1, unchanged: 0, over_quota: false }; };
  api.panelSets.remove = async (names) => { sent.push(["delete", names]); return { deleted: names.length, missing: [] }; };
  const router = makeRouter({ nav, view, api, ctx: { toast: (m, l) => toasts.push([m, l]) } });
  await router.show("panel-sets");
  const byId = (id) => find(view, (n) => n.getAttribute("id") === id);
  assert.equal(byId("ps-reassign").disabled, true);
  assert.equal(byId("ps-delete").disabled, true);
  const boxes = findAll(view, (n) => n.classes().includes("ps-row"));
  boxes[0].checked = true;
  await boxes[0].dispatch("change");
  const target = byId("ps-target");
  target.value = "alice";
  await target.dispatch("input");
  assert.equal(byId("ps-reassign").disabled, false);
  await byId("ps-reassign").dispatch("click");
  assert.deepEqual(sent, [["reassign", { names: ["tcell_markers"], to_owner: "alice" }]]);
  assert.deepEqual(toasts, [["1 panel set now belongs to alice.", "success"]]);
  // the selection is cleared after the action; delete needs the second click
  assert.equal(byId("ps-delete").disabled, true);
  const again = findAll(view, (n) => n.classes().includes("ps-row"));
  again[1].checked = true;
  await again[1].dispatch("change");
  await byId("ps-delete").dispatch("click");
  assert.equal(sent.length, 1);
  assert.match(byId("ps-actions").textContent, /Delete 1 for good/);
  await byId("ps-delete-confirm").dispatch("click");
  assert.deepEqual(sent[1], ["delete", ["overview"]]);
});

test("panel sets: a refusal is shown and nothing is cleared", async () => {
  const { nav, view } = page();
  const toasts = [];
  const { api } = mockApi();
  api.panelSets.reassign = async () => { throw new AdminError("No such user: x", { status: 404, reason: "unknown_user" }); };
  const router = makeRouter({ nav, view, api, ctx: { toast: (m, l) => toasts.push([m, l]) } });
  await router.show("panel-sets");
  const box = find(view, (n) => n.classes().includes("ps-row"));
  box.checked = true;
  await box.dispatch("change");
  const target = find(view, (n) => n.getAttribute("id") === "ps-target");
  target.value = "alice";
  await target.dispatch("input");
  await find(view, (n) => n.getAttribute("id") === "ps-reassign").dispatch("click");
  assert.deepEqual(toasts, [["No such user: x", "danger"]]);
});

test("settings: the tab renders the registry", async () => {
  const { nav, view } = page();
  const { api, calls } = mockApi({ "/policy": (init) => (init.method === "PUT" ? F.policy : F.policy) });
  const router = makeRouter({ nav, view, api, ctx: {} });
  await router.show("settings");
  assert.match(view.textContent, /Gene Set Analysis: no external services/);
  assert.match(view.textContent, /Limits/);
  assert.match(view.textContent, /Unknown keys in stored files/);
  const row = find(view, (n) => n.getAttribute("data-key") === "panel.cell-plot.enabled");
  const input = find(row, (n) => n.tagName === "INPUT");
  input.checked = false;
  await input.dispatch("change");
  assert.deepEqual(calls.filter(([m]) => m === "PUT"), [["PUT", "/policy"]]);
});

test("settings: a refused change is shown on its row", async () => {
  const { nav, view } = page();
  const api = {
    policy: {
      get: async () => F.policy,
      set: async () => { throw new AdminError("The configuration file locks this setting.", { status: 409, reason: "locked_by_config" }); },
    },
  };
  const router = makeRouter({ nav, view, api, ctx: {} });
  await router.show("settings");
  const row = find(view, (n) => n.getAttribute("data-key") === "panel.cell-plot.enabled");
  await find(row, (n) => n.tagName === "INPUT").dispatch("change");
  assert.match(row.textContent, /locks this setting/);
});

test("audit: chain status, rows newest first, refused rows marked, CLI origin shown", async () => {
  const { nav, view } = page();
  const router = makeRouter({ nav, view, api: mockApi().api });
  await router.show("audit");
  assert.match(view.textContent, /Chain verified OK through seq 3\./);
  const rows = findAll(view, (n) => n.tagName === "TR").slice(1);
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent, /alice @10\.0\.0\.5user\.set_adminbob\{"is_admin":false\}ok/);
  assert.ok(rows[1].classes().includes("table-warning"));
  assert.match(rows[1].textContent, /refused:admin_only/);
  assert.match(rows[2].textContent, /cli:root/);
  assert.equal(find(view, (n) => n.tagName === "BUTTON"), null, "fewer than a page: nothing older to load");
  assert.equal(chainText({ ok: false, first_bad_seq: 9 }, 12), "Chain BROKEN at seq 9.");
  assert.equal(chainText(null, 0), "Chain not checked.");
  assert.equal(detailText({}), "");
  assert.equal(detailText({ a: 1 }), '{"a":1}');
});

test("audit: Load older pages back from the oldest seq and appends", async () => {
  const { nav, view } = page();
  const full = Array.from({ length: 100 }, (_, i) => ({ seq: 200 - i, ts: "2026-10-11T09:00:00+00:00", actor: "a", action: "x", outcome: "ok" }));
  const queries = [];
  const api = {
    audit: {
      list: async (q) => {
        queries.push(q);
        return q.before_seq ? { records: [{ seq: 100, ts: "2026-10-11T08:00:00+00:00", actor: "z", action: "old", outcome: "ok" }], chain: { ok: true } }
          : { records: full, chain: { ok: true } };
      },
    },
  };
  const router = makeRouter({ nav, view, api, ctx: {} });
  await router.show("audit");
  const more = find(view, (n) => n.tagName === "BUTTON");
  assert.equal(more.textContent, "Load older");
  await more.dispatch("click");
  assert.deepEqual(queries, [{ before_seq: undefined, limit: 100 }, { before_seq: 101, limit: 100 }]);
  assert.equal(findAll(view, (n) => n.tagName === "TR").length, 1 + 101);
  assert.equal(find(view, (n) => n.tagName === "BUTTON"), null);
});

test("the re-auth modal: opens on request, a wrong password keeps it open, the right one resolves", async () => {
  const attempts = [];
  const api = {
    reauth: async (pw) => {
      attempts.push(pw);
      if (pw !== "right") throw new AdminError("That password is not right.", { status: 401, reason: "bad_password" });
      return { reauth_until: "x" };
    },
  };
  const modal = createReauthModal({ api });
  assert.ok(doc.body.children.includes(modal.element));
  assert.equal(modal.element.classes().includes("show"), false);
  const form = find(modal.element, (n) => n.tagName === "FORM");
  const input = find(modal.element, (n) => n.tagName === "INPUT");
  assert.equal(input.getAttribute("type"), "password");
  assert.equal(input.getAttribute("autocomplete"), "current-password");

  let done = false;
  const pending = modal.request().then(() => { done = true; });
  assert.ok(modal.element.classes().includes("show"));
  assert.equal(modal.request(), modal.request(), "one modal at a time");

  input.value = "wrong";
  await form.dispatch("submit");
  const err = find(modal.element, (n) => n.getAttribute("role") === "alert");
  assert.equal(err.hidden, false);
  assert.match(err.textContent, /not right/);
  assert.equal(done, false);
  assert.ok(modal.element.classes().includes("show"));

  input.value = "right";
  await form.dispatch("submit");
  await pending;
  assert.equal(done, true);
  assert.equal(modal.element.classes().includes("show"), false);
  assert.equal(input.value, "", "the password is not kept");
  assert.deepEqual(attempts, ["wrong", "right"]);
});

test("the re-auth modal: Cancel rejects and hides it", async () => {
  const modal = createReauthModal({ api: { reauth: async () => {} } });
  const pending = modal.request();
  const cancel = find(modal.element, (n) => n.tagName === "BUTTON" && n.textContent === "Cancel");
  await cancel.dispatch("click");
  await assert.rejects(pending, /cancelled/);
  assert.equal(modal.element.classes().includes("show"), false);
  // and it can be opened again
  const again = modal.request();
  assert.ok(modal.element.classes().includes("show"));
  await cancel.dispatch("click");
  await assert.rejects(again);
});

test("end to end: a lapsed window opens the modal, then the change goes through", async () => {
  const sent = [];
  let lapsed = true;
  let modal;
  const api = createAdminApi({
    csrf: "t", root: "",
    requestReauth: () => modal.request(),
    fetchImpl: async (url, init) => {
      const path = new URL(url, "http://x").pathname;
      sent.push(`${init.method} ${path}`);
      const answer = (status, body) => ({ status, ok: status < 300, headers: { get: () => null }, text: async () => JSON.stringify(body) });
      if (path.endsWith("/reauth")) { lapsed = false; return answer(200, { reauth_until: "x" }); }
      return lapsed ? answer(403, { reason: "reauth_required" }) : answer(200, { is_admin: false });
    },
  });
  modal = createReauthModal({ api });
  const call = api.users.setAdmin("bob", false);
  await new Promise((r) => setImmediate(r));
  assert.ok(modal.element.classes().includes("show"));
  find(modal.element, (n) => n.tagName === "INPUT").value = "pw";
  await find(modal.element, (n) => n.tagName === "FORM").dispatch("submit");
  assert.deepEqual(await call, { is_admin: false });
  assert.deepEqual(sent, [
    "POST /api/v1/admin/users/bob/admin", "POST /api/v1/admin/reauth", "POST /api/v1/admin/users/bob/admin",
  ]);
});

test("toasts are text, dismissable, and expire", () => {
  const host = doc.createElement("div");
  const timers = [];
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push([fn, ms]); return 0; };
  try {
    const node = showToast(host, "<b>careful</b>", "warning", 1000);
    assert.equal(host.children.length, 1);
    assert.equal(findAll(host, (n) => n.tagName === "B").length, 0);
    assert.match(node.textContent, /<b>careful<\/b>/);
    assert.equal(timers[0][1], 1000);
    timers[0][0]();
    assert.equal(host.children.length, 0);
    const sticky = showToast(host, "stay", "danger", 0);
    assert.equal(timers.length, 1);
    find(sticky, (n) => n.tagName === "BUTTON").dispatch("click");
    assert.equal(host.children.length, 0);
  } finally {
    globalThis.setTimeout = real;
  }
});

test("admin toasts follow the rules of the page's: errors stay, a lower one stacks below, hover holds the clock", () => {
  const host = doc.createElement("div");
  const timers = [];
  const real = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length - 1; };
  globalThis.clearTimeout = (id) => { if (timers[id]) timers[id].live = false; };
  try {
    const error = showToast(host, "Could not save", "danger");
    assert.equal(timers.length, 0, "an error has no timer");
    showToast(host, "Saved elsewhere", "info");
    assert.equal(host.children.length, 2, "the info stacks below the error");
    assert.equal(host.children[0], error);
    showToast(host, "Another info", "info");
    assert.equal(host.children.length, 2, "an info replaces the info, not the error");
    showToast(host, "A second error", "danger");
    assert.equal(host.children.length, 1, "an error replaces everything of lower or equal severity");
    // a short success takes its floor (4 s), and hover holds it
    const ok = showToast(host, "Done", "success");
    const timer = timers.length - 1;
    assert.equal(timers[timer].ms, 4000);
    ok.dispatch("mouseenter");
    assert.equal(timers[timer].live, false, "the clock stops under the pointer");
    ok.dispatch("mouseleave");
    assert.equal(timers[timers.length - 1].live, true);
    assert.ok(timers[timers.length - 1].ms >= 2000);
  } finally {
    globalThis.setTimeout = real;
    globalThis.clearTimeout = realClear;
  }
});
