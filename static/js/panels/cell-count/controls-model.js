/**
 * The model of the Cell Count Plot's controls (UX 4.1, 4.2, 4.4, 4.5; CNT-2 to CNT-4, CNT-6, CNT-15 to CNT-18), pure so
 * Node tests cover it: what each mode shows, what each choice writes into the stored config (utils/count-plot-model.js
 * `normalizeCountPlot`'s), the lines the panel writes, the references a config holds, the options of the drawing and
 * what the page asks of the dataset structure (which sources are numbers, how many levels an input has).
 * panels/cell-count/controls.js draws the controls from it and panels/cell-count.js plans and draws with it.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { sourceName } from '../../utils/cell-grouping.js';
import { DEFAULT_BINS as GROUPING_DEFAULT_BINS, normalizeBinning } from '../../utils/binning.js';
import {
    modeReads, keptForOtherModes, densityLayers, binsRange, shareBasesFor, levelLabelsOf, MEASURE_STATS, splitUsed
} from '../../utils/count-plot-model.js';
import { PANEL_SOURCES, TABLE_SOURCE } from '../cell-grouping/factors.js';
import { getSource } from '../../utils/source-registry.js';
import { setText } from '../../utils/set-plot-model.js';

const C = VOCABULARY.countPlot;
const P = VOCABULARY.phrase;

// ================================================================================================ the model (pure)

/** What a stored config's mode shows (UX 4.2): its rows, the value it shows and the options that are its own. */
const MODE_ROWS = Object.freeze({
    bar: { value: 'height', arrangement: ['stack', 'dodge', 'fill'], labels: true, sort: true, horizontal: true, log: true, binned: ['x', 'split'] },
    histogram: { value: 'height', arrangement: ['stack', 'dodge'], labels: true, horizontal: true, log: true, binned: ['x', 'split'] },
    pie: { slices: true, labels: true, sort: true, ring: true, binned: ['x'] },
    hist2d: { value: 'color', labels: true, binned: ['x', 'y', 'split'] },
    heatmap: { value: 'color', labels: true, reverse: true, binned: ['x', 'y'] },
    // a density is smoothed on a fixed grid (CNT-10): only its Color by is binned
    density: { binned: ['split'], density: 1 },
    density2d: { binned: ['split'], density: 2 },
    venn: { binned: [] },
    upset: { value: 'color', binned: [] }
});

/**
 * The rows and options a mode shows.
 * @param {string} mode
 * @returns {{x: boolean, y: boolean, split: boolean, sets: boolean, slices: boolean, value: ('height'|'color'|null),
 *   arrangement: string[], labels: boolean, sort: boolean, reverse: boolean, horizontal: boolean, log: boolean,
 *   ring: boolean, binned: string[]}}
 */
export function rowsOf(mode) {
    const reads = modeReads(mode);
    const own = MODE_ROWS[mode];
    return {
        ...reads, slices: !!own.slices, value: own.value || null, arrangement: own.arrangement || [], labels: !!own.labels,
        sort: !!own.sort, reverse: !!(own.sort || own.reverse), horizontal: !!own.horizontal, log: !!own.log, ring: !!own.ring,
        binned: own.binned, density: own.density || 0
    };
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * How an input's source is named in a line: the panel's title for a source another panel makes, else its type and its
 * name ("obs cell_type", "obsm X_umap 1", "Cd3e · X").
 * @param {Object} source
 * @param {(source: Object) => (string|undefined)} [titleOf]
 */
export function inputText(source, titleOf) {
    if (!isObject(source)) return '';
    const title = titleOf ? titleOf(source) : undefined;
    if (source.type === TABLE_SOURCE) return P.inTable(title || source.key);
    if (typeof title === 'string' && title) return title;
    if (source.type === 'layer') return `${source.column || ''} · ${source.key}`.trim();
    if (source.type === 'obsp') return `obsp ${source.key} ${source.column || ''}`.trim();
    return `${source.type} ${sourceName(source)}`;
}

/**
 * The source of a statistic as a value axis names it (UX 4.5): "Mrpl15 · logged_counts", a score as its signature and
 * option, a column by its name.
 */
export function measureSourceName(source, titleOf) {
    if (!isObject(source)) return '';
    if (source.type === 'layer') return `${source.column || ''} · ${source.key}`;
    const title = titleOf ? titleOf(source) : undefined;
    const name = typeof title === 'string' && title ? title : sourceName(source);
    if (getSource(source.type) && source.column) return [name, source.column, source.layer].filter(Boolean).join(' · ');
    return name;
}

/**
 * The line that lists what the mode does not read (UX 4.2), or '' when it reads all that is stored:
 * "Kept for other modes: Y obsm X_umap 1 · Sets: in Table 1, in Table 2".
 * @param {Object} config - from normalizeCountPlot
 * @param {(source: Object) => (string|undefined)} [titleOf]
 */
export function keptLine(config, titleOf) {
    const kept = keptForOtherModes(config);
    if (!kept.length) return '';
    const items = kept.map((field) => (field === 'sets'
        ? `${C.rows.sets}: ${config.sets.map((s) => setText(s, { titleOf })).join(', ')}`
        : `${C.rows[field]} ${inputText(config[field].source, titleOf)}`));
    return C.kept(items);
}

/** The bin count a count plot uses for an input of this mode when none is stored (CNT-9). */
function defaultBins(mode) {
    return binsRange(mode).max === 512 ? 100 : 50;
}

/** The binning a numeric input is read with: the stored one, or the count plot's default (equal width). */
function binningOf(p) {
    return isObject(p.binning) ? p.binning : { method: 'equal_width' };
}

const METHOD_WORDS = Object.freeze({ equal_width: 'equal width', equal_count: 'equal count', log: 'log-spaced', manual: 'manual thresholds' });
const figure = (x) => String(Number(Number(x).toPrecision(6)));

/**
 * The compact line of a numeric input (UX 4.4): "Bins: equal width · 50 · auto range".
 * @param {Object} p - the stored input
 * @param {string} mode
 */
export function binningLine(p, mode) {
    const b = binningOf(p);
    const parts = [METHOD_WORDS[b.method] || b.method];
    if (b.method === 'manual') parts.push((b.thresholds || []).map(figure).join(', '));
    else if (b.method !== 'categories') parts.push(String(b.bins === undefined ? defaultBins(mode) : b.bins));
    if (b.zero_bin) parts.push('zero bin');
    if (b.method === 'equal_width' || b.method === 'log') {
        const r = Array.isArray(b.range) ? b.range : null;
        parts.push(r ? `range ${r[0] === null ? 'auto' : figure(r[0])} to ${r[1] === null ? 'auto' : figure(r[1])}` : 'auto range');
    }
    return C.bins(parts);
}

/**
 * The input as the binning control is given it: its binning with the bin count written out, since the control's own
 * default is the grouping's and the count plot's differs (CNT-9).
 */
export function forControl(p, mode) {
    const b = { ...binningOf(p) };
    if (b.method in GROUPING_DEFAULT_BINS && b.bins === undefined) b.bins = defaultBins(mode);
    return { ...p, binning: b };
}

/**
 * The input a binning control's commit stores: the bin count left out when it is this mode's default, and a binning
 * that is the count plot's default (equal width, default count, nothing else) not written at all.
 */
export function fromControl(next, mode) {
    const b = normalizeBinning(next.binning, { max: binsRange(mode).max, keepDefault: true }).binning;
    if (b.bins === defaultBins(mode)) delete b.bins;
    const out = { ...next, binning: b };
    if (b.method === 'equal_width' && Object.keys(b).length === 1) delete out.binning;
    return out;
}

/** The choices of Height or Color for a config (UX 4.5), in menu order. `group` heads the share and statistic entries. */
export function valueChoices(config) {
    const rows = rowsOf(config.mode);
    if (!rows.value) return [];
    const two = config.mode === 'hist2d' || config.mode === 'heatmap';
    const out = [{ value: 'count', label: C.value.count, help: rows.value === 'color' && config.mode !== 'upset' ? C.valueHelp.countColor : C.valueHelp.count }];
    // an UpSet's bars are one color until told otherwise: None first, and Count colors them by count
    if (config.mode === 'upset') out.unshift({ value: 'none', label: C.value.none, help: C.valueHelp.none });
    for (const base of shareBasesFor(config)) {
        out.push({ value: `share:${base}`, label: C.value.share[base], help: two ? C.valueHelp.heatmapShare : C.valueHelp.share, group: 'share' });
    }
    for (const stat of MEASURE_STATS) {
        out.push({ value: `stat:${stat}`, label: C.value.stat[stat], help: stat === 'zscore' ? C.valueHelp.zscore : C.valueHelp.stat, group: 'stat' });
    }
    if (two) out.push({ value: 'top_level', label: C.value.topLevel, help: C.valueHelp.topLevel });
    return out;
}

/**
 * What the config shows as height or color, as the mode can show it: a choice it does not offer (a most frequent level
 * in a bar, a share of the split with no split) reads as the count or the share of all, and is kept stored (CNT-6).
 * @returns {string} a value of valueChoices
 */
export function valueChoiceOf(config) {
    const offered = valueChoices(config).map((c) => c.value);
    const v = config.value || { kind: 'count' };
    const upset = config.mode === 'upset';
    let choice = upset && !(config.value && v.kind === 'count') ? 'none' : 'count';
    if (v.kind === 'share') choice = `share:${v.of || 'all'}`;
    else if (v.kind === 'measure' && config.measure) choice = `stat:${config.measure.stat}`;
    else if (v.kind === 'top_level' && v.factor) choice = 'top_level';
    if (offered.includes(choice)) return choice;
    if (v.kind === 'share') return offered.find((c) => c.startsWith('share:')) || 'count';
    return upset ? 'none' : 'count';
}

/**
 * The config the plot is planned and drawn with: the stored one with its value as the mode shows it (valueChoiceOf).
 * Nothing stored is lost.
 */
export function shownConfig(config) {
    const choice = valueChoiceOf(config);
    const now = choiceValue(config, choice);
    const was = config.value || { kind: 'count' };
    const zeroed = densityZeroBins(config);
    if (now.kind === was.kind && (now.of || 'all') === (was.of || 'all') && !zeroed.length) return config;
    const out = { ...config };
    if (now.kind === 'count') delete out.value; else out.value = now;
    // a density is smoothed over one run of bins: a zero bin kept from another mode is not one of them (V3)
    for (const field of zeroed) {
        const binning = { ...out[field].binning };
        delete binning.zero_bin;
        out[field] = { ...out[field], binning };
    }
    return out;
}

/** The inputs of a density whose stored binning has a zero bin (kept from a histogram, CNT-6). */
function densityZeroBins(config) {
    if (!rowsOf(config.mode).density) return [];
    return ['x', 'y'].filter((f) => config[f] && isObject(config[f].binning) && config[f].binning.zero_bin);
}

/** The stored `value` of a choice (the measure and the factor are fields of their own). */
function choiceValue(config, choice) {
    if (choice.startsWith('share:')) {
        const of = choice.slice('share:'.length);
        return of === 'all' ? { kind: 'share' } : { kind: 'share', of };
    }
    if (choice.startsWith('stat:')) return { kind: 'measure' };
    if (choice === 'top_level') return { kind: 'top_level', factor: config.value && config.value.factor };
    return { kind: 'count' };
}

/**
 * The config with a choice of Height or Color. A statistic keeps the source it had (or takes `defaults.measureSource`),
 * the most frequent level keeps its factor (or takes `defaults.factor`). Returns null when the choice needs one that
 * there is not.
 * @param {Object} config
 * @param {string} choice - a value of valueChoices
 * @param {{measureSource?: Object, factor?: Object}} [defaults]
 * @returns {Object|null}
 */
export function applyValueChoice(config, choice, defaults = {}) {
    const out = { ...config };
    if (config.mode === 'upset' && choice === 'none') {
        delete out.value;
        return out;
    }
    if (config.mode === 'upset' && choice === 'count') {
        out.value = { kind: 'count' };
        return out;
    }
    if (choice === 'count') {
        delete out.value;
        return out;
    }
    if (choice.startsWith('share:')) {
        out.value = choiceValue(config, choice);
        return out;
    }
    if (choice.startsWith('stat:')) {
        const stat = choice.slice('stat:'.length);
        if (!MEASURE_STATS.includes(stat)) return null;
        const source = config.measure ? config.measure.source : defaults.measureSource;
        if (!source) return null;
        out.measure = { ...(config.measure || {}), stat, source };
        if (stat !== 'pct_above') delete out.measure.above;
        out.value = { kind: 'measure' };
        return out;
    }
    if (choice === 'top_level') {
        const factor = (config.value && config.value.factor) || defaults.factor;
        if (!factor) return null;
        out.value = { kind: 'top_level', factor };
        return out;
    }
    return null;
}

/** The config in another mode: every input is kept (CNT-6). */
export function setMode(config, mode) {
    return { ...config, mode };
}

/**
 * An input after its source was chosen: the same input when the source is the same; otherwise one of the new source,
 * which keeps only the lock (the levels, renames and binning were of the old source).
 * @param {?Object} p - the input now
 * @param {?Object} source - the new source, or null for none
 * @returns {?Object}
 */
export function inputFromSource(p, source) {
    if (!source) return null;
    if (p && sameSource(p.source, source)) return p;
    const out = { source };
    if (p && p.locked) out.locked = true;
    return out;
}

const SOURCE_FIELDS = ['type', 'key', 'column', 'layer'];
const sameSource = (a, b) => isObject(a) && isObject(b) && SOURCE_FIELDS.every((f) => (a[f] || '') === (b[f] || ''));

/**
 * The stored source of an axis select's setting (the cell plot's `{type, key, column, layer?}`): an empty field left
 * out, a layer only for a provider that has them. Null for no source.
 */
export function sourceFromSetting(setting) {
    if (!setting || !setting.type || setting.type === 'none' || !setting.key) return null;
    const out = { type: setting.type, key: setting.key };
    if (setting.column !== undefined && setting.column !== null && setting.column !== '') out.column = String(setting.column);
    const provider = getSource(setting.type);
    if (provider && provider.layered && setting.layer) out.layer = setting.layer;
    return out;
}

/** The setting an axis select starts from for a stored input: its source, its lock and what the row remembers. */
export function settingOf(p, history) {
    const s = p && p.source ? p.source : null;
    const out = { type: s ? s.type : 'none', key: s ? s.key : '', column: s && s.column !== undefined ? s.column : '', locked: !!(p && p.locked),
        history: history || {} };
    if (s && s.layer) out.layer = s.layer;
    return out;
}

/** The fields of a config that hold an input whose source can follow the focus (CNT-2, CNT-17). */
const FOLLOWING = ['x', 'y', 'split'];

/**
 * The config with every unlocked `layer` source on the focused gene and every unlocked `obsp` source on the focused
 * cell, as a cell plot's axes follow them; null when nothing changes.
 * @param {Object} config
 * @param {{gene?: ?string, cell?: ?string}} focus
 * @returns {Object|null}
 */
export function followFocus(config, { gene = null, cell = null } = {}) {
    let changed = false;
    const follow = (holder) => {
        if (!holder || holder.locked || !holder.source) return holder;
        const want = holder.source.type === 'layer' ? gene : holder.source.type === 'obsp' ? cell : null;
        if (!want || holder.source.column === want) return holder;
        changed = true;
        return { ...holder, source: { ...holder.source, column: want } };
    };
    const out = { ...config };
    for (const field of FOLLOWING) if (config[field]) out[field] = follow(config[field]);
    if (config.value && config.value.factor) out.value = { ...config.value, factor: follow(config.value.factor) };
    if (config.measure) out.measure = follow(config.measure);
    return changed ? out : null;
}

/**
 * The references of a count plot's config (utils/panel-references.js): every input, the factor of the most frequent
 * level, every set and the statistic's source that is another panel (a table, a score, a grouping). Never throws on a
 * hand-edited link.
 * @param {Object} config
 */
export function countReferences(config) {
    const out = [];
    if (!isObject(config)) return out;
    const add = (holder, via, field) => {
        const source = isObject(holder) && isObject(holder.source) ? holder.source : null;
        if (!source || !PANEL_SOURCES.includes(source.type) || typeof source.key !== 'string' || !source.key) return;
        out.push({ id: source.key, via, field, get: () => source.key, set: (v) => { source.key = v; } });
    };
    for (const field of ['x', 'y', 'split']) add(config[field], 'partitioning', field);
    if (isObject(config.value)) add(config.value.factor, 'partitioning', 'value');
    if (Array.isArray(config.sets)) for (const set of config.sets) add(set, 'set', 'sets');
    add(config.measure, 'measure', 'measure');
    return out;
}

const LABEL_KINDS = Object.freeze(['none', 'count', 'share', 'measure']);
/** The bandwidth adjust a density takes (CNT-10). */
const ADJUST = Object.freeze({ min: 0.1, max: 10 });

/** A typed bandwidth adjust: a number from 0.1 to 10, or empty for 1; else the sentence that says so. */
export function parseAdjust(text) {
    const s = String(text).trim();
    if (s === '') return { ok: true, value: 1 };
    const v = Number(s);
    return Number.isFinite(v) && v >= ADJUST.min && v <= ADJUST.max ? { ok: true, value: v } : { ok: false, message: C.adjustProblem };
}

/**
 * What the Color pop-over offers (WP-6a): a colour map (with Reverse, min, max, centre) where the plot draws a continuous
 * colour scale, and a level palette where it colours levels. A 2D histogram's rectangles, a 2D density without a Color by,
 * a heatmap's number and an UpSet coloured by a share or a statistic have a scale; a Color by, a pie's slices and a
 * heatmap's most frequent level have levels.
 * @param {Object} config - from normalizeCountPlot
 * @returns {{map: boolean, palette: boolean}}
 */
export function colorUse(config) {
    const c = shownConfig(config);
    const kind = (c.value && c.value.kind) || 'count';
    const split = !!c.split && splitUsed(c);
    const levels = split || c.mode === 'pie';
    let map = false;
    if (c.mode === 'hist2d') map = !split && kind !== 'top_level';
    else if (c.mode === 'heatmap') map = kind !== 'top_level';
    else if (c.mode === 'density2d') map = !split;
    else if (c.mode === 'upset') map = kind === 'share' || (kind === 'measure' && !!c.measure) || (kind === 'count' && !!c.value);
    const top = c.mode === 'heatmap' && kind === 'top_level';
    return { map, palette: levels || top };
}

/** A typed colour limit: a number, or empty for automatic; else the sentence that says so. */
export function parseColourLimit(text) {
    const s = String(text).trim();
    if (s === '') return { ok: true, value: undefined };
    const v = Number(s);
    return Number.isFinite(v) ? { ok: true, value: v } : { ok: false, message: C.colour.problem };
}

/**
 * The options of the drawing (draw.js `countFigure`'s `options`), from the style fields of the config: printed labels,
 * the sort, Reverse, Horizontal, the log count axis, a ring and the fade, each only where the mode has it. A field of
 * another mode's meaning (an UpSet's `labels: true`, `sort: 'size'`) is not this one's.
 */
export function drawOptions(config) {
    const rows = rowsOf(config.mode);
    const labels = rows.labels && LABEL_KINDS.includes(config.labels) ? config.labels : 'none';
    return {
        labels: labels === 'measure' && !config.measure ? 'none' : labels,
        sort: rows.sort && config.sort === 'height' ? 'height' : undefined,
        reverse: rows.reverse && config.reverse === true,
        horizontal: rows.horizontal && config.horizontal === true,
        log: rows.log && config.log === true,
        ring: rows.ring && config.ring === true,
        fade: config.fade === true,
        // a density's own (CNT-10): the bandwidth adjust, curves scaled by level size, a 2D density as an image
        adjust: rows.density && Number.isFinite(config.adjust) && config.adjust >= ADJUST.min && config.adjust <= ADJUST.max ? config.adjust : 1,
        scale: rows.density && config.scale === 'size' ? 'size' : 'level',
        // a 2D density's layers (opacity image, isolines, filled isolines); an old link's style maps onto them
        layers: rows.density === 2 ? densityLayers(config.layers, config.style, !!config.split) : null,
        pointSize: Number.isFinite(config.pointSize) ? Math.min(12, Math.max(1, config.pointSize)) : 3,
        // the colour scale of a number's color (WP-6a): the map (absent is Viridis), Reverse and the fixed range
        ...(config.color && config.color.map ? { colorscale: config.color.map } : {}),
        colour: colourOf(config.color)
    };
}

/** The stored colour as the figures read it: `{reverse, min?, max?, center?}`, a field only where it is stored. */
function colourOf(color) {
    const c = color || {};
    const out = { reverse: c.reverse === true };
    for (const k of ['min', 'max', 'center']) if (Number.isFinite(c[k])) out[k] = c[k];
    return out;
}

/** The label kinds the Labels select offers: a statistic only when one is stored. */
export function labelChoices(config) {
    return LABEL_KINDS.filter((k) => k !== 'measure' || !!config.measure).map((k) => ({ value: k, label: C.labels[k] }));
}

/** The title of each input of the drawing (draw.js `inputNames`): the source's short name. */
export function inputNames(config, titleOf) {
    const name = (p) => (p && p.source ? sourceName(p.source, titleOf) : '');
    return { x: name(config.x), y: name(config.y), split: name(config.split), factor: name(config.value && config.value.factor) };
}

/** The input a table axis was made from. */
function inputOfAxis(config, axis) {
    if (axis.input === 'sets') return { source: config.sets[axis.set].source };
    return axis.input === 'factor' ? config.value.factor : config[axis.input];
}

/**
 * The label of each level of each axis of a table, as shown (SHR-9): the default labels with the renames of the input as
 * it is now. `made` is the config the reply was made for; `live` the config now, whose renames apply to an input with
 * the same source.
 * @returns {Map<string, string>[]}
 */
export function shownLabels(made, table, live, titleOf) {
    const maps = levelLabelsOf(made, table, titleOf);
    return table.axes.map((axis, i) => {
        const was = inputOfAxis(made, axis);
        const now = axis.input === 'sets' ? null : inputOfAxis(live, axis);
        const labels = now && was && sameSource(now.source, was.source) ? now.labels : (was && was.labels);
        if (!labels) return maps[i];
        const map = new Map(maps[i]);
        for (const [id, text] of Object.entries(labels)) map.set(id, text);
        return map;
    });
}

const NUMERIC_DTYPE = /^(u?int|float)\d*$/;
const obsInfo = (structure, key) => (structure && structure.obs && structure.obs.columns_info && structure.obs.columns_info[key]) || null;

/**
 * Whether a source is binned as a number (count-plot-model.js `planGrid`'s `isNumeric`): an obs column of numbers, an
 * obsm dimension, a gene of a layer, a row of an obsp matrix, and a provider whose values are numbers (a score). A
 * table, a grouping and a column of categories, strings or booleans are counted by their levels.
 * @param {?Object} source
 * @param {?Object} structure - the dataset structure
 */
export function isNumericSource(source, structure) {
    if (!isObject(source)) return false;
    switch (source.type) {
        case 'obs': { const info = obsInfo(structure, source.key); return !!info && NUMERIC_DTYPE.test(String(info.type || '')); }
        case 'obsm': case 'layer': case 'obsp': return true;
        case TABLE_SOURCE: return false;
        default: { const provider = getSource(source.type); return !!provider && provider.valueType === 'numerical'; }
    }
}

/**
 * How many levels a categorical input will have, when the page knows it before asking (`planGrid`'s `levelCount`): the
 * kept levels and the rest's one, a table's two, a boolean's two, an obs column's categories; null otherwise (the
 * engine then counts and refuses).
 */
export function levelCountOf(p, structure) {
    if (!isObject(p) || !isObject(p.source)) return null;
    if (Array.isArray(p.levels)) return p.levels.length + (p.rest === 'exclude' ? 0 : 1);
    if (p.source.type === TABLE_SOURCE) return 2;
    if (p.source.type !== 'obs') return null;
    const info = obsInfo(structure, p.source.key);
    if (!info) return null;
    if (/^bool/.test(String(info.type || ''))) return 2;
    return Number.isInteger(info.n_categories) ? info.n_categories : null;
}

/**
 * What a statistic and a most frequent level start from (UX 4.5, job 5): the focused gene on X, else the first numeric
 * obs column; the first categorical obs column that is not already X or Y.
 * @param {Object} config
 * @param {?Object} structure
 * @param {?string} focusedGene
 * @returns {{measureSource: (Object|undefined), factor: (Object|undefined)}}
 */
export function valueDefaults(config, structure, focusedGene) {
    const index = structure && structure.obs ? structure.obs.index : null;
    const columns = ((structure && structure.obs && structure.obs.columns) || []).filter((c) => c !== '_index' && c !== index);
    const numeric = columns.find((c) => isNumericSource({ type: 'obs', key: c }, structure));
    const used = new Set(['x', 'y'].map((f) => config[f] && config[f].source.type === 'obs' ? config[f].source.key : null));
    const factor = columns.find((c) => !used.has(c) && !isNumericSource({ type: 'obs', key: c }, structure));
    return {
        measureSource: focusedGene ? { type: 'layer', key: 'X', column: focusedGene } : numeric ? { type: 'obs', key: numeric } : undefined,
        factor: factor ? { source: { type: 'obs', key: factor } } : undefined
    };
}

/** The per-level counts of axis `a` of a grid, for a level list: each level's cells over the other axes. */
export function levelTotals(grid, a) {
    const totals = new Array(grid.dims[a]).fill(0);
    const stride = grid.dims.slice(a + 1).reduce((p, d) => p * d, 1);
    for (let c = 0; c < grid.cells; c++) totals[Math.floor(c / stride) % grid.dims[a]] += grid.counts[c];
    return totals;
}
