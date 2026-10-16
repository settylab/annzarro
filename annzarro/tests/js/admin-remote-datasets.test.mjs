// The Remote datasets card of the Data sources section: the allowlist validation,
// which states the configuration leaves open, the warning, and the saved value.
// Run: `node --test annzarro/tests/js/admin-remote-datasets.test.mjs`.
import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { find, installFakeDocument, uninstallFakeDocument } from "./fake-dom.mjs";
import {
  KEY, addPrefix, isInside, normalisePrefix, optionStates, renderRemoteDatasets, sameAccess, sourceText,
} from "../../../static/js/admin/remote-datasets.js";

beforeEach(() => { installFakeDocument(); });
afterEach(() => { uninstallFakeDocument(); });

const OFF = { mode: "off", allowlist: [] };
const ANY = { mode: "any", allowlist: [] };
const allow = (...p) => ({ mode: "allowlist", allowlist: p });
const key = (over = {}) => ({ name: KEY, value: OFF, source: "default", locked: false, ...over });

test("a location is normalised the way the server does", () => {
  assert.deepEqual(normalisePrefix("S3://My-Bucket/atlases"), { value: "s3://my-bucket/atlases/", error: "" });
  assert.equal(normalisePrefix("  https://Data.Example.org/zarr//v1/  ").value, "https://data.example.org/zarr/v1/");
  assert.equal(normalisePrefix("gs://bucket").value, "gs://bucket/");
  assert.equal(normalisePrefix("http://localhost:9000/z").value, "http://localhost:9000/z/");
});

test("a location is refused when the scheme, host or shape is wrong", () => {
  const bad = {
    "": /Enter a location/, "ftp://host/x": /Start with/, "host/path": /Start with/, "s3://": /host or bucket/,
    "https://user:pw@host/z/": /credentials/, "https://host/z/?sig=1": /query/, "https://host/z#f": /query/,
    "https://host/a/../b/": /'\.\.'/, "https://host/./b/": /'\.'/, "https://ho st/z/": /spaces/,
  };
  for (const [text, pattern] of Object.entries(bad)) {
    const out = normalisePrefix(text);
    assert.equal(out.value, "", text);
    assert.match(out.error, pattern, text);
  }
});

test("adding keeps the order, drops duplicates and leaves the list alone on an error", () => {
  const list = ["s3://a/"];
  assert.deepEqual(addPrefix(list, "s3://b/x").list, ["s3://a/", "s3://b/x/"]);
  assert.deepEqual(addPrefix(list, "S3://A").list, ["s3://a/"]);
  const refused = addPrefix(list, "nope");
  assert.equal(refused.list, list);
  assert.ok(refused.error);
});

test("a prefix is inside another only on a folder boundary", () => {
  assert.ok(isInside("s3://b/a/x/", "s3://b/a/"));
  assert.ok(!isInside("s3://b/ab/", "s3://b/a/"));
});

test("which states the configuration leaves open", () => {
  assert.deepEqual(optionStates(key()), { off: "", allowlist: "", any: "", all: "" });
  const deny = optionStates(key({ source: "config", config_value: OFF, config_origin: "config" }));
  assert.match(deny.all, /turns remote datasets off/);
  assert.ok(deny.off && deny.allowlist && deny.any, "nothing can be picked");
  const envDeny = optionStates(key({ source: "env", config_value: OFF, config_origin: "env" }));
  assert.match(envDeny.all, /ANNZARRO_REMOTE_STORES/);
  const limited = optionStates(key({ config_value: allow("s3://lab/"), config_origin: "config", source: "config", value: allow("s3://lab/") }));
  assert.equal(limited.all, "");
  assert.match(limited.any, /s3:\/\/lab\//);
  assert.equal(limited.off + limited.allowlist, "");
  assert.match(optionStates(key({ locked: true })).all, /policy\.locked/);
  assert.deepEqual(optionStates(key({ source: "config", config_value: ANY })), { off: "", allowlist: "", any: "", all: "" });
});

test("the source sentence names where the value came from", () => {
  assert.match(sourceText(key()), /Default/);
  assert.match(sourceText(key({ source: "admin" })), /administrator/);
  assert.match(sourceText(key({ source: "env", config_origin: "env" })), /environment/);
  assert.match(sourceText(key({ source: "config" })), /configuration file/);
  assert.match(sourceText(key({ source: "admin", config_value: ANY })), /narrowed, not widened/);
  assert.match(sourceText(key({ locked: true })), /Locked/);
});

test("values are compared by mode and list", () => {
  assert.ok(sameAccess(OFF, { mode: "off" }));
  assert.ok(!sameAccess(allow("a"), allow("b")));
});

// -- the card ------------------------------------------------------------------

function card(k, over = {}) {
  const saved = [];
  const el = document.createElement("div");
  renderRemoteDatasets(el, k, {
    save: async (v) => { saved.push(v); },
    reset: async () => { saved.push(null); },
    ...over,
  });
  return { el, saved };
}
const byId = (el, id) => find(el, (n) => n.id === id);
const radio = (el, mode) => find(el, (n) => n.getAttribute && n.getAttribute("data-mode") === mode);

test("Off is shown selected by default, with no warning and Save disabled", () => {
  const { el } = card(key());
  assert.equal(radio(el, "off").checked, true);
  assert.equal(byId(el, "remote-any-warning"), null);
  assert.equal(byId(el, "remote-save").disabled, true);
  assert.match(el.textContent, /Does not affect Gene Set Analysis/);
});

test("choosing Any location shows the warning about internal addresses, and Save sends it", async () => {
  const { el, saved } = card(key());
  radio(el, "any").checked = true;
  await radio(el, "any").dispatch("change");
  assert.match(byId(el, "remote-any-warning").textContent, /internal network/);
  assert.equal(byId(el, "remote-save").disabled, false);
  await byId(el, "remote-save").dispatch("click");
  assert.deepEqual(saved, [ANY]);
});

test("the allowlist editor adds normalised locations, refuses bad ones and needs one before Save", async () => {
  const { el, saved } = card(key());
  await radio(el, "allowlist").dispatch("change");
  assert.equal(byId(el, "remote-save").disabled, true, "an empty allowlist cannot be saved");
  const input = byId(el, "remote-prefix");
  input.value = "ftp://x/";
  await byId(el, "remote-add").dispatch("click");
  assert.match(el.textContent, /Start with/);
  byId(el, "remote-prefix").value = "S3://Lab/atlases";
  await byId(el, "remote-add").dispatch("click");
  assert.ok(find(el, (n) => n.getAttribute && n.getAttribute("data-prefix") === "s3://lab/atlases/"));
  await byId(el, "remote-save").dispatch("click");
  assert.deepEqual(saved, [allow("s3://lab/atlases/")]);
});

test("a location outside the configured allowlist is refused in the editor", async () => {
  const k = key({ value: allow("s3://lab/"), config_value: allow("s3://lab/"), source: "config", config_origin: "config" });
  const { el } = card(k);
  byId(el, "remote-prefix").value = "s3://other/";
  await byId(el, "remote-add").dispatch("click");
  assert.match(el.textContent, /outside what the configuration file/);
  assert.equal(find(el, (n) => n.getAttribute && n.getAttribute("data-prefix") === "s3://other/"), null);
  assert.equal(radio(el, "any").disabled, true);
});

test("a configuration that turns it off locks the whole card and shows why", () => {
  const { el } = card(key({ source: "config", config_value: OFF, config_origin: "config" }));
  assert.equal(radio(el, "any").disabled, true);
  assert.equal(radio(el, "off").disabled, true);
  assert.equal(byId(el, "remote-save"), null);
  assert.match(byId(el, "remote-locked").textContent, /Change it there and restart/);
});

test("a refused save is shown on the card and the draft is kept", async () => {
  const { el } = card(key(), { save: async () => { throw new Error("remote_stores cannot be widened"); } });
  await radio(el, "any").dispatch("change");
  await byId(el, "remote-save").dispatch("click");
  assert.match(el.textContent, /cannot be widened/);
  assert.equal(radio(el, "any").checked, true);
});

test("an administrator setting can be reset to the default", async () => {
  const { el, saved } = card(key({ source: "admin", value: ANY }));
  assert.ok(byId(el, "remote-any-warning"), "the warning stays while Any location is in force");
  await byId(el, "remote-reset").dispatch("click");
  assert.deepEqual(saved, [null]);
});
