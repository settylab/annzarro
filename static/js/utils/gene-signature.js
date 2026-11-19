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

/** Most genes a signature holds (up genes and down genes together), as the server's MAX_GENES. */
export const GENE_LIMIT = 2000;

/** The score's algorithm version (the server's ALGORITHM_VERSION). */
export const RECIPE_VERSION = 1;

/** Methods the server computes: the aggregations a consumer can choose (level 3 of the `gene-score` source). */
export const METHODS = ['zscore_mean', 'mean', 'control_adjusted'];

export const DEFAULT_METHOD = 'zscore_mean';
export const DEFAULT_CLIP = 10;
export const DEFAULT_INPUT = 'X';
/** The seed a control-adjusted score without one means (the server's DEFAULT_SEED). */
export const DEFAULT_SEED = 0;
/** Largest seed the page accepts: whole numbers the browser holds exactly (the server takes up to 2^63 - 1). */
export const MAX_SEED = Number.MAX_SAFE_INTEGER;

/**
 * A clip typed into the panel: a number above 0 (any size, `1e3` included).
 * @param {string} text
 * @returns {{ok: true, value: number} | {ok: false, error: string}}
 */
export function parseClipText(text) {
    const trimmed = String(text === undefined || text === null ? '' : text).trim();
    const value = trimmed === '' ? NaN : Number(trimmed);
    if (!Number.isFinite(value) || value <= 0) return { ok: false, error: 'Enter a number above 0.' };
    return { ok: true, value };
}

/**
 * A seed typed into the panel: a whole number from 0 up.
 * @param {string} text
 * @returns {{ok: true, value: number} | {ok: false, error: string}}
 */
export function parseSeedText(text) {
    const trimmed = String(text === undefined || text === null ? '' : text).trim();
    const value = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
    if (!Number.isSafeInteger(value)) return { ok: false, error: 'Enter a whole number from 0 up.' };
    return { ok: true, value };
}

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

/** A clip as the recipe keeps it: a finite number above 0, `null` for none, else the default. */
export function cleanClip(value) {
    if (value === null) return null;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    return DEFAULT_CLIP;
}

/**
 * The recipe a saved config (a link, a panel set, an older version) describes.
 * Anything missing or invalid takes its default, so a hand-edited link still
 * opens. A gene on both sides counts as an up gene (the design's rule). A
 * list over the limit is cut at it, and the notes say so.
 * @param {Object} [raw]
 * @returns {{recipe: Object, notes: string[]}}
 */
export function normalizeRecipe(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const notes = [];
    let genes = cleanNames(src.genes);
    let down = cleanNames(src.down);
    const up = new Set(genes);
    const both = down.filter(name => up.has(name));
    if (both.length) {
        down = down.filter(name => !up.has(name));
        notes.push(`${both.length} gene${both.length === 1 ? ' was' : 's were'} on both sides and now count as up.`);
    }
    if (genes.length + down.length > GENE_LIMIT) {
        const dropped = genes.length + down.length - GENE_LIMIT;
        down = down.slice(0, Math.max(0, GENE_LIMIT - genes.length));
        genes = genes.slice(0, GENE_LIMIT);
        notes.push(`A signature holds up to ${GENE_LIMIT.toLocaleString('en-US')} genes; ${dropped.toLocaleString('en-US')} were left out.`);
    }
    const method = METHODS.includes(src.method) ? src.method : DEFAULT_METHOD;
    const input = typeof src.input === 'string' && src.input ? src.input : DEFAULT_INPUT;
    const seed = Number.isInteger(src.seed) && src.seed >= 0 ? src.seed : null;
    return {
        recipe: {
            genes, down, input, method,
            clip: 'clip' in src ? cleanClip(src.clip) : DEFAULT_CLIP,
            seed,
            version: RECIPE_VERSION
        },
        notes
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
        clip: recipe.clip, seed: recipe.seed, version: recipe.version
    };
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
    const zscore = recipe.method === 'zscore_mean';
    return stableStringify({
        v: recipe.version,
        input: recipe.input,
        method: recipe.method,
        clip: zscore ? recipe.clip : null,
        seed: recipe.method === 'control_adjusted' ? (recipe.seed === null || recipe.seed === undefined ? DEFAULT_SEED : recipe.seed) : null,
        up: setHash(recipe.genes),
        down: setHash(recipe.down)
    });
}

/** How the score is defined, in words (the Scoring row states it whatever is collapsed). */
export function definitionText(recipe) {
    if (recipe.method === 'mean') return `Mean expression of ${recipe.input}`;
    if (recipe.method === 'control_adjusted') return `Control-adjusted mean of ${recipe.input}, seed ${recipe.seed === null ? DEFAULT_SEED : recipe.seed}`;
    const clip = recipe.clip === null ? 'not clipped' : `clipped at ±${recipe.clip}`;
    return `Z-score mean of ${recipe.input}, ${clip}`;
}

/**
 * The shared settings in words, for the collapsed Scoring row: "X, clipped at ±10", "counts, not clipped, seed 3".
 * The seed is named only when it is set; the clip is named whatever the aggregation, because it is the signature's.
 */
export function settingsText(recipe) {
    const clip = recipe.clip === null ? 'not clipped' : `clipped at ±${recipe.clip}`;
    const seed = recipe.seed === null || recipe.seed === undefined ? '' : `, seed ${recipe.seed}`;
    return `${recipe.input}, ${clip}${seed}`;
}

/** Number with thousands separators, in the same form everywhere in the panel. */
export function fmtCount(n) {
    return Number(n).toLocaleString('en-US');
}

/**
 * Adding names to a list. Pure: says what would happen, the caller applies it.
 * Over the limit nothing is added, whatever the list holds.
 * @param {string[]} current - the genes now (sorted, distinct)
 * @param {Iterable<string>} incoming
 * @param {number} [limit]
 * @param {number} [others] - genes held elsewhere in the recipe that count toward the limit (the down genes)
 * @returns {{ok: boolean, added: string[], already: number, total: number, wouldBe: number, limit: number, genes: string[]}}
 *   `genes` is the list after the add (the current one when refused)
 */
export function planAdd(current, incoming, limit = GENE_LIMIT, others = 0) {
    const have = new Set(current);
    const distinct = new Set();
    for (const name of incoming) {
        if (typeof name === 'string' && name !== '') distinct.add(name);
    }
    let already = 0;
    const fresh = [];
    for (const name of distinct) {
        if (have.has(name)) already++;
        else fresh.push(name);
    }
    const added = fresh.sort(compareNames);
    const wouldBe = current.length + added.length + others;
    const ok = wouldBe <= limit;
    return {
        ok, added: ok ? added : [], already, total: ok ? current.length + added.length : current.length,
        wouldBe, limit, genes: ok ? mergeSorted(current, added) : current
    };
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
 * The message of a refused add, naming the limit and what the list would have been.
 * @param {{wouldBe: number, limit: number}} plan
 * @param {string} [what] - the thing refused, as "This table has 8,090 genes."
 */
export function limitMessage(plan, what = '') {
    const lead = what ? `${what} ` : '';
    return `${lead}A signature holds up to ${fmtCount(plan.limit)} genes. Nothing was added. `
        + `It would have made ${fmtCount(plan.wouldBe)}.`;
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
     * @param {{tick?: boolean, now?: number}} [opts] - `tick`: a single tick, joins the step before it when close in time
     */
    push(label, before, { tick = false, now = Date.now() } = {}) {
        const last = this.steps[this.steps.length - 1];
        if (tick && last && last.tick && now - this._lastTick <= this.coalesceMs) {
            last.count++;
            last.label = `change ${last.count} genes`;
            this._lastTick = now;
            return;
        }
        this.steps.push({ label, before: [...before], tick, count: 1 });
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
