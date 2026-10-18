// The help every admin setting carries (static/js/admin/help.js, help-catalog.js): an info mark
// with the setting's text and a Guide link into the docs.
// Run: `node --test annzarro/tests/js/admin-help.test.mjs`.
import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { readFileSync } from "node:fs";
import { find, findAll, installFakeDocument, uninstallFakeDocument } from "./fake-dom.mjs";
import { DOCS, docsUrl, guideLink, helpMark, settingHelp } from "../../../static/js/admin/help.js";
import { CONTROLS, controlHelp, keyHelp } from "../../../static/js/admin/help-catalog.js";
import { renderPolicy, renderPolicyRow, renderUserPolicy } from "../../../static/js/admin/policy-widgets.js";

const FIXTURE = JSON.parse(readFileSync(new URL("./admin-fixtures.json", import.meta.url), "utf8"));

let doc;
beforeEach(() => { doc = installFakeDocument(); });
afterEach(() => { uninstallFakeDocument(); });

const attr = (n, name) => (n.getAttribute ? n.getAttribute(name) : null);
const has = (n, name) => attr(n, name) !== null && attr(n, name) !== undefined;
const byId = (root, id) => find(root, (n) => attr(n, "id") === id);

test("docsUrl puts a guide on the published docs", () => {
  assert.equal(docsUrl("deployment/admin.html#panels"), `${DOCS}deployment/admin.html#panels`);
  assert.equal(docsUrl("/deployment/admin.html"), `${DOCS}deployment/admin.html`);
});

test("the mark is a button named for the setting, with its text also in the page for screen readers", () => {
  const wrap = helpMark("Imprint", "Who provides this site.");
  const button = find(wrap, (n) => n.tagName === "BUTTON");
  assert.equal(attr(button, "type"), "button");
  assert.equal(attr(button, "aria-label"), "Help: Imprint");
  assert.equal(attr(button, "title"), "Who provides this site.");
  const text = byId(wrap, attr(button, "aria-describedby"));
  assert.ok(text, "aria-describedby names an element of the page");
  assert.equal(text.textContent, "Who provides this site.");
  assert.ok(has(button, "data-help"));
});

test("a registry key's mark ends with its config file path, and a catalog control's has none", () => {
  const [mark] = keyHelp({ description: "Does a thing, by default off.", config_file: "site.imprint", config_file_setting: true }, "Imprint");
  const button = find(mark, (n) => n.tagName === "BUTTON");
  assert.equal(attr(button, "title"), "Does a thing, by default off.\nConfig file: site.imprint");
  assert.equal(attr(button, "data-config-file"), "site.imprint");
  assert.match(byId(mark, attr(button, "aria-describedby")).textContent, /Config file: site\.imprint$/);
  const [lock] = keyHelp({ name: "panel.cell-plot.enabled", description: "A switch.", config_file: "policy.locked", config_file_setting: false }, "Panel");
  assert.equal(attr(find(lock, (n) => n.tagName === "BUTTON"), "title"),
    "A switch.\nConfig file: none. Set here or per user; to lock it, list panel.cell-plot.enabled under policy.locked.");
  const [plain] = controlHelp("user.admin");
  assert.equal(attr(find(plain, (n) => n.tagName === "BUTTON"), "title").includes("Config file"), false);
});

test("the mark also describes the control it is for", () => {
  const input = doc.createElement("input");
  const box = doc.createElement("div");
  const inner = doc.createElement("select");
  box.appendChild(inner);
  const wrap = helpMark("Limit", "A limit.", { describes: [input, box] });
  const id = attr(find(wrap, (n) => n.tagName === "BUTTON"), "aria-describedby");
  assert.equal(attr(input, "aria-describedby"), id);
  assert.equal(attr(inner, "aria-describedby"), id, "a wrapper hands it to the control inside");
});

test("the Guide link opens the docs in a new tab, and is absent without a guide", () => {
  assert.equal(guideLink("", "Imprint"), null);
  const link = guideLink("deployment/admin.html#panels", "Panels");
  assert.equal(attr(link, "href"), `${DOCS}deployment/admin.html#panels`);
  assert.equal(attr(link, "target"), "_blank");
  assert.match(attr(link, "rel"), /noopener/);
  assert.match(link.textContent, /^Guide.* for Panels$/);
  const [mark, guide] = settingHelp({ title: "T", text: "Text.", guide: "a/b.html#c" });
  assert.ok(find(mark, (n) => has(n, "data-help")) && has(guide, "data-guide"));
});

test("every control of the catalog has a title, a plain sentence and a guide into the admin page", () => {
  const ids = Object.keys(CONTROLS);
  assert.ok(ids.length >= 9);
  for (const id of ids) {
    const c = CONTROLS[id];
    assert.ok(c.title && c.text.split(/\s+/).length >= 8, `${id}: too terse`);
    assert.match(c.guide, /^deployment\/admin\.html#[a-z-]+$/, id);
    const [mark, guide] = controlHelp(id);
    assert.ok(mark && guide, id);
  }
  assert.throws(() => controlHelp("no.such-control"), /No help/);
});

test("a settings row carries the key's description as its help and the key's guide", () => {
  for (const k of FIXTURE.policy.keys.filter((x) => !x.section)) {
    const row = renderPolicyRow({ ...k, label: `Label of ${k.name}`, description: `About ${k.name}, with enough words to explain it.` });
    assert.equal(attr(row, "data-setting"), k.name);
    assert.equal(find(row, (n) => n.classes && n.classes().includes("policy-label")).textContent, `Label of ${k.name}`);
    assert.equal(find(row, (n) => n.classes && n.classes().includes("policy-key")).textContent, k.name, "the key stays beside the label");
    const mark = find(row, (n) => has(n, "data-help"));
    assert.ok(mark, `${k.name} has no help`);
    assert.equal(attr(mark, "title"), `About ${k.name}, with enough words to explain it.`);
    const guide = find(row, (n) => has(n, "data-guide"));
    assert.ok(guide, `${k.name} has no guide`);
    assert.equal(attr(guide, "href"), docsUrl(k.guide));
    assert.equal(find(row, (n) => n.classes && n.classes().includes("small") && n.textContent.startsWith("About ")), null,
      "the description is the help, not a line of the row");
  }
});

test("every setting of the Settings tab and of a user's overrides has a help and a guide, the master switch included", () => {
  const el = doc.createElement("div");
  renderPolicy(el, FIXTURE.policy, {});
  const settings = findAll(el, (n) => has(n, "data-setting"));
  assert.ok(settings.some((n) => attr(n, "data-setting") === "outbound.allow_external"), "the master switch");
  assert.ok(settings.length >= 8);
  for (const s of settings) {
    assert.ok(find(s, (n) => has(n, "data-help")), `${attr(s, "data-setting")}: no help`);
    assert.ok(find(s, (n) => has(n, "data-guide")), `${attr(s, "data-setting")}: no guide`);
  }
  const user = doc.createElement("div");
  renderUserPolicy(user, { ...FIXTURE.policy, keys: FIXTURE.policy.keys.filter((k) => k.scope === "user") }, {});
  const rows = findAll(user, (n) => has(n, "data-setting"));
  assert.ok(rows.length >= 3);
  for (const s of rows) assert.ok(find(s, (n) => has(n, "data-help")) && find(s, (n) => has(n, "data-guide")), attr(s, "data-setting"));
});
