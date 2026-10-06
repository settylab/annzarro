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
// driven by the pytest wrapper test_js_suites.py.
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

// ── payload codec + URL grammar ──────────────────────────────────────────────
//
// Share links carry `#view=z1.<base64url(deflate-raw(JSON))>`. The fragment
// keeps the view out of the request line (gunicorn rejects lines > 4094 bytes,
// which a two-panel view used to exceed), and deflate keeps the link pasteable.
// Legacy `?view=<base64url(JSON)>` links, which DoLiMap emits, must keep opening.

const {
  COMPRESSED_PREFIX,
  compressionSupported,
  encodeViewPayload,
  decodeViewPayload,
  parseDeepLinkLocation,
  buildDeepLinkUrl,
} = await import(pathToFileURL(MODULE_PATH).href);

// What saveLayout() emits for two cell-plots side by side, 55/45: the full
// getConfig() settings plus a cell subset, the shape that made a real 4.7 KB
// link. Barcodes come from a fixed LCG so they are realistic (poorly
// compressible) yet deterministic.
function realisticTwoPanelView() {
  let seed = 12345;
  const base = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return "ACGT"[seed % 4];
  };
  const barcodes = Array.from({ length: 40 }, () => Array.from({ length: 14 }, base).join("") + "-1");
  const cellPlot = (id, title, color) => ({
    id, title,
    x: { type: "obsm", key: "X_umap", dim: 0 },
    y: { type: "obsm", key: "X_umap", dim: 1 },
    z: null,
    color,
    pointSize: 5, pointOpacity: 0.7, colorScale: "Portland", categoryPalette: "uns",
    colorMin: null, colorMax: null, colorReversed: false,
    hoverInfo: [
      { type: "obs", key: "_index" }, { type: "obs", key: "leiden" },
      { type: "obs", key: "n_genes_by_counts" }, { type: "obs", key: "total_counts" },
      { type: "obs", key: "pct_counts_mt" },
    ],
    subsettedCells: barcodes, hideNonSubset: false, showGrid: true,
    lockColorRange: false, highlightFocusedCell: true, exportWidth: 1200, exportHeight: 800,
  });
  const a = "cell-plot-1759300000001";
  const b = "cell-plot-1759300000002";
  return {
    v: 1,
    constants: { focusedGene: "CD3E", focusedCell: "AAACATACAACCAC-1", taxonomyId: "9606" },
    layout: {
      v: 1,
      hierarchy: [
        {
          type: "split", direction: "horizontal",
          panes: [{ percentage: 55, controlsVisible: true }, { percentage: 45, controlsVisible: true }],
          children: [{ type: "tile", id: a, controlsVisible: true }, { type: "tile", id: b, controlsVisible: true }],
        },
        { type: "selector" },
      ],
      controlState: { [a]: true, [b]: true },
      panelConfigs: {
        [a]: cellPlot(a, "UMAP by cluster", { type: "obs", key: "leiden", column: "leiden" }),
        [b]: cellPlot(b, "UMAP by CD3E", { type: "gene", key: "CD3E", column: "" }),
      },
    },
  };
}

const needsDeflate = {
  skip: compressionSupported() ? false : "runtime lacks deflate-raw CompressionStream (Node < 21.2)",
};

test("compressed payload round-trips and carries the codec marker", needsDeflate, async () => {
  const view = realisticTwoPanelView();
  const payload = await encodeViewPayload(view);
  assert.ok(payload.startsWith(COMPRESSED_PREFIX), `missing marker: ${payload.slice(0, 8)}`);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(payload.slice(COMPRESSED_PREFIX.length)), "body not base64url-clean");
  assert.deepEqual(await decodeViewPayload(payload), view);
});

test("compressed payload survives non-ASCII gene symbols", needsDeflate, async () => {
  const view = { v: 1, constants: { focusedGene: "Iβ-µ✦" }, panels: [] };
  assert.deepEqual(await decodeViewPayload(await encodeViewPayload(view)), view);
});

test("decodeViewPayload still accepts the legacy uncompressed form", async () => {
  const view = sampleLayoutView();
  assert.deepEqual(await decodeViewPayload(encodeView(view)), view);
});

test("compression shrinks a realistic two-panel view to under half", needsDeflate, async () => {
  const view = realisticTwoPanelView();
  const legacy = encodeView(view);
  const compressed = await encodeViewPayload(view);
  // The legacy form must itself be the kind of link that blew gunicorn's
  // request line, or this measures nothing.
  assert.ok(legacy.length > 4094, `fixture not realistic: legacy is ${legacy.length} chars`);
  assert.ok(
    compressed.length < legacy.length * 0.5,
    `compressed ${compressed.length} vs legacy ${legacy.length}: expected < 50%`
  );
});

test("parseDeepLinkLocation reads the fragment form", () => {
  const url = new URL("https://host/annzarro/?dataset_path=data%2Fpbmc.zarr#view=z1.abc_-");
  assert.deepEqual(parseDeepLinkLocation(url), { datasetPath: "data/pbmc.zarr", payload: "z1.abc_-" });
});

test("parseDeepLinkLocation still reads the legacy ?view= query form", () => {
  const url = new URL("https://host/?dataset_path=x.zarr&view=eyJ2IjoxfQ");
  assert.deepEqual(parseDeepLinkLocation(url), { datasetPath: "x.zarr", payload: "eyJ2IjoxfQ" });
});

test("parseDeepLinkLocation prefers the fragment over a stale query view", () => {
  const url = new URL("https://host/?dataset_path=x.zarr&view=OLD#view=NEW");
  assert.equal(parseDeepLinkLocation(url).payload, "NEW");
});

test("parseDeepLinkLocation: bare dataset_path has no payload; no dataset_path is no deep link", () => {
  assert.deepEqual(
    parseDeepLinkLocation(new URL("https://host/?dataset_path=x.zarr")),
    { datasetPath: "x.zarr", payload: null }
  );
  assert.equal(parseDeepLinkLocation(new URL("https://host/#view=z1.abc")), null);
});

test("buildDeepLinkUrl puts the view in the fragment, never the query", async () => {
  const view = realisticTwoPanelView();
  const href = buildDeepLinkUrl(
    "https://host/annzarro/?stale=1#old", "data/pbmc 3k.zarr", await encodeViewPayload(view)
  );
  const url = new URL(href);
  assert.equal(url.searchParams.get("dataset_path"), "data/pbmc 3k.zarr");
  assert.deepEqual([...url.searchParams.keys()], ["dataset_path"], "only dataset_path may reach the server");
  assert.ok(url.hash.startsWith("#view="));
  // The full link decodes back to the same view through the boot parse path.
  const parsed = parseDeepLinkLocation(url);
  assert.deepEqual(normalizeView(await decodeViewPayload(parsed.payload)), normalizeView(view));
});

test("a gene set panel round-trips with its source table, and the id remap follows it", async () => {
  const { remapPanelReferences, serializableConfig } = await import(pathToFileURL(MODULE_PATH).href);
  const view = sampleLayoutView();
  const gs = {
    id: "gene-set-1718000000003", title: "Gene Set Analysis 1",
    tableFilter: "gene-table-1718000000002", idColumn: "gene_symbols", autoUpdate: false,
    sections: { "string-network": { visible: true, params: { requiredScore: 700 } }, links: { visible: true, params: {} } },
    sectionOrder: ["links", "string-network"], links: { columns: null, listOpen: false },
  };
  view.layout.hierarchy.push({ type: "tile", id: gs.id });
  view.layout.panelConfigs[gs.id] = serializableConfig(gs);
  const decoded = decodeView(encodeView(view));
  assert.deepEqual(decoded.layout.panelConfigs[gs.id], gs);
  assert.equal(panelTypeFromTileId(gs.id), "gene-set");
  assert.ok(collectTileIds(decoded.layout.hierarchy).includes(gs.id));
  remapPanelReferences(Object.values(decoded.layout.panelConfigs), { "gene-table-1718000000002": "gene-table-9" });
  assert.equal(decoded.layout.panelConfigs[gs.id].tableFilter, "gene-table-9");
});
