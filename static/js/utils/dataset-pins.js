/**
 * The datasets a user pinned in the dataset browser, kept in the browser's
 * storage per server AND user like the recently opened list
 * (utils/dataset-recents.js, whose `userKey` names the user).
 *
 * Storage key `annzarro.pins:<origin>|<user>`, value a JSON list of
 * `{path, label, pinnedAt}` (milliseconds since the epoch), newest first. A path
 * is kept as it was pinned: a store in a subfolder and a remote URL stay.
 * Nothing here throws: storage may be missing, full or blocked.
 */

export const PINS_LIMIT = 100;
export const PINS_KEY_PREFIX = 'annzarro.pins:';

export function pinsKey(origin, user) {
    return `${PINS_KEY_PREFIX}${origin || ''}|${user || 'local'}`;
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
            pinnedAt: Number.isFinite(item.pinnedAt) ? item.pinnedAt : 0
        });
    }
    return out.slice(0, PINS_LIMIT);
}

function write(storage, key, list) {
    try { storage.setItem(key, JSON.stringify(list)); } catch { /* storage full or blocked */ }
}

/** The pins of `user` on `origin`, newest first; [] when there are none or storage is unusable. */
export function loadPins(storage, origin, user) {
    try {
        const raw = storage.getItem(pinsKey(origin, user));
        return raw === null || raw === undefined ? [] : clean(JSON.parse(raw));
    } catch {
        return [];
    }
}

export function isPinned(storage, origin, user, path) {
    return loadPins(storage, origin, user).some(p => p.path === path);
}

/** Pin `path` (first in the list). Returns the new list. */
export function addPin(storage, origin, user, { path, label }, now = Date.now()) {
    if (!path) return loadPins(storage, origin, user);
    const rest = loadPins(storage, origin, user).filter(p => p.path !== path);
    const next = clean([{ path, label: label || path, pinnedAt: now }, ...rest]);
    write(storage, pinsKey(origin, user), next);
    return next;
}

export function removePin(storage, origin, user, path) {
    const next = loadPins(storage, origin, user).filter(p => p.path !== path);
    write(storage, pinsKey(origin, user), next);
    return next;
}

/** Pin when not pinned, else unpin. Returns `{pinned, list}`. */
export function togglePin(storage, origin, user, item, now = Date.now()) {
    if (isPinned(storage, origin, user, item.path)) return { pinned: false, list: removePin(storage, origin, user, item.path) };
    return { pinned: true, list: addPin(storage, origin, user, item, now) };
}
