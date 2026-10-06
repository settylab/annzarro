/**
 * One request to an external service, and what its failure was.
 *
 * Every request the Gene Set Analysis panel makes goes through
 * fetchWithPolicy: no cookies, no referrer (a share link's URL holds the
 * dataset path), a timeout per attempt, and a failure turned into a
 * ServiceError whose `kind` the panel states ("timed out after 20 s",
 * "could not reach string-db.org"). Pure apart from the injected fetch and
 * timers, so Node tests drive it (gene-set-runner.test.mjs).
 */

/** Longest wait a Retry-After may ask for before the panel stops waiting. */
export const MAX_RETRY_AFTER_MS = 30000;

export class ServiceError extends Error {
    /**
     * @param {{kind: 'aborted'|'timeout'|'network'|'http'|'rate-limit'|'parse'|'adapter',
     *   message: string, status?: number, retryAt?: number, host?: string, attempts?: number}} spec
     */
    constructor({ kind, message, status, retryAt, host, attempts }) {
        super(message);
        this.name = 'ServiceError';
        this.kind = kind;
        if (status !== undefined) this.status = status;
        if (retryAt !== undefined) this.retryAt = retryAt;
        if (host) this.host = host;
        this.attempts = attempts || 1;
    }

    /** Plain data for the section's run state (no stack). */
    toJSON() {
        const out = { kind: this.kind, message: this.message, attempts: this.attempts };
        if (this.status !== undefined) out.status = this.status;
        if (this.host) out.host = this.host;
        return out;
    }
}

/** The error an adapter throws for a reply it cannot read. */
export function parseError(message) {
    return new ServiceError({ kind: 'parse', message });
}

export function abortedError() {
    return new ServiceError({ kind: 'aborted', message: 'cancelled' });
}

/** Whether a second attempt might succeed: a timeout, no connection, a 5xx or a 429. */
export function isRetryable(error) {
    if (!error) return false;
    if (error.kind === 'timeout' || error.kind === 'network' || error.kind === 'rate-limit') return true;
    return error.kind === 'http' && error.status >= 500;
}

/**
 * The wait a Retry-After header asks for, in ms from `now`, capped at 30 s.
 * Seconds or an HTTP date; null when absent or unreadable.
 */
export function retryAfterMs(value, now) {
    if (value === null || value === undefined || value === '') return null;
    const s = String(value).trim();
    let ms;
    if (/^\d+(\.\d+)?$/.test(s)) ms = Number(s) * 1000;
    else {
        const t = Date.parse(s);
        if (Number.isNaN(t)) return null;
        ms = t - now;
    }
    return Math.max(0, Math.min(MAX_RETRY_AFTER_MS, ms));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** HTML entities as text: &nbsp; &amp; &#8211; &#x2013; ... */
export function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') {
            const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
        }
        return ENTITIES[e.toLowerCase()] ?? m;
    });
}

/**
 * What a service said when it refused, as one plain sentence: its JSON
 * error message when there is one (STRING: [{"Error", "ErrorMessage"}],
 * g:Profiler: {"message"}), else the text; HTML tags removed, entities
 * decoded, cut after the first sentence and at 200 characters. Never the
 * service's HTML on the page.
 */
export function bodyExcerpt(text) {
    let s = typeof text === 'string' ? text : '';
    try {
        let j = JSON.parse(s);
        if (Array.isArray(j)) j = j[0];
        if (j && typeof j === 'object') {
            const msg = j.ErrorMessage || j.message || j.error || j.Error || j.detail;
            if (typeof msg === 'string' && msg) s = j.Error && j.ErrorMessage ? `${j.Error}: ${j.ErrorMessage}` : msg;
        }
    } catch { /* not JSON: the text itself */ }
    s = decodeEntities(s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    const end = s.search(/[.!?](\s|$)/);
    if (end >= 0) s = s.slice(0, end + 1);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

/**
 * What a failed fetch() was, from the way it failed.
 * @param {*} error - what fetch (or reading its body) threw
 * @param {{aborted: boolean, timedOut: boolean, timeoutMs: number, host: string}} why
 */
export function classifyFetchError(error, { aborted, timedOut, timeoutMs, host }) {
    if (error instanceof ServiceError) return error;
    if (aborted) return abortedError();
    if (timedOut) {
        return new ServiceError({ kind: 'timeout', host, message: `timed out after ${Math.round(timeoutMs / 1000)} s` });
    }
    if (error && error.name === 'AbortError') return abortedError();
    // fetch rejects with a TypeError for no connection, a DNS failure, a
    // blocked request and a missing CORS header alike; the page cannot tell
    // them apart
    return new ServiceError({ kind: 'network', host,
        message: `could not reach ${host} (offline, blocked, or the service does not allow this site)` });
}

/** The error for a response that is not 2xx. */
export function httpError(status, text, { host, retryAfter, now }) {
    if (status === 429) {
        const wait = retryAfterMs(retryAfter, now);
        return new ServiceError({ kind: 'rate-limit', status, host,
            retryAt: wait === null ? undefined : now + wait,
            message: `${host} is limiting how often it may be asked (HTTP 429)` });
    }
    if (status >= 500) {
        return new ServiceError({ kind: 'http', status, host, message: `the service returned an error (HTTP ${status})` });
    }
    const excerpt = bodyExcerpt(text);
    return new ServiceError({ kind: 'http', status, host,
        message: `the service rejected the request (HTTP ${status})${excerpt ? `: ${excerpt}` : ''}` });
}

export function hostOf(url) {
    try {
        return new URL(url).host;
    } catch {
        return String(url);
    }
}

/**
 * The fetch() options for a request: no cookies, no referrer, CORS.
 * `form` is sent as application/x-www-form-urlencoded and `text` as
 * text/plain (neither needs a preflight); `json` as application/json;
 * `multipart` as multipart/form-data. Gene lists go in bodies, never in
 * URLs, so they are not in any server's access log.
 */
export function requestInit({ method, form, json, text, multipart, headers } = {}) {
    const init = { method: method || 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors' };
    const h = { ...(headers || {}) };
    if (form) {
        init.method = method || 'POST';
        init.body = new URLSearchParams(form);
    } else if (json !== undefined) {
        init.method = method || 'POST';
        init.body = JSON.stringify(json);
        h['Content-Type'] = 'application/json';
    } else if (text !== undefined) {
        init.method = method || 'POST';
        init.body = text;
        h['Content-Type'] = 'text/plain';
    } else if (multipart) {
        init.method = method || 'POST';
        const fd = new FormData();
        for (const [k, v] of Object.entries(multipart)) fd.append(k, v);
        init.body = fd;
    }
    if (Object.keys(h).length) init.headers = h;
    return init;
}

/** `url` with `query` appended (for GET parameters that are not gene lists). */
export function withQuery(url, query) {
    if (!query) return url;
    const u = new URL(url);
    for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }
    return u.toString();
}

/**
 * One attempt at a request, with a timeout, read as JSON, text or a Blob.
 * Rejects with a ServiceError; kind 'aborted' when `signal` aborted it.
 * The timeout also ends a request whose fetch ignores its signal.
 * @param {string} url
 * @param {Object} init - from requestInit
 * @param {{signal?: AbortSignal, timeoutMs: number, as?: 'json'|'text'|'blob',
 *   fetchImpl: Function, setTimeout: Function, clearTimeout: Function, now: () => number}} opts
 */
export async function fetchWithPolicy(url, init, { signal, timeoutMs, as = 'json', fetchImpl, setTimeout: setT, clearTimeout: clearT, now }) {
    const host = hostOf(url);
    if (signal && signal.aborted) throw abortedError();
    const ctrl = new AbortController();
    let timedOut = false;
    let rejectStop;
    const stopped = new Promise((_, reject) => { rejectStop = reject; });
    stopped.catch(() => {});
    const stop = () => {
        ctrl.abort();
        rejectStop(new DOMException('stopped', 'AbortError'));
    };
    const onAbort = () => stop();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const timer = setT(() => { timedOut = true; stop(); }, timeoutMs);
    const why = () => ({ aborted: !!(signal && signal.aborted), timedOut, timeoutMs, host });
    try {
        let resp;
        try {
            resp = await Promise.race([fetchImpl(url, { ...init, signal: ctrl.signal }), stopped]);
        } catch (error) {
            throw classifyFetchError(error, why());
        }
        let text = null, blob = null;
        try {
            if (as === 'blob' && resp.ok) blob = await Promise.race([resp.blob(), stopped]);
            else text = await Promise.race([resp.text(), stopped]);
        } catch (error) {
            throw classifyFetchError(error, why());
        }
        if (!resp.ok) {
            const retryAfter = resp.headers && typeof resp.headers.get === 'function' ? resp.headers.get('Retry-After') : null;
            throw httpError(resp.status, text, { host, retryAfter, now: now() });
        }
        if (as === 'blob') return blob;
        if (as === 'text') return text;
        try {
            return JSON.parse(text);
        } catch {
            throw new ServiceError({ kind: 'parse', host, message: 'the service answered with something that is not JSON' });
        }
    } finally {
        clearT(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
    }
}
