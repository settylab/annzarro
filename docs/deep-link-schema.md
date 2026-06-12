# Deep-link schema & the unified layout serialization

AnnZarro deep links let one URL pre-open a dataset with a specific arrangement
of panels. This note documents the `view` grammar and, more importantly, *why*
it is shaped the way it is — so the next contributor extends it without forking
a second, divergent serialization.

## The grammar

```
?dataset_path=<path>&view=<base64url(JSON)>
```

- `dataset_path` (required) — the dataset to open. A bare `?dataset_path=…`
  with no `view` just opens the dataset into the Welcome tile.
- `view` (optional) — a base64url-encoded JSON object (RFC 4648 §5: `-`/`_`
  for `+`/`/`, no padding), UTF-8 safe.

Encode/decode/normalize live in **`static/js/utils/deeplink.js`** — a pure,
isomorphic module imported by both the browser entrypoint (`main.js`) and the
Node guard (`tests/js/deeplink.test.mjs`). There is exactly one encoder and one
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
  (`App.buildShareView`) and "open link → reconstruct layout"
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
  `tests/static/test_deeplink_no_spinner_hang.py`.
- The flat `panels: []` form is permanently supported as the legacy/simple
  shorthand. Old links keep working.

## Boot invariants (do not regress)

A deep link is parsed *before* `PanelManager.init` so the autosave restore
spinner is suppressed for the deep-link case, and `ensureWelcomeFallback()` runs
after apply so an empty/failed restore drops back to the Welcome tile instead of
spinning forever. See `tests/static/test_deeplink_no_spinner_hang.py`.
