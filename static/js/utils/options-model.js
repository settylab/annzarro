/**
 * The model of a source's METHODS for ANY method table (decision 31): every method on every layer, each pair graded,
 * an impossible one disabled with its reason. Pure (no DOM, no page state). A provider (the gene signature's six
 * scores, the grouping's statistics) supplies:
 *
 *   methods         the method table: { value, label, menu, needs, unit, definition }; `needs` names the parameters
 *                   the method uses (keys of the recipe), and two methods may need the same one (a shared threshold)
 *   defaultMethod, defaultOffered, defaultLayer   (defaultOffered only reads a link made before decision 31)
 *   paramDefaults   { method: { key: default } }, for "Reset" under a method
 *   paramValue      (recipe, key) -> the value a method's parameter has, a missing one filled (default: the field)
 *   sameParam       (key, have, want) -> boolean; default strict equality, with a missing value read as null
 *   grade           (method, layer, kind, ctx) -> { grade: 'ok'|'warn'|'cannot', code, reason, down? }: the
 *                   provider's grading of a method on a layer of this kind. ctx = { stats, ...context(recipe) }
 *   context         (recipe) -> the recipe-dependent facts grade needs (the signature's `hasDown`, its threshold)
 *   extraMethods    entries listed after the table that read no layer: { value, label, menu, definition } (a grouping's
 *                   cell count). They are always usable and have no layer
 *
 * and gets, as ONE implementation: `methodChoices`, `layerChoices` and `pairAfter` (ALL methods and ALL of the
 * dataset's layers, graded), the parameters of a method, and the parsing of what is typed. A link made before decision
 * 31 stored `offered` and `layers`: `cleanOffered`, `cleanLayers`, `legacyPair` and `withoutLegacy` only READ them to
 * find the pair it drew, and nothing writes them back. Every grading sentence is phrased by `REASON`.
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

/**
 * The one phrasing of every grading sentence, for the signature's methods and the grouping's statistics alike (decision
 * 31): a pair that cannot be computed names the method and says why; a pair that misleads names it and says how.
 *   cannotOn('% of total', "'X'", 'it has negative values.')   "% of total cannot be computed on 'X': it has negative values."
 *   cannotWith('Sum', 'down genes', 'a signed sum ...')         "Sum cannot be computed with down genes: a signed sum ..."
 *   note('Mean', "'counts'", 'follows sequencing depth.')       "Mean on 'counts' follows sequencing depth."
 *   moved('Layer', 'logged', '% expressing', "'X'")             "Layer changed to logged: % expressing cannot be computed on 'X'."
 */
export const REASON = Object.freeze({
    cannotOn: (name, layer, why) => `${name} cannot be computed on ${layer}: ${why}`,
    cannotWith: (name, what, why) => `${name} cannot be computed with ${what}: ${why}`,
    note: (name, layer, how) => `${name} on ${layer} ${how}`,
    moved: (select, value, name, layer) => `${select} changed to ${value}: ${name} cannot be computed on ${layer}.`
});

/** A layer's name as a grading sentence quotes it. */
export const quoted = (layer) => `'${layer}'`;

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
        grade, context = () => ({}), extraMethods = []
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
     * The methods an old link's `offered` list stands for: known ids only, each once, in menu order; the default list
     * when there is none; never empty. Read by `legacyPair` only.
     */
    function cleanOffered(value, fallback = defaultMethod) {
        const wanted = new Set(Array.isArray(value) ? value.filter(m => ids.includes(m)) : defaultOffered);
        if (!wanted.size) wanted.add(ids.includes(fallback) ? fallback : defaultMethod);
        return ids.filter(m => wanted.has(m));
    }

    /** The layers an old link's `layers` list stands for: text only, each once, `input` first. Read for links only. */
    function cleanLayers(value, input) {
        const seen = new Set([input]);
        if (Array.isArray(value)) for (const name of value) if (typeof name === 'string' && name !== '') seen.add(name);
        return [...seen];
    }

    const gradeOf = (method, layer, kind, recipe, extra = {}) => grade(method, layer, kind, { ...context(recipe), ...extra });

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


    // ---------------------------------------------------------------------------------------- ungated lists (decision 31)

    const extraInfo = (method) => extraMethods.find(m => m.value === method) || null;
    /** Whether `method` reads no layer (a grouping's cell count). */
    const readsNoLayer = (method) => !!extraInfo(method);

    /** One graded entry of a select: disabled when the pair cannot be computed, the reason as its title. */
    function choice(value, label, g, extra) {
        return {
            value, label, grade: g.grade, code: g.code, reason: g.reason, note: g.grade === 'warn' ? g.reason : '',
            title: g.grade === 'ok' ? '' : g.reason, disabled: g.grade === 'cannot', ...extra
        };
    }
    const OK = Object.freeze({ grade: 'ok', code: '', reason: '' });

    /**
     * The METHOD select: every method of the table (and the extras that read no layer), each graded on `layer`. A pair
     * that cannot be computed is `disabled` with its reason as `title`; a `warn` one stays enabled with its note as the
     * title. The `held` method stays selectable when impossible, marked `lapsed` and labelled "(not available)": a link
     * that stored it keeps drawing nothing and says why (SHR-27).
     * @param {{recipe?: Object, layer?: (string|null), kinds?: Object<string, string>, stats?: Object<string, Object>, held?: string}} opts
     *   `layer` null/undefined grades nothing
     * @returns {Array<{value: string, label: string, name: string, definition: string, grade: string, code: string,
     *   reason: string, note: string, title: string, disabled: boolean, lapsed?: boolean}>}
     */
    function methodChoices({ recipe = {}, layer, kinds = {}, stats = {}, held } = {}) {
        const out = methods.map((m) => {
            const g = layer ? gradeOf(m.value, layer, kinds[layer], recipe, { stats: stats[layer] }) : OK;
            return choice(m.value, m.menu, g, { name: m.label, definition: m.definition });
        });
        for (const m of extraMethods) out.push(choice(m.value, m.menu, OK, { name: m.label, definition: m.definition || '' }));
        return out.map((e) => (e.disabled && e.value === held
            ? { ...e, disabled: false, lapsed: true, label: `${e.label} (not available)` } : e));
    }

    /**
     * The LAYER select: every layer of the dataset (X first as given), each graded for `method`. Empty for a method
     * that reads no layer. A `held` layer the dataset lacks is kept and marked, an impossible one as in `methodChoices`.
     * @param {{recipe?: Object, method: string, datasetLayers?: string[], kinds?: Object<string, string>,
     *   stats?: Object<string, Object>, held?: string}} opts
     */
    function layerChoices({ recipe = {}, method, datasetLayers, kinds = {}, stats = {}, held } = {}) {
        if (readsNoLayer(method)) return [];
        const layers = [...new Set(Array.isArray(datasetLayers) && datasetLayers.length ? datasetLayers : [defaultLayer])];
        const out = layers.map((layer) => {
            const g = method ? gradeOf(method, layer, kinds[layer], recipe, { stats: stats[layer] }) : OK;
            const e = choice(layer, layer, g, {});
            return e.disabled && layer === held ? { ...e, disabled: false, lapsed: true, label: `${layer} (not available)` } : e;
        });
        if (held && !layers.includes(held)) out.push(choice(held, `${held} (not in this dataset)`, OK, { lapsed: true }));
        return out;
    }

    /**
     * Both selects after the user touched one: the select touched wins and the other moves, to the first usable value,
     * only when its value is now impossible. `say` names it once ("Layer changed to logged: % expressing cannot be
     * computed on 'X'."); `impossible` is true when nothing else works, and the pair is then left as the user made it.
     * @param {'method'|'layer'} changed - the select the user touched
     * @param {string} value - what it now says
     * @param {{method?: string, layer?: string}} pair - the other select's value (the touched one's old value is ignored)
     * @param {{recipe?: Object, datasetLayers?: string[], kinds?: Object, stats?: Object}} [ctx]
     * @returns {{method: string, layer: (string|null), moved: ('method'|'layer'|null), say: string, impossible?: boolean}}
     */
    function pairAfter(changed, value, pair, ctx = {}) {
        const { recipe = {}, datasetLayers, kinds = {}, stats = {} } = ctx;
        const usable = (list) => list.filter(e => !e.disabled);
        if (changed === 'method') {
            const method = value;
            if (readsNoLayer(method)) return { method, layer: null, moved: null, say: '' };
            const layers = layerChoices({ recipe, method, datasetLayers, kinds, stats });
            const have = pair && pair.layer ? layers.find(e => e.value === pair.layer) : null;
            if (have && !have.disabled) return { method, layer: have.value, moved: null, say: '' };
            const next = usable(layers)[0];
            if (!next) return { method, layer: (pair && pair.layer) || defaultLayer, moved: null, say: '', impossible: true };
            const wasLayer = (pair && pair.layer) || defaultLayer;
            return { method, layer: next.value, moved: 'layer',
                say: REASON.moved('Layer', next.value, methodShort(method), quoted(wasLayer)) };
        }
        const layer = value;
        const wasMethod = pair && pair.method;
        if (wasMethod && readsNoLayer(wasMethod)) return { method: wasMethod, layer, moved: null, say: '' };
        const list = methodChoices({ recipe, layer, kinds, stats });
        const have = wasMethod ? list.find(e => e.value === wasMethod) : null;
        if (have && !have.disabled) return { method: have.value, layer, moved: null, say: '' };
        const next = usable(list)[0];
        if (!next) return { method: wasMethod || defaultMethod, layer, moved: null, say: '', impossible: true };
        return { method: next.value, layer, moved: 'method',
            say: REASON.moved('Method', next.label, methodShort(wasMethod || defaultMethod), quoted(layer)) };
    }

    /** What a stored `offered`/`layers` meant as the default pair: see `legacyPair` below. */
    const legacy = (raw) => legacyPair(api, raw);

    const api = {
        methods: Object.freeze([...methods]), defaultMethod, defaultOffered: Object.freeze([...defaultOffered]), defaultLayer,
        paramDefaults, methodInfo, methodLabel, methodShort, isMethodDefault, cleanOffered, cleanLayers, paramsOf,
        /** One method × layer, graded (the provider's grading with the recipe's facts filled in). */
        gradeOption: (method, layer, kind, recipe, extra) => gradeOf(method, layer, kind, recipe, extra),
        methodChoices, layerChoices, pairAfter, readsNoLayer, legacyPair: legacy
    };
    return Object.freeze(api);
}

// ---------------------------------------------------------------------------
// The free forms, for a caller that holds a model as `source`, and the readers of the retired `offered`/`layers`

/** `model.methodChoices` with the model as `source`. */
// export-unused-ok: the free form for a caller that holds a model as `source` (Node tests pin it)
export const methodChoices = ({ source, ...rest }) => source.methodChoices(rest);
/** `model.layerChoices` with the model as `source`. */
// export-unused-ok: the free form for a caller that holds a model as `source` (Node tests pin it)
export const layerChoices = ({ source, ...rest }) => source.layerChoices(rest);
/** `model.pairAfter`; the model is `ctx.source`. */
// export-unused-ok: the free form for a caller that holds a model as `source` (Node tests pin it)
export const pairAfter = (changed, value, pair, { source, ...rest }) => source.pairAfter(changed, value, pair, rest);

/**
 * What a stored `offered`/`layers` meant before decision 31, as the pair an unset consumer resolved to: the first
 * offered method (menu order, or the stored `method` once `offered` is gone) on `input`, or on the first layer when no input was stored, else X. Only READ it, to keep
 * an old link drawing what it drew; nothing writes `offered` or `layers` back (`withoutLegacy`).
 * @param {Object} model - an options model
 * @param {Object} [raw] - a stored recipe or options
 * @returns {{method: string, layer: string}}
 */
export function legacyPair(model, raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    // a recipe stripped of `offered` (what is stored now) keeps its `method`; an old one names it by its first offered
    const method = !Array.isArray(src.offered) && model.methodInfo(src.method) ? src.method
        : model.cleanOffered(src.offered, model.methodInfo(src.method) ? src.method : model.defaultMethod)[0];
    let layer = typeof src.input === 'string' && src.input ? src.input : '';
    if (!layer && Array.isArray(src.layers)) layer = src.layers.find(name => typeof name === 'string' && name !== '') || '';
    return { method, layer: layer || model.defaultLayer };
}

/** A copy of stored options or a recipe without the retired `offered` and `layers`. */
export function withoutLegacy(raw) {
    const out = { ...(raw && typeof raw === 'object' ? raw : {}) };
    delete out.offered;
    delete out.layers;
    return out;
}
