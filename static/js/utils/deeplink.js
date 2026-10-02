/**
 * Deep-link view (de)serialization — the single source of truth for the
 * `?dataset_path=<path>#view=<payload>` grammar (and its legacy
 * `?dataset_path=<path>&view=<base64url(JSON)>` query form).
 *
 * Why the view rides in the fragment, compressed:
 *
 *   A full two-panel layout is several KB of JSON. In the query string it
 *   reaches gunicorn as part of the request line, which is capped at 4094 bytes
 *   ("Request Line is too large"), so the very links worth sharing were the
 *   ones that failed. The fragment never leaves the browser: no request-line
 *   limit, nothing in access logs, and the server only needs dataset_path
 *   anyway. Deflating the JSON first keeps links short enough to paste.
 *
 *   <payload> is either
 *     `z1.<base64url(deflate-raw(JSON))>`  — what share links carry, or
 *     `<base64url(JSON)>`                  — legacy/uncompressed (DoLiMap emits
 *                                            this; accepted indefinitely).
 *   `.` cannot occur in base64url, so the codec marker is unambiguous.
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
 *   Everything here is pure (no DOM; only btoa/atob, Blob/Response and
 *   (De)CompressionStream, globals in browsers and Node alike; 'deflate-raw'
 *   needs Node ≥ 21.2, and older runtimes fall back to the legacy form). That lets the browser entrypoint (main.js) and
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
 * Encode a `view` object to legacy, uncompressed base64url JSON (the original
 * `?view=` form). Share links go through encodeViewPayload; this remains the
 * fallback for runtimes without 'deflate-raw' and the format DoLiMap emits.
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

/** Codec marker for a deflate-raw compressed payload. Bump on a format change. */
export const COMPRESSED_PREFIX = 'z1.';

function _bytesToBase64url(bytes) {
    // Chunked so a large payload cannot overflow fromCharCode's argument limit.
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function _base64urlToBytes(b64url) {
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

async function _pipe(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Can this runtime produce compressed payloads? Older browsers and Node < 21.2
 * lack 'deflate-raw'; encodeViewPayload then emits the legacy form, which every
 * build can read, rather than failing to share at all.
 * @returns {boolean}
 */
export function compressionSupported() {
    if (typeof CompressionStream !== 'function') return false;
    try {
        new CompressionStream('deflate-raw');
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Encode a `view` to the payload carried in `#view=`: compressed when the
 * runtime can, legacy base64url JSON otherwise. Inverse of decodeViewPayload.
 * @param {Object} view
 * @returns {Promise<string>}
 */
export async function encodeViewPayload(view) {
    if (!compressionSupported()) return encodeView(view);
    const json = new TextEncoder().encode(JSON.stringify(view));
    const deflated = await _pipe(json, new CompressionStream('deflate-raw'));
    return COMPRESSED_PREFIX + _bytesToBase64url(deflated);
}

/**
 * Decode either payload form: compressed `z1.…` or legacy base64url JSON.
 * @param {string} payload
 * @returns {Promise<Object>}
 */
export async function decodeViewPayload(payload) {
    if (!payload.startsWith(COMPRESSED_PREFIX)) return decodeView(payload);
    if (typeof DecompressionStream !== 'function') {
        throw new Error('This browser cannot decompress shared views (no DecompressionStream).');
    }
    const bytes = _base64urlToBytes(payload.slice(COMPRESSED_PREFIX.length));
    const inflated = await _pipe(bytes, new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(inflated));
}

/**
 * Pull the deep-link parts out of a location's `search` and `hash`. Pure, so
 * the boot path and the tests read URLs the same way. The fragment wins over
 * the legacy `?view=` query form if a URL somehow carries both.
 * @param {{search: string, hash: string}} loc - window.location or a URL
 * @returns {{datasetPath: string, payload: string|null}|null} null when there
 *          is no dataset_path (a normal, non-deep-link boot)
 */
export function parseDeepLinkLocation(loc) {
    const query = new URLSearchParams(loc.search || '');
    const datasetPath = query.get('dataset_path');
    if (!datasetPath) return null;
    const fragment = new URLSearchParams((loc.hash || '').replace(/^#/, ''));
    const payload = fragment.get('view') || query.get('view') || null;
    return { datasetPath, payload };
}

/**
 * Assemble a shareable URL: dataset_path in the query (the server needs it and
 * it is short), the view payload in the fragment (long, and browser-only).
 * @param {string} base - origin + pathname, e.g. 'https://host/annzarro/'
 * @param {string} datasetPath
 * @param {string|null} payload - from encodeViewPayload
 * @returns {string}
 */
export function buildDeepLinkUrl(base, datasetPath, payload) {
    const url = new URL(base);
    url.search = '';
    url.searchParams.set('dataset_path', datasetPath);
    url.hash = payload ? 'view=' + payload : '';
    return url.toString();
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

/**
 * Panel sets carry the SAME view a share link does.
 *
 * A saved panel set used to hold only `panelConfigs`, and loading one merely
 * registered those panels as closed: no dataset, no focus, no split layout,
 * so "Load Panel Set" did not bring back the view that was saved. A panel set
 * now stores `view` (exactly the object a share link encodes: constants plus
 * PanelManager.saveLayout()) next to the fields older readers know, and
 * loading it goes through the deep-link path.
 *
 *   panelSet = {
 *     name, timestamp, dataset, datasetName,
 *     constants,                     // kept for older AnnZarro and previews
 *     panelConfigs: { <id>: {id, type, title, config, isSelectionTile} },
 *     view: { v, constants, layout } // what share links carry; preferred
 *   }
 *
 * Files without `view` (every set saved before this) still load: their open
 * panels are laid out in rows of two, and panels whose config says
 * `active: false` (closed when saved) come back closed.
 */

/**
 * A layout hierarchy for panels that have no saved arrangement: rows of
 * two side by side, rows stacked with equal heights.
 * @param {string[]} ids
 * @returns {Array} hierarchy (empty for no ids)
 */
export function defaultHierarchy(ids) {
    const tile = id => ({ type: 'tile', id });
    const rows = [];
    for (let i = 0; i < ids.length; i += 2) {
        rows.push(i + 1 < ids.length
            ? { type: 'split', direction: 'horizontal',
                panes: [{ percentage: 50 }, { percentage: 50 }],
                children: [tile(ids[i]), tile(ids[i + 1])] }
            : tile(ids[i]));
    }
    const stack = (list) => {
        if (list.length === 1) return list[0];
        const first = Math.round(100 / list.length);
        return { type: 'split', direction: 'vertical',
            panes: [{ percentage: first }, { percentage: 100 - first }],
            children: [list[0], stack(list.slice(1))] };
    };
    return rows.length ? [stack(rows)] : [];
}

/**
 * Turn a stored panel set (any version) into what the deep-link path applies.
 * @param {Object} panelSet
 * @returns {{datasetPath: string|null, view: Object,
 *            closedPanels: Array<{id: string, type: string, config: Object}>,
 *            legacy: boolean}|null}
 */
export function panelSetToView(panelSet) {
    if (!panelSet || typeof panelSet !== 'object') return null;
    const datasetPath = panelSet.dataset || null;
    const constants = panelSet.constants && typeof panelSet.constants === 'object'
        ? panelSet.constants : undefined;

    if (panelSet.view && typeof panelSet.view === 'object') {
        const view = normalizeView(panelSet.view) || { v: VIEW_SCHEMA_VERSION };
        if (!view.constants && constants) view.constants = constants;
        // Panels that existed but were closed when the set was saved are in
        // layout.panelConfigs without a tile; they come back closed.
        const all = (panelSet.view.layout && panelSet.view.layout.panelConfigs) || {};
        const open = new Set(view.layout ? collectTileIds(view.layout.hierarchy) : []);
        const closedPanels = Object.entries(all)
            .filter(([id]) => !open.has(id))
            .map(([id, config]) => ({ id, type: panelTypeFromTileId(id), config: { ...config, id } }));
        return { datasetPath, view, closedPanels, legacy: false };
    }

    // Legacy: panelConfigs only.
    const entries = Object.entries(panelSet.panelConfigs || {})
        .filter(([, p]) => p && !p.isSelectionTile && p.type)
        .map(([key, p]) => {
            const id = (p.config && p.config.id) || p.id || key;
            const config = { ...(p.config || {}), id };
            if (!config.title && p.title) config.title = p.title;
            return { id, type: p.type, config };
        });
    // A tile id must start with its type: restoreLayout derives the type from it.
    const opened = entries.filter(e => e.config.active !== false && e.id.startsWith(e.type + '-'));
    const closedPanels = entries.filter(e => !opened.includes(e));
    const view = { v: VIEW_SCHEMA_VERSION };
    if (constants) view.constants = constants;
    if (opened.length) {
        const panelConfigs = {};
        opened.forEach(e => { panelConfigs[e.id] = e.config; });
        view.layout = {
            v: VIEW_SCHEMA_VERSION,
            hierarchy: defaultHierarchy(opened.map(e => e.id)),
            controlState: {},
            panelConfigs
        };
    }
    return { datasetPath, view, closedPanels, legacy: true };
}

/**
 * Rewrite references between panels after ids changed: a plot's
 * `tableFilter` holds the id of the table it is filtered by.
 * @param {Object[]} configs - panel configs, rewritten in place
 * @param {Map<string,string>|Object} idMap - old id -> new id
 * @returns {Object[]} the same configs
 */
export function remapPanelReferences(configs, idMap) {
    const map = idMap instanceof Map ? idMap : new Map(Object.entries(idMap || {}));
    configs.forEach(cfg => {
        if (cfg && typeof cfg.tableFilter === 'string' && map.has(cfg.tableFilter)) {
            cfg.tableFilter = map.get(cfg.tableFilter);
        }
    });
    return configs;
}

/**
 * Config keys that describe what a panel currently SHOWS, not how it is set
 * up. A table's `currentEntries` is the row index of every row passing its
 * filter (a getter over the live DataTable): an unfiltered 8,090-row table
 * put 8,090 numbers into every share link (a 25,340-character URL) and
 * panel set. They are recomputed when the panel loads.
 */
export const DERIVED_CONFIG_KEYS = ['currentEntries', 'filteredCells'];

/**
 * A copy of a panel config without its derived state, for serialization.
 * @param {Object} config
 * @returns {Object}
 */
export function serializableConfig(config) {
    const out = {};
    for (const [key, value] of Object.entries(config || {})) {
        if (!DERIVED_CONFIG_KEYS.includes(key)) out[key] = value;
    }
    return out;
}
