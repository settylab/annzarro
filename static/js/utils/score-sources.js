/**
 * Who depends on which source's score (a signature, or a gene table), and what an edit does to them: the derived
 * sources of utils/derived-sources.js, with what is particular to scores. Pure (no DOM, no page state): the page
 * supplies the signatures, the current dataset and subset, and a timer. utils/score-source.js binds it to the page.
 *
 * A consumer's OPTION is the method (`sub`) and the layer it reads: a score is the signature's genes and shared
 * settings read with one method, from one layer. The method belongs to the consumer, not the signature, so an edit is
 * compared over every method. Besides the states of derived-sources.js a score's snapshot can be
 *
 *   nogenes    the signature has no genes
 *   nodown     it has down genes and the consumer's method has no signed version
 *   nolayer    the consumer's layer is not in the dataset (the server's not-found reply)
 */
import { recipeHasher, DEFAULT_METHOD, METHODS, canScoreDown } from './gene-signature.js';
import { scoreKey } from './score-store.js';
import { createDerivedSources } from './derived-sources.js';

/** A recipe copied, so a later edit of the signature cannot change what was applied. */
function copyRecipe(recipe) {
    return { ...recipe, genes: [...recipe.genes], down: [...(recipe.down || [])] };
}

const withMethod = (recipe, sub, layer) => ({ ...recipe, method: sub || DEFAULT_METHOD, input: layer || recipe.input });

/** A signature's recipe read in a consumer's method and layer, and what that asks of the server. */
function variantOf(recipe, { sub, layer }) {
    const scored = withMethod(recipe, sub, layer);
    const down = scored.down ? scored.down.length : 0;
    if (scored.genes.length + down === 0) return { recipe: scored, none: { state: 'nogenes' } };
    // the signature has down genes and this method has no signed version: nothing is asked of the server
    if (down && !canScoreDown(scored.method)) {
        return { recipe: scored, none: { state: 'nodown', method: scored.method, layer: scored.input } };
    }
    return { recipe: scored, fields: { layer: scored.input } };
}

// An edit is a change to any score the signature could give: the genes and every shared setting. The clip only
// reaches the z-score mean and the seed only the control-adjusted score, so the hash covers each method. The gene
// lists are the same under every method and layer, so they are hashed once (`hash`: a recipeHasher).
const editHashOf = (recipe, hash) => METHODS.map(m => hash(withMethod(recipe, m))).join('|');

/** What a consumer counts under in "used by": its method, or its layer (none of its own counts under `null`). */
const USAGE_BY = Object.freeze({ method: (o) => o.sub || DEFAULT_METHOD, layer: (o) => o.layer || null });

/**
 * @typedef {Object} Signatures
 * @property {(id: string) => ({title: string, kind?: string, recipe: () => Object, options?: () => Object,
 *   gate?: (dependant: ?string) => (Object|null), actions?: ({accept: Function, cancel: Function, retry: Function}|null)}|null)} get
 *   A SOURCE is a signature or a gene table (utils/score-source-panels.js). A table whose genes cannot be read yet
 *   (it is being built in the background, waits for a click, is refused, failed or part of a cycle) has a `gate`: its
 *   dependants wait on it, with the table resolver's own states, before any score is asked for.
 * @property {() => boolean} [off] - gene signatures are turned off here
 */

/**
 * @param {Object} options
 * @param {ReturnType<import('./score-store.js').createScoreStore>} options.store
 * @param {Signatures} options.signatures
 * @param {() => {dataset: string, subset: (string|null), cells?: (number|null)}} options.context
 * @param {number} [options.liveDelayMs] - the pause after the last edit
 * @param {Function} [options.setTimer]
 * @param {Function} [options.clearTimer]
 */
export function createScoreSources({ store, signatures, context, liveDelayMs = 350,
    setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t) }) {
    const sources = createDerivedSources({
        store, sources: signatures, context, liveDelayMs, setTimer, clearTimer,
        variantOf, hashOf: recipeHasher, editHashOf, keyOf: scoreKey, copyOf: copyRecipe,
        // a column left over from another source (an obsm dimension) is not a method: nothing is asked for it
        isOption: ({ sub }) => !sub || METHODS.includes(sub),
        failureStates: { key_not_found: 'nolayer' },
        kind: 'signature', thing: 'score'
    });

    // the derived sources under the names the page's score code reads
    return {
        /**
         * A dependant needs the score of signature `id`.
         * @param {string} id
         * @param {{kind: string, onChange: (state: Object) => void, visible?: () => boolean, host?: any, role?: string,
         *   sub?: ?string, layer?: ?string, dependant?: ?string}} spec
         *   `kind`: one of utils/consumer-kinds.js; an unknown or missing kind throws. `role`: the slot in the consumer.
         *   `sub` and `layer`: the method and layer it reads. `dependant`: its panel (a string `host` when not given).
         */
        watch(id, { kind, onChange, visible = () => true, host = null, role = '', sub = null, layer = null, dependant = null }) {
            const panelId = dependant || (typeof host === 'string' ? host : null);
            const handle = sources.watch(id, { consumer: { kind, role, panelId, host }, option: { sub, layer }, visible, onChange });
            // the option's fields as a score's consumers read them (inspect-section.js)
            handle.sub = sub;
            handle.layer = layer;
            return handle;
        },

        /** A signature was edited (or restored by Back and Forward): decide what its dependants do. */
        recipeChanged: sources.sourceChanged,
        recheck: sources.recheck,
        isReady: sources.isReady,
        estimate: sources.estimate,
        /** "Update score": apply the held edits now. */
        update: sources.update,
        contextChanged: sources.contextChanged,
        visibilityChanged: sources.visibilityChanged,
        status: sources.status,
        onSignature: sources.onSource,
        handlesOf: sources.handlesOf,
        consumersOf: sources.consumersOf,
        /** Who uses a source, by the method or by the layer its consumers read. */
        usage(id, by) { return sources.usage(id, USAGE_BY[by]); },
        pendingOf: sources.heldOf,
        appliedOf: sources.appliedOf
    };
}
