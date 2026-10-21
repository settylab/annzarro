/**
 * The dataset listings the browser has obtained, kept so that opening the dataset
 * browser again shows them at once while the server is asked for fresh ones
 * (stale while revalidate).
 *
 * What is kept is the first page of each listing the dataset browser read: the data
 * directory, and every folder it opened, in the sort the server was asked for.
 * Never a later page, a search or the details of a dataset (those stay in the tab's memory).
 *
 * Two layers: a map in memory for the tab, and a copy in the browser's storage (the
 * convenience storage of utils/convenience-storage.js, so a site set to session-only
 * keeps it only until the tab closes) that survives a reload. The storage key is
 * `annzarro.listings:<origin and URL prefix>|<user>`, value
 * `{v: 1, items: [{id, at, listing}]}`, newest first. Each user of each server has
 * a key of their own; when the user the cache is asked for is not the one it held,
 * what it held is dropped, in memory and in storage, so a second login never
 * sees the first one's listing.
 *
 * Bounded: LISTINGS_LIMIT listings of at most LISTING_ENTRIES_LIMIT entries, and
 * LISTINGS_MAX_CHARS characters in storage (the oldest go first). Nothing here
 * throws: storage may be missing, full or blocked.
 */

export const LISTINGS_KEY_PREFIX = 'annzarro.listings:';
export const LISTINGS_LIMIT = 40;
export const LISTING_ENTRIES_LIMIT = 200;
export const LISTINGS_MAX_CHARS = 400000;

/** The storage key of `user` on `scope` (origin plus URL prefix). */
export function listingsKey(scope, user) {
    return `${LISTINGS_KEY_PREFIX}${scope || ''}|${user || 'local'}`;
}

/** The id of a listing: the folder ('' for the data directory) and the sort the server was asked for ({key, dir} or null). */
export function listingId(folder, sort) {
    return `${folder || ''}\n${sort && sort.key ? `${sort.key}:${sort.dir === 'desc' ? 'desc' : 'asc'}` : ''}`;
}

function cleanListing(listing) {
    if (!listing || !Array.isArray(listing.entries)) return null;
    const entries = listing.entries.filter(e => e && typeof e.path === 'string' && e.path).slice(0, LISTING_ENTRIES_LIMIT);
    const total = Number.isFinite(listing.total) ? listing.total : entries.length;
    return {
        entries,
        total,
        more: entries.length < total,
        parent: typeof listing.parent === 'string' ? listing.parent : null,
        rel: typeof listing.rel === 'string' ? listing.rel : '',
        folder: typeof listing.folder === 'string' ? listing.folder : ''
    };
}

function cleanItems(raw) {
    const items = raw && raw.v === 1 && Array.isArray(raw.items) ? raw.items : [];
    const seen = new Set();
    const out = [];
    for (const item of items) {
        if (!item || typeof item.id !== 'string' || seen.has(item.id)) continue;
        const listing = cleanListing(item.listing);
        if (!listing) continue;
        seen.add(item.id);
        out.push({ id: item.id, at: Number.isFinite(item.at) ? item.at : 0, listing });
    }
    return out.slice(0, LISTINGS_LIMIT);
}

/**
 * @param {{storage: Storage|null, scope: string, now?: () => number}} env
 *   `scope` is the origin plus the URL prefix of the server; `storage` may be null (blocked)
 */
export function createListingCache({ storage, scope, now = Date.now }) {
    let held = null;              // the user the memory holds listings of
    let items = [];               // newest first

    const read = user => {
        try {
            const raw = storage && storage.getItem(listingsKey(scope, user));
            return raw ? cleanItems(JSON.parse(raw)) : [];
        } catch { return []; }
    };

    function persist(user) {
        if (!storage) return;
        const key = listingsKey(scope, user);
        let keep = items.slice();
        let text = JSON.stringify({ v: 1, items: keep });
        while (text.length > LISTINGS_MAX_CHARS && keep.length > 1) {
            keep = keep.slice(0, -1);          // the oldest go first
            text = JSON.stringify({ v: 1, items: keep });
        }
        try {
            if (text.length > LISTINGS_MAX_CHARS) storage.removeItem(key);     // one listing alone is too large
            else storage.setItem(key, text);
        } catch { /* storage full or blocked: the memory still serves this tab */ }
    }

    /** Forget what storage holds of every user of this server but `who` (a page load does not know who held it before). */
    function dropOthers(who) {
        if (!storage || typeof storage.key !== 'function') return;
        try {
            const mine = listingsKey(scope, who);
            const prefix = `${LISTINGS_KEY_PREFIX}${scope || ''}|`;
            const stale = [];
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                if (key && key.startsWith(prefix) && key !== mine) stale.push(key);
            }
            stale.forEach(key => storage.removeItem(key));
        } catch { /* blocked */ }
    }

    /** Make `user` the one the cache holds; another user's listings (memory and storage) are dropped. */
    function switchTo(user) {
        const who = user || 'local';
        if (held === who) return;
        dropOthers(who);
        held = who;
        items = read(who);
    }

    return {
        /** The cached listing `{entries, total, more, parent, rel, folder, at}` of `user`, or null. */
        get(user, id) {
            switchTo(user);
            const item = items.find(i => i.id === id);
            return item ? { ...item.listing, at: item.at } : null;
        },
        /** Keep the first page of a listing; returns whether it was kept. */
        put(user, id, listing) {
            switchTo(user);
            const clean = cleanListing(listing);
            if (!clean) return false;
            items = [{ id, at: now(), listing: clean }, ...items.filter(i => i.id !== id)].slice(0, LISTINGS_LIMIT);
            persist(held);
            return true;
        },
        /** Forget one listing (the server said it is gone). */
        drop(user, id) {
            switchTo(user);
            items = items.filter(i => i.id !== id);
            persist(held);
        },
        /** Forget everything of `user`. */
        clear(user) {
            switchTo(user);
            items = [];
            if (storage) { try { storage.removeItem(listingsKey(scope, held)); } catch { /* blocked */ } }
        },
        /** How many listings the memory holds (tests). */
        size() { return items.length; }
    };
}
