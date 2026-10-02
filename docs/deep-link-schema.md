# Deep-link schema & the unified layout serialization

AnnZarro deep links let one URL pre-open a dataset with a specific arrangement
of panels. This note documents the `view` grammar and, more importantly, *why*
it is shaped the way it is — so the next contributor extends it without forking
a second, divergent serialization.

## The grammar

```
?dataset_path=<path>#view=<payload>             what Share Link emits
?dataset_path=<path>&view=<base64url(JSON)>     legacy, still accepted
```

- `dataset_path` (required, query) — the dataset to open. A bare
  `?dataset_path=…` with no `view` just opens the dataset into the Welcome tile.
- `view` (optional, fragment) — the serialized `view` object. `<payload>` is
  either
  - `z1.<base64url(deflate-raw(UTF-8 JSON))>` — compressed; the `z1.` prefix
    is the codec marker (`.` never occurs in base64url, so it is unambiguous), or
  - `<base64url(UTF-8 JSON)>` — uncompressed, the original format.

  base64url is RFC 4648 §5: `-`/`_` for `+`/`/`, no padding.
- If a URL carries `view` in both places, the fragment wins.

**Why the fragment, and why compressed.** In the query string the view is part
of the HTTP request line, which gunicorn caps at 4094 bytes; a link with two
fully configured panels (~4.7 KB) failed with "Request Line is too large". The
fragment is never sent to the server, so there is no size limit and the view
does not land in access logs; the server only needs `dataset_path`. Deflate
shrinks a typical two-panel view about 4–6× (e.g. 4.5 KB → 1.2 KB), which keeps
links pasteable. A runtime without `CompressionStream('deflate-raw')` (Node
< 21.2, very old browsers) emits the uncompressed form instead, which every
build can read.

**Legacy links keep working.** The uncompressed `?view=` query form is what
DoLiMap emits and what links shared before this change contain; it is decoded
as before and is permanently supported. Producers that build links by hand may
keep emitting it (or move the same payload into `#view=`); only links with
large layouts need the compressed fragment form.

Because only the fragment differs between two share links for the same dataset,
opening one in a tab already showing the other would be in-page navigation; the
app listens for `hashchange` and reloads so the new view is applied.

Encode/decode/normalize and the URL parse/build helpers live in
**`static/js/utils/deeplink.js`** (`encodeViewPayload`, `decodeViewPayload`,
`parseDeepLinkLocation`, `buildDeepLinkUrl`) — a pure, isomorphic module
imported by both the browser entrypoint (`main.js`) and the Node guard
(`annzarro/tests/js/deeplink.test.mjs`, run with
`node --test annzarro/tests/js/deeplink.test.mjs` or via the pytest wrapper
`annzarro/tests/js/test_js_suites.py`). There is exactly one encoder and one
decoder; the browser and the tests cannot drift.

## The `view` object

```jsonc
{
  "v": 1,                          // schema version (always present after normalize)

  "constants": {                   // global focus state — all optional
    "focusedGene":  "GeneA",
    "focusedCell":  "cell-123",
    "taxonomyId":   "tax-1"
  },

  // the cells shown (docs/design/subsetting.md) — optional
  "subset": { "n": 100000, "seed": 0 },  // or null: every cell
                                         // absent: the server's default for the
                                         // dataset (a subset above 200,000 cells)

  // ── PREFERRED: a full layout tree ─────────────────────────────────────────
  "layout": {                      // EXACTLY what PanelManager.saveLayout() emits
    "v": 1,
    "hierarchy":    [ <node>, … ], // forest of split/tile/selector nodes
    "controlState": { "<tileId>": true },   // per-panel controls visibility
    "panelConfigs": { "<tileId>": { … } }   // per-panel config (getConfig() shape)
  },

  // ── LEGACY / SHORTHAND: a flat panel list ─────────────────────────────────
  "panels": [                      // no split/size control; kept for back-compat
    { "type": "cell_plot", "config": { … }, "title": "My plot" }
  ]
}
```

A link carries **`layout` OR `panels`** (or neither). If both are present,
`layout` wins; `panels` is the simple shorthand. `normalizeView` enforces this
and stamps `v`.

`subset` names the cells every panel shows: `{n, seed, balance?, where?}`
(`n` cells, or `null` for every cell passing `where`; `balance` an obs column
to sample evenly across; `where` a list of conditions on obs columns, see
`static/js/utils/subset.js`). The same spec always names the same cells. A
share link records it whenever a subset is shown, and `null` when every cell of
a dataset above the subset threshold is shown. A link without `subset` opens on
the server's default; a malformed one is dropped, so the link still opens. A
templated link can ask for a subset of an atlas directly, for example
`"subset": {"n": 50000, "seed": 1, "balance": "batch"}`.

### Hierarchy node types

```jsonc
// a panel
{ "type": "tile", "id": "cell-plot-1718000000000", "controlsVisible": true }

// the bottom "add a panel" selector
{ "type": "selector" }

// a split of exactly two children, horizontal or vertical
{
  "type": "split",
  "direction": "horizontal",       // "horizontal" = side by side; "vertical" = stacked
  "panes": [
    { "percentage": 60, "controlsVisible": true },
    { "percentage": 40, "controlsVisible": false }
  ],
  "children": [ <node>, <node> ]   // [first pane, second pane]
}
```

A tile's **panel type is encoded in its id prefix**: `cell-plot-1718…` → type
`cell-plot`. `panelTypeFromTileId` (in `deeplink.js`) is the single definition
of that derivation, shared with `restoreLayout`. So to pre-register a cell-plot
in a split, give its tile node `id: "cell-plot-<anything-unique>"` and put its
settings under `panelConfigs["cell-plot-<…>"]`.

Registered panel types live in `Config.PANEL_TYPES` (e.g. `cell-plot`,
`gene-plot`, `cell-table`, `gene-table`, `gene-set`).

## Why one serialization, not two

The layout manager *already* serializes a split/size/panel hierarchy:
`buildLayoutHierarchy` / `rebuildLayoutFromHierarchy`
(`static/js/layout-manager.js`) and `saveLayout` / `restoreLayout`
(`static/js/panel-manager.js`). Before this change those functions were
**dormant** — defined and exported but with no live consumer.

The deep link adopts that exact tree as its `layout` key. The consequences:

- **One source of truth.** "Save current layout → shareable link"
  (`App.buildShareView`, behind the header's Share Link button) and "open link → reconstruct layout"
  (`_applyDeepLink` → `PanelManager.restoreLayout`) are the *same*
  serialization read forwards and backwards. Any layout the app can build is
  expressible as a link, and any valid link reconstructs a layout the app could
  have built. There is no second schema to keep in sync.
- **No parallel re-implementation.** `_applyDeepLink` does not walk the tree
  itself; it hands `view.layout` straight to `restoreLayout`, the identical path
  a session restore uses. New panel types, new split behaviors, and bug fixes in
  the layout manager flow to deep links for free.
- **`saveLayout` now emits `panelConfigs`.** `restoreLayout` already read
  `layout.panelConfigs[id]` when re-instantiating a panel; `saveLayout` now
  produces it (each panel's `getConfig()` + its id), closing the round-trip so a
  serialized layout reopens with real settings, not defaults.

## Versioning & back-compat

- `v` is stamped on every normalized `view` (and on every `saveLayout` output).
  Bump it on a breaking change to the tree shape; teach `normalizeView` to
  migrate older `v` values forward.
- `normalizeView` never throws on a structurally-odd link. A malformed or
  empty/selector-only `layout` degrades to the Welcome fallback rather than
  hanging the boot — preserving the spinner-suppression invariant guarded by
  `annzarro/tests/static/test_deeplink_no_spinner_hang.py`.
- The flat `panels: []` form is permanently supported as the legacy/simple
  shorthand. Old links keep working.

## Boot invariants (do not regress)

A deep link is parsed *before* `PanelManager.init` so the autosave restore
spinner is suppressed for the deep-link case, and `ensureWelcomeFallback()` runs
after apply so an empty/failed restore drops back to the Welcome tile instead of
spinning forever. See `annzarro/tests/static/test_deeplink_no_spinner_hang.py`.
