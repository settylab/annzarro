/**
 * The administrator's policy, as this user sees it.
 *
 * The server resolves it (GET /api/v1/policy/effective: {version, values});
 * this module never decides anything itself. Panels read it for what to
 * offer (panel.<type>.enabled) and what the Gene Set Analysis panel may send
 * (outbound.allow_external, panel.gene-set.*).
 *
 * A server without the endpoint (older, or before the policy registry
 * landed) answers 404: the policy is then "not available", every value is
 * absent, and callers fall back to what /api/v1/config says, which is how the
 * app behaved before policy existed.
 *
 * The policy can change under an open tab. Every API reply carries
 * X-AnnZarro-Policy, a version; installFetchObserver() watches the replies
 * of the page's own fetches and reloads the policy when the version differs.
 * A Gene Set Run reads it fresh (fresh()) before anything leaves the browser.
 *
 * Pure of the page apart from fetch and the mount point, so `node --test`
 * runs it.
 */
import { appUrl } from './utils/app-url.js';

export const POLICY_HEADER = 'X-AnnZarro-Policy';

const EXTERNAL_MODES = ['on', 'ask', 'off', 'none'];

/**
 * @param {{fetchImpl?: Function, url?: string}} [opts] `fetchImpl` defaults to
 *   the global fetch at the time of each call; `url` is the endpoint.
 */
export function createPolicy({ fetchImpl = null, url = appUrl('/api/v1/policy/effective') } = {}) {
    const apiBase = url.replace(/\/policy\/effective$/, '');
    let state = { available: false, version: null, values: {} };
    let loading = null;
    const listeners = new Set();

    const doFetch = (...a) => (fetchImpl || globalThis.fetch)(...a);

    /** One read of the endpoint: {status: 'ok'|'absent'|'error', version, values}. */
    async function read(keys) {
        const target = keys && keys.length ? `${url}?keys=${keys.map(encodeURIComponent).join(',')}` : url;
        let resp;
        try {
            resp = await doFetch(target, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
        } catch {
            return { status: 'error' };
        }
        if (resp.status === 404) return { status: 'absent' };
        if (!resp.ok) return { status: 'error' };
        let body;
        try {
            body = await resp.json();
        } catch {
            return { status: 'error' };
        }
        if (!body || typeof body !== 'object' || !body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
            return { status: 'error' };
        }
        const header = resp.headers && typeof resp.headers.get === 'function' ? resp.headers.get(POLICY_HEADER) : null;
        const version = body.version !== undefined && body.version !== null ? String(body.version) : header;
        return { status: 'ok', version: version || null, values: body.values };
    }

    function set(next) {
        const changed = JSON.stringify(next) !== JSON.stringify(state);
        state = next;
        if (changed) for (const cb of [...listeners]) { try { cb(state); } catch (e) { console.error('policy listener:', e); } }
    }

    /** (Re)load the whole policy. Never throws; concurrent calls share one request. */
    function load() {
        if (!loading) {
            loading = read().then((r) => {
                if (r.status === 'ok') set({ available: true, version: r.version, values: r.values });
                else if (r.status === 'absent') set({ available: false, version: null, values: {} });
                // a failed read keeps what is known: no policy yet means today's behaviour
                return state;
            }).finally(() => { loading = null; });
        }
        return loading;
    }

    /**
     * The policy right now, before something that must obey it.
     * @param {string[]} [keys] limit the read to these keys
     * @returns {Promise<{status: 'ok', values: Object}|{status: 'absent'}|{status: 'error'}>}
     *   `absent`: this server has no policy (nothing to obey); `error`: it has
     *   one and it could not be read, so the caller must not assume it allows.
     */
    async function fresh(keys) {
        const r = await read(keys);
        if (r.status === 'ok') {
            const whole = !keys || !keys.length;
            set({ available: true, version: r.version || state.version, values: whole ? r.values : { ...state.values, ...r.values } });
            return { status: 'ok', values: r.values };
        }
        if (r.status === 'absent') {
            set({ available: false, version: null, values: {} });
            return { status: 'absent' };
        }
        return { status: state.available ? 'error' : 'absent' };
    }

    /** Reload when a reply from this server names another policy version. */
    function observe(response, requestUrl) {
        const u = typeof requestUrl === 'string' ? requestUrl : '';
        if (!u.startsWith(apiBase) || u.startsWith(url)) return;
        const header = response && response.headers && typeof response.headers.get === 'function'
            ? response.headers.get(POLICY_HEADER) : null;
        if (header && header !== state.version) load();
    }

    /** Watch every reply of `target.fetch` (once); the policy's own reads use the original. */
    function installFetchObserver(target = globalThis) {
        if (!target.fetch || target.fetch._annzarroPolicy) return;
        const original = target.fetch.bind(target);
        const watched = async (input, ...rest) => {
            const response = await original(input, ...rest);
            try {
                observe(response, typeof input === 'string' ? input : (input && input.url) || String(input));
            } catch { /* watching must never fail a request */ }
            return response;
        };
        watched._annzarroPolicy = true;
        if (!fetchImpl) fetchImpl = original;
        target.fetch = watched;
    }

    return {
        load, fresh, observe, installFetchObserver,
        isAvailable: () => state.available,
        version: () => state.version,
        values: () => ({ ...state.values }),
        /** The value of a key, or `fallback` when the policy does not set it. */
        get: (key, fallback = undefined) => (Object.prototype.hasOwnProperty.call(state.values, key) ? state.values[key] : fallback),
        /** Whether panel type `type` may be used (true when the policy says nothing). */
        panelEnabled: (type) => state.values[`panel.${type}.enabled`] !== false,
        /** Call `cb(state)` when the policy changes; returns the unsubscribe. */
        onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
    };
}

/**
 * What the Gene Set Analysis panel may do: the policy's values over what
 * /api/v1/config said (`integrations`, from config.js readIntegrations).
 *
 * `outbound.allow_external: false` is the one switch: nothing is sent, no
 * service is offered, species search and the Links (which open third-party
 * sites) are gone. `external_requests: none` is the same without the switch.
 * With no policy value set, the result is the config's, unchanged.
 * @param {Object} values - policy values (may be empty)
 * @param {{externalRequests?: string, services?: string[]|null}} [integrations]
 * @returns {{externalRequests: 'ask'|'on'|'off', services: string[]|null,
 *   links: boolean, speciesSearch: boolean, outbound: boolean}}
 *   externalRequests is 'off' for both off and none; `outbound` is false for
 *   everything that sends nothing and offers no links (none, or the switch)
 */
export function geneSetPolicy(values, integrations) {
    const v = values || {};
    const base = integrations || {};
    const given = v['panel.gene-set.external_requests'];
    let mode = EXTERNAL_MODES.includes(given) ? given : (base.externalRequests || 'ask');
    let services = Array.isArray(v['panel.gene-set.services'])
        ? v['panel.gene-set.services'].filter(x => typeof x === 'string')
        : (Array.isArray(base.services) ? base.services : null);
    let links = v['panel.gene-set.links'] !== false;
    let speciesSearch = v['panel.gene-set.species_search'] !== false;
    if (v['outbound.allow_external'] === false) mode = 'none';
    if (mode === 'none') {
        services = [];
        links = false;
        speciesSearch = false;
    }
    return {
        externalRequests: mode === 'none' ? 'off' : mode,
        services, links, speciesSearch,
        outbound: mode !== 'none'
    };
}

/** The page's policy. */
export const Policy = createPolicy();
