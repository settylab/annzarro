/**
 * Where the browser keeps what it does for the user's convenience without being asked each
 * time: the layout autosave (restored on the next visit) and the recently opened datasets.
 *
 * By default that is localStorage, so it lasts between visits. A site that sets
 * `site.storage.persistent_convenience: false` (config/base.yaml) keeps it in sessionStorage,
 * gone when the tab closes, so the browser holds nothing between visits except choices the
 * user made themselves (theme, pins, the Dataset information search switches, answers about
 * external services; the subset size is kept for the tab in any case). Strict readings of the ePrivacy rules ask for that on public sites
 * (docs/deployment/public-site.md, "Storage in the browser").
 *
 * The keys: `Config.AUTOSAVE.STORAGE_KEY` (annzarro_autosave), the earlier sessions and the
 * restore marker (utils/last-sessions.js) and the recents (annzarro.recents:<origin>|<user>,
 * utils/dataset-recents.js).
 */
import { RECENTS_KEY_PREFIX, LEGACY_KEY_PREFIX } from './dataset-recents.js';
import { HISTORY_KEY, RESTORING_KEY } from './last-sessions.js';

/** Whether the site lets convenience storage persist between visits (the default). */
export function persistentConvenience(serverConfig) {
    const site = serverConfig && serverConfig.site;
    return !(site && site.storage && site.storage.persistent_convenience === false);
}

/** The Storage for convenience data: localStorage, or sessionStorage on a site that asks for session-only. Null if blocked. */
export function convenienceStorage(serverConfig, win = globalThis) {
    try {
        return persistentConvenience(serverConfig) ? win.localStorage : win.sessionStorage;
    } catch {
        return null;
    }
}

/** On a session-only site, forget what an earlier visit left in localStorage. Returns the keys removed. */
export function dropPersistentConvenience(serverConfig, autosaveKey, win = globalThis) {
    if (persistentConvenience(serverConfig)) return [];
    const removed = [];
    try {
        const storage = win.localStorage;
        const keys = [];
        for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
        for (const key of keys) {
            if (key === autosaveKey || key === HISTORY_KEY || key === RESTORING_KEY
                || key.startsWith(RECENTS_KEY_PREFIX) || key.startsWith(LEGACY_KEY_PREFIX)) {
                storage.removeItem(key);
                removed.push(key);
            }
        }
    } catch { /* storage blocked: nothing to forget */ }
    return removed;
}
