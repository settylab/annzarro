/**
 * The Cell-Gene Plot's configuration and its gene axis (0.8.0 step X3a; CXG-3 to CXG-9, CXG-18, OD 15, UX 3.2, plan 1.6).
 *
 * Two parts, one file, so the panel and the Node tests read one definition:
 *
 * - THE MODEL (pure, no DOM, no page state): the `cell-gene` configuration of version 1 and its normaliser, the
 *   references it holds (the cell axis grouping and each section's source), the operations of the section list (each
 *   returns a new configuration, so every edit can be one undoable step), a section's genes and counts, the one list a
 *   one-row section's Color and Size choose from, the features one request asks for, and the matrix built from their
 *   moments.
 * - THE SECTION LIST (`createSectionList`): the "Genes" rows of UX 3.2 drawn from that model, wired to the panel's
 *   callbacks.
 *
 * **One request, each part once (CXG-9, CXG-18, OD 15).** `planFeatures` names every feature the drawing reads by the
 * key the group store caches it under (the feature as the request carries it), so a gene read by two sections, by its
 * own row and by a one-row section, or by Color and Size on one layer, is one feature, asked for once. A statistic that
 * uses no threshold reads the features of one that does on the same layer, so mean and % expressing share them. Only a
 * score aggregation adds a score feature; summaries never do.
 *
 * Words the user reads come from utils/vocabulary.js where it has them (statistics, aggregations, headings, help).
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import {
    ROW_AGGREGATIONS, DEFAULT_ROW_AGGREGATIONS, SCALINGS, statisticColumn, noExpressingCells, pooledReference, scale, setRow
} from '../../utils/cell-gene-model.js';
import { STATISTIC_IDS } from '../../utils/cell-grouping.js';
import { stableStringify } from '../../utils/url-history.js';
import { cellGroupType } from '../../utils/cell-group-source.js';
import { DEFAULT_METHOD } from '../../utils/signature-options.js';

const CG = VOCABULARY.cellGene;

/** The source type of a grouping as a cell axis: the provider's (utils/cell-group-source.js), never a literal here. */
export const GROUP_AXIS = cellGroupType();

/** The value of "Same as Color" in Height's statistic select (UX 6b): stored as no `height`. */
export const SAME_AS_COLOR = '__same_as_color__';

/** The most genes a section draws (CXG-17); utils/cell-gene-model.js `matrixLimits` holds the same number. */
const GENES_PER_SECTION_MAX = 2000;

const MODES = Object.freeze(['dots', 'heatmap']);
const ROWS = Object.freeze(['genes', 'set']);
const DEFAULT_LAYER = 'X';
const DEFAULT_COLOR = Object.freeze({ stat: 'mean', layer: DEFAULT_LAYER });
const DEFAULT_SIZE = Object.freeze({ stat: 'pct_expressing', layer: DEFAULT_LAYER });
/** The statistics that compare each cell with an expression threshold. */
const THRESHOLD_STATS = Object.freeze(['pct_expressing', 'mean_expressing']);

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v !== '';
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const fmt = (n) => Number(n).toLocaleString('en-US');

// ================================================================================================ the configuration

/** A statistic setting `{stat, layer, detect_above?}`: known fields cleaned, others kept. */
function cleanStatistic(raw, fallback, what, problems) {
    if (!isObject(raw)) return { ...fallback };
    const out = { ...raw };
    if (!STATISTIC_IDS.includes(raw.stat)) {
        problems.push(`${what}: unknown statistic ${JSON.stringify(raw.stat)}, ${fallback.stat} used`);
        out.stat = fallback.stat;
    }
    if (out.stat === 'count') {
        delete out.layer;
    } else if (!isText(raw.layer)) {
        if ('layer' in raw) problems.push(`${what}: no layer, ${DEFAULT_LAYER} used`);
        out.layer = DEFAULT_LAYER;
    }
    if ('detect_above' in raw && !isNumber(raw.detect_above)) {
        problems.push(`${what}: detect_above is not a number, left out`);
        delete out.detect_above;
    }
    return out;
}

/** The views a plot can be drawn in (UX 6b): absent is 2D. */
const VIEWS = Object.freeze(['3d']);

const isPoint = (v) => isObject(v) && isNumber(v.x) && isNumber(v.y) && isNumber(v.z);

/** A stored 3D camera `{eye, center?, up?}` (UX 6b), as Plotly's `scene.camera` gives it; null when it cannot be read. */
function cleanCamera(raw) {
    if (!isObject(raw) || !isPoint(raw.eye)) return null;
    const out = { eye: { x: raw.eye.x, y: raw.eye.y, z: raw.eye.z } };
    for (const key of ['center', 'up']) if (isPoint(raw[key])) out[key] = { x: raw[key].x, y: raw[key].y, z: raw[key].z };
    return out;
}

/** A one-row section's aggregation `{agg}` or `{agg, column, layer, above?}`; null when it cannot be kept. */
function cleanAggregation(raw) {
    if (!isObject(raw)) return null;
    const def = ROW_AGGREGATIONS[raw.agg];
    if (!def) return null;
    if (def.kind === 'score' && !isText(raw.column)) return null;
    const out = { ...raw };
    if (def.kind === 'score' && !isText(raw.layer)) out.layer = DEFAULT_LAYER;
    if ('above' in out && !isNumber(out.above)) delete out.above;
    return out;
}

function cleanSection(raw, i, problems) {
    if (!isObject(raw) || !isText(raw.source)) {
        problems.push(`section ${i + 1}: no source, left out`);
        return null;
    }
    const out = { ...raw };
    if (!ROWS.includes(raw.rows)) {
        if ('rows' in raw) problems.push(`section ${i + 1}: rows ${JSON.stringify(raw.rows)} is not genes or set, genes used`);
        out.rows = 'genes';
    }
    if ('title' in raw && !isText(raw.title)) delete out.title;
    for (const which of ['color', 'size']) {
        if (!(which in raw)) continue;
        const agg = cleanAggregation(raw[which]);
        if (agg) {
            out[which] = agg;
        } else {
            problems.push(`section ${i + 1}: ${which} aggregation not known, the default used`);
            delete out[which];
        }
    }
    return out;
}

/**
 * The configuration of a Cell-Gene Plot (plan 1.6, `cell-gene` version 1), as a link, a panel set and a history entry
 * carry it. Known fields are cleaned; unknown ones (style fields of later steps, a newer build's) are kept as they are.
 * `version`, `mode`, `sections`, `color` and `size` are always written; `cellAxis` once chosen; `scale` and `swap` only
 * when not the default. A stored `offer` (the plot's own offered statistics of WP-4, retired by decision 31) is read
 * and dropped, with no problem said. The 3D view
 * (UX 6b, WP-12): `view: '3d'` (absent is 2D), `height` (the bars' own measure; absent is "Same as Color", and a stored
 * one is kept while 3D is off), `camera` (the 3D camera, stored without an undo step).
 * @param {Object} raw
 * @returns {{config: Object, problems: string[]}}
 */
export function normalizeCellGene(raw) {
    const src = isObject(raw) ? raw : {};
    const problems = [];
    const config = { ...src, version: 1 };
    if (!MODES.includes(src.mode)) {
        if ('mode' in src) problems.push(`mode ${JSON.stringify(src.mode)} is not dots or heatmap, dots used`);
        config.mode = 'dots';
    }
    const axis = src.cellAxis;
    if (isObject(axis) && (axis.type === 'obs' || axis.type === GROUP_AXIS) && isText(axis.key)) {
        config.cellAxis = { ...axis };
    } else {
        if ('cellAxis' in src && axis !== undefined) problems.push('cellAxis: not an obs column or a grouping, left out');
        delete config.cellAxis;
    }
    const sections = Array.isArray(src.sections) ? src.sections : [];
    if ('sections' in src && !Array.isArray(src.sections)) problems.push('sections: not a list, none kept');
    config.sections = sections.map((s, i) => cleanSection(s, i, problems)).filter(Boolean);
    // decision 31: nothing is offered, so the plot's own offer of WP-4 has no meaning left
    delete config.offer;
    config.color = cleanStatistic(src.color, DEFAULT_COLOR, 'color', problems);
    config.size = cleanStatistic(src.size, DEFAULT_SIZE, 'size', problems);
    if ('height' in src) {
        if (isObject(src.height)) {
            config.height = cleanStatistic(src.height, DEFAULT_COLOR, 'height', problems);
        } else {
            if (src.height !== undefined) problems.push('height: not a statistic setting, Same as Color used');
            delete config.height;
        }
    }
    if (!VIEWS.includes(src.view)) {
        if ('view' in src && src.view !== undefined) problems.push(`view ${JSON.stringify(src.view)} is not 3d, 2D used`);
        delete config.view;
    }
    if ('camera' in src) {
        const camera = cleanCamera(src.camera);
        if (camera) config.camera = camera;
        else {
            if (src.camera !== undefined) problems.push('camera: not a camera, the default used');
            delete config.camera;
        }
    }
    if (!SCALINGS.includes(src.scale) || src.scale === 'none') {
        if ('scale' in src && src.scale !== 'none') problems.push(`scale ${JSON.stringify(src.scale)} is not known, none used`);
        delete config.scale;
    }
    if (src.swap !== true) {
        if ('swap' in src && src.swap !== false) problems.push('swap: not true or false, left out');
        delete config.swap;
    }
    return { config, problems };
}

/**
 * The Height measure the plot reads of its own (UX 6b): the stored `height` while 3D is on, else null. Null is "Same as
 * Color" in 3D (the bars are the colour's values, its scaling included) and nothing to read in 2D.
 * @param {Object} config - a normalised configuration
 * @returns {{stat: string, layer?: string, detect_above?: number}|null}
 */
export function heightOf(config) {
    return config && config.view === '3d' && isObject(config.height) ? config.height : null;
}

/**
 * The measures as drawn: each (Color, Size, a Height of its own) with no `detect_above` of its own reads the grouping's
 * expression threshold (decision 34, CXG-9), so the legends, hover and CSV name the threshold the values were read at.
 * Never stored: the grouping keeps its threshold and a later edit of it reaches the plot.
 * @param {Object} config - a normalised configuration
 * @param {*} threshold - the grouping recipe's `detect_above` (0 or none: nothing to fill)
 * @returns {Object} `config` itself when nothing is filled, else a copy
 */
export function withGroupingThreshold(config, threshold) {
    if (!isNumber(threshold) || threshold === 0 || !isObject(config)) return config;
    let out = config;
    for (const which of ['color', 'size', 'height']) {
        const spec = config[which];
        if (!isObject(spec) || isNumber(spec.detect_above)) continue;
        if (out === config) out = { ...config };
        out[which] = { ...spec, detect_above: threshold };
    }
    return out;
}

/** A one-row section's aggregation for Color or Size: the stored one, or the cheap default (CXG-5). */
export function rowAggregationOf(section, which) {
    return (section && section[which]) || { agg: DEFAULT_ROW_AGGREGATIONS[which] };
}

/** A section's title: its own, or its source's (CXG-6). */
export function sectionTitle(section, titleOf) {
    return section.title || titleOf(section.source) || section.source;
}

// ================================================================================================ references

/**
 * What a Cell-Gene Plot names (CAT-9): its cell axis when it is a grouping (`axis`), and each section's signature or
 * gene table (`section`). A score aggregation reads its section's source, so it names nothing more. Never throws on a
 * hand-edited configuration.
 * @param {Object} config
 */
export function cellGeneReferences(config) {
    const out = [];
    if (!isObject(config)) return out;
    const axis = config.cellAxis;
    if (isObject(axis) && axis.type === GROUP_AXIS && isText(axis.key)) {
        out.push({ id: axis.key, via: 'axis', field: 'cellAxis', get: () => axis.key, set: (v) => { axis.key = v; } });
    }
    for (const section of Array.isArray(config.sections) ? config.sections : []) {
        if (!isObject(section) || !isText(section.source)) continue;
        out.push({ id: section.source, via: 'section', field: 'sections', get: () => section.source, set: (v) => { section.source = v; } });
    }
    return out;
}

// ================================================================================================ the section list

const withSections = (config, sections) => ({ ...config, sections });

/** Add genes: a section of `source` shown as its genes (UX 3.2). */
export function addSection(config, source) {
    return withSections(config, [...config.sections, { source, rows: 'genes' }]);
}

/** ⋯ Duplicate: an independent copy after it. */
export function duplicateSection(config, i) {
    if (!config.sections[i]) return config;
    const list = [...config.sections];
    list.splice(i + 1, 0, JSON.parse(JSON.stringify(list[i])));
    return withSections(config, list);
}

/** ⋯ Remove. */
export function removeSection(config, i) {
    if (!config.sections[i]) return config;
    return withSections(config, config.sections.filter((_, k) => k !== i));
}

/** ⋯ Move up / Move down, Alt+Up / Alt+Down, a drag: out of range, the same configuration. */
export function moveSection(config, from, to) {
    const n = config.sections.length;
    if (from < 0 || from >= n || to < 0 || to >= n || from === to) return config;
    const list = [...config.sections];
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    return withSections(config, list);
}

function editSection(config, i, edit) {
    if (!config.sections[i]) return config;
    const list = [...config.sections];
    list[i] = edit({ ...list[i] });
    return withSections(config, list);
}

/** Genes / One row. A one-row section's aggregations stay, so switching back and forth loses nothing. */
export function setSectionRows(config, i, rows) {
    if (!ROWS.includes(rows)) return config;
    return editSection(config, i, (s) => ({ ...s, rows }));
}

/** The title, edited in place; empty is the source's title again. */
export function setSectionTitle(config, i, title) {
    const text = String(title || '').trim();
    return editSection(config, i, (s) => {
        if (text) s.title = text; else delete s.title;
        return s;
    });
}

/** A one-row section's Color or Size; the default is not written. */
export function setRowAggregation(config, i, which, rowAgg) {
    const agg = cleanAggregation(rowAgg);
    return editSection(config, i, (s) => {
        if (!agg || (agg.agg === DEFAULT_ROW_AGGREGATIONS[which] && Object.keys(agg).length === 1)) delete s[which];
        else s[which] = agg;
        return s;
    });
}

/**
 * A section's genes: the source's up genes, then its down genes, each once, in the source's order (CXG-7); genes the
 * dataset lacks are left out and counted (CXG-8).
 * @param {{genes?: string[], down?: string[]}} recipe - a signature's recipe or a gene table's (score-source-panels.js)
 * @param {(name: string) => boolean} hasGene
 * @returns {{genes: string[], missing: number, total: number, down: number}} `down`: how many of `genes` are down genes
 */
export function sectionGenes(recipe, hasGene) {
    const seen = new Set();
    const genes = [];
    let missing = 0;
    let down = 0;
    const up = (recipe && recipe.genes) || [];
    for (const name of [...up, ...((recipe && recipe.down) || [])]) {
        if (typeof name !== 'string' || seen.has(name)) continue;
        seen.add(name);
        if (hasGene(name)) {
            genes.push(name);
            if (!up.includes(name)) down++;
        } else missing++;
    }
    return { genes, missing, total: seen.size, down };
}

/** The count on a section's row: "48 genes · 3 not in this dataset" (UX 3.2, CXG-8). */
export function sectionLine({ total, missing }) {
    const genes = `${fmt(total)} ${total === 1 ? 'gene' : 'genes'}`;
    return missing ? `${genes} · ${fmt(missing)} not in this dataset` : genes;
}

/** Over 2,000 genes (CXG-17): what the section says, or null. */
export function tooManyGenesText(title, total) {
    return total > GENES_PER_SECTION_MAX
        ? `${title} has ${fmt(total)} genes; a section shows up to ${fmt(GENES_PER_SECTION_MAX)}. Filter the table.` : null;
}

// ================================================================================================ one row: Color and Size

const SUMMARIES = Object.keys(ROW_AGGREGATIONS).filter((k) => ROW_AGGREGATIONS[k].kind === 'summary');
const SCORE_KINDS = Object.keys(ROW_AGGREGATIONS).filter((k) => ROW_AGGREGATIONS[k].kind === 'score');
/** What a new score kind reads (decision 32: a new score consumer starts on z-score mean · X). */
const NEW_SCORE = Object.freeze({ column: DEFAULT_METHOD, layer: DEFAULT_LAYER });

const isScoreKind = (rowAgg) => !!rowAgg && !!ROW_AGGREGATIONS[rowAgg.agg] && ROW_AGGREGATIONS[rowAgg.agg].kind === 'score';

/**
 * The KIND select of a one-row section's Color or Size (OD 15, CXG-5, UX 3.2, decision 31): "From the genes" (the four
 * summaries), then "From the score" (the two score kinds). For a score kind the method and the layer are two selects
 * of their own (score-source.js `scoreChoices`), listing every method and every layer, so this list never grows with
 * them and nothing in it is "offered".
 * @returns {Array<{heading: string, entries: Array<{value: string, label: string}>}>}
 */
export function aggregationEntries({ down = 0 } = {}) {
    // a source with down genes is never summarised from its genes' rows (effectiveAggregation)
    const off = down > 0 ? { disabled: true, title: CG.downGenesNoSummary } : {};
    return [
        { heading: CG.aggregationHeading.summary, entries: SUMMARIES.map((agg) => ({ value: agg, label: CG.aggregation[agg], ...off })) },
        { heading: CG.aggregationHeading.score, entries: SCORE_KINDS.map((agg) => ({ value: agg, label: CG.scoreKind[agg] })) }
    ];
}

/**
 * A one-row section's Color or Size after the user touched one of its three selects (decision 31): `kind`, `method` or
 * `layer`. A score kind chosen from a summary starts on z-score mean · X; one chosen from the other score kind keeps
 * the method and layer (and its threshold when it is the same kind). The method or layer select touched wins; the
 * other moves only when the pair is now impossible, and `say` names the move once ("Layer changed to logged: …").
 * @param {Object} held - the aggregation now (rowAggregationOf)
 * @param {'kind'|'method'|'layer'} part
 * @param {string} value
 * @param {?{after: (changed: string, value: string, pair: Object) => {method: string, layer: string, say: string}}} [choices]
 *   score-source.js `scoreChoices` of the section's source; null when it cannot be read (the pair is then taken as given)
 * @returns {?{agg: Object, say: string}} null when the edit means nothing (a method on a summary)
 */
export function aggregationAfter(held, part, value, choices = null) {
    if (part === 'kind') {
        if (SUMMARIES.includes(value)) return { agg: { agg: value }, say: '' };
        if (!SCORE_KINDS.includes(value)) return null;
        if (isScoreKind(held)) {
            const out = { agg: value, column: held.column, layer: held.layer || DEFAULT_LAYER };
            if (held.agg === value && isNumber(held.above)) out.above = held.above;
            return { agg: out, say: '' };
        }
        const pair = choices ? choices.after('method', NEW_SCORE.column, { layer: NEW_SCORE.layer }) : { method: NEW_SCORE.column, layer: NEW_SCORE.layer, say: '' };
        return { agg: { agg: value, column: pair.method, layer: pair.layer || NEW_SCORE.layer }, say: pair.say || '' };
    }
    if (!isScoreKind(held) || (part !== 'method' && part !== 'layer')) return null;
    const layer = held.layer || DEFAULT_LAYER;
    const pair = part === 'method' ? { layer } : { method: held.column };
    const r = choices ? choices.after(part, value, pair)
        : { method: part === 'method' ? value : held.column, layer: part === 'layer' ? value : layer, say: '' };
    return { agg: { ...held, column: r.method, layer: r.layer || layer }, say: r.say || '' };
}

/** The help line under a select (UX 3.2): the aggregation's, and for a summary the layer it reads. */
export function aggregationHelp(rowAgg, layer) {
    const help = CG.aggregationHelp[rowAgg.agg];
    return ROW_AGGREGATIONS[rowAgg.agg].kind === 'summary' ? `${help} On ${layer}.` : help;
}

// ================================================================================================ the request

/**
 * The aggregation a one-row section draws: the stored one, except that a source with down genes is never summarised
 * from its genes' rows, which would count its down genes as up genes; its row is then its score by the source's
 * default method on the channel's layer (one-row-ux-080.md, decision 40).
 * @param {Object} agg - rowAggregationOf
 * @param {{layer?: string}} spec - the channel (Color or Size)
 * @param {number} [down] - the section's down genes in the dataset
 */
export function effectiveAggregation(agg, spec, down = 0) {
    if (!(down > 0) || ROW_AGGREGATIONS[agg.agg].kind === 'score') return agg;
    return { agg: agg.agg === 'mean_of_pct_expressing' ? 'score_pct_above' : 'score_mean', column: DEFAULT_METHOD, layer: (spec && spec.layer) || DEFAULT_LAYER };
}

/** Whether a statistic reads an expression threshold (`detect_above`, CXG-9). */
export const needsThreshold = (stat) => THRESHOLD_STATS.includes(stat);

/** The statistic a summary reads of each gene. */
const SUMMARY_STAT = Object.freeze({ mean_of_means: 'mean', sum_of_means: 'mean', mean_of_zscores: 'mean', mean_of_pct_expressing: 'pct_expressing' });

/**
 * The features one request of the plot asks for, and what each matrix row reads of them.
 * @param {Object} input
 * @param {Array<{section: Object, genes: string[], title: string, empty?: string,
 *   scoreRecipe: (column: string, layer: string) => (Object|null)}>} input.sections - each configured section with its
 *   usable genes now; `empty` says why it has none; `scoreRecipe` gives the score route's recipe of the source read by
 *   that method on that layer (null when it cannot be read now)
 * @param {{stat: string, layer?: string, detect_above?: number}} input.color
 * @param {{stat: string, layer?: string, detect_above?: number}|null} input.size - null when the plot draws no size
 * @param {{stat: string, layer?: string, detect_above?: number}|null} [input.height] - the 3D bars' own measure
 *   (heightOf), null for "Same as Color" or 2D. On Color's or Size's layer and threshold it adds no feature (UX 6b)
 * @param {number} [input.threshold] - the grouping's expression threshold, for a statistic with none of its own
 * @returns {{features: Array<{key: string, wire: Object}>, rows: Object[], statistics: Array<{stat: string, layer?: string}>}}
 *   `rows`, in order: `{kind: 'gene', section, label, color, size, height?}` (feature keys, null for count or no size);
 *   `{kind: 'set', section, label, color: {agg, keys|key}, size: {...}|null, height?: {keys}}`; `{kind: 'empty', section,
 *   label}`. `height` is there only with a height of its own: a one-row section's is the mean over its genes.
 */
export function planFeatures({ sections, color, size, height = null, threshold = 0 }) {
    const features = new Map();
    const statistics = [];
    const noteStatistic = (stat, layer) => {
        const entry = stat === 'count' ? { stat } : { stat, layer };
        if (!statistics.some((s) => s.stat === entry.stat && s.layer === entry.layer)) statistics.push(entry);
    };
    // per layer, the threshold a statistic with none of its own reads, so it shares features with one that has one
    const shared = new Map();
    const ownThreshold = (spec) => (isNumber(spec.detect_above) ? spec.detect_above : threshold);
    for (const spec of [color, size, height]) {
        if (spec && spec.stat !== 'count' && needsThreshold(spec.stat) && !shared.has(spec.layer)) shared.set(spec.layer, ownThreshold(spec));
    }
    const thresholdFor = (stat, spec) => (needsThreshold(stat) ? ownThreshold(spec) : (shared.has(spec.layer) ? shared.get(spec.layer) : threshold));

    const gene = (name, stat, spec) => {
        const wire = { kind: 'gene', name, layer: spec.layer || DEFAULT_LAYER, detect_above: thresholdFor(stat, spec) };
        const key = stableStringify(wire);
        if (!features.has(key)) features.set(key, wire);
        return key;
    };
    // per section and score option, the threshold a share above reads: a mean of the same score reads it too, so the
    // two share one score feature
    const scoreAbove = (entry, agg) => {
        if (agg.agg === 'score_pct_above') return isNumber(agg.above) ? agg.above : 0;
        const layer = agg.layer || DEFAULT_LAYER;
        for (const which of ['color', 'size']) {
            const channel = which === 'color' ? color : size;
            if (!channel) continue;
            const other = effectiveAggregation(rowAggregationOf(entry.section, which), channel, entry.down);
            if (other.agg === 'score_pct_above' && other.column === agg.column && (other.layer || DEFAULT_LAYER) === layer) {
                return isNumber(other.above) ? other.above : 0;
            }
        }
        return 0;
    };
    const score = (agg, entry) => {
        const recipe = entry.scoreRecipe(agg.column, agg.layer || DEFAULT_LAYER);
        if (!recipe) return null;
        const wire = { kind: 'score', recipe, column: agg.column, layer: agg.layer || DEFAULT_LAYER, above: scoreAbove(entry, agg) };
        const key = stableStringify(wire);
        if (!features.has(key)) features.set(key, wire);
        return key;
    };
    const stat = (spec, genes) => {
        if (!spec) return null;
        noteStatistic(spec.stat, spec.layer);
        return spec.stat === 'count' ? genes.map(() => null) : genes.map((g) => gene(g, spec.stat, spec));
    };
    const aggregated = (stored, spec, entry) => {
        const agg = effectiveAggregation(stored, spec, entry.down);
        if (ROW_AGGREGATIONS[agg.agg].kind === 'score') return { agg, key: score(agg, entry) };
        const s = SUMMARY_STAT[agg.agg];
        noteStatistic(s, spec.layer);
        return { agg, keys: entry.genes.map((g) => gene(g, s, spec)) };
    };

    const rows = [];
    sections.forEach((entry, index) => {
        const { section, genes } = entry;
        if (!genes.length) {
            rows.push({ kind: 'empty', section: index, label: entry.empty || entry.title });
            return;
        }
        if (section.rows === 'set') {
            const row = { kind: 'set', section: index, label: entry.title,
                color: aggregated(rowAggregationOf(section, 'color'), color, entry),
                size: size ? aggregated(rowAggregationOf(section, 'size'), size, entry) : null };
            // a one-row section's own height: the height statistic's mean over the section's genes
            if (height) row.height = { keys: stat(height, genes) };
            rows.push(row);
            return;
        }
        const c = stat(color, genes);
        const z = stat(size, genes);
        const h = stat(height, genes);
        genes.forEach((g, k) => {
            const row = { kind: 'gene', section: index, label: g, color: c[k], size: z ? z[k] : null };
            if (h) row.height = h[k];
            rows.push(row);
        });
    });
    return { features: [...features].map(([key, wire]) => ({ key, wire })), rows, statistics };
}

// ================================================================================================ the matrix

/** The id of a quantity: equal ids share a colour bar or a size legend (draw.js). */
const quantityId = (stat, layer, t) => `${stat}|${stat === 'count' ? '' : layer}|${needsThreshold(stat) ? t : ''}`;

const NO_GENE_MOMENTS = null;

/**
 * The matrix of the plot from the moments held: each row's statistic per group for Color (and Size), as the drawing
 * reads them (panels/cell-gene/draw.js). Missing is NaN, never 0 (SHR-20); a gene whose moments are not held (the
 * server did not find it) has no value.
 * @param {ReturnType<typeof planFeatures>} plan
 * @param {(key: string) => (Float64Array|null)} momentsOf
 * @param {Array<{n: number}>} groups - the reply's groups, in order
 * @param {Object} config - the plot's configuration (color, size, scale, mode, view, height)
 * @param {{titleOf?: (index: number) => string, scoreName?: (agg: Object) => string}} [names]
 * @returns {{rows: Object[], color: Object, size: (Object|null), height: (Object|null)}} `height` in 3D only: `{same:
 *   true, values}` (the colour's values as displayed) or the own measure, unscaled (UX 6b)
 */
export function buildMatrix(plan, momentsOf, groups, config, names = {}) {
    const G = groups.length;
    const R = plan.rows.length;
    const sizes = Float64Array.from(groups, (g) => g.n);
    const dots = config.mode !== 'heatmap';
    const color = config.color;
    const size = dots ? config.size : null;
    const colorId = quantityId(color.stat, color.layer, color.detect_above || 0);
    const sizeId = size ? quantityId(size.stat, size.layer, size.detect_above || 0) : null;

    const raw = new Float64Array(R * G).fill(NaN);
    const sizeValues = size ? new Float64Array(R * G).fill(NaN) : null;
    const noExpressing = new Uint8Array(R * G);
    const references = [];
    const rows = [];
    const moments = (key) => (key ? momentsOf(key) || NO_GENE_MOMENTS : NO_GENE_MOMENTS);
    const height = heightOf(config);
    const heightValues = height ? new Float64Array(R * G).fill(NaN) : null;
    /** A one-row section's own height: the mean over its genes with a value (a gene with none is skipped). */
    const meanOver = (keys) => {
        const total = new Float64Array(G);
        const seen = new Uint32Array(G);
        for (const key of keys) {
            const col = one(height, key);
            if (!col) continue;
            for (let g = 0; g < G; g++) if (!Number.isNaN(col[g])) { total[g] += col[g]; seen[g]++; }
        }
        return Float64Array.from(total, (t, g) => (seen[g] ? t / seen[g] : NaN));
    };

    const one = (spec, key) => {
        if (spec.stat === 'count') return statisticColumn('count', null, G, sizes);
        const m = moments(key);
        return m ? statisticColumn(spec.stat, m, G) : null;
    };
    const aggregatedRow = (part) => {
        if (part.key !== undefined) {
            const m = moments(part.key);
            return m ? { values: setRow(part.agg.agg, m, G), moments: m } : { values: null, moments: null };
        }
        const list = part.keys.map(moments).filter(Boolean);
        return { values: list.length ? setRow(part.agg.agg, list, G) : null, moments: null };
    };
    const aggregationName = (agg) => (ROW_AGGREGATIONS[agg.agg].kind === 'summary' ? CG.aggregation[agg.agg]
        : names.scoreName ? names.scoreName(agg) : `${agg.agg} · ${agg.column} · ${agg.layer}`);
    const aggregationId = (agg, spec) => {
        if (ROW_AGGREGATIONS[agg.agg].kind === 'score') return `${agg.agg}|${agg.column}|${agg.layer}|${agg.agg === 'score_pct_above' ? agg.above || 0 : ''}`;
        if (agg.agg === 'mean_of_means') return quantityId('mean', spec.layer, 0);
        if (agg.agg === 'mean_of_pct_expressing') return quantityId('pct_expressing', spec.layer, spec.detect_above || 0);
        return `${agg.agg}|${spec.layer}`;
    };

    plan.rows.forEach((row, r) => {
        const at = r * G;
        const section = { index: row.section, title: names.titleOf ? names.titleOf(row.section) : '' };
        if (row.kind === 'gene') {
            const c = one(color, row.color);
            if (c) raw.set(c, at);
            if (c && color.stat !== 'count') noExpressing.set(noExpressingCells(color.stat, moments(row.color), G), at);
            if (size) { const z = one(size, row.size); if (z) sizeValues.set(z, at); }
            if (height) { const h = one(height, row.height); if (h) heightValues.set(h, at); }
            const m = color.stat === 'count' ? null : moments(row.color);
            references.push(m ? pooledReference(m, G) : null);
            rows.push({ kind: 'gene', label: row.label, section });
        } else if (row.kind === 'set') {
            const c = aggregatedRow(row.color);
            if (c.values) raw.set(c.values, at);
            references.push(c.moments ? pooledReference(c.moments, G) : null);
            const own = { color: { id: aggregationId(row.color.agg, color), label: aggregationName(row.color.agg) } };
            if (size && row.size) {
                const z = aggregatedRow(row.size);
                if (z.values) sizeValues.set(z.values, at);
                own.size = { id: aggregationId(row.size.agg, size), label: aggregationName(row.size.agg) };
            }
            if (height && row.height) heightValues.set(meanOver(row.height.keys), at);
            rows.push({ kind: 'set', label: row.label, section, own });
        } else {
            references.push(null);
            rows.push({ kind: 'empty', label: row.label, section });
        }
    });

    const scaling = config.scale || 'none';
    const matrix = { values: raw, rows: R, groups: G };
    let values;
    if (scaling === 'z_pooled') {
        // a row with no pooled moments of its own (an aggregate of several genes) is a z-score across its groups
        values = scale(matrix, 'z_pooled', references.map((ref, r) => ref || acrossGroups(raw, r, G)));
    } else {
        values = scale(matrix, scaling);
    }
    return {
        rows,
        color: { id: colorId, stat: color.stat, layer: color.layer, detectAbove: needsThreshold(color.stat) ? color.detect_above || 0 : undefined,
            scaling, values, raw, noExpressing },
        size: size ? { id: sizeId, stat: size.stat, layer: size.layer, detectAbove: needsThreshold(size.stat) ? size.detect_above || 0 : undefined,
            values: sizeValues } : null,
        height: config.view !== '3d' ? null : height
            ? { same: false, stat: height.stat, layer: height.layer, detectAbove: needsThreshold(height.stat) ? height.detect_above || 0 : undefined,
                values: heightValues }
            : { same: true, values }
    };
}

/** The mean and population SD of one row's values over its groups with a value. */
function acrossGroups(values, r, G) {
    let n = 0;
    let sum = 0;
    for (let g = 0; g < G; g++) { const v = values[r * G + g]; if (!Number.isNaN(v)) { n++; sum += v; } }
    if (!n) return { mean: NaN, sd: NaN };
    const mean = sum / n;
    let sq = 0;
    for (let g = 0; g < G; g++) { const v = values[r * G + g]; if (!Number.isNaN(v)) sq += (v - mean) * (v - mean); }
    const sd = Math.sqrt(sq / n);
    return { mean, sd: sd > 1e-12 * Math.abs(mean) ? sd : 0 };
}
