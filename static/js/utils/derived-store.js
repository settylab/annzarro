/**
 * The derived-value store: where values the server computes from a recipe
 * (gene-signature scores, cell groupings) live in the browser, and the one
 * place that asks for them. No DOM and no page state, so Node tests cover all
 * of it; the server is reached through an injected `api`.
 *
 * It does not know what a value is. A value is whatever `api.compute` returns
 * as `values`: one typed array, or an object or array holding several typed
 * arrays of mixed kinds. `bytesOf` counts them for the budget.
 *
 * What it keeps
 * - VALUES, keyed by a string the caller builds (the recipe's hash plus the
 *   dataset and the cells shown). A typed array's bytes are held outside the
 *   JS heap. The cache has a byte budget and drops the least recently used
 *   first; it never stores an entry larger than the whole budget. Everything
 *   in it can be computed again.
 * - JOBS, one per key that something depends on. However many plots or
 *   tables need the same value there is one request. A job is aborted when
 *   its last dependant leaves.
 *
 * What it never does: write a computed value to a link, a panel set or a
 * history entry. Those carry the recipe only; a key that is already cached
 * makes no request, which is why a history step with an unchanged key costs
 * nothing.
 *
 * A job's life
 *   idle -> estimating -> queued -> computing -> ready
 *                     \-> awaiting (the estimate asks for one click: `accept()`)
 *   and, off the main road: refused, failed, noscore, cancelled.
 *   (`noscore` is the state of a reply with nothing in it; the name is kept
 *   from the score store, which the page's code already reads.)
 * `queued` is a job waiting for one of the page's slots (the browser's
 * limiter); the server's queue is `progress.queue`, its place in the lane.
 * The tiers are read from the estimate reply (`auto_max_s`, `max_s`), never
 * written here. The page computes at most `maxActive` values at once across
 * every store: stores of different kinds share one limiter (`createLimiter`).
 * Within a store, jobs with a dependant on screen go first; a job none of
 * whose dependants is visible waits.
 */

/** Bytes of values kept in the browser (design 6.2). */
export const DEFAULT_BUDGET = 1024 ** 3;

/** Values computed at once from one page (design 8.8; the server runs one per worker). */
export const DEFAULT_MAX_ACTIVE = 2;

/** States a job rests in until something changes. */
export const SETTLED = Object.freeze(['ready', 'awaiting', 'refused', 'failed', 'noscore', 'cancelled']);

/** States in which a request is out or about to be. */
export const WORKING = Object.freeze(['estimating', 'queued', 'computing']);

/** The key of an estimate: the cost does not depend on the cells shown (nor on the dataset's subset). */
export function estimateKey({ hash, dataset }) {
    return `${hash}\u0001${dataset || ''}`;
}

/**
 * The bytes a value holds: a typed array's own, or the sum over the typed
 * arrays inside an object or an array (to a depth of 3). Anything else weighs
 * nothing (level names and headers are small and live on the JS heap).
 * @param {*} values
 * @param {number} [depth]
 * @returns {number}
 */
export function bytesOf(values, depth = 3) {
    if (!values || typeof values !== 'object') return 0;
    if (ArrayBuffer.isView(values)) return values.byteLength;
    if (depth <= 0) return 0;
    let bytes = 0;
    for (const part of Array.isArray(values) ? values : Object.values(values)) bytes += bytesOf(part, depth - 1);
    return bytes;
}

/**
 * A byte-bounded least-recently-used cache of `{values, header}` entries.
 */
export class ByteCache {
    /**
     * @param {number} [budget] - bytes
     * @param {(values: *) => number} [measure] - bytes of one entry's `values`
     */
    constructor(budget = DEFAULT_BUDGET, measure = bytesOf) {
        this.budget = budget;
        this._measure = measure;
        this._map = new Map();
        this._sizes = new Map();
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
     * Keep a value. An entry larger than the whole budget is not stored (the
     * caller still holds it for the draw that asked), and the least recently
     * used entries go until the new one fits.
     * @param {string} key
     * @param {{values: *}} entry
     * @returns {boolean} whether it was stored
     */
    put(key, entry) {
        const bytes = this._measure(entry.values);
        this.delete(key);
        if (bytes > this.budget) return false;
        while (this._bytes + bytes > this.budget && this._map.size) {
            const oldest = this._map.keys().next().value;
            this.delete(oldest);
            this.evictions++;
        }
        this._map.set(key, entry);
        this._sizes.set(key, bytes);
        this._bytes += bytes;
        return true;
    }

    delete(key) {
        if (!this._map.has(key)) return false;
        this._map.delete(key);
        this._bytes -= this._sizes.get(key);
        this._sizes.delete(key);
        return true;
    }

    clear() {
        this._map.clear();
        this._sizes.clear();
        this._bytes = 0;
    }
}

/**
 * How many computations the page runs at once, shared by every store that is
 * given it. A store takes a slot before it starts a job and gives it back when
 * the job ends however it ends; a release tells the waiting stores in turn, the
 * one after the last told first, so no store keeps the slots.
 * @param {number} [max]
 */
export function createLimiter(max = DEFAULT_MAX_ACTIVE) {
    const waiters = [];
    let active = 0;
    let next = 0;
    return {
        get max() { return max; },
        get active() { return active; },
        /** @returns {boolean} whether a slot was free (and is now taken) */
        tryTake() {
            if (active >= max) return false;
            active++;
            return true;
        },
        release() {
            active--;
            const list = [...waiters];
            for (let i = 0; i < list.length && active < max; i++) {
                const fn = list[(next + i) % list.length];
                try { fn(); } catch (error) { console.error('Limiter listener:', error); }
            }
            next = list.length ? (next + 1) % list.length : 0;
        },
        /** Be told when a slot is released. Returns the way to stop. */
        onFree(fn) {
            waiters.push(fn);
            return () => { const i = waiters.indexOf(fn); if (i >= 0) waiters.splice(i, 1); };
        }
    };
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

/** What a progress frame says besides its count (SHR-47, SHR-48), kept as the frame carries it. */
const PROGRESS_FIELDS = Object.freeze(['stage', 'entries_done', 'entries_total', 'running_s', 'queue', 'items']);

/** A job's progress: done and in all, and whichever of the frame's other fields it carries. */
function progressOf(done, total, frame) {
    const out = { done, total };
    if (frame) for (const f of PROGRESS_FIELDS) if (frame[f] !== undefined) out[f] = frame[f];
    return out;
}

/**
 * @typedef {Object} DerivedApi
 * @property {(req: {recipe: Object, dataset: string}) => Promise<{estimate: Object}>} estimate
 * @property {(req: {recipe: Object, dataset: string, subset: (string|null), confirm: boolean,
 *   hash: string, signal: AbortSignal, onProgress: (done: number, total: number, frame?: Object) => void}) =>
 *   Promise<{header: Object, values: *}>} compute
 *   Throws errors with `status`, `reason`, `message` and, for 409/413, `estimate`.
 */

/**
 * @param {Object} options
 * @param {DerivedApi} options.api
 * @param {number} [options.budget] - bytes of cached values
 * @param {number} [options.maxActive] - used only to make a limiter when none is given
 * @param {ReturnType<typeof createLimiter>} [options.limiter] - shared with the page's other stores
 * @param {(values: *) => number} [options.bytesOf] - bytes of one value
 * @param {(out: {header: Object, values: *}) => boolean} [options.isEmpty] - a reply with nothing in it
 * @param {string} [options.emptyMessage]
 * @param {string} [options.refusalReason] - the 413 reason that means "too expensive, and the server says why"
 * @param {(out: {header: Object, values: *}) => ({reason: string, message: ?string}|null)} [options.refusedOf] - a reply
 *   the server refused for its size: the state `refused`, never a reply with nothing in it
 * @param {ByteCache} [options.cache] - where values are kept, keyed by job key: anything with ByteCache's interface
 *   (a store whose values are put together from parts gives a view over them)
 * @param {(job: Object) => ({recipe: Object, hash: string}|null)} [options.ask] - what a job asks the server now
 *   (estimate and compute); null when nothing is missing. By default its own recipe and hash
 * @param {(job: Object, out: {header: Object, values: *}, asked: Object) => void} [options.keep] - where a reply
 *   goes; by default into the cache under the job's key
 */
export function createDerivedStore({
    api, budget = DEFAULT_BUDGET, maxActive = DEFAULT_MAX_ACTIVE, limiter = null,
    bytesOf: measure = (values) => bytesOf(values), isEmpty = (out) => !out.values, emptyMessage = 'Nothing could be made.',
    refusalReason = 'score_too_expensive', refusedOf = () => null, cache = new ByteCache(budget, measure),
    ask = (job) => ({ recipe: job.recipe, hash: job.hash }),
    keep = (job, out) => { cache.put(job.key, { values: out.values, header: out.header }); }
}) {
    const slots = limiter || createLimiter(maxActive);
    /** @type {Map<string, Object>} */
    const jobs = new Map();
    /** @type {Map<string, {value: (Object|null), promise: (Promise<Object>|null)}>} */
    const estimates = new Map();
    const listeners = new Set();
    const counts = { estimate: 0, compute: 0, aborted: 0 };
    let seq = 0;
    let pumping = false;

    function emit(job) {
        for (const fn of [...listeners]) {
            try { fn(job.key, snapshotOf(job)); } catch (error) { console.error('Store listener:', error); }
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
        const asked = ask(job);
        if (!asked) { setState(job, 'ready'); return; }
        setState(job, 'estimating', { message: null });
        let reply;
        try {
            reply = await estimateFor(asked.recipe, job.dataset, asked.hash);
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
        const controller = new AbortController();
        job.abort = controller;
        job.progress = { done: 0, total: 0 };
        setState(job, 'computing');
        counts.compute++;
        const asked = ask(job);
        try {
            const out = await api.compute({
                recipe: asked.recipe, hash: asked.hash, dataset: job.dataset, subset: job.subset, confirm: job.confirmed,
                signal: controller.signal,
                onProgress: (done, total, frame) => {
                    if (job.abort !== controller) return;
                    job.progress = progressOf(done, total, frame);
                    emit(job);
                }
            });
            if (job.abort !== controller) return;      // aborted while the reply arrived
            const refused = refusedOf(out);
            if (refused) {
                setState(job, 'refused', { header: out.header, message: refused.message, reason: refused.reason });
            } else if (isEmpty(out)) {
                setState(job, 'noscore', { header: out.header, message: (out.header && out.header.message) || emptyMessage,
                    reason: (out.header && out.header.reason) || 'no_score' });
            } else {
                keep(job, out, asked);
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
            } else if (error && error.status === 413 && error.reason === refusalReason) {
                job.estimate = error.estimate || job.estimate;
                setState(job, 'refused', { message: error.message, reason: error.reason });
            } else {
                setState(job, 'failed', { message: errorText(error), reason: (error && error.reason) || 'failed' });
            }
        } finally {
            if (job.abort === controller) job.abort = null;
            slots.release();
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
                if (visibleOwners(job) === 0) continue;
                // what it needs came meanwhile (another job's reply held the parts it missed)
                if (cache.has(job.key)) { setState(job, 'ready'); continue; }
                if (!slots.tryTake()) break;
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

    slots.onFree(pump);

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
        accept(key) {
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

        /**
         * Forget a score that turned out not to fit the cells shown (its length is not theirs) and
         * ask for it again. Nothing else changes: the job, its dependants and the key stay.
         */
        discard(key) {
            cache.delete(key);
            const job = jobs.get(key);
            if (!job) return false;
            if (job.state === 'ready' || SETTLED.includes(job.state)) {
                job.message = null;
                job.reason = null;
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
            return { ...counts, active: slots.active, jobs: jobs.size, cached: cache.size, bytes: cache.bytes, evictions: cache.evictions };
        },

        /** For tests: the key of every job. */
        jobKeys() { return [...jobs.keys()]; }
    };
}
