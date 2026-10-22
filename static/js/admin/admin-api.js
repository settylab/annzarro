/**
 * Client for the admin API (/api/v1/admin/*, design section 3).
 *
 * Every unsafe request carries the CSRF token (header X-AnnZarro-CSRF, read
 * from <meta name="annzarro-csrf">) and a JSON body. The server answers a
 * lapsed re-authentication window with 403 `reauth_required`; the client then
 * asks the page to confirm the password (the re-auth modal) and retries the
 * request once. A 401 `login_required` sends the browser to the login page, as
 * the main app does (utils/session-expiry.js). Failures are thrown as
 * AdminError, with a sentence fit to show.
 *
 * The page wires the callbacks; everything here takes `fetch` as a parameter,
 * so the module runs under `node --test`.
 */

import { appUrl, appRoot } from '../utils/app-url.js';
import { loginUrlFor } from '../utils/session-expiry.js';

export const CSRF_HEADER = 'X-AnnZarro-CSRF';
const API_BASE = '/api/v1/admin';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Sentences for the error `reason` codes of the design (3.1, 3.2, 9.6, 10.3). */
const REASON_TEXT = {
    admin_requires_login: 'The admin interface needs login to be enabled on this server.',
    admin_only: 'Only administrators can do this.',
    csrf_failed: 'The page is out of date. Reload it and try again.',
    json_required: 'The request was not sent as JSON.',
    reauth_required: 'Confirm your password to make changes.',
    admin_rate_limited: 'Too many requests. Slow down and try again in a moment.',
    bad_password: 'That password is not right.',
    locked: 'This account is locked after too many wrong passwords. Try again later.',
    invalid_username: 'Usernames use letters, digits and . _ @ - (up to 64 characters).',
    weak_password: 'Passwords need at least 10 characters and must differ from the username.',
    user_exists: 'A user with that name already exists.',
    unknown_user: 'No such user.',
    last_admin: 'This would leave the server without an administrator.',
    self: 'You cannot do this to your own account here. Use another administrator or the command line.',
    admin_roots_disabled: 'Adding directories is off. Set server.admin_data_roots in the configuration.',
    outside_admin_parents: 'That directory is not inside an allowed parent directory.',
    not_absolute: 'Give an absolute path.',
    not_a_directory: 'That is not a directory.',
    already_allowed: 'That directory is already allowed.',
    is_a_parent: 'That is an allowed parent itself. Add a directory below it.',
    contains_server_state: 'That directory holds the server\'s own files (users, admin state or saved panel sets).',
    unknown_root: 'No such directory in the list.',
    from_config: 'This directory comes from the configuration file and cannot be removed here.',
    not_a_root: 'That folder is not inside an allowed directory.',
    not_found: 'Not found.',
    locked_by_config: 'The configuration file locks this setting.',
    config_scope: 'This setting can only be changed in the configuration file.',
    admin_user: 'Administrators have no per-user overrides.',
    admin_unrestricted: 'Administrators are never restricted. Remove their admin right first.',
    unknown_key: 'Unknown setting.',
    bad_type: 'The value has the wrong type.',
    out_of_range: 'The value is out of range.',
    login_required: 'Your login has expired.',
};

/** A failed admin call. */
export class AdminError extends Error {
    /**
     * @param {string} message
     * @param {Object} [info]
     * @param {number} [info.status] - HTTP status, 0 when the request never got an answer
     * @param {string} [info.reason] - the server's `reason` code
     * @param {Object|null} [info.body] - the parsed error body
     * @param {number|null} [info.retryAfter] - seconds, from Retry-After
     */
    constructor(message, { status = 0, reason = '', body = null, retryAfter = null } = {}) {
        super(message);
        this.name = 'AdminError';
        this.status = status;
        this.reason = reason;
        this.body = body;
        this.retryAfter = retryAfter;
    }

    /** Per-field messages of a 400 `{errors: {name: reason}}` (settings), or {}. */
    get fieldErrors() {
        const e = this.body && this.body.errors;
        return e && typeof e === 'object' ? e : {};
    }
}

/**
 * Turn an error reply into an AdminError. The server's own sentence (`error`)
 * is kept when it sent one; the table only fills in for known codes.
 * @param {number} status
 * @param {Object|null} body - parsed JSON, or null
 * @param {string|null} [retryAfter] - the Retry-After header
 * @returns {AdminError}
 */
export function mapError(status, body, retryAfter = null) {
    const reason = body && typeof body.reason === 'string' ? body.reason : '';
    const wait = retryAfter !== null && retryAfter !== undefined && Number.isFinite(Number(retryAfter))
        ? Number(retryAfter) : null;
    let message = (body && typeof body.error === 'string' && body.error) || REASON_TEXT[reason] || '';
    if (!message) {
        if (status === 401) message = REASON_TEXT.login_required;
        else if (status === 403) message = REASON_TEXT.admin_only;
        else if (status === 404) message = REASON_TEXT.not_found;
        else if (status === 429) message = REASON_TEXT.admin_rate_limited;
        else if (status >= 500) message = 'The server had a problem. Try again, and check the server log if it persists.';
        else message = `The request failed (HTTP ${status}).`;
    }
    return new AdminError(message, { status, reason: reason || `http_${status}`, body, retryAfter: wait });
}

/**
 * The CSRF token the server rendered into the page.
 * @param {Document} [doc]
 * @returns {string} "" when absent
 */
export function readCsrfToken(doc = globalThis.document) {
    const meta = doc && doc.querySelector ? doc.querySelector('meta[name="annzarro-csrf"]') : null;
    return meta ? (meta.getAttribute('content') || '') : '';
}

/** `?a=1&b=2` from the defined, non-empty entries of `params`. */
function queryString(params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
        if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
    }
    const s = q.toString();
    return s ? `?${s}` : '';
}

async function readBody(response) {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/**
 * @param {Object} options
 * @param {function} [options.fetchImpl] - defaults to window.fetch
 * @param {string} [options.root] - the app's mount point
 * @param {string|function(): string} [options.csrf] - the token, or a getter
 * @param {function(Object): Promise<void>} [options.requestReauth] - opens the
 *        re-auth modal with {reauth_url}; resolves once the password was
 *        confirmed, rejects when the user cancels
 * @param {function(number|null): void} [options.onSlowDown] - on 429
 * @param {function(string): void} [options.navigate] - login redirect
 * @param {Object} [options.location] - provides href and origin
 * @returns {Object} adminFetch, reauth and one namespace per section
 */
export function createAdminApi({
    fetchImpl, root, csrf, requestReauth, onSlowDown, navigate, location,
} = {}) {
    const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
    const mount = root === undefined ? appRoot() : root;
    const loc = location || globalThis.location;
    const token = () => (typeof csrf === 'function' ? csrf() : (csrf === undefined ? readCsrfToken() : csrf));
    let pendingReauth = null;
    let redirecting = false;

    function reauthOnce(info) {
        if (!requestReauth) return Promise.reject(new AdminError(REASON_TEXT.reauth_required, { status: 403, reason: 'reauth_required' }));
        if (!pendingReauth) {
            pendingReauth = Promise.resolve(requestReauth(info)).finally(() => { pendingReauth = null; });
        }
        return pendingReauth;
    }

    /**
     * @param {string} path - under /api/v1/admin ("/users"), or a full "/api/..." path
     * @param {Object} [opts]
     * @param {string} [opts.method]
     * @param {Object} [opts.body] - sent as JSON; unsafe methods always send a JSON body
     * @param {Object} [opts.query]
     * @param {boolean} [opts.noReauth] - do not open the re-auth modal for this call
     * @returns {Promise<*>} the parsed reply body (null when empty)
     */
    async function adminFetch(path, { method = 'GET', body, query, noReauth = false } = {}, retried = false) {
        const verb = method.toUpperCase();
        const unsafe = UNSAFE.has(verb);
        const headers = { Accept: 'application/json' };
        const init = { method: verb, headers, credentials: 'same-origin', cache: 'no-store' };
        if (unsafe) {
            const t = token();
            if (!t) {
                throw new AdminError(REASON_TEXT.csrf_failed, { status: 0, reason: 'csrf_missing' });
            }
            headers[CSRF_HEADER] = t;
            headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body === undefined ? {} : body);
        }
        const full = path.startsWith('/api/') ? path : API_BASE + path;
        let response;
        try {
            response = await doFetch(appUrl(full + queryString(query), mount), init);
        } catch {
            throw new AdminError('Could not reach the server. Check your connection.', { status: 0, reason: 'network' });
        }
        const data = await readBody(response);
        if (response.ok) return data;

        const reason = data && data.reason;
        if (response.status === 401 && reason === 'login_required') {
            if (!redirecting && loc) {
                redirecting = true;
                const go = navigate || ((url) => loc.assign(url));
                go(loginUrlFor(loc.href, mount, loc.origin));
            }
        } else if (response.status === 403 && reason === 'reauth_required' && !retried && !noReauth) {
            try {
                await reauthOnce(data);
            } catch (e) {
                if (e instanceof AdminError) throw e;
                throw new AdminError('Password confirmation was cancelled.', { status: 403, reason: 'reauth_cancelled', body: data });
            }
            return adminFetch(path, { method, body, query, noReauth }, true);
        } else if (response.status === 429 && onSlowDown) {
            onSlowDown(mapError(429, data, response.headers.get('Retry-After')).retryAfter);
        }
        throw mapError(response.status, data, response.headers.get('Retry-After'));
    }

    const get = (path, query) => adminFetch(path, { query });
    const send = (method, path, body) => adminFetch(path, { method, body });
    const seg = encodeURIComponent;

    return {
        adminFetch,
        /** Confirm the password (opens the re-auth window). */
        reauth: (password) => adminFetch('/reauth', { method: 'POST', body: { password }, noReauth: true }),
        audit: { list: (query) => get('/audit', query) },
        users: {
            list: () => get('/users'),
            add: (body) => send('POST', '/users', body),
            remove: (name, body) => send('DELETE', `/users/${seg(name)}`, body),
            setPassword: (name, body) => send('POST', `/users/${seg(name)}/password`, body),
            setAdmin: (name, isAdmin) => send('POST', `/users/${seg(name)}/admin`, { is_admin: isAdmin }),
            unlock: (name, address) => send('POST', `/users/${seg(name)}/unlock`, address ? { address } : {}),
        },
        access: {
            overview: () => get('/access'),
            get: (name, query) => get(`/users/${seg(name)}/access`, query),
            setRestricted: (name, restricted) => send('PUT', `/users/${seg(name)}/access`, { restricted }),
            grant: (name, kind, path) => send('POST', `/users/${seg(name)}/grants`, { kind, path }),
            revoke: (name, path) => send('DELETE', `/users/${seg(name)}/grants`, { path }),
            check: (user, path) => get('/access/check', { user, path }),
        },
        dataRoots: {
            list: () => get('/data-roots'),
            browse: (path) => get('/data-roots/browse', { path }),
            datasets: (query) => get('/data-roots/datasets', query),
            add: (path) => send('POST', '/data-roots', { path }),
            remove: (path) => send('DELETE', '/data-roots', { path }),
        },
        health: {
            get: () => get('/health'),
            versionCheck: () => get('/version-check'),
            clearCache: (datasetPath) => send('POST', '/cache/clear', datasetPath ? { dataset_path: datasetPath } : {}),
            rebuildTextIndex: () => send('POST', '/text-index/rebuild', {}),
        },
        panelSets: {
            list: (query) => get('/panel-sets', query),
            reassign: (body) => send('POST', '/panel-sets/reassign', body),
            remove: (names) => send('DELETE', '/panel-sets', { names }),
        },
        site: {
            /** The four texts as the pages show them now, a config file's `file` read */
            texts: () => get('/site/texts'),
        },
        policy: {
            get: () => get('/policy'),
            set: (changes) => send('PUT', '/policy', changes),
            getUser: (name) => get(`/users/${seg(name)}/policy`),
            setUser: (name, changes) => send('PUT', `/users/${seg(name)}/policy`, changes),
        },
    };
}
