/**
 * Sources of groups: who reads which groups, what each reader asks of the server, and what must be known upstream first
 * (SHR-31, SHR-33, SHR-34, PER-3, PER-6). The derived sources of utils/derived-sources.js, over the group store of
 * utils/group-store.js, with what is particular to groups. Pure (no DOM, no page state): the page supplies what each
 * source is, and what each source of another panel stands for, through `host`.
 *
 * A SOURCE is anything made of partitionings, named by an id the page chooses: a Cell Grouping panel, a count plot
 * (its grid), a Cell-Gene Plot's own cell axis. Its SHAPE says how its recipe is read: the normaliser, the sources it
 * reads, its key, and what a consumer's option asks the group store for. `GROUPING` is the Cell Grouping's (and an
 * axis's); `gridShape` in utils/count-plot-model.js is the count plot's. Everything else is the same for every shape:
 *
 * - RESOLVED recipes: the normalised recipe with what each source of another panel stands for now (a table's cells
 *   shown that pass it, with their hash; a score's recipe, inline; another grouping's applied recipe). So a key follows
 *   PER-3 (the hash of the bitset sent, of the score's recipe, of the upstream grouping), an upstream change is an edit
 *   of the source, and a rename changes nothing.
 * - GATES, in this order, before anything is asked: a cycle through the source (SHR-34), a grouping with no factor yet
 *   (`nofactors`, reason 'no_factors'), groupings nested deeper than
 *   the server takes, a table factor above 1M cells shown (SHR-33), the gate of a table or a score source upstream (the
 *   host's: building, ask, refused, failed), and an upstream grouping whose groups for its current recipe are not there
 *   yet (its own state). Behind a gate that is computing, a consumer keeps what it shows.
 * - UPSTREAM GROUPINGS are watched here as consumers of kind `grouping`, visible while the source that uses them has a
 *   consumer on screen, and released with that source's last consumer: a chain restores without opening anything,
 *   on-screen first (PER-6).
 *
 * A consumer's OPTION says what it reads: `codes` (a plot's colour or axis, a table's column), `features` (a Cell-Gene
 * Plot's genes and scores, each as the request carries it), `histograms` (the panel's own binning controls).
 *
 * NAMES. A level of a grouping used as a factor is a group of that grouping, `g:<key>`, and its name comes from the
 * browser: the upstream reply and its names (PER-3). A reply is named by the recipe that MADE it (its factors, their
 * binning), with the renames and the separator as they are now: groups still shown while an edit computes keep their
 * names. `namesOf` and `labelsOf` make them once per reply and recipe.
 */
import { createDerivedSources } from './derived-sources.js';
import { VOCABULARY } from './vocabulary.js';
import { normalizeGrouping, groupingHasher, groupNames, serverRequest, MAX_NESTING } from './cell-grouping.js';
import { groupNeed } from './group-store.js';
import { labelledGroups } from './group-reference.js';
import { groupLevelId } from './level-id.js';
import { TABLE_LIMITS } from './table-resolver.js';
import { compactCount } from './coverage.js';
import { stableStringify } from './url-history.js';

const tooManyCells = (cells) => `A cell table cannot list ${compactCount(cells)} cells. ` +
    `Use a subset of up to ${compactCount(TABLE_LIMITS.ASK_ROWS)} cells, or divide by a column.`;

const TOO_DEEP = `Groupings can use groupings at most ${MAX_NESTING} deep. Use a column of a deeper grouping instead.`;

/**
 * A Cell Grouping's recipe as a source of groups: normalizeGrouping's recipe, its partitionings, its hash, and the
 * request of each option. A Cell-Gene Plot's own cell axis is this shape too, with a recipe of its one factor.
 */
// export-unused-ok: G8a and X3a name the shape of the sources they give the page's group sources
export const GROUPING = Object.freeze({
    normalize: (raw) => normalizeGrouping(raw).recipe,
    sources: (recipe) => recipe.partitionings.map((p) => p.source),
    /** The sources in the order of the reply's partitionings. */
    parts: (resolved) => resolved.recipe.partitionings.map((p) => p.source),
    hash: (resolved, ctx) => groupingHasher(resolved.recipe, ctx.hashOf)(resolved.recipe),
    need(resolved, option, ctx, key) {
        // a panel asks by the positions of its cards, which an edit not yet applied may not have: those are left out
        const histograms = (option.histograms || []).filter((i) => i < resolved.recipe.partitionings.length);
        const features = (option.features || []).map((wire) => ({ key: stableStringify(wire), wire }));
        // made when it is first sent or estimated, not on every comparison of an edit (a table's cells are packed then)
        const request = () => serverRequest(resolved.recipe, ctx, { codes: false, histograms });
        return { recipe: groupNeed({ request, key, histograms, codes: !!option.codes, features }) };
    }
});

/**
 * @typedef {Object} GroupHost
 * @property {(id: string) => ({title: string, kind?: string, recipe: () => Object, shape: Object}|null)} source - a
 *   source of groups: `recipe()` is its stored recipe, the same object until it changes; `shape` is `GROUPING` or a
 *   count plot's `gridShape(...)`; `kind` defaults to 'grouping'
 * @property {(id: string) => boolean} [off] - the type of the panel behind source `id` is turned off here
 * @property {(source: Object, dependant: ?string) => (null|{grouping: string}|{gate: Object, actions?: Object}|
 *   {bitset: () => {flags: ArrayLike<*>, hash: string}}|{recipe: () => {recipe: Object, hash: string}})} upstream
 *   what a factor's source is: null for a column of the dataset; another grouping; a gate while its input cannot be
 *   read (the snapshot's state and fields, with the buttons' `actions`: accept, cancel, retry); a table's cells shown
 *   that pass it (one flag per cell; the same array while the hash is the same, so it is packed once) and their hash;
 *   a score's recipe as the request carries it, and its hash. A gate is asked on every read, so it must be cheap; the
 *   bitset and the recipe are read when the recipe is
 * @property {(id: string) => (string[]|null)} cycleOf - the panels on a cycle through this one, or null
 * @property {(id: string) => string} titleOf - a panel's title
 * @property {(id: string) => string} kindOf - a panel's kind, as a cycle notice names a ring
 * @property {(source: Object) => (string|undefined)} sourceTitle - the title of the panel behind a source, for labels
 * @property {(fn: (panelId: string) => void) => void} [onUpstreamChange] - the page calls `fn(panelId)` whenever a
 *   table or a score panel changes what it stands for (a filter, a build, a score edit, Back and Forward); every
 *   source that reads that panel is then an edit. Groupings upstream are watched here and need no call
 */

/**
 * @param {Object} options
 * @param {ReturnType<import('./group-store.js').createGroupStore>} options.store
 * @param {GroupHost} options.host
 * @param {() => {dataset: string, subset: (string|null), cells?: (number|null)}} options.context
 * @param {number} [options.liveDelayMs]
 * @param {Function} [options.setTimer]
 * @param {Function} [options.clearTimer]
 */
// export-unused-ok: G8a binds the page's groupings to the group store
export function createGroupSources({ store, host, context, liveDelayMs = 350,
    setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t) }) {
    /** @type {WeakMap<Object, Object>} stored recipe -> normalised */
    const normalised = new WeakMap();
    const recipeOf = (src) => {
        const raw = src.recipe();
        if (!raw || typeof raw !== 'object') return src.shape.normalize(raw);
        let recipe = normalised.get(raw);
        if (!recipe) normalised.set(raw, recipe = src.shape.normalize(raw));
        return recipe;
    };
    /** @type {WeakMap<Object, Object>} resolved recipe -> what its request reads of the panels upstream */
    const contexts = new WeakMap();
    /** @type {WeakMap<Object, string>} resolved recipe -> its key */
    const keys = new WeakMap();
    /** @type {Map<string, Map<string, Object>>} source -> the upstream groupings it watches -> the handle */
    const holds = new Map();
    /** @type {Set<string>} sources with a consumer or a hold */
    const watched = new Set();

    /** What a request of `resolved` reads of the panels upstream: their cells, their recipes, their hashes. */
    function ctxOf(resolved) {
        let ctx = contexts.get(resolved);
        if (!ctx) {
            ctx = {
                bitsetFor: (source) => (resolved.upstream.get(source) || {}).bitset || null,
                inlineRecipe: (source) => {
                    const entry = resolved.upstream.get(source);
                    if (!entry) return null;
                    if (entry.recipe) return { recipe: entry.recipe };
                    return entry.grouping ? { grouping: entry.grouping } : null;
                },
                hashOf: (source) => resolved.hashes.get(source)
            };
            contexts.set(resolved, ctx);
        }
        return ctx;
    }

    /** The key of a resolved recipe (PER-3), with each source of another panel hashed by what it stands for. */
    function keyOf(resolved) {
        let key = keys.get(resolved);
        if (key === undefined) keys.set(resolved, key = resolved.shape.hash(resolved, ctxOf(resolved)));
        return key;
    }

    /**
     * The recipe with what each source of another panel stands for now. `upstream` maps a source (of this recipe and of
     * the groupings nested in it) to its bitset, its inline recipe or its nested grouping; `hashes` maps this recipe's
     * own sources to their hashes; `depth` counts the groupings in a request, this one included.
     */
    function resolve(id, seen = new Set([id])) {
        const src = host.source(id);
        const shape = src ? src.shape : GROUPING;
        const recipe = src ? recipeOf(src) : GROUPING.normalize(null);
        const upstream = new Map();
        const own = new Map();
        let depth = 1;
        for (const source of shape.sources(recipe)) {
            const port = host.upstream(source, null);
            if (!port) continue;
            if (port.grouping) {
                // a cycle is a gate before anything is resolved
                if (seen.has(port.grouping) || !host.source(port.grouping)) continue;
                const up = inner.appliedOf(port.grouping) || resolve(port.grouping, new Set([...seen, port.grouping]));
                upstream.set(source, { grouping: up.recipe });
                for (const [s, entry] of up.upstream) upstream.set(s, entry);
                own.set(source, `g:${keyOf(up)}`);
                depth = Math.max(depth, up.depth + 1);
            } else if (port.bitset) {
                const cells = port.bitset();
                upstream.set(source, { bitset: cells.flags });
                own.set(source, `t:${cells.hash}`);
            } else if (port.recipe) {
                const score = port.recipe();
                upstream.set(source, { recipe: score.recipe });
                own.set(source, `s:${score.hash}`);
            }
        }
        return { shape, recipe, upstream, hashes: own, depth };
    }

    /** The groupings a request of `id` would carry, itself included, as resolve counts them: no bitset is read. */
    function depthOf(id, seen, top) {
        const applied = top ? null : inner.appliedOf(id);
        if (applied) return applied.depth;
        const src = host.source(id);
        if (!src) return 1;
        let depth = 1;
        for (const source of src.shape.sources(recipeOf(src))) {
            const port = host.upstream(source, null);
            if (!port || !port.grouping || seen.has(port.grouping)) continue;
            depth = Math.max(depth, 1 + depthOf(port.grouping, new Set([...seen, port.grouping]), false));
        }
        return depth;
    }

    /** A consumer's option read in a resolved recipe: the store's need, or the state of an option that asks nothing. */
    function variantOf(resolved, option) {
        const v = resolved.shape.need(resolved, option, ctxOf(resolved), keyOf(resolved));
        return v.none ? { recipe: null, none: v.none, hash: `none\u0001${stableStringify(v.none)}` } : { recipe: v.recipe, hash: v.recipe.hash };
    }

    /** The upstream grouping `upId` as `id` watches it, made when first needed. */
    function holdOf(id, upId) {
        let mine = holds.get(id);
        if (!mine) holds.set(id, mine = new Map());
        let hold = mine.get(upId);
        if (!hold) {
            hold = noting(upId, inner.watch(upId, {
                consumer: { kind: 'grouping', panelId: id }, option: {},
                visible: () => inner.handlesOf(id).some((h) => h.visible()),
                onChange: (snap) => upstreamChanged(id, upId, snap)
            }));
            hold.lastApplied = null;
            hold.lastReply = null;
            mine.set(upId, hold);
            watched.add(upId);
        }
        return hold;
    }

    /** The upstream's applied recipe changed, or its reply did: an edit of the sources that use it, or new names. */
    function upstreamChanged(id, upId, snap) {
        const hold = holds.has(id) ? holds.get(id).get(upId) : null;
        if (!hold) return;
        const applied = inner.appliedOf(upId);
        const reply = snap.state === 'ready' && snap.values ? snap.values.reply : null;
        if (applied === hold.lastApplied && reply === hold.lastReply) return;
        hold.lastApplied = applied;
        hold.lastReply = reply;
        inner.sourceChanged(id);
    }

    /** Release what `id` watches upstream, and so on up the chain for what is then watched by no one. */
    function releaseHolds(id, keep = null) {
        const mine = holds.get(id);
        if (!mine) return;
        for (const [upId, hold] of [...mine]) {
            if (keep && keep.has(upId)) continue;
            mine.delete(upId);
            hold.release();
            if (!inner.handlesOf(upId).length) { watched.delete(upId); releaseHolds(upId); }
        }
        if (!mine.size) holds.delete(id);
    }

    /** The gate of source `id` for a consumer, and who answers its buttons; null when it can be computed. */
    function gateOf(id, dependant) {
        const cycle = host.cycleOf(id);
        if (cycle) return { gate: { state: 'cycle', cycle: cycle.map(host.titleOf), cycleKinds: cycle.map(host.kindOf) }, actions: null };
        const src = host.source(id);
        if (!src) return null;
        // a grouping with no factor yet (a new one): there is nothing to ask the server, so nothing is asked
        if (src.shape === GROUPING && !src.shape.sources(recipeOf(src)).length) {
            return { gate: { state: 'nofactors', reason: 'no_factors' }, actions: null };
        }
        if (depthOf(id, new Set([id]), true) > MAX_NESTING + 1) {
            return { gate: { state: 'refused', reason: 'nested_too_deep', message: TOO_DEEP }, actions: null };
        }
        const sources = src.shape.sources(recipeOf(src));
        const cells = context().cells;
        if (typeof cells === 'number' && cells > TABLE_LIMITS.ASK_ROWS && sources.some((s) => s.type === 'table')) {
            return { gate: { state: 'refused', reason: 'table_too_many_cells', cells, message: tooManyCells(cells) }, actions: null };
        }
        const named = new Set();
        let found = null;
        for (const source of sources) {
            const port = host.upstream(source, dependant);
            if (!port || found) continue;
            if (port.gate) {
                found = { gate: port.gate, actions: port.actions || null };
            } else if (port.grouping) {
                named.add(port.grouping);
                const hold = holdOf(id, port.grouping);
                const snap = hold.read();
                // the upstream's groups for its current recipe: until they are there, its names could not be given
                if (snap.state === 'ready' && snap.values) continue;
                const gone = snap.state === 'deleted' || snap.state === 'off';
                // the upstream's own state, as it stands: computing, asks first, refused, failed, a gate of its own (one
                // that has no factor is said as the upstream's, not as this grouping's)
                const gate = gone ? { state: 'failed', reason: 'upstream_gone', message: 'the grouping it uses is gone' }
                    : snap.state === 'nofactors' ? { state: 'failed', reason: 'upstream_no_factors', message: VOCABULARY.phrase.noFactors('the grouping it uses') } : {
                    state: snap.state === 'ready' || snap.state === 'updating' ? 'computing' : snap.state, progress: snap.progress || null,
                    estimate: snap.estimate || null, message: snap.message || null, reason: snap.reason || null,
                    ...(snap.cycle ? { cycle: snap.cycle, cycleKinds: snap.cycleKinds } : {})
                };
                found = { gate, actions: { accept: () => hold.compute(), cancel: () => hold.cancel(), retry: () => hold.retry() } };
            }
        }
        // the upstream groupings no longer named are no longer watched
        if (!found) releaseHolds(id, named);
        return found;
    }

    const inner = createDerivedSources({
        store,
        sources: {
            get(id) {
                const src = host.source(id);
                if (!src) return null;
                return {
                    title: src.title, kind: src.kind || 'grouping',
                    recipe: () => resolve(id),
                    gate: (dependant) => {
                        const found = gateOf(id, dependant);
                        return found ? found.gate : null;
                    },
                    // the buttons of a gate notice: whoever holds the gate now
                    actions: {
                        accept: () => { const found = gateOf(id, null); if (found && found.actions) found.actions.accept(); },
                        cancel: () => { const found = gateOf(id, null); if (found && found.actions) found.actions.cancel(); },
                        retry: () => { const found = gateOf(id, null); if (found && found.actions) found.actions.retry(); }
                    }
                };
            },
            off: (id) => !!(host.off && host.off(id))
        },
        context, liveDelayMs, setTimer, clearTimer,
        // a resolved recipe is made afresh by every read of the source and never edited, and each variant has its hash
        variantOf,
        editHashOf: (resolved) => keyOf(resolved),
        keyOf: ({ hash, dataset, subset }) => `${hash}\u0001${dataset || ''}\u0001${subset || ''}`,
        countOf: (values) => values.reply.n_shown,
        kind: 'grouping', thing: 'grouping'
    });

    if (host.onUpstreamChange) {
        host.onUpstreamChange((panelId) => {
            for (const id of [...watched]) {
                const src = host.source(id);
                if (src && src.shape.sources(recipeOf(src)).some((s) => s.key === panelId)) inner.sourceChanged(id);
            }
        });
    }

    // --- names --------------------------------------------------------------------------------------------------

    /** @type {WeakMap<Object, {resolved: Object, up: Array<?{id: string, reply: Object}>}>} reply -> what made it */
    const made = new WeakMap();

    /** Each part's upstream grouping and its reply as `id` reads it now, or null for a part that is not one. */
    function upstreamReplies(id, resolved) {
        return resolved.shape.parts(resolved, ctxOf(resolved)).map((source) => {
            const port = host.upstream(source, null);
            const hold = port && port.grouping && holds.has(id) ? holds.get(id).get(port.grouping) : null;
            const snap = hold ? hold.read() : null;
            return snap && snap.state === 'ready' && snap.values ? { id: port.grouping, reply: snap.values.reply } : null;
        });
    }

    /**
     * A reply read ready is the applied recipe's, with the upstream replies of that moment (an upstream not ready
     * gates): what made it, kept for as long as the reply is.
     */
    function note(id, snap) {
        if (!snap || snap.state !== 'ready' || !snap.values || !snap.values.reply || made.has(snap.values.reply)) return;
        const resolved = inner.appliedOf(id);
        if (resolved) made.set(snap.values.reply, { resolved, up: upstreamReplies(id, resolved) });
    }

    /** A handle whose ready reads say what made their reply. */
    function noting(id, h) {
        const read = h.read;
        h.read = () => {
            const snap = read();
            note(id, snap);
            return snap;
        };
        return h;
    }

    /** @type {WeakMap<string[], Object>} an upstream grouping's names -> its groups' names as the levels of a factor */
    const levelNames = new WeakMap();
    function asLevels(names, reply) {
        let out = levelNames.get(names);
        if (!out) {
            out = {};
            reply.groups.forEach((g, i) => { out[groupLevelId(g.key)] = names[i]; });
            levelNames.set(names, out);
        }
        return out;
    }

    const factorBody = (p) => stableStringify({ source: p.source, levels: p.levels || null, rest: p.rest || 'other', binning: p.binning || null });

    /** The recipe that made a reply, with the renames and the separator of the recipe as it is now. */
    function namedRecipe(structure, live) {
        if (!live || structure === live) return structure;
        const twins = new Map(live.partitionings.map((p) => [factorBody(p), p]));
        const partitionings = structure.partitionings.map((p) => {
            const twin = twins.get(factorBody(p));
            if (!twin || twin.labels === p.labels) return p;
            const out = { ...p, labels: twin.labels };
            if (!twin.labels) delete out.labels;
            return out;
        });
        const out = { ...structure, partitionings };
        if (live.separator === undefined) delete out.separator; else out.separator = live.separator;
        return out;
    }

    /** @type {WeakMap<Object, Object>} reply -> its reading: {live, upNames, recipe, reading, names?, labels?} */
    const readings = new WeakMap();
    /** The reply with the names of its parts that are groupings, and the recipe that names it, as things are now. */
    function readingOf(id, reply) {
        const src = host.source(id);
        const by = made.get(reply) || (() => {
            const resolved = inner.appliedOf(id) || resolve(id);
            return { resolved, up: upstreamReplies(id, resolved) };
        })();
        const live = src && src.shape === by.resolved.shape ? recipeOf(src) : null;
        const upNames = by.up.map((u) => (u ? namesOf(u.id, u.reply) : null));
        const was = readings.get(reply);
        if (was && was.live === live && was.upNames.length === upNames.length && was.upNames.every((n, i) => n === upNames[i])) return was;
        const field = Array.isArray(reply.partitionings) ? 'partitionings' : 'axes';
        const reading = { ...reply, [field]: (reply[field] || []).map((p, i) => (upNames[i] ? { ...p, names: asLevels(upNames[i], by.up[i].reply) } : p)) };
        const out = { live, upNames, recipe: namedRecipe(by.resolved.recipe, live), reading };
        readings.set(reply, out);
        return out;
    }

    function namesOf(id, reply) {
        const r = readingOf(id, reply);
        if (!r.names) r.names = groupNames(r.recipe, r.reading, host.sourceTitle);
        return r.names;
    }

    function labelsOf(id, reply) {
        const r = readingOf(id, reply);
        if (!r.labels) r.labels = labelledGroups(r.recipe, r.reading, host.sourceTitle);
        return r.labels;
    }

    return {
        /**
         * A consumer needs the groups of source `id`, read in `option`.
         * @param {string} id
         * @param {{consumer: {kind: string, role?: string, panelId?: ?string, host?: *},
         *   option?: {codes?: boolean, features?: Object[], histograms?: number[]}, visible?: () => boolean,
         *   onChange: (snapshot: Object) => void}} spec - as utils/derived-sources.js `watch`; the handle's
         *   `setOption(option)` reads another option and keeps what it shows meanwhile
         */
        watch(id, spec) {
            const onChange = spec.onChange;
            const h = noting(id, inner.watch(id, { ...spec, onChange: (snap) => { note(id, snap); onChange(snap); } }));
            watched.add(id);
            const release = h.release;
            h.release = () => {
                release();
                if (!inner.handlesOf(id).length) { watched.delete(id); releaseHolds(id); }
            };
            return h;
        },

        /** A source, or a grouping it uses, was edited (or restored by Back and Forward). */
        sourceChanged: inner.sourceChanged,
        recheck: inner.recheck,
        isReady: inner.isReady,
        estimate: inner.estimate,
        /** "Update groups": apply the held edits now. */
        update: inner.update,
        contextChanged: inner.contextChanged,
        visibilityChanged: inner.visibilityChanged,
        status: inner.status,
        onSource: inner.onSource,
        handlesOf: inner.handlesOf,
        consumersOf: inner.consumersOf,
        heldOf: inner.heldOf,

        /**
         * A reply with the names of its parts that are groupings (`names`: level id -> name, on each of its
         * partitionings or a grid's axes), for a consumer that labels the levels itself (a count plot). Made once per
         * reply and upstream names.
         * @param {string} id
         * @param {Object} reply - a snapshot's `values.reply`
         */
        replyOf: (id, reply) => readingOf(id, reply).reading,

        /**
         * The name of each group of a reply (SHR-9): the groups as the recipe that made them made them, named with the
         * renames and the separator as they are now; a factor that is a grouping takes its groups' names. Made once
         * per reply and recipe.
         * @param {string} id
         * @param {Object} reply - a snapshot's `values.reply`
         * @returns {string[]}
         */
        namesOf,

        /**
         * The groups of a reply by key with their default labels, for a consumer that names one group
         * (utils/group-reference.js). Made once per reply and recipe.
         */
        labelsOf
    };
}
