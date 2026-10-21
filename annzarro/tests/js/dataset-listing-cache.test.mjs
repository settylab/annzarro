import { test } from "node:test";
import assert from "node:assert/strict";

const {
  createListingCache, listingId, listingsKey,
  LISTINGS_LIMIT, LISTING_ENTRIES_LIMIT, LISTINGS_MAX_CHARS
} = await import("../../../static/js/utils/dataset-listing-cache.js");

class Store {
  constructor() { this.items = new Map(); }
  get length() { return this.items.size; }
  key(i) { return [...this.items.keys()][i] ?? null; }
  getItem(k) { return this.items.has(k) ? this.items.get(k) : null; }
  setItem(k, v) { this.items.set(k, String(v)); }
  removeItem(k) { this.items.delete(k); }
}

const entry = (name, extra = {}) => ({ path: `/data/${name}`, name, kind: "store", ...extra });
const page = (names, extra = {}) => ({ entries: names.map(n => entry(n)), total: names.length, parent: null, rel: "", folder: "/data", ...extra });
const SCOPE = "http://host:8000/explore";
const make = (storage = new Store(), scope = SCOPE) => ({ storage, cache: createListingCache({ storage, scope }) });

test("a listing put is got back, in the same tab and after a reload", () => {
  const { storage, cache } = make();
  const id = listingId("", { key: "name", dir: "asc" });
  assert.equal(cache.get("local", id), null);
  assert.equal(cache.put("local", id, page(["a.zarr", "b.zarr"])), true);
  assert.deepEqual(cache.get("local", id).entries.map(e => e.name), ["a.zarr", "b.zarr"]);
  const reloaded = createListingCache({ storage, scope: SCOPE });      // a new page: memory empty, storage kept
  assert.deepEqual(reloaded.get("local", id).entries.map(e => e.name), ["a.zarr", "b.zarr"]);
});

test("the id tells folders and sorts apart", () => {
  assert.notEqual(listingId("", null), listingId("/data/x", null));
  assert.notEqual(listingId("", { key: "name", dir: "asc" }), listingId("", { key: "name", dir: "desc" }));
  assert.equal(listingId("", { key: null }), listingId("", null));
  const { cache } = make();
  cache.put("local", listingId("/data/x", null), page(["x.zarr"]));
  assert.equal(cache.get("local", listingId("", null)), null);
});

test("keyed by server (origin and URL prefix) and by user", () => {
  const storage = new Store();
  const id = listingId("", null);
  createListingCache({ storage, scope: SCOPE }).put("user:ann", id, page(["a.zarr"]));
  assert.ok(storage.getItem(listingsKey(SCOPE, "user:ann")));
  assert.equal(createListingCache({ storage, scope: "http://host:8000" }).get("user:ann", id), null, "another prefix");
  assert.equal(createListingCache({ storage, scope: "http://other:8000/explore" }).get("user:ann", id), null, "another origin");
  assert.ok(createListingCache({ storage, scope: SCOPE }).get("user:ann", id));
  assert.equal(createListingCache({ storage, scope: SCOPE }).get("user:bob", id), null, "another user");
});

test("when the user changes, what was held is dropped from memory and from storage", () => {
  const { storage, cache } = make();
  const id = listingId("", null);
  cache.put("user:ann", id, page(["secret.zarr"]));
  assert.equal(cache.get("user:bob", id), null);
  assert.equal(storage.getItem(listingsKey(SCOPE, "user:ann")), null);
  assert.equal(cache.get("user:ann", id), null, "not back for the first user either");
  assert.equal(cache.size(), 0);
});

test("a new page that learns of another user drops the one signed in before, of this server only", () => {
  const storage = new Store();
  const id = listingId("", null);
  createListingCache({ storage, scope: SCOPE }).put("user:ann", id, page(["a.zarr"]));
  createListingCache({ storage, scope: "http://other:1" }).put("user:ann", id, page(["a.zarr"]));
  const next = createListingCache({ storage, scope: SCOPE });
  assert.equal(next.get("user:bob", id), null);
  assert.equal(storage.getItem(listingsKey(SCOPE, "user:ann")), null);
  assert.ok(storage.getItem(listingsKey("http://other:1", "user:ann")), "another server's key is left alone");
  assert.ok(createListingCache({ storage, scope: "http://other:1" }).get("user:ann", id));
});

test("bounded: at most LISTINGS_LIMIT listings, the oldest go first", () => {
  let t = 0;
  const storage = new Store();
  const cache = createListingCache({ storage, scope: SCOPE, now: () => ++t });
  for (let i = 0; i < LISTINGS_LIMIT + 5; i++) cache.put("local", listingId(`/d/${i}`, null), page(["a.zarr"]));
  assert.equal(cache.size(), LISTINGS_LIMIT);
  assert.equal(cache.get("local", listingId("/d/0", null)), null);
  assert.ok(cache.get("local", listingId(`/d/${LISTINGS_LIMIT + 4}`, null)));
  assert.equal(JSON.parse(storage.getItem(listingsKey(SCOPE, "local"))).items.length, LISTINGS_LIMIT);
});

test("bounded: a listing keeps at most LISTING_ENTRIES_LIMIT entries and says there are more", () => {
  const { cache } = make();
  const names = Array.from({ length: LISTING_ENTRIES_LIMIT + 30 }, (_, i) => `s${i}.zarr`);
  cache.put("local", "x", page(names));
  const got = cache.get("local", "x");
  assert.equal(got.entries.length, LISTING_ENTRIES_LIMIT);
  assert.equal(got.total, names.length);
  assert.equal(got.more, true);
});

test("bounded: storage holds at most LISTINGS_MAX_CHARS characters", () => {
  const { storage, cache } = make();
  const fat = { description: "x".repeat(2000) };
  for (let i = 0; i < 30; i++) {
    cache.put("local", listingId(`/d/${i}`, null), { ...page([]), entries: Array.from({ length: 100 }, (_, j) => entry(`s${j}`, fat)), total: 100 });
  }
  const text = storage.getItem(listingsKey(SCOPE, "local"));
  assert.ok(text.length <= LISTINGS_MAX_CHARS, `${text.length} chars`);
  assert.ok(JSON.parse(text).items.length >= 1);
  assert.ok(cache.get("local", listingId("/d/29", null)), "the newest stays");
});

test("a drop forgets one listing, a clear forgets the user's", () => {
  const { storage, cache } = make();
  cache.put("local", "a", page(["a.zarr"]));
  cache.put("local", "b", page(["b.zarr"]));
  cache.drop("local", "a");
  assert.equal(cache.get("local", "a"), null);
  assert.ok(cache.get("local", "b"));
  cache.clear("local");
  assert.equal(cache.get("local", "b"), null);
  assert.equal(storage.getItem(listingsKey(SCOPE, "local")), null);
});

test("broken or foreign storage content is ignored, blocked storage still serves the tab", () => {
  const storage = new Store();
  storage.setItem(listingsKey(SCOPE, "local"), "{not json");
  assert.equal(createListingCache({ storage, scope: SCOPE }).get("local", "a"), null);
  storage.setItem(listingsKey(SCOPE, "local"), JSON.stringify({ v: 2, items: [{ id: "a", listing: page(["a"]) }] }));
  assert.equal(createListingCache({ storage, scope: SCOPE }).get("local", "a"), null);
  storage.setItem(listingsKey(SCOPE, "local"), JSON.stringify({ v: 1, items: [{ id: "a", listing: { entries: [{ nope: 1 }, entry("ok.zarr")] } }, { id: 5 }, null] }));
  assert.deepEqual(createListingCache({ storage, scope: SCOPE }).get("local", "a").entries.map(e => e.name), ["ok.zarr"]);
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("blocked"); } };
  const cache = createListingCache({ storage: blocked, scope: SCOPE });
  assert.equal(cache.put("local", "a", page(["a.zarr"])), true);
  assert.ok(cache.get("local", "a"));
  assert.equal(createListingCache({ storage: null, scope: SCOPE }).get("local", "a"), null);
});
