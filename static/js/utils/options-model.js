/**
 * The model of what a source of per-cell or per-group numbers offers its consumers, for ANY method table. Pure (no DOM,
 * no page state). A provider (the gene signature's six scores, the grouping's statistics) supplies:
 *
 *   methods         the method table: { value, label, menu, needs, unit, definition }; `needs` names the parameters
 *                   the method uses (keys of the recipe), and two methods may need the same one (a shared threshold)
 *   defaultMethod, defaultOffered, defaultLayer
 *   paramDefaults   { method: { key: default } }, for "Reset" under a method
 *   paramValue      (recipe, key) -> the value a method's parameter has, a missing one filled (default: the field)
 *   sameParam       (key, have, want) -> boolean; default strict equality, with a missing value read as null
 *   paramNotes      (recipe, method) -> string[]: a parameter that is not at its default, named after its method in
 *                   the collapsed row ("not clipped", "above 0.5")
 *   paramLines      { key: (recipe) -> sentence }: what a parameter does, naming the value in force
 *   grade           (method, layer, kind, ctx) -> { grade: 'ok'|'warn'|'cannot', code, reason, down? }: the
 *                   provider's grading of a method on a layer of this kind. ctx = { stats, label, ...context(recipe) }
 *   context         (recipe) -> the recipe-dependent facts grade needs (the signature's `hasDown`, its threshold)
 *   layerLines      (layer, recipe, kind, stats, offered) -> lines for a LAYER's row (default: none)
 *   resetFields     the option fields a reset writes and `isDefaultOffer` compares (default: input, method, offered,
 *                   layers). A grouping's recipe has no input and no method: it names offered and layers only
 *
 * and gets, as ONE implementation: the offered list and layers, `isOffered`, the graded menu, the summaries, the
 * lines under a method, the parameters of a method and the parsing of what is typed. The fields it reads from a recipe
 * are `input`, `method`, `offered` and `layers`; a recipe without `input` reads as the default layer, one without
 * `method` as the default method.
 *
 * Switching an option off never breaks a consumer that uses it: it keeps its setting and shows that the option is no
 * longer offered, with a way to offer it again (`offeredOptions` leaves it out, `isOffered` says).
 */

// ---------------------------------------------------------------------------
// What is typed into a parameter box: one sentence per kind of mistake, the same wherever the box is

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

/** A whole number in [lo, hi], else the default. */
export function cleanWhole(value, fallback, [lo, hi]) {
    return Number.isInteger(value) && value >= lo && value <= hi ? value : fallback;
}

/** A detection threshold: a finite number from 0 up, else 0. */
export function cleanThreshold(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** The word the section gives a kind (from core/matrix_kind.py): it answers "which layer should I use". */
export function kindWord(kind) {
    return { counts: 'counts', normalised: 'normalized', log: 'log-normalized', signed: 'scaled', other: 'other' }[kind] || '';
}

/** A figure in the panel's words: 3 significant digits, a true minus sign. */
export function figure(x) {
    return String(Number(Number(x).toPrecision(3))).replace('-', '−');
}

/** "a", "a and b", "a, b and c". */
export const andList = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** Who uses an option, in words: "1 plot", "2 plots, 1 table"; empty when nothing does. */
export function useText({ plots = 0, tables = 0 } = {}) {
    const parts = [];
    if (plots) parts.push(`${plots} plot${plots === 1 ? '' : 's'}`);
    if (tables) parts.push(`${tables} table${tables === 1 ? '' : 's'}`);
    return parts.join(', ');
}

// ---------------------------------------------------------------------------
// The model

const strictSame = (key, have, want) => (have === undefined ? null : have) === want;

/**
 * @param {Object} spec - see the file comment
 * @returns {Object} the model: every function takes the recipe (or its option fields) explicitly
 */
export function createOptionsModel(spec) {
    const {
        methods, defaultMethod, defaultOffered, defaultLayer = 'X', paramDefaults = {}, sameParam = strictSame,
        paramNotes = () => [], paramLines = {}, grade, context = () => ({}), layerLines: customLayerLines = () => [],
        resetFields = ['input', 'method', 'offered', 'layers']
    } = spec;
    if (!Array.isArray(methods) || !methods.length) throw new Error('options-model: a method table is required');
    if (typeof grade !== 'function') throw new Error('options-model: a grading function is required');
    const ids = methods.map(m => m.value);
    if (new Set(ids).size !== ids.length) throw new Error('options-model: method ids must be unique');
    if (!ids.includes(defaultMethod)) throw new Error('options-model: the default method must be in the table');
    if (!Array.isArray(defaultOffered) || !defaultOffered.every(m => ids.includes(m))) {
        throw new Error('options-model: the default offered list must hold known methods');
    }

    const methodInfo = (method) => methods.find(m => m.value === method) || null;
    const methodLabel = (method) => (methodInfo(method) || { label: String(method) }).label;
    /** The name menus, titles and tags use. */
    const methodShort = (method) => (methodInfo(method) || { menu: String(method) }).menu;

    /** Whether every parameter of `method` is at its default in `recipe`. */
    function isMethodDefault(recipe, method) {
        const defaults = paramDefaults[method];
        if (!defaults) return true;
        return Object.entries(defaults).every(([key, want]) => sameParam(key, recipe[key], want));
    }

    /**
     * The methods a stored list stands for: known ids only, each once, in menu order; the default list when there is
     * none; never empty (the default method stays offered, so a source always offers something).
     */
    function cleanOffered(value, fallback = defaultMethod) {
        const wanted = new Set(Array.isArray(value) ? value.filter(m => ids.includes(m)) : defaultOffered);
        if (!wanted.size) wanted.add(ids.includes(fallback) ? fallback : defaultMethod);
        return ids.filter(m => wanted.has(m));
    }

    /** The layers a stored list stands for: text only, each once, the default layer first (it is always offered). */
    function cleanLayers(value, input) {
        const seen = new Set([input]);
        if (Array.isArray(value)) for (const name of value) if (typeof name === 'string' && name !== '') seen.add(name);
        return [...seen];
    }

    /** The layer a recipe reads by default: its own input, or the default layer when it has none (a grouping). */
    const inputOf = (recipe) => (typeof recipe.input === 'string' && recipe.input ? recipe.input : defaultLayer);
    /** The methods a recipe (or a source's option fields) offers, in menu order. */
    const offeredMethods = (recipe) => cleanOffered(recipe.offered, recipe.method);
    /** The layers it offers, in the order they were offered: the first is where a new consumer starts. */
    const offeredLayers = (recipe) => cleanLayers(recipe.layers, inputOf(recipe));

    /** Whether a consumer may pick `method` (and `layer`, when given) of this source now. */
    function isOffered(recipe, method, layer) {
        if (!offeredMethods(recipe).includes(method)) return false;
        return layer === undefined || layer === null || layer === '' || offeredLayers(recipe).includes(layer);
    }

    const gradeOf = (method, layer, kind, recipe, extra = {}) => grade(method, layer, kind, { ...context(recipe), ...extra });

    /**
     * Every offered method of every offered layer with its grade, `cannot` ones included: for the panel, which says why
     * an option is not in the menus. Order: by method (the panel's order), and within a method the layers in the order
     * they were offered, so the first entry is the first method on the first layer.
     * @param {Object} recipe
     * @param {string[]} [datasetLayers] - the matrices the dataset has; an offered layer it lacks is left out
     * @param {Object<string, string>} [kinds] - layer -> what it looks like; a layer not listed is not graded
     * @param {Object<string, Object>} [stats] - layer -> what the server sampled of it
     * @returns {Array<{id: string, method: string, layer: string, label: string, fullLabel: string, definition: string,
     *   grade: string, reason: string, code: string, note: string}>}
     *   `id` is always `method@layer`, but a consumer stores `{column: method, layer}`, never the id. `label` names the
     *   layer only when several are offered; `fullLabel` always does.
     */
    function gradedOptions(recipe, datasetLayers, kinds = {}, stats = {}) {
        const offered = offeredMethods(recipe);
        let layers = offeredLayers(recipe);
        if (Array.isArray(datasetLayers) && datasetLayers.length) {
            const have = new Set(datasetLayers);
            layers = layers.filter(name => have.has(name));
        }
        const several = layers.length > 1;
        const out = [];
        for (const method of offered) {
            for (const layer of layers) {
                const info = methodInfo(method);
                const g = gradeOf(method, layer, kinds[layer], recipe, { stats: stats[layer] });
                out.push({
                    id: `${method}@${layer}`, method, layer, label: several ? `${info.menu} · ${layer}` : info.menu,
                    fullLabel: `${info.menu} · ${layer}`, definition: info.definition, grade: g.grade, reason: g.reason, code: g.code,
                    // a combination that can be computed but misleads says so in a title, not in a notice
                    note: g.grade === 'warn' ? g.reason : ''
                });
            }
        }
        return out;
    }

    /** The menu a consumer shows: `gradedOptions` without the combinations that cannot be computed. */
    const offeredOptions = (recipe, datasetLayers, kinds, stats) => gradedOptions(recipe, datasetLayers, kinds, stats)
        .filter(o => o.grade !== 'cannot');

    /**
     * What to say under a METHOD: only what holds whatever the layer. A property of some layers is said on their rows,
     * not here; one that every offered layer has is said here too, once; a reason that holds whatever the layer
     * (`down`) always, once.
     * @returns {Array<{grade: string, code: string, text: string, down?: boolean}>}
     */
    function methodLines(method, layers, recipe, kinds = {}, stats = {}) {
        if (!layers.length) return [];
        const of = (layer, label) => gradeOf(method, layer, kinds[layer], recipe, { stats: stats[layer], label });
        const first = of(layers[0]);
        if (first.down) return [{ grade: first.grade, code: first.code, text: first.reason, down: true }];
        if (first.grade === 'ok') return [];
        const all = layers.every(l => of(l).code === first.code);
        if (!all) return [];
        if (layers.length === 1) return [{ grade: first.grade, code: first.code, text: first.reason }];
        // a threshold's message names figures of one layer: with several it stays on the rows
        if (first.code.startsWith('detect_')) return [];
        const every = of(layers[0], 'every offered layer');
        return [{ grade: every.grade, code: every.code, text: every.reason }];
    }

    /** What to say on a LAYER's row: its properties, each once and short, only when they matter for an offered method. */
    const layerLines = (layer, recipe, kind, stats) => customLayerLines(layer, recipe, kind, stats, offeredMethods(recipe));

    /**
     * The collapsed row: offered methods, then the layers. A parameter that is not at its default follows its method.
     * "z-score mean, mean, sum · X"; "z-score mean (not clipped), control-adjusted (seed 3) · X, logged_counts".
     */
    function offeredSummary(recipe) {
        const names = offeredMethods(recipe).map((m) => {
            const notes = paramNotes(recipe, m);
            return notes.length ? `${methodShort(m)} (${notes.join(', ')})` : methodShort(m);
        }).join(', ');
        return `${names} · ${offeredLayers(recipe).join(', ')}`;
    }

    /** The narrow form of the collapsed row: "3 methods · X". */
    function offeredSummaryShort(recipe) {
        const n = offeredMethods(recipe).length;
        const layers = offeredLayers(recipe);
        return `${n} method${n === 1 ? '' : 's'} · ${layers.length > 1 ? `${layers.length} layers` : layers[0]}`;
    }

    /**
     * The parameters of a method, as the recipe holds them (for the cache key and the panel): only those the method
     * uses; `paramValue` in the spec fills a missing one.
     */
    function paramsOf(recipe, method) {
        const need = (methodInfo(method) || { needs: [] }).needs;
        const out = {};
        for (const key of need) out[key] = spec.paramValue ? spec.paramValue(recipe, key) : recipe[key];
        return out;
    }

    /** The methods that use the parameter `key`: two or more means it is shared. */
    const usersOfParam = (key) => methods.filter(m => (m.needs || []).includes(key)).map(m => m.value);

    /** What the parameter `key` does, naming the value in force in `recipe`. */
    const paramLine = (key, recipe) => (paramLines[key] ? paramLines[key](recipe) : '');

    /** The option fields a reset restores, of those the spec names: the first of the default list, the default layer. */
    const defaultFields = () => {
        const all = { input: defaultLayer, method: cleanOffered(defaultOffered, defaultMethod)[0],
            offered: cleanOffered(defaultOffered, defaultMethod), layers: [defaultLayer] };
        return Object.fromEntries(resetFields.map((field) => [field, all[field]]));
    };

    /** Whether `recipe` offers exactly the defaults (methods, layers, and the first method and layer it has fields for). */
    function isDefaultOffer(recipe) {
        const d = defaultFields();
        return (!('input' in d) || recipe.input === d.input) && (!('method' in d) || recipe.method === d.method)
            && offeredMethods(recipe).join() === cleanOffered(defaultOffered, defaultMethod).join()
            && offeredLayers(recipe).join() === [defaultLayer].join();
    }

    return Object.freeze({
        methods: Object.freeze([...methods]), defaultMethod, defaultOffered: Object.freeze([...defaultOffered]), defaultLayer,
        paramDefaults, methodInfo, methodLabel, methodShort, isMethodDefault, cleanOffered, cleanLayers, offeredMethods,
        offeredLayers, inputOf, isOffered, gradedOptions, offeredOptions, methodLines, layerLines, offeredSummary, offeredSummaryShort,
        paramsOf, usersOfParam, paramLine, defaultFields, isDefaultOffer,
        /** One method × layer, graded (the provider's grading with the recipe's facts filled in). */
        gradeOption: (method, layer, kind, recipe, extra) => gradeOf(method, layer, kind, recipe, extra)
    });
}
