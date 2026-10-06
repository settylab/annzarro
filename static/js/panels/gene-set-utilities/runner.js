/**
 * Running the Gene Set Analysis panel's sections: one run per section at a
 * time, each on its own, against services that may be slow, down or
 * rate-limiting.
 *
 *   - Cancellation: a section's new run aborts its previous one; hiding it,
 *     a dataset switch and closing the panel abort. Every reply is checked
 *     against the run's token before it is applied, so even an adapter that
 *     ignored its signal cannot paint an old answer.
 *   - Retries: a timeout, no connection, a 5xx or a 429 is tried once more
 *     (2 attempts), after 1.5 s (+ up to 30 % jitter) or what Retry-After
 *     asks for; never a 4xx or a reply that is not a result.
 *   - Pacing: per host, at most `maxConcurrent` requests at once and at
 *     least `minIntervalMs` between starts (STRING asks for one second).
 *     The queues are shared by every panel on the page.
 *   - Cache: ok results by input key, 24 entries, 10 minutes, in memory
 *     only. Showing a section again, or flipping the species back, reuses it.
 *
 * Everything with a clock or the network is injected (fetch, timers, now,
 * random), so Node tests drive it with fake timers (gene-set-runner.test.mjs).
 */
import { ServiceError, abortedError, fetchWithPolicy, hostOf, isRetryable, requestInit, withQuery } from './fetch-policy.js';
import { idleRun, startRun, resolveRun, rejectRun, cancelRun } from './state.js';

export const DEFAULT_TIMEOUT_MS = 20000;
export const MIN_TIMEOUT_MS = 5000;
export const MAX_TIMEOUT_MS = 60000;
export const RETRY_BASE_MS = 1500;
export const CACHE_ENTRIES = 24;
export const CACHE_TTL_MS = 10 * 60 * 1000;

/** Hosts asked to be paced harder than the default (2 at once, no gap). */
export const HOST_POLICY = {
    // NCBI: 3 requests per second without a key, enforced with 429s
    'api.ncbi.nlm.nih.gov': { maxConcurrent: 1, minIntervalMs: 350 }
};

/**
 * Per-host queue: at most `maxConcurrent` at once, `minIntervalMs` between
 * starts. A waiter whose signal aborts leaves the queue.
 */
export class HostQueue {
    constructor({ maxConcurrent = 2, minIntervalMs = 0 } = {}, { setTimeout: setT, clearTimeout: clearT, now }) {
        this.maxConcurrent = Math.max(1, maxConcurrent);
        this.minIntervalMs = Math.max(0, minIntervalMs);
        this.active = 0;
        this.lastStart = -Infinity;
        this.waiting = [];
        this._timer = null;
        this._setT = setT;
        this._clearT = clearT;
        this._now = now;
    }

    acquire(signal) {
        if (signal && signal.aborted) return Promise.reject(abortedError());
        return new Promise((resolve, reject) => {
            const waiter = { resolve, reject, signal, onAbort: null };
            if (signal) {
                waiter.onAbort = () => {
                    const i = this.waiting.indexOf(waiter);
                    if (i >= 0) this.waiting.splice(i, 1);
                    reject(abortedError());
                    this._pump();
                };
                signal.addEventListener('abort', waiter.onAbort, { once: true });
            }
            this.waiting.push(waiter);
            this._pump();
        });
    }

    release() {
        this.active = Math.max(0, this.active - 1);
        this._pump();
    }

    _pump() {
        if (this._timer !== null) {
            this._clearT(this._timer);
            this._timer = null;
        }
        while (this.waiting.length && this.active < this.maxConcurrent) {
            const wait = this.lastStart + this.minIntervalMs - this._now();
            if (wait > 0) {
                this._timer = this._setT(() => { this._timer = null; this._pump(); }, wait);
                return;
            }
            const waiter = this.waiting.shift();
            if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
            this.active++;
            this.lastStart = this._now();
            waiter.resolve();
        }
    }
}

/** The page's host queues, shared by every panel's runner. */
const _sharedQueues = new Map();

/** A wait that ends early, with an aborted error, when `signal` aborts. */
function sleep(ms, signal, setT, clearT) {
    return new Promise((resolve, reject) => {
        if (signal && signal.aborted) { reject(abortedError()); return; }
        const onAbort = () => { clearT(timer); reject(abortedError()); };
        const timer = setT(() => {
            if (signal) signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
}

/** `promise`, or an aborted error as soon as `signal` aborts (the promise goes on). */
function untilAborted(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(abortedError());
    let onAbort;
    const stop = new Promise((_, reject) => {
        onAbort = () => reject(abortedError());
        signal.addEventListener('abort', onAbort, { once: true });
    });
    return Promise.race([promise, stop]).finally(() => signal.removeEventListener('abort', onAbort));
}

/** Any error from an adapter, as a ServiceError (an aborted signal wins). */
export function asServiceError(error, signal) {
    if (signal && signal.aborted) return abortedError();
    if (error instanceof ServiceError) return error;
    if (error && error.name === 'AbortError') return abortedError();
    return new ServiceError({ kind: 'adapter', message: (error && error.message) || String(error) });
}

/**
 * A panel's runner.
 * @param {Object} deps
 * @param {Function} deps.fetchImpl
 * @param {Function} deps.setTimeout
 * @param {Function} deps.clearTimeout
 * @param {() => number} deps.now
 * @param {() => number} [deps.random]
 * @param {number} [deps.timeoutMs]
 * @param {(id: string, run: Object) => void} [deps.onChange] - after every state change
 * @param {Map} [deps.queues] - host queues (default: the page's)
 */
export function createRunner({ fetchImpl, setTimeout: setT, clearTimeout: clearT, now, random = Math.random,
    timeoutMs = DEFAULT_TIMEOUT_MS, onChange = () => {}, queues = _sharedQueues }) {
    const runs = new Map();
    const controllers = new Map();
    const cache = new Map();          // key -> {result, at}
    const memo = new Map();           // sub-results (an id mapping) -> {value, at}
    const inflight = new Map();       // sub-results being computed -> {promise, ctrl, waiters}
    const timers = { setTimeout: setT, clearTimeout: clearT, now };
    let disposed = false;

    const get = (id) => runs.get(id) || idleRun();
    const set = (id, run) => {
        runs.set(id, run);
        try { onChange(id, run); } catch (error) { console.error('gene-set runner onChange:', error); }
    };

    function cacheGet(key) {
        const hit = cache.get(key);
        if (!hit) return undefined;
        if (now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return undefined; }
        cache.delete(key);
        cache.set(key, hit);          // most recently used last
        return hit.result;
    }

    function cachePut(key, result) {
        cache.delete(key);
        cache.set(key, { result, at: now() });
        while (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    }

    function queueFor(host, adapter) {
        if (!queues.has(host)) {
            const provider = adapter.provider || {};
            // the provider's pacing also covers its versioned hosts
            // (version-12-5.string-db.org under string-db.org)
            const own = provider.host && (host === provider.host || host.endsWith(`.${provider.host}`))
                ? { maxConcurrent: provider.maxConcurrent, minIntervalMs: provider.minIntervalMs } : {};
            const policy = { maxConcurrent: 2, minIntervalMs: 0, ...HOST_POLICY[host],
                ...Object.fromEntries(Object.entries(own).filter(([, v]) => v !== undefined)) };
            queues.set(host, new HostQueue(policy, timers));
        }
        return queues.get(host);
    }

    function attemptTimeout(adapter) {
        const t = Number(adapter.timeoutMs) || timeoutMs;
        return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, t));
    }

    /** The adapter's only way to the network: paced, timed out, retried. */
    function makeIO(id, adapter, signal) {
        async function request(url, opts = {}, as = 'json') {
            const full = withQuery(url, opts.query);
            const host = hostOf(full);
            const queue = queueFor(host, adapter);
            const init = requestInit(opts);
            for (let attempt = 1; ; attempt++) {
                await queue.acquire(signal);
                let error;
                try {
                    return await fetchWithPolicy(full, init, { signal, timeoutMs: opts.timeoutMs || attemptTimeout(adapter),
                        as, fetchImpl, setTimeout: setT, clearTimeout: clearT, now });
                } catch (e) {
                    error = e;
                } finally {
                    queue.release();
                }
                error.attempts = attempt;
                if (error.kind === 'aborted' || !isRetryable(error) || attempt >= 2) throw error;
                const wait = error.retryAt !== undefined
                    ? Math.max(0, error.retryAt - now())
                    : RETRY_BASE_MS * 2 ** (attempt - 1) * (1 + 0.3 * random());
                const run = get(id);
                if (run.status === 'loading') set(id, { ...run, retryAt: now() + wait, retryReason: error.toJSON() });
                await sleep(wait, signal, setT, clearT);
                const after = get(id);
                if (after.status === 'loading' && after.retryAt) set(id, { ...after, retryAt: null });
            }
        }
        return Object.freeze({
            signal,
            fetchJson: (url, opts) => request(url, opts, 'json'),
            fetchText: (url, opts) => request(url, opts, 'text'),
            fetchBlob: (url, opts) => request(url, opts, 'blob'),
            /**
             * A sub-result shared by this panel's sections (STRING's id
             * mapping of the same genes): computed once, also while in
             * flight. `fn(io)` runs on its own signal, aborted only when
             * every section waiting for it is.
             */
            async memo(key, fn) {
                const hit = memo.get(key);
                if (hit && now() - hit.at <= CACHE_TTL_MS) return hit.value;
                let entry = inflight.get(key);
                if (!entry) {
                    const ctrl = new AbortController();
                    entry = { ctrl, waiters: 0, promise: null };
                    entry.promise = Promise.resolve().then(() => fn(makeIO(id, adapter, ctrl.signal))).then(value => {
                        memo.set(key, { value, at: now() });
                        if (memo.size > 64) memo.delete(memo.keys().next().value);
                        return value;
                    }).finally(() => { if (inflight.get(key) === entry) inflight.delete(key); });
                    inflight.set(key, entry);
                }
                entry.waiters++;
                try {
                    return await untilAborted(entry.promise, signal);
                } finally {
                    entry.waiters--;
                    if (entry.waiters === 0 && inflight.get(key) === entry) {
                        inflight.delete(key);
                        entry.ctrl.abort();
                    }
                }
            }
        });
    }

    /** Whether `key` has a cached result (no request, so no consent needed). */
    function has(key) {
        return cacheGet(key) !== undefined;
    }

    /**
     * Run section `id` for `key`. Resolves (never rejects) with the section's
     * state once this run settles, or once it is superseded or cancelled.
     * `fresh` asks the service again instead of reusing a cached result.
     */
    async function start(id, adapter, input, key, { fresh = false } = {}) {
        if (disposed) return get(id);
        abort(id);
        const cached = fresh ? undefined : cacheGet(key);
        let run = startRun(get(id), key, now());
        const token = run.token;
        // the input stays with its result: a stale result is drawn as what it was for
        if (cached !== undefined) {
            set(id, { ...resolveRun(run, token, cached, now(), { cached: true }), resultInput: input });
            return get(id);
        }
        const ctrl = new AbortController();
        controllers.set(id, ctrl);
        set(id, run);
        try {
            const result = await adapter.fetch(input, makeIO(id, adapter, ctrl.signal));
            if (ctrl.signal.aborted) throw abortedError();
            run = get(id);
            if (run.token === token) {
                cachePut(key, result);
                set(id, { ...resolveRun(run, token, result, now()), resultInput: input });
            }
        } catch (error) {
            const err = asServiceError(error, ctrl.signal);
            run = get(id);
            // an abort was already applied by abort(); a late reply is dropped
            if (run.token === token && err.kind !== 'aborted') set(id, rejectRun(run, token, err.toJSON(), now()));
        } finally {
            if (controllers.get(id) === ctrl) controllers.delete(id);
        }
        return get(id);
    }

    /** Cancel section `id`'s run, if any: it shows what it showed before. */
    function abort(id) {
        const ctrl = controllers.get(id);
        if (ctrl) {
            controllers.delete(id);
            ctrl.abort();
        }
        const run = get(id);
        if (run.status === 'loading') set(id, cancelRun(run));
    }

    function abortAll() {
        for (const id of [...controllers.keys()]) abort(id);
        for (const [id, run] of runs) if (run.status === 'loading') set(id, cancelRun(run));
    }

    return {
        start,
        has,
        abort,
        abortAll,
        get,
        /** Replace a section's state (stale marks); never while it loads. */
        update(id, fn) {
            const run = get(id);
            const next = fn(run);
            if (next !== run) set(id, next);
        },
        ids: () => [...runs.keys()],
        inFlight: () => controllers.size,
        /** A new dataset: nothing from the old one is kept. */
        reset() {
            abortAll();
            runs.clear();
            cache.clear();
            memo.clear();
            for (const e of inflight.values()) e.ctrl.abort();
            inflight.clear();
        },
        dispose() {
            disposed = true;
            abortAll();
            runs.clear();
            cache.clear();
            memo.clear();
            for (const e of inflight.values()) e.ctrl.abort();
            inflight.clear();
        }
    };
}
