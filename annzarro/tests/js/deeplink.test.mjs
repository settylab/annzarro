// Serialization guard for the deep-link `view` schema (the future-proof layout
// tree). Pins the unified-serialization contract from utils/deeplink.js:
//
//   * encodeView ↔ decodeView round-trips a full layout hierarchy losslessly
//     (this is the "save layout → link" / "open link → restore" symmetry);
//   * normalizeView version-stamps, prefers `layout` over the legacy `panels`
//     shorthand, keeps `panels` when that's all there is, and degrades an
//     empty/selector-only layout so the boot falls back to Welcome;
//   * panelTypeFromTileId / collectTileIds derive the right panel types from a
//     multi-panel split spec — i.e. a split tree "opens the right tree".
//
// Pure JS, no DOM — the DOM restore path (restoreLayout) is exercised separately
// in the browser; here we lock the serialization layer the link rides on.
//
// Run: `node --test annzarro/tests/js/deeplink.test.mjs` (node >= 18). Also
// driven by the pytest wrapper test_js_deeplink.py.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.resolve(
  __dirname,
  "../../../static/js/utils/deeplink.js"
);

const {
  VIEW_SCHEMA_VERSION,
  encodeView,
  decodeView,
  normalizeView,
  panelTypeFromTileId,
  collectTileIds,
  layoutHasPanels,
} = await import(pathToFileURL(MODULE_PATH).href);

// A representative two-pane split: a cell-plot beside a gene-table, 60/40.
function sampleLayoutView() {
  return {
    v: 1,
    constants: { focusedGene: "GeneA", focusedCell: "cell-7", taxonomyId: "tax-1" },
    layout: {
      v: 1,
      hierarchy: [
        {
          type: "split",
          direction: "horizontal",
          panes: [
            { percentage: 60, controlsVisible: true },
            { percentage: 40, controlsVisible: false },
          ],
          children: [
            { type: "tile", id: "cell-plot-1718000000001", controlsVisible: true },
            { type: "tile", id: "gene-table-1718000000002", controlsVisible: false },
          ],
        },
      ],
      controlState: {
        "cell-plot-1718000000001": true,
        "gene-table-1718000000002": false,
      },
      panelConfigs: {
        "cell-plot-1718000000001": { id: "cell-plot-1718000000001", title: "Cells", colorBy: "leiden" },
        "gene-table-1718000000002": { id: "gene-table-1718000000002", title: "Genes" },
      },
    },
  };
}

test("encodeView → decodeView round-trips a layout tree losslessly", () => {
  const view = sampleLayoutView();
  const encoded = encodeView(view);
  assert.equal(typeof encoded, "string");
  // base64url: no '+', '/', or '=' padding.
  assert.ok(!/[+/=]/.test(encoded), `not base64url-clean: ${encoded}`);
  const decoded = decodeView(encoded);
  assert.deepEqual(decoded, view);
});

test("round-trip survives non-ASCII (UTF-8 gene symbols)", () => {
  const view = { v: 1, constants: { focusedGene: "Iβ-µ✦" }, panels: [] };
  assert.deepEqual(decodeView(encodeView(view)), view);
});

test("normalizeView stamps the current schema version", () => {
  const n = normalizeView({ constants: { focusedGene: "G" } });
  assert.equal(n.v, VIEW_SCHEMA_VERSION);
});

test("normalizeView prefers a populated layout over the legacy panels list", () => {
  const view = sampleLayoutView();
  view.panels = [{ type: "cell_plot", config: {} }]; // both present
  const n = normalizeView(view);
  assert.ok(n.layout, "layout must win when both layout and panels are present");
  assert.ok(!("panels" in n), "panels must be dropped when layout is chosen");
});

test("normalizeView keeps the legacy panels shorthand when no layout", () => {
  const n = normalizeView({ panels: [{ type: "gene_plot", config: { gene: "X" } }] });
  assert.ok(Array.isArray(n.panels) && n.panels.length === 1);
  assert.ok(!("layout" in n));
});

test("normalizeView degrades an empty/selector-only layout (Welcome fallback)", () => {
  // A layout that opens no panel must NOT be surfaced as a layout — otherwise
  // the boot restores an empty shell and the spinner-fallback can't kick in.
  const emptyish = {
    v: 1,
    layout: { v: 1, hierarchy: [{ type: "selector" }], controlState: {}, panelConfigs: {} },
  };
  const n = normalizeView(emptyish);
  assert.ok(!("layout" in n), "selector-only layout must not be surfaced");
  assert.ok(!("panels" in n), "and there is no panels shorthand to fall back to");
});

test("normalizeView returns null for junk input", () => {
  assert.equal(normalizeView(null), null);
  assert.equal(normalizeView(42), null);
});

test("panelTypeFromTileId derives the registered type from a tile id", () => {
  assert.equal(panelTypeFromTileId("cell-plot-1718000000001"), "cell-plot");
  assert.equal(panelTypeFromTileId("gene-table-99"), "gene-table");
  assert.equal(panelTypeFromTileId("gene-set-1"), "gene-set");
});

test("a multi-panel split spec opens the right tree (ids → types)", () => {
  const { layout } = sampleLayoutView();
  const ids = collectTileIds(layout.hierarchy);
  assert.deepEqual(ids, [
    "cell-plot-1718000000001",
    "gene-table-1718000000002",
  ]);
  const types = ids.map(panelTypeFromTileId);
  assert.deepEqual(types, ["cell-plot", "gene-table"]);
  assert.ok(layoutHasPanels(layout));
});

test("collectTileIds walks nested splits depth-first, skipping selectors", () => {
  const hierarchy = [
    {
      type: "split",
      direction: "vertical",
      panes: [{ percentage: 50 }, { percentage: 50 }],
      children: [
        { type: "tile", id: "cell-plot-1" },
        {
          type: "split",
          direction: "horizontal",
          panes: [{ percentage: 30 }, { percentage: 70 }],
          children: [
            { type: "tile", id: "gene-plot-2" },
            { type: "selector" },
          ],
        },
      ],
    },
  ];
  assert.deepEqual(collectTileIds(hierarchy), ["cell-plot-1", "gene-plot-2"]);
});
