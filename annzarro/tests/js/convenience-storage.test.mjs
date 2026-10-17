import { test } from "node:test";
import assert from "node:assert/strict";

const { persistentConvenience, convenienceStorage, dropPersistentConvenience } =
  await import("../../../static/js/utils/convenience-storage.js");

class Store {
  constructor(items = {}) { this.items = new Map(Object.entries(items)); }
  get length() { return this.items.size; }
  key(i) { return [...this.items.keys()][i] ?? null; }
  getItem(k) { return this.items.has(k) ? this.items.get(k) : null; }
  setItem(k, v) { this.items.set(k, String(v)); }
  removeItem(k) { this.items.delete(k); }
}

const win = (local = {}) => ({ localStorage: new Store(local), sessionStorage: new Store() });

test("persistent by default: no site section, an empty one, or the setting true", () => {
  for (const config of [undefined, {}, { site: {} }, { site: { storage: {} } }, { site: { storage: { persistent_convenience: true } } }]) {
    assert.equal(persistentConvenience(config), true);
  }
});

test("only an explicit false makes it session-only", () => {
  assert.equal(persistentConvenience({ site: { storage: { persistent_convenience: false } } }), false);
  assert.equal(persistentConvenience({ site: { storage: { persistent_convenience: null } } }), true);
});

test("convenience data goes to localStorage, or sessionStorage on a session-only site", () => {
  const w = win();
  assert.equal(convenienceStorage({}, w), w.localStorage);
  assert.equal(convenienceStorage({ site: { storage: { persistent_convenience: false } } }, w), w.sessionStorage);
});

test("blocked storage gives null, not an exception", () => {
  const w = { get localStorage() { throw new Error("blocked"); } };
  assert.equal(convenienceStorage({}, w), null);
});

test("a session-only site forgets what an earlier visit left, and nothing else", () => {
  const w = win({
    annzarro_autosave: "{}", "annzarro.recents:http://x|local": "[]", "annzarro.recentDatasets:http://x": "[]",
    "annzarro.pins:http://x|local": "[]", "annzarro-theme": "dark", "annzarro:external-ok": "{}", other: "1",
  });
  const off = { site: { storage: { persistent_convenience: false } } };
  const removed = dropPersistentConvenience(off, "annzarro_autosave", w);
  assert.deepEqual(removed.sort(), ["annzarro.recentDatasets:http://x", "annzarro.recents:http://x|local", "annzarro_autosave"]);
  assert.deepEqual([...w.localStorage.items.keys()].sort(),
    ["annzarro-theme", "annzarro.pins:http://x|local", "annzarro:external-ok", "other"]);
});

test("a persistent site forgets nothing", () => {
  const w = win({ annzarro_autosave: "{}" });
  assert.deepEqual(dropPersistentConvenience({}, "annzarro_autosave", w), []);
  assert.equal(w.localStorage.getItem("annzarro_autosave"), "{}");
});
