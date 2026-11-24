/**
 * The score methods of a Gene Signature (and of a Gene Table, which scores the same way): their table, their parameters
 * and how each method is graded on a layer. Pure (no DOM, no page state), so Node tests cover it and the plot and table
 * menus build on it.
 *
 * Decision 31: a plot or table chooses any METHOD read from any LAYER; nothing is offered or withheld. The signature's
 * panel holds only the parameters of each method (clip, bins, controls, seed, detect_above), and the stored recipe
 * holds those and `method` and `input`: the pair a consumer saved without a layer resolves to (X for every link made
 * before layers were stored), never shown as a setting. A link made before decision 31 also stored `offered` and
 * `layers`; they are read only for that pair (`writableOptions`, options-model.js `legacyPair`) and never written back.
 *
 * A pair that cannot be computed is graded `cannot`, with a sentence that names the method and says why ("% of total
 * cannot be computed on 'X': it has negative values."); a pair that misleads is `warn`, with its note.
 */

import {
    REASON, legacyPair, quoted, cleanThreshold, cleanWhole, createOptionsModel, figure, kindWord, parseClipText, parseSeedText, parseThresholdText,
    parseWholeText, useText, withoutLegacy
} from './options-model.js';

// The pure parts every method table shares live in options-model.js; this file is the gene signature's method table,
// its grading and its stored fields.
export { cleanThreshold, cleanWhole, kindWord, parseClipText, parseSeedText, parseThresholdText, parseWholeText, useText };

/**
 * Every aggregation, in the order menus list them. ONE name per method, used by every surface: `label` as a panel
 * label (sentence case), `menu` in menus, titles and tags (lower case, after a signature's name). `needs` names the
 * parameters it uses (the keys of the recipe).
 */
export const METHOD_INFO = Object.freeze([
    { value: 'zscore_mean', label: 'Z-score mean', menu: 'z-score mean', needs: ['clip'], unit: 'SD',
        definition: 'Each gene scaled to mean 0 and SD 1 over all cells, then averaged, so every gene counts equally.' },
    { value: 'mean', label: 'Mean', menu: 'mean', needs: [], unit: 'layer units',
        definition: 'Average of the genes\' values, in the layer\'s units.' },
    { value: 'sum', label: 'Sum', menu: 'sum', needs: [], unit: 'layer units',
        definition: 'Total of the genes\' values, in the layer\'s units. Grows with the number of genes.' },
    { value: 'control_adjusted', label: 'Control-adjusted', menu: 'control-adjusted', needs: ['bins', 'controls', 'seed'], unit: 'layer units',
        definition: 'Mean of the genes minus the mean of control genes with similar detection, like scanpy\'s score_genes.' },
    { value: 'detected', label: 'Fraction detected', menu: 'fraction detected', needs: ['detect_above'], unit: '0 to 1',
        definition: 'The share of the signature\'s genes detected in the cell, from 0 to 1.' },
    { value: 'fraction_of_total', label: '% of total', menu: '% of total', needs: [], unit: '%',
        definition: 'The genes\' share of the cell\'s total over all genes, in percent, as for % mitochondrial.' }
]);

export const METHODS = Object.freeze(METHOD_INFO.map(m => m.value));
export const DEFAULT_METHOD = 'zscore_mean';
/** What an old link's missing `offered` list meant (before decision 31): read for links only. */
export const DEFAULT_OFFERED = Object.freeze(['zscore_mean', 'mean', 'sum']);

/**
 * The methods that can score a signature with down genes: score = the up side minus the down side, each side scored on
 * its own. The others have no signed version that means anything (core/gene_score.py DOWN_METHODS).
 */
export const DOWN_METHODS = Object.freeze(['zscore_mean', 'mean', 'control_adjusted']);

/** How down genes weigh in the z-score mean and the mean: each gene equally (the default) or each side equally. */
export const DOWN_WEIGHTS = Object.freeze(['gene', 'side']);
export const DEFAULT_DOWN_WEIGHT = 'gene';
/** The methods that have a weighting; control-adjusted is per side by construction. */
export const WEIGHTED_METHODS = Object.freeze(['zscore_mean', 'mean']);
export const cleanDownWeight = (value) => (DOWN_WEIGHTS.includes(value) ? value : DEFAULT_DOWN_WEIGHT);

/** Why a method cannot score down genes: the clause after "<Method> cannot be computed with down genes: ". */
const DOWN_REASONS = Object.freeze({
    sum: 'a signed sum depends on how many genes each side has.',
    detected: 'the difference of two fractions is not a fraction.',
    fraction_of_total: 'the difference of two shares is not a share of anything.'
});

/** A method's name at the start of a sentence ("% of total", "Fraction detected"). */
const sentenceName = (method) => (METHOD_INFO.find(m => m.value === method) || { label: method }).label;

/** Whether `method` can score a signature that has down genes. */
export const canScoreDown = (method) => DOWN_METHODS.includes(method);

/** The defaults of each method's parameters (keys of the recipe), for "Reset" under a method. */
export const PARAM_DEFAULTS = Object.freeze({
    zscore_mean: Object.freeze({ clip: 10 }),
    control_adjusted: Object.freeze({ bins: 25, controls: 50, seed: null }),
    detected: Object.freeze({ detect_above: 0 })
});

// ---------------------------------------------------------------------------
// What a layer looks like decides what may be computed from it

/** Methods whose score follows how deeply a cell was sequenced when the layer holds raw counts. */
const DEPTH_METHODS = Object.freeze(['zscore_mean', 'mean', 'sum', 'control_adjusted']);
/** A detection threshold leaves a score constant when this share (or its complement) of the values are on one side of it. */
export const DETECT_TOO_MANY = 0.99;
export const DETECT_TOO_FEW = 0.01;

/**
 * The share of ALL the values of a layer that are above `threshold`, from the sample the server read (`stats.density`:
 * the share of values that are non-zero, `stats.quantiles`: the non-zero values at every 2 percent). A threshold of 0
 * or more is never exceeded by a zero, so only the non-zero values count. null when the sample says nothing.
 * @param {{density?: (number|null), quantiles?: (number[]|null)}} [stats]
 * @param {number} threshold - 0 or more
 * @returns {number|null}
 */
export function shareAbove(stats, threshold) {
    const q = stats && stats.quantiles;
    if (!Array.isArray(q) || q.length < 2 || typeof stats.density !== 'number') return null;
    const last = q.length - 1;
    let below;                                     // the share of the non-zero values at or below the threshold
    if (threshold < q[0]) below = 0;
    else if (threshold >= q[last]) below = 1;
    else {
        let k = 0;
        while (k < last - 1 && q[k + 1] <= threshold) k++;
        const span = q[k + 1] - q[k];
        below = (k + (span > 0 ? (threshold - q[k]) / span : 1)) / last;
    }
    return stats.density * (1 - below);
}

/**
 * How one method reads one layer: `ok`, `warn` (it can be computed but misleads: the note rides on the option) or
 * `cannot` (disabled where the pair is chosen, the reason as its title). From what the layer looks like and, for fraction detected, from how many of
 * its values are above the threshold: that is a measure, not a kind, so it follows the parameter.
 * @param {string} method
 * @param {string} layer
 * @param {string} [kind] - counts, normalised, log, signed, other or unknown (unknown: nothing is known, so ok)
 * @param {boolean} [hasDown] - the signature has down genes; the methods without a signed version then cannot
 * @param {{stats?: Object, detectAbove?: number}} [ctx] - the layer's sample and the threshold
 * @returns {{grade: 'ok'|'warn'|'cannot', code: string, reason: string, down?: boolean}} `code` names the cause:
 *   depth, log, negative, detect_high, detect_low or down; `down`: the reason is the down genes, whatever the layer
 */
export function gradeOption(method, layer, kind, hasDown = false, ctx = {}) {
    const ok = { grade: 'ok', code: '', reason: '' };
    const name = quoted(layer);
    const label = sentenceName(method);
    if (hasDown && !canScoreDown(method)) {
        return { grade: 'cannot', code: 'down', down: true,
            reason: REASON.cannotWith(label, 'down genes', DOWN_REASONS[method] || 'it has no signed version.') };
    }
    if (method === 'detected') {
        const t = typeof ctx.detectAbove === 'number' ? ctx.detectAbove : 0;
        const share = shareAbove(ctx.stats, t);
        if (share === null) return ok;
        const range = ctx.stats && Number.isFinite(ctx.stats.min) && Number.isFinite(ctx.stats.max)
            ? ` (values here range from ${figure(ctx.stats.min)} to ${figure(ctx.stats.max)})` : '';
        if (share > DETECT_TOO_MANY) {
            return { grade: 'cannot', code: 'detect_high',
                reason: REASON.cannotOn(label, name, `almost every value is above ${figure(t)}${range}. Raise Detected above.`) };
        }
        if (share < DETECT_TOO_FEW) {
            return { grade: 'cannot', code: 'detect_low',
                reason: REASON.cannotOn(label, name, `almost no value is above ${figure(t)}${range}.${t > 0 ? ' Lower Detected above.' : ''}`) };
        }
        return ok;
    }
    if (method === 'fraction_of_total') {
        if (kind === 'signed') return { grade: 'cannot', code: 'negative', reason: REASON.cannotOn(label, name, 'it has negative values.') };
        if (kind === 'log') return { grade: 'warn', code: 'log', reason: REASON.note(label, name, 'is compressed by the log: it is usually read from counts.') };
    }
    if (kind === 'counts' && DEPTH_METHODS.includes(method)) {
        return { grade: 'warn', code: 'depth', reason: REASON.note(label, name, 'follows sequencing depth.') };
    }
    return ok;
}

const nonDefault = (recipe, key, fallback) => (recipe[key] === undefined || recipe[key] === null ? fallback : recipe[key]);

/** A parameter that is not at its default, named after its method in the summary: "not clipped", "seed 3". */
function paramNotes(recipe, method) {
    const notes = [];
    if (method === 'zscore_mean') {
        if (recipe.clip === null) notes.push('not clipped');
        else if (recipe.clip !== 10) notes.push(`clip ±${recipe.clip}`);
    } else if (method === 'control_adjusted') {
        if (nonDefault(recipe, 'bins', 25) !== 25) notes.push(`bins ${recipe.bins}`);
        if (nonDefault(recipe, 'controls', 50) !== 50) notes.push(`controls ${recipe.controls}`);
        if (nonDefault(recipe, 'seed', 0) !== 0) notes.push(`seed ${recipe.seed}`);
    } else if (method === 'detected') {
        if (nonDefault(recipe, 'detect_above', 0) !== 0) notes.push(`above ${recipe.detect_above}`);
    }
    return notes;
}

/**
 * Every parameter not at its default, by method, in menu order: what the Methods pop-over's button says in its title
 * ("z-score mean: not clipped; control-adjusted: seed 3"), so no setting hides behind a closed pop-over.
 * @param {Object} recipe - option fields
 * @returns {Array<{method: string, notes: string[]}>}
 */
export function methodNotes(recipe) {
    return METHODS.map(method => ({ method, notes: paramNotes(recipe || {}, method) })).filter(m => m.notes.length);
}

// ---------------------------------------------------------------------------
// The sentences that state a setting: each is a function of the value in force, so none can describe another value

/** What the clip does: names the cut, or says there is none. */
export function clipLine(clip) {
    return clip === null || clip === undefined
        ? 'Not clipped: one rare gene can dominate the average.'
        : `Z-scores are cut at \u00b1${figure(clip)}. One rare gene can otherwise dominate the average.`;
}

/** What the detection threshold does: names the threshold. */
export function thresholdLine(threshold) {
    return `A gene counts as detected in a cell when its value is above this. Now: above ${figure(cleanThreshold(threshold))}.`;
}

/** The words for a down-gene weighting. */
export const DOWN_WEIGHT_WORDS = Object.freeze({ gene: 'each gene weighs equally', side: 'each side weighs equally' });

// ---------------------------------------------------------------------------
// The shared schema of the option fields
//
// A gene signature and a gene table are both sources of a gene score. They differ only in how the genes are chosen
// (handpicked, or those passing a filter), so the fields that say HOW to score and WHAT to offer are one schema,
// kept here: the signature stores them flat in its recipe, a gene table under `scoreOptions` in its configuration.
// A later field (up and down genes) is added to OPTION_FIELDS and to nothing else.

export const DEFAULT_CLIP = 10;
export const DEFAULT_INPUT = 'X';
/** The seed a control-adjusted score without one means (the server's DEFAULT_SEED). */
export const DEFAULT_SEED = 0;
export const DEFAULT_BINS = 25;
export const DEFAULT_CONTROLS = 50;
export const BINS_RANGE = [2, 200];
export const CONTROLS_RANGE = [1, 1000];
/** Largest seed the page accepts: whole numbers the browser holds exactly (the server takes up to 2^63 - 1). */
export const MAX_SEED = Number.MAX_SAFE_INTEGER;

/** A clip as the recipe keeps it: a finite number above 0, `null` for none, else the default. */
export function cleanClip(value) {
    if (value === null) return null;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    return DEFAULT_CLIP;
}


/** The keys of the option fields, in the order they are stored. */
export const OPTION_KEYS = Object.freeze(['input', 'method', 'offered', 'layers', 'clip', 'seed', 'bins', 'controls', 'detect_above', 'methods']);

/**
 * Custom methods (offered-removal-080.md section 4) come after 0.8.0; the field is reserved now, so a link made by a later
 * version still opens here: a `methods` list is kept as it was stored, read by nothing and sent to no server. A plain
 * JSON copy, so an edit of the copy never reaches the link it came from.
 * @param {*} value
 * @returns {Array|undefined}
 */
export function reservedMethods(value) {
    if (!Array.isArray(value)) return undefined;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return undefined;
    }
}

/**
 * The option fields a saved config describes, every one valid. Anything missing or invalid takes its default, so a
 * hand-edited link still opens. An old link's `offered`/`layers` give its method and input (the first of each).
 * @param {Object} [raw]
 * @returns {{input: string, method: string, offered: string[], layers: string[], clip: (number|null), seed: (number|null),
 *   bins: number, controls: number, detect_above: number}}
 */
export function normalizeOptions(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    // `method` and `input` are the pair an old consumer without a layer resolves to (the score route reads them too);
    // an old link names them through its first `offered` method and its first `layers` entry.
    const offered = cleanOffered(src.offered, METHODS.includes(src.method) ? src.method : DEFAULT_METHOD);
    const asked = typeof src.input === 'string' && src.input ? src.input : DEFAULT_INPUT;
    const layers = cleanLayers(src.layers, asked);
    // since decision 31 a stored recipe has no `offered`: its `method` is the method itself
    const method = !Array.isArray(src.offered) && METHODS.includes(src.method) ? src.method : offered[0];
    return {
        input: layers[0], method, offered, layers,
        clip: 'clip' in src ? cleanClip(src.clip) : DEFAULT_CLIP,
        seed: Number.isInteger(src.seed) && src.seed >= 0 ? src.seed : null,
        bins: cleanWhole(src.bins, DEFAULT_BINS, BINS_RANGE),
        controls: cleanWhole(src.controls, DEFAULT_CONTROLS, CONTROLS_RANGE),
        detect_above: cleanThreshold(src.detect_above)
    };
}

/**
 * The option fields a config STORES since decision 31: `normalizeOptions` minus the retired `offered` and `layers`, which
 * are only read to find the old default pair (`method` the first offered, `input` the stored input, else the first
 * layer) and never written back. A link made before keeps drawing what it drew.
 * @param {Object} [raw]
 */
export function writableOptions(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const pair = legacyPair(MODEL, src);
    const methods = reservedMethods(src.methods);
    return { ...withoutLegacy(normalizeOptions({ ...src, input: pair.layer, offered: [pair.method], layers: undefined })),
        input: pair.layer, method: pair.method, ...(methods ? { methods } : {}) };
}

/** Whether the PARAMETERS are the defaults (a gene table then stores nothing); the retired offered/layers are not compared. */
export function isDefaultParams(options) {
    const a = writableOptions(options);
    const b = writableOptions({});
    return ['clip', 'seed', 'bins', 'controls', 'detect_above'].every(key => JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

/** The option fields as a config stores them: a plain copy. */
export function storedOptions(options) {
    const o = normalizeOptions(options);
    return { ...o, offered: [...o.offered], layers: [...o.layers] };
}

/** The option fields of anything that has them (a recipe, a config): only the schema's keys. */
export function pickOptions(source) {
    const out = {};
    if (source && typeof source === 'object') for (const key of OPTION_KEYS) if (key in source) out[key] = source[key];
    return out;
}

/** Whether the options are exactly the defaults (a gene table then stores nothing). */
export function isDefaultOptions(options) {
    const a = normalizeOptions(options);
    const b = normalizeOptions({});
    return OPTION_KEYS.every(key => JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

// ---------------------------------------------------------------------------
// The signature's method table as an options model (options-model.js): the rest of this file's exports are its functions

const MODEL = createOptionsModel({
    methods: METHOD_INFO, defaultMethod: DEFAULT_METHOD, defaultOffered: DEFAULT_OFFERED, defaultLayer: 'X',
    paramDefaults: PARAM_DEFAULTS,
    sameParam: (key, have, want) => {
        const v = have === undefined ? null : have;
        return key === 'seed' ? (v === null || v === 0) : v === want;
    },
    paramValue: (recipe, key) => {
        if (key === 'seed') return recipe.seed === null || recipe.seed === undefined ? 0 : recipe.seed;
        if (key === 'detect_above') return recipe.detect_above === undefined ? 0 : recipe.detect_above;
        return recipe[key];
    },
    context: (recipe) => ({ hasDown: Array.isArray(recipe.down) && recipe.down.length > 0, detectAbove: recipe.detect_above }),
    grade: (method, layer, kind, ctx) => gradeOption(method, layer, kind, !!ctx.hasDown, ctx)
});

export const SIGNATURE_MODEL = MODEL;
/** Decision 31: every method on `layer` (all six), every impossible one disabled with its reason. See options-model.js. */
export const { methodChoices: scoreMethodChoices, layerChoices: scoreLayerChoices, pairAfter: scorePairAfter } = MODEL;
export const {
    methodInfo, methodLabel, methodShort, isMethodDefault, cleanOffered, cleanLayers, paramsOf
} = MODEL;
