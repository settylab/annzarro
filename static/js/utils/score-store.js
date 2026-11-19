/**
 * The score store: where computed gene-signature scores live in the browser,
 * and the one place that asks the server for them. No DOM and no page state,
 * so Node tests cover all of it; the server is reached through an injected
 * `api` (utils/gene-score-client.js is the real one).
 *
 * What it keeps
 * - SCORES, as Float32Arrays, keyed by `scoreKey`: the recipe's hash plus the
 *   dataset and the cells shown. A typed array's bytes are held outside the
 *   JS heap. The cache has a byte budget and drops the least recently used
 *   first; unlike the page's CacheManager it never stores an entry larger
 *   than the whole budget. Everything in it can be computed again.
 * - JOBS, one per key that something depends on. However many plots or
 *   tables need the same score there is one request. A job is aborted when
 *   its last dependant leaves.
 *
 * What it never does: write a computed value to a link, a panel set or a
 * history entry. Those carry the recipe (utils/gene-signature.js) only; a key
 * that is already cached makes no request, which is why a history step with an
 * unchanged key costs nothing.
 *
 * A job's life
 *   idle -> estimating -> queued -> computing -> ready
 *                     \-> awaiting (the estimate asks for one click: `confirm()`)
 *   and, off the main road: refused, failed, noscore, cancelled.
 * The tiers are read from the estimate reply (`auto_max_s`, `max_s`), never
 * written here. At most `maxActive` jobs compute at once, those with a
 * dependant on screen first; a job none of whose dependants is visible waits.
 */

/** Bytes of scores kept in the browser (design 6.2). */
export const DEFAULT_BUDGET = 1024 ** 3;

/** Scores computed at once from one page (design 8.8; the server runs one per worker). */
export const DEFAULT_MAX_ACTIVE = 2;

/** States a job rests in until something changes. */
export const SETTLED = Object.freeze(['ready', 'awaiting', 'refused', 'failed', 'noscore', 'cancelled']);

/** States in which a request is out or about to be. */
export const WORKING = Object.freeze(['estimating', 'queued', 'computing']);

/**
 * The cache key of a score. Title and gene order are not in the hash, so
 * renaming a signature never recomputes.
 * @param {{hash: string, dataset: string, subset?: (string|null)}} parts
 * @returns {string}
 */
export function scoreKey({ hash, dataset, subset = null }) {
    return `${hash}\u0001${dataset || ''}\u0001${subset || ''}`;
}

/** The key of an estimate: the cost does not depend on the cells shown. */
export function estimateKey({ hash, dataset }) {
    return `${hash}\u0001${dataset || ''}`;
}

/**
 * A byte-bounded least-recently-used cache of Float32Arrays.
 */
export class ScoreCache {
    /**
     * @param {number} [budget] - bytes
     */
    constructor(budget = DEFAULT_BUDGET) {
        this.budget = budget;
        this._map = new Map();
        this._bytes = 0;
        this.evictions = 0;
    }

    get bytes() { return this._bytes; }
    get size() { return this._map.size; }
    keys() { return [...this._map.keys()]; }

    has(key) { return this._map.has(key); }

    /** The entry, now the most recently used; undefined when absent. */
    get(key) {
        const entry = this._map.get(key);
        if (entry === undefined) return undefined;
        this._map.delete(key);
        this._map.set(key, entry);
        return entry;
    }

    /** The entry without touching its place in the order. */
    peek(key) { return this._map.get(key); }

    /**
     * Keep a score. An entry larger than the whole budget is not stored (the
     * caller still holds it for the draw that asked), and the least recently
     * used entries go until the new one fits.
     * @param {string} key
     * @param {{values: Float32Array}} entry
     * @returns {boolean} whether it was stored
     */
    put(key, entry) {
        const bytes = entry.values.byteLength;
        this.delete(key);
        if (bytes > this.budget) return false;
        while (this._bytes + bytes > this.budget && this._map.size) {
            const oldest = this._map.keys().next().value;
            this.delete(oldest);
            this.evictions++;
        }
        this._map.set(key, entry);
        this._bytes += bytes;
        return true;
    }

    delete(key) {
        const entry = this._map.get(key);
        if (entry === undefined) return false;
        this._map.delete(key);
        this._bytes -= entry.values.byteLength;
        return true;
    }

    clear() {
        this._map.clear();
        this._bytes = 0;
    }
}

/** A DOMException-alike that works in Node and in the browser. */
function abortError() {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    return error;
}

function isAbort(error) {
    return !!error && error.name === 'AbortError';
}

/**
 * @typedef {Object} ScoreApi
 * @property {(req: {recipe: Object, dataset: string}) => Promise<{estimate: Object}>} estimate
 * @property {(req: {recipe: Object, dataset: string, subset: (string|null), confirm: boolean,
 *   signal: AbortSignal, onProgress: (done: number, total: number) => void}) =>
 *   Promise<{header: Object, values: (Float32Array|null)}>} compute
 *   Throws errors with `status`, `reason`, `message` and, for 409/413, `estimate`.
 */

/**
 * @param {{api: ScoreApi, budget?: number, maxActive?: number}} options
 */
export function createScoreStore({ api, budget = DEFAULT_BUDGET, maxActive = DEFAULT_MAX_ACTIVE }) {
    const cache = new ScoreCache(budget);
    /** @type {Map<string, Object>} */
    const jobs = new Map();
    /** @type {Map<string, {value: (Object|null), promise: (Promise<Object>|null)}>} */
    const estimates = new Map();
    const listeners = new Set();
    const counts = { estimate: 0, compute: 0, aborted: 0 };
    let seq = 0;
    let active = 0;
    let pumping = false;

    function emit(job) {
        for (const fn of [...listeners]) {
            try { fn(job.key, snapshotOf(job)); } catch (error) { console.error('Score listener:', error); }
        }
    }

    function setState(job, state, fields = {}) {
        job.state = state;
        Object.assign(job, fields);
        emit(job);
    }

    function visibleOwners(job) {
        let n = 0;
        for (const owner of job.owners) if (!owner.visible || owner.visible()) n++;
        return n;
    }

    function snapshotOf(job) {
        const entry = job.state === 'ready' ? cache.peek(job.key) : undefined;
        return {
            key: job.key, state: job.state, progress: job.progress, estimate: job.estimate,
            message: job.message, reason: job.reason, owners: job.owners.size,
            header: entry ? entry.header : job.header || null, values: entry ? entry.values : null,
            confirmed: job.confirmed
        };
    }

    /**
     * Ask for the cost of a recipe once. The estimate reads the matrix's index
     * only, so it is cheap; it is kept for the session.
     * @param {Object} recipe - the server's recipe
     * @param {string} dataset
     * @param {string} hash - the recipe's hash
     * @returns {Promise<Object>} the estimate reply
     */
    function estimateFor(recipe, dataset, hash) {
        const key = estimateKey({ hash, dataset });
        let slot = estimates.get(key);
        if (!slot) {
            slot = { value: null, promise: null };
            estimates.set(key, slot);
        }
        if (slot.value) return Promise.resolve(slot.value);
        if (!slot.promise) {
            counts.estimate++;
            slot.promise = Promise.resolve(api.estimate({ recipe, dataset })).then((reply) => {
                slot.value = reply;
                slot.promise = null;
                return reply;
            }, (error) => {
                slot.promise = null;
                estimates.delete(key);
                throw error;
            });
        }
        return slot.promise;
    }

    async function estimateJob(job) {
        setState(job, 'estimating', { message: null });
        let reply;
        try {
            reply = await estimateFor(job.recipe, job.dataset, job.hash);
        } catch (error) {
            if (job.state !== 'estimating') return;
            setState(job, 'failed', { message: errorText(error), reason: error.reason || 'estimate_failed' });
            return;
        }
        if (job.state !== 'estimating') return;       // cancelled or left meanwhile
        const estimate = reply.estimate;
        job.estimate = estimate;
        if (estimate.tier === 'confirm' && !job.confirmed) {
            setState(job, 'awaiting');
            return;
        }
        // 'refused' goes on to ask: the server answers 413 at once, in its own words
        setState(job, 'queued');
        pump();
    }

    function errorText(error) {
        return (error && error.message) || 'the server did not answer';
    }

    async function run(job) {
        active++;
        const controller = new AbortController();
        job.abort = controller;
        job.progress = { done: 0, total: 0 };
        setState(job, 'computing');
        counts.compute++;
        try {
            const out = await api.compute({
                recipe: job.recipe, dataset: job.dataset, subset: job.subset, confirm: job.confirmed,
                signal: controller.signal,
                onProgress: (done, total) => {
                    if (job.abort !== controller) return;
                    job.progress = { done, total };
                    emit(job);
                }
            });
            if (job.abort !== controller) return;      // aborted while the reply arrived
            if (!out.values) {
                setState(job, 'noscore', { header: out.header, message: out.header.message || 'No score could be made.',
                    reason: out.header.reason || 'no_score' });
            } else {
                cache.put(job.key, { values: out.values, header: out.header });
                setState(job, 'ready', { header: out.header });
            }
        } catch (error) {
            if (job.abort !== controller) return;
            if (isAbort(error)) {
                if (job.state === 'computing') setState(job, 'cancelled');
            } else if (error && error.status === 409) {
                job.estimate = error.estimate || job.estimate;
                job.confirmed = false;
                setState(job, 'awaiting');
            } else if (error && error.status === 413 && error.reason === 'score_too_expensive') {
                job.estimate = error.estimate || job.estimate;
                setState(job, 'refused', { message: error.message, reason: error.reason });
            } else {
                setState(job, 'failed', { message: errorText(error), reason: (error && error.reason) || 'failed' });
            }
        } finally {
            if (job.abort === controller) job.abort = null;
            active--;
            pump();
        }
    }

    /** Start what can start: estimates for jobs with a dependant on screen, then computations, within the limit. */
    function pump() {
        if (pumping) return;
        pumping = true;
        try {
            const idle = [...jobs.values()].filter(j => j.state === 'idle' && visibleOwners(j) > 0)
                .sort((a, b) => a.seq - b.seq);
            for (const job of idle) estimateJob(job);
            const queued = [...jobs.values()].filter(j => j.state === 'queued')
                .sort((a, b) => (visibleOwners(b) > 0) - (visibleOwners(a) > 0) || a.seq - b.seq);
            for (const job of queued) {
                if (active >= maxActive) break;
                if (visibleOwners(job) === 0) continue;
                run(job);
            }
        } finally {
            pumping = false;
        }
    }

    function stop(job) {
        if (job.abort) {
            const controller = job.abort;
            job.abort = null;
            counts.aborted++;
            controller.abort(abortError());
        }
    }

    return {
        cache,

        /** Everything a state change tells: `fn(key, snapshot)`. Returns the way to stop listening. */
        on(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },

        /**
         * A dependant needs this score. Starts the work when it is not cached
         * and the dependant is on screen.
         * @param {string} key
         * @param {{recipe: Object, dataset: string, subset: (string|null), hash: string}} spec
         * @param {{visible?: () => boolean}} owner - an object, compared by identity
         */
        attach(key, spec, owner) {
            let job = jobs.get(key);
            if (!job) {
                job = { key, seq: ++seq, state: 'idle', owners: new Set(), progress: null, estimate: null,
                    message: null, reason: null, header: null, abort: null, confirmed: false, ...spec };
                jobs.set(key, job);
                if (cache.has(key)) job.state = 'ready';
            }
            job.owners.add(owner);
            pump();
            return snapshotOf(job);
        },

        /** A dependant no longer needs this score; the last one leaving stops the work. */
        detach(key, owner) {
            const job = jobs.get(key);
            if (!job) return;
            job.owners.delete(owner);
            if (job.owners.size) return;
            const working = WORKING.includes(job.state);
            stop(job);
            jobs.delete(key);
            if (working) job.state = 'idle';
            pump();
        },

        /** Where a score stands. A cached value that was evicted while wanted is asked for again. */
        snapshot(key) {
            const job = jobs.get(key);
            if (!job) return { key, state: cache.has(key) ? 'ready' : 'idle', values: (cache.get(key) || {}).values || null,
                header: (cache.peek(key) || {}).header || null, owners: 0 };
            if (job.state === 'ready') {
                if (cache.get(key) === undefined) {
                    job.state = 'idle';
                    pump();
                }
            }
            return snapshotOf(job);
        },

        /** The user accepted the estimate: compute. Also retries a failure. */
        confirm(key) {
            const job = jobs.get(key);
            if (!job || ['ready', 'computing', 'queued', 'estimating'].includes(job.state)) return false;
            job.confirmed = true;
            job.message = null;
            job.reason = null;
            if (job.estimate && job.state !== 'failed') {
                setState(job, 'queued');
                pump();
            } else {
                setState(job, 'idle');
                pump();
            }
            return true;
        },

        /** Compute again after a failure. */
        retry(key) {
            const job = jobs.get(key);
            if (!job || !['failed', 'cancelled', 'noscore'].includes(job.state)) return false;
            job.message = null;
            job.reason = null;
            estimates.delete(estimateKey({ hash: job.hash, dataset: job.dataset }));
            setState(job, 'idle');
            pump();
            return true;
        },

        /** Stop the work for everyone who waits on it. */
        cancel(key) {
            const job = jobs.get(key);
            if (!job || !WORKING.includes(job.state)) return false;
            stop(job);
            setState(job, 'cancelled', { progress: null });
            pump();
            return true;
        },

        /** The page's visible dependants changed: something may start. */
        poke: pump,

        estimateFor,

        /** Stop every request (a new link opens, the dataset closes). A dependant still waiting sees it cancelled. */
        abortAll() {
            for (const job of jobs.values()) {
                if (WORKING.includes(job.state)) {
                    stop(job);
                    setState(job, 'cancelled', { progress: null });
                }
            }
        },

        /** Forget cached scores (a refresh that re-reads the disk). */
        clear() {
            cache.clear();
            estimates.clear();
        },

        stats() {
            return { ...counts, active, jobs: jobs.size, cached: cache.size, bytes: cache.bytes, evictions: cache.evictions };
        },

        /** For tests: the key of every job. */
        jobKeys() { return [...jobs.keys()]; }
    };
}
