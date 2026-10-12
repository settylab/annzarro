/**
 * The CSRF token of this page, for requests to this server that change state.
 *
 * With login on, the server renders the signed-in user's token into
 * <meta name="annzarro-csrf"> and refuses a POST/DELETE without it
 * (server/csrf.py). With login off the tag is empty and no header is sent:
 * the server then judges such requests by their Origin alone.
 *
 * Only for this server's own URLs: never attach it to a request for another
 * host.
 *
 * A page left open across a server upgrade or a new login holds an old token.
 * csrfFetch answers a refusal for that once: it asks for the current token
 * (auth/me) and repeats the request. If that is refused as well, the caller
 * gets the server's answer, which tells the user to reload the page.
 *
 * Pure functions apart from the one meta lookup, so they run under `node --test`.
 */

import { appUrl } from './app-url.js';

export const CSRF_HEADER = 'X-AnnZarro-CSRF';

// the token fetched after a refusal; it replaces the page's own for good
let refreshed = '';

/**
 * @param {Document} [doc]
 * @returns {string} The token, or "" when login is off or the tag is missing.
 */
export function csrfToken(doc = globalThis.document) {
    if (refreshed) return refreshed;
    const meta = doc && doc.querySelector ? doc.querySelector('meta[name="annzarro-csrf"]') : null;
    return (meta && meta.getAttribute('content')) || '';
}

/**
 * Request headers carrying the token, merged into `headers`. A multipart body
 * must not set Content-Type itself (the browser adds the boundary), so pass
 * only what the call needs.
 * @param {Object<string, string>} [headers]
 * @param {Document} [doc]
 * @returns {Object<string, string>}
 */
export function csrfHeaders(headers = {}, doc = globalThis.document) {
    const token = csrfToken(doc);
    return token ? { ...headers, [CSRF_HEADER]: token } : { ...headers };
}

/** Forget a refreshed token (for tests). */
export function resetRefreshedToken() {
    refreshed = '';
}

async function isForgeryRefusal(response) {
    if (response.status !== 403) return false;
    try {
        const text = await response.clone().text();
        return text.includes('csrf_failed') || text.includes('The page is out of date');
    } catch (error) {
        return false;
    }
}

async function currentToken(fetchImpl) {
    try {
        const response = await fetchImpl(appUrl('/api/v1/auth/me'));
        if (!response.ok) return '';
        return ((await response.json()).csrf) || '';
    } catch (error) {
        return '';
    }
}

/**
 * fetch() for this server's requests that change state: adds the token, and
 * when the server refuses it as out of date, takes the current one and sends
 * the request once more. The body must be reusable (a string or FormData).
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {{fetchImpl: function, doc: Document}} [env]
 * @returns {Promise<Response>}
 */
export async function csrfFetch(url, init = {}, { fetchImpl = globalThis.fetch, doc = globalThis.document } = {}) {
    const send = () => fetchImpl(url, { ...init, headers: csrfHeaders(init.headers || {}, doc) });
    const sent = csrfToken(doc);
    const response = await send();
    // no token sent: login is off and the refusal is about the Origin, which a new token cannot fix
    if (!sent || !(await isForgeryRefusal(response))) return response;
    const fresh = await currentToken(fetchImpl);
    if (!fresh || fresh === sent) return response;
    refreshed = fresh;
    return send();
}
