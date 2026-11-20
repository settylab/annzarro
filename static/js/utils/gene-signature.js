/**
 * The recipe of a gene signature, and the pure parts of building its gene list.
 * No DOM and no page state, so Node tests cover all of it.
 *
 * A SIGNATURE is a named recipe: genes plus how to score them. The recipe is
 * what a link, a panel set and a history entry carry, as configuration only:
 * never a computed score and never the table of genes it came from. It has the
 * shape the score route takes (POST /api/v1/data/gene_score, core/gene_score.py):
 *
 *     {genes, down, input, method, clip, seed, version}
 *
 * `genes` are kept sorted by name and without duplicates, so equal lists are
 * equal text in a link and under the hash. The title is not part of the recipe:
 * renaming a signature changes nothing a score depends on.
 */
import { setHash, stableStringify } from '../panels/gene-set-utilities/state.js';
import {
    METHODS, DEFAULT_METHOD, DOWN_METHODS, DOWN_WEIGHTS, DEFAULT_DOWN_WEIGHT, WEIGHTED_METHODS, cleanDownWeight, canScoreDown, paramsOf, methodInfo, normalizeOptions,
    DEFAULT_CLIP, DEFAULT_INPUT, DEFAULT_SEED, DEFAULT_BINS, DEFAULT_CONTROLS, BINS_RANGE, CONTROLS_RANGE, MAX_SEED,
    parseClipText, parseSeedText, parseWholeText, parseThresholdText, cleanWhole, cleanThreshold, cleanClip
} from './signature-options.js';

export {
    METHODS, DEFAULT_METHOD, DOWN_METHODS, DOWN_WEIGHTS, DEFAULT_DOWN_WEIGHT, WEIGHTED_METHODS, cleanDownWeight, canScoreDown, DEFAULT_CLIP, DEFAULT_INPUT, DEFAULT_SEED, DEFAULT_BINS, DEFAULT_CONTROLS, BINS_RANGE, CONTROLS_RANGE,
    MAX_SEED, parseClipText, parseSeedText, parseWholeText, parseThresholdText, cleanWhole, cleanThreshold, cleanClip
};

/** The score's algorithm version (the server's ALGORITHM_VERSION). */
export const RECIPE_VERSION = 1;

/** Names in the order the lists and links keep them: by code point, so no locale changes a link. */
export function compareNames(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A list of gene names as the recipe keeps it: text only, no empty name, no
 * duplicate, sorted.
 * @param {*} value
 * @returns {string[]}
 */
export function cleanNames(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    for (const name of value) {
        if (typeof name === 'string' && name !== '') seen.add(name);
    }
    return [...seen].sort(compareNames);
}

/**
 * The recipe a saved config (a link, a panel set, an older version) describes.
 * Anything missing or invalid takes its default, so a hand-edited link still
 * opens. A gene on both sides counts as an up gene (the design's rule). There is no
 * limit on the number of genes: the cost estimate is the only guard.
 * @param {Object} [raw]
 * @returns {{recipe: Object, notes: string[]}}
 */
export function normalizeRecipe(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const notes = [];
    const genes = cleanNames(src.genes);
    let down = cleanNames(src.down);
    const up = new Set(genes);
    const both = down.filter(name => up.has(name));
    if (both.length) {
        down = down.filter(name => !up.has(name));
        notes.push(`${both.length} gene${both.length === 1 ? ' was' : 's were'} on both sides and now count as up.`);
    }
    return { recipe: { genes, down, ...normalizeSettings(src, down.length > 0) }, notes };
}

/**
 * The settings of a recipe, everything but its two gene lists, every one valid. A change of settings alone uses this,
 * so the lists (already clean and sorted) are not walked and sorted again.
 * @param {Object} src - a saved config or a recipe
 * @param {boolean} hasDown - the recipe has down genes
 */
export function normalizeSettings(src, hasDown) {
    return {
        down_weight: cleanDownWeight(src.down_weight),
        // how to score and what to offer: one schema, shared with the gene table (utils/signature-options.js)
        ...normalizeOptions(src),
        // the panel's own switch (Score some genes as down): on whenever there are down genes, and kept on when
        // it was left on with none. Not a score setting: it is in no cache key and not sent to the server.
        directions: src.directions === true || hasDown,
        version: RECIPE_VERSION
    };
}

/**
 * The body's `recipe` for the score route: exactly its fields, no title.
 * @param {Object} recipe - from normalizeRecipe
 * @returns {{genes: string[], down: string[], input: string, method: string, clip: (number|null), seed: (number|null), version: number}}
 */
export function serverRecipe(recipe) {
    return {
        genes: [...recipe.genes], down: [...recipe.down], input: recipe.input, method: recipe.method,
        clip: recipe.clip, seed: recipe.seed, bins: recipe.bins, controls: recipe.controls,
        detect_above: recipe.detect_above, version: recipe.version, down_weight: cleanDownWeight(recipe.down_weight)
    };
}

/**
 * The recipe as a link, a panel set and a history entry carry it: the score route's fields and the panel's
 * own (which methods and layers are offered to consumers). Configuration only.
 */
export function storedRecipe(recipe) {
    const stored = { ...serverRecipe(recipe), offered: [...recipe.offered], layers: [...recipe.layers] };
    // the default is not written: a link without it means each gene weighs equally
    if (stored.down_weight === DEFAULT_DOWN_WEIGHT) delete stored.down_weight;
    if (recipe.directions) stored.directions = true;          // absent when off: a link without down genes is what it was
    return stored;
}

/**
 * What the score depends on, as text. Equal recipes give equal keys, and a
 * change that cannot change a number does not change the key: the order of the
 * genes, a title, the clip of any method but the z-score mean (only it clips)
 * and the seed of any method but the control-adjusted one; no seed is seed 0.
 * @param {Object} recipe - from normalizeRecipe
 * @returns {string}
 */
export function recipeHash(recipe) {
    return hashWith(recipe, { up: setHash(recipe.genes), down: setHash(recipe.down) });
}

/**
 * recipeHash for variants of one recipe that keep its gene lists (another method, layer or parameter): the lists are
 * walked once, however many variants are hashed. `recipeHasher(r)(v) === recipeHash(v)` for such a variant `v`.
 * @param {Object} recipe
 * @returns {(variant: Object) => string}
 */
export function recipeHasher(recipe) {
    const sets = { up: setHash(recipe.genes), down: setHash(recipe.down) };
    return (variant) => hashWith(variant, sets);
}

function hashWith(recipe, sets) {
    const params = paramsOf(recipe, recipe.method);        // only what this method reads: the others change no number
    return stableStringify({
        v: recipe.version,
        input: recipe.input,
        method: recipe.method,
        clip: 'clip' in params ? params.clip : null,
        seed: 'seed' in params ? params.seed : null,
        bins: 'bins' in params ? params.bins : null,
        controls: 'controls' in params ? params.controls : null,
        detect_above: 'detect_above' in params ? params.detect_above : null,
        up: sets.up,
        down: sets.down,
        // only where it changes a number: the two means with down genes
        ...(effectiveDownWeight(recipe, recipe.method) ? { dw: effectiveDownWeight(recipe, recipe.method) } : {})
    });
}

/** 'gene' or 'side' when `method` of `recipe` has a weighting (the two means, with down genes), else null. */
export function effectiveDownWeight(recipe, method) {
    return recipe.down && recipe.down.length && WEIGHTED_METHODS.includes(method) ? cleanDownWeight(recipe.down_weight) : null;
}

/**
 * A method's definition when the signature has down genes: the formula in plain words, with the weighting in force.
 * @returns {string} '' when there is nothing to add (no down genes, or a method with no signed version)
 */
export function downDefinition(recipe, method) {
    if (!recipe.down || !recipe.down.length || !canScoreDown(method)) return '';
    if (method === 'control_adjusted') return 'Up genes minus their controls, less down genes minus their own controls. Each side takes its own controls, so there is no weighting to choose.';
    const what = method === 'zscore_mean' ? 'z-scores' : 'values';
    return effectiveDownWeight(recipe, method) === 'side'
        ? `Mean of the up genes' ${what} minus the mean of the down genes' ${what}: each side weighs equally.`
        : `Up genes' ${what} minus down genes' ${what}, averaged over all genes: each gene weighs equally.`;
}

// ---------------------------------------------------------------------------
// Up and down genes

/** Every gene of the signature, up and down, sorted by name (the Selected view's rows). */
export function selectedNames(recipe) {
    return recipe.down.length ? mergeSorted(recipe.genes, recipe.down) : recipe.genes;
}

/**
 * Set the direction of genes already in the signature. Pure: says what would happen.
 * @param {{genes: string[], down: string[]}} recipe
 * @param {Iterable<string>} names - genes to set; those not in the signature are ignored
 * @param {'up'|'down'} direction
 * @returns {{genes: string[], down: string[], changed: string[], same: number}}
 *   `changed` are the names that moved; `same` how many already had the direction
 */
export function planDirection(recipe, names, direction) {
    const target = direction === 'down' ? 'down' : 'up';
    const from = target === 'up' ? recipe.down : recipe.genes;       // the side a gene would leave
    const leaving = new Set(from);
    const there = new Set(target === 'up' ? recipe.genes : recipe.down);
    const move = new Set();
    let same = 0;
    for (const name of new Set(names)) {
        if (there.has(name)) same++;
        else if (leaving.has(name)) move.add(name);
    }
    if (!move.size) return { genes: recipe.genes, down: recipe.down, changed: [], same };
    const stay = from.filter(n => !move.has(n));
    const moved = [...move].sort(compareNames);
    return {
        genes: target === 'up' ? mergeSorted(recipe.genes, moved) : stay,
        down: target === 'up' ? stay : mergeSorted(recipe.down, moved),
        changed: moved, same
    };
}

/**
 * Add genes on one side. Pure: says what would happen, the caller applies it. A gene already in the signature (either
 * side) is left where it is, and there is no limit on the length of a list.
 * @param {{genes: string[], down: string[]}} recipe
 * @param {Iterable<string>} incoming
 * @param {'up'|'down'} direction
 * @returns {{genes: string[], down: string[], added: string[], already: number}}
 */
export function planAddAs(recipe, incoming, direction) {
    const have = new Set([...recipe.genes, ...recipe.down]);
    const fresh = [];
    let already = 0;
    for (const name of new Set(incoming)) {
        if (typeof name !== 'string' || name === '') continue;
        if (have.has(name)) already++;
        else fresh.push(name);
    }
    const added = fresh.sort(compareNames);
    return direction === 'down'
        ? { genes: recipe.genes, down: mergeSorted(recipe.down, added), added, already }
        : { genes: mergeSorted(recipe.genes, added), down: recipe.down, added, already };
}

/** "42 up, 8 down" when there are down genes, else ''. */
export function directionCounts(recipe) {
    return recipe.down.length ? `${fmtCount(recipe.genes.length)} up, ${fmtCount(recipe.down.length)} down` : '';
}

/**
 * The formula in plain words, for Scores offered, with the weighting in force (the z-score mean and the mean have one;
 * control-adjusted is always by side). Empty when the signature has no down genes (nothing to say).
 * @param {Object} recipe - from normalizeRecipe
 */
export function directionFormula(recipe) {
    if (!recipe.down.length) return '';
    if (!recipe.genes.length) return 'All genes are down, so the score is the negative of their average.';
    const up = recipe.genes.length, down = recipe.down.length;
    const side = (n, name) => `the ${fmtCount(n)} ${name} gene${n === 1 ? '' : 's'}`;
    const formula = cleanDownWeight(recipe.down_weight) === 'side'
        ? `Score = average of ${side(up, 'up')} minus average of ${side(down, 'down')}: each side weighs equally.`
        : `Score = ${side(up, 'up')} minus ${side(down, 'down')}, averaged over ${up + down === 2 ? 'both' : `all ${fmtCount(up + down)}`} genes: each gene weighs equally.`;
    return `${formula} Control-adjusted takes each side minus its own control genes.`;
}

/** How one option is computed, in words: Inspect states it for the option it shows. */
export function definitionText(recipe) {
    if (recipe.method === 'mean') return `Mean of ${recipe.input}`;
    if (recipe.method === 'control_adjusted') return `Control-adjusted mean of ${recipe.input}, seed ${recipe.seed === null ? DEFAULT_SEED : recipe.seed}`;
    if (recipe.method !== 'zscore_mean') return `${(methodInfo(recipe.method) || { label: recipe.method }).label} of ${recipe.input}`;
    const clip = recipe.clip === null ? 'not clipped' : `clipped at ±${recipe.clip}`;
    return `Z-score mean of ${recipe.input}, ${clip}`;
}

/** Number with thousands separators, in the same form everywhere in the panel. */
export function fmtCount(n) {
    return Number(n).toLocaleString('en-US');
}

/** Two sorted lists of distinct names, merged (the shorter list walked once). */
export function mergeSorted(a, b) {
    if (!b.length) return a;
    const out = [];
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
        const c = compareNames(a[i], b[j]);
        if (c < 0) out.push(a[i++]);
        else if (c > 0) out.push(b[j++]);
        else { out.push(a[i++]); j++; }
    }
    while (i < a.length) out.push(a[i++]);
    while (j < b.length) out.push(b[j++]);
    return out;
}

/**
 * Names matching a search. The box text is plain text unless Regex is on;
 * matching ignores case unless Match case is on. An empty box matches every
 * name. An invalid pattern is not an error to throw: the caller keeps its last
 * results and says so.
 * @param {ArrayLike<string>} names
 * @param {string} query
 * @param {{regex?: boolean, matchCase?: boolean}} [opts]
 * @returns {{error: string|null, indices: number[]|null}} `indices` into `names`; null for "every name"
 */
export function searchNames(names, query, { regex = false, matchCase = false } = {}) {
    if (!query) return { error: null, indices: null };
    let test;
    if (regex) {
        let re;
        try {
            re = new RegExp(query, matchCase ? '' : 'i');
        } catch {
            return { error: 'Not a valid pattern', indices: null, invalid: true };
        }
        test = (name) => re.test(name);
    } else if (matchCase) {
        test = (name) => name.includes(query);
    } else {
        const q = query.toLowerCase();
        test = (name) => name.toLowerCase().includes(q);
    }
    const indices = [];
    for (let i = 0; i < names.length; i++) if (test(names[i])) indices.push(i);
    return { error: null, indices };
}

/**
 * The gene Enter in the search box ticks: the name equal to the query (the
 * only one, case as the toggle says), else the only match; none when several
 * match and none is exact.
 * @param {ArrayLike<string>} names - the names shown
 * @param {string} query
 * @param {{matchCase?: boolean}} [opts]
 * @returns {string|null}
 */
export function enterTarget(names, query, { matchCase = false } = {}) {
    if (!query || !names.length) return null;
    const same = (a, b) => (matchCase ? a === b : a.toLowerCase() === b.toLowerCase());
    const exact = [];
    for (let i = 0; i < names.length; i++) if (same(names[i], query)) exact.push(names[i]);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;
    return names.length === 1 ? names[0] : null;
}

/**
 * The steps that undo a list change. Every change of the list is one step with
 * the list as it was; undoing restores it. Single ticks made in quick
 * succession are one step (a tick batch).
 */
export class UndoStack {
    /**
     * @param {{max?: number, coalesceMs?: number}} [opts]
     */
    constructor({ max = 50, coalesceMs = 1500 } = {}) {
        this.max = max;
        this.coalesceMs = coalesceMs;
        this.steps = [];
        this._lastTick = 0;
    }

    /**
     * @param {string} label - "add 42 genes from DE genes"
     * @param {string[]} before - the list before the change
     * @param {{tick?: boolean, now?: number, down?: string[]}} [opts] - `tick`: a single tick, joins the step before it when
     *   close in time; `down`: the down genes before the change (kept with the step, so undo restores both sides)
     */
    push(label, before, { tick = false, now = Date.now(), down = null } = {}) {
        const last = this.steps[this.steps.length - 1];
        if (tick && last && last.tick && now - this._lastTick <= this.coalesceMs) {
            last.count++;
            last.label = `change ${last.count} genes`;
            this._lastTick = now;
            return;
        }
        this.steps.push({ label, before: [...before], down: down ? [...down] : null, tick, count: 1 });
        if (this.steps.length > this.max) this.steps.shift();
        this._lastTick = tick ? now : 0;
    }

    /** The step undo would undo, or null. */
    peek() {
        return this.steps.length ? this.steps[this.steps.length - 1] : null;
    }

    /** Take the last step off; its `before` is the list to restore. */
    pop() {
        this._lastTick = 0;
        return this.steps.pop() || null;
    }

    get size() {
        return this.steps.length;
    }

    clear() {
        this.steps.length = 0;
        this._lastTick = 0;
    }
}

/**
 * The names of a gene table's selection, in the form the panel adds. Reads the
 * table as a consumer does (gene-set-utilities/state.js readTableSelection),
 * so a table open or closed gives its passing genes.
 * @param {Array<string>} passing
 * @param {Set<string>} inDataset
 * @returns {{names: string[], outside: number}} the names that are in the dataset, and how many were not
 */
export function inDatasetNames(passing, inDataset) {
    const names = [];
    let outside = 0;
    for (const name of passing || []) {
        if (inDataset.has(name)) names.push(name);
        else outside++;
    }
    return { names, outside };
}
