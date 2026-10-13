// A user's access: the summaries in the Users and Data directories tables, and the panel that
// restricts, grants, revokes, lists the effective stores and checks a path. API calls are recorded.
// Run: `node --test annzarro/tests/js/admin-access.test.mjs`.
import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { find, findAll, installFakeDocument, uninstallFakeDocument } from "./fake-dom.mjs";
import { AdminError } from "../../../static/js/admin/admin-api.js";
import {
  summaryText, accessCell, grantedToText, grantRequest, storesText, checkText, confirmText, grantedText, reasonText, kindText, mountAccessPanel,
} from "../../../static/js/admin/access.js";
import users, { userRows } from "../../../static/js/admin/users.js";
import { rootRow } from "../../../static/js/admin/data-roots.js";

let doc;
beforeEach(() => { doc = installFakeDocument(); });
afterEach(() => { uninstallFakeDocument(); });

const GRANT = (path, extra = {}) => ({ kind: "dir", path, real: path, active: true, added_by: "alice", added_at: "2026-10-11T08:00:00", ...extra });

function view(extra = {}) {
  return {
    restricted: true, is_admin: false, all: false, policy_overrides: 0, remote_prefixes: 0,
    grants: [GRANT("/srv/pbmc"), GRANT("/srv/old/x.zarr", { kind: "store", active: false, inactive_reason: "outside_data_directories" })],
    stores: { items: [{ name: "a.zarr", path: "/srv/pbmc/a.zarr" }, { name: "b.zarr", path: "/srv/pbmc/b.zarr" }], total: 3, offset: 0, capped: false },
    ...extra,
  };
}

function fakeApi(initial = view()) {
  const state = { view: initial, calls: [] };
  const rec = (name, ret) => async (...args) => {
    state.calls.push([name, ...args]);
    return typeof ret === "function" ? ret(...args) : ret;
  };
  state.api = {
    access: {
      get: rec("get", (name, query) => (query && query.offset
        ? { ...state.view, stores: { items: [{ name: "c.zarr", path: "/srv/pbmc/c.zarr" }], total: 3, offset: 2, capped: false } }
        : state.view)),
      setRestricted: rec("setRestricted", () => ({})),
      grant: rec("grant", (n, kind, path) => ({ added: [{ kind, path }], skipped: [] })),
      revoke: rec("revoke", () => ({ removed: [] })),
      check: rec("check", (n, path) => ({ allowed: path.startsWith("/srv/pbmc"), via: null, reason: "because" })),
      overview: rec("overview", { store: { ok: true }, users: {}, roots: {} }),
    },
    dataRoots: {
      list: rec("rootsList", { roots: [{ path: "/srv", real: "/srv", active: true }, { path: "/gone", real: "/gone", active: false }] }),
      datasets: rec("datasets", { entries: [{ kind: "folder", name: "sub", path: "/srv/sub" }, { kind: "store", name: "c.zarr", path: "/srv/c.zarr" }], total: 2, more: false }),
    },
    policy: {
      getUser: rec("getUser", { keys: [], values: {}, unknown: [], issues: [], store_problems: [], is_admin: false }),
      setUser: rec("setUser", {}),
    },
  };
  return state;
}

async function mount(initial, ctx = {}) {
  const el = doc.createElement("div");
  const state = fakeApi(initial);
  const toasts = [];
  await mountAccessPanel(el, state.api, "bob", { toast: (m, l) => toasts.push([m, l]), ...ctx });
  return { el, state, toasts };
}

const byId = (el, id) => find(el, (n) => n.id === id);
const action = (el, name) => findAll(el, (n) => n.tagName === "BUTTON" && n.getAttribute("data-action") === name);

test("summaryText: all, restricted with counts, unknown", () => {
  assert.equal(summaryText(undefined), "-");
  assert.equal(summaryText({ restricted: false }), "all");
  assert.equal(summaryText({ restricted: null }), "unknown");
  assert.equal(summaryText({ restricted: true, grants: 1, active: 1 }), "restricted: 1 grant");
  assert.equal(summaryText({ restricted: true, grants: 3, active: 2 }), "restricted: 3 grants (1 inactive)");
});

test("accessCell: warns when a restricted user reads nothing, and marks policy overrides", () => {
  const none = accessCell({ restricted: true, grants: 1, active: 0 });
  assert.match(none.textContent, /reads nothing/);
  const some = accessCell({ restricted: true, grants: 1, active: 1, policy_overrides: 2 });
  assert.doesNotMatch(some.textContent, /reads nothing/);
  assert.match(some.textContent, /2 overrides/);
  assert.doesNotMatch(accessCell({ restricted: false, grants: 0, active: 0 }).textContent, /reads nothing/);
});

test("the helpers read the server's words", () => {
  assert.equal(grantedToText({ "/srv/a": ["bob", "carol"] }, { real: "/srv/a" }), "bob, carol");
  assert.equal(grantedToText({ "/srv/a": ["bob"] }, { real: "/srv/b" }), "-");
  assert.equal(grantedToText(undefined, { real: "/srv/b" }), "-");
  assert.deepEqual(grantRequest("stores_in", " /srv/x "), { kind: "stores_in", path: "/srv/x" });
  assert.equal(grantRequest("dir", "  "), null);
  assert.equal(grantRequest("nonsense", "/x"), null);
  assert.equal(storesText({ total: 1 }), "1 store");
  assert.equal(storesText({ total: 5000, capped: true }), "at least 5,000 stores");
  assert.equal(checkText({ allowed: false, reason: "No active grant covers it." }), "Not allowed: No active grant covers it.");
  assert.match(grantedText({ added: [{ path: "/a" }], skipped: [] }), /Granted \/a\./);
  assert.match(grantedText({ added: [{}, {}], skipped: [{}] }, "/f"), /2 stores in \/f\. 1 skipped/);
  assert.equal(reasonText("outside_data_directories"), "outside every data directory");
  assert.equal(reasonText("something_new"), "something_new");
  assert.equal(kindText("dir"), "folder");
  assert.match(confirmText("carol", "unrestrict"), /carol will be able to read every dataset/);
  assert.match(confirmText("carol", "restrict"), /carol will lose access to everything now/);
  assert.equal(summaryText({ restricted: null, grants: null, active: null }), "unknown");
});

test("the Users table gains an Access column only when the summary is known", () => {
  const list = [{ username: "bob", is_admin: false, panel_sets: 0, locked: [] }];
  assert.equal(userRows(list, "alice")[0].length, 6);
  const withAccess = userRows(list, "alice", undefined, { bob: { restricted: true, grants: 2, active: 2 } });
  assert.equal(withAccess[0].length, 7);
  assert.match(withAccess[0][6].textContent, /restricted: 2 grants/);
});

test("the Data directories row gains a Granted to cell only when the summary is known", () => {
  const root = { path: "/srv/a", real: "/srv/a", source: "admin", active: true };
  assert.equal(rootRow(root, "x").length, 5);
  const cells = rootRow(root, "x", { "/srv/a": ["bob"] });
  assert.equal(cells.length, 6);
  assert.equal(cells[4], "bob");
  assert.equal(cells[5], "x");
});

test("the Users section shows the summary, and Access opens the panel for that user", async () => {
  const el = doc.createElement("main");
  const state = fakeApi();
  state.api.users = {
    list: async () => [{ username: "alice", is_admin: true, panel_sets: 0, locked: [] }, { username: "bob", is_admin: false, panel_sets: 0, locked: [] }],
  };
  state.api.access.overview = async () => ({ users: { alice: { restricted: false }, bob: { restricted: true, grants: 2, active: 2 } }, roots: {} });
  await users.mount(el, state.api, { me: { username: "alice" } });
  assert.match(el.textContent, /restricted: 2 grants/);
  const bobRow = findAll(el, (n) => n.tagName === "TR").find((r) => r.textContent.startsWith("bob"));
  await find(bobRow, (n) => n.getAttribute("data-action") === "access").dispatch("click");
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(byId(el, "user-access"));
  assert.match(byId(el, "user-access").textContent, /Access of bob/);
  assert.deepEqual(state.calls.find((c) => c[0] === "get"), ["get", "bob"]);
});

test("the Users section works when the summary cannot be loaded", async () => {
  const el = doc.createElement("main");
  const state = fakeApi();
  state.api.users = { list: async () => [{ username: "bob", is_admin: false, panel_sets: 0, locked: [] }] };
  state.api.access.overview = async () => { throw new AdminError("no", { status: 500 }); };
  await users.mount(el, state.api, { me: { username: "alice" } });
  assert.doesNotMatch(el.textContent, /Access\b.*restricted/);
  assert.match(el.textContent, /bob/);
});

test("the panel shows the grants, the inactive reason, the effective line and the settings block", async () => {
  const { el, state } = await mount();
  assert.equal(byId(el, "access-restricted").checked, true);
  const grants = byId(el, "access-grants");
  assert.match(grants.textContent, /folder.*\/srv\/pbmc/);
  assert.match(grants.textContent, /inactive: outside every data directory/);
  assert.match(byId(el, "access-effective").textContent, /Effective: 1 grant, 3 stores/);
  assert.ok(state.calls.some((c) => c[0] === "getUser" && c[1] === "bob"), "the policy block is mounted");
  assert.equal(byId(el, "access-note"), null, "a restricted user with an active grant needs no warning");
});

test("a restriction with no active grant says the user reads nothing", async () => {
  const { el } = await mount(view({ grants: [] }));
  assert.match(byId(el, "access-note").textContent, /reads nothing/);
});

test("an unrestricted user's panel says everything is readable", async () => {
  const { el } = await mount(view({ restricted: false, all: true, grants: [] }));
  assert.match(byId(el, "access-note").textContent, /reads every dataset/);
});

test("an administrator cannot be restricted and has no grants to edit", async () => {
  const { el } = await mount(view({ is_admin: true, restricted: false, all: true, grants: [] }));
  assert.equal(byId(el, "access-restricted").disabled, true);
  assert.match(byId(el, "access-note").textContent, /cannot be restricted/);
  assert.equal(byId(el, "access-grants"), null);
});

test("one click on Restricted sends nothing: restricting a user with no grant asks first, then sends", async () => {
  let changes = 0;
  const { el, state, toasts } = await mount(view({ restricted: false, all: true, grants: [] }), { onChange: async () => { changes += 1; } });
  const box = byId(el, "access-restricted");
  box.checked = true;
  await box.dispatch("change");
  assert.equal(state.calls.filter((c) => c[0] === "setRestricted").length, 0, "a single click must not send the change");
  assert.match(byId(el, "access-confirm-box").textContent, /bob will lose access to everything now/);
  assert.equal(byId(el, "access-restricted").checked, false, "the box still shows what the server holds");
  await action(el, "confirm-access")[0].dispatch("click");
  assert.deepEqual(state.calls.find((c) => c[0] === "setRestricted"), ["setRestricted", "bob", true]);
  assert.equal(changes, 1);
  assert.match(toasts[0][0], /reads only what is granted/);
  assert.equal(byId(el, "access-confirm-box"), null);
});

test("restricting a user who has an active grant needs no confirmation", async () => {
  const { el, state } = await mount(view({ restricted: false, all: true }));
  const box = byId(el, "access-restricted");
  box.checked = true;
  await box.dispatch("change");
  assert.deepEqual(state.calls.find((c) => c[0] === "setRestricted"), ["setRestricted", "bob", true]);
});

test("lifting a restriction always asks first, in plain words, and Cancel sends nothing", async () => {
  const { el, state } = await mount();
  const box = byId(el, "access-restricted");
  box.checked = false;
  await box.dispatch("change");
  assert.equal(state.calls.filter((c) => c[0] === "setRestricted").length, 0);
  assert.match(byId(el, "access-confirm-box").textContent, /bob will be able to read every dataset/);
  assert.equal(byId(el, "access-restricted").checked, true);
  await action(el, "cancel-access")[0].dispatch("click");
  assert.equal(byId(el, "access-confirm-box"), null);
  assert.equal(state.calls.filter((c) => c[0] === "setRestricted").length, 0);
  const again = byId(el, "access-restricted");
  again.checked = false;
  await again.dispatch("change");
  await action(el, "confirm-access")[0].dispatch("click");
  assert.deepEqual(state.calls.find((c) => c[0] === "setRestricted"), ["setRestricted", "bob", false]);
});

test("a refused change shows the server's sentence", async () => {
  const { el, state } = await mount(view({ restricted: false, all: true, grants: [] }));
  state.api.access.setRestricted = async () => { throw new AdminError("An administrator is never restricted.", { status: 409, reason: "admin_unrestricted" }); };
  const box = byId(el, "access-restricted");
  box.checked = true;
  await box.dispatch("change");
  await action(el, "confirm-access")[0].dispatch("click");
  assert.match(byId(el, "access-error").textContent, /never restricted/);
  assert.equal(byId(el, "access-restricted").checked, false);
});

test("an administrator with a stored restriction is told it applies again if demoted", async () => {
  const { el } = await mount(view({ is_admin: true, restricted: false, stored_restricted: true, all: true, grants: [] }));
  assert.match(byId(el, "access-note").textContent, /applies again if their admin right is revoked/);
  const plain = await mount(view({ is_admin: true, restricted: false, stored_restricted: false, all: true, grants: [] }));
  assert.doesNotMatch(byId(plain.el, "access-note").textContent, /applies again/);
});

test("granting a folder sends the kind and path, clears the field and reloads", async () => {
  const { el, state, toasts } = await mount();
  byId(el, "access-grant-path").value = "/srv/new";
  await byId(el, "access-grant-path").dispatch("input", { target: { value: "/srv/new" } });
  await byId(el, "access-grant-button").dispatch("click");
  assert.deepEqual(state.calls.find((c) => c[0] === "grant"), ["grant", "bob", "dir", "/srv/new"]);
  assert.match(toasts[0][0], /Granted \/srv\/new/);
  assert.equal(byId(el, "access-grant-path").value, "");
});

test("the grant mode decides the kind: every store in a folder, a store, a remote prefix", async () => {
  const { el, state } = await mount();
  for (const [mode, kind] of [["stores_in", "stores_in"], ["store", "store"], ["remote", "remote"]]) {
    await byId(el, `access-mode-${mode}`).dispatch("change");
    await byId(el, "access-grant-path").dispatch("input", { target: { value: "/x" } });
    await byId(el, "access-grant-button").dispatch("click");
    assert.equal(state.calls.filter((c) => c[0] === "grant").at(-1)[2], kind);
  }
});

test("granting nothing asks for a path and sends nothing", async () => {
  const { el, state } = await mount();
  await byId(el, "access-grant-button").dispatch("click");
  assert.match(byId(el, "access-error").textContent, /Type or choose a path/);
  assert.equal(state.calls.filter((c) => c[0] === "grant").length, 0);
});

test("a refused grant shows the server's sentence and keeps what was typed", async () => {
  const { el, state } = await mount();
  state.api.access.grant = async () => { throw new AdminError("/etc is outside every data directory of this server.", { status: 403, reason: "outside_data_roots" }); };
  await byId(el, "access-grant-path").dispatch("input", { target: { value: "/etc" } });
  await byId(el, "access-grant-button").dispatch("click");
  assert.match(byId(el, "access-error").textContent, /outside every data directory/);
  assert.equal(byId(el, "access-grant-path").value, "/etc");
});

test("Revoke sends the stored path", async () => {
  const { el, state } = await mount();
  await action(byId(el, "access-grants"), "revoke")[0].dispatch("click");
  assert.deepEqual(state.calls.find((c) => c[0] === "revoke"), ["revoke", "bob", "/srv/pbmc"]);
});

test("the effective stores are listed on demand and paged", async () => {
  const { el, state } = await mount();
  assert.equal(findAll(el, (n) => n.getAttribute("data-store") !== null).length, 0);
  await action(el, "toggle-stores")[0].dispatch("click");
  assert.deepEqual(findAll(el, (n) => n.getAttribute("data-store") !== null).map((n) => n.getAttribute("data-store")), ["a.zarr", "b.zarr"]);
  await action(el, "more-stores")[0].dispatch("click");
  assert.deepEqual(state.calls.find((c) => c[0] === "get" && c[2]), ["get", "bob", { offset: 2 }]);
  assert.equal(findAll(el, (n) => n.getAttribute("data-store") !== null).length, 3);
  assert.equal(action(el, "more-stores").length, 0, "nothing more to load");
});

test("the check tool shows the verdict and the reason, and a failure", async () => {
  const { el, state } = await mount();
  await byId(el, "access-check-path").dispatch("input", { target: { value: "/srv/pbmc/a.zarr" } });
  await byId(el, "access-check-button").dispatch("click");
  assert.deepEqual(state.calls.find((c) => c[0] === "check"), ["check", "bob", "/srv/pbmc/a.zarr"]);
  const ok = byId(el, "access-check-result");
  assert.equal(ok.getAttribute("data-allowed"), "true");
  assert.match(ok.textContent, /Allowed: because/);
  await byId(el, "access-check-path").dispatch("input", { target: { value: "/elsewhere" } });
  await byId(el, "access-check-button").dispatch("click");
  assert.equal(byId(el, "access-check-result").getAttribute("data-allowed"), "false");
  state.api.access.check = async () => { throw new AdminError("Give an absolute path or a remote URL.", { status: 400 }); };
  await byId(el, "access-check-path").dispatch("input", { target: { value: "x" } });
  await byId(el, "access-check-button").dispatch("click");
  assert.match(byId(el, "access-check-result").textContent, /absolute path/);
});

test("browsing the data directories fills the path and picks the mode", async () => {
  const { el, state } = await mount();
  await action(el, "browse")[0].dispatch("click");
  assert.equal(findAll(byId(el, "access-browse"), (n) => n.getAttribute("data-dir")).length, 1, "only active roots are offered");
  await action(el, "open-dir")[0].dispatch("click");
  assert.deepEqual(state.calls.find((c) => c[0] === "datasets"), ["datasets", { root: "/srv", folder: "" }]);
  const entries = findAll(byId(el, "access-browse"), (n) => n.getAttribute("data-entry") !== null);
  await action(entries[1], "use-entry")[0].dispatch("click");
  assert.equal(byId(el, "access-grant-path").value, "/srv/c.zarr");
  assert.equal(byId(el, "access-mode-store").checked, true);
});

test("an unreadable access file is shown, with Retry", async () => {
  const el = doc.createElement("div");
  const state = fakeApi();
  state.api.access.get = async () => { throw new AdminError("The access file is unreadable.", { status: 503, reason: "store_unreadable" }); };
  await mountAccessPanel(el, state.api, "bob", {});
  assert.match(byId(el, "access-load-error").textContent, /unreadable/);
  assert.equal(byId(el, "access-restricted"), null, "no controls over a file that cannot be trusted");
  assert.equal(action(el, "retry-access").length, 1);
});

test("Close calls back", async () => {
  let closed = 0;
  const { el } = await mount(view(), { onClose: () => { closed += 1; } });
  await action(el, "close-access")[0].dispatch("click");
  assert.equal(closed, 1);
});

test("a failing settings block does not take the panel down", async () => {
  const el = doc.createElement("div");
  const state = fakeApi();
  state.api.policy.getUser = async () => { throw new AdminError("settings broke", { status: 500 }); };
  await mountAccessPanel(el, state.api, "bob", {});
  assert.match(byId(el, "access-policy-error").textContent, /settings broke/);
  assert.ok(byId(el, "access-restricted"));
});
