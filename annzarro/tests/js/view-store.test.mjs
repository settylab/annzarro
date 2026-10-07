// Which store a saved view belongs to (static/js/utils/view-store.js): the
// record a link or panel set carries, the two-tier fingerprint comparison,
// what the user is told, and which store of the data directory a view whose
// path is not here opens on.
//
// Run: `node --test annzarro/tests/js/view-store.test.mjs`
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vs = await import(pathToFileURL(path.resolve(__dirname, "../../../static/js/utils/view-store.js")).href);
const dl = await import(pathToFileURL(path.resolve(__dirname, "../../../static/js/utils/deeplink.js")).href);

const FP = {
  v: 1, n_obs: 200, n_var: 20, cells: "c".repeat(32), genes: "g".repeat(32), data: "d".repeat(32),
  meta: "m".repeat(32), groups: { obs: "11111111", var: "22222222", obsm: "33333333", "/": "44444444" },
  fields: { obs: ["_index", "cell_type", "leiden"], var: ["_index"], obsm: ["X_umap"] },
};

test("storeRecord: relative path inside the data directory, absolute kept as a hint", () => {
  const rec = vs.storeRecord({ path: "/srv/data/bm.zarr", relPath: "bm.zarr", fingerprint: { ...FP, extra: 1 } });
  assert.equal(rec.path, "bm.zarr");
  assert.equal(rec.abs, "/srv/data/bm.zarr");
  assert.equal(rec.name, "bm.zarr");
  assert.deepEqual(Object.keys(rec.fp).sort(), ["cells", "data", "fields", "genes", "groups", "meta", "n_obs", "n_var", "v"]);
});

test("storeRecord: outside the data directory (desktop, admin) keeps the absolute path", () => {
  const rec = vs.storeRecord({ path: "/home/me/x.zarr/", relPath: null, fingerprint: null });
  assert.equal(rec.path, "/home/me/x.zarr/");
  assert.equal(rec.abs, undefined);
  assert.equal(rec.name, "x.zarr");
  assert.equal(rec.fp, undefined);
});

test("compare: no fingerprint (a view from before v0.4.1) is unknown and says nothing", () => {
  const cmp = vs.compareStores(undefined, FP);
  assert.equal(cmp.level, "unknown");
  assert.equal(vs.describeComparison(cmp, "x"), null);
  assert.equal(vs.compareStores({ ...FP, v: 99 }, FP).level, "unknown");
});

test("compare: the same store is silent", () => {
  const cmp = vs.compareStores(FP, { ...FP });
  assert.equal(cmp.level, "same");
  assert.equal(cmp.dataKnown, true);
  assert.equal(vs.describeComparison(cmp, "x"), null);
});

test("compare: other counts are a strong warning, before the names are hashed", () => {
  const pending = { v: 1, n_obs: 300, n_var: 20, meta: "z".repeat(32), groups: {}, fields: {} };
  const cmp = vs.compareStores(FP, pending);
  assert.equal(cmp.level, "different");
  assert.equal(cmp.cells, true);
  assert.equal(cmp.genes, false);
  const said = vs.describeComparison(cmp, "/srv/x.zarr");
  assert.equal(said.strong, true);
  assert.match(said.title, /differs from the one the view was saved on/);
  assert.match(said.message, /200 cells x 20 genes/);
  assert.match(said.message, /300 cells x 20 genes/);
});

test("compare: same counts, other cell names is a strong warning naming the cells", () => {
  const cmp = vs.compareStores(FP, { ...FP, cells: "x".repeat(32), data: "y".repeat(32) });
  assert.equal(cmp.level, "different");
  assert.equal(cmp.cells, true);
  assert.equal(cmp.genes, false);
  assert.match(vs.describeComparison(cmp, "s").message, /other cells than/);
});

test("compare: one obs column more is the mild notice naming it", () => {
  const current = { ...FP, meta: "n".repeat(32), groups: { ...FP.groups, obs: "99999999" },
    fields: { ...FP.fields, obs: [...FP.fields.obs, "new_col"] } };
  const cmp = vs.compareStores(FP, current);
  assert.equal(cmp.level, "fields");
  assert.deepEqual(cmp.changes, ["obs/new_col added"]);
  const said = vs.describeComparison(cmp, "s");
  assert.equal(said.strong, false);
  assert.match(said.message, /Same cells and genes as when this view was saved; fields differ: obs\/new_col added/);
});

test("fieldChanges: missing fields, and groups changed with the same names", () => {
  const current = { ...FP, groups: { ...FP.groups, obsm: "00000000", var: "77777777" },
    fields: { ...FP.fields, obs: ["_index", "cell_type"] } };
  assert.deepEqual(vs.fieldChanges(FP, current), ["obs/leiden is not in this store", "obsm changed", "var changed"]);
  const noLayers = { ...FP, groups: { ...FP.groups } };
  delete noLayers.groups.obsm;
  assert.ok(vs.fieldChanges(FP, noLayers).includes("obsm is not in this store"));
});

test("compare: a large store still hashing compares counts and fields only", () => {
  const pending = { v: 1, n_obs: 200, n_var: 20, meta: FP.meta, groups: FP.groups, fields: FP.fields };
  const cmp = vs.compareStores(FP, pending);
  assert.equal(cmp.level, "same");
  assert.equal(cmp.dataKnown, false);
  const fields = vs.compareStores(FP, { ...pending, meta: "q".repeat(32) });
  assert.equal(fields.level, "fields");
  assert.match(vs.describeComparison(fields, "s").title, /Same size/);
});

test("versionNotice", () => {
  assert.equal(vs.versionNotice("0.4.1", "0.4.1"), null);
  assert.equal(vs.versionNotice(undefined, "0.4.1"), null);
  assert.equal(vs.versionNotice("0.4.1", "0.5.0"),
    "Saved with AnnZarro 0.4.1; this is 0.5.0. The view may look different.");
});

const entries = () => [
  { path: "/d/a.zarr", name: "a.zarr", cells: 200, genes: 20 },
  { path: "/d/bm.zarr", name: "bm.zarr", cells: 999, genes: 20 },
  { path: "/d/copy.zarr", name: "copy.zarr", cells: 200, genes: 20 },
  { path: "/d/z.zarr", name: "z.zarr", cells: 5, genes: 5 },
];

test("orderCandidates: same cells and genes first, then same name, then the rest", () => {
  const list = entries();
  list[2].cmp = vs.compareStores(FP, FP);
  list[0].cmp = vs.compareStores(FP, { ...FP, data: "e".repeat(32), cells: "e".repeat(32) });
  list[1].cmp = vs.compareStores(FP, { ...FP, n_obs: 999 });
  const ordered = vs.orderCandidates(list, { path: "bm.zarr", name: "bm.zarr", fp: FP });
  assert.deepEqual(ordered.map(e => [e.name, e.match]),
    [["copy.zarr", "same"], ["bm.zarr", "name-different"], ["a.zarr", "different"], ["z.zarr", "other"]]);
  assert.equal(vs.automaticCandidate(ordered, { path: "bm.zarr", name: "bm.zarr", fp: FP }).name, "copy.zarr");
});

test("automaticCandidate: two matches, the one with the saved name wins; else ask", () => {
  const list = entries().map(e => ({ ...e, cmp: vs.compareStores(FP, FP) }));
  list[3].cmp = vs.compareStores(FP, { ...FP, n_obs: 5, n_var: 5 });
  list[1].cmp = vs.compareStores(FP, { ...FP, n_obs: 999 });
  const saved = { path: "copy.zarr", name: "copy.zarr", fp: FP };
  assert.equal(vs.automaticCandidate(vs.orderCandidates(list, saved), saved).name, "copy.zarr");
  const other = { path: "q.zarr", name: "q.zarr", fp: FP };
  assert.equal(vs.automaticCandidate(vs.orderCandidates(list, other), other), null);
});

test("automaticCandidate: without a fingerprint, the one store with the saved name", () => {
  const saved = vs.savedStoreOf(null, "/old/server/path/bm.zarr");
  assert.deepEqual(saved, { path: "/old/server/path/bm.zarr", name: "bm.zarr" });
  assert.equal(vs.automaticCandidate(vs.orderCandidates(entries(), saved), saved).path, "/d/bm.zarr");
  assert.equal(vs.automaticCandidate(vs.orderCandidates(entries(), vs.savedStoreOf(null, "nope.zarr")),
    vs.savedStoreOf(null, "nope.zarr")), null);
});

test("automaticCandidate: with a fingerprint, a store of that name with other cells is not opened silently", () => {
  const list = entries();
  list[1].cmp = vs.compareStores(FP, { ...FP, n_obs: 999 });
  const saved = { path: "bm.zarr", name: "bm.zarr", fp: FP };
  assert.equal(vs.automaticCandidate(vs.orderCandidates(list, saved), saved), null);
});

test("normalizeView keeps the store and the version a view was saved with", () => {
  const store = { path: "bm.zarr", abs: "/srv/bm.zarr", name: "bm.zarr", fp: FP };
  const view = dl.normalizeView({ v: 1, store, annzarro: "0.4.1",
    layout: { v: 1, hierarchy: [{ type: "tile", id: "cell-plot-1" }], panelConfigs: {} } });
  assert.deepEqual(view.store, store);
  assert.equal(view.annzarro, "0.4.1");
  const old = dl.normalizeView({ v: 1, layout: { v: 1, hierarchy: [{ type: "tile", id: "cell-plot-1" }] } });
  assert.equal(old.store, undefined);
  assert.equal(old.annzarro, undefined);
});
