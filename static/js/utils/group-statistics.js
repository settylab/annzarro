/**
 * The per-group statistics a plot reads of a gene (the Cell-Gene Plot's Color, Size and Height; SHR-25, SHR-27, decision
 * 31): what each is, how it grades on a layer, and the one detection threshold two of them read. Pure (no DOM, no page
 * state), so Node tests hold it and the Cell-Gene Plot's menus build on it.
 *
 * It is the METHOD TABLE of group statistics for the shared options model (utils/options-model.js, SHR-25); the
 * signature's (utils/signature-options.js) is the other. Decision 31: nothing is offered. Every consumer lists all five
 * statistics and Cell count on all layers (`statisticChoices`, `statisticLayerChoices`), and a pair a layer cannot give
 * is disabled with its reason (SHR-27, `core/matrix_kind.py` through `statisticAvailability`). The threshold lives on
 * each measure (CXG-9). A grouping recipe's retired `offered`, `layers` and `detect_above` are only read: the last is
 * pinned once into the plots that relied on it (panels/cell-gene/sections.js `pinThreshold`).
 *
 * Cell count needs no feature and no layer: it is listed after the table, never graded.
 */
import { createOptionsModel, andList, figure } from './options-model.js';
import { STATISTIC_IDS } from './cell-grouping.js';
import { statisticAvailability } from './cell-gene-model.js';
import { VOCABULARY } from './vocabulary.js';
import { countsAs, emptyUsage } from './consumer-kinds.js';

const NAME = VOCABULARY.cellGene.statistic;

/** The statistics a consumer picks from, in the order menus list them. `menu` is the name in running text. */
// export-unused-ok: consumed by X3a and C2a (statistic menus read the same table)
export const STATISTIC_INFO = Object.freeze([
    { value: 'mean', label: NAME.mean, menu: 'mean', needs: [], unit: 'layer units',
        definition: 'Average over the group\'s cells, zeros included.' },
    { value: 'pct_expressing', label: NAME.pct_expressing, menu: '% expressing', needs: ['detect_above'], unit: '0 to 100',
        definition: 'Share of the group\'s cells above the threshold, 0 to 100.' },
    { value: 'mean_expressing', label: NAME.mean_expressing, menu: 'mean of expressing cells', needs: ['detect_above'], unit: 'layer units',
        definition: 'Average over the cells above the threshold.' },
    { value: 'sum', label: NAME.sum, menu: 'sum', needs: [], unit: 'layer units',
        definition: 'Total over the group\'s cells (pseudobulk).' },
    { value: 'sd', label: NAME.sd, menu: 'SD', needs: [], unit: 'layer units',
        definition: 'Spread over the group\'s cells.' }
]);

/** Offered until the grouping says otherwise (SHR-26). */
// export-unused-ok: consumed by X3a (a new plot's first statistics)
export const DEFAULT_STATISTICS = Object.freeze(['mean', 'pct_expressing']);
/** The statistic that is offered whatever the recipe says: it reads no feature. */
// export-unused-ok: consumed by X3a and C2a (cell count is in every menu)
export const ALWAYS_OFFERED = 'count';
const DEFAULT_LAYER = 'X';
const THRESHOLD_USERS = STATISTIC_INFO.filter((m) => m.needs.includes('detect_above')).map((m) => m.value);
/** The statistic a dot plot's size starts on (SHR-27). */
const SIZE_STATISTIC = 'pct_expressing';
/** The statistics that follow how deeply a cell was sequenced, on raw counts. */
const DEPTH_STATISTICS = Object.freeze(['mean', 'sum', 'sd']);

/** "% expressing is not available on X: X has negative values. Choose a layer." (SHR-27) */
// export-unused-ok: consumed by X3a (the control says it where a size would have been)
export function negativeValuesSentence(stat, layer) {
    return `${NAME[stat]} is not available on ${layer}: ${layer} has negative values. Choose a layer.`;
}

/**
 * How one statistic reads one layer, from what the layer looks like (`kind` of core/matrix_kind.py): `ok`, `warn` (it
 * can be computed but misleads: said in a title) or `cannot` (left out of menus, and the panel says why).
 * @param {string} stat
 * @param {string} layer
 * @param {string} [kind] - counts, normalised, log, signed or other; undefined while unknown, and then nothing is assumed
 * @param {{label?: string}} [ctx] - what to call the layer in the sentence (the panel says "every offered layer" when all share the issue)
 * @returns {{grade: 'ok'|'warn'|'cannot', code: string, reason: string}}
 */
// export-unused-ok: consumed by X3a and C2a (menus grade a statistic on a layer)
export function statisticGrade(stat, layer, kind, ctx = {}) {
    const name = ctx.label || `'${layer}'`;
    if (!statisticAvailability(stat, kind).available) {
        return { grade: 'cannot', code: 'negative_values',
            reason: ctx.label ? `${NAME[stat]} is not available on ${ctx.label}: they have negative values.` : negativeValuesSentence(stat, layer) };
    }
    if (kind === 'counts' && DEPTH_STATISTICS.includes(stat)) {
        return { grade: 'warn', code: 'depth', reason: `On ${name} this follows sequencing depth.` };
    }
    if (kind === 'log' && stat === 'sum') {
        return { grade: 'warn', code: 'log', reason: `On ${name} a sum of log values is not a total of the counts. It is usually read from counts.` };
    }
    return { grade: 'ok', code: '', reason: '' };
}

const info = (stat) => STATISTIC_INFO.find((m) => m.value === stat);
const menuNames = (ids) => andList(ids.map((id) => info(id).menu));

/** What to say on a LAYER's row: its properties, each once and short, only when they matter for an offered statistic. */
function layerLines(layer, recipe, kind, stats, offered) {
    const lines = [];
    const cannot = THRESHOLD_USERS.filter((s) => !statisticAvailability(s, kind).available);
    if (cannot.length && THRESHOLD_USERS.some((s) => offered.includes(s))) {
        lines.push({ grade: 'cannot', code: 'negative_values',
            text: `${menuNames(cannot)} are not available on ${layer}: ${layer} has negative values.` });
    }
    const depth = offered.filter((s) => DEPTH_STATISTICS.includes(s));
    if (kind === 'counts' && depth.length) {
        lines.push({ grade: 'warn', code: 'depth', text: `Raw counts: ${menuNames(depth)} follow${depth.length === 1 ? 's' : ''} sequencing depth.` });
    }
    if (kind === 'log' && offered.includes('sum')) {
        lines.push({ grade: 'warn', code: 'log', text: 'Log values: a sum of them is not a total of the counts. It is usually read from counts.' });
    }
    return lines;
}

const thresholdOf = (recipe) => (typeof recipe.detect_above === 'number' && Number.isFinite(recipe.detect_above) ? recipe.detect_above : 0);

/** What the detection threshold does: names the statistics that use it and the value in force. */
export function thresholdLine(recipe) {
    return `Used by ${menuNames(THRESHOLD_USERS)}. Now: above ${figure(thresholdOf(recipe))}.`;
}

/** The grouping's statistics as an options model (SHR-25). */
export const GROUP_STATISTICS_MODEL = createOptionsModel({
    methods: STATISTIC_INFO, defaultMethod: 'mean', defaultOffered: DEFAULT_STATISTICS, defaultLayer: DEFAULT_LAYER,
    paramDefaults: { pct_expressing: { detect_above: 0 }, mean_expressing: { detect_above: 0 } },
    sameParam: (key, have, want) => (have === undefined ? 0 : have) === want,
    paramNotes: (recipe, method) => (info(method).needs.includes('detect_above') && thresholdOf(recipe) !== 0 ? [`above ${thresholdOf(recipe)}`] : []),
    paramLines: { detect_above: thresholdLine },
    paramValue: (recipe, key) => (key === 'detect_above' ? thresholdOf(recipe) : recipe[key]),
    grade: (method, layer, kind, ctx) => statisticGrade(method, layer, kind, ctx),
    layerLines,
    extraMethods: [{ value: ALWAYS_OFFERED, label: NAME.count, menu: 'cell count', definition: 'Number of cells in the group. Reads no layer.' }],
    // a grouping's recipe has no `input` and no `method`: it names what it offers and nothing else
    resetFields: ['offered', 'layers']
});

/** Decision 31: all five statistics and Cell count on `layer`, impossible ones disabled with their reason. See options-model.js. */
export const { methodChoices: statisticChoices, layerChoices: statisticLayerChoices, pairAfter: statisticPairAfter } = GROUP_STATISTICS_MODEL;

/**
 * Where a dot plot's size starts (SHR-27): % expressing on X (or the layer picked), or nothing and the sentence that says
 * why when that layer cannot give it. Nothing is drawn until the user picks another layer. Every layer is pickable (decision 31).
 * @param {Object} recipe - the grouping's recipe
 * @param {Object<string, string>} kinds - layer -> what it looks like; a layer not listed is not yet known
 * @param {string} [picked] - the layer the user chose
 * @returns {{stat: (string|null), layer: (string|null), say: string, pending: boolean}} `pending`: the layer's kind is not
 *   known yet, so nothing is drawn and nothing is said
 */
// export-unused-ok: consumed by X3a (the dot plot's size)
export function sizeDefault(recipe, kinds, picked) {
    const none = { stat: null, layer: null, say: '', pending: false };
    const model = GROUP_STATISTICS_MODEL;
    const layer = picked === undefined || picked === null ? DEFAULT_LAYER : picked;
    const kind = kinds[layer];
    if (kind === undefined) return { stat: null, layer, say: '', pending: true };
    const g = model.gradeOption(SIZE_STATISTIC, layer, kind, recipe);
    if (g.grade === 'cannot') return { ...none, say: g.reason };
    return { stat: SIZE_STATISTIC, layer, say: '', pending: false };
}

/**
 * Who uses what, counted from the kinds of the consumers (consumer-kinds.js: a plot, a table or a grouping uses, Inspect
 * only looks). A consumer says what it reads in its option: `statistics: [{stat, layer}]`. It counts once for a
 * statistic and once for a layer however often it reads them.
 * @param {Array<{kind: string, option?: {statistics?: Array<{stat: string, layer?: string}>}}>} handles - consumers of the grouping
 * @returns {{statistics: Array<Object>, layers: Array<Object>}} usage rows `{value, plots, tables, groupings}`, statistics in
 *   menu order, layers in the order first read
 */
export function statisticUsage(handles) {
    const stats = new Map();
    const layers = new Map();
    const bump = (rows, value, field) => {
        const row = rows.get(value) || emptyUsage(value);
        row[field]++;
        rows.set(value, row);
    };
    for (const handle of handles) {
        const field = countsAs(handle.kind);
        if (field === null) continue;
        const read = (handle.option && handle.option.statistics) || [];
        for (const stat of new Set(read.map((r) => r.stat))) bump(stats, stat, field);
        for (const layer of new Set(read.filter((r) => r.stat !== ALWAYS_OFFERED).map((r) => r.layer || DEFAULT_LAYER))) bump(layers, layer, field);
    }
    const order = [...STATISTIC_IDS];
    return { statistics: [...stats.values()].sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value)), layers: [...layers.values()] };
}

// ================================================================================================ a new plot's measures (decision 24)

/**
 * The first layer that looks log-normalised and the first that holds raw counts, by what the numbers look like
 * (`kind` of core/matrix_kind.py), never by a layer's name; null for one not found.
 * @param {string[]} layers - the dataset's matrices, X first
 * @param {Object<string, string>} kinds - layer -> kind; a layer not listed is not known yet
 * @returns {{log: (string|null), counts: (string|null)}}
 */
function kindLayers(layers, kinds) {
    const first = (kind) => layers.find((l) => kinds[l] === kind) || null;
    return { log: first('log'), counts: first('counts') };
}

/**
 * Color and Size of a new Cell-Gene Plot (decision 24, kept by decision 32 on both axis kinds): the mean on the
 * log-normalised layer and % expressing on the counts layer above 0, when matrix-kind facts identify both among ALL the
 * dataset's layers; else both on X.
 * @param {string[]} layers - the dataset's matrices, X first
 * @param {Object<string, string>} kinds
 * @returns {{color: Object, size: Object}}
 */
export function defaultMeasures(layers, kinds) {
    const { log, counts } = kindLayers(layers, kinds);
    if (log && counts) return { color: { stat: 'mean', layer: log }, size: { stat: SIZE_STATISTIC, layer: counts, detect_above: 0 } };
    return { color: { stat: 'mean', layer: DEFAULT_LAYER }, size: { stat: SIZE_STATISTIC, layer: DEFAULT_LAYER } };
}
