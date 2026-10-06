/**
 * Whether gene ids may be sent to an external service: a decision of the
 * client, within what the server allows.
 *
 * Precedence, first that applies wins (docs/user-guide/gene-set.md):
 *   1. The server (integrations.external_requests): `off` sends nothing,
 *      ever, whatever anything below says; `on` sends without asking.
 *   2. The user's "Never" for a service, stored in this browser.
 *   3. A share link's consent, for exactly its gene selection: the link
 *      names the hosts its author agreed to and the hash of the selection
 *      they agreed for. Another selection (the table filtered differently,
 *      another species or ID column) is not covered: it falls through.
 *   4. The user's answer for this page ("Send"), or their "Always" for a
 *      service, stored in this browser.
 *   5. Otherwise the user is asked.
 * A service that keeps lists where others can read them (Enrichr,
 * Reactome) is never covered by 3 or by "Always": it is asked once a page.
 *
 * Stored in localStorage['annzarro:external-ok'] as {host: 'allow'|'deny'};
 * a list of hosts (the earlier form) reads as all 'allow'. Storage that is
 * missing or throws (private windows, blocked site data) means "ask".
 */

export const STORAGE_KEY = 'annzarro:external-ok';

/** Hosts agreed to for this page load, shared by every panel. */
const _session = new Set();

function readStored(storage) {
    try {
        const raw = storage && storage.getItem(STORAGE_KEY);
        const value = raw ? JSON.parse(raw) : {};
        if (Array.isArray(value)) return Object.fromEntries(value.filter(h => typeof h === 'string').map(h => [h, 'allow']));
        if (!value || typeof value !== 'object') return {};
        return Object.fromEntries(Object.entries(value).filter(([, v]) => v === 'allow' || v === 'deny'));
    } catch {
        return {};
    }
}

function writeStored(storage, map) {
    try {
        if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch { /* not remembered: asked again next time */ }
}

/**
 * @param {{policy: 'ask'|'on'|'off', storage?: Storage|null,
 *   link?: {selection: string, hosts: string[]}|null, selection?: string|null}} opts
 *   `link`: the consent a share link carried; `selection`: the hash of the
 *   selection about to be sent (state.js setHash of the snapshot's ids)
 */
export function createConsent({ policy, storage = null, link = null, selection = null }) {
    const linkCovers = (r) => !!(link && r.persistable && selection && link.selection === selection && link.hosts.includes(r.host));

    /** 'send', 'deny' or 'ask' for one request {host, persistable}, and why. */
    function decide(r) {
        if (policy === 'off') return { answer: 'deny', why: 'server' };
        if (policy === 'on') return { answer: 'send', why: 'server' };
        const stored = readStored(storage)[r.host];
        if (stored === 'deny' && r.persistable) return { answer: 'deny', why: 'user' };
        if (linkCovers(r)) return { answer: 'send', why: 'link' };
        if (_session.has(r.host)) return { answer: 'send', why: 'page' };
        if (stored === 'allow' && r.persistable) return { answer: 'send', why: 'user' };
        return { answer: 'ask', why: '' };
    }

    return {
        policy,
        decide,
        /** Requests that still need the user's answer, one per host. */
        missing(requests) {
            const out = [];
            for (const r of requests) {
                if (decide(r).answer === 'ask' && !out.some(o => o.host === r.host)) out.push(r);
            }
            return out;
        },
        /** Hosts the user said "Never" to, among `requests`. */
        denied(requests) {
            return [...new Set(requests.filter(r => decide(r).answer === 'deny' && decide(r).why === 'user').map(r => r.host))];
        },
        /** Yes for this page; with `always`, for this browser (persistable hosts only). */
        grant(requests, { always = false } = {}) {
            for (const r of requests) _session.add(r.host);
            if (!always) return;
            const map = readStored(storage);
            for (const r of requests) if (r.persistable) map[r.host] = 'allow';
            writeStored(storage, map);
        },
        /** "Never" for these services, in this browser. */
        deny(requests) {
            const map = readStored(storage);
            for (const r of requests) {
                _session.delete(r.host);
                if (r.persistable) map[r.host] = 'deny';
            }
            writeStored(storage, map);
        },
        /** Forget the stored answer for `hosts` (all of them without hosts): asked again. */
        forget(hosts = null) {
            const map = readStored(storage);
            for (const h of hosts || Object.keys(map)) {
                delete map[h];
                _session.delete(h);
            }
            writeStored(storage, map);
        }
    };
}

/** The stored answers: {host: 'allow'|'deny'} (for the panel's list of them). */
export function storedAnswers(storage) {
    return readStored(storage);
}

/** For tests: forget this page's answers. */
export function _resetSessionConsent() {
    _session.clear();
}
