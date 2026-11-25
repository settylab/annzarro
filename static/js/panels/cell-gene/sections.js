/**
 * The Cell-Gene Plot's configuration and its gene axis (0.8.0 step X3a; CXG-3 to CXG-9, CXG-18, OD 15, UX 3.2, plan 1.6).
 *
 * Two parts, one file, so the panel and the Node tests read one definition:
 *
 * - THE MODEL (pure, no DOM, no page state): the `cell-gene` configuration of version 1 and its normaliser, the
 *   references it holds (the cell axis grouping and each section's source), the operations of the section list (each
 *   returns a new configuration, so every edit can be one undoable step), a section's genes and counts, a one-row
 *   section's gene step (decision 40), the features one request asks for, and the matrix built from their moments.
 * - THE SECTION LIST (`createSectionList`): the "Genes" rows of UX 3.2 drawn from that model, wired to the panel's
 *   callbacks.
 *
 * **One request, each part once (CXG-9, CXG-18, OD 15).** `planFeatures` names every feature the drawing reads by the
 * key the group store caches it under (the feature as the request carries it), so a gene read by two sections, by its
 * own row and by a one-row section, or by Color and Size on one layer, is one feature, asked for once. A statistic that
 * uses no threshold reads the features of one that does on the same layer, so mean and % expressing share them.
 *
 * **One row (aggregation-unify-080.md 11).** A one-row section is the set treated as one gene: it has no setting, and each
 * channel shows it by one fixed rule per statistic (cell-gene-model.js ROW_RULE): the statistics of the gene rows combined
 * (no request beyond them), the set's z-score mean score, or, under % expressing, the share of cells expressing ANY gene
 * (the source's `detected` score on the channel's threshold). The layer and the threshold are the channel's.
 *
 * Words the user reads come from utils/vocabulary.js where it has them (statistics, aggregations, headings, help).
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import {
    rowRule, combineRows, SCALINGS, statisticColumn,
    noExpressingCells, pooledReference, scale, scalingGrade
} from '../../utils/cell-gene-model.js';
import { STATISTIC_IDS } from '../../utils/cell-grouping.js';
import { MODE_INFO } from '../../utils/cell-gene-model.js';
import { stableStringify } from '../../utils/url-history.js';
import { cellGroupType } from '../../utils/cell-group-source.js';
import { limit } from '../../utils/limits.js';
import { methodShort } from '../../utils/signature-options.js';

const CG = VOCABULARY.cellGene;

/** The source type of a grouping as a cell axis: the provider's (utils/cell-group-source.js), never a literal here. */
export const GROUP_AXIS = cellGroupType();

/** The value of "Same as Color" in Height's statistic select (UX 6b): stored as no `height`. */
export const SAME_AS_COLOR = '__same_as_color__';


const MODES = Object.freeze(MODE_INFO.map((m) => m.value));
const ROWS = Object.freeze(['genes', 'set']);
const DEFAULT_LAYER = 'X';
const DEFAULT_COLOR = Object.freeze({ stat: 'mean', layer: DEFAULT_LAYER });
const DEFAULT_SIZE = Object.freeze({ stat: 'pct_expressing', layer: DEFAULT_LAYER });
/** The statistics that compare each cell with an expression threshold. */
const THRESHOLD_STATS = Object.freeze(['pct_expressing', 'mean_expressing']);

/** The statistic whose gene rows are z-scored by the server, and its clip: the signature's default (gene_score.DEFAULT_CLIP). */
const ZSCORE = 'zscore_mean';
const ZSCORE_CLIP = 10;
/**
 * Which channels cannot hold z-score mean (aggregation-unify-080 2.4, Q3): Size cannot show a sign. One list, so the answer
 * is flipped in one place (utils/group-statistics.js says the same in the Size menu).
 */
const CANNOT_HOLD_ZSCORE = Object.freeze(['size']);

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
    } else if (raw.stat === ZSCORE && CANNOT_HOLD_ZSCORE.includes(what)) {
        problems.push(`${what}: ${CG.statistic[ZSCORE]} cannot be shown by ${what}, ${fallback.stat} used`);
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

const LABEL_SIDES = Object.freeze(['auto', 'fixed']);
const LABEL_JUSTIFY = Object.freeze(['auto', 'left', 'right', 'center']);
const EDGES = Object.freeze(['min', 'max']);
/** The edges of the default camera, for a fixed Side stored without its own (draw.js labelEdges of DEFAULT_CAMERA). */
const DEFAULT_LABEL_EDGES = Object.freeze({ x: 'min', y: 'max' });

/**
 * The 3D labels' options (Plot Options ▸ Axes, in 3D): `{side?: 'fixed', edges?: {x, y}, justify?: 'left'|'right'|'center',
 * rotation?: 'along'|'across'|'angle', angle?: number, padding?: number}`, defaults left out; null when nothing but
 * defaults is left.
 */
function cleanLabels3d(raw, problems) {
    if (!isObject(raw)) {
        problems.push('labels3d: not an object, left out');
        return null;
    }
    const out = {};
    if ('side' in raw && !LABEL_SIDES.includes(raw.side)) problems.push(`labels3d: side ${JSON.stringify(raw.side)} is not auto or fixed, auto used`);
    if ('justify' in raw && !LABEL_JUSTIFY.includes(raw.justify)) problems.push(`labels3d: justify ${JSON.stringify(raw.justify)} is not known, auto used`);
    if (raw.side === 'fixed') {
        const e = raw.edges;
        out.side = 'fixed';
        out.edges = isObject(e) && EDGES.includes(e.x) && EDGES.includes(e.y) ? { x: e.x, y: e.y } : { ...DEFAULT_LABEL_EDGES };
    }
    if (LABEL_JUSTIFY.includes(raw.justify) && raw.justify !== 'auto') out.justify = raw.justify;
    // Rotation: Horizontal (the default, absent), Along or Across the axis, or Angle with `angle` from -90 to 90 (Plotly's,
    // clockwise; 0 absent). A number as the rotation is read as an Angle of it
    if ('rotation' in raw) {
        if (raw.rotation === 'along' || raw.rotation === 'across' || raw.rotation === 'angle') out.rotation = raw.rotation;
        else if (isNumber(raw.rotation)) { out.rotation = 'angle'; out.angle = raw.rotation; }
        else if (raw.rotation !== 'horizontal') problems.push(`labels3d: rotation ${JSON.stringify(raw.rotation)} is not known, horizontal used`);
    }
    if (out.rotation === 'angle') {
        const a = isNumber(out.angle) ? out.angle : isNumber(raw.angle) ? raw.angle : 0;
        if ('angle' in raw && !isNumber(raw.angle)) problems.push('labels3d: angle is not a number, 0 used');
        const clamped = Math.max(-90, Math.min(90, a));
        if (clamped !== 0) out.angle = clamped; else delete out.angle;
    }
    // Padding: px between a label and its tick, 0 to 40; 4 is the default (absent)
    if ('padding' in raw) {
        if (isNumber(raw.padding)) {
            const pad = Math.max(0, Math.min(40, raw.padding));
            if (pad !== 4) out.padding = pad;
        } else {
            problems.push('labels3d: padding is not a number, 4 used');
        }
    }
    return Object.keys(out).length ? out : null;
}

/**
 * One section of a link, cleaned. A one-row section has no setting (aggregation-unify-080.md 11.1): the `genes`, `color` and
 * `size` of an earlier build are not read and are dropped, silently.
 */
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
    delete out.color;
    delete out.size;
    delete out.genes;
    return out;
}

/**
 * The configuration of a Cell-Gene Plot (plan 1.6, `cell-gene` version 1), as a link, a panel set and a history entry
 * carry it. Known fields are cleaned; unknown ones (style fields of later steps, a newer build's) are kept as they are.
 * `version`, `mode`, `sections`, `color` and `size` are always written; `cellAxis` once chosen; `scale` and `swap` only
 * when not the default. A stored `offer` (the plot's own offered statistics of WP-4, retired by decision 31) is read
 * and dropped, with no problem said. The 3D view
 * (UX 6b, WP-12): `view: '3d'` (absent is 2D), `height` (the bars' own measure; absent is "Same as Color", and a stored
 * one is kept while 3D is off), `camera` (the 3D camera, stored without an undo step), `labels3d` (its labels' Side and
 * Justify, Rotation and Padding, Plot Options ▸ Axes in 3D, defaults absent).
 * The per-channel `color`, `size` and the `genes` of an earlier build's one-row sections are dropped, with no problem and no notice. `notices` holds only the Scale that moved (`{scale: true, was}`).
 * @param {Object} raw
 * @returns {{config: Object, problems: string[], notices: Array<{scale: true, was: string}>}}
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
    // decision 31: nothing is offered, so the plot's own offer of WP-4 has no meaning left
    delete config.offer;
    config.color = cleanStatistic(src.color, DEFAULT_COLOR, 'color', problems);
    config.size = cleanStatistic(src.size, DEFAULT_SIZE, 'size', problems);
    const notices = [];
    config.sections = [];
    sections.forEach((s, i) => {
        const out = cleanSection(s, i, problems);
        if (out) config.sections.push(out);
    });
    if ('height' in src) {
        if (isObject(src.height)) {
            config.height = cleanStatistic(src.height, DEFAULT_COLOR, 'height', problems);
        } else {
            if (src.height !== undefined) problems.push('height: not a statistic setting, Same as Color used');
            delete config.height;
        }
    }
    // a link from before the dots filled their cells stored its dot sizes as a px range; its smallest dot is Smallest dot
    // (a Plot Options field), so that field shows what is drawn. Its largest stays in `dotSizes` until Largest dot is moved
    const legacy = src.dotSizes;
    if (Array.isArray(legacy) && legacy.length === 2 && legacy.every((v) => typeof v === 'number' && Number.isFinite(v))
        && !(typeof src.dotSmallest === 'number' && Number.isFinite(src.dotSmallest))) {
        const smallest = Math.round(Math.max(1, Math.min(40, Math.min(legacy[0], legacy[1]))));
        if (smallest !== 3) config.dotSmallest = smallest;
    }
    if (!VIEWS.includes(src.view)) {
        if ('view' in src && src.view !== undefined) problems.push(`view ${JSON.stringify(src.view)} is not 3d, 2D used`);
        delete config.view;
    }
    if ('labels3d' in src) {
        const labels = src.labels3d === undefined ? null : cleanLabels3d(src.labels3d, problems);
        if (labels) config.labels3d = labels; else delete config.labels3d;
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
    // under z-score mean the colour is a z-score already: a z Scale would redraw it under a second name (2.2)
    if (config.scale && !scalingGrade(config.scale, config.color.stat).ok) {
        notices.push({ scale: true, was: config.scale });
        delete config.scale;
    }
    return { config, problems, notices };
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

/**
 * ⋯ Duplicate: an independent copy after it, titled "<name> (copy)" when the section's name is given, so the two are
 * told apart in the list, on the brackets and on a one-row section's label (operator, 2026-11-23: identical, the copy
 * looked like it was not drawn).
 * @param {Object} config
 * @param {number} i
 * @param {string} [name] - the section's title as shown
 */
export function duplicateSection(config, i, name) {
    if (!config.sections[i]) return config;
    const list = [...config.sections];
    const copy = JSON.parse(JSON.stringify(list[i]));
    if (name) copy.title = `${name} (copy)`;
    list.splice(i + 1, 0, copy);
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

/** Genes / One row. A one-row section's gene steps stay, so switching back and forth loses nothing. */
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
    const most = limit('genes_per_section');    // the most genes a section draws (CXG-17), as matrixLimits reads it
    return total > most
        ? `${title} has ${fmt(total)} genes; a section shows up to ${fmt(most)}. Filter the table.` : null;
}

// ================================================================================================ one row: Color and Size

const fmtValue = (v) => String(Number(Number(v).toPrecision(4)));

/** A statistic as a legend names it: "% expressing (> 0) · counts" (draw.js statisticTitle says the same). */
function statisticName({ stat, layer, detect_above: t }) {
    const threshold = THRESHOLD_STATS.includes(stat) ? ` (> ${fmtValue(isNumber(t) ? t : 0)})` : '';
    return `${CG.statistic[stat]}${threshold}${stat !== 'count' && layer ? ` · ${layer}` : ''}`;
}

/** The name of a one-row section's quantity step for the CSV and the hover: how its genes were combined. */
function stepName(genes) {
    if (genes === 'any') return CG.rowStep.anyGeneHow;
    if (genes === 'zscore_mean' || genes === 'mean') return CG.rowStep.score(methodShort(genes));
    return CG.rowStep.name[genes] || '';
}

/**
 * What one value of a one-row section is under each channel, in a sentence (the section's tooltip): "Color: the mean of the
 * genes' means. Size: % of cells expressing at least one gene." With down genes the mean is the signature's score.
 * @param {{color: Object, size: ?Object}} channels
 * @param {number} [down] - the section's down genes in the dataset
 */
export function rowReading(channels, down = 0) {
    const part = (label, channel) => {
        const text = rowRule(channel.stat, { down }).downMean ? CG.rowStep.reading.downMean : CG.rowStep.reading[channel.stat];
        return `${label}: ${text}`;
    };
    return [part('Color', channels.color), channels.size ? part('Size', channels.size) : null].filter(Boolean).join('. ') + '.';
}

/** Whether a statistic reads an expression threshold (`detect_above`, CXG-9). */
export const needsThreshold = (stat) => THRESHOLD_STATS.includes(stat);

/**
 * The features one request of the plot asks for, and what each matrix row reads of them.
 * @param {Object} input
 * @param {Array<{section: Object, genes: string[], down?: number, title: string, empty?: string,
 *   scoreRecipe: (column: string, layer: string) => (Object|null)}>} input.sections - each configured section with its
 *   usable genes now (`down` of them down genes); `empty` says why it has none; `scoreRecipe(method, layer, extra?)` gives
 *   the score route's recipe of the source read by that method on that layer (null when it cannot be read now); `extra`
 *   `{detect_above, anyGene: true}` asks for the "any gene" recipe: the up genes (the down genes when it has no up
 *   ones) on `detected` at that threshold
 * @param {{stat: string, layer?: string, detect_above?: number}} input.color
 * @param {{stat: string, layer?: string, detect_above?: number}|null} input.size - null when the plot draws no size
 * @param {{stat: string, layer?: string, detect_above?: number}|null} [input.height] - the 3D bars' own measure
 *   (heightOf), null for "Same as Color" or 2D. On Color's or Size's layer and threshold it adds no feature (UX 6b)
 * @param {number} [input.threshold] - the grouping's expression threshold, for a statistic with none of its own
 * @returns {{features: Array<{key: string, wire: Object}>, rows: Object[], statistics: Array<{stat: string, layer?: string}>}}
 *   `rows`, in order: `{kind: 'gene', section, label, color, size, height?}` (feature keys, null for count or no size);
 *   `{kind: 'set', section, label, up, down, color: {step, keys|key}, size: {...}|null, height?: {keys}}` (`step.genes` the
 *   rule the channel's statistic gives the set; `keys` the up genes' features read as the channel reads them, or `key` the
 *   score feature on the channel's layer, `any: true` when it is the share of cells expressing any gene; neither under Cell count); `{kind: 'empty', section, label}`. `height` is there only with a height
 *   of its own: a one-row section's is the mean over its genes.
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
        // z-score mean: the server z-scores the gene over all cells, a feature of its own beside the raw one (2.5); a
        // threshold is on the z-score, which the statistic does not read
        if (stat === ZSCORE) Object.assign(wire, { detect_above: 0, transform: 'zscore', clip: ZSCORE_CLIP });
        const key = stableStringify(wire);
        if (!features.has(key)) features.set(key, wire);
        return key;
    };
    const scoreWire = (recipe, column, layer) => {
        if (!recipe) return null;
        const wire = { kind: 'score', recipe, column, layer, above: 0 };
        const key = stableStringify(wire);
        if (!features.has(key)) features.set(key, wire);
        return key;
    };
    // the channel's statistic of the section's score on the channel's layer
    const score = (genes, spec, entry) => {
        const layer = spec.layer || DEFAULT_LAYER;
        return scoreWire(entry.scoreRecipe(genes, layer), genes, layer);
    };
    // % expressing of a score row: the share of cells expressing any gene, `detected` above 0 at the channel's threshold (10.1a)
    const anyGene = (spec, entry) => {
        const layer = spec.layer || DEFAULT_LAYER;
        return scoreWire(entry.scoreRecipe('detected', layer, { detect_above: thresholdFor('pct_expressing', spec), anyGene: true }), 'detected', layer);
    };
    const stat = (spec, genes) => {
        if (!spec) return null;
        noteStatistic(spec.stat, spec.layer);
        return spec.stat === 'count' ? genes.map(() => null) : genes.map((g) => gene(g, spec.stat, spec));
    };
    // a one-row section under a channel: the set as one gene, by the statistic's rule (cell-gene-model.js ROW_RULE)
    const oneRow = (spec, entry) => {
        const down = entry.down || 0;
        const rule = rowRule(spec.stat, { down });
        if (rule.plan === 'count') return { step: { genes: 'count' } };
        // the channel's statistic is read on its layer whether by the gene rows or by a score: one request shape either way
        noteStatistic(spec.stat, spec.layer);
        if (rule.plan === 'score') return { step: { genes: rule.method }, key: score(rule.method, spec, entry) };
        if (rule.plan === 'any') return { step: { genes: 'any' }, key: anyGene(spec, entry), any: true };
        // the up genes (the down genes only when it has no up ones)
        const up = entry.genes.length > down ? entry.genes.slice(0, entry.genes.length - down) : entry.genes;
        return { step: { genes: rule.how }, keys: up.map((g) => gene(g, spec.stat, spec)) };
    };

    const rows = [];
    sections.forEach((entry, index) => {
        const { section, genes } = entry;
        if (!genes.length) {
            rows.push({ kind: 'empty', section: index, label: entry.empty || entry.title });
            return;
        }
        if (section.rows === 'set') {
            const row = { kind: 'set', section: index, label: entry.title, up: genes.length - (entry.down || 0), down: entry.down || 0,
                color: oneRow(color, entry),
                size: size ? oneRow(size, entry) : null };
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

/**
 * A one-row section's quantity under a channel: `id` equal to the gene rows' when the row is on their scale (every rule but
 * the sum), so it shares their colour bar or size legend; else its own. `label` names the two steps in the order they are
 * taken, for the legend's second line, the hover and the CSV.
 * @param {{genes: string}} step - what the rule gave the set under this channel (the row's `step`)
 * @param {{stat: string, layer?: string, detect_above?: number}} channel - with the threshold in force
 * @param {{title: string, up: number, down: number}} [row] - the section, for the "any gene" wording
 */
// export-unused-ok: the row-rule Node tests read a row's legend name and id through it
export function rowQuantity(step, channel, row = { title: '', up: 0, down: 0 }) {
    const t = channel.detect_above || 0;
    const q = CG.rowStep.quantity;
    const layer = channel.layer || DEFAULT_LAYER;
    const shared = quantityId(channel.stat, channel.layer, t);
    if (channel.stat === 'count' || step.genes === 'count') return { id: shared, label: statisticName(channel) };
    if (step.genes === ZSCORE) return { id: quantityId(ZSCORE, channel.layer, 0), label: statisticName({ stat: ZSCORE, layer: channel.layer }) };
    if (step.genes === 'any') return { id: shared, label: CG.rowStep.anyGene(row.title, row.up, row.down, fmtValue(t), layer) };
    if (step.genes === 'rows_mean') return { id: shared, label: q.rows(statisticName(channel), CG.rowStep.how.rows_mean) };
    if (step.genes === 'rows_sum') return { id: `rows_sum|${shared}`, label: q.rows(statisticName(channel), CG.rowStep.how.rows_sum) };
    // the signature's own mean score where it has down genes, on the gene rows' scale
    return { id: shared, label: q.score(methodShort(step.genes), `${CG.rowStep.cells[channel.stat]()} · ${layer}`) };
}

/** A channel's rule by name for the CSV ("Color: genes combined by"). */
function stepHow(step, channel) {
    return channel.stat === 'count' ? '' : stepName(step.genes);
}

const NO_GENE_MOMENTS = null;

/**
 * The matrix of the plot from the moments held: each row's statistic per group for Color (and Size), as the drawing
 * reads them (panels/cell-gene/draw.js). Missing is NaN, never 0 (SHR-20); a gene whose moments are not held (the
 * server did not find it) has no value.
 * @param {ReturnType<typeof planFeatures>} plan
 * @param {(key: string) => (Float64Array|null)} momentsOf
 * @param {Array<{n: number}>} groups - the reply's groups, in order
 * @param {Object} config - the plot's configuration (color, size, scale, mode, view, height)
 * @param {{titleOf?: (index: number) => string, constantOf?: (key: string) => boolean}} [names] - `constantOf`: the
 *   feature has no spread (server status constant)
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
    // the cells of a z-scored gene with no spread over the dataset: no value, and the hover says why
    const constant = new Uint8Array(R * G);
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
    /** A one-row section's values under a channel (decision 40), and the score's moments for a z-score against them. */
    const oneRow = (part, spec) => {
        if (spec.stat === 'count') return { values: statisticColumn('count', null, G, sizes), moments: null };
        if (part.key !== undefined) {
            const m = moments(part.key);
            return m ? { values: statisticColumn(spec.stat, m, G), moments: m } : { values: null, moments: null };
        }
        const list = part.keys.map(moments).filter(Boolean);
        return { values: list.length ? combineRows(part.step.genes, spec.stat, list, G) : null, moments: null };
    };

    plan.rows.forEach((row, r) => {
        const at = r * G;
        const section = { index: row.section, title: names.titleOf ? names.titleOf(row.section) : '' };
        if (row.kind === 'gene') {
            const c = one(color, row.color);
            if (c) raw.set(c, at);
            if (c && color.stat !== 'count') noExpressing.set(noExpressingCells(color.stat, moments(row.color), G), at);
            if (color.stat === ZSCORE && names.constantOf && names.constantOf(row.color)) constant.fill(1, at, at + G);
            if (size) { const z = one(size, row.size); if (z) sizeValues.set(z, at); }
            if (height) { const h = one(height, row.height); if (h) heightValues.set(h, at); }
            const m = color.stat === 'count' ? null : moments(row.color);
            references.push(m ? pooledReference(m, G) : null);
            rows.push({ kind: 'gene', label: row.label, section });
        } else if (row.kind === 'set') {
            const c = oneRow(row.color, color);
            if (c.values) raw.set(c.values, at);
            references.push(c.moments ? pooledReference(c.moments, G) : null);
            // each channel's quantity (a legend of its own unless it is the gene rows'), and its gene step by name for the CSV
            const ctx = { title: section.title, up: row.up, down: row.down };
            const own = { color: { ...rowQuantity(row.color.step, color, ctx), how: stepHow(row.color.step, color) } };
            if (size && row.size) {
                const z = oneRow(row.size, size);
                if (z.values) sizeValues.set(z.values, at);
                own.size = { ...rowQuantity(row.size.step, size, ctx), how: stepHow(row.size.step, size) };
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
            scaling, values, raw, noExpressing, constant },
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
