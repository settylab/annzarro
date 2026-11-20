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
 * The store speaks the derived store's interface (attach, detach, snapshot, accept, retry, cancel, discard,
 * estimateFor, poke, on), so utils/derived-sources.js drives it unchanged (utils/group-sources.js).
 */
import { ByteCache, bytesOf, createDerivedStore } from './derived-store.js';

/** Bytes of group tables and moments kept in the browser (CMP-12): a grid with a measure at its limit is 84 MB. */
const GROUP_BUDGET = 256 * 1024 * 1024;

/** The 413 reason of a request that costs too much. */
const REFUSAL_REASON = 'groups_too_expensive';

/** What one group or one level of a group table weighs on the JS heap, for the budget. */
const ROW_BYTES = 48;

/** The value of a request whose parts went into the cache: nothing else holds them. */
const ABSORBED = Object.freeze({});

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
 * @param {Object} options.request - the request without features and cells shown (`serverRequest`, a grid request)
 * @param {string} options.key - the grouping's key (PER-3): equal keys give equal groups for the same cells
 * @param {boolean} [options.codes] - the codes too
 * @param {Array<{key: string, wire: Object}>} [options.features] - each feature's key, and the feature as the request
 *   carries it, without its id
 * @returns {{request: Object, key: string, table: string, codes: boolean, features: Array<{key: string, wire: Object}>, hash: string}}
 */
export function groupNeed({ request, key, codes = false, features = [] }) {
    const histograms = (request.want && request.want.histograms) || [];
    const table = `${key}\u0002${histograms.join(',')}`;
    return { request, key, table, codes: !!codes, features: features.map(({ key: k, wire }) => ({ key: k, wire })),
        hash: `${table}\u0002${codes ? 1 : 0}\u0002${features.map((f) => f.key).join('\u0003')}` };
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
    /** @type {Map<string, {codes: ArrayBufferView, holders: Set<Object>}>} grouping key with cells -> its codes */
    const held = new Map();
    /** @type {Map<string, Object>} store key -> the consumers' entry */
    const entries = new Map();
    /** @type {Map<string, Set<Object>>} request key -> the entries waiting on it */
    const waitingOn = new Map();
    const listeners = new Set();

    const inner = createDerivedStore({
        api: {
            estimate: ({ recipe, dataset }) => api.estimate({ recipe: recipe.request, dataset }),
            async compute(args) {
                const out = await api.compute({ ...args, recipe: args.recipe.request });
                if (!out.header || out.header.refused) return out;
                absorb(args.recipe.parts, out);
                return { header: out.header, values: ABSORBED };
            }
        },
        budget: 1, limiter, bytesOf: () => 0, isEmpty: (out) => !!(out.header && out.header.refused),
        emptyMessage: 'No groups could be made.', refusalReason: REFUSAL_REASON
    });

    function emit(entry) {
        const snap = snapshot(entry.key);
        for (const fn of [...listeners]) {
            try { fn(entry.key, snap); } catch (error) { console.error('Group store listener:', error); }
        }
    }

    /** Codes are pinned while a holder is on screen; held by hidden holders only, the guard may evict them. */
    const onScreen = (h) => [...h.holders].some((e) => e.proxy.visible());

    function pinCodes(codesKey, h) {
        const pinned = onScreen(h);
        if (pinned === h.pinned) return;
        h.pinned = pinned;
        ledger.pin(codesKey, pinned);
    }

    function holdCodes(entry) {
        const h = held.get(entry.codesKey);
        if (!h || h.holders.has(entry)) return;
        h.holders.add(entry);
        if (h.holders.size === 1) {
            h.pinned = onScreen(h);
            ledger.hold(entry.codesKey, h.codes.byteLength, { pinned: h.pinned, evict: () => evicted(entry.codesKey, h) });
        } else {
            pinCodes(entry.codesKey, h);
        }
    }

    function releaseCodes(entry) {
        const h = entry.need.codes ? held.get(entry.codesKey) : null;
        if (!h || !h.holders.delete(entry)) return;
        if (h.holders.size) { pinCodes(entry.codesKey, h); return; }
        held.delete(entry.codesKey);
        ledger.release(entry.codesKey);
    }

    /** The guard evicted codes no consumer on screen held: their holders ask again, which starts once one is shown. */
    function evicted(codesKey, h) {
        if (held.get(codesKey) !== h) return;
        held.delete(codesKey);
        for (const entry of h.holders) {
            if (entries.get(entry.key) !== entry) continue;
            entry.values = null;
            entry.ready = null;
            if (!entry.r) plan(entry);
            emit(entry);
        }
    }

    /** The values of an entry from the parts held, or null when one is missing. Builds the entry's snapshot once. */
    function assemble(entry) {
        const table = parts.peek(entry.tableKey);
        if (!table) return null;
        const codes = entry.need.codes ? held.get(entry.codesKey) : null;
        if (entry.need.codes && !codes) return null;
        const features = [];
        for (const key of entry.featureKeys) {
            const f = parts.peek(key);
            if (!f) return null;
            features.push(f.values);
        }
        parts.get(entry.tableKey);
        for (const key of entry.featureKeys) parts.get(key);
        entry.values = { reply: table.values.reply, codes: codes ? codes.codes : null, features,
            counts: table.values.counts, measures: table.values.measures };
        entry.ready = Object.freeze({ key: entry.key, state: 'ready', values: entry.values, header: table.header,
            progress: null, estimate: null, message: null, reason: null });
        if (codes) holdCodes(entry);
        return entry.values;
    }

    /** Ask for what an entry misses: one request, which entries missing the same share. */
    function plan(entry) {
        const { need } = entry;
        const missing = [];
        need.features.forEach((f, i) => { if (!parts.has(entry.featureKeys[i])) missing.push(i); });
        const codes = need.codes && !held.has(entry.codesKey);
        const request = { ...need.request, want: { ...need.request.want, codes } };
        if (missing.length) request.features = missing.map((i, n) => ({ id: `f${n}`, ...need.features[i].wire }));
        const hash = `${need.table}\u0002${codes ? 1 : 0}\u0002${missing.map((i) => need.features[i].key).join('\u0003')}`;
        const key = `${hash}\u0001${entry.ctx}`;
        entry.r = key;
        if (!waitingOn.has(key)) waitingOn.set(key, new Set());
        waitingOn.get(key).add(entry);
        const recipe = { request, parts: { key, tableKey: entry.tableKey, codesKey: entry.codesKey, codes,
            features: missing.map((i) => entry.featureKeys[i]) } };
        const snap = inner.attach(key, { recipe, dataset: entry.dataset, subset: entry.subset, hash }, entry.proxy);
        // a request answered before, whose parts have gone since: ask again
        if (snap.state === 'ready') inner.discard(key);
    }

    /** A reply's parts into the cache, and its codes to the entries waiting for them. */
    function absorb(info, out) {
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
        const waiting = [...(waitingOn.get(info.key) || [])].filter((e) => e.need.codes);
        if (info.codes && out.values.codes && waiting.length && !held.has(info.codesKey)) {
            held.set(info.codesKey, { codes: out.values.codes, holders: new Set() });
        }
    }

    /** Stop waiting on a request; the request goes with its last waiter. */
    function leave(entry) {
        const key = entry.r;
        if (!key) return;
        entry.r = null;
        const set = waitingOn.get(key);
        if (set) { set.delete(entry); if (!set.size) waitingOn.delete(key); }
        inner.detach(key, entry.proxy);
        if (!inner.jobKeys().includes(key)) inner.cache.delete(key);
    }

    inner.on((key, snap) => {
        const set = waitingOn.get(key);
        if (!set) return;
        for (const entry of [...set]) {
            if (snap.state === 'ready' && !entry.values && !assemble(entry)) {
                // a part went before it could be read (the cache was full): ask for what is missing now
                queueMicrotask(() => {
                    if (entry.r !== key) return;
                    leave(entry);
                    if (entries.get(entry.key) === entry) { plan(entry); emit(entry); }
                });
            } else if (snap.state === 'ready') {
                // once the store has settled the request: leaving inside its own event would abort what is done
                queueMicrotask(() => { if (entry.r === key) leave(entry); });
            }
            emit(entry);
        }
        if (snap.state === 'ready') {
            for (const [codesKey, h] of held) if (!h.holders.size) held.delete(codesKey);
        }
    });

    function snapshot(key) {
        const entry = entries.get(key);
        if (!entry) return { key, state: 'idle', values: null, header: null, owners: 0 };
        if (entry.values) return entry.ready;
        if (!entry.r) return { key, state: 'idle', values: null, header: null, owners: entry.owners.size };
        const snap = inner.snapshot(entry.r);
        // too many levels or groups: a refusal of its own (SHR-35), never the state of a reply with nothing in it
        if (snap.state === 'noscore' && snap.header && snap.header.refused) {
            return { ...snap, key, state: 'refused', reason: snap.header.refused.reason, message: snap.header.message || null,
                values: null, owners: entry.owners.size };
        }
        // answered, and its parts not all there: what is missing is asked for at once
        const state = snap.state === 'ready' ? 'computing' : snap.state;
        return { ...snap, key, state, values: null, owners: entry.owners.size };
    }

    function forget(entry) {
        releaseCodes(entry);
        entry.values = null;
        entry.ready = null;
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
            let entry = entries.get(key);
            if (!entry) {
                const need = spec.recipe;
                const ctx = `${spec.dataset || ''}\u0001${spec.subset || ''}`;
                entry = { key, need, ctx, dataset: spec.dataset, subset: spec.subset || null, owners: new Set(), values: null,
                    ready: null, r: null, tableKey: `T\u0001${ctx}\u0001${need.table}`, codesKey: `C\u0001${ctx}\u0001${need.key}`,
                    featureKeys: need.features.map((f) => `F\u0001${ctx}\u0001${need.key}\u0001${f.key}`) };
                const mine = entry;
                entry.proxy = { visible: () => [...mine.owners].some((o) => !o.visible || o.visible()) };
                entries.set(key, entry);
                assemble(entry);
            }
            entry.owners.add(owner);
            if (!entry.values && !entry.r) plan(entry);
            else if (entry.r) inner.poke();
            return snapshot(key);
        },

        /** A consumer no longer needs it; the last one leaving stops the request and releases the codes. */
        detach(key, owner) {
            const entry = entries.get(key);
            if (!entry) return;
            entry.owners.delete(owner);
            if (entry.owners.size) return;
            entries.delete(key);
            forget(entry);
            leave(entry);
        },

        snapshot,

        /** Compute what asks first (`awaiting`), or again after a failure. */
        accept(key) {
            const entry = entries.get(key);
            return !!(entry && entry.r) && inner.accept(entry.r);
        },

        retry(key) {
            const entry = entries.get(key);
            return !!(entry && entry.r) && inner.retry(entry.r);
        },

        cancel(key) {
            const entry = entries.get(key);
            return !!(entry && entry.r) && inner.cancel(entry.r);
        },

        /** A value that turned out to be for other cells: dropped, with its parts, and asked for again. */
        discard(key) {
            const entry = entries.get(key);
            if (!entry) return false;
            forget(entry);
            parts.delete(entry.tableKey);
            for (const k of entry.featureKeys) parts.delete(k);
            if (entry.r) inner.discard(entry.r);
            else plan(entry);
            return true;
        },

        /** The cost of all of a need, asked once. */
        estimateFor(need, dataset, hash) {
            const request = { ...need.request, want: { ...need.request.want, codes: need.codes } };
            if (need.features.length) request.features = need.features.map((f, i) => ({ id: `f${i}`, ...f.wire }));
            return inner.estimateFor({ request }, dataset, hash);
        },

        /** Consumers came on screen or left it: codes are pinned or unpinned, and what may start, starts. */
        poke() {
            for (const [codesKey, h] of [...held]) if (h.holders.size) pinCodes(codesKey, h);
            inner.poke();
        },

        /** Stop every request (a new link opens, the dataset closes). */
        abortAll: () => inner.abortAll(),

        /** Forget what is cached (a refresh that re-reads the disk); the consumers' values are asked for again. */
        clear() {
            parts.clear();
            inner.clear();
            for (const entry of entries.values()) {
                if (!entry.values) continue;
                forget(entry);
                plan(entry);
            }
        },

        stats() {
            let codesBytes = 0;
            for (const h of held.values()) if (h.holders.size) codesBytes += h.codes.byteLength;
            return { ...inner.stats(), entries: entries.size, cached: parts.size, bytes: parts.bytes, evictions: parts.evictions, codesBytes };
        }
    };
}
