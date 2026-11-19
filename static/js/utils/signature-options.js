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

/**
 * The methods that can score a signature with down genes: score = the up side minus the down side, each side scored on
 * its own. The others have no signed version that means anything (core/gene_score.py DOWN_METHODS).
 */
export const DOWN_METHODS = Object.freeze(['zscore_mean', 'mean', 'control_adjusted']);

/** Why a method cannot score down genes, in the words the panel shows under it. */
const DOWN_REASONS = Object.freeze({
    sum: 'A signed sum depends on how many genes each side has.',
    detected: 'The difference of two fractions is not a fraction.',
    fraction_of_total: 'The difference of two shares is not a share of anything.'
});

/** Whether `method` can score a signature that has down genes. */
export const canScoreDown = (method) => DOWN_METHODS.includes(method);

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

/** Methods whose score follows how deeply a cell was sequenced when the layer holds raw counts. */
const DEPTH_METHODS = Object.freeze(['zscore_mean', 'mean', 'sum', 'control_adjusted']);
/** A detection threshold leaves a score constant when this share (or its complement) of the values are on one side of it. */
export const DETECT_TOO_MANY = 0.99;
export const DETECT_TOO_FEW = 0.01;

/** A figure in the panel's words: 3 significant digits, a true minus sign. */
function figure(x) {
    return String(Number(Number(x).toPrecision(3))).replace('-', '\u2212');
}

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
 * How one method reads one layer: `ok`, `warn` (a property of the layer, said once on its row) or `cannot` (left out
 * of every menu, and the panel says why). From what the layer looks like and, for fraction detected, from how many of
 * its values are above the threshold: that is a measure, not a kind, so it follows the parameter.
 * @param {string} method
 * @param {string} layer
 * @param {string} [kind] - counts, normalised, log, signed, other or unknown (unknown: nothing is known, so ok)
 * @param {boolean} [hasDown] - the signature has down genes; the methods without a signed version then cannot
 * @param {{stats?: Object, detectAbove?: number, label?: string}} [ctx] - the layer's sample, the threshold, and what to
 *   call the layer in the sentence (default `'name'`; the panel says "every offered layer" when all share the issue)
 * @returns {{grade: 'ok'|'warn'|'cannot', code: string, reason: string, down?: boolean}} `code` names the cause:
 *   depth, log, negative, detect_high, detect_low or down; `down`: the reason is the down genes, whatever the layer
 */
export function gradeOption(method, layer, kind, hasDown = false, ctx = {}) {
    const ok = { grade: 'ok', code: '', reason: '' };
    const name = ctx.label || `'${layer}'`;
    if (hasDown && !canScoreDown(method)) {
        return { grade: 'cannot', code: 'down', down: true, reason: `Not offered with down genes. ${DOWN_REASONS[method] || ''}`.trim() };
    }
    if (method === 'detected') {
        const t = typeof ctx.detectAbove === 'number' ? ctx.detectAbove : 0;
        const share = shareAbove(ctx.stats, t);
        if (share === null) return ok;
        const range = ctx.stats && Number.isFinite(ctx.stats.min) && Number.isFinite(ctx.stats.max)
            ? ` (values here range from ${figure(ctx.stats.min)} to ${figure(ctx.stats.max)})` : '';
        if (share > DETECT_TOO_MANY) {
            return { grade: 'cannot', code: 'detect_high', reason: `On ${name} almost every value is above ${figure(t)}. Raise Detected above${range}.` };
        }
        if (share < DETECT_TOO_FEW) {
            return { grade: 'cannot', code: 'detect_low',
                reason: `On ${name} almost no value is above ${figure(t)}.${t > 0 ? ' Lower Detected above' : ' Fraction detected'}${range}.` };
        }
        return ok;
    }
    if (method === 'fraction_of_total') {
        if (kind === 'signed') return { grade: 'cannot', code: 'negative', reason: `Not offered on ${name}: it has negative values.` };
        if (kind === 'log') return { grade: 'warn', code: 'log', reason: `On ${name} % of total is compressed by the log. It is usually read from counts.` };
    }
    if (kind === 'counts' && DEPTH_METHODS.includes(method)) {
        return { grade: 'warn', code: 'depth', reason: `On ${name} this follows sequencing depth.` };
    }
    return ok;
}

/** "a", "a and b", "a, b and c". */
const andList = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * What to say on a LAYER's row: its properties, each once and short, only when they matter for a method that is offered.
 * "Raw counts: sum and mean follow sequencing depth." Several lines at most one per property.
 * @param {string} layer
 * @param {Object} recipe - from normalizeRecipe
 * @param {string} [kind]
 * @param {Object} [stats] - what the server sampled of the layer
 * @returns {Array<{grade: string, code: string, text: string}>}
 */
export function layerLines(layer, recipe, kind, stats) {
    const offered = cleanOffered(recipe.offered, recipe.method);
    const lines = [];
    const depth = offered.filter(m => DEPTH_METHODS.includes(m));
    if (kind === 'counts' && depth.length) {
        lines.push({ grade: 'warn', code: 'depth', text: `Raw counts: ${andList(depth.map(methodShort))} follow${depth.length === 1 ? 's' : ''} sequencing depth.` });
    }
    if (kind === 'normalised' && depth.length) {
        lines.push({ grade: 'warn', code: 'normalised', text: 'Normalised but not log-transformed: one highly expressed gene can dominate.' });
    }
    if (offered.includes('fraction_of_total')) {
        if (kind === 'log') lines.push({ grade: 'warn', code: 'log', text: 'Log values: % of total is compressed. It is usually read from counts.' });
        if (kind === 'signed') lines.push({ grade: 'cannot', code: 'negative', text: 'Has negative values: % of total is not offered here.' });
    }
    if (offered.includes('detected')) {
        const g = gradeOption('detected', layer, kind, false, { stats, detectAbove: recipe.detect_above });
        if (g.grade === 'cannot') lines.push({ grade: 'cannot', code: g.code, text: g.reason });
    }
    return lines;
}

/**
 * What to say under a METHOD: only what holds whatever the layer. A property of some layers is said on their rows,
 * not here; one that every offered layer has is said here too, once; the down genes' reason always, once.
 * @param {string} method
 * @param {string[]} layers - the offered layers
 * @param {Object} recipe
 * @param {Object<string, string>} [kinds]
 * @param {Object<string, Object>} [stats]
 * @returns {Array<{grade: string, code: string, text: string, down?: boolean}>}
 */
export function methodLines(method, layers, recipe, kinds = {}, stats = {}) {
    const hasDown = Array.isArray(recipe.down) && recipe.down.length > 0;
    if (!layers.length) return [];
    const grade = (layer, label) => gradeOption(method, layer, kinds[layer], hasDown,
        { stats: stats[layer], detectAbove: recipe.detect_above, label });
    const first = grade(layers[0]);
    if (first.down) return [{ grade: first.grade, code: first.code, text: first.reason, down: true }];
    if (first.grade === 'ok') return [];
    const all = layers.every(l => grade(l).code === first.code);
    if (!all) return [];
    if (layers.length === 1) return [{ grade: first.grade, code: first.code, text: first.reason }];
    // a threshold's message names figures of one layer: with several it stays on the rows
    if (first.code.startsWith('detect_')) return [];
    const every = grade(layers[0], 'every offered layer');
    return [{ grade: every.grade, code: every.code, text: every.reason }];
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
 * @param {Object<string, Object>} [stats] - layer -> what the server sampled of it (`detected` is graded against the threshold)
 * @returns {Array<{id: string, method: string, layer: string, label: string, fullLabel: string, definition: string,
 *   grade: string, reason: string}>}
 *   `id` is always `method@layer`, however many layers are offered, but a consumer stores `{column: method, layer}`,
 *   never the id. `label` names the layer only when several are offered; `fullLabel` always does.
 */
export function gradedOptions(recipe, datasetLayers, kinds = {}, stats = {}) {
    const methods = cleanOffered(recipe.offered, recipe.method);
    let layers = cleanLayers(recipe.layers, recipe.input);
    if (Array.isArray(datasetLayers) && datasetLayers.length) {
        const have = new Set(datasetLayers);
        layers = layers.filter(name => have.has(name));
    }
    const several = layers.length > 1;
    const hasDown = Array.isArray(recipe.down) && recipe.down.length > 0;
    const out = [];
    for (const method of methods) {
        for (const layer of layers) {
            const info = methodInfo(method);
            const { grade, reason, code } = gradeOption(method, layer, kinds[layer], hasDown,
                { stats: stats[layer], detectAbove: recipe.detect_above });
            out.push({
                id: `${method}@${layer}`, method, layer, label: several ? `${info.menu} · ${layer}` : info.menu,
                fullLabel: `${info.menu} · ${layer}`, definition: info.definition, grade, reason, code,
                // a combination that can be computed but misleads says so in a title, not in a notice
                note: grade === 'warn' ? reason : ''
            });
        }
    }
    return out;
}

/** The menu a consumer shows: `gradedOptions` without the combinations that cannot be computed. */
export function offeredOptions(recipe, datasetLayers, kinds, stats) {
    return gradedOptions(recipe, datasetLayers, kinds, stats).filter(o => o.grade !== 'cannot');
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
