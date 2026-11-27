/**
 * Derived sources: who depends on which source's derived values (a signature's score today, a cell grouping next),
 * and what an edit of the source does to them. It does not know what a source is: the provider says how a source's
 * recipe is read in each consumer's option, how it is hashed and keyed, and the store computes and caches. Pure (no
 * DOM, no page state): the page supplies the sources, the dataset and subset, and a timer.
 *
 * A CONSUMER (a plot's x, y, colour or hover, a table's column, a grouping's factor; utils/consumer-kinds.js) holds a
 * HANDLE on one source, in one OPTION (for a score: its method and layer). `handle.read()` says where it stands:
 *
 *   ready      values are in the snapshot (`held` may say edits wait)
 *   updating   the key changed (an edit, a new option; a new subset is the exception: it drops the old values), or
 *              a gate in a working state stands (an upstream computing): the previous values are kept
 *   estimating, queued, computing, awaiting, refused, failed, noscore, cancelled   the store's states, no values
 *   deleted    the source is gone;  off  the source type is turned off on this server
 *   a gate's state (the source's input is not known yet), a state of the provider's own when the option asks
 *   nothing of the server (`none` of variantOf), or one it names for a store failure (`failureStates`)
 *
 * EDITS. Each source has an APPLIED recipe: the one its consumers show. When the source is edited, the applied recipe
 * follows after a short pause if the slowest estimate of the options in use is under `live_max_s` (from the estimate
 * reply), and otherwise the edits collect (`held`) until `update(id)`. Consumers keep the previous values meanwhile.
 *
 * A store that can (`store.keep`) is told which values a handle still shows after it left their key, so what holds
 * memory outside the heap stays counted until it is replaced; if the store drops them (`keeper.dropped()`), the
 * handle stops showing them.
 *
 * A read never hashes. What an applied recipe gives per option (its variant recipe, hash and fields) is worked out
 * once: a handle is read on every paint, progress frame and hover, and a hash may walk every gene. An applied recipe
 * is a private copy that is never edited (`copyOf`), so what follows from it never changes; an edit replaces it.
 */
import { countsAs, isConsumer, emptyUsage } from './consumer-kinds.js';
import { limit } from './limits.js';


/** Store states in which a consumer keeps the values it showed for the same cells. */
const PASSING = Object.freeze(['idle', 'estimating', 'queued', 'computing']);

/**
 * @typedef {Object} Sources
 * @property {(id: string) => ({title: string, kind?: string, recipe: () => Object, gate?: (panelId: ?string) => (Object|null),
 *   actions?: ({accept: Function, cancel: Function, retry: Function}|null)}|null)} get
 *   A source whose input cannot be read yet (a table being built, a cycle) has a `gate`: its consumers show the gate's
 *   state, and its `actions` answer Compute, Cancel and Retry, until it lifts.
 * @property {() => boolean} [off] - the source type is turned off here
 */

/**
 * @typedef {Object} Variant
 * @property {Object} recipe - what the server is asked for this option
 * @property {Object} [fields] - added to a snapshot that has a key (a score's `layer`)
 * @property {Object} [none] - the option asks nothing of the server: the snapshot's state and fields (`{state: 'nogenes'}`)
 * @property {string} [hash] - the variant's hash, when the provider makes it itself (no `hashOf` is then needed)
 */

/**
 * @param {Object} options
 * @param {ReturnType<import('./derived-store.js').createDerivedStore>} options.store
 * @param {Sources} options.sources
 * @param {() => {dataset: string, subset: (string|null), cells?: (number|null)}} options.context
 * @param {(recipe: Object, option: Object) => Variant} options.variantOf - a recipe read in a consumer's option
 * @param {(recipe: Object) => (variant: Object) => string} [options.hashOf] - a recipe's hasher: walks its long parts
 *   once, then hashes each variant of it; not needed when every variant carries its `hash`
 * @param {(recipe: Object, hash: Function) => string} options.editHashOf - covers every variant the recipe can give:
 *   equal edit hashes mean no setting changed
 * @param {(parts: {hash: string, dataset: string, subset: (string|null)}) => string} options.keyOf - the store key
 * @param {(recipe: Object) => Object} [options.copyOf] - a copy no later edit of the source can change (the recipe
 *   itself when `recipe()` makes a fresh one each time)
 * @param {(option: Object) => boolean} [options.isOption] - false for an option of another source type, left over
 *   while a consumer switches: nothing is asked for it
 * @param {Record<string, string>} [options.failureStates] - a store failure reason stated as a state of its own
 * @param {(values: *) => number} [options.countOf] - the cells a value covers, checked against `context().cells`
 * @param {string} [options.kind] - a source's kind when it does not say
 * @param {string} [options.thing] - what a value is called, in the cells-mismatch message
 * @param {number} [options.liveDelayMs] - the pause after the last edit
 * @param {Function} [options.setTimer]
 * @param {Function} [options.clearTimer]
 */
export function createDerivedSources({ store, sources, context, variantOf, hashOf = () => null, editHashOf, keyOf,
    copyOf = (recipe) => recipe,
    isOption = () => true, failureStates = {}, countOf = (values) => values.length,
    kind: defaultKind = null, thing = 'value', liveDelayMs = 350,
    setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t) }) {
    /** @type {Set<Object>} every handle, in the order consumers came */
    const handles = new Set();
    /** @type {Map<string, Set<Object>>} source id -> its handles */
    const bySource = new Map();
    /** @type {Map<string, Set<Object>>} store key -> the handles on it */
    const byKey = new Map();
    /** @type {Map<string, Object>} id -> the recipe the consumers show */
    const applied = new Map();
    /** @type {Map<string, {edits: number, seconds: (number|null), held: boolean, timer: any, token: number, lastHash: (string|null)}>} */
    const pending = new Map();
    /** @type {Map<string, Set<Function>>} */
    const sourceListeners = new Map();
    /** @type {Set<string>} sources told of an edit while a gate stood: compared again once it lifts */
    const missed = new Set();
    let token = 0;

    /** @type {WeakMap<Object, Map<string, *>>} applied recipe -> what follows from it */
    const derived = new WeakMap();
    const memo = (recipe, key, make) => {
        let map = derived.get(recipe);
        if (!map) derived.set(recipe, map = new Map());
        if (!map.has(key)) map.set(key, make());
        return map.get(key);
    };
    const optionKeyOf = (option) => JSON.stringify(option);
    /** A variant's hash: its own, or the recipe's hasher's. */
    const hashOfVariant = (v, hasher) => (typeof v.hash === 'string' ? v.hash : hasher()(v.recipe));
    /** The hasher of an applied recipe: its long parts are walked once for every option. */
    const hasherOf = (recipe) => memo(recipe, '\u0000hasher', () => hashOf(recipe));
    /** An applied recipe read in one option, with its hash: {recipe, hash, fields, none}. */
    const variantFor = (recipe, option, optionKey = optionKeyOf(option)) => memo(recipe, optionKey, () => {
        const v = variantOf(recipe, option);
        return { recipe: v.recipe, hash: hashOfVariant(v, () => hasherOf(recipe)), fields: v.fields || null, none: v.none || null };
    });
    const appliedEditHash = (recipe) => memo(recipe, '\u0000edit', () => editHashOf(recipe, hasherOf(recipe)));

    const handlesOf = (id) => [...(bySource.get(id) || [])];
    /** The options the consumers of a source read, each once. */
    const optionsUsed = (id) => {
        const seen = new Map();
        for (const h of bySource.get(id) || []) seen.set(h.optionKey, h.option);
        return [...seen.values()];
    };
    /** Whether the live recipe is a different value from the applied one for any option a consumer of `id` reads. */
    const changesValue = (id, live, was, hash) => optionsUsed(id).some(o => hashOfVariant(variantOf(live, o), () => hash) !== variantFor(was, o).hash);

    /** The gate of a source for a consumer: the state its input is in, or null when it can be read. */
    function gateOf(src, panelId) {
        return typeof src.gate === 'function' ? src.gate(panelId || null) : null;
    }

    function appliedOf(id, src) {
        let recipe = applied.get(id);
        if (!recipe) {
            recipe = copyOf(src.recipe());
            applied.set(id, recipe);
        }
        return recipe;
    }

    /** A button of a gate notice (Compute, Cancel, Retry): the source's own way. */
    function gateAction(handle, action) {
        const src = sources.get(handle.id);
        const actions = src && src.actions;
        if (!actions || !gateOf(src, handle.panelId)) return false;
        actions[action]();
        return true;
    }

    /** One option of a source as its consumers would show it; null when the source is gone, gated or asks nothing. */
    function optionOf(id, option) {
        const src = sources.get(id);
        if (!src || gateOf(src, null)) return null;
        const v = variantFor(applied.get(id) || copyOf(src.recipe()), option);
        return v.none ? null : v;
    }

    const ctxKeyOf = (ctx) => `${ctx.dataset}\u0001${ctx.subset || ''}`;

    function heldOf(id) {
        const p = pending.get(id);
        return p && p.held ? { edits: p.edits, seconds: p.seconds } : null;
    }

    function notifyHandle(handle) {
        if (handle.released) return;
        try { handle.onChange(handle.read()); } catch (error) { console.error('Source consumer:', error); }
    }

    function notifyListeners(id) {
        for (const fn of [...(sourceListeners.get(id) || [])]) {
            try { fn(status(id)); } catch (error) { console.error('Source status listener:', error); }
        }
    }

    function notifySource(id) {
        for (const handle of handlesOf(id)) notifyHandle(handle);
        notifyListeners(id);
    }

    /** What a handle shows; a store that can is told, so it keeps those values while the handle shows them. */
    function setShown(handle, shown) {
        const was = handle.shown;
        handle.shown = shown;
        const from = was ? was.key : null;
        const to = shown ? shown.key : null;
        if (from === to || typeof store.keep !== 'function') return;
        if (to) store.keep(to, handle.keeper);
        if (from) store.unkeep(from, handle.keeper);
    }

    function dropKey(handle) {
        if (!handle.key) return;
        const on = byKey.get(handle.key);
        if (on) { on.delete(handle); if (!on.size) byKey.delete(handle.key); }
        store.detach(handle.key, handle);
        handle.key = null;
    }

    function setKey(handle, key, spec) {
        dropKey(handle);
        handle.key = key;
        if (!byKey.has(key)) byKey.set(key, new Set());
        byKey.get(key).add(handle);
        store.attach(key, spec, handle);      // may tell the handles on `key` at once: the handle is on it already
    }

    /** Where a consumer stands. */
    function read(handle) {
        return readOne(handle);
    }

    function readOne(handle) {
        const id = handle.id;
        if (!handle.known) {
            dropKey(handle);
            return { id, title: '', held: null, key: null, state: 'estimating' };
        }
        const ctx = context();
        const src = sources.get(id);
        const base = { id, title: src ? src.title : handle.lastTitle || '', held: null, key: null, kind: handle.lastKind || defaultKind };
        if (!src) {
            dropKey(handle);
            return { ...base, state: sources.off && sources.off(id) ? 'off' : 'deleted' };
        }
        handle.lastTitle = src.title;
        base.kind = handle.lastKind = src.kind || defaultKind;
        const gate = gateOf(src, handle.panelId);
        if (gate) {
            dropKey(handle);
            const { state, ...rest } = gate;
            // an upstream still computing: the previous values stay, as for an edit
            const previous = handle.shown && handle.shown.ctx === ctxKeyOf(ctx) ? handle.shown : null;
            if (previous && PASSING.includes(state)) {
                return { ...base, ...rest, held: heldOf(id), state: 'updating', previous: true, values: previous.values,
                    header: previous.header, shownKey: previous.key };
            }
            return { ...base, state, ...rest };
        }
        const held = heldOf(id);
        const v = variantFor(appliedOf(id, src), handle.option, handle.optionKey);
        if (v.none) {
            dropKey(handle);
            return { ...base, held, ...v.none };
        }
        const key = keyOf({ hash: v.hash, dataset: ctx.dataset, subset: ctx.subset });
        if (key !== handle.key) setKey(handle, key, { recipe: v.recipe, dataset: ctx.dataset, subset: ctx.subset || null, hash: v.hash });
        const snap = store.snapshot(key);
        base.key = key;
        if (v.fields) Object.assign(base, v.fields);
        if (snap.state === 'failed' && Object.hasOwn(failureStates, snap.reason)) {
            setShown(handle, null);
            return { ...base, held, state: failureStates[snap.reason], message: snap.message };
        }
        // A value covers the cells shown. One of another size is for other cells (a subset changed while it was on
        // its way, or a stale entry): it is asked for again once, and then stated as failed with Retry, never shown
        // and never waited on in silence.
        const got = snap.state === 'ready' && snap.values && typeof ctx.cells === 'number' ? countOf(snap.values) : null;
        if (got !== null && got !== ctx.cells) {
            if (handle.mismatchKey !== key) {
                handle.mismatchKey = key;
                store.discard(key);
                return { ...base, held, state: 'estimating', progress: null, owners: snap.owners };
            }
            return { ...base, held, state: 'failed', reason: 'cells_mismatch', owners: snap.owners,
                message: `the ${thing} has ${got.toLocaleString('en-US')} values for ${ctx.cells.toLocaleString('en-US')} cells`,
                mismatch: true };
        }
        if (snap.state === 'ready' && snap.values) {
            if (!handle.shown || handle.shown.values !== snap.values || handle.shown.key !== key) {
                setShown(handle, { key, ctx: ctxKeyOf(ctx), values: snap.values, header: snap.header });
            }
            return { ...base, held, state: 'ready', values: snap.values, header: snap.header, shownKey: key };
        }
        const previous = handle.shown && handle.shown.ctx === ctxKeyOf(ctx) ? handle.shown : null;
        const working = PASSING.includes(snap.state);
        if (previous && working) {
            return { ...base, held, state: 'updating', previous: true, values: previous.values, header: previous.header,
                shownKey: previous.key, progress: snap.progress, estimate: snap.estimate, owners: snap.owners,
                forced: snap.forced, unasked: snap.unasked };
        }
        if (!working) setShown(handle, null);
        // a refusal for its size keeps the route's figures (header.refused: count, limit), which its notice names
        // an idle job has no request out (nothing that reads it is on screen yet): its notice says so, not "Computing"
        return { ...base, held, state: snap.state === 'idle' ? 'estimating' : snap.state, ...(snap.state === 'idle' ? { notStarted: true } : {}), progress: snap.progress,
            estimate: snap.estimate, message: snap.message, reason: snap.reason, owners: snap.owners,
            forced: snap.forced, unasked: snap.unasked, limitS: snap.limitS,
            ...(snap.state === 'refused' && snap.header ? { header: snap.header } : {}) };
    }

    // a store change: the handles on that key, then the status listeners of their sources
    store.on((key) => {
        const on = byKey.get(key);
        if (!on) return;
        const list = [...on];
        for (const handle of list) notifyHandle(handle);
        for (const id of new Set(list.map(h => h.id))) notifyListeners(id);
    });

    function status(id) {
        const src = sources.get(id);
        const mine = handlesOf(id);
        const p = pending.get(id);
        const probe = mine[0] ? read(mine[0]) : null;
        return {
            id, exists: !!src, kind: src ? src.kind || defaultKind : null, dependants: mine.length,
            held: heldOf(id), checking: !!(p && !p.held),
            state: probe ? probe.state : null, progress: probe ? probe.progress || null : null,
            header: probe ? probe.header || null : null, sharers: mine.length ? mine[0].sharers() : 0,
            estimate: probe ? probe.estimate || null : null, message: probe ? probe.message || null : null,
            key: probe ? probe.key : null
        };
    }

    function apply(id) {
        const src = sources.get(id);
        const p = pending.get(id);
        if (p && p.timer) clearTimer(p.timer);
        pending.delete(id);
        if (src) applied.set(id, copyOf(src.recipe()));
        notifySource(id);
    }

    async function decide(id, mine) {
        const src = sources.get(id);
        const p = pending.get(id);
        if (!src || !p || p.token !== mine) return;
        p.timer = null;
        if (gateOf(src, null)) { pending.delete(id); missed.add(id); notifySource(id); return; }
        const edited = copyOf(src.recipe());
        const ctx = context();
        const hash = hashOf(edited);
        // the slowest of the values the consumers read decides whether the edit is applied at once
        const replies = await Promise.all(optionsUsed(id).map((o) => {
            const v = variantOf(edited, o);
            if (v.none) return null;               // nothing to ask for this option
            return store.estimateFor(v.recipe, ctx.dataset, hashOfVariant(v, () => hash))
                .catch(() => null);                // the failure shows when the edit is applied and computed
        }));
        const now = pending.get(id);
        if (!now || now.token !== mine) return;
        let reply = null;
        for (const r of replies) if (r && r.estimate && (!reply || r.estimate.seconds > reply.estimate.seconds)) reply = r;
        const estimate = reply && reply.estimate;
        // seconds the estimate may be to apply an edit at once: the reply's, else the server's limits.live_update_s
        const live = estimate && typeof estimate.live_max_s === 'number' ? estimate.live_max_s : limit('live_update_s');
        if (!estimate || estimate.seconds < live) {
            apply(id);
        } else {
            now.held = true;
            now.seconds = estimate.seconds;
            notifySource(id);
        }
    }

    /** A source was edited (or restored by Back and Forward): decide what its consumers do. */
    function sourceChanged(id) {
        const src = sources.get(id);
        const used = bySource.has(id);
        if (!src || !used) {
            if (!used) applied.delete(id);
            notifySource(id);
            return;
        }
        // a source whose input is not known yet has no recipe to compare: its consumers hear it when it has
        if (gateOf(src, handlesOf(id)[0].panelId)) { missed.add(id); notifySource(id); return; }
        missed.delete(id);
        const live = src.recipe();
        const was = applied.get(id);
        if (!was) { appliedOf(id, src); notifySource(id); return; }
        const p = pending.get(id);
        const hash = hashOf(live);                 // the live recipe's long parts, walked once for every hash below
        if (!changesValue(id, live, was, hash)) {
            // edited back to what is shown, or changed only what no consumer reads: the settings are kept, and
            // nothing is asked for
            if (p && p.timer) clearTimer(p.timer);
            pending.delete(id);
            if (editHashOf(live, hash) !== appliedEditHash(was)) applied.set(id, copyOf(live));
            notifySource(id);
            return;
        }
        // told again of a recipe it already knows (the page rechecks after panels change): not another edit
        const liveHash = editHashOf(live, hash);
        if (p && p.lastHash === liveHash) { notifySource(id); return; }
        const next = p || { edits: 0, seconds: null, held: false, timer: null, token: 0, lastHash: null };
        next.lastHash = liveHash;
        next.edits++;
        next.token = ++token;
        next.held = false;
        next.seconds = null;
        if (next.timer) clearTimer(next.timer);
        const mine = next.token;
        next.timer = setTimer(() => { decide(id, mine); }, liveDelayMs);
        pending.set(id, next);
        notifySource(id);
    }

    return {
        /**
         * A consumer needs the values of source `id`, read in `option`.
         * @param {string} id
         * @param {{consumer: {kind: string, role?: string, panelId?: ?string, host?: *}, option?: Object,
         *   visible?: () => boolean, onChange: (snapshot: Object) => void}} spec
         *   `consumer.kind`: one of utils/consumer-kinds.js; an unknown or missing kind throws. `role`: the slot in the
         *   consumer ('color', 'x', 'column'), not counted. `panelId`: the consumer's panel, which a gate is asked
         *   about. `host`: who shares a request, for "Cancel for 3 plots"; the panel when not given.
         */
        watch(id, { consumer, option = {}, visible = () => true, onChange }) {
            const { kind, role = '', panelId = null, host = panelId } = consumer || {};
            countsAs(kind);   // throws for an unknown kind, before anything is registered
            const handle = {
                id, option, optionKey: optionKeyOf(option), known: isOption(option), kind, role, panelId, host,
                visible, onChange, key: null, shown: null, mismatchKey: null, lastTitle: '', lastKind: null, released: false,
                read() { return read(handle); },
                release() {
                    if (handle.released) return;
                    handle.released = true;
                    handles.delete(handle);
                    const mine = bySource.get(id);
                    mine.delete(handle);
                    dropKey(handle);
                    setShown(handle, null);
                    if (!mine.size) {
                        bySource.delete(id);
                        applied.delete(id);
                        missed.delete(id);
                        const p = pending.get(id);
                        if (p && p.timer) clearTimer(p.timer);
                        pending.delete(id);
                    }
                },
                /**
                 * Read another option of the same source (a Cell-Gene Plot's genes): what it shows stays until the new
                 * values come, and the source's applied recipe and held edits are untouched.
                 */
                setOption(next = {}) {
                    if (handle.released) return;
                    handle.option = next;
                    handle.optionKey = optionKeyOf(next);
                    handle.known = isOption(next);
                    notifyHandle(handle);
                },
                compute() { return handle.key ? store.accept(handle.key) : gateAction(handle, 'accept'); },
                retry() {
                    if (!handle.key) return gateAction(handle, 'retry');
                    if (handle.mismatchKey === handle.key) {
                        // the value did not fit the cells: ask for it afresh, once more
                        handle.mismatchKey = null;
                        store.discard(handle.key);
                        notifyHandle(handle);
                        return true;
                    }
                    return store.retry(handle.key);
                },
                cancel() { return handle.key ? store.cancel(handle.key) : gateAction(handle, 'cancel'); },
                /** Distinct hosts waiting on the same request: "Cancel for 3 plots". */
                sharers() {
                    const hosts = new Set();
                    for (const h of byKey.get(handle.key) || []) hosts.add(h.host || h);
                    return hosts.size;
                }
            };
            // what the store is told while it keeps values this handle still shows
            handle.keeper = {
                visible: () => !handle.released && handle.visible(),
                dropped() {
                    if (!handle.shown) return;
                    setShown(handle, null);
                    notifyHandle(handle);
                }
            };
            handles.add(handle);
            if (!bySource.has(id)) bySource.set(id, new Set());
            bySource.get(id).add(handle);
            return handle;
        },

        sourceChanged,

        /** Panels came or went (Back and Forward put a closed source back): any source whose recipe differs from the applied one is an edit. */
        recheck() {
            for (const id of [...bySource.keys()]) if (sources.get(id)) sourceChanged(id);
        },

        /** Whether the values of one option are held (ready in the store), without asking for anything. */
        isReady(id, option) {
            const v = optionOf(id, option);
            if (!v) return false;
            const ctx = context();
            return store.snapshot(keyOf({ hash: v.hash, dataset: ctx.dataset, subset: ctx.subset })).state === 'ready';
        },

        /**
         * What the values of one option would cost, asked of the server without computing anything (the estimate
         * tiers). Null when the source is gone, gated or asks nothing for it.
         * @returns {Promise<Object|null>} the estimate reply
         */
        async estimate(id, option) {
            const v = optionOf(id, option);
            return v ? store.estimateFor(v.recipe, context().dataset, v.hash) : null;
        },

        /** "Update": apply the held edits now. */
        update(id) {
            if (!sources.get(id)) return false;
            apply(id);
            return true;
        },

        /**
         * The dataset or the cells shown changed: every handle moves to its new key. A gate the change lifts (a table
         * factor's cells under its limit again) lets the edits made under it count: each source is compared again.
         */
        contextChanged() {
            for (const id of [...missed]) {
                const src = sources.get(id);
                if (!src || !bySource.has(id)) missed.delete(id);
                else if (!gateOf(src, handlesOf(id)[0].panelId)) sourceChanged(id);
            }
            for (const handle of [...handles]) notifyHandle(handle);
            for (const id of [...bySource.keys()]) notifyListeners(id);
        },

        /** A consumer came on screen, or left it. */
        visibilityChanged() {
            store.poke();
        },

        status,

        /** @returns {() => void} */
        onSource(id, fn) {
            if (!sourceListeners.has(id)) sourceListeners.set(id, new Set());
            sourceListeners.get(id).add(fn);
            return () => sourceListeners.get(id).delete(fn);
        },

        handlesOf,

        /** The plots, tables and groupings that read a source; viewers (Inspect, its export) are not consumers. */
        consumersOf(id) { return handlesOf(id).filter(h => isConsumer(h.kind)); },

        /**
         * Who uses a source, counted by a value of the option its consumers read.
         * @param {string} id
         * @param {(option: Object) => *} by - the value a consumer counts under
         * @returns {Array<{value: *, plots: number, tables: number, groupings: number}>}
         */
        usage(id, by) {
            const rows = new Map();
            for (const handle of bySource.get(id) || []) {
                if (!isConsumer(handle.kind)) continue;
                const value = by(handle.option);
                const row = rows.get(value) || emptyUsage(value);
                row[countsAs(handle.kind)]++;
                rows.set(value, row);
            }
            return [...rows.values()];
        },

        heldOf,

        /** For tests. */
        appliedOf(id) { return applied.get(id) || null; }
    };
}
