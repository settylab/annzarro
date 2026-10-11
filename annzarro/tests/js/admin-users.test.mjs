// The Users section's actions, the audit chain line and the change-password page logic,
// against mocked API calls. Run: `node --test annzarro/tests/js/admin-users.test.mjs`.
import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { find, findAll, installFakeDocument, uninstallFakeDocument, reply } from "./fake-dom.mjs";
import { AdminError } from "../../../static/js/admin/admin-api.js";
import users, { protectedReason } from "../../../static/js/admin/users.js";
import { chainText } from "../../../static/js/admin/audit.js";
import { checkNewPassword, changePassword } from "../../../static/js/account.js";

let doc;
beforeEach(() => { doc = installFakeDocument(); });
afterEach(() => { uninstallFakeDocument(); });

const U = (username, extra = {}) => ({
  username, is_admin: false, last_login: null, password_changed_at: null, locked: [], panel_sets: 0, last_seen: null, ...extra,
});

function fakeApi(initial) {
  const state = { list: initial, calls: [] };
  const rec = (name, ret) => async (...args) => { state.calls.push([name, ...args]); return typeof ret === "function" ? ret(...args) : ret; };
  state.api = {
    users: {
      list: async () => state.list,
      add: rec("add", (b) => (b.generate ? { username: b.username, password: "G3nerated-Secret-1" } : { username: b.username })),
      remove: rec("remove", (n) => ({ removed: n, panel_sets_reassigned: 2 })),
      setPassword: rec("setPassword", (n, b) => (b.generate ? { password: "R3set-Secret-2" } : {})),
      setAdmin: rec("setAdmin", {}),
      unlock: rec("unlock", { cleared: 1 }),
    },
  };
  return state;
}

async function mountUsers(list, me = "alice") {
  const el = doc.createElement("main");
  const toasts = [];
  const state = fakeApi(list);
  await users.mount(el, state.api, { me: { username: me }, toast: (m, l) => toasts.push([m, l]) });
  return { el, state, toasts };
}

const buttons = (el, action) => findAll(el, (n) => n.tagName === "BUTTON" && n.getAttribute("data-action") === action);
const row = (el, name) => findAll(el, (n) => n.tagName === "TR").find((r) => r.textContent.startsWith(name));

test("protectedReason: yourself and the last administrator", () => {
  const list = [U("alice", { is_admin: true }), U("bob")];
  assert.match(protectedReason(list[0], list, "alice"), /Your own account/);
  assert.equal(protectedReason(list[1], list, "alice"), "");
  const two = [U("alice", { is_admin: true }), U("carol", { is_admin: true })];
  assert.equal(protectedReason(two[1], two, "alice"), "");
  assert.match(protectedReason(list[0], list, "someone"), /last administrator/);
});

test("users: the last admin and your own row cannot be revoked or removed, with the reason as a tooltip", async () => {
  const { el } = await mountUsers([U("alice", { is_admin: true }), U("bob")]);
  const alice = row(el, "alice");
  for (const action of ["revoke-admin", "remove"]) {
    const b = find(alice, (n) => n.getAttribute("data-action") === action);
    assert.equal(b.disabled, true, action);
    assert.match(b.getAttribute("title"), /Your own account/);
  }
  const bob = row(el, "bob");
  assert.equal(find(bob, (n) => n.getAttribute("data-action") === "remove").disabled, false);
  assert.ok(find(bob, (n) => n.getAttribute("data-action") === "make-admin"));
  assert.equal(find(bob, (n) => n.getAttribute("data-action") === "unlock"), null, "only a locked user has Unlock");
});

test("users: a locked user can be unlocked, and the table reloads", async () => {
  const { el, state, toasts } = await mountUsers([U("alice", { is_admin: true }), U("bob", { locked: [{ address: "1.2.3.4", failures: 5 }] })]);
  await find(row(el, "bob"), (n) => n.getAttribute("data-action") === "unlock").dispatch("click");
  assert.deepEqual(state.calls[0], ["unlock", "bob"]);
  assert.match(toasts[0][0], /Unlocked bob/);
});

test("users: make admin and a refused revoke shows the server's sentence", async () => {
  const { el, state, toasts } = await mountUsers([U("alice", { is_admin: true }), U("bob", { is_admin: true }), U("carol")]);
  await find(row(el, "carol"), (n) => n.getAttribute("data-action") === "make-admin").dispatch("click");
  assert.deepEqual(state.calls[0], ["setAdmin", "carol", true]);
  state.api.users.setAdmin = async () => { throw new AdminError("This would leave the server without an administrator.", { status: 409, reason: "last_admin" }); };
  await find(row(el, "bob"), (n) => n.getAttribute("data-action") === "revoke-admin").dispatch("click");
  assert.deepEqual(toasts.at(-1), ["Revoke admin: This would leave the server without an administrator.", "danger"]);
});

test("users: add with a generated password shows it once, with Copy and Done", async () => {
  const { el, state } = await mountUsers([U("alice", { is_admin: true })]);
  await buttons(el, "add")[0].dispatch("click");
  const form = find(el, (n) => n.id === "users-add");
  find(form, (n) => n.id === "add-username").value = "carol";
  await form.dispatch("submit");
  assert.deepEqual(state.calls[0], ["add", { username: "carol", is_admin: false, generate: true }]);
  const notice = find(el, (n) => n.id === "users-secret");
  assert.match(notice.textContent, /Password for carol: G3nerated-Secret-1/);
  assert.match(notice.textContent, /Shown once/);
  await buttons(el, "dismiss-secret")[0].dispatch("click");
  assert.equal(find(el, (n) => n.id === "users-secret"), null);
  assert.doesNotMatch(el.textContent, /G3nerated-Secret-1/);
});

test("users: the generated password is gone when the section is mounted again", async () => {
  const { el, state } = await mountUsers([U("alice", { is_admin: true })]);
  await buttons(el, "add")[0].dispatch("click");
  const form = find(el, (n) => n.id === "users-add");
  find(form, (n) => n.id === "add-username").value = "carol";
  await form.dispatch("submit");
  assert.ok(find(el, (n) => n.id === "users-secret"));
  const again = doc.createElement("main");
  await users.mount(again, state.api, { me: { username: "alice" } });
  assert.equal(find(again, (n) => n.id === "users-secret"), null);
});

test("users: add checks the name locally and shows a server refusal in the form", async () => {
  const { el, state } = await mountUsers([U("alice", { is_admin: true })]);
  await buttons(el, "add")[0].dispatch("click");
  let form = find(el, (n) => n.id === "users-add");
  find(form, (n) => n.id === "add-username").value = "bad name";
  await form.dispatch("submit");
  assert.match(form.textContent, /Usernames use letters/);
  assert.equal(state.calls.length, 0);
  state.api.users.add = async () => { throw new AdminError("A user with that name already exists.", { status: 409, reason: "user_exists" }); };
  find(form, (n) => n.id === "add-username").value = "bob";
  await form.dispatch("submit");
  form = find(el, (n) => n.id === "users-add");
  assert.match(form.textContent, /already exists/);
});

test("users: reset password asks the server to generate and shows the result once", async () => {
  const { el, state } = await mountUsers([U("alice", { is_admin: true }), U("bob")]);
  await find(row(el, "bob"), (n) => n.getAttribute("data-action") === "reset").dispatch("click");
  await find(el, (n) => n.id === "users-reset").dispatch("submit");
  assert.deepEqual(state.calls[0], ["setPassword", "bob", { generate: true }]);
  assert.match(find(el, (n) => n.id === "users-secret").textContent, /Password for bob: R3set-Secret-2/);
});

test("users: remove offers the other users for the panel sets and sends the choice", async () => {
  const { el, state } = await mountUsers([U("alice", { is_admin: true }), U("bob", { panel_sets: 3 })]);
  await find(row(el, "bob"), (n) => n.getAttribute("data-action") === "remove").dispatch("click");
  const form = find(el, (n) => n.id === "users-remove");
  assert.match(form.textContent, /bob owns 3 panel sets/);
  const select = find(form, (n) => n.id === "remove-reassign");
  assert.deepEqual(findAll(select, (n) => n.tagName === "OPTION").map((o) => o.value), ["", "alice"]);
  select.value = "alice";
  await form.dispatch("submit");
  assert.deepEqual(state.calls[0], ["remove", "bob", { reassign_to: "alice" }]);
});

test("users: a name with markup stays text in the action panels too", async () => {
  const evil = "<img src=x onerror=alert(1)>";
  const { el } = await mountUsers([U("alice", { is_admin: true }), U(evil)]);
  await find(row(el, evil), (n) => n.getAttribute("data-action") === "reset").dispatch("click");
  assert.equal(findAll(el, (n) => n.tagName === "IMG").length, 0);
  assert.match(find(el, (n) => n.id === "users-reset").textContent, /<img src=x/);
});

test("audit: chain line names the problem, rotated-away history and torn lines", () => {
  assert.equal(chainText({ ok: false, first_bad_seq: 9 }, 12), "Chain BROKEN at seq 9.");
  assert.match(chainText({ ok: false, first_bad_seq: 9, problem: "truncated" }, 12), /BROKEN at seq 9 \(the log ends before/);
  assert.match(chainText({ ok: true, first_seq: 40, torn: [] }, 50), /through seq 50\. History starts at seq 40/);
  assert.match(chainText({ ok: true, first_seq: 1, torn: [7] }, 8), /1 line cut off by a crash \(seq 7\)/);
});

test("account: the form is checked before it is sent", () => {
  assert.equal(checkNewPassword("old", "a long enough one", "a long enough one", "alice"), "");
  assert.match(checkNewPassword("", "a long enough one", "a long enough one", "alice"), /current password/);
  assert.match(checkNewPassword("old", "short", "short", "alice"), /at least 10/);
  assert.match(checkNewPassword("old", "ALICE-ALICE", "ALICE-ALICE", "alice-alice"), /differ from your username/);
  assert.match(checkNewPassword("same password", "same password", "same password", "alice"), /different from the current/);
  assert.match(checkNewPassword("old", "a long enough one", "another long one", "alice"), /two new passwords differ/);
});

test("account: the change posts JSON with the token and reports the server's answer", async () => {
  let seen;
  const ok = await changePassword({
    fetchImpl: async (url, init) => { seen = [url, init]; return reply(200, { changed: true }); },
    csrf: "tok", url: "/api/v1/account/password", current: "c", next: "n",
  });
  assert.deepEqual(ok, { ok: true, message: "Your password was changed." });
  assert.equal(seen[1].headers["X-AnnZarro-CSRF"], "tok");
  assert.equal(seen[1].headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(seen[1].body), { current: "c", new: "n" });
  const wrong = await changePassword({
    fetchImpl: async () => reply(403, { error: "That is not your current password.", reason: "bad_password" }),
    csrf: "t", url: "/x", current: "c", next: "n",
  });
  assert.deepEqual(wrong, { ok: false, message: "That is not your current password." });
  const down = await changePassword({ fetchImpl: async () => { throw new Error("net"); }, csrf: "t", url: "/x", current: "c", next: "n" });
  assert.match(down.message, /Could not reach/);
  const expired = await changePassword({ fetchImpl: async () => reply(401, { reason: "login_required" }), csrf: "t", url: "/x", current: "c", next: "n" });
  assert.match(expired.message, /expired/);
});
