// Settings widgets generated from the policy registry
// (static/js/admin/policy-widgets.js): one widget per type, source badges,
// read-only and locked states, reset, validation, grouping.
// Run: `node --test annzarro/tests/js/admin-widgets.test.mjs`.
import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { readFileSync } from "node:fs";
import {
  find, findAll, installFakeDocument, uninstallFakeDocument,
} from "./fake-dom.mjs";
import {
  formatValue, groupByArea, keyState, renderPolicy, renderPolicyRow, typeSpec, validateValue,
} from "../../../static/js/admin/policy-widgets.js";

const FIXTURE = JSON.parse(readFileSync(new URL("./admin-fixtures.json", import.meta.url), "utf8"));
const key = (name, extra = {}) => ({ ...FIXTURE.policy.keys.find((k) => k.name === name), ...extra });

let doc;
beforeEach(() => { doc = installFakeDocument(); });
afterEach(() => { uninstallFakeDocument(); });

const tagOf = (root, tag) => findAll(root, (n) => n.tagName === tag.toUpperCase());
const badgeText = (row) => find(row, (n) => n.classes().includes("badge")).textContent;

test("type specs accept a bare kind and an object", () => {
  assert.equal(typeSpec("bool").kind, "bool");
  assert.deepEqual(typeSpec({ kind: "Int", min: 0, max: 5 }), { kind: "int", choices: [], min: 0, max: 5 });
  assert.equal(typeSpec(undefined).kind, "text");
});

test("validation by type", () => {
  const int = { kind: "int", min: 0, max: 10 };
  assert.equal(validateValue(int, 5), null);
  assert.match(validateValue(int, -1), /At least 0/);
  assert.match(validateValue(int, 11), /At most 10/);
  assert.match(validateValue(int, 1.5), /whole/);
  assert.match(validateValue(int, NaN), /number/);
  assert.equal(validateValue({ kind: "float", min: 0 }, 0.25), null);
  assert.equal(validateValue({ kind: "bool" }, true), null);
  assert.ok(validateValue({ kind: "bool" }, "yes"));
  const en = { kind: "enum", choices: ["on", "ask"] };
  assert.equal(validateValue(en, "ask"), null);
  assert.ok(validateValue(en, "off"));
  const sub = { kind: "subset", choices: [{ id: "a" }, "b"] };
  assert.equal(validateValue(sub, ["a", "b"]), null);
  assert.ok(validateValue(sub, ["c"]));
  assert.equal(validateValue({ kind: "hosts" }, ["x.example.org", "h:8080"]), null);
  assert.ok(validateValue({ kind: "hosts" }, ["https://x"]));
  assert.equal(validateValue({ kind: "paths" }, ["/a"]), null);
  assert.ok(validateValue({ kind: "paths" }, ["rel/x"]));
});

test("values print as read-only text", () => {
  assert.equal(formatValue({ kind: "bool" }, true), "on");
  assert.equal(formatValue({ kind: "bool" }, false), "off");
  assert.equal(formatValue({ kind: "hosts" }, ["a", "b"]), "a, b");
  assert.equal(formatValue({ kind: "hosts" }, []), "none");
  assert.equal(formatValue({ kind: "int" }, 819), "819");
  assert.equal(formatValue({ kind: "int" }, null), "not set");
});

test("editability: restart, config scope and locked keys are not editable", () => {
  assert.equal(keyState(key("panel.cell-plot.enabled")).editable, true);
  assert.match(keyState(key("limits.max_requests")).note, /restart/);
  assert.match(keyState(key("limits.max_sessions_per_user")).note, /config file/);
  assert.match(keyState(key("panel.gene-set.species_search")).note, /locked/);
});

test("areas come in registry order, unknown ones last, keys sorted by name", () => {
  const groups = groupByArea(FIXTURE.policy.keys);
  assert.deepEqual(groups.map((g) => g.area), ["panels", "outbound", "data", "features", "limits"]);
  assert.deepEqual(groups[0].keys.map((k) => k.name), ["panel.cell-plot.enabled", "panel.gene-set.enabled"]);
  const odd = groupByArea([{ name: "x.a", area: "zeta" }, { name: "y.b", area: "alpha" }, { name: "p.c", area: "panels" }]);
  assert.deepEqual(odd.map((g) => g.area), ["panels", "alpha", "zeta"]);
  assert.equal(odd[1].title, "Alpha");
});

test("a bool key is a switch that commits the new value", async () => {
  const seen = [];
  const row = renderPolicyRow(key("panel.cell-plot.enabled"), { onChange: async (n, v) => { seen.push([n, v]); } });
  const input = find(row, (n) => n.tagName === "INPUT");
  assert.equal(input.getAttribute("role"), "switch");
  assert.equal(input.checked, true);
  assert.equal(input.disabled, false);
  input.checked = false;
  await input.dispatch("change");
  assert.deepEqual(seen, [["panel.cell-plot.enabled", false]]);
  assert.equal(badgeText(row), "default");
});

test("an enum key is a select with the declared choices, current one selected", async () => {
  const seen = [];
  const row = renderPolicyRow(key("panel.gene-set.external_requests"), { onChange: async (n, v) => { seen.push([n, v]); } });
  const select = find(row, (n) => n.tagName === "SELECT");
  assert.deepEqual(tagOf(select, "option").map((o) => o.value), ["on", "ask", "off", "none"]);
  assert.equal(find(select, (n) => n.hasAttribute("selected")).value, "ask");
  select.value = "off";
  await select.dispatch("change");
  assert.deepEqual(seen, [["panel.gene-set.external_requests", "off"]]);
  assert.equal(badgeText(row), "config");
});

test("a subset key is a checklist with hosts; changing one box sends the whole selection in declared order", async () => {
  const seen = [];
  const row = renderPolicyRow(key("panel.gene-set.services"), { onChange: async (n, v) => { seen.push(v); } });
  const boxes = tagOf(row, "input");
  assert.equal(boxes.length, 5);
  assert.deepEqual(boxes.map((b) => b.checked), [true, true, true, false, false]);
  assert.match(row.textContent, /maayanlab\.cloud/);
  assert.match(row.textContent, /Browsers may contact: version-12-5\.string-db\.org, biit\.cs\.ut\.ee, mygene\.info/);
  boxes[4].checked = true;
  await boxes[4].dispatch("change");
  boxes[0].checked = false;
  await boxes[0].dispatch("change");
  assert.deepEqual(seen, [["string", "gprofiler", "mygene", "reactome"], ["gprofiler", "mygene"]]);
});

test("an int key shows its range, rejects out-of-range input on the client, and commits valid numbers", async () => {
  const seen = [];
  const k = { name: "limits.cap", type: { kind: "int", min: 1, max: 10 }, scope: "server", area: "limits", value: 5, source: "default", description: "d" };
  const row = renderPolicyRow(k, { onChange: async (n, v) => { seen.push(v); } });
  const input = find(row, (n) => n.tagName === "INPUT");
  assert.equal(input.getAttribute("min"), "1");
  assert.equal(input.getAttribute("max"), "10");
  assert.equal(input.getAttribute("step"), "1");
  assert.equal(input.value, "5");
  input.value = "11";
  await input.dispatch("change");
  const alert = find(row, (n) => n.getAttribute("role") === "alert");
  assert.equal(alert.hidden, false);
  assert.match(alert.textContent, /At most 10/);
  assert.deepEqual(seen, []);
  input.value = "7";
  await input.dispatch("change");
  assert.deepEqual(seen, [7]);
  assert.equal(alert.hidden, true);
});

test("a float key allows decimals and an empty box is refused", async () => {
  const seen = [];
  const row = renderPolicyRow(key("limits.read_wait_s"), { onChange: async (n, v) => { seen.push(v); } });
  const input = find(row, (n) => n.tagName === "INPUT");
  assert.equal(input.getAttribute("step"), "any");
  input.value = "";
  await input.dispatch("change");
  assert.deepEqual(seen, []);
  input.value = "2.5";
  await input.dispatch("change");
  assert.deepEqual(seen, [2.5]);
});

test("hosts and paths keys are list editors: add validates, remove drops the entry", async () => {
  const hosts = [];
  const row = renderPolicyRow(key("data.extra_hosts"), { onChange: async (n, v) => { hosts.push(v); } });
  assert.match(row.textContent, /data\.example\.org/);
  const input = find(row, (n) => n.tagName === "INPUT");
  input.value = "https://bad";
  await input.dispatch("keydown", { key: "Enter" });
  assert.deepEqual(hosts, []);
  assert.match(find(row, (n) => n.getAttribute("role") === "alert").textContent, /bare names/);
  input.value = "new.example.org";
  await input.dispatch("keydown", { key: "Enter" });
  assert.deepEqual(hosts, [["data.example.org", "new.example.org"]]);
  const remove = find(row, (n) => n.getAttribute("aria-label") === "Remove data.example.org");
  await remove.dispatch("click");
  assert.deepEqual(hosts[1], []);

  const paths = [];
  const prow = renderPolicyRow(key("data.extra_paths"), { onChange: async (n, v) => { paths.push(v); } });
  const pin = find(prow, (n) => n.tagName === "INPUT");
  pin.value = "relative";
  await pin.dispatch("keydown", { key: "Enter" });
  assert.deepEqual(paths, []);
  assert.match(prow.textContent, /Paths must be absolute/);
});

test("config-scope and restart keys render values with no inputs and say why", () => {
  const limit = renderPolicyRow(key("limits.max_sessions_per_user"), { onChange: async () => {} });
  assert.equal(tagOf(limit, "input").length, 0);
  assert.match(limit.textContent, /200/);
  assert.match(limit.textContent, /read-only, from the config file/);
  assert.equal(badgeText(limit), "config");
  const restart = renderPolicyRow(key("limits.max_requests"), { onChange: async () => {} });
  assert.equal(tagOf(restart, "input").length, 0);
  assert.match(restart.textContent, /change in the config file and restart/);
  const feature = renderPolicyRow(key("feature.remote_stores"), { onChange: async () => {} });
  assert.equal(tagOf(feature, "select").length, 0);
  assert.match(feature.textContent, /auto/);
});

test("a locked key keeps its widget but disabled, with a lock and a locked badge", () => {
  const row = renderPolicyRow(key("panel.gene-set.species_search"), { onChange: async () => {} });
  const input = find(row, (n) => n.tagName === "INPUT");
  assert.equal(input.disabled, true);
  assert.equal(badgeText(row), "locked");
  assert.ok(find(row, (n) => n.getAttribute("aria-label") === "locked"));
  assert.equal(find(row, (n) => n.textContent === "reset"), null);
});

test("an admin value shows the inherited value (from the layer below) and a reset that sends null", async () => {
  const seen = [];
  const row = renderPolicyRow(key("panel.gene-set.enabled"), { onChange: async (n, v) => { seen.push([n, v]); } });
  assert.equal(badgeText(row), "admin");
  assert.match(row.textContent, /inherited: on/);
  const reset = find(row, (n) => n.tagName === "BUTTON" && n.textContent === "reset");
  await reset.dispatch("click");
  assert.deepEqual(seen, [["panel.gene-set.enabled", null]]);
});

test("a server refusal is shown on the row: per-field error first, else the message", async () => {
  const refuse = async () => { const e = new Error("locked_by_config"); e.fieldErrors = { "panel.cell-plot.enabled": "odd_reason" }; throw e; };
  const row = renderPolicyRow(key("panel.cell-plot.enabled"), { onChange: refuse });
  const input = find(row, (n) => n.tagName === "INPUT");
  await input.dispatch("change");
  assert.equal(find(row, (n) => n.getAttribute("role") === "alert").textContent, "odd_reason");
  const plain = renderPolicyRow(key("panel.cell-plot.enabled"), { onChange: async () => { throw new Error("The configuration file locks this setting."); } });
  await find(plain, (n) => n.tagName === "INPUT").dispatch("change");
  assert.match(find(plain, (n) => n.getAttribute("role") === "alert").textContent, /locks this setting/);
});

test("the full tab: master switch inverted, groups in order, unknown keys flagged with remove", async () => {
  const el = doc.createElement("div");
  const changes = [];
  const removed = [];
  renderPolicy(el, FIXTURE.policy, {
    onChange: async (n, v) => { changes.push([n, v]); },
    onRemoveUnknown: (n) => removed.push(n),
  });
  const master = find(el, (n) => n.classes().includes("policy-master"));
  assert.match(master.textContent, /Gene Set Analysis: no external services/);
  assert.match(master.textContent, /OFF/);
  const sw = find(master, (n) => n.tagName === "INPUT");
  assert.equal(sw.checked, false);
  sw.checked = true; // turn "no external services" on
  await sw.dispatch("change");
  assert.deepEqual(changes, [["outbound.allow_external", false]]);
  // the master key is not repeated as an ordinary row
  assert.equal(findAll(el, (n) => n.getAttribute("data-key") === "outbound.allow_external").length, 1);
  assert.deepEqual(
    findAll(el, (n) => n.tagName === "SECTION").map((s) => s.getAttribute("data-area")),
    ["panels", "outbound", "data", "features", "limits", "unknown"],
  );
  const unknown = find(el, (n) => n.classes().includes("policy-unknown"));
  assert.match(unknown.textContent, /panel\.legacy\.enabled/);
  await find(unknown, (n) => n.tagName === "BUTTON").dispatch("click");
  assert.deepEqual(removed, ["panel.legacy.enabled"]);
});

test("a refused master switch snaps back and says why", async () => {
  const el = doc.createElement("div");
  renderPolicy(el, FIXTURE.policy, { onChange: async () => { throw new Error("The configuration file locks this setting."); } });
  const sw = find(el, (n) => n.classList.contains("policy-master")).querySelector("input");
  sw.checked = true;
  await sw.dispatch("change");
  assert.equal(sw.checked, false);
  assert.match(el.textContent, /locks this setting/);
});

test("names, descriptions and values reach the page as text, never as markup", () => {
  const evil = { name: "panel.x.enabled", type: { kind: "enum", choices: ["<b>x</b>"] }, scope: "server", area: "panels", description: "<img src=x onerror=1>", value: "<b>x</b>", source: "default" };
  const row = renderPolicyRow(evil, { onChange: async () => {} });
  assert.equal(findAll(row, (n) => n.tagName === "IMG" || n.tagName === "B").length, 0);
  assert.match(row.textContent, /<img src=x onerror=1>/);
});

test("a refused or cancelled change puts the input back as it was", async () => {
  const refuse = async () => { throw new Error("Password confirmation was cancelled."); };
  const bool = renderPolicyRow(key("panel.cell-plot.enabled"), { onChange: refuse });
  const box = find(bool, (n) => n.tagName === "INPUT");
  box.checked = false;
  await box.dispatch("change");
  assert.equal(box.checked, true);

  const en = renderPolicyRow(key("panel.gene-set.external_requests"), { onChange: refuse });
  const select = find(en, (n) => n.tagName === "SELECT");
  select.value = "none";
  await select.dispatch("change");
  assert.equal(select.value, "ask");

  const sub = renderPolicyRow(key("panel.gene-set.services"), { onChange: refuse });
  const boxes = tagOf(sub, "input");
  boxes[3].checked = true;
  await boxes[3].dispatch("change");
  assert.equal(boxes[3].checked, false);

  const num = renderPolicyRow(key("limits.read_wait_s"), { onChange: refuse });
  const input = find(num, (n) => n.tagName === "INPUT");
  input.value = "99";
  await input.dispatch("change");
  assert.equal(input.value, "30");
});
