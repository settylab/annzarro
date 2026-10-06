/**
 * Which hosts the user agreed to send gene lists to.
 *
 * The server decides first (integrations.external_requests): `off` sends
 * nothing ever, `on` sends without asking (users agreed out of band), `ask`
 * (the default) asks on the first Run for every host not yet agreed to.
 * "Always" is remembered per browser profile in localStorage; "Send" for
 * this page only. A service that keeps lists where others can read them
 * (Enrichr, Reactome) is asked every page load and never remembered.
 *
 * Storage may be missing or throw (private windows, blocked site data):
 * then the user is simply asked again.
 */

export const STORAGE_KEY = 'annzarro:external-ok';

/** Hosts agreed to for this page load, shared by every panel. */
const _session = new Set();

function readStored(storage) {
    try {
        const raw = storage && storage.getItem(STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.filter(h => typeof h === 'string') : [];
    } catch {
        return [];
    }
}

/**
 * @param {{policy: 'ask'|'on'|'off', storage?: Storage|null}} opts
 */
export function createConsent({ policy, storage = null }) {
    return {
        policy,
        /** Hosts of `requests` ({host, persistable}) that still need a yes. */
        missing(requests) {
            if (policy !== 'ask') return [];
            const stored = new Set(readStored(storage));
            const out = [];
            for (const r of requests) {
                if (_session.has(r.host) || (r.persistable && stored.has(r.host))) continue;
                if (!out.some(o => o.host === r.host)) out.push(r);
            }
            return out;
        },
        /** Yes for this page, and with `always` for this browser (persistable hosts only). */
        grant(requests, { always = false } = {}) {
            for (const r of requests) _session.add(r.host);
            if (!always) return;
            try {
                const stored = new Set(readStored(storage));
                for (const r of requests) if (r.persistable) stored.add(r.host);
                storage && storage.setItem(STORAGE_KEY, JSON.stringify([...stored].sort()));
            } catch { /* not remembered: asked again next time */ }
        }
    };
}

/** For tests: forget this page's answers. */
export function _resetSessionConsent() {
    _session.clear();
}
