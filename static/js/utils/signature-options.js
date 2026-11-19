/**
 * What a Gene Signature offers its consumers: the model behind the panel's score options. Pure (no DOM, no page
 * state), so Node tests cover it and the plot and table menus build on it.
 *
 * The signature's panel defines the options and how each is computed; a plot or a table only picks from what is
 * offered. An option is one aggregation (a METHOD) read from one matrix (a LAYER). The stored recipe holds, as
 * configuration only:
 *
 *   offered   the methods consumers may pick, a list of method ids (default: z-score mean, mean, sum)
 *   layers    the matrices consumers may pick, in the order they were offered (default: X)
 *   clip, bins, controls, seed, detect_above   the parameters of the methods that have them
 *
 * There is no default method and no default layer to choose. The first entry of the menu, the first offered method on
 * the first offered layer, is what a new consumer starts on. `method` and `input` stay in the recipe only as that first
 * method and layer: the score route reads them, and a consumer saved before layers could be offered has no layer, which
 * means `input` (X for every link made before this release). They are never shown as settings.
 *
 * Switching an option off never breaks a consumer that uses it: it keeps its setting and shows that the
 * option is no longer offered, with a way to offer it again (`offeredOptions` leaves it out, `isOffered` says).
 */

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
/** Offered until the panel says otherwise. */
export const DEFAULT_OFFERED = Object.freeze(['zscore_mean', 'mean', 'sum']);

export const methodInfo = (method) => METHOD_INFO.find(m => m.value === method) || null;
export const methodLabel = (method) => (methodInfo(method) || { label: String(method) }).label;
/** The name menus, titles and tags use. */
export const methodShort = (method) => (methodInfo(method) || { menu: String(method) }).menu;

/** The defaults of each method's parameters (keys of the recipe), for "Reset" under a method. */
export const PARAM_DEFAULTS = Object.freeze({
    zscore_mean: Object.freeze({ clip: 10 }),
    control_adjusted: Object.freeze({ bins: 25, controls: 50, seed: null }),
    detected: Object.freeze({ detect_above: 0 })
});

/** Whether every parameter of `method` is at its default in `recipe`. */
export function isMethodDefault(recipe, method) {
    const defaults = PARAM_DEFAULTS[method];
    if (!defaults) return true;
    return Object.entries(defaults).every(([key, value]) => {
        const have = recipe[key] === undefined ? null : recipe[key];
        return key === 'seed' ? (have === null || have === 0) : have === value;
    });
}

// ---------------------------------------------------------------------------
// What a layer looks like decides what may be computed from it

/** The word the section gives a kind (from core/matrix_kind.py): it answers "which layer should I use". */
export function kindWord(kind) {
    return { counts: 'counts', normalised: 'normalised', log: 'log-normalised', signed: 'scaled', other: 'other' }[kind] || '';
}

/**
 * How one method reads one layer, from what the layer looks like: `ok`, `warn` (said once, in the panel) or `cannot`
 * (left out of every menu, and the panel says why).
 * @param {string} method
 * @param {string} layer
 * @param {string} [kind] - counts, normalised, log, signed, other or unknown (unknown: nothing is known, so ok)
 * @returns {{grade: 'ok'|'warn'|'cannot', reason: string}}
 */
export function gradeOption(method, layer, kind) {
    const ok = { grade: 'ok', reason: '' };
    if (method === 'detected' && kind === 'signed') {
        return { grade: 'cannot', reason: `Not offered on ${layer}: almost every value is non-zero, so every gene counts as detected.` };
    }
    if (method === 'fraction_of_total') {
        if (kind === 'signed') return { grade: 'cannot', reason: `Not offered on ${layer}: ${layer} has negative values.` };
        if (kind === 'log') return { grade: 'warn', reason: '% of total on log values is compressed. It is usually read from counts.' };
    }
    if (kind === 'counts' && ['zscore_mean', 'mean', 'sum', 'control_adjusted'].includes(method)) {
        return { grade: 'warn', reason: `On '${layer}' this follows sequencing depth.` };
    }
    return ok;
}

/**
 * The methods a stored list stands for: known ids only, each once, in menu order; the default list when there is
 * none; never empty (the default method stays offered, so a signature always offers something).
 * @param {*} value
 * @param {string} [fallback] - the method kept when nothing valid is left
 * @returns {string[]}
 */
export function cleanOffered(value, fallback = DEFAULT_METHOD) {
    const wanted = new Set(Array.isArray(value) ? value.filter(m => METHODS.includes(m)) : DEFAULT_OFFERED);
    if (!wanted.size) wanted.add(METHODS.includes(fallback) ? fallback : DEFAULT_METHOD);
    return METHODS.filter(m => wanted.has(m));
}

/**
 * The layers a stored list stands for: text only, each once, the default layer first (it is always offered).
 * @param {*} value
 * @param {string} input - the default layer
 * @returns {string[]}
 */
export function cleanLayers(value, input) {
    const seen = new Set([input]);
    if (Array.isArray(value)) for (const name of value) if (typeof name === 'string' && name !== '') seen.add(name);
    return [...seen];
}

/** Whether a consumer may pick `method` (and `layer`, when given) of this signature now. */
export function isOffered(recipe, method, layer) {
    if (!cleanOffered(recipe.offered, recipe.method).includes(method)) return false;
    return layer === undefined || layer === null || layer === '' || cleanLayers(recipe.layers, recipe.input).includes(layer);
}

/**
 * Every offered method of every offered layer with its grade, `cannot` ones included: for the panel, which says why
 * an option is not in the menus. Order: by method (the panel's order), and within a method the layers in the order
 * they were offered, so the first entry is the first method on the first layer.
 * @param {Object} recipe - from normalizeRecipe
 * @param {string[]} [datasetLayers] - the matrices the dataset has, X first; an offered layer it lacks is left out
 * @param {Object<string, string>} [kinds] - layer -> what it looks like; a layer not listed is not graded
 * @returns {Array<{id: string, method: string, layer: string, label: string, fullLabel: string, definition: string,
 *   grade: string, reason: string}>}
 *   `id` is always `method@layer`, however many layers are offered, but a consumer stores `{column: method, layer}`,
 *   never the id. `label` names the layer only when several are offered; `fullLabel` always does.
 */
export function gradedOptions(recipe, datasetLayers, kinds = {}) {
    const methods = cleanOffered(recipe.offered, recipe.method);
    let layers = cleanLayers(recipe.layers, recipe.input);
    if (Array.isArray(datasetLayers) && datasetLayers.length) {
        const have = new Set(datasetLayers);
        layers = layers.filter(name => have.has(name));
    }
    const several = layers.length > 1;
    const out = [];
    for (const method of methods) {
        for (const layer of layers) {
            const info = methodInfo(method);
            const { grade, reason } = gradeOption(method, layer, kinds[layer]);
            out.push({
                id: `${method}@${layer}`, method, layer, label: several ? `${info.menu} · ${layer}` : info.menu,
                fullLabel: `${info.menu} · ${layer}`, definition: info.definition, grade, reason
            });
        }
    }
    return out;
}

/** The menu a consumer shows: `gradedOptions` without the combinations that cannot be computed. */
export function offeredOptions(recipe, datasetLayers, kinds) {
    return gradedOptions(recipe, datasetLayers, kinds).filter(o => o.grade !== 'cannot');
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
 * The collapsed row: offered methods, then the layers. A parameter that is not at its default follows its method.
 * "z-score mean, mean, sum · X"; "z-score mean (not clipped), control-adjusted (seed 3) · X, logged_counts (default X)".
 */
export function offeredSummary(recipe) {
    const methods = cleanOffered(recipe.offered, recipe.method).map((m) => {
        const notes = paramNotes(recipe, m);
        return notes.length ? `${methodShort(m)} (${notes.join(', ')})` : methodShort(m);
    }).join(', ');
    const layers = cleanLayers(recipe.layers, recipe.input);
    return `${methods} · ${layers.join(', ')}`;
}

/** The narrow form of the collapsed row: "3 methods · X". */
export function offeredSummaryShort(recipe) {
    const n = cleanOffered(recipe.offered, recipe.method).length;
    const layers = cleanLayers(recipe.layers, recipe.input);
    return `${n} method${n === 1 ? '' : 's'} · ${layers.length > 1 ? `${layers.length} layers` : layers[0]}`;
}

/** Who uses an option, in words: "1 plot", "2 plots, 1 table"; empty when nothing does. */
export function useText({ plots = 0, tables = 0 } = {}) {
    const parts = [];
    if (plots) parts.push(`${plots} plot${plots === 1 ? '' : 's'}`);
    if (tables) parts.push(`${tables} table${tables === 1 ? '' : 's'}`);
    return parts.join(', ');
}

/**
 * The parameters of a method, as the recipe holds them (for the cache key and the panel): only those the method uses.
 * @returns {Object}
 */
export function paramsOf(recipe, method) {
    const need = (methodInfo(method) || { needs: [] }).needs;
    const out = {};
    if (need.includes('clip')) out.clip = recipe.clip;
    if (need.includes('bins')) out.bins = recipe.bins;
    if (need.includes('controls')) out.controls = recipe.controls;
    if (need.includes('seed')) out.seed = recipe.seed === null || recipe.seed === undefined ? 0 : recipe.seed;
    if (need.includes('detect_above')) out.detect_above = recipe.detect_above === undefined ? 0 : recipe.detect_above;
    return out;
}

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

/** A whole number in [lo, hi], else the default. */
export function cleanWhole(value, fallback, [lo, hi]) {
    return Number.isInteger(value) && value >= lo && value <= hi ? value : fallback;
}

/** A detection threshold: a finite number from 0 up, else 0. */
export function cleanThreshold(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * A detection threshold typed into the panel: a number from 0 up.
 * @param {string} text
 * @returns {{ok: true, value: number} | {ok: false, error: string}}
 */
export function parseThresholdText(text) {
    const trimmed = String(text === undefined || text === null ? '' : text).trim();
    const value = trimmed === '' ? NaN : Number(trimmed);
    if (!Number.isFinite(value) || value < 0) return { ok: false, error: 'Enter a number from 0 up.' };
    return { ok: true, value };
}

/** A clip as the recipe keeps it: a finite number above 0, `null` for none, else the default. */
export function cleanClip(value) {
    if (value === null) return null;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    return DEFAULT_CLIP;
}

/**
 * A whole number typed into the panel, within [lo, hi].
 * @param {string} text
 * @param {number[]} range
 * @returns {{ok: true, value: number} | {ok: false, error: string}}
 */
export function parseWholeText(text, [lo, hi]) {
    const trimmed = String(text === undefined || text === null ? '' : text).trim();
    const value = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
    if (!Number.isSafeInteger(value) || value < lo || value > hi) {
        return { ok: false, error: `Enter a whole number from ${lo.toLocaleString('en-US')} to ${hi.toLocaleString('en-US')}.` };
    }
    return { ok: true, value };
}


/** The keys of the option fields, in the order they are stored. */
export const OPTION_KEYS = Object.freeze(['input', 'method', 'offered', 'layers', 'clip', 'seed', 'bins', 'controls', 'detect_above']);

/**
 * The option fields a saved config describes, every one valid. Anything missing or invalid takes its default, so a
 * hand-edited link still opens. The method is the first one offered and the input the first layer offered.
 * @param {Object} [raw]
 * @returns {{input: string, method: string, offered: string[], layers: string[], clip: (number|null), seed: (number|null),
 *   bins: number, controls: number, detect_above: number}}
 */
export function normalizeOptions(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    // There is no default method or layer to choose: the first offered method on the first offered layer is where a new
    // consumer starts. `method` and `input` stay in the options only as that first method and layer (the score route
    // reads them, and an old consumer without a layer means `input`).
    const offered = cleanOffered(src.offered, METHODS.includes(src.method) ? src.method : DEFAULT_METHOD);
    const asked = typeof src.input === 'string' && src.input ? src.input : DEFAULT_INPUT;
    const layers = cleanLayers(src.layers, asked);
    return {
        input: layers[0], method: offered[0], offered, layers,
        clip: 'clip' in src ? cleanClip(src.clip) : DEFAULT_CLIP,
        seed: Number.isInteger(src.seed) && src.seed >= 0 ? src.seed : null,
        bins: cleanWhole(src.bins, DEFAULT_BINS, BINS_RANGE),
        controls: cleanWhole(src.controls, DEFAULT_CONTROLS, CONTROLS_RANGE),
        detect_above: cleanThreshold(src.detect_above)
    };
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
