# Deep links

A deep link is one URL that opens a dataset with a given focus and arrangement of panels. Share
Link in the header produces one; you can also build them by hand or from a script. This page
specifies the grammar, gives a minimal working example, and records why it is shaped this way,
so the next contributor extends it without forking a second serialization. For how to use links
in the app, see {doc}`../user-guide/share-links`.

## Grammar

```text
?dataset_path=<path>#view=<payload>             what Share Link emits
?dataset_path=<path>&view=<base64url(JSON)>     legacy, still accepted
```

`dataset_path` (required, query)
: The dataset to open, URL-encoded. A bare `?dataset_path=…` with no `view` opens the dataset
  into the Welcome tile.

`view` (optional, fragment)
: The serialized `view` object. `<payload>` is either
  - `z1.<base64url(deflate-raw(UTF-8 JSON))>`: compressed; `z1.` is the codec marker (`.` never
    occurs in base64url, so it is unambiguous), or
  - `<base64url(UTF-8 JSON)>`: uncompressed, the original format.

  base64url is RFC 4648 §5: `-` and `_` for `+` and `/`, no padding. If a URL carries `view` in
  both places, the fragment wins.

## Minimal example

One Cell Plot on the UMAP, coloured by the fold change of the focused gene S100a9. Built in
Python and opened in Chromium against the demonstration store; the app fetched exactly the two
`X_umap` axes and the one layer column (`cols=2551`):

```python
import base64, json, urllib.parse

view = {
    "v": 1,
    "constants": {"focusedGene": "S100a9"},
    "layout": {
        "v": 1,
        "hierarchy": [{"type": "tile", "id": "cell-plot-fc", "controlsVisible": False}],
        "controlState": {"cell-plot-fc": False},
        "panelConfigs": {"cell-plot-fc": {
            "id": "cell-plot-fc",
            "title": "S100a9 fold change",
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "color": {"type": "layer", "key": "kompot_de_Young_to_Old_fold_change",
                      "column": "S100a9"},
        }},
    },
}
payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
store = "/data/datasets/bm_aging.zarr"
print(f"http://localhost:8000/?dataset_path={urllib.parse.quote(store)}#view={payload}")
```

This is the uncompressed form, which every build reads; the URL is 677 characters. Settings a
config leaves out take their defaults. The paper's five views are complete examples with two
panels, colour scales and table filters: `data_prep/demo_panelsets/*.view.json` in the
companion repository `settylab/annzarro-paper`. The docs' screenshot views are in
`docs/_tools/views/`.

## The `view` object

```text
{
  "v": 1,                          // schema version (always present after normalize)

  "constants": {                   // global focus state, all optional
    "focusedGene":  "GeneA",
    "focusedCell":  "cell-123",
    "taxonomyId":   "tax-1",
    "cellRows":     { "cell-123": 4711 }   // dataset rows of the focused and locked cells, a hint
  },

  // the cells every panel shows, optional (see "Cell subset" below)
  "subset": { "n": 100000, "seed": 0 },  // null: every cell; absent: server default; optional "part"

  // PREFERRED: a full layout tree
  "layout": {                      // exactly what PanelManager.saveLayout() emits
    "v": 1,
    "hierarchy":    [ <node>, … ], // forest of split/tile/selector nodes
    "controlState": { "<tileId>": true },   // per-panel controls visibility
    "panelConfigs": { "<tileId>": { … } }   // per-panel config (getConfig() shape)
  },

  // LEGACY / SHORTHAND: a flat panel list
  "panels": [                      // no split/size control; kept for back-compat
    { "type": "cell_plot", "config": { … }, "title": "My plot" }
  ]
}
```

A link carries **`layout` or `panels`** (or neither). If both are present, `layout` wins;
`panels` is the simple shorthand. `normalizeView` enforces this and stamps `v`.

`subset` names the cells every panel shows: `{n, seed, balance?, where?}`. `n` is the number
of cells, or `null` for every cell that passes `where`; `balance` is an obs column to sample
evenly across; `where` is a list of conditions on obs columns (see
`static/js/utils/subset.js`). The same spec always names the same cells, on any machine, and a
larger `n` only adds cells. A share link records the subset whenever one is shown, and
`null` when every cell of a dataset above the subset threshold is shown. A link without
`subset` opens on the server's default (a 100,000-cell subset above 200,000 cells, otherwise
every cell); a malformed one is dropped, so the link still opens. A hand-written link can ask
for a subset of an atlas directly, e.g. `"subset": {"n": 50000, "seed": 1, "balance": "batch"}`.

`subset.part` (0-based) picks one of the disjoint parts that the spec splits the cells into
({doc}`../user-guide/subsets`): `{"n": 100000, "seed": 0, "part": 2}` is the third part, shown
as "Part 3 of …". A link records the part it was made on; part 0 is written without the field,
so a link without `part`, including every link made before parts existed, opens on part 0 with
the same cells as before. A part past the last one is refused by the server (`400
part_out_of_range`) and the link opens on the dataset's default, with a notice.

`focusedCell` and `focusedGene` are names (`obs_names`, `var_names`), not indices. Cell names
may contain `#` (the demonstration data's do); inside the base64 payload that is harmless.

The focused cell is kept when the link's subset does not show it, for example a cell of part 1
in a link to part 3, or one its `where` filter leaves out: panels read its rows by dataset row
and the header says "not shown" ({doc}`../user-guide/focus-and-lock`). It is dropped only when
the dataset does not have the name (the panels then say so), or when the server is too old to
read a cell outside the subset (a notice says so).

`cellRows` maps the focused and locked cells to their dataset rows, where the app knew them when
the link was made. It is only a hint: on opening, the name at that row (`obs/_index`) is read
and must equal the key, or the hint is ignored. Names stay authoritative. The hint matters on
very large datasets: finding a cell the subset does not show by name needs the server's
dataset-wide name index, which takes 6.2 s to build at 50 million cells, and the hint replaces
that with a one-row read (0.07 s). On the 50-million-cell Tahoe store, a link to part 2 of
500 whose focused cell is in part 1 was restored in 13.4 s with the hint and 19.3 s without it,
from page load to the focused cell's panels drawn on a server that had not built its name index
yet. Links without the hint, including every link made before it existed, work as before.

### Hierarchy nodes

```text
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

A tile's **panel type is encoded in its id prefix**: `cell-plot-1718…` is type `cell-plot`.
`panelTypeFromTileId` (in `deeplink.js`) is the single definition of that derivation, shared
with `restoreLayout`. To pre-register a cell plot in a split, give its tile node
`id: "cell-plot-<anything-unique>"` and put its settings under
`panelConfigs["cell-plot-<…>"]`. Registered panel types live in `Config.PANEL_TYPES`
(`cell-plot`, `gene-plot`, `cell-table`, `gene-table`, `gene-set`).

### Panel configuration

`panelConfigs[id]` is the panel's `getConfig()` output. For plots, each of `x`, `y`, `z`
(or `null`) and `color` is a data reference:

| Field | Meaning |
|---|---|
| `type` | the slot: `obs`, `obsm`, `obsp`, `layer` (Cell Plot); `var`, `varm`, `varp`, `layer` (Gene Plot); `none` for constant colour |
| `key` | the key in that slot, e.g. `X_umap`, `diffusion_walk_t5`, `kompot_de_Young_to_Old_fold_change` |
| `column` | for obsm/varm the column; for obsp, varp and layer the row or column name, which follows the focused cell or gene |
| `locked` | `true` pins `column`: the axis keeps that cell or gene instead of following the focus |

Other fields (`pointSize`, `pointOpacity`, `colorScale`, `colorReversed`, `hoverInfo`,
`highlightFocusedCell`, `tableFilter`, ...) are whatever the panel saved; copy them from a link
the app produced rather than writing them from scratch.

## Why the fragment, and why compressed

In the query string the view is part of the HTTP request line, which gunicorn caps at 4,094
bytes; a link with two fully configured panels (about 4.7 KB) failed with "Request Line is too
large". The fragment is never sent to the server, so there is no size limit and the view does not
land in access logs; the server only needs `dataset_path`. Deflate shrinks a typical two-panel
view 4-6× (e.g. 4.5 KB to 1.2 KB), which keeps links pasteable. A runtime without
`CompressionStream('deflate-raw')` (Node < 21.2, very old browsers) emits the uncompressed form
instead, which every build can read.

**Legacy links keep working.** The uncompressed `?view=` query form is what DoLiMap emits and
what links shared before this change contain; it is decoded as before and is permanently
supported. Producers that build links by hand may keep emitting it (or move the same payload
into `#view=`); only links with large layouts need the compressed fragment form.

Because only the fragment differs between two share links for the same dataset, opening one in
a tab already showing the other would be in-page navigation; the app listens for `hashchange`
and reloads so the new view is applied.

Encode, decode, normalize and the URL parse/build helpers live in
**`static/js/utils/deeplink.js`** (`encodeViewPayload`, `decodeViewPayload`,
`parseDeepLinkLocation`, `buildDeepLinkUrl`): a pure, isomorphic module imported by both the
browser entry point (`main.js`) and the Node guard (`annzarro/tests/js/deeplink.test.mjs`, run
with `node --test annzarro/tests/js/deeplink.test.mjs` or via the pytest wrapper
`annzarro/tests/js/test_js_suites.py`). There is exactly one encoder and one decoder; the
browser and the tests cannot drift.

## Why one serialization, not two

The layout manager already serializes a split/size/panel hierarchy: `buildLayoutHierarchy` /
`rebuildLayoutFromHierarchy` (`static/js/layout-manager.js`) and `saveLayout` / `restoreLayout`
(`static/js/panel-manager.js`). Before deep links those functions were defined but had no live
consumer. The deep link adopts that exact tree as its `layout` key:

- **One source of truth.** "Save current layout as a shareable link" (`App.buildShareView`,
  behind Share Link) and "open link, reconstruct layout" (`_applyDeepLink` →
  `PanelManager.restoreLayout`) are the same serialization read forwards and backwards. Any
  layout the app can build is expressible as a link, and any valid link reconstructs a layout
  the app could have built.
- **No parallel re-implementation.** `_applyDeepLink` does not walk the tree itself; it hands
  `view.layout` to `restoreLayout`, the same path a session restore uses. New panel types, split
  behaviours and layout-manager fixes reach deep links for free.
- **`saveLayout` emits `panelConfigs`.** `restoreLayout` already read `layout.panelConfigs[id]`
  when re-instantiating a panel; `saveLayout` produces it (each panel's `getConfig()` plus its
  id), so a serialized layout reopens with real settings, not defaults.

## Versioning and compatibility

- `v` is stamped on every normalized `view` and on every `saveLayout` output. Bump it on a
  breaking change to the tree shape, and teach `normalizeView` to migrate older values.
- `normalizeView` never throws on a structurally odd link. A malformed or empty/selector-only
  `layout` degrades to the Welcome tile rather than hanging the boot; the spinner-suppression
  invariant is guarded by `annzarro/tests/static/test_deeplink_no_spinner_hang.py`.
- The flat `panels: []` form is permanently supported as the legacy shorthand.

## Boot invariants (do not regress)

A deep link is parsed *before* `PanelManager.init`, so the autosave-restore spinner is
suppressed for the deep-link case, and `ensureWelcomeFallback()` runs after apply, so an empty
or failed restore drops back to the Welcome tile instead of spinning forever. See
`annzarro/tests/static/test_deeplink_no_spinner_hang.py`.

## Limits of a link

A link refers to the dataset by server path. It reproduces a view on the same server with an
unchanged store, not across installations. The server logs `dataset_path` (it is in the query
string) but never sees the view.
