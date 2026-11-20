/**
 * A Cell Grouping panel as a derived source: who reads which grouping, what each reader asks of the server, and what
 * must be known upstream first (SHR-31, SHR-33, SHR-34, PER-3, PER-6). The derived sources of utils/derived-sources.js,
 * over the group store of utils/group-store.js, with what is particular to groupings. Pure (no DOM, no page state): the
 * page supplies the panels and what each source of another panel is, through `host`.
 *
 * A consumer's OPTION says what it reads of the groups: `codes` (a plot's colour or axis, a table's column),
 * `features` (a Cell-Gene Plot's genes and scores, each as the request carries it), `histograms` (the panel's own
 * binning controls). Every option of one grouping shares its group table, and each feature is its own entry.
 *
 * A grouping's recipe, as the derived sources see it, is RESOLVED: the normalised recipe with what each factor of
 * another panel stands for now (a table's cells shown that pass it, with their hash; a score's recipe, inline; another
 * grouping's applied recipe). So its key follows PER-3 (the hash of the bitset sent, of the score's recipe, of the
 * upstream grouping), an upstream change is an edit of the grouping, and a rename changes nothing.
 *
 * GATES, in this order, before anything is asked: a cycle through the grouping (SHR-34), a table factor above 1M cells
 * shown (SHR-33), the gate of a table or a score source upstream (the host's: building, ask, refused, failed), and an
 * upstream grouping that has no groups yet (its own state). A grouping used as a factor is watched here as a consumer of
 * kind `grouping`, visible while the grouping that uses it has a consumer on screen, and released with that grouping's
 * last consumer: a chain restores without opening anything, on-screen first (PER-6).
 *
 * NAMES. A level of a grouping used as a factor is a group of that grouping, `g:<key>`, and its name comes from the
 * browser: the upstream reply and its names (PER-3). `namesOf` and `labelsOf` make them once per reply and recipe.
 */
import { createDerivedSources } from './derived-sources.js';
import { normalizeGrouping, groupingHasher, groupNames, serverRequest } from './cell-grouping.js';
import { groupNeed } from './group-store.js';
import { labelledGroups } from './group-reference.js';
import { groupLevelId } from './level-id.js';
import { TABLE_LIMITS } from './table-resolver.js';
import { compactCount } from './coverage.js';
import { stableStringify } from './url-history.js';

/** Groupings nested below one another in a request, the top one included (the server's limit is 4 below it). */
const MAX_DEPTH = 5;

const tooManyCells = (cells) => `A cell table cannot list ${compactCount(cells)} cells. ` +
    `Use a subset of up to ${compactCount(TABLE_LIMITS.ASK_ROWS)} cells, or divide by a column.`;

/**
 * @typedef {Object} GroupHost
 * @property {(id: string) => ({title: string, recipe: () => Object}|null)} panel - a Cell Grouping panel; `recipe()`
 *   is its stored recipe, the same object until it changes
 * @property {() => boolean} [off] - the panel type is turned off here
 * @property {(source: Object, dependant: ?string) => (null|{grouping: string}|{gate: Object, actions?: Object}|
 *   {bitset: () => {flags: ArrayLike<*>, hash: string}}|{recipe: () => {recipe: Object, hash: string}})} upstream
 *   what a factor's source is: null for a column of the dataset; another grouping; a gate while its input cannot be
 *   read (the snapshot's state and fields, with the buttons' `actions`: accept, cancel, retry); a table's cells shown
 *   that pass it (one flag per cell) and their hash; a score's recipe as the request carries it, and its hash. A gate
 *   is asked on every read, so it must be cheap; the bitset and the recipe are read when the recipe is
 * @property {(id: string) => (string[]|null)} cycleOf - the panels on a cycle through this one, or null
 * @property {(id: string) => string} titleOf - a panel's title
 * @property {(id: string) => string} kindOf - a panel's kind, as a cycle notice names a ring
 * @property {(source: Object) => (string|undefined)} sourceTitle - the title of the panel behind a source, for labels
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
    const recipeOf = (raw) => {
        if (!raw || typeof raw !== 'object') return normalizeGrouping(raw).recipe;
        let recipe = normalised.get(raw);
        if (!recipe) normalised.set(raw, recipe = normalizeGrouping(raw).recipe);
        return recipe;
    };
    /** @type {WeakMap<Object, string>} resolved recipe -> the grouping's hash */
    const hashes = new WeakMap();
    /** @type {Map<string, Map<string, Object>>} grouping -> the upstream groupings it watches -> the handle */
    const holds = new Map();

    /** The grouping's hash (PER-3), with each source of another panel hashed by what it stands for. */
    function groupHashOf(resolved) {
        let hash = hashes.get(resolved);
        if (hash === undefined) {
            hash = groupingHasher(resolved.grouping, (source) => resolved.hashes.get(source))(resolved.grouping);
            hashes.set(resolved, hash);
        }
        return hash;
    }

    /**
     * The recipe with what each factor of another panel stands for now. `upstream` maps a source (of this grouping and
     * of the groupings nested in it) to its bitset, its inline recipe or its nested grouping; `hashes` maps this
     * grouping's own sources to their hashes.
     */
    function resolve(id, depth = 1) {
        const panel = host.panel(id);
        const grouping = recipeOf(panel ? panel.recipe() : null);
        const upstream = new Map();
        const own = new Map();
        for (const p of grouping.partitionings) {
            const port = host.upstream(p.source, null);
            if (!port) continue;
            if (port.grouping) {
                if (depth >= MAX_DEPTH || !host.panel(port.grouping)) continue;
                const up = inner.appliedOf(port.grouping) || resolve(port.grouping, depth + 1);
                upstream.set(p.source, { grouping: up.grouping });
                for (const [source, entry] of up.upstream) upstream.set(source, entry);
                own.set(p.source, `g:${groupHashOf(up)}`);
            } else if (port.bitset) {
                const cells = port.bitset();
                upstream.set(p.source, { bitset: cells.flags });
                own.set(p.source, `t:${cells.hash}`);
            } else if (port.recipe) {
                const score = port.recipe();
                upstream.set(p.source, { recipe: score.recipe });
                own.set(p.source, `s:${score.hash}`);
            }
        }
        return { grouping, upstream, hashes: own };
    }

    /** A consumer's option read in a resolved recipe: the store's need. */
    function variantOf(resolved, option) {
        const ctx = {
            bitsetFor: (source) => (resolved.upstream.get(source) || {}).bitset || null,
            inlineRecipe: (source) => {
                const entry = resolved.upstream.get(source);
                if (!entry) return null;
                if (entry.recipe) return { recipe: entry.recipe };
                return entry.grouping ? { grouping: entry.grouping } : null;
            }
        };
        const request = serverRequest(resolved.grouping, ctx, { codes: false, histograms: option.histograms || [] });
        const features = (option.features || []).map((wire) => ({ key: stableStringify(wire), wire }));
        return { recipe: groupNeed({ request, key: groupHashOf(resolved), codes: !!option.codes, features }) };
    }

    /** The upstream grouping `upId` as `id` watches it, made when first needed. */
    function holdOf(id, upId) {
        let mine = holds.get(id);
        if (!mine) holds.set(id, mine = new Map());
        let hold = mine.get(upId);
        if (!hold) {
            hold = inner.watch(upId, {
                consumer: { kind: 'grouping', panelId: id }, option: {},
                visible: () => inner.handlesOf(id).some((h) => h.visible()),
                onChange: (snap) => upstreamChanged(id, upId, snap)
            });
            hold.lastApplied = null;
            hold.hadValues = false;
            mine.set(upId, hold);
        }
        return hold;
    }

    /** The upstream's applied recipe changed, or it has groups now: an edit of the groupings that use it. */
    function upstreamChanged(id, upId, snap) {
        const hold = holds.has(id) ? holds.get(id).get(upId) : null;
        if (!hold) return;
        const applied = inner.appliedOf(upId);
        const has = !!snap.values;
        if (applied === hold.lastApplied && has === hold.hadValues) return;
        hold.lastApplied = applied;
        hold.hadValues = has;
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
            if (!inner.handlesOf(upId).length) releaseHolds(upId);
        }
        if (!mine.size) holds.delete(id);
    }

    /** The gate of grouping `id` for a consumer, and who answers its buttons; null when it can be computed. */
    function gateOf(id, dependant) {
        const cycle = host.cycleOf(id);
        if (cycle) return { gate: { state: 'cycle', cycle: cycle.map(host.titleOf), cycleKinds: cycle.map(host.kindOf) }, actions: null };
        const panel = host.panel(id);
        if (!panel) return null;
        const grouping = recipeOf(panel.recipe());
        const cells = context().cells;
        if (typeof cells === 'number' && cells > TABLE_LIMITS.ASK_ROWS && grouping.partitionings.some((p) => p.source.type === 'table')) {
            return { gate: { state: 'refused', reason: 'table_too_many_cells', cells, message: tooManyCells(cells) }, actions: null };
        }
        const named = new Set();
        let found = null;
        for (const p of grouping.partitionings) {
            const port = host.upstream(p.source, dependant);
            if (!port || found) continue;
            if (port.gate) {
                found = { gate: port.gate, actions: port.actions || null };
            } else if (port.grouping) {
                named.add(port.grouping);
                const hold = holdOf(id, port.grouping);
                const snap = hold.read();
                if (snap.values) continue;
                const gone = snap.state === 'deleted' || snap.state === 'off';
                // the upstream's own state, as it stands: computing, asks first, refused, failed, a gate of its own
                const gate = gone ? { state: 'failed', reason: 'upstream_gone', message: 'the grouping it uses is gone' } : {
                    state: snap.state === 'ready' ? 'computing' : snap.state, progress: snap.progress || null,
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
                const panel = host.panel(id);
                if (!panel) return null;
                return {
                    title: panel.title, kind: 'grouping',
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
            off: () => !!(host.off && host.off())
        },
        context, liveDelayMs, setTimer, clearTimer,
        variantOf,
        hashOf: () => (need) => need.hash,
        editHashOf: (resolved) => groupHashOf(resolved),
        keyOf: ({ hash, dataset, subset }) => `${hash}\u0001${dataset || ''}\u0001${subset || ''}`,
        // a resolved recipe is made afresh by every read of the panel and never edited
        copyOf: (resolved) => resolved,
        countOf: (values) => values.reply.n_shown,
        kind: 'grouping', thing: 'grouping'
    });

    /** Each factor's upstream grouping as it stands, with its names: {names, reply}, or null for a factor that is not one. */
    function upstreamOf(id, recipe) {
        return recipe.partitionings.map((p) => {
            const port = host.upstream(p.source, null);
            const hold = port && port.grouping && holds.has(id) ? holds.get(id).get(port.grouping) : null;
            const snap = hold ? hold.read() : null;
            return snap && snap.values ? { names: namesOf(port.grouping, snap.values.reply), reply: snap.values.reply } : null;
        });
    }

    /** @type {WeakMap<string[], Object>} an upstream grouping's names -> its groups' names as the levels of a factor */
    const levelNames = new WeakMap();
    function asLevels({ names, reply }) {
        let out = levelNames.get(names);
        if (!out) {
            out = {};
            reply.groups.forEach((g, i) => { out[groupLevelId(g.key)] = names[i]; });
            levelNames.set(names, out);
        }
        return out;
    }

    /** @type {WeakMap<Object, {recipe: Object, up: Array, reading: Object, names?: string[], labels?: Object}>} reply -> */
    const readings = new WeakMap();
    /** The reply with the names of its factors that are groupings, for the recipe as it is now. */
    function readingOf(id, reply) {
        const panel = host.panel(id);
        const applied = inner.appliedOf(id);
        const recipe = panel ? recipeOf(panel.recipe()) : applied ? applied.grouping : recipeOf(null);
        const up = upstreamOf(id, recipe);
        const was = readings.get(reply);
        const same = (a, b) => (a ? a.names : null) === (b ? b.names : null);
        if (was && was.recipe === recipe && was.up.length === up.length && was.up.every((u, i) => same(u, up[i]))) return was;
        const reading = { ...reply, partitionings: (reply.partitionings || []).map((p, i) => (up[i] ? { ...p, names: asLevels(up[i]) } : p)) };
        const made = { recipe, up, reading };
        readings.set(reply, made);
        return made;
    }

    function namesOf(id, reply) {
        const made = readingOf(id, reply);
        if (!made.names) made.names = groupNames(made.recipe, made.reading, host.sourceTitle);
        return made.names;
    }

    function labelsOf(id, reply) {
        const made = readingOf(id, reply);
        if (!made.labels) made.labels = labelledGroups(made.recipe, made.reading, host.sourceTitle);
        return made.labels;
    }

    const handle = (h) => {
        const release = h.release;
        h.release = () => {
            release();
            if (!inner.handlesOf(h.id).length) releaseHolds(h.id);
        };
        return h;
    };

    return {
        /**
         * A consumer needs the groups of grouping `id`, read in `option`.
         * @param {string} id
         * @param {{consumer: {kind: string, role?: string, panelId?: ?string, host?: *},
         *   option?: {codes?: boolean, features?: Object[], histograms?: number[]}, visible?: () => boolean,
         *   onChange: (snapshot: Object) => void}} spec - as utils/derived-sources.js `watch`
         */
        watch: (id, spec) => handle(inner.watch(id, spec)),

        /** A grouping, or a panel it uses, was edited (or restored by Back and Forward). */
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
         * The name of each group of a reply (SHR-9), as the grouping is named now: renames and the separator apply at
         * once, and a factor that is a grouping takes its groups' names. Made once per reply and recipe.
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
