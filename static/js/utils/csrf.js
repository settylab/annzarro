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
 * Pure functions apart from the one meta lookup, so they run under `node --test`.
 */

export const CSRF_HEADER = 'X-AnnZarro-CSRF';

/**
 * @param {Document} [doc]
 * @returns {string} The token, or "" when login is off or the tag is missing.
 */
export function csrfToken(doc = globalThis.document) {
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
