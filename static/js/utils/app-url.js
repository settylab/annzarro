/**
 * URLs of this AnnZarro server, wherever it is mounted.
 *
 * Behind a reverse proxy the app may live under a path such as /explore/
 * (server.url_prefix, or X-Forwarded-Prefix from a trusted proxy). The server
 * renders that prefix into <meta name="annzarro-root"> (request.script_root:
 * "" at the root, "/explore" under a prefix), and every URL the frontend
 * builds for its own server goes through appUrl(), so nothing is sent to the
 * host's root by accident.
 *
 * Pure functions apart from the one meta lookup, so they run under `node --test`.
 */

/**
 * The mount point as rendered by the server: "" or "/explore" (no trailing
 * slash). Anything that is not a plain absolute path is ignored, so a
 * tampered or missing tag falls back to the root rather than another host.
 * @param {string|null|undefined} value - The meta tag's content.
 * @returns {string}
 */
export function normalizeRoot(value) {
    if (typeof value !== 'string') return '';
    const root = value.trim().replace(/\/+$/, '');
    if (!root) return '';
    if (!root.startsWith('/') || root.startsWith('//') || /[\\?#\s]/.test(root)) return '';
    return root;
}

/**
 * The mount point of the page currently loaded.
 * @param {Document} [doc]
 * @returns {string}
 */
export function appRoot(doc = globalThis.document) {
    const meta = doc && doc.querySelector ? doc.querySelector('meta[name="annzarro-root"]') : null;
    return normalizeRoot(meta ? meta.getAttribute('content') : '');
}

/**
 * `path` (absolute within the app, e.g. "/api/v1/config") under the mount point.
 * @param {string} path
 * @param {string} [root] - Defaults to appRoot().
 * @returns {string}
 */
export function appUrl(path, root = appRoot()) {
    const p = String(path || '/');
    return normalizeRoot(root) + (p.startsWith('/') ? p : '/' + p);
}
