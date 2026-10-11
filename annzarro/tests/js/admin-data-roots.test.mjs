// The Data directories section: add by typing or browsing, remove with a
// confirmation, a paged look at a root's datasets. API calls are recorded.
// Run: `node --test annzarro/tests/js/admin-data-roots.test.mjs`.
import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { find, findAll, installFakeDocument, uninstallFakeDocument } from "./fake-dom.mjs";
import dataRoots, { inactiveText, storeText } from "../../../static/js/admin/data-roots.js";

let doc;
beforeEach(() => { doc = installFakeDocument(); });
afterEach(() => { uninstallFakeDocument(); });

const LISTING = {
  parents: [{ path: "/srv/atlases", ok: true }],
  roots: [
    { path: "/srv/data", real: "/srv/data", source: "data_dir", active: true, stores: 4 },
    { path: "/srv/atlases/lab2", real: "/srv/atlases/lab2", source: "admin", active: true, stores: 2, added_by: "alice", added_at: "2026-10-11T08:00:00+00:00" },
    { path: "/srv/atlases/old", real: "/srv/atlases/old", source: "admin", active: false, inactive_reason: "missing" },
  ],
};

function stubApi(overrides = {}) {
  const calls = [];
  const record = (name, result) => async (...args) => { calls.push([name, ...args]); return typeof result === "function" ? result(...args) : result; };
  const api = {
    dataRoots: {
      list: record("list", () => JSON.parse(JSON.stringify(LISTING))),
      browse: record("browse", (p) => (p ? { path: p, dirs: [{ name: "lab3", path: `${p}/lab3`, is_root: false }], capped: false }
        : { path: "", dirs: [{ name: "/srv/atlases", path: "/srv/atlases", is_root: false }], capped: false })),
      datasets: record("datasets", { entries: [
        { kind: "folder", name: "sub", path: "/srv/atlases/lab2/sub" },
        { kind: "store", name: "cells.zarr", path: "/srv/atlases/lab2/cells.zarr", cells: 1200, genes: 30, format: "zarr format 2" },
      ], total: 2, more: false }),
      add: record("add", {}),
      remove: record("remove", { removed: "x", panel_sets_affected: 2 }),
      ...overrides,
    },
  };
  return { api, calls };
}

const button = (root, action, path) => find(root, (n) => n.tagName === "BUTTON" && n.getAttribute("data-action") === action
  && (path === undefined || n.getAttribute("data-path") === path));

async function mounted(overrides, ctx = { toast: () => {} }) {
  const { api, calls } = stubApi(overrides);
  const el = doc.createElement("div");
  await dataRoots.mount(el, api, ctx);
  return { el, calls, ctx };
}

test("only admin-added roots can be removed, every active root can be looked into", async () => {
  const { el } = await mounted();
  assert.equal(button(el, "remove", "/srv/data"), null);
  assert.ok(button(el, "remove", "/srv/atlases/lab2"));
  assert.ok(button(el, "remove", "/srv/atlases/old"));
  assert.ok(button(el, "datasets", "/srv/data"));
  assert.equal(button(el, "datasets", "/srv/atlases/old"), null, "an inactive root has nothing to list");
  assert.match(el.textContent, /the directory is missing/);
});

test("remove asks first, then calls the API and reports the panel sets", async () => {
  const toasts = [];
  const { el, calls } = await mounted({}, { toast: (m, l) => toasts.push([m, l]) });
  await button(el, "remove", "/srv/atlases/lab2").dispatch("click");
  assert.deepEqual(calls.filter((c) => c[0] === "remove"), []);
  assert.match(el.textContent, /Users lose access/);
  await button(el, "confirm-remove", "/srv/atlases/lab2").dispatch("click");
  assert.deepEqual(calls.filter((c) => c[0] === "remove"), [["remove", "/srv/atlases/lab2"]]);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0][0], /Removed \/srv\/atlases\/lab2\. 2 saved panel sets/);
});

test("add by typing posts the trimmed path; a refusal is shown and nothing is cleared", async () => {
  const toasts = [];
  const refuse = async () => { throw new Error("That directory is not inside an allowed parent directory."); };
  const { el, calls } = await mounted({ add: refuse }, { toast: (m, l) => toasts.push([m, l]) });
  const input = find(el, (n) => n.id === "data-root-path");
  input.value = "  /etc  ";
  await input.dispatch("input");
  await find(el, (n) => n.id === "data-root-add-button").dispatch("click");
  assert.deepEqual(toasts, [["That directory is not inside an allowed parent directory.", "danger"]]);
  assert.equal(find(el, (n) => n.id === "data-root-path").value.trim(), "/etc");
  assert.equal(calls.filter((c) => c[0] === "list").length, 2, "the table is reloaded either way");
});

test("browsing starts at the parents, descends, and Use fills the field", async () => {
  const { el, calls } = await mounted();
  await find(el, (n) => n.id === "data-root-browse").dispatch("click");
  assert.deepEqual(calls.filter((c) => c[0] === "browse"), [["browse", ""]]);
  await button(el, "open-dir").dispatch("click");
  assert.deepEqual(calls.filter((c) => c[0] === "browse").pop(), ["browse", "/srv/atlases"]);
  await button(el, "use-dir").dispatch("click");
  assert.equal(find(el, (n) => n.id === "data-root-path").value, "/srv/atlases/lab3");
  await find(el, (n) => n.id === "data-root-add-button").dispatch("click");
  assert.deepEqual(calls.filter((c) => c[0] === "add"), [["add", "/srv/atlases/lab3"]]);
});

test("the datasets of a root are listed as text and folders descend", async () => {
  const { el, calls } = await mounted({
    datasets: async (q) => ({ entries: [{ kind: "store", name: "<img src=x onerror=alert(1)>", path: "/x", cells: 5, genes: 6, format: "h5ad" }], total: 1, more: false, q }),
  });
  await button(el, "datasets", "/srv/atlases/lab2").dispatch("click");
  const panel = find(el, (n) => n.id === "data-root-datasets");
  assert.match(panel.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(findAll(el, (n) => n.tagName === "IMG").length, 0);
  assert.match(panel.textContent, /5 cells x 6 genes, h5ad/);
  assert.ok(calls.some((c) => c[0] === "list"));
});

test("with no parents there is no add form", async () => {
  const { el } = await mounted({ list: async () => ({ parents: [], roots: [] }) });
  assert.equal(find(el, (n) => n.id === "data-root-add"), null);
  assert.match(el.textContent, /Adding directories is off/);
});

test("reason codes read as words, unknown ones as sent; store rows say why they cannot be read", () => {
  assert.equal(inactiveText("outside_parents"), "outside every allowed parent");
  assert.equal(inactiveText("something else"), "something else");
  assert.equal(storeText({ cells: 1200, genes: 30 }), "1,200 cells x 30 genes");
  assert.equal(storeText({ cells: null, error: "Not readable as an AnnData store" }), "Not readable as an AnnData store");
});
