// The admin page's Public site section (static/js/admin/site-settings.js): its pure helpers,
// and the section rendered from a mocked policy reply in the fake DOM.
// Run: `node --test annzarro/tests/js/admin-site.test.mjs`.
import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { find, findAll, installFakeDocument, uninstallFakeDocument } from "./fake-dom.mjs";
import { AdminError } from "../../../static/js/admin/admin-api.js";
import site, { checklist, previewDocument, siteKeys, textMode, textPayload } from "../../../static/js/admin/site-settings.js";

const EMPTY = { label: "Imprint", url: null, markdown: null, file: null };

function key(name, value, extra = {}) {
  const kind = name.startsWith("site.storage") || name === "site.software_credits" ? "bool"
    : ["site.footer_links", "site.robots"].includes(name) ? "enum"
      : ["site.imprint", "site.privacy", "site.accessibility", "site.terms"].includes(name) ? "site_text" : "site_line";
  const type = kind === "enum" ? { kind, choices: name === "site.robots" ? ["auto", "index", "noindex"] : ["auto", "about-only"] }
    : kind === "site_text" ? { kind, default_label: "Imprint" } : { kind, nullable: true };
  return { name, type, section: "site", area: "site", scope: "server", description: `Help for ${name}.`,
    value, source: "default", locked: false, layers: { default: value }, ...extra };
}

function policy(overrides = {}) {
  const keys = [
    key("site.imprint", EMPTY), key("site.privacy", { ...EMPTY, label: "Privacy" }),
    key("site.accessibility", { ...EMPTY, label: "Accessibility" }), key("site.terms", { ...EMPTY, label: "Terms of use" }),
    key("site.operator", null), key("site.contact", null), key("site.contact_label", "Contact"),
    key("site.security_contact", null), key("site.languages", "en"), key("site.footer_links", "auto"),
    key("site.robots", "auto"), key("site.software_credits", true), key("site.storage.persistent_convenience", true),
    { name: "panel.cell-plot.enabled", type: { kind: "bool" }, section: "", value: true },
  ].map((k) => ({ ...k, ...(overrides[k.name] || {}) }));
  return { version: "v", keys, unknown: [], issues: [] };
}

let doc;
beforeEach(() => { doc = installFakeDocument(); });
afterEach(() => { uninstallFakeDocument(); });

test("siteKeys takes the keys of the site section, by their short name", () => {
  const keys = siteKeys(policy());
  assert.equal(Object.keys(keys).length, 13);
  assert.equal(keys.imprint.name, "site.imprint");
  assert.equal(keys["storage.persistent_convenience"].value, true);
  assert.equal(keys["cell-plot.enabled"], undefined);
});

test("textMode reads a text as the server does: a url first, then a file, then markdown", () => {
  assert.equal(textMode(EMPTY), "none");
  assert.equal(textMode(null), "none");
  assert.equal(textMode({ ...EMPTY, markdown: "  " }), "none");
  assert.equal(textMode({ ...EMPTY, markdown: "x" }), "markdown");
  assert.equal(textMode({ ...EMPTY, markdown: "x", file: "/f.md" }), "file");
  assert.equal(textMode({ ...EMPTY, markdown: "x", file: "/f.md", url: "https://e.org" }), "url");
});

test("textPayload keeps only the chosen form and never a file", () => {
  assert.deepEqual(textPayload("url", { label: " Impressum ", url: " https://e.org/i ", markdown: "x" }),
    { label: "Impressum", url: "https://e.org/i", markdown: null, file: null });
  assert.deepEqual(textPayload("markdown", { label: "", url: "https://e.org", markdown: "# Hi" }),
    { label: null, url: null, markdown: "# Hi", file: null });
  assert.deepEqual(textPayload("none", { label: "x", url: "u", markdown: "m" }), { label: "x", url: null, markdown: null, file: null });
});

test("checklist says which of imprint, privacy, contact and accessibility are set", () => {
  const keys = siteKeys(policy({ "site.imprint": { value: { ...EMPTY, url: "https://e.org/i" } },
    "site.contact": { value: "office@example.org" } }));
  assert.deepEqual(checklist(keys).map((i) => [i.id, i.set]),
    [["imprint", true], ["privacy", false], ["contact", true], ["accessibility", false]]);
});

test("previewDocument renders through the safe renderer: a script is text, a javascript: link is not a link", () => {
  const html = previewDocument("# Hi\n\n<script>alert(1)</script> [x](javascript:alert(1))");
  assert.match(html, /<h2>Hi<\/h2>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html.split("</style>")[1], /<script/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(previewDocument(""), /Nothing to preview yet/);
  assert.doesNotMatch(previewDocument("x", { text: "red}body{background:url(x)" }), /url\(x\)/, "a colour cannot break out of the style");
});

function mount(api) {
  const el = doc.createElement("div");
  const toasts = [];
  return site.mount(el, api, { toast: (m, l) => toasts.push([m, l]) }).then(() => ({ el, toasts }));
}

test("the section shows the checklist, a help on every field, the sandboxed preview and the guide", async () => {
  const { el } = await mount({ policy: { get: async () => policy() } });
  assert.match(el.textContent, /Public site/);
  assert.equal(findAll(el, (n) => n.getAttribute && n.getAttribute("data-check") !== null && n.getAttribute("data-check") !== undefined).length, 4);
  const helps = findAll(el, (n) => n.getAttribute && n.getAttribute("data-help") !== null && n.getAttribute("data-help") !== undefined);
  assert.equal(helps.length, 13);
  assert.ok(helps.every((h) => /^Help for site\./.test(h.getAttribute("title"))));
  const frames = findAll(el, (n) => n.tagName === "IFRAME");
  assert.equal(frames.length, 4);
  assert.ok(frames.every((f) => f.getAttribute("sandbox") === ""), "no script runs in the preview");
  assert.ok(findAll(el, (n) => n.tagName === "A").some((a) => /public-site\.html/.test(a.getAttribute("href"))));
});

test("Save sends every changed field in one request and shows a refused one on its field", async () => {
  const sent = [];
  const api = {
    policy: {
      get: async () => policy(),
      set: async (changes) => {
        sent.push(changes);
        throw new AdminError("site.contact must be ...", { status: 400, reason: "invalid_settings",
          body: { errors: { "site.contact": "bad_type" }, messages: { "site.contact": "site.contact must be an e-mail address or an http(s) address, not 'x'" } } });
      },
    },
  };
  const { el, toasts } = await mount(api);
  const operator = find(el, (n) => n.getAttribute && n.getAttribute("id") === "site-operator");
  operator.value = "Example Institute";
  await operator.dispatch("input");
  const contact = find(el, (n) => n.getAttribute && n.getAttribute("id") === "site-contact");
  contact.value = "x";
  await contact.dispatch("input");
  const save = find(el, (n) => n.getAttribute && n.getAttribute("id") === "site-save");
  assert.equal(save.disabled, false);
  await save.dispatch("click");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, [{ "site.operator": "Example Institute", "site.contact": "x" }]);
  const row = find(el, (n) => n.getAttribute && n.getAttribute("data-key") === "site.contact");
  assert.match(row.textContent, /must be an e-mail address/);
  assert.equal(toasts.at(-1)[1], "danger");
});

test("a locked key is read-only and says why; an admin value offers a reset", async () => {
  const { el } = await mount({ policy: { get: async () => policy({
    "site.imprint": { locked: true, source: "config", value: { ...EMPTY, markdown: "Locked" } },
    "site.operator": { source: "admin", value: "Mine", config_value: "Theirs" },
  }) } });
  const card = find(el, (n) => n.getAttribute && n.getAttribute("data-key") === "site.imprint");
  assert.match(card.textContent, /Only the config file sets this/);
  assert.ok(findAll(card, (n) => n.tagName === "TEXTAREA" || n.tagName === "INPUT").every((i) => i.disabled));
  const reset = find(el, (n) => n.getAttribute && n.getAttribute("data-reset") === "operator");
  assert.match(reset.textContent, /config file's value/);
});

test("a text from a file in the config file shows its path and is not sent back", async () => {
  const { el } = await mount({ policy: { get: async () => policy({
    "site.privacy": { source: "config", value: { ...EMPTY, label: "Privacy", file: "/etc/annzarro/privacy.md" } },
  }) } });
  const card = find(el, (n) => n.getAttribute && n.getAttribute("data-key") === "site.privacy");
  assert.match(card.textContent, /\/etc\/annzarro\/privacy\.md/);
  assert.match(card.textContent, /can only be set in the config file/);
});
