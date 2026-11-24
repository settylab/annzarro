/**
 * The count plot's model: what is stored, the grid request of each mode, and the table made of the engine's reply
 * (CNT-6, CNT-8, CNT-9, CNT-14 to CNT-19, CNT-22, CNT-23; plan 1.6).
 *
 * A count plot is a dense count over its partitionings, so every mode is one `grid` request and the browser holds no
 * per-cell data. The inputs are partitionings (the grouping's factor shape, `cell-grouping.js`), the request is built
 * by the grouping's request builder, and the table reads the reply's blocks: the counts, in mixed-radix order with
 * the first axis slowest, and, when a measure is asked for, the five moments `[n, sum, sumsq, n_above, sum_above]` of
 * each grid cell.
 *
 * The table is columnar (one typed array per column, `rows` long), built once per reply and axes, and shares, measures
 * and heights are memoised on it, so a paint, a hover or a progress frame costs nothing that grows with the grid.
 *
 * Words the interface shows (a refusal's sentence, a header, a mode's label) are not here: the model returns reasons,
 * numbers and level ids, and the panel and the export put the words to them from `vocabulary.js`.
 *
 * Pure, so Node tests cover it.
 */
import { normalizePartitioning, serverRequest, defaultLabelMaps } from './cell-grouping.js';
import { effectiveBinning } from './binning.js';
import { groupNeed } from './group-store.js';
import { csvField } from './csv-format.js';
import { RESERVED } from './level-id.js';
import { stableStringify } from './url-history.js';
import { limit } from './limits.js';

const VERSION = 1;

// export-unused-ok: C2a lists the modes in the Mode select
export const COUNT_MODES = Object.freeze(['bar', 'histogram', 'hist2d', 'density', 'density2d', 'pie', 'heatmap', 'venn', 'upset']);
// export-unused-ok: C2a lists the statistics of the Height menu
export const MEASURE_STATS = Object.freeze(['mean', 'sum', 'pct_above', 'sd', 'zscore']);
// export-unused-ok: C2a labels each share base
export const SHARE_BASES = Object.freeze(['all', 'x', 'split', 'row', 'column', 'total']);
/** How a Color by's bars sit: stacked, side by side, overlaid (translucent, over each other) or as shares of 100%. */
// export-unused-ok: the controls offer the arrangements
export const ARRANGEMENTS = Object.freeze(['stack', 'dodge', 'overlay', 'fill']);
const VALUE_KINDS = Object.freeze(['count', 'share', 'measure', 'top_level']);
const SET_OPS = Object.freeze(['>', '>=', '<', '<=']);

const DEFAULT_MODE = 'bar';
const DEFAULT_ARRANGEMENT = 'stack';

/**
 * The arrangement a Bar or a Histogram draws, and its controls show: the stored one, or the closest that applies when it
 * was stored for the other view. Bins of a number cannot sit side by side, so a histogram's `dodge` (what a histogram's
 * overlay was stored as before 0.8.0, and a Bar's side by side kept through a switch) is overlaid; a Bar's `overlay` is
 * side by side. What is stored is kept, so switching back restores it.
 * @param {Object} config
 * @returns {string}
 */
export function arrangementShown(config) {
    const stored = config.arrangement || DEFAULT_ARRANGEMENT;
    if (config.mode === 'histogram' && stored === 'dodge') return 'overlay';
    if (config.mode !== 'histogram' && stored === 'overlay') return 'dodge';
    return stored;
}
const DEFAULT_SHARE_BASE = 'all';

/**
 * Bins a count plot may ask for, by dimension (SHR-39, CNT-9): the server's limits.grid_1d_bins and grid_2d_bins
 * (2,000 and 512 by default), read at each use. The grouping's own limit is lower (binning.js).
 */
const BINS = Object.freeze({
    get one() { return { min: 2, max: limit('grid_1d_bins') }; },
    get two() { return { min: 2, max: limit('grid_2d_bins') }; }
});
const DEFAULT_BINS = Object.freeze({ one: 50, two: 100 });
/** The grid a density is smoothed on (CNT-10): the engine bins this fine, the browser smooths (never finer than the
 *  server's bins of the dimension, `densityBins`). */
const DENSITY_BINS = Object.freeze({ density: 512, density2d: 256 });
const densityBins = (mode) => Math.min(DENSITY_BINS[mode], mode === 'density2d' ? BINS.two.max : BINS.one.max);
const PIE_LEVELS = 12;
/** The modes that colour a rectangle by its most frequent level (CNT-18). */
const TOP_LEVEL_MODES = Object.freeze(['hist2d', 'heatmap']);

/** What each mode reads (UX 4.2); `dimension` picks the bin limits and defaults, `wire` the grid request's mode. */
const MODES = Object.freeze({
    bar: { x: true, split: true, wire: 'categorical', dimension: 'one' },
    pie: { x: true, wire: 'categorical', dimension: 'one' },
    histogram: { x: true, split: true, wire: '1d', dimension: 'one', numeric: ['x'] },
    density: { x: true, split: true, wire: '1d', dimension: 'one', numeric: ['x'], density: true },
    hist2d: { x: true, y: true, split: true, wire: '2d', dimension: 'two', numeric: ['x', 'y'] },
    density2d: { x: true, y: true, split: true, wire: '2d', dimension: 'two', numeric: ['x', 'y'], density: true },
    heatmap: { x: true, y: true, wire: 'categorical', dimension: 'two' },
    venn: { sets: true, wire: 'sets', setsMax: 3 },
    upset: { sets: true, wire: 'sets', setsMax: 16 }
});

/**
 * The limits of each mode's inputs (UX 4.3): the most levels (or, for a numeric input, bins) it may have.
 * `bins` is the limit of a numeric input, `levels` of a categorical one. They are the server's grid limits
 * (limits.grid_categorical_levels, grid_1d_bins, grid_1d_split, grid_2d_bins, grid_2d_split; by default 200, 2,000,
 * 200, 512 and 8), read when asked.
 */
function modeLimits(mode) {
    const cat = limit('grid_categorical_levels'), bins1 = limit('grid_1d_bins'), split1 = limit('grid_1d_split');
    const bins2 = limit('grid_2d_bins'), split2 = limit('grid_2d_split');
    const all = {
        bar: { x: { levels: cat, bins: cat } },
        pie: { x: { levels: cat, bins: cat } },
        heatmap: { x: { levels: cat, bins: cat }, y: { levels: cat, bins: cat } },
        histogram: { x: { bins: bins1 }, split: { levels: split1 } },
        density: { x: { bins: bins1 }, split: { levels: split1 } },
        hist2d: { x: { bins: bins2 }, y: { bins: bins2 }, split: { levels: split2 }, factor: { levels: split2 } },
        density2d: { x: { bins: bins2 }, y: { bins: bins2 }, split: { levels: split2 } }
    };
    return all[mode];
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// --- the stored config -----------------------------------------------------------------------------------------------

const KNOWN = ['version', 'mode', 'x', 'y', 'split', 'arrangement', 'sets', 'value', 'measure', 'binSpacing', 'color'];
const INPUTS = ['x', 'y', 'split'];

/** An input as a partitioning. Its bin count goes to 2,000 and is kept as typed, since the default differs by mode. */
function normalizeInput(raw, field, bad) {
    const { partitioning, problems } = normalizePartitioning(raw, { max: BINS.one.max, keepDefault: true });
    if (!partitioning) {
        bad(field, 'bad_input');
        return null;
    }
    for (const p of problems) bad(`${field}.${p.field}`, p.reason);
    return partitioning;
}

function normalizeMember(raw) {
    if (!isObject(raw)) return null;
    if (Array.isArray(raw.levels)) return raw.levels.every((id) => typeof id === 'string') ? { ...raw } : null;
    if (raw.op !== undefined) return SET_OPS.includes(raw.op) && isNumber(raw.value) ? { ...raw } : null;
    if (Array.isArray(raw.group)) return raw.group.every((id) => typeof id === 'string') ? { ...raw } : null;
    return null;
}

function normalizeSets(raw, bad) {
    if (!Array.isArray(raw)) {
        bad('sets', 'bad_sets');
        return [];
    }
    const out = [];
    for (const item of raw) {
        const source = isObject(item) ? normalizePartitioning({ source: item.source }).partitioning : null;
        const member = isObject(item) && item.member !== undefined ? normalizeMember(item.member) : undefined;
        if (!source || member === null || (member === undefined && !source.source.type)) {
            bad('sets', 'bad_sets');
            continue;
        }
        const set = { ...item, source: source.source };
        if (member) set.member = member;
        out.push(set);
    }
    return out;
}

function normalizeValue(raw, bad, factorOf) {
    if (!isObject(raw) || !VALUE_KINDS.includes(raw.kind)) {
        bad('value', 'bad_value');
        return null;
    }
    const out = { ...raw };
    if (raw.kind === 'count' && Object.keys(raw).length === 1) return null;
    if (raw.of !== undefined && !SHARE_BASES.includes(raw.of)) {
        bad('value.of', 'bad_value');
        delete out.of;
    }
    if (raw.kind === 'top_level') {
        const factor = factorOf(raw.factor);
        if (!factor) return null;
        out.factor = factor;
    }
    return out;
}

function normalizeMeasure(raw, bad) {
    const source = isObject(raw) ? normalizePartitioning({ source: raw.source }).partitioning : null;
    if (!source || !MEASURE_STATS.includes(raw.stat) || (raw.above !== undefined && !isNumber(raw.above))) {
        bad('measure', 'bad_measure');
        return null;
    }
    return { ...raw, source: source.source };
}

/**
 * A count plot's config from whatever a link, a panel set or the panel holds: every field valid, defaults left out,
 * unknown fields kept. A config of a newer version is returned as it is, and reported.
 * @param {*} raw
 * @returns {{config: Object, problems: {field: string, reason: string}[]}}
 */
// export-unused-ok: C2a reads the stored config, and C2b reports its problems
export function normalizeCountPlot(raw) {
    const problems = [];
    const bad = (field, reason) => problems.push({ field, reason });
    if (!isObject(raw)) {
        if (raw !== undefined) bad('config', 'bad_config');
        return { config: { version: VERSION, mode: DEFAULT_MODE }, problems };
    }
    if (raw.version !== undefined && (!Number.isInteger(raw.version) || raw.version < 1)) bad('version', 'bad_version');
    if (Number.isInteger(raw.version) && raw.version > VERSION) {
        bad('version', 'newer_version');
        return { config: { ...raw }, problems };
    }
    const out = { version: VERSION };
    if (COUNT_MODES.includes(raw.mode)) {
        out.mode = raw.mode;
    } else {
        if (raw.mode !== undefined) bad('mode', 'bad_mode');
        out.mode = DEFAULT_MODE;
    }
    for (const field of INPUTS) {
        if (raw[field] === undefined) continue;
        const input = normalizeInput(raw[field], field, bad);
        if (input) out[field] = input;
    }
    if (raw.arrangement !== undefined) {
        if (!ARRANGEMENTS.includes(raw.arrangement)) bad('arrangement', 'bad_arrangement');
        else if (raw.arrangement !== DEFAULT_ARRANGEMENT) out.arrangement = raw.arrangement;
    }
    if (raw.sets !== undefined) out.sets = normalizeSets(raw.sets, bad);
    if (raw.value !== undefined) {
        const value = normalizeValue(raw.value, bad, (factor) => normalizeInput(factor, 'value.factor', bad));
        if (value) out.value = value;
    }
    if (raw.measure !== undefined) {
        const measure = normalizeMeasure(raw.measure, bad);
        if (measure) out.measure = measure;
    }
    if (raw.binSpacing !== undefined) {
        const spacing = normalizeBinSpacing(raw.binSpacing, bad);
        if (spacing) out.binSpacing = spacing;
    }
    if (raw.color !== undefined) {
        const color = normalizeColor(raw.color, bad);
        if (color) out.color = color;
    }
    for (const key of Object.keys(raw)) if (!KNOWN.includes(key)) out[key] = raw[key];
    return { config: out, problems };
}

/**
 * The colour of the plot (WP-6a): `{map?, reverse?, min?, max?, center?, palette?}`. `map` is a colour scale's name,
 * `reverse` flips it, `min`, `max` and `center` fix the range of a colour scale (absent: automatic), `palette` names the
 * discrete palette of a Color by's levels. A field that is not valid is reported and left out; an empty colour is none.
 */
function normalizeColor(raw, bad) {
    if (!isObject(raw)) {
        bad('color', 'bad_color');
        return null;
    }
    const out = {};
    for (const field of ['map', 'palette']) {
        if (raw[field] === undefined) continue;
        if (typeof raw[field] === 'string' && raw[field]) out[field] = raw[field]; else bad(`color.${field}`, 'bad_color');
    }
    if (raw.reverse !== undefined) {
        if (raw.reverse === true) out.reverse = true; else if (raw.reverse !== false) bad('color.reverse', 'bad_color');
    }
    for (const field of ['min', 'max', 'center']) {
        if (raw[field] === undefined) continue;
        if (isNumber(raw[field])) out[field] = raw[field]; else bad(`color.${field}`, 'bad_color');
    }
    return Object.keys(out).length ? out : null;
}

/** How a binned axis is drawn: each bin at its index, all one width ('even'), or at its values ('value'). */
const BIN_SPACINGS = Object.freeze(['even', 'value']);

/** `{x?, y?}` of the stored spacings; a value that is not one is reported and left out. */
function normalizeBinSpacing(raw, bad) {
    if (!isObject(raw)) {
        bad('binSpacing', 'bad_bin_spacing');
        return null;
    }
    const out = {};
    for (const [axis, value] of Object.entries(raw)) {
        if (!['x', 'y'].includes(axis) || !BIN_SPACINGS.includes(value)) bad(`binSpacing.${axis}`, 'bad_bin_spacing');
        else out[axis] = value;
    }
    return Object.keys(out).length ? out : null;
}

/**
 * How input `input` ('x', 'y') of a config draws its bins: the stored choice, or the default of its binning: equal-width
 * bins are drawn at their values (both ways look the same), log, equal-count and manual bins evenly (WP-9).
 * @param {Object} config - from normalizeCountPlot
 * @param {string} input
 * @returns {'even'|'value'}
 */
export function binSpacingOf(config, input) {
    const stored = config.binSpacing && config.binSpacing[input];
    if (BIN_SPACINGS.includes(stored)) return stored;
    const p = config[input];
    const method = (p && isObject(p.binning) && p.binning.method) || 'equal_width';
    return method === 'equal_width' ? 'value' : 'even';
}

// --- inputs per mode (CNT-6) -----------------------------------------------------------------------------------------

/** Which inputs a mode reads (UX 4.2). */
// export-unused-ok: C2a shows the rows a mode reads
export function modeReads(mode) {
    const m = MODES[mode];
    return { x: !!m.x, y: !!m.y, split: !!m.split, sets: !!m.sets };
}

/**
 * The inputs the config stores that its mode does not read, in the order x, y, split, sets: switching mode keeps them,
 * and the panel lists them in one line.
 * @returns {string[]}
 */
// export-unused-ok: C2a writes the "Kept for other modes" line
export function keptForOtherModes(config) {
    const reads = modeReads(config.mode);
    const stored = (field) => (field === 'sets' ? Array.isArray(config.sets) && config.sets.length > 0 : config[field] !== undefined);
    return [...INPUTS, 'sets'].filter((field) => stored(field) && (!reads[field] || (field === 'split' && !splitUsed(config))));
}

/**
 * Whether the mode reads the config's Color by now: a bar, a histogram or a density always does; a 2D histogram while its
 * rectangles show counts (a share, a statistic or the most frequent level says something else with their color).
 */
export function splitUsed(config) {
    if (!modeReads(config.mode).split) return false;
    return config.mode !== 'hist2d' || !config.value || config.value.kind === 'count';
}

/**
 * The layers a 2D density is drawn in: an opacity `image`, `lines` (isolines), `fill` (isolines filled in bands) and `points` (each cell
 * a point at its place), any combination. The stored `layers` win; else an old link's `style` ('image', or 'contours': isolines of a Color by's levels,
 * filled isolines of one group); else the default: filled isolines, with lines when there is a Color by. Never none.
 * @param {Object} [layers] - the stored `{image?, lines?, fill?}`
 * @param {string} [style] - the stored style of an old link
 * @param {boolean} split - whether the plot has a Color by
 * @returns {{image: boolean, lines: boolean, fill: boolean}}
 */
export function densityLayers(layers, style, split) {
    if (isObject(layers)) {
        const out = { image: layers.image === true, lines: layers.lines === true, fill: layers.fill === true, points: layers.points === true };
        if (out.image || out.lines || out.fill || out.points) return out;
    }
    if (style === 'image') return { image: true, lines: false, fill: false, points: false };
    if (style === 'contours') return split ? { image: false, lines: true, fill: false, points: false } : { image: false, lines: false, fill: true, points: false };
    return { image: false, lines: !!split, fill: true, points: false };
}

// --- bins ------------------------------------------------------------------------------------------------------------

/**
 * The bin counts a typed number may take in this mode: for `input` ('x', 'y'), also within that input's limit (UX 4.3),
 * so a count the field takes is never refused (a bar's X takes 200 bins, though a 1D axis takes 2,000).
 * @param {string} mode
 * @param {string} [input]
 */
export function binsRange(mode, input) {
    const range = { ...BINS[MODES[mode].dimension || 'one'] };
    const limits = modeLimits(mode);
    const cap = input && limits && limits[input] ? limits[input].bins : undefined;
    if (cap !== undefined) range.max = Math.min(range.max, cap);
    return range;
}

/** `null` when `n` is a bin count this mode (and input) takes, else the reason (`bad_bins`). */
// export-unused-ok: the model's tests state the limits through it; the control reads binsRange
export function binsProblem(mode, n, input) {
    const { min, max } = binsRange(mode, input);
    return Number.isInteger(n) && n >= min && n <= max ? null : 'bad_bins';
}

// --- the grid request and its limits ---------------------------------------------------------------------------------

/** An input made ready to send: a number gets the count plot's default binning, and every binning excludes (SHR-45). */
function prepared(p, mode, input, numeric) {
    if (!numeric) return p;
    const m = MODES[mode];
    const stored = p.binning || { method: 'equal_width' };
    if (stored.method === 'manual') return { ...p, binning: { ...stored } };
    const fixed = m.density && (input === 'x' || input === 'y');
    const bins = fixed ? densityBins(mode) : (stored.bins === undefined ? DEFAULT_BINS[m.dimension] : stored.bins);
    return { ...p, binning: { ...stored, bins, outside: 'exclude' } };
}

/** The levels an input will have: its bins (zero bin and manual thresholds included), or what the caller knows of it. */
function sizeOf(p, numeric, ctx) {
    if (!numeric) return ctx.levelCount ? ctx.levelCount(p) : null;
    const b = p.binning;
    return b.method === 'manual' ? b.thresholds.length + 1 : b.bins + (b.zero_bin ? 1 : 0);
}

/** A number the engine bins, as against a column read by its values (a categorical one, or an integer split by them). */
const isBinned = (p, ctx) => !!ctx.isNumeric && ctx.isNumeric(p.source) && !(p.binning && p.binning.method === 'categories');

/** The first limit a plan breaks, as the refusal that names every limited input of the mode with its count. */
function checkLimits(config, plan, ctx) {
    const limits = modeLimits(config.mode) || {};
    const sizes = new Map(plan.map((e) => [e, sizeOf(e.partitioning, e.numeric, ctx)]));
    const capOf = (e) => (limits[e.input] ? limits[e.input][e.numeric ? 'bins' : 'levels'] : undefined);
    const limited = plan.filter((e) => capOf(e) !== undefined);
    const over = limited.filter((e) => sizes.get(e) !== null && sizes.get(e) > capOf(e));
    if (over.length) {
        return {
            state: 'refused', reason: over[0].numeric ? 'too_many_bins' : 'too_many_levels', mode: config.mode,
            inputs: limited.map((e) => e.input), counts: limited.map((e) => sizes.get(e)), limits: limited.map(capOf),
            over: over.map((e) => e.input)
        };
    }
    const all = plan.map((e) => sizes.get(e));
    const cells = all.every((n) => n !== null) ? all.reduce((p, n) => p * n, 1) : 0;
    const most = limit('grid_cells');               // the server's (limits.grid_cells), 512 x 512 x 8 by default
    if (cells > most) {
        return { state: 'refused', reason: 'grid_too_large', mode: config.mode, inputs: plan.map((e) => e.input), counts: [cells], limits: [most], over: [] };
    }
    return null;
}

function setsPlan(config, ctx) {
    const sets = config.sets || [];
    // the server's limits.grid_sets caps an UpSet (16 by default and at most); a Venn draws 3
    const max = Math.min(MODES[config.mode].setsMax, limit('grid_sets'));
    if (sets.length < 2) return { state: 'empty', reason: 'choose_sets' };
    if (sets.length > max) {
        const common = { reason: 'too_many_sets', mode: config.mode, count: sets.length, limit: max };
        return config.mode === 'venn' ? { state: 'unusable', ...common }
            : { state: 'refused', reason: common.reason, mode: config.mode, inputs: ['sets'], counts: [sets.length], limits: [max], over: ['sets'] };
    }
    if (!ctx.memberFor) throw new Error('A set request needs ctx.memberFor: the wire form of each set\'s member.');
    return {
        state: 'ready', inputs: sets.map((set, i) => ({ input: 'sets', set: i })),
        partitionings: sets.map((set) => ({ source: set.source })), members: sets.map((set) => ctx.memberFor(set))
    };
}

/**
 * What a config asks of the engine, or why it asks nothing: checked before any request is made (SHR-39).
 * @param {Object} config - from normalizeCountPlot
 * @param {{isNumeric: (source: Object) => boolean, levelCount: (partitioning: Object) => (number|null), subset?: Object,
 *   bitsetFor?: Function, inlineRecipe?: Function, memberFor?: (set: Object) => Object,
 *   hashOf?: (source: Object) => (string|undefined)}} ctx
 *   `isNumeric` says whether a source is binned as a number; `levelCount` how many levels a categorical input will have
 *   (null when it is not known: the engine then refuses); `memberFor` the wire form of a set's member; `hashOf` the
 *   hash of what a source of another panel computes (a table's cells, a score's recipe, a grouping)
 * @returns {{state: 'empty', reason: string}|{state: 'unusable', reason: string, mode: string}
 *   |{state: 'refused', reason: string, mode: string, inputs: string[], counts: number[], limits: number[], over: string[]}
 *   |{state: 'ready', request: Object, inputs: {input: string, set?: number}[], key: string}}
 *   `key` is the grid's key (PER-3): what the engine computes, a source of another panel by its hash, never a bitset
 */
// export-unused-ok: C2a sends the request and C2b says each refusal
export function planGrid(config, ctx) {
    const mode = MODES[config.mode];
    let inputs;
    let partitionings;
    let members = null;
    if (mode.sets) {
        const found = setsPlan(config, ctx);
        if (found.state !== 'ready') return found;
        ({ inputs, partitionings, members } = found);
    } else {
        if (!config.x) return { state: 'empty', reason: 'choose_x' };
        if (mode.y && !config.y) return { state: 'empty', reason: 'choose_y' };
        // a 2D histogram's Color by splits its counts into layers; it is read only while the rectangles show counts
        const wanted = INPUTS.filter((input) => mode[input] && config[input] && !(input === 'split' && !splitUsed(config))).map((input) => [input, config[input]]);
        if (config.value && config.value.kind === 'top_level' && TOP_LEVEL_MODES.includes(config.mode)) wanted.push(['factor', config.value.factor]);
        const plan = wanted.map(([input, p]) => {
            const numeric = isBinned(p, ctx);
            return { input, numeric, partitioning: prepared(p, config.mode, input, numeric) };
        });
        const unusable = plan.find((e) => (mode.numeric || []).includes(e.input) && !e.numeric);
        if (unusable) return { state: 'unusable', reason: 'needs_numeric', mode: config.mode, input: unusable.input };
        const refused = checkLimits(config, plan, ctx);
        if (refused) return refused;
        inputs = plan.map((e) => ({ input: e.input }));
        partitionings = plan.map((e) => e.partitioning);
    }
    const body = serverRequest({ partitionings }, ctx, {});
    const request = { shape: 'grid', mode: mode.wire, partitionings: body.partitionings, subset: body.subset };
    if (body.sets) request.sets = body.sets;
    if (mode.density) request.density = true;
    if (members) members.forEach((member, i) => { request.partitionings[i].member = member; });
    if (config.value && config.value.kind === 'measure' && config.measure) {
        const measure = { id: 'm0', source: wireSource(config.measure.source, ctx) };
        if (config.measure.above !== undefined) measure.above = config.measure.above;
        request.measures = [measure];
    }
    // the key names a measure's source as the config does (a score by the hash of its recipe), not as it is sent
    const keyed = request.measures ? { ...request, measures: request.measures.map((m) => ({ ...m, source: config.measure.source })) } : request;
    return { state: 'ready', request, inputs, key: gridKey(keyed, partitionings, members, ctx) };
}

/**
 * A measure's source as the request carries it: the fields the server reads, and a score's recipe inline (the score
 * route's, as a partitioning's carries it; the server refuses a field it does not take).
 */
function wireSource(source, ctx) {
    const out = Object.fromEntries(['type', 'key', 'column', 'layer'].filter((f) => source[f] !== undefined).map((f) => [f, source[f]]));
    const inline = ctx && ctx.inlineRecipe ? ctx.inlineRecipe(source) : null;
    if (inline && inline.recipe) out.recipe = inline.recipe;
    return out;
}

/** A source as a key names it: one of another panel by the hash of what it computes, not by the panel. */
function keyedSource(source, ctx) {
    const up = ctx.hashOf ? ctx.hashOf(source) : undefined;
    if (typeof up !== 'string') return source;
    const out = { ...source, upstream: up };
    delete out.key;
    return out;
}

/** The key of a grid request: everything it sends but the cells shown, with each source keyed by what it computes. */
function gridKey(request, partitionings, members, ctx) {
    return stableStringify({
        v: VERSION, mode: request.mode, density: !!request.density, members,
        p: partitionings.map((p) => ({ source: keyedSource(p.source, ctx), levels: p.levels || null,
            rest: p.rest === 'exclude' ? 'exclude' : 'other', binning: p.binning ? effectiveBinning(p.binning) : null })),
        measures: (request.measures || []).map((m) => ({ ...m, source: keyedSource(m.source, ctx) }))
    });
}

/**
 * The count plot as a source of groups (utils/group-sources.js): its stored config, the sources it reads (which may
 * be other panels), its key and what it asks the group store for. A plan that is not ready (no input, a mode it
 * cannot draw, a limit broken) asks nothing, and is the handle's state.
 * @param {{isNumeric: Function, levelCount: Function, memberFor?: Function}} page - what planGrid asks of the page
 */
// export-unused-ok: C2a gives the page's group sources a count plot
export function gridShape(page) {
    /** @type {WeakMap<Object, Object>} resolved config -> its plan */
    const plans = new WeakMap();
    const planOf = (resolved, ctx) => {
        let plan = plans.get(resolved);
        if (!plan) plans.set(resolved, plan = planGrid(resolved.recipe, { ...page, ...ctx }));
        return plan;
    };
    return {
        normalize: (raw) => normalizeCountPlot(raw).config,
        sources: (config) => [
            ...INPUTS.filter((input) => config[input]).map((input) => config[input].source),
            ...(config.value && config.value.factor ? [config.value.factor.source] : []),
            ...(config.sets || []).map((set) => set.source),
            ...(config.measure ? [config.measure.source] : [])
        ],
        /** The sources in the order of the grid's axes. */
        parts(resolved, ctx) {
            const plan = planOf(resolved, ctx);
            const config = resolved.recipe;
            if (plan.state !== 'ready') return [];
            return plan.inputs.map(({ input, set }) => (input === 'sets' ? config.sets[set].source
                : input === 'factor' ? config.value.factor.source : config[input].source));
        },
        hash(resolved, ctx) {
            const plan = planOf(resolved, ctx);
            return plan.state === 'ready' ? plan.key : stableStringify(plan);
        },
        need(resolved, option, ctx) {
            const plan = planOf(resolved, ctx);
            return plan.state === 'ready' ? { recipe: groupNeed({ request: plan.request, key: plan.key }) } : { none: { ...plan } };
        }
    };
}

// --- the reply -------------------------------------------------------------------------------------------------------

const MOMENTS = 5;
const [N, SUM, SUMSQ, N_ABOVE] = [0, 1, 2, 3];

/** A contract error: the reply is not what the request's shape promises. */
function gridError(message) {
    return Object.assign(new Error(message), { reason: 'bad_grid_reply' });
}

/** Cells an axis left out under `outside: 'exclude'`, from the grouping reply's `[below, above]`; null when it is not that. */
function outsideOf(axis) {
    const v = axis.n_outside;
    return Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0) ? v[0] + v[1] : null;
}

/**
 * The first field an axis must carry that it does not, as the grouping reply's partitionings[i] carries it: every axis
 * `n_outside`; a binned one also `edges`, `bins_made` and `degenerate`, and `value` when degenerate.
 */
function missingAxisField(axis) {
    if (outsideOf(axis) === null) return 'n_outside';
    if (!isBinnedAxis(axis.levels)) return null;
    if (!Array.isArray(axis.edges)) return 'edges';
    if (!Number.isInteger(axis.bins_made)) return 'bins_made';
    if (typeof axis.degenerate !== 'boolean') return 'degenerate';
    return axis.degenerate && !('value' in axis) ? 'value' : null;
}

const flatten = (rows) => {
    const out = new Float64Array(rows.length * MOMENTS);
    rows.forEach((row, i) => {
        if (row.length !== MOMENTS) throw new Error(`The grid's measure rows hold ${MOMENTS} moments each; row ${i} has ${row.length}.`);
        out.set(row, i * MOMENTS);
    });
    return out;
};

/** @type {WeakMap<Object, Object>} the group store's value -> its grid */
const grids = new WeakMap();

/**
 * The reply of a grid request as a grid: the levels of each axis, the counts and the moments in the engine's order.
 * Read once per value, so a paint reads the same grid and its tables are reused.
 * @param {{reply: {n_shown: number, n_counted: number, axes: Object[]}, counts: ArrayLike<number>,
 *   measures?: (ArrayLike<number>|number[][]|null)}} value - a handle's `values` (utils/group-store.js): the result
 *   frame read, the counts block and the measure moments. Each axis is `{levels, n_outside}` and, when binned,
 *   `{edges, bins_made, degenerate, value?}` as the grouping reply's partitionings are; a reply without them is
 *   refused (`reason: 'bad_grid_reply'`). The measure is the block (flat, `cells × 5`) or a list of five-number rows
 */
// export-unused-ok: C2a reads the reply of the grid request
export function readGrid(value) {
    let grid = grids.get(value);
    if (!grid) {
        grid = gridOf(value.reply, value.counts, value.measures);
        grids.set(value, grid);
    }
    return grid;
}

function gridOf(reply, counts, measures) {
    if (!Number.isInteger(reply.n_shown)) throw gridError('The grid reply lacks n_shown.');
    reply.axes.forEach((axis, i) => {
        const field = missingAxisField(axis);
        if (field) throw gridError(`The grid reply's axis ${i} lacks ${field}, or it is malformed.`);
    });
    const dims = reply.axes.map((a) => a.levels.length);
    const cells = dims.reduce((p, d) => p * d, 1);
    if (counts.length !== cells) throw new Error(`The grid's counts block has ${counts.length} cells; its axes make ${cells}.`);
    let measure = null;
    if (measures) {
        measure = Array.isArray(measures) && Array.isArray(measures[0]) ? flatten(measures) : measures;
        if (measure.length !== cells * MOMENTS) throw new Error(`The grid's measure block has ${measure.length} numbers; ${cells} cells need ${cells * MOMENTS}.`);
    }
    const pooled = measure ? [0, 0, 0] : null;
    if (measure) for (let c = 0; c < cells; c++) for (let k = 0; k < 3; k++) pooled[k] += measure[c * MOMENTS + k];
    return { axes: reply.axes.map((a) => ({ ...a })), dims, cells, counts, measure, counted: reply.n_counted, shown: reply.n_shown, outside: reply.axes.reduce((n, a) => n + outsideOf(a), 0),
        pooled: pooled && { n: pooled[N], sum: pooled[SUM], sumsq: pooled[SUMSQ] }, tables: new Map() };
}

/** Whether an axis is a binned number: its cells without a value are then not a level of the plot but counted apart. */
const isBinnedAxis = (levels) => levels.some((id) => id.startsWith('bin:') || id === RESERVED.zero);

/**
 * The table of a grid: one row per combination of the inputs' levels, in the engine's order, first input slowest.
 * An input that is a factor (the most frequent level's) is summed away and kept as `top`. A binned input's cells
 * without a value are counted in `noValue` and are no row; a pie keeps its 12 largest levels and collects the rest.
 * @param {Object} config
 * @param {Object} grid - from readGrid
 * @param {{input: string}[]} inputs - the grid's axes, in order (planGrid's `inputs`)
 * @returns {{rows: number, axes: {input: string, set?: number, levels: string[], info: Object}[], dims: number[], count: Float64Array,
 *   moments: Float64Array|null, top: ({levels: string[], info: Object, level: Int32Array, share: Float64Array}|null), total: number,
 *   counted: number, noValue: Object, pooled: Object|null}} `top.info` is the factor's axis of the reply, as `axes[i].info`
 */
// export-unused-ok: C3 draws the table and V1 reads the regions of a set grid
export function countTable(config, grid, inputs) {
    const pie = config.mode === 'pie';
    const wantTop = !!(config.value && config.value.kind === 'top_level');
    const key = `${pie}|${wantTop}|${inputs.map((i) => `${i.input}${i.set === undefined ? '' : i.set}`).join(',')}`;
    let table = grid.tables.get(key);
    if (!table) {
        table = project(grid, inputs, pie, wantTop);
        grid.tables.set(key, table);
    }
    return table;
}

function levelMaps(grid, inputs, pie) {
    return inputs.map((input, a) => {
        if (input.input === 'factor') return null;
        const levels = grid.axes[a].levels;
        const dropNa = isBinnedAxis(levels);
        const map = new Int32Array(levels.length);
        const kept = [];
        levels.forEach((id, i) => {
            if (dropNa && id === RESERVED.na) map[i] = -1;
            else { map[i] = kept.length; kept.push(id); }
        });
        if (pie && inputs.length === 1 && kept.length > PIE_LEVELS) collectSmallest(grid, a, map, kept);
        return { map, levels: kept };
    });
}

/** Pie: all but the 12 largest levels share one new level, `@other`, last. */
function collectSmallest(grid, axis, map, kept) {
    const size = new Float64Array(kept.length);
    for (let i = 0; i < map.length; i++) if (map[i] >= 0) size[map[i]] += grid.counts[i];
    const order = Array.from(size.keys()).sort((a, b) => size[b] - size[a] || a - b).slice(0, PIE_LEVELS);
    const keep = new Set(order);
    const renumber = new Int32Array(kept.length).fill(-1);
    const levels = [];
    kept.forEach((id, i) => { if (keep.has(i)) { renumber[i] = levels.length; levels.push(id); } });
    const other = levels.length;
    levels.push(RESERVED.other);
    for (let i = 0; i < map.length; i++) if (map[i] >= 0) map[i] = renumber[map[i]] >= 0 ? renumber[map[i]] : other;
    kept.length = 0;
    kept.push(...levels);
}

function project(grid, inputs, pie, wantTop) {
    const maps = levelMaps(grid, inputs, pie);
    const kept = inputs.map((_, a) => a).filter((a) => maps[a]);
    const factor = inputs.findIndex((i) => i.input === 'factor');
    const dims = kept.map((a) => maps[a].levels.length);
    const rows = dims.reduce((p, d) => p * d, 1);
    const stride = dims.map((_, i) => dims.slice(i + 1).reduce((p, d) => p * d, 1));
    const count = new Float64Array(rows);
    const moments = grid.measure ? new Float64Array(rows * MOMENTS) : null;
    // the factor's axis of the reply goes with it (`info`: whether it is a boolean column, a grouping's group names), so
    // its levels are labelled as an axis's are
    const top = wantTop && factor >= 0 ? { levels: grid.axes[factor].levels, info: grid.axes[factor], level: new Int32Array(rows).fill(-1),
        share: new Float64Array(rows).fill(NaN) } : null;
    const best = top ? new Float64Array(rows) : null;
    const noValue = Object.fromEntries(kept.map((a) => [inputs[a].input, 0]));
    const at = new Int32Array(inputs.length);
    for (let c = 0; c < grid.cells; c++) {
        const n = grid.counts[c];
        let row = 0;
        let dropped = false;
        for (const a of kept) {
            const to = maps[a].map[at[a]];
            if (to < 0) { noValue[inputs[a].input] += n; dropped = true; } else row += to * stride[kept.indexOf(a)];
        }
        if (!dropped) {
            count[row] += n;
            if (moments) for (let k = 0; k < MOMENTS; k++) moments[row * MOMENTS + k] += grid.measure[c * MOMENTS + k];
            if (top && n > best[row]) { best[row] = n; top.level[row] = at[factor]; }
        }
        for (let a = inputs.length - 1; a >= 0; a--) {
            if (++at[a] < grid.dims[a]) break;
            at[a] = 0;
        }
    }
    if (top) for (let r = 0; r < rows; r++) if (top.level[r] >= 0) top.share[r] = best[r] / count[r];
    let total = 0;
    for (let r = 0; r < rows; r++) total += count[r];
    return { rows, axes: kept.map((a) => ({ ...inputs[a], levels: maps[a].levels, info: grid.axes[a] })), dims, stride, count, moments, top, total, counted: grid.counted, shown: grid.shown, outside: grid.outside,
        noValue, pooled: grid.pooled, shares: new Map(), measures: new Map() };
}

/** The partitioning an axis of the table was made from. */
function inputOf(config, axis) {
    if (axis.input === 'sets') return { source: config.sets[axis.set].source };
    return axis.input === 'factor' ? config.value.factor : config[axis.input];
}

/**
 * The default label of each level of each axis (SHR-9, SHR-45): `[Map level id -> label]`, one per axis of the table.
 * A binned axis is labelled from the reply's own `edges`, `bins_made`, `degenerate` and `value`, with the end bins
 * closed ranges since a count plot excludes what lies outside. A user's rename is the caller's to apply.
 * @param {Object} config
 * @param {Object} table - from countTable
 * @param {(source: Object) => (string|undefined)} [titleOf] - the title of the panel behind a source
 */
// export-unused-ok: C3 labels the axes, the hover and the export
export function levelLabelsOf(config, table, titleOf) {
    const partitionings = table.axes.map((axis) => {
        const p = inputOf(config, axis);
        if (!isBinnedAxis(axis.info.levels)) return p;
        const stored = p.binning || { method: 'equal_width' };
        const exclude = stored.method !== 'manual' && stored.method !== 'categories';
        return { ...p, binning: exclude ? { ...stored, outside: 'exclude' } : stored };
    });
    const reply = { partitionings: table.axes.map((axis) => ({ ...axis.info, levels: axis.levels })) };
    return defaultLabelMaps({ partitionings }, reply, titleOf);
}

/** The level ids of row `r`, one per axis of the table. */
// export-unused-ok: C3 names the level of each row
export function levelsAt(table, r) {
    return table.axes.map((axis, i) => axis.levels[Math.floor(r / table.stride[i]) % table.dims[i]]);
}

// --- shares, measures and heights ------------------------------------------------------------------------------------

/** The input a share base holds fixed: `x` and `column` the x level, `split` the split level, `row` the y level. */
const BASE_AXIS = Object.freeze({ x: 'x', column: 'x', split: 'split', row: 'y' });

/** The share bases the menu offers for a config (CNT-15): each cell of a heatmap by row, column or total. */
// export-unused-ok: C2a offers the share bases of the mode
export function shareBasesFor(config) {
    if (config.mode === 'heatmap' || config.mode === 'hist2d') return ['row', 'column', 'total'];
    if (config.mode === 'bar' || config.mode === 'histogram') return config.split ? ['all', 'x', 'split'] : ['all'];
    return ['all'];
}

/**
 * Each row's count as a fraction of its base's total (a Float64Array; NaN when the base is empty). `all` and `total`
 * are every counted cell of the table; the others are the rows with the same level of the input they hold fixed.
 */
// export-unused-ok: C3 draws shares
export function shareValues(table, base) {
    let values = table.shares.get(base);
    if (values) return values;
    values = new Float64Array(table.rows).fill(NaN);
    const axis = table.axes.findIndex((a) => a.input === BASE_AXIS[base]);
    if (BASE_AXIS[base] === undefined || axis < 0) {
        for (let r = 0; r < table.rows; r++) if (table.total > 0) values[r] = table.count[r] / table.total;
    } else {
        const sums = new Float64Array(table.dims[axis]);
        const level = (r) => Math.floor(r / table.stride[axis]) % table.dims[axis];
        for (let r = 0; r < table.rows; r++) sums[level(r)] += table.count[r];
        for (let r = 0; r < table.rows; r++) if (sums[level(r)] > 0) values[r] = table.count[r] / sums[level(r)];
    }
    table.shares.set(base, values);
    return values;
}

/**
 * A statistic of the measure, per row (NaN where no cell has a value). Moments are of the finite values, the SD is
 * the population SD, and the z-score puts a row's mean against the mean and SD of all counted cells (OD 12): 0 when
 * those cells are constant.
 * @returns {Float64Array|null} null when the grid carries no measure
 */
// export-unused-ok: C3 draws a measure
export function measureValues(table, stat) {
    if (!table.moments) return null;
    let values = table.measures.get(stat);
    if (values) return values;
    values = new Float64Array(table.rows).fill(NaN);
    const pooled = table.pooled;
    const poolMean = pooled && pooled.n > 0 ? pooled.sum / pooled.n : NaN;
    const poolSd = pooled && pooled.n > 0 ? Math.sqrt(Math.max(0, pooled.sumsq / pooled.n - poolMean * poolMean)) : NaN;
    for (let r = 0; r < table.rows; r++) {
        const m = table.moments.subarray(r * MOMENTS, (r + 1) * MOMENTS);
        const n = m[N];
        if (!(n > 0)) continue;
        const mean = m[SUM] / n;
        switch (stat) {
            case 'mean': values[r] = mean; break;
            case 'sum': values[r] = m[SUM]; break;
            case 'pct_above': values[r] = (100 * m[N_ABOVE]) / n; break;
            case 'sd': values[r] = Math.sqrt(Math.max(0, m[SUMSQ] / n - mean * mean)); break;
            case 'zscore': values[r] = poolSd > 0 ? (mean - poolMean) / poolSd : 0; break;
            default: throw new Error(`Unknown measure statistic: ${stat}`);
        }
    }
    table.measures.set(stat, values);
    return values;
}

/** What the bar or rectangle shows (CNT-15): the count, a share of the chosen base, or the measure; null for the most frequent level. */
// export-unused-ok: C3 draws the height
export function heightValues(config, table) {
    const value = config.value || { kind: 'count' };
    switch (value.kind) {
        case 'share': return shareValues(table, value.of || DEFAULT_SHARE_BASE);
        case 'measure': return config.measure ? measureValues(table, config.measure.stat) : null;
        case 'top_level': return null;
        default: return table.count;
    }
}

/**
 * The order of one axis's levels (SHR-10, CNT-14): the engine's order, or by height (the tallest row of each level,
 * highest first, ties in the engine's order), and optionally reversed.
 * @returns {number[]} level indexes
 */
// export-unused-ok: C3 orders the levels of an axis
export function axisOrder(table, axis, values, { sort, reverse } = {}) {
    const order = Array.from({ length: table.dims[axis] }, (_, i) => i);
    if (sort === 'height' && values) {
        const tallest = new Float64Array(order.length).fill(-Infinity);
        for (let r = 0; r < table.rows; r++) {
            const l = Math.floor(r / table.stride[axis]) % table.dims[axis];
            if (values[r] > tallest[l]) tallest[l] = values[r];
        }
        order.sort((a, b) => tallest[b] - tallest[a] || a - b);
    }
    return reverse ? order.reverse() : order;
}

// --- the strip and the export ----------------------------------------------------------------------------------------

/**
 * The numbers of the status strip (CNT-22), all from the reply: the cells counted in the plot, those without a value
 * per input (the @na level), those left outside an excluded range (the axes' `n_outside`, summed) and the cells shown.
 * @param {Object} table - from countTable
 */
// export-unused-ok: C2b writes the status strip
export function stripNumbers(table) {
    return { shown: table.shown, counted: table.total, noValue: { ...table.noValue }, outside: table.outside };
}

/**
 * The plotted table as rows for a CSV (CNT-23): the levels of each input, the count, the share of `shareBase` and the
 * measure of the config, headers first. The caller names the inputs and the columns, so no interface word is written here.
 */
// export-unused-ok: C3 exports the plotted table
export function tableRows(config, table, { labelOf, inputNames, headers, shareBase }) {
    const measure = config.measure ? measureValues(table, config.measure.stat) : null;
    const share = shareValues(table, shareBase || DEFAULT_SHARE_BASE);
    const header = [...table.axes.map((a) => inputNames[a.input]), headers.count, headers.share, ...(measure ? [headers.measure] : [])];
    const rows = [header];
    for (let r = 0; r < table.rows; r++) {
        const row = [...levelsAt(table, r).map(labelOf), table.count[r], Number.isNaN(share[r]) ? null : share[r]];
        if (measure) row.push(Number.isNaN(measure[r]) ? null : measure[r]);
        rows.push(row);
    }
    return rows;
}

/** Rows as CSV text; text that a spreadsheet would run as a formula is quoted so it does not. */
// export-unused-ok: C3 exports the plotted table
export function tableCsv(rows) {
    return rows.map((row) => row.map((v) => csvField(v, { text: typeof v === 'string' })).join(',')).join('\n');
}
