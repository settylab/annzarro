// The address bar follows the view: syncedLocation (utils/deeplink.js) is the
// pure rule for what the URL becomes.
//
//   * with a payload, #view= carries it and dataset_path names the store;
//   * other query parameters survive, the legacy ?view= is dropped;
//   * with no payload (no panel open) the fragment goes: the clean link;
//   * an address that already is the result gives null (no replaceState);
//   * what it writes is read back by parseDeepLinkLocation.
//
// Run: `node --test annzarro/tests/js/url-sync.test.mjs`.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { syncedLocation, parseDeepLinkLocation, encodeViewPayload, decodeViewPayload } = await import(
  pathToFileURL(path.resolve(__dirname, "../../../static/js/utils/deeplink.js")).href
);

const BASE = "http://host:8000/explore/";

test("a changed view replaces the shared fragment, keeping other parameters", () => {
  const next = syncedLocation(`${BASE}?dataset_path=a.zarr&token=7#view=z1.OLD`, "a.zarr", "z1.NEW");
  assert.equal(next, "/explore/?dataset_path=a.zarr&token=7#view=z1.NEW");
});

test("the dataset follows the store of the view", () => {
  const next = syncedLocation(`${BASE}?dataset_path=a.zarr#view=z1.OLD`, "b.zarr", "z1.NEW");
  assert.equal(next, "/explore/?dataset_path=b.zarr#view=z1.NEW");
});

test("a view on a bare address adds dataset_path and the fragment", () => {
  assert.equal(syncedLocation(BASE, "a.zarr", "z1.X"), "/explore/?dataset_path=a.zarr#view=z1.X");
});

test("the legacy ?view= query is dropped for the fragment", () => {
  const next = syncedLocation(`${BASE}?dataset_path=a.zarr&view=OLDB64`, "a.zarr", "z1.X");
  assert.equal(next, "/explore/?dataset_path=a.zarr#view=z1.X");
});

test("no payload removes the view: the clean link", () => {
  assert.equal(syncedLocation(`${BASE}?dataset_path=a.zarr&x=1#view=z1.OLD`, "a.zarr", null),
    "/explore/?dataset_path=a.zarr&x=1");
  assert.equal(syncedLocation(`${BASE}?dataset_path=a.zarr&view=OLDB64`, "a.zarr", null),
    "/explore/?dataset_path=a.zarr");
});

test("an address that already is the result is left alone", () => {
  assert.equal(syncedLocation(`${BASE}?dataset_path=a.zarr#view=z1.X`, "a.zarr", "z1.X"), null);
  assert.equal(syncedLocation(`${BASE}?dataset_path=a.zarr`, "a.zarr", null), null);
  assert.equal(syncedLocation(BASE, "", null), null);
});

test("a real payload and an awkward dataset path round-trip through the address", async () => {
  const view = { v: 1, layout: { v: 1, hierarchy: [{ type: "tile", id: "cell-plot-1" }], panelConfigs: {} } };
  const payload = await encodeViewPayload(view);
  const store = "/data/my set/a&b.zarr";
  const next = syncedLocation(BASE, store, payload);
  const loc = new URL(next, BASE);
  const parts = parseDeepLinkLocation({ search: loc.search, hash: loc.hash });
  assert.equal(parts.datasetPath, store);
  assert.deepEqual(await decodeViewPayload(parts.payload), view);
});
