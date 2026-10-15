/**
 * The recently opened datasets, kept in the browser's storage per server AND
 * user: two people who sign in from one browser do not see each other's list.
 *
 * Storage key `annzarro.recents:<origin>|<user>`, value a JSON list of
 * `{path, label, openedAt}` (milliseconds since the epoch), newest first, at most RECENTS_LIMIT. `user` is
 * `user:<name>` with login on and `local` with login off (userKey). A path is
 * kept as it was opened: a store in a subfolder and a remote URL stay.
 *
 * The list the application kept before (`annzarro.recentDatasets:<origin>`, a
 * list of paths shared by everyone on the origin) is moved into the key of the
 * first user that loads their recents, with `openedAt` 0 (not known), and
 * removed, so that no second user inherits it.
 *
 * Which opens are recorded is decided by the caller (main.js: the user's own
 * choices only). Nothing here throws: storage may be missing, full or blocked.
 */

import { csrfFetch } from './csrf.js';

export const RECENTS_LIMIT = 50;
export const RECENTS_KEY_PREFIX = 'annzarro.recents:';
export const LEGACY_KEY_PREFIX = 'annzarro.recentDatasets:';

/** The user part of the key from auth/me: the signed-in user, or `local` when login is off or unknown. */
export function userKey(me) {
    return me && me.auth_enabled && me.username ? `user:${me.username}` : 'local';
}

export function recentsKey(origin, user) {
    return `${RECENTS_KEY_PREFIX}${origin || ''}|${user || 'local'}`;
}

function clean(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const item of list) {
        if (!item || typeof item.path !== 'string' || !item.path || seen.has(item.path)) continue;
        seen.add(item.path);
        out.push({
            path: item.path,
            label: typeof item.label === 'string' && item.label ? item.label : item.path,
            openedAt: Number.isFinite(item.openedAt) ? item.openedAt : 0
        });
    }
    return out.slice(0, RECENTS_LIMIT);     // the list is kept newest first: its order is the recency
}

function write(storage, key, list) {
    try { storage.setItem(key, JSON.stringify(list)); } catch { /* storage full or blocked */ }
}

/** Move the old, user-less list into this user's key (once); returns the migrated list, or null when there was none. */
function migrate(storage, origin, user) {
    const legacyKey = LEGACY_KEY_PREFIX + (origin || '');
    let raw;
    try { raw = storage.getItem(legacyKey); } catch { return null; }
    if (raw === null || raw === undefined) return null;
    let paths = [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) paths = parsed.filter(p => typeof p === 'string' && p);
    } catch { /* a broken old list is dropped */ }
    const list = clean(paths.map(path => ({ path, label: path, openedAt: 0 })));
    write(storage, recentsKey(origin, user), list);
    try { storage.removeItem(legacyKey); } catch { /* blocked */ }
    return list;
}

/** The recents of `user` on `origin`, newest first; [] when there are none or storage is unusable. */
export function loadRecents(storage, origin, user) {
    try {
        const raw = storage.getItem(recentsKey(origin, user));
        if (raw === null || raw === undefined) return migrate(storage, origin, user) || [];
        return clean(JSON.parse(raw));
    } catch {
        return [];
    }
}

/**
 * Put `path` first in the user's recents (an earlier entry of it is replaced);
 * returns the new list. `now` is milliseconds since the epoch.
 */
export function recordRecent(storage, origin, user, { path, label }, now = Date.now()) {
    if (!path) return loadRecents(storage, origin, user);
    const rest = loadRecents(storage, origin, user).filter(item => item.path !== path);
    const next = clean([{ path, label: label || path, openedAt: now }, ...rest]);
    write(storage, recentsKey(origin, user), next);
    return next;
}

/** Forget the user's recents. */
export function clearRecents(storage, origin, user) {
    try { storage.removeItem(recentsKey(origin, user)); } catch { /* blocked */ }
}

// ---- showing them -----------------------------------------------------------------------

/**
 * Ask the server which of `paths` this user may open (`POST /datasets/lookup`), in the order given.
 * @param {string} url - the lookup route
 * @param {string[]} paths
 * @param {{send?: Function, signal?: AbortSignal}} [env] - `send` replaces csrfFetch (tests)
 * @returns {Promise<Array<Object>>} one result per path; throws with the server's sentence when it refuses
 */
export async function lookupPaths(url, paths, { send = csrfFetch, signal } = {}) {
    if (!paths.length) return [];
    const response = await send(url, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || response.statusText);
    return Array.isArray(body.results) ? body.results : [];
}

const baseName = path => String(path || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();

/**
 * The picker's entries for the recents, from a lookup's `results` (same order). A store the user may read is the
 * listing entry the server sent; one that is not available comes back unreadable, to be shown greyed, with the
 * label it was opened under; one the server did not check has its label only.
 * @param {Array<{path: string, label: string}>} recents
 * @param {Array<Object>} results
 */
export function recentEntries(recents, results) {
    return recents.map((recent, i) => {
        const found = results[i];
        const named = { path: recent.path, name: baseName(recent.label || recent.path) || recent.path, rel_path: recent.label || recent.path };
        if (!found || found.status === 'unchecked') return named;
        if (found.status === 'unavailable') return { ...named, error: 'Not available', unavailable: true };
        return found;
    });
}
