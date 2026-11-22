/**
 * The group store: where group results live in the browser (SHR-31, CMP-12, CAT-4, CXG-18), and the one place that
 * asks the server for them (utils/cell-groups-client.js is the real api).
 *
 * The jobs, estimates, tiers, states and the page's limit on computations at once are the derived store's
 * (utils/derived-store.js), underneath. What is particular to groups is what a result is made of:
 *
 * - The GROUP TABLE of a grouping for the cells shown (levels, groups, counts, histograms; a grid's counts and measure
 *   moments), and the MOMENTS OF EACH FEATURE per group, one entry per feature (grouping key, feature, layer,
 *   threshold). Both are kept in one cache of 256 MiB, least recently used first. Everything in it can be computed
 *   again.
 * - The CODES, one per cell shown (1 byte up to 255 groups, 2 above). They are never in that cache: they are held per
 *   grouping key while a consumer holding them is attached, on the memory guard's ledger (memory-guard.js
 *   `Ledger.hold`), PINNED while one of those consumers is on screen (`pin`), and released with the last one
 *   (`release`). Held by hidden consumers only, the guard may evict them; those consumers then ask again, which
 *   starts when one of them is shown.
 *
 * A result refused for its size (too many levels or groups) is the state `refused`, with the server's figures in
 * `header.refused`, as a refusal by cost (413) is; it is never confused with a reply that has no groups.
 *
 * A consumer asks for a NEED (`groupNeed`): a request, the grouping's key, whether it wants the codes, and its
 * features. Its store key names what it gets, so what it gets never changes: it is put together once, when every part
 * is held, and a read is then a lookup. A key whose parts are all held makes no request; otherwise ONE request asks
 * for exactly what is missing, so adding a gene to a Cell-Gene Plot asks for that gene alone. Two consumers whose
 * missing parts are the same share one request.
 *
 * It IS a derived store (utils/derived-store.js) whose cache is a view over those parts: a key is held when every
 * part of its need is, a job asks for the parts missing when it starts (`ask`), and a reply goes into the parts
 * (`keep`). A part that goes is asked for again the derived store's way: the key is no longer held, so its job is
 * idle and starts when a consumer of it is on screen.
 *
 * A consumer that still SHOWS a value of a key it has left (the previous groups, while an edit computes) keeps it with
 * `keep(key, keeper)`: its codes stay on the ledger, pinned while the keeper is on screen, and nothing is asked for
 * it. When the guard evicts codes, every consumer and keeper of them is told (`keeper.dropped()`), so nothing goes on
 * holding codes the ledger no longer counts (CAT-4).
 */
import { ByteCache, bytesOf, createDerivedStore } from './derived-store.js';

/** Bytes of group tables and moments kept in the browser (CMP-12): a grid with a measure at its limit is 84 MB. */
const GROUP_BUDGET = 256 * 1024 * 1024;

/** The 413 reason of a request that costs too much. */
const REFUSAL_REASON = 'groups_too_expensive';

/** What one group or one level of a group table weighs on the JS heap, for the budget. */
const ROW_BYTES = 48;

const NO_LEDGER = Object.freeze({ hold() {}, pin() {}, release() {} });

/**
 * The bytes of the codes of `cells` cells in `groups` groups (CAT-4): what the memory guard is asked before a plot
 * asks for them.
 * @param {number} cells
 * @param {number} groups
 */
// export-unused-ok: G8a's provider cost() asks the memory guard before a plot asks for codes
export function codeBytes(cells, groups) {
    return cells * (groups <= 255 ? 1 : 2);
}

/**
 * What a consumer of groups asks for.
 * @param {Object} options
 * @param {Object|(() => Object)} options.request - the request without features and cells shown (`serverRequest`, a
 *   grid request), or the way to make it: made once, when it is first sent or estimated (a table's cells are packed
 *   then, not on every comparison of an edit)
 * @param {string} options.key - the grouping's key (PER-3): equal keys give equal groups for the same cells
 * @param {number[]} [options.histograms] - the partitionings whose histograms the request asks for; read from the
 *   request when it is given made
 * @param {boolean} [options.codes] - the codes too
 * @param {Array<{key: string, wire: Object}>} [options.features] - each feature's key, and the feature as the request
 *   carries it, without its id
 * @returns {{request: Object, key: string, table: string, codes: boolean, features: Array<{key: string, wire: Object}>, hash: string}}
 */
export function groupNeed({ request, key, histograms, codes = false, features = [] }) {
    const made = typeof request === 'function' ? null : request;
    const shown = histograms || (made && made.want && made.want.histograms) || [];
    const table = `${key}\u0002${shown.join(',')}`;
    const need = { key, table, codes: !!codes, features: features.map(({ key: k, wire }) => ({ key: k, wire })),
        hash: `${table}\u0002${codes ? 1 : 0}\u0002${features.map((f) => f.key).join('\u0003')}` };
    let body = made;
    Object.defineProperty(need, 'request', { enumerable: true, get: () => body || (body = request()) });
    return need;
}

/** A partitioning or an axis of the reply as the browser reads it (utils/cell-grouping.js): level ids, their counts apart. */
function levelsRead(part) {
    const levels = Array.isArray(part.levels) ? part.levels : [];
    return { ...part, levels: levels.map((l) => (typeof l === 'string' ? l : l.id)),
        counts: levels.map((l) => (typeof l === 'string' ? null : l.n)) };
}

/** The result frame as the browser reads it: everything but the frame's own fields, with the levels read. */
function readReply(header) {
    const reply = { ...header };
    delete reply.type;
    delete reply.blocks;
    if (Array.isArray(reply.partitionings)) reply.partitionings = reply.partitionings.map(levelsRead);
    if (Array.isArray(reply.axes)) reply.axes = reply.axes.map(levelsRead);
    return reply;
}

function partBytes(values) {
    let bytes = bytesOf(values);
    const reply = values && values.reply;
    if (reply) {
        let rows = Array.isArray(reply.groups) ? reply.groups.length : 0;
        for (const part of [...(reply.partitionings || []), ...(reply.axes || [])]) rows += part.levels.length;
        bytes += ROW_BYTES * rows;
    }
    return bytes;
}

/**
 * @param {Object} options
 * @param {import('./derived-store.js').DerivedApi} options.api - utils/cell-groups-client.js createGroupsApi
 * @param {number} [options.budget] - bytes of group tables and moments
 * @param {ReturnType<import('./derived-store.js').createLimiter>} [options.limiter] - the page's (score-source.js pageLimiter)
 * @param {{hold: (key: string, bytes: number, opts: {pinned: boolean, evict: () => void}) => void,
 *   pin: (key: string, pinned: boolean) => void, release: (key: string) => void}} [options.codes] - the memory guard's
 *   ledger (memory-guard.js Ledger), where the codes held are counted
 */
// export-unused-ok: G8a makes the page's group store
export function createGroupStore({ api, budget = GROUP_BUDGET, limiter = null, codes: ledger = NO_LEDGER }) {
    const parts = new ByteCache(budget, partBytes);
    /** @type {Map<string, {codes: ArrayBufferView, holders: Set<Object>, pinned: boolean}>} codes key -> the codes */
    const held = new Map();
    /** @type {Map<string, Object>} store key -> its need, its parts' keys, who attached and who keeps it */
    const entries = new Map();
    /** @type {Map<string, Object>} what is asked, with the cells -> the request out, which equal asks join */
    const inflight = new Map();
    const listeners = new Set();
    /** Parts deleted here; with the cache's evictions it says whether an entry's values may have lost a part. */
    let drops = 0;
    const stamp = () => `${parts.evictions}\u0001${drops}`;

    const absorbed = new WeakSet();

    function tell(key, snap) {
        for (const fn of [...listeners]) {
            try { fn(key, snap); } catch (error) { console.error('Group store listener:', error); }
        }
    }

    const shown = (entry) => [...entry.owners, ...entry.keepers].some((o) => !o.visible || o.visible());

    /** Codes are pinned while a holder is on screen; held by hidden holders only, the guard may evict them. */
    function pinCodes(codesKey) {
        const h = held.get(codesKey);
        if (!h || !h.holders.size) return;
        const pinned = [...h.holders].some(shown);
        if (pinned === h.pinned) return;
        h.pinned = pinned;
        ledger.pin(codesKey, pinned);
    }

    function holdCodes(entry, h) {
        if (h.holders.has(entry)) return;
        h.holders.add(entry);
        if (h.holders.size === 1) {
            h.pinned = shown(entry);
            ledger.hold(entry.codesKey, h.codes.byteLength, { pinned: h.pinned, evict: () => dropCodes(entry.codesKey, h) });
        } else {
            pinCodes(entry.codesKey);
        }
    }

    /** Codes that go (evicted by the guard, or for other cells): their holders lose their values, and are told. */
    function dropCodes(codesKey, h) {
        if (held.get(codesKey) !== h) return;
        held.delete(codesKey);
        const told = [...h.holders];
        for (const entry of told) entry.made = null;
        for (const entry of told) for (const keeper of [...entry.keepers]) keeper.dropped();
        for (const entry of told) tell(entry.key, inner.snapshot(entry.key));
    }

    /** An entry's values from the parts held, or null when one is missing. Put together once while its parts stay. */
    function valuesOf(entry) {
        const codes = entry.need.codes ? held.get(entry.codesKey) : null;
        if (entry.made && entry.stamp === stamp() && entry.codes === codes) return entry.made;
        const table = parts.peek(entry.tableKey);
        if (!table || (entry.need.codes && !codes)) return (entry.made = null);
        const features = [];
        for (const key of entry.featureKeys) {
            const f = parts.peek(key);
            if (!f) return (entry.made = null);
            features.push(f.values);
        }
        const was = entry.made;
        const same = was && was.header === table.header && was.values.codes === (codes ? codes.codes : null)
            && features.every((f, i) => f === was.values.features[i]);
        if (!same) {
            parts.get(entry.tableKey);
            for (const key of entry.featureKeys) parts.get(key);
            entry.made = { header: table.header, values: { reply: table.values.reply, codes: codes ? codes.codes : null,
                features, counts: table.values.counts, measures: table.values.measures } };
        }
        entry.stamp = stamp();
        entry.codes = codes;
        if (codes) holdCodes(entry, codes);
        return entry.made;
    }

    /** The derived store's cache: a key is held when every part of its need is. */
    const view = {
        has: (key) => entries.has(key) && !!valuesOf(entries.get(key)),
        peek: (key) => (entries.has(key) ? valuesOf(entries.get(key)) || undefined : undefined),
        get: (key) => view.peek(key),
        put: () => false,
        /** A value for other cells: its parts go, and are asked for again. */
        delete(key) {
            const entry = entries.get(key);
            if (!entry) return false;
            entry.made = null;
            drops++;
            parts.delete(entry.tableKey);
            for (const k of entry.featureKeys) parts.delete(k);
            const h = entry.need.codes ? held.get(entry.codesKey) : null;
            if (h) { ledger.release(entry.codesKey); dropCodes(entry.codesKey, h); }
            return true;
        },
        clear() {},
        get size() { return parts.size; },
        get bytes() { return parts.bytes; },
        get evictions() { return parts.evictions; }
    };

    /** A request as sent: a grouping's says what it wants back (the codes); a grid has nothing to want and takes no `want`. */
    const withWant = (request, codes) => (request.shape === 'grid' ? { ...request } : { ...request, want: { ...request.want, codes } });

    /** What a job misses now, as one request; null when it misses nothing. */
    function ask(job) {
        const entry = entries.get(job.key);
        if (!entry || valuesOf(entry)) return null;
        const { need } = entry;
        const missing = [];
        need.features.forEach((f, i) => { if (!parts.has(entry.featureKeys[i])) missing.push(i); });
        const codes = need.codes && !held.has(entry.codesKey);
        const recipe = withWant(need.request, codes);
        if (missing.length) recipe.features = missing.map((i, n) => ({ id: `f${n}`, ...need.features[i].wire }));
        const hash = `${need.table}\u0002${codes ? 1 : 0}\u0002${missing.map((i) => need.features[i].key).join('\u0003')}`;
        return { recipe, hash, parts: { tableKey: entry.tableKey, codesKey: entry.codesKey, codes,
            features: missing.map((i) => entry.featureKeys[i]) } };
    }

    /** A reply's parts into the cache, and its codes to be held by the entries that read them. */
    function keep(job, out, asked) {
        if (absorbed.has(out)) return;            // a request two jobs joined is kept once
        absorbed.add(out);
        const info = asked.parts;
        const reply = readReply(out.header);
        parts.put(info.tableKey, { values: { reply, counts: out.values.counts || null, measures: out.values.measure_moments || null },
            header: out.header });
        const statuses = new Map((out.header.features || []).map((s) => [s.id, s]));
        const moments = out.values.feature_moments || null;
        const stride = (Array.isArray(reply.groups) ? reply.groups.length : 0) * 5;
        info.features.forEach((key, i) => {
            parts.put(key, { values: { status: statuses.get(`f${i}`) || null,
                moments: moments ? moments.slice(i * stride, (i + 1) * stride) : null } });
        });
        if (info.codes && out.values.codes && !held.has(info.codesKey)) {
            held.set(info.codesKey, { codes: out.values.codes, holders: new Set(), pinned: false });
        }
    }

    /** One request for what is asked, whichever jobs ask it: the last to leave stops it. */
    function compute(args) {
        const id = `${args.hash}\u0001${args.dataset || ''}\u0001${args.subset || ''}`;
        let out = inflight.get(id);
        if (!out) {
            const controller = new AbortController();
            out = { controller, joined: new Set() };
            out.promise = api.compute({ ...args, signal: controller.signal,
                onProgress: (...frame) => { for (const j of [...out.joined]) j(...frame); } });
            const mine = out;
            out.promise.then(() => {}, () => {}).then(() => { if (inflight.get(id) === mine) inflight.delete(id); });
            inflight.set(id, out);
        }
        const request = out;
        request.joined.add(args.onProgress);
        return new Promise((resolve, reject) => {
            const leave = () => {
                request.joined.delete(args.onProgress);
                if (!request.joined.size && inflight.get(id) === request) {
                    inflight.delete(id);
                    request.controller.abort(args.signal.reason);
                }
                reject(args.signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' }));
            };
            if (args.signal.aborted) { leave(); return; }
            args.signal.addEventListener('abort', leave, { once: true });
            request.promise.then((reply) => { args.signal.removeEventListener('abort', leave); request.joined.delete(args.onProgress); resolve(reply); },
                (error) => { args.signal.removeEventListener('abort', leave); request.joined.delete(args.onProgress); reject(error); });
        });
    }

    const inner = createDerivedStore({
        api: { estimate: (req) => api.estimate(req), compute }, cache: view, ask, keep, limiter,
        isEmpty: () => false, emptyMessage: 'No groups could be made.', refusalReason: REFUSAL_REASON,
        // too many levels or groups: a refusal of its own (SHR-35), never the state of a reply with nothing in it
        refusedOf: (out) => (out.header && out.header.refused
            ? { reason: out.header.refused.reason, message: out.header.message || null } : null)
    });

    inner.on((key, snap) => {
        tell(key, snap);
        // codes no entry came to read (its consumers left while they came) are not kept
        if (snap.state === 'ready') for (const [codesKey, h] of held) if (!h.holders.size) held.delete(codesKey);
    });

    function entryOf(key, spec) {
        let entry = entries.get(key);
        if (!entry) {
            const need = spec.recipe;
            const ctx = `${spec.dataset || ''}\u0001${spec.subset || ''}`;
            entry = { key, need, owners: new Set(), keepers: new Set(), made: null, stamp: null, codes: null,
                tableKey: `T\u0001${ctx}\u0001${need.table}`, codesKey: `C\u0001${ctx}\u0001${need.key}`,
                featureKeys: need.features.map((f) => `F\u0001${ctx}\u0001${need.key}\u0001${f.key}`) };
            entries.set(key, entry);
        }
        return entry;
    }

    /** An entry no one attaches or keeps goes, and its codes with it when it was their last holder. */
    function settle(entry) {
        if (entry.owners.size || entry.keepers.size) { pinCodes(entry.codesKey); return; }
        if (entries.get(entry.key) === entry) entries.delete(entry.key);
        const h = held.get(entry.codesKey);
        if (!h || !h.holders.delete(entry)) return;
        if (h.holders.size) { pinCodes(entry.codesKey); return; }
        held.delete(entry.codesKey);
        ledger.release(entry.codesKey);
    }

    return {
        /** The cache of group tables and moments (not the codes). */
        cache: parts,

        on(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },

        /**
         * A consumer needs a need's values.
         * @param {string} key - the store key (the need's hash, the dataset and the cells shown)
         * @param {{recipe: Object, dataset: string, subset: (string|null), hash: string}} spec - `recipe`: from groupNeed
         * @param {{visible?: () => boolean}} owner - compared by identity
         */
        attach(key, spec, owner) {
            const entry = entryOf(key, spec);
            entry.owners.add(owner);
            inner.attach(key, spec, owner);
            pinCodes(entry.codesKey);
            return inner.snapshot(key);
        },

        /** A consumer no longer needs it; the last one leaving stops the request and releases the codes. */
        detach(key, owner) {
            const entry = entries.get(key);
            if (!entry) return;
            entry.owners.delete(owner);
            inner.detach(key, owner);
            settle(entry);
        },

        /**
         * A consumer that left `key` still shows its values (the previous groups while an edit computes): they stay,
         * their codes on the ledger, and nothing is asked for them. `keeper.dropped()` is called if they go.
         * @param {string} key
         * @param {{visible?: () => boolean, dropped: () => void}} keeper
         */
        keep(key, keeper) {
            const entry = entries.get(key);
            if (!entry) return;
            entry.keepers.add(keeper);
            pinCodes(entry.codesKey);
        },

        unkeep(key, keeper) {
            const entry = entries.get(key);
            if (!entry || !entry.keepers.delete(keeper)) return;
            settle(entry);
        },

        snapshot: (key) => inner.snapshot(key),
        accept: (key) => inner.accept(key),
        retry: (key) => inner.retry(key),
        cancel: (key) => inner.cancel(key),
        /** A value that turned out to be for other cells: dropped, with its parts, and asked for again. */
        discard: (key) => inner.discard(key),

        /** The cost of all of a need, asked once. */
        estimateFor(need, dataset, hash) {
            const request = withWant(need.request, need.codes);
            if (need.features.length) request.features = need.features.map((f, i) => ({ id: `f${i}`, ...f.wire }));
            return inner.estimateFor(request, dataset, hash);
        },

        /** Consumers came on screen or left it: codes are pinned or unpinned, and what may start, starts. */
        poke() {
            for (const codesKey of [...held.keys()]) pinCodes(codesKey);
            inner.poke();
        },

        /** Stop every request (a new link opens, the dataset closes). */
        abortAll: () => inner.abortAll(),

        /** Forget what is cached (a refresh that re-reads the disk); the consumers' values are asked for again. */
        clear() {
            parts.clear();
            drops++;
            for (const [codesKey, h] of [...held]) { ledger.release(codesKey); dropCodes(codesKey, h); }
            inner.clear();
        },

        stats() {
            let codesBytes = 0;
            for (const h of held.values()) if (h.holders.size) codesBytes += h.codes.byteLength;
            return { ...inner.stats(), entries: entries.size, cached: parts.size, bytes: parts.bytes, evictions: parts.evictions, codesBytes };
        }
    };
}
