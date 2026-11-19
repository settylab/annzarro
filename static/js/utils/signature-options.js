/**
 * What a Gene Signature offers its consumers: the model behind the panel's score options. Pure (no DOM, no page
 * state), so Node tests cover it and the plot and table menus build on it.
 *
 * The signature's panel defines the options and how each is computed; a plot or a table only picks from what is
 * offered. An option is one aggregation (a METHOD) read from one matrix (a LAYER). The stored recipe holds, as
 * configuration only:
 *
 *   offered   the methods consumers may pick, a list of method ids (default: z-score mean, mean, sum)
 *   layers    the matrices consumers may pick (default: just the default layer)
 *   input     the default layer: what a consumer that does not choose gets
 *   method    the default method (z-score mean)
 *   clip, bins, controls, seed   the parameters of the methods that have them
 *
 * Switching an option off never breaks a consumer that uses it: it keeps its setting and shows that the
 * option is no longer offered, with a way to offer it again (`offeredOptions` leaves it out, `isOffered` says).
 */

/** Every aggregation, in the order menus list them (by common use). `needs` names the parameters it uses. */
export const METHOD_INFO = Object.freeze([
    { value: 'zscore_mean', label: 'Z-score mean', short: 'z-score mean', needs: ['clip'],
        definition: 'Each gene becomes a z-score over all cells, so every gene counts equally, then the genes are averaged.' },
    { value: 'mean', label: 'Mean', short: 'mean', needs: [],
        definition: 'The plain average of the genes, in the units of the matrix.' },
    { value: 'sum', label: 'Sum', short: 'sum', needs: [],
        definition: 'The genes added up, in the units of the matrix. A gene with no value in a cell adds nothing.' },
    { value: 'detected', label: 'Detected', short: 'detected', needs: [],
        definition: 'The share of the genes with a non-zero value in the cell, from 0 to 1 (a share, so it compares between signatures of different sizes).' },
    { value: 'fraction_of_total', label: 'Fraction of total', short: 'fraction of total', needs: [],
        definition: 'The genes added up as a share of the cell\'s total over all genes, as for percent mitochondrial. Use counts or linear normalised values, not log-transformed or scaled ones.' },
    { value: 'control_adjusted', label: 'Control-adjusted', short: 'control-adjusted', needs: ['bins', 'controls', 'seed'],
        definition: 'The average of the genes less the average of control genes of similar detection, which removes differences in depth and quality between cells.' }
]);

export const METHODS = Object.freeze(METHOD_INFO.map(m => m.value));
export const DEFAULT_METHOD = 'zscore_mean';
/** Offered until the panel says otherwise. */
export const DEFAULT_OFFERED = Object.freeze(['zscore_mean', 'mean', 'sum']);

export const methodInfo = (method) => METHOD_INFO.find(m => m.value === method) || null;
export const methodLabel = (method) => (methodInfo(method) || { label: String(method) }).label;
export const methodShort = (method) => (methodInfo(method) || { short: String(method) }).short;

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
 * The menu a consumer shows: every offered method of every offered layer.
 * @param {Object} recipe - from normalizeRecipe
 * @param {string[]} [datasetLayers] - the matrices the dataset has, X first; an offered layer it lacks is left out
 * @returns {Array<{id: string, method: string, layer: string, label: string, definition: string}>}
 *   `id` is `method` for one layer and `method@layer` for several; `label` names the layer only when there are several
 */
export function offeredOptions(recipe, datasetLayers) {
    const methods = cleanOffered(recipe.offered, recipe.method);
    let layers = cleanLayers(recipe.layers, recipe.input);
    if (Array.isArray(datasetLayers) && datasetLayers.length) {
        const have = new Set(datasetLayers);
        layers = layers.filter(name => have.has(name));
    }
    const several = layers.length > 1;
    const out = [];
    for (const layer of layers) {
        for (const method of methods) {
            const info = methodInfo(method);
            out.push({
                id: several ? `${method}@${layer}` : method, method, layer,
                label: several ? `${info.label} · ${layer}` : info.label, definition: info.definition
            });
        }
    }
    return out;
}

/** The short summary the collapsed Score options row states: "Offered: z-score mean, mean, sum · layer X". */
export function offeredSummary(recipe) {
    const methods = cleanOffered(recipe.offered, recipe.method).map(methodShort).join(', ');
    const layers = cleanLayers(recipe.layers, recipe.input);
    return `Offered: ${methods} · ${layers.length > 1 ? `layers ${layers.join(', ')}` : `layer ${layers[0]}`}`;
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
    return out;
}
