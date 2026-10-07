/**
 * Clearing what this site stored in this browser ("Close all panels", with
 * its checkbox ticked), so the app can start as on a first visit.
 *
 * Cleared, for this origin only: localStorage, sessionStorage, IndexedDB (every
 * database), Cache Storage and service-worker registrations.
 *
 * Never touched: cookies. The login is a server-side session cookie
 * (HttpOnly); no auth or CSRF state is kept in localStorage or
 * sessionStorage (checked in static/js), so KEEP is empty. A key that ever
 * holds one must be listed here, and it survives the clear.
 */

/** Storage keys that survive the clear, per area. */
export const KEEP = Object.freeze({ local: [], session: [] });

/** The page's own address with no query and no fragment: a first visit. */
export function bareUrl(loc) {
    return `${loc.origin}${loc.pathname}`;
}

function clearArea(area, keep) {
    if (!area) return;
    const kept = new Map();
    for (const key of keep) {
        const value = area.getItem(key);
        if (value !== null) kept.set(key, value);
    }
    area.clear();
    kept.forEach((value, key) => area.setItem(key, value));
}

/**
 * Clear the site's browser storage. Each store is cleared on its own: one
 * that fails (blocked, unsupported) is listed in `failed` and the rest are
 * still cleared. Resolves { cleared: string[], failed: string[] }.
 * @param {Object} [env] the browser globals (window), injectable for tests
 */
export async function clearSiteStorage(env = globalThis) {
    const cleared = [];
    const failed = [];
    const step = async (name, fn) => {
        try { await fn(); cleared.push(name); } catch { failed.push(name); }
    };

    await step('localStorage', () => clearArea(env.localStorage, KEEP.local));
    await step('sessionStorage', () => clearArea(env.sessionStorage, KEEP.session));

    const idb = env.indexedDB;
    if (idb && typeof idb.databases === 'function') {
        await step('indexedDB', async () => {
            const dbs = await idb.databases();
            await Promise.all(dbs.filter(d => d && d.name).map(d => new Promise(resolve => {
                const req = idb.deleteDatabase(d.name);
                // a blocked delete finishes when the page unloads; do not wait on it
                req.onsuccess = req.onerror = req.onblocked = () => resolve();
            })));
        });
    }

    if (env.caches && typeof env.caches.keys === 'function') {
        await step('caches', async () => {
            const names = await env.caches.keys();
            await Promise.all(names.map(n => env.caches.delete(n)));
        });
    }

    const sw = env.navigator && env.navigator.serviceWorker;
    if (sw && typeof sw.getRegistrations === 'function') {
        await step('serviceWorkers', async () => {
            const regs = await sw.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
        });
    }
    return { cleared, failed };
}
