/**
 * Deep-link view (de)serialization — the single source of truth for the
 * `?dataset_path=<path>&view=<base64url(JSON)>` grammar.
 *
 * Why this module exists, and why it is pure / isomorphic:
 *
 *   The deep-link `view` is the SAME serialization the layout manager already
 *   produces. `PanelManager.saveLayout()` emits a `{hierarchy, controlState,
 *   panelConfigs}` tree; `PanelManager.restoreLayout()` rebuilds the live DOM
 *   from exactly that tree. A deep link therefore carries that tree verbatim
 *   under a `layout` key, so "save current layout → shareable link" and "open
 *   link → reconstruct layout" are one round-trip, not two parallel code paths.
 *   Any layout the app can build is expressible as a link, and vice versa.
 *
 *   Everything here is pure (no DOM, no globals beyond btoa/atob, which exist in
 *   both browsers and Node ≥ 18). That lets the browser entrypoint (main.js) and
 *   the Node guard (tests/js/deeplink.test.mjs) import the identical encoder,
 *   decoder, and normalizer — author once, run in both. The co-located
 *   static/js/package.json (`"type":"module"`) is what lets Node load this bare
 *   `.js` as ESM; see that file.
 *
 * Schema (versioned so future evolutions don't break old links):
 *
 *   view = {
 *     v: 1,                                  // schema version (optional on input,
 *                                            //   always present after normalize)
 *     constants: {                           // global focus state (all optional)
 *       focusedGene, focusedCell, taxonomyId
 *     },
 *     // ── preferred: a full layout tree ────────────────────────────────────
 *     layout: {                              // exactly what saveLayout() returns
 *       v: 1,
 *       hierarchy: [ <node>, … ],            // forest of split/tile/selector nodes
 *       controlState: { <tileId>: bool },    // per-panel controls visibility
 *       panelConfigs: { <tileId>: {…} }      // per-panel config (getConfig() shape)
 *     },
 *     // ── legacy / shorthand (still supported) ─────────────────────────────
 *     panels: [ { type, config, title }, … ] // flat list, no split/size control
 *   }
 *
 *   <node> :=
 *     { type: 'tile',     id: '<type>-<n>', controlsVisible?: bool }
 *   | { type: 'selector' }
 *   | { type: 'split', direction: 'horizontal'|'vertical',
 *       panes: [ {percentage, controlsVisible?}, {percentage, controlsVisible?} ],
 *       children: [ <node>, <node> ] }
 *
 *   A tile's panel TYPE is encoded in its id prefix (`cell-plot-1718…` → type
 *   `cell-plot`), matching how restoreLayout derives it — see panelTypeFromTileId.
 *
 * A link may carry `layout` OR `panels` (or neither — a bare dataset open).
 * If both are present, `layout` wins; `panels` is the simple/legacy shorthand.
 */

/** Current deep-link `view` schema version. Bump on a breaking change. */
export const VIEW_SCHEMA_VERSION = 1;

/**
 * Encode a `view` object to the base64url string carried in `?view=`.
 * Inverse of {@link decodeView}. UTF-8 safe (gene symbols may be non-ASCII).
 * @param {Object} view
 * @returns {string} base64url (RFC 4648 §5: '-'/'_' for '+'/'/', no padding)
 */
export function encodeView(view) {
    const json = JSON.stringify(view);
    // encodeURIComponent → %XX escapes for every non-ASCII byte; unescape turns
    // those into a binary (Latin-1) string btoa can digest. Mirror of decodeView.
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode the base64url string from `?view=` back into a `view` object.
 * Inverse of {@link encodeView}.
 * @param {string} b64url
 * @returns {Object}
 */
export function decodeView(b64url) {
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
}

/**
 * Derive a panel TYPE from a tile id. The id is `<type>-<timestamp>`, so the
 * type is everything before the final dash. Single source of truth shared with
 * PanelManager.restoreLayout, so the encode side and the restore side can never
 * disagree on how an id maps to a registered panel type.
 * @param {string} tileId
 * @returns {string}
 */
export function panelTypeFromTileId(tileId) {
    const parts = String(tileId).split('-');
    return parts.slice(0, -1).join('-');
}

/**
 * Walk a hierarchy forest and collect every tile id in document order.
 * Shared with restoreLayout so "which panels does this tree open" has one
 * definition. Tolerant of malformed nodes (skips anything unrecognized).
 * @param {Array<Object>} hierarchy
 * @returns {string[]} tile ids
 */
export function collectTileIds(hierarchy) {
    const ids = [];
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'tile' && node.id) {
            ids.push(node.id);
        } else if (node.type === 'split' && Array.isArray(node.children)) {
            node.children.forEach(visit);
        }
    };
    (Array.isArray(hierarchy) ? hierarchy : []).forEach(visit);
    return ids;
}

/**
 * Does this layout tree open at least one panel? A `layout` whose hierarchy is
 * all selectors/empty materializes nothing — the caller must fall back to the
 * Welcome tile rather than restore an empty shell.
 * @param {Object} layout
 * @returns {boolean}
 */
export function layoutHasPanels(layout) {
    return !!(layout && collectTileIds(layout.hierarchy).length > 0);
}

/**
 * Normalize a decoded `view` into the canonical, version-stamped shape the boot
 * path consumes. Idempotent. Never throws on a structurally-odd input — it
 * coerces to safe defaults so a slightly-off link degrades (e.g. to "just open
 * the dataset") instead of hanging the boot. Unknown future `v` values are
 * passed through untouched so a newer link opened by an older build fails soft.
 * @param {Object|null} view
 * @returns {Object|null} canonical view, or null if there is nothing to apply
 */
export function normalizeView(view) {
    if (!view || typeof view !== 'object') return null;

    const out = { v: typeof view.v === 'number' ? view.v : VIEW_SCHEMA_VERSION };

    if (view.constants && typeof view.constants === 'object') {
        out.constants = view.constants;
    }

    // Prefer the layout tree. Only surface it if it actually opens a panel;
    // an empty/selector-only tree should fall through to the Welcome fallback.
    if (view.layout && typeof view.layout === 'object' && layoutHasPanels(view.layout)) {
        out.layout = view.layout;
    } else if (Array.isArray(view.panels)) {
        out.panels = view.panels;
    }

    return out;
}
