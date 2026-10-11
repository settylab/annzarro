// The per-layer parts of the Settings widgets: "inherited" and "reset" read from
// the server's per-layer breakdown, the per-user block, ignored stored values,
// and the component the user dialog mounts.
// Run: `node --test annzarro/tests/js/policy-widgets.test.mjs`.
import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { find, findAll, installFakeDocument, uninstallFakeDocument } from "./fake-dom.mjs";
import {
  ISSUE_TEXT, layerState, renderPolicy, renderPolicyRow, renderUserPolicy, sameValue,
} from "../../../static/js/admin/policy-widgets.js";
import { mountUserPolicy } from "../../../static/js/admin/settings.js";

let doc;
beforeEach(() => { doc = installFakeDocument(); });
afterEach(() => { uninstallFakeDocument(); });

const intKey = (extra = {}) => ({
  name: "t.limit", type: { kind: "int", min: 1, max: 10 }, scope: "server", area: "features", description: "d",
  default: 5, value: 5, source: "default", locked: false, layers: { default: 5 }, inherited: {}, ...extra,
});
const userKey = (extra = {}) => ({
  name: "t.user_num", type: { kind: "int", min: 1, max: 10 }, scope: "user", area: "panels", description: "d",
  default: 5, value: 5, source: "default", locked: false, layers: { default: 5 }, inherited: {}, override: null, ...extra,
});
const text = (row, cls) => { const n = find(row, (x) => x.classes().includes(cls)); return n ? n.textContent : null; };
const button = (root, label) => find(root, (n) => n.tagName === "BUTTON" && n.textContent === label);

test("sameValue compares lists and scalars by content", () => {
  assert.ok(sameValue(["a", "b"], ["a", "b"]));
  assert.ok(!sameValue(["a"], ["b"]));
  assert.ok(sameValue(3, 3));
});

test("layerState: a stored layer that counts has an inherited value to return to", () => {
  const key = intKey({ value: 3, source: "admin", layers: { admin: 3, config: 8, default: 5 }, inherited: { admin: 8 } });
  assert.deepEqual(layerState(key, "admin"), { set: true, inherited: 8, capped: false });
  assert.equal(layerState(intKey(), "admin").set, false);
  const capped = userKey({ value: 2, source: "admin", override: 9, inherited: { user: 2 }, layers: { user: 9, admin: 2, default: 5 } });
  assert.deepEqual(layerState(capped, "user"), { set: true, inherited: 2, capped: true });
});

test("a key with no stored value has no reset; one with a value says what it inherits and resets with null", async () => {
  const none = renderPolicyRow(intKey(), { onChange: async () => {} });
  assert.equal(button(none, "reset"), null);
  assert.equal(text(none, "policy-inherited"), null);
  const seen = [];
  const set = renderPolicyRow(intKey({ value: 3, source: "admin", layers: { admin: 3, default: 5 }, inherited: { admin: 5 } }),
    { onChange: async (n, v) => { seen.push([n, v]); } });
  assert.equal(text(set, "policy-inherited"), "inherited: 5");
  await button(set, "reset").dispatch("click");
  assert.deepEqual(seen, [["t.limit", null]]);
});

test("a locked key shows its value and lock, with no reset even when a stale value is stored", () => {
  const row = renderPolicyRow(intKey({ locked: true, inherited: { admin: 5 } }), { onChange: async () => {} });
  assert.ok(find(row, (n) => n.getAttribute("aria-label") === "locked"));
  assert.equal(button(row, "reset"), null);
  assert.equal(find(row, (n) => n.tagName === "INPUT"), null);
  assert.equal(text(row, "policy-readonly-value"), "5");
  assert.match(row.textContent, /locked by the config file/);
});

test("the user block shows the inherited value beside the override and resets to it", async () => {
  const el = doc.createElement("div");
  const seen = [];
  renderUserPolicy(el, {
    is_admin: false, issues: [], unknown: [],
    keys: [userKey({ value: 2, source: "user", override: 2, layers: { user: 2, default: 5 }, inherited: { user: 5 } })],
  }, { onChange: async (n, v) => { seen.push([n, v]); } });
  const row = find(el, (n) => n.getAttribute("data-key") === "t.user_num");
  assert.equal(text(row, "policy-inherited"), "inherited: 5");
  await button(row, "reset").dispatch("click");
  const input = find(row, (n) => n.tagName === "INPUT");
  input.value = "4";
  await input.dispatch("change");
  assert.deepEqual(seen, [["t.user_num", null], ["t.user_num", 4]]);
});

test("an override a wider setting caps says what applies instead", () => {
  const row = renderPolicyRow(userKey({ value: 2, source: "admin", override: 9, inherited: { user: 2 }, layers: { user: 9, admin: 2, default: 5 } }),
    { onChange: async () => {}, layer: "user" });
  assert.match(text(row, "policy-capped"), /2 applies/);
});

test("for an administrator the block is frozen, and stale overrides are flagged and removable", async () => {
  const el = doc.createElement("div");
  const removed = [];
  renderUserPolicy(el, {
    is_admin: true, keys: [userKey()], unknown: [],
    issues: [{ layer: "user", name: "t.user_num", value: 2, reason: "admin_user" }],
  }, { onChange: async () => { throw new Error("no"); }, onRemoveUnknown: (n) => removed.push(n) });
  assert.match(el.textContent, /Administrators get no per-user overrides/);
  const row = find(el, (n) => n.classes().includes("policy-row") && !n.classes().includes("policy-unknown"));
  assert.equal(find(row, (n) => n.tagName === "INPUT"), null, "nothing to type into");
  assert.equal(button(row, "reset"), null);
  const flagged = find(el, (n) => n.classes().includes("policy-unknown"));
  assert.match(flagged.textContent, new RegExp(ISSUE_TEXT.admin_user.slice(0, 20)));
  await button(flagged, "remove").dispatch("click");
  assert.deepEqual(removed, ["t.user_num"]);
});

test("every ignored stored value is listed with its reason, known keys included", () => {
  const el = doc.createElement("div");
  renderPolicy(el, {
    keys: [intKey()], unknown: [{ name: "t.gone", value: true }],
    issues: [{ layer: "overlay", name: "t.gone", value: true, reason: "unknown_key" },
             { layer: "overlay", name: "t.limit", value: "many", reason: "bad_type" }],
  }, { onChange: async () => {}, onRemoveUnknown: () => {} });
  const box = find(el, (n) => n.classes().includes("policy-unknown"));
  assert.match(box.textContent, /Stored values that are ignored/);
  assert.equal(findAll(box, (n) => n.tagName === "BUTTON").length, 2);
  assert.match(box.textContent, /has the wrong type/);
});

test("mountUserPolicy reads the user's policy, sends changes for that user and shows the reply", async () => {
  const el = doc.createElement("div");
  const calls = [];
  let override = null;
  const api = { policy: {
    getUser: async (u) => { calls.push(["get", u]); return {
      is_admin: false, issues: [], unknown: [],
      keys: [userKey(override === null ? {} : { value: override, source: "user", override, inherited: { user: 5 } })] }; },
    setUser: async (u, changes) => { calls.push(["set", u, changes]); override = changes["t.user_num"]; },
  } };
  await mountUserPolicy(el, api, "alice");
  const input = find(el, (n) => n.tagName === "INPUT");
  input.value = "3";
  await input.dispatch("change");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, [["get", "alice"], ["set", "alice", { "t.user_num": 3 }], ["get", "alice"]]);
  assert.match(el.textContent, /inherited: 5/);
});

test("a refusal reason is shown as a sentence on the row", async () => {
  const refuse = async () => { const e = new Error("x"); e.fieldErrors = { "t.limit": "config_ceiling" }; throw e; };
  const row = renderPolicyRow(intKey(), { onChange: refuse });
  const input = find(row, (n) => n.tagName === "INPUT");
  input.value = "4";
  await input.dispatch("change");
  assert.match(find(row, (n) => n.getAttribute("role") === "alert").textContent, /does not allow a wider value/);
});
