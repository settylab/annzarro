/**
 * Closed panels come back with the view that listed them. Pure, so Node tests
 * cover it; PanelManager.restoreClosedPanels and main.js do the registering.
 *
 * A link, a panel set and a history entry all carry `layout.panelConfigs`: the
 * configuration of every panel the session had, open or closed. The ones with
 * no tile in `layout.hierarchy` were closed. They are CONFIGURATION ONLY: a
 * table's columns, filter conditions, search text and search toggles. Never
 * the rows it passed and never a computed value (the derived keys are dropped
 * here as well, in case an older file carries them). A restored closed table
 * therefore knows nothing of its rows until it is opened.
 *
 * Restoring happens BEFORE the open panels are built, so a plot whose
 * `tableFilter` names a closed table finds it registered.
 */
import { collectTileIds, panelTypeFromTileId, DERIVED_CONFIG_KEYS } from './deeplink.js';

/** Keys of a saved config that are about the page, not the panel. */
const NOT_CONFIGURATION = ['_closed', 'active'];

/** A config without its derived and page-state keys, with its id. */
function cleanConfig(id, config) {
    const out = {};
    for (const key of Object.keys(config || {})) {
        if (DERIVED_CONFIG_KEYS.includes(key) || NOT_CONFIGURATION.includes(key)) continue;
        out[key] = config[key];
    }
    out.id = id;
    return out;
}

/**
 * The closed panels of a view: the panels of `layout.panelConfigs` that have
 * no tile, in the order the file lists them.
 * @param {Object|null} view - a normalised view (utils/deeplink.js)
 * @param {(type: string) => boolean} canRestore - a registered, enabled type
 * @returns {{closed: Array<{id: string, type: string, config: Object}>,
 *            skipped: Array<{id: string, type: string, reason: string}>}}
 */
export function closedPanelsOfView(view, canRestore = () => true) {
    const closed = [];
    const skipped = [];
    const layout = view && view.layout;
    const all = layout && layout.panelConfigs && typeof layout.panelConfigs === 'object' ? layout.panelConfigs : {};
    const open = new Set(layout ? collectTileIds(layout.hierarchy) : []);
    for (const [id, config] of Object.entries(all)) {
        if (open.has(id) || !config || typeof config !== 'object') continue;
        const type = panelTypeFromTileId(id);
        if (!type || !canRestore(type)) {
            skipped.push({ id, type, reason: type ? 'unavailable type' : 'no type' });
            continue;
        }
        closed.push({ id, type, config: cleanConfig(id, config) });
    }
    return { closed, skipped };
}

/**
 * Add the closed panels a caller lists beside those the view carries (a legacy
 * panel set keeps its closed panels apart from its layout). An id already
 * planned keeps its first config.
 * @param {Array<{id: string, type: string, config: Object}>} planned
 * @param {Array<{id: string, type: string, config: Object}>} extra
 * @param {(type: string) => boolean} canRestore
 */
export function mergeClosedPlans(planned, extra, canRestore = () => true) {
    const seen = new Set(planned.map(p => p.id));
    const out = [...planned];
    for (const p of extra || []) {
        if (!p || !p.type || !canRestore(p.type)) continue;
        const id = p.id || (p.config && p.config.id);
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        out.push({ id, type: p.type, config: id ? cleanConfig(id, p.config) : { ...(p.config || {}) } });
    }
    return out;
}

/** JSON with the keys of every object sorted: equal values give equal text. */
function norm(v) {
    return JSON.stringify(v, (key, value) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const sorted = {};
            for (const k of Object.keys(value).sort()) sorted[k] = value[k];
            return sorted;
        }
        return value;
    });
}

/**
 * Whether the panel on the page holds what the entry says: every key the entry
 * lists is equal. Keys only the page has are defaults a panel fills in.
 */
function holds(pageConfig, entryConfig) {
    const page = cleanConfig(entryConfig.id, pageConfig);
    return Object.keys(entryConfig).every(key => norm(page[key]) === norm(entryConfig[key]));
}

/**
 * What Back and Forward do about closed panels: from the closed panels the
 * entry lists and the panels the page holds, which to register and which to
 * replace. A panel the page holds but the entry does not list is left alone
 * (closed panels are never thrown away by a step), and a panel that is OPEN on
 * the page is left to the layout step.
 * @param {Array<{id: string, type: string, config: Object}>} target - from closedPanelsOfView
 * @param {Map<string, {open: boolean, config: Object}>} live - the page's panels by id
 * @returns {{add: Array, replace: Array}} the entries of `target` to act on
 */
export function reconcileClosed(target, live) {
    const add = [];
    const replace = [];
    for (const entry of target) {
        const have = live.get(entry.id);
        if (!have) add.push(entry);
        else if (!have.open && !holds(have.config, entry.config)) replace.push(entry);
    }
    return { add, replace };
}
