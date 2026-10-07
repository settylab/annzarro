/**
 * The open store's identity, asked of the server (GET /data/fingerprint):
 * its fingerprint, its path relative to the data directory, and the
 * server's AnnZarro version. Kept per path, so a saved view (captureView,
 * which is synchronous) records what is known without waiting.
 *
 * The fingerprint of a large store is computed in the background on the
 * server (about 10 s at 95.6M cells, once; it is then persisted). Nothing
 * here blocks a first paint: the probe asks with wait=0 and gets the
 * metadata tier at once; `settle` waits a bounded time for the rest.
 */
import { Config } from '../config.js';

const _known = new Map();   // path -> last probe result

/**
 * Ask the server about a store.
 * @param {string} path
 * @param {{wait?: number, signal?: AbortSignal}} [opts] - wait in seconds (server-side, at most 10)
 * @returns {Promise<{ok: boolean, status?: string, fingerprint?: Object, relPath?: string|null,
 *                    version?: string, httpStatus?: number, reason?: string, error?: string}>}
 */
export async function probeStore(path, { wait = 0, signal } = {}) {
    if (!path) return { ok: false, reason: 'not_found', error: 'No dataset path' };
    const url = `${Config.API.FINGERPRINT}?dataset_path=${encodeURIComponent(path)}&wait=${wait}`;
    let response;
    try {
        response = await fetch(url, { signal });
    } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        return { ok: false, reason: 'network', error: error.message || String(error) };
    }
    let body;
    try { body = await response.json(); } catch (e) { body = {}; }
    if (!response.ok) {
        return { ok: false, httpStatus: response.status, reason: body.reason || 'read_failed',
            error: body.error || response.statusText };
    }
    // `path` is the store as the server resolved it: a name relative to the
    // data directory comes back as the path it names there
    const result = { ok: true, status: body.status, fingerprint: body.fingerprint || null,
        relPath: body.rel_path || null, version: body.annzarro_version || null, path: body.path || path };
    _known.set(path, result);
    _known.set(result.path, result);
    return result;
}

/** The last answer for `path`, or null. */
export function knownStore(path) {
    return _known.get(path) || null;
}

/** Ask now and keep the answer; never throws. */
export function prewarmStore(path) {
    probeStore(path).catch(() => {});
}

/**
 * Wait up to `ms` for the store's full fingerprint (the server waits).
 * @returns {Promise<Object>} the probe result, ready or still pending
 */
export async function settleStore(path, ms = 3000) {
    const known = knownStore(path);
    if (known && known.status === 'ready') return known;
    return probeStore(path, { wait: Math.max(0, Math.min(10, ms / 1000)) });
}

/** The running AnnZarro version, as the server reports it. */
export function appVersion() {
    for (const result of _known.values()) if (result.version) return result.version;
    const cfg = Config.SERVER_CONFIG || {};
    return cfg.annzarro_version || null;
}
