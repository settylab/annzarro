/**
 * Who depends on which signature's score, and what an edit does to them.
 * Pure (no DOM, no page state): the page supplies the signatures, the current
 * dataset and subset, and a timer. utils/score-source.js binds it to the page.
 *
 * A DEPENDANT (a plot's x, y, colour or hover; later a table's column) holds a
 * HANDLE for one signature. `handle.read()` says where its score stands:
 *
 *   ready      values are in the handle (`held` may say edits wait)
 *   updating   the key changed (an edit, a new subset's cells are the exception:
 *              they drop the old values); the previous values are kept
 *   estimating, queued, computing, awaiting, refused, failed, noscore,
 *   cancelled  the store's states, no values
 *   nogenes    the signature has no genes
 *   deleted    the signature is gone
 *   off        gene signatures are turned off on this server
 *
 * EDITS. Each signature has an APPLIED recipe: the one its dependants show.
 * When the signature is edited, the applied recipe follows after a short pause
 * if the new recipe's estimate is under `live_max_s` (read from the estimate
 * reply), and otherwise the edits collect (`held`) until `update(id)` -
 * "Update score". Dependants keep the previous score meanwhile.
 */
import { recipeHash, DEFAULT_METHOD, METHODS } from './gene-signature.js';
import { scoreKey } from './score-store.js';

/** Seconds the estimate may be to apply an edit at once, when the reply does not say. */
const LIVE_MAX_S = 5;

/** A recipe copied, so a later edit of the signature cannot change what was applied. */
function copyRecipe(recipe) {
    return { ...recipe, genes: [...recipe.genes], down: [...(recipe.down || [])] };
}

/**
 * @typedef {Object} Signatures
 * @property {(id: string) => ({title: string, recipe: () => Object}|null)} get
 * @property {() => boolean} [off] - gene signatures are turned off here
 */

/**
 * @param {Object} options
 * @param {ReturnType<import('./score-store.js').createScoreStore>} options.store
 * @param {Signatures} options.signatures
 * @param {() => {dataset: string, subset: (string|null)}} options.context
 * @param {number} [options.liveDelayMs] - the pause after the last edit
 * @param {Function} [options.setTimer]
 * @param {Function} [options.clearTimer]
 */
export function createScoreSources({ store, signatures, context, liveDelayMs = 350,
    setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t) }) {
    /** @type {Set<Object>} */
    const handles = new Set();
    /** @type {Map<string, Object>} id -> the recipe the dependants show */
    const applied = new Map();
    /** @type {Map<string, {edits: number, seconds: (number|null), held: boolean, timer: any, token: number}>} */
    const pending = new Map();
    /** @type {Map<string, Set<Function>>} */
    const signatureListeners = new Map();
    let token = 0;

    const hashOf = (recipe) => recipeHash(recipe);
    // The aggregation belongs to the consumer, not the signature: a score is the signature's genes and
    // shared settings read with one method. Edits are compared without it.
    const withMethod = (recipe, sub, layer) => ({ ...recipe, method: sub || DEFAULT_METHOD, input: layer || recipe.input });
    // An edit is a change to any score the signature could give: the genes and every shared setting. The clip only
    // reaches the z-score mean and the seed only the control-adjusted score, so the hash covers each method.
    const editHash = (recipe) => METHODS.map(m => hashOf(withMethod(recipe, m))).join('|');
    /** The aggregations the dependants of a signature read, each once. */
    const pairsUsed = (id) => {
        const seen = new Map();
        for (const h of handles) if (h.sigId === id) seen.set(`${h.sub || DEFAULT_METHOD}\u0001${h.layer || ''}`, { sub: h.sub || DEFAULT_METHOD, layer: h.layer || '' });
        return [...seen.values()];
    };
    /** Whether `b` is a different score from `a` for any (aggregation, layer) a dependant of `id` reads. */
    const changesScore = (id, a, b) => pairsUsed(id).some(p => hashOf(withMethod(a, p.sub, p.layer)) !== hashOf(withMethod(b, p.sub, p.layer)));
    const genesIn = (recipe) => recipe.genes.length + (recipe.down ? recipe.down.length : 0);

    function appliedOf(id, sig) {
        let recipe = applied.get(id);
        if (!recipe) {
            recipe = copyRecipe(sig.recipe());
            applied.set(id, recipe);
        }
        return recipe;
    }

    function ctxKeyOf(ctx) { return `${ctx.dataset}\u0001${ctx.subset || ''}`; }

    function heldOf(id) {
        const p = pending.get(id);
        return p && p.held ? { edits: p.edits, seconds: p.seconds } : null;
    }

    function notifyHandle(handle) {
        if (handle.released) return;
        try { handle.onChange(handle.read()); } catch (error) { console.error('Score dependant:', error); }
    }

    function notifySignature(id) {
        for (const fn of [...(signatureListeners.get(id) || [])]) {
            try { fn(status(id)); } catch (error) { console.error('Score status listener:', error); }
        }
    }

    function notifySource(id) {
        for (const handle of [...handles]) if (handle.sigId === id) notifyHandle(handle);
        notifySignature(id);
    }

    function dropKey(handle) {
        if (handle.key) store.detach(handle.key, handle);
        handle.key = null;
    }

    /** What a handle shows and which key it stands on, rebinding when the key moved. */
    function read(handle) {
        const ctx = context();
        const sig = signatures.get(handle.sigId);
        const base = { sigId: handle.sigId, title: sig ? sig.title : handle.lastTitle || '', held: null, key: null };
        if (!sig) {
            dropKey(handle);
            return { ...base, state: signatures.off && signatures.off() ? 'off' : 'deleted' };
        }
        handle.lastTitle = sig.title;
        const recipe = withMethod(appliedOf(handle.sigId, sig), handle.sub, handle.layer);
        const held = heldOf(handle.sigId);
        if (genesIn(recipe) === 0) {
            dropKey(handle);
            return { ...base, held, state: 'nogenes' };
        }
        const hash = hashOf(recipe);
        const key = scoreKey({ hash, dataset: ctx.dataset, subset: ctx.subset });
        if (key !== handle.key) {
            dropKey(handle);
            handle.key = key;
            store.attach(key, { recipe, dataset: ctx.dataset, subset: ctx.subset || null, hash }, handle);
        }
        const snap = store.snapshot(key);
        base.key = key;
        // A score is one number per cell shown. One of another length is for other cells (a subset
        // changed while it was on its way, or a stale entry): it is asked for again once, and then
        // stated as failed with Retry, never shown and never waited on in silence.
        if (snap.state === 'ready' && snap.values && typeof ctx.cells === 'number' && snap.values.length !== ctx.cells) {
            const got = snap.values.length;
            if (handle.mismatchKey !== key) {
                handle.mismatchKey = key;
                store.discard(key);
                return { ...base, held, state: 'estimating', progress: null, owners: snap.owners };
            }
            return { ...base, held, state: 'failed', reason: 'cells_mismatch', owners: snap.owners,
                message: `the score has ${got.toLocaleString('en-US')} values for ${ctx.cells.toLocaleString('en-US')} cells`,
                mismatch: true };
        }
        if (snap.state === 'ready' && snap.values) {
            handle.shown = { key, ctx: ctxKeyOf(ctx), values: snap.values, header: snap.header };
            return { ...base, held, state: 'ready', values: snap.values, header: snap.header, shownKey: key };
        }
        const previous = handle.shown && handle.shown.ctx === ctxKeyOf(ctx) ? handle.shown : null;
        const working = ['idle', 'estimating', 'queued', 'computing'].includes(snap.state);
        if (previous && working) {
            return { ...base, held, state: 'updating', previous: true, values: previous.values, header: previous.header,
                shownKey: previous.key, progress: snap.progress, estimate: snap.estimate, owners: snap.owners };
        }
        if (!working) handle.shown = null;
        return { ...base, held, state: snap.state === 'idle' ? 'estimating' : snap.state, progress: snap.progress,
            estimate: snap.estimate, message: snap.message, reason: snap.reason, owners: snap.owners };
    }

    // a store change: every handle on that key
    store.on((key) => {
        for (const handle of [...handles]) if (handle.key === key) notifyHandle(handle);
        const ids = new Set([...handles].filter(h => h.key === key).map(h => h.sigId));
        for (const id of ids) notifySignature(id);
    });

    function status(id) {
        const sig = signatures.get(id);
        const mine = [...handles].filter(h => h.sigId === id);
        const p = pending.get(id);
        const probe = mine[0] ? read(mine[0]) : null;
        return {
            id, exists: !!sig, dependants: mine.length,
            held: heldOf(id), checking: !!(p && !p.held),
            state: probe ? probe.state : null, progress: probe ? probe.progress || null : null,
            header: probe ? probe.header || null : null, sharers: mine.length ? mine[0].sharers() : 0,
            estimate: probe ? probe.estimate || null : null, message: probe ? probe.message || null : null,
            key: probe ? probe.key : null
        };
    }

    function apply(id) {
        const sig = signatures.get(id);
        const p = pending.get(id);
        if (p && p.timer) clearTimer(p.timer);
        pending.delete(id);
        if (sig) applied.set(id, copyRecipe(sig.recipe()));
        notifySource(id);
    }

    async function decide(id, mine) {
        const sig = signatures.get(id);
        const p = pending.get(id);
        if (!sig || !p || p.token !== mine) return;
        p.timer = null;
        const edited = copyRecipe(sig.recipe());
        if (genesIn(edited) === 0) { apply(id); return; }
        const ctx = context();
        // the slowest of the scores the dependants read decides whether the edit is applied at once
        const replies = await Promise.all(pairsUsed(id).map((p) => {
            const live = withMethod(edited, p.sub, p.layer);
            return store.estimateFor(live, ctx.dataset, hashOf(live))
                .catch(() => null);   // the failure shows when the edit is applied and computed
        }));
        const now = pending.get(id);
        if (!now || now.token !== mine) return;
        let reply = null;
        for (const r of replies) if (r && r.estimate && (!reply || r.estimate.seconds > reply.estimate.seconds)) reply = r;
        const estimate = reply && reply.estimate;
        const limit = estimate && typeof estimate.live_max_s === 'number' ? estimate.live_max_s : LIVE_MAX_S;
        if (!estimate || estimate.seconds < limit) {
            apply(id);
        } else {
            now.held = true;
            now.seconds = estimate.seconds;
            notifySource(id);
        }
    }

    return {
        /**
         * A dependant needs the score of signature `id`.
         * @param {string} id
         * @param {{onChange: (state: Object) => void, visible?: () => boolean, host?: any, role?: string}} spec
         */
        watch(id, { onChange, visible = () => true, host = null, role = '', sub = null, layer = null }) {
            const handle = {
                sigId: id, sub, layer, key: null, shown: null, lastTitle: '', released: false, host, role, visible, onChange,
                read() { return read(handle); },
                release() {
                    if (handle.released) return;
                    handle.released = true;
                    handles.delete(handle);
                    dropKey(handle);
                    handle.shown = null;
                    if (![...handles].some(h => h.sigId === id)) {
                        applied.delete(id);
                        const p = pending.get(id);
                        if (p && p.timer) clearTimer(p.timer);
                        pending.delete(id);
                    }
                },
                compute() { return handle.key ? store.accept(handle.key) : false; },
                retry() {
                    if (!handle.key) return false;
                    if (handle.mismatchKey === handle.key) {
                        // the score did not fit the cells: ask for it afresh, once more
                        handle.mismatchKey = null;
                        store.discard(handle.key);
                        notifyHandle(handle);
                        return true;
                    }
                    return store.retry(handle.key);
                },
                cancel() { return handle.key ? store.cancel(handle.key) : false; },
                /** Distinct hosts waiting on the same score: "Cancel for 3 plots". */
                sharers() {
                    const hosts = new Set();
                    for (const h of handles) if (h.key && h.key === handle.key) hosts.add(h.host || h);
                    return hosts.size;
                }
            };
            handles.add(handle);
            return handle;
        },

        /** A signature was edited (or restored by Back and Forward): decide what its dependants do. */
        recipeChanged(id) {
            const sig = signatures.get(id);
            const used = [...handles].some(h => h.sigId === id);
            if (!sig || !used) {
                if (!used) applied.delete(id);
                notifySource(id);
                return;
            }
            const live = sig.recipe();
            const was = applied.get(id);
            if (!was) { appliedOf(id, sig); notifySource(id); return; }
            const p = pending.get(id);
            if (!changesScore(id, live, was)) {
                // edited back to what is shown, or changed only what no dependant reads (the clip, for a plain mean):
                // the settings are kept, and no score is asked for
                if (p && p.timer) clearTimer(p.timer);
                pending.delete(id);
                if (editHash(live) !== editHash(was)) applied.set(id, copyRecipe(live));
                notifySource(id);
                return;
            }
            // told again of a recipe it already knows (the page rechecks after panels change): not another edit
            if (p && p.lastHash === editHash(live)) { notifySource(id); return; }
            const next = p || { edits: 0, seconds: null, held: false, timer: null, token: 0, lastHash: null };
            next.lastHash = editHash(live);
            next.edits++;
            next.token = ++token;
            next.held = false;
            next.seconds = null;
            if (next.timer) clearTimer(next.timer);
            const mine = next.token;
            next.timer = setTimer(() => { decide(id, mine); }, liveDelayMs);
            pending.set(id, next);
            notifySource(id);
        },

        /** Panels came or went (Back and Forward put a closed signature back): any signature whose recipe differs from the applied one is an edit. */
        recheck() {
            for (const id of new Set([...handles].map(h => h.sigId))) {
                const sig = signatures.get(id);
                if (sig) this.recipeChanged(id);
            }
        },

        /** "Update score": apply the held edits now. */
        update(id) {
            const sig = signatures.get(id);
            if (!sig) return false;
            apply(id);
            return true;
        },

        /** The dataset or the cells shown changed: every handle moves to its new key. */
        contextChanged() {
            for (const handle of [...handles]) notifyHandle(handle);
            for (const id of new Set([...handles].map(h => h.sigId))) notifySignature(id);
        },

        /** A dependant came on screen, or left it. */
        visibilityChanged() {
            store.poke();
        },

        status,

        /** @returns {() => void} */
        onSignature(id, fn) {
            if (!signatureListeners.has(id)) signatureListeners.set(id, new Set());
            signatureListeners.get(id).add(fn);
            return () => signatureListeners.get(id).delete(fn);
        },

        handlesOf(id) { return [...handles].filter(h => h.sigId === id); },
        pendingOf: heldOf,

        /** For tests. */
        appliedOf(id) { return applied.get(id) || null; }
    };
}
