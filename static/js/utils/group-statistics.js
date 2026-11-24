/**
 * The per-group statistics a plot reads of a gene (the Cell-Gene Plot's Color, Size and Height; SHR-25, SHR-27, decision
 * 31): what each is, how it grades on a layer, and the one detection threshold two of them read. Pure (no DOM, no page
 * state), so Node tests hold it and the Cell-Gene Plot's menus build on it.
 *
 * It is the METHOD TABLE of group statistics for the shared options model (utils/options-model.js, SHR-25); the
 * signature's (utils/signature-options.js) is the other. Decision 31: every consumer lists all five
 * statistics and Cell count on all layers (`statisticChoices`, `statisticLayerChoices`), and a pair a layer cannot give
 * is disabled with its reason (SHR-27, `core/matrix_kind.py` through `statisticAvailability`). The threshold is the
 * grouping's method parameter (`detect_above`, decision 34); a measure may hold its own (CXG-9). A grouping recipe's
 * retired `offered` and `layers` are only read.
 *
 * Cell count needs no feature and no layer: it is listed after the table, never graded.
 */
import { REASON, createOptionsModel, andList, figure, quoted } from './options-model.js';
import { STATISTIC_IDS } from './cell-grouping.js';
import { statisticAvailability } from './cell-gene-model.js';
import { VOCABULARY } from './vocabulary.js';
import { countsAs, emptyUsage } from './consumer-kinds.js';

const NAME = VOCABULARY.cellGene.statistic;
const Z_CANNOT = VOCABULARY.cellGene.zscoreCannot;

/** The statistics a consumer picks from, in the order menus list them. `menu` is the name in running text. */
// export-unused-ok: consumed by X3a and C2a (statistic menus read the same table)
export const STATISTIC_INFO = Object.freeze([
    { value: 'zscore_mean', label: NAME.zscore_mean, menu: 'z-score mean', needs: [], unit: 'SD',
        definition: 'Each gene scaled to mean 0 and SD 1 over all cells of the dataset (clipped at ±10), then averaged over the group\'s cells. The same number as a one-gene signature\'s z-score mean.' },
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

/** The statistics a new plot starts on, and what an old link's empty `offered` meant (SHR-26). */
// export-unused-ok: consumed by X3a (a new plot's first statistics)
export const DEFAULT_STATISTICS = Object.freeze(['mean', 'pct_expressing']);
/** The statistic every menu lists after the table: it reads no feature and no layer. */
// export-unused-ok: consumed by X3a and C2a (cell count is in every menu)
export const CELL_COUNT = 'count';
const DEFAULT_LAYER = 'X';
const THRESHOLD_USERS = STATISTIC_INFO.filter((m) => m.needs.includes('detect_above')).map((m) => m.value);
/** The statistic a dot plot's size starts on (SHR-27). */
const SIZE_STATISTIC = 'pct_expressing';
/** The statistics that follow how deeply a cell was sequenced, on raw counts. */
const DEPTH_STATISTICS = Object.freeze(['zscore_mean', 'mean', 'sum', 'sd']);

/** "% expressing cannot be computed on 'X': it has negative values. Choose a layer." (SHR-27) */
// export-unused-ok: consumed by X3a (the control says it where a size would have been)
export function negativeValuesSentence(stat, layer) {
    return `${REASON.cannotOn(NAME[stat], quoted(layer), 'it has negative values.')} Choose a layer.`;
}

/**
 * How one statistic reads one layer, from what the layer looks like (`kind` of core/matrix_kind.py): `ok`, `warn` (it
 * can be computed but misleads: said in a title) or `cannot` (left out of menus, and the panel says why).
 * @param {string} stat
 * @param {string} layer
 * @param {string} [kind] - counts, normalised, log, signed or other; undefined while unknown, and then nothing is assumed
 * @returns {{grade: 'ok'|'warn'|'cannot', code: string, reason: string}}
 */
// export-unused-ok: consumed by X3a and C2a (menus grade a statistic on a layer)
export function statisticGrade(stat, layer, kind) {
    const name = quoted(layer);
    if (!statisticAvailability(stat, kind).available) {
        return { grade: 'cannot', code: 'negative_values', reason: negativeValuesSentence(stat, layer) };
    }
    if (kind === 'counts' && DEPTH_STATISTICS.includes(stat)) {
        return { grade: 'warn', code: 'depth', reason: REASON.note(NAME[stat], name, 'follows sequencing depth.') };
    }
    if (kind === 'log' && stat === 'sum') {
        return { grade: 'warn', code: 'log', reason: REASON.note(NAME[stat], name, 'is a sum of log values, not a total of the counts: it is usually read from counts.') };
    }
    return { grade: 'ok', code: '', reason: '' };
}

const info = (stat) => STATISTIC_INFO.find((m) => m.value === stat);
const menuNames = (ids) => andList(ids.map((id) => info(id).menu));

const thresholdOf = (recipe) => (typeof recipe.detect_above === 'number' && Number.isFinite(recipe.detect_above) ? recipe.detect_above : 0);

/** What the detection threshold does: names the statistics that use it and the value in force. */
// export-unused-ok: the model's line for detect_above; Node tests (group-statistics.test.mjs) hold its wording
export function thresholdLine(recipe) {
    return `Used by ${menuNames(THRESHOLD_USERS)}. Now: above ${figure(thresholdOf(recipe))}.`;
}

// ================================================================================================ Methods ▾ (decision 34)

/**
 * The words of the Methods pop-over of a Cell Grouping and a Cell Table (offered-removal-080.md 10.2): the source sets
 * the parameters of each statistic, for every layer; plots choose the statistic and the layer. Nothing is gated.
 */
export const METHODS_TEXT = Object.freeze({
    label: 'Methods',
    title: 'Methods',
    intro: 'Statistics over a group\'s cells. Plots choose the statistic and the layer; these settings apply on every layer.',
    tableIntro: 'Statistics over the table\'s cells. Plots choose the statistic and the layer; these settings apply on every layer.',
    plainTitle: 'The settings of each statistic',
    notUsed: 'No plot reads these statistics yet.',
    reset: 'Reset to defaults'
});

/** A statistic's definition over a Cell Table's cells rather than a group's (the table's Methods ▾). */
export function tableDefinition(m) {
    return m.definition.replace(/the group's cells/g, 'the table\'s cells');
}

/**
 * The parameters of the statistics, listed under the last statistic that uses each. Only Expressed above today (mean,
 * sum and SD take none; scaling is a plot option).
 */
export const METHOD_PARAMS = Object.freeze([
    Object.freeze({ key: 'detect_above', label: 'Expressed above', default: 0, users: THRESHOLD_USERS, after: THRESHOLD_USERS[THRESHOLD_USERS.length - 1],
        name: 'A cell counts as expressing above this value', line: thresholdLine })
]);

/**
 * The method fields of a Cell Table's configuration (`methods: {detect_above}`), cleaned: a parameter at its default or
 * not valid is left out, so the field is omitted at default and a link stays as short as before.
 * @param {*} raw
 * @returns {{detect_above?: number}}
 */
export function cleanMethods(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    const t = raw.detect_above;
    if (typeof t === 'number' && Number.isFinite(t) && t > 0) out.detect_above = t;
    return out;
}

/** The parameters not at their default, in words ("expressed above 2"); empty when all are. Said on the button's title. */
export function methodsSummary(fields) {
    const t = thresholdOf(fields || {});
    return t !== 0 ? `expressed above ${figure(t)}` : '';
}

/**
 * Who reads a source's statistics, one entry per consumer panel: "Cell-Gene Plot 1 (% expressing · counts, mean · logged)".
 * @param {Array<{kind: string, panelId?: string, option?: {statistics?: Array<{stat: string, layer?: string}>}}>} handles
 * @param {(panelId: string) => string} titleOf - a panel's title ('' for one not found)
 * @returns {string[]}
 */
export function methodsUsedBy(handles, titleOf) {
    const byPanel = new Map();
    for (const h of handles || []) {
        if (countsAs(h.kind) === null || !h.panelId) continue;
        const pairs = byPanel.get(h.panelId) || [];
        for (const r of (h.option && h.option.statistics) || []) {
            const known = info(r.stat);
            const text = known ? `${known.menu} · ${r.layer || DEFAULT_LAYER}` : 'cell count';
            if (!pairs.includes(text)) pairs.push(text);
        }
        byPanel.set(h.panelId, pairs);
    }
    return [...byPanel].map(([pid, pairs]) => {
        const title = titleOf(pid) || pid;
        return pairs.length ? `${title} (${pairs.join(', ')})` : title;
    });
}

/** The group statistics as an options model (SHR-25). */
// export-unused-ok: the `source` of options-model.js's free forms (methodChoices, layerChoices, pairAfter); Node tests read it
export const GROUP_STATISTICS_MODEL = createOptionsModel({
    methods: STATISTIC_INFO, defaultMethod: 'mean', defaultOffered: DEFAULT_STATISTICS, defaultLayer: DEFAULT_LAYER,
    paramDefaults: { pct_expressing: { detect_above: 0 }, mean_expressing: { detect_above: 0 } },
    sameParam: (key, have, want) => (have === undefined ? 0 : have) === want,
    paramValue: (recipe, key) => (key === 'detect_above' ? thresholdOf(recipe) : recipe[key]),
    grade: (method, layer, kind) => statisticGrade(method, layer, kind),
    extraMethods: [{ value: CELL_COUNT, label: NAME.count, menu: 'cell count', definition: 'Number of cells in the group. Reads no layer.' }]
});

/** Decision 31: all five statistics and Cell count on `layer`, impossible ones disabled with their reason. See options-model.js. */
export const { layerChoices: statisticLayerChoices, pairAfter: statisticPairAfter } = GROUP_STATISTICS_MODEL;

/**
 * The consumers that cannot show a statistic, and why (aggregation-unify-080 2.4): Size cannot show a sign, and a Gene
 * Plot's cell group has no z-score mean until every gene's mean and SD over all cells is read (Q1). Each is one entry here, so
 * the answer is flipped in one place. Color and Height can, so can a caller that names no consumer.
 */
const CANNOT_FOR = Object.freeze({
    size: Object.freeze({ zscore_mean: Z_CANNOT.size }),
    genes: Object.freeze({ zscore_mean: Z_CANNOT.genes })
});

/**
 * The statistic list of a consumer: `GROUP_STATISTICS_MODEL.methodChoices`, and where the consumer cannot show a
 * statistic that entry is disabled with its reason (a held one stays, marked "(not available)", as a layer's does).
 * @param {{recipe?: Object, layer?: (string|null), kinds?: Object<string, string>, held?: string, consumer?: ('color'|'size'|'height'|'genes')}} [opts]
 */
export function statisticChoices({ consumer, ...rest } = {}) {
    const list = GROUP_STATISTICS_MODEL.methodChoices(rest);
    const cannot = CANNOT_FOR[consumer];
    if (!cannot) return list;
    return list.map((e) => {
        if (!cannot[e.value]) return e;
        const out = { ...e, grade: 'cannot', code: 'consumer', reason: cannot[e.value], title: cannot[e.value], note: '' };
        if (e.value === rest.held) return { ...out, disabled: false, lapsed: true, label: `${e.label} (not available)` };
        return { ...out, disabled: true };
    });
}

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
// export-unused-ok: kept by decision 31's SO-1 row (who reads which statistic); the Statistics pop-over that showed it is gone
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
        for (const layer of new Set(read.filter((r) => r.stat !== CELL_COUNT).map((r) => r.layer || DEFAULT_LAYER))) bump(layers, layer, field);
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
 * log-normalised layer and % expressing on the counts layer (above the grouping's threshold, 0 by default), when matrix-kind facts identify both among ALL the
 * dataset's layers; else both on X.
 * @param {string[]} layers - the dataset's matrices, X first
 * @param {Object<string, string>} kinds
 * @returns {{color: Object, size: Object}}
 */
export function defaultMeasures(layers, kinds) {
    const { log, counts } = kindLayers(layers, kinds);
    // no threshold of its own: Size follows the grouping's Expressed above (decision 35), 0 unless the grouping says otherwise
    if (log && counts) return { color: { stat: 'mean', layer: log }, size: { stat: SIZE_STATISTIC, layer: counts } };
    return { color: { stat: 'mean', layer: DEFAULT_LAYER }, size: { stat: SIZE_STATISTIC, layer: DEFAULT_LAYER } };
}
