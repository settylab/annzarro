/**
 * The sets of a Venn or UpSet (CNT-5, CNT-11 to CNT-13, UX 4.6): what a set is, its member on the wire, its row text,
 * where each group set stands (SHR-38, UX 2.8), and the SetPlot that panels/cell-count/draw-sets.js draws.
 *
 * A set is stored as `{source, member?, name?}` (plan 1.6): a cell table needs no member; any other source has exactly
 * one of `{levels: [ids]}`, `{op, value}` or a group reference `{group, groupWas, follow?}`. A set is strictly binary:
 * a cell without a value is out, and the engine counts such cells per set (`n_no_value` on the set's axis).
 *
 * A Venn or UpSet is one `sets` grid (count-plot-model.js `planGrid`): an axis per set with the levels `@in` and
 * `@out`, so every grid cell is one exclusive region and its count is the engine's. `setPlotModel` reads the regions
 * off count-plot-model.js's table of that grid in one pass, applies an UpSet's sort, minimum size and top, and leaves
 * the drawing nothing to recount (lead-notes, "V1 output shape").
 *
 * Words come from utils/vocabulary.js; the model returns numbers, states and texts made there. Pure, so Node tests
 * cover it.
 */
import { VOCABULARY } from './vocabulary.js';
import { heightValues } from './count-plot-model.js';
import { resolveGroup, summariseChanges, describeGroupReference } from './group-reference.js';
import { parseLevelId, RESERVED, canonLabel } from './level-id.js';
import { sourceName } from './cell-grouping.js';
import { wouldLoop, loopReason } from './panel-references.js';
import { GROUP_SOURCE, PANEL_SOURCES } from '../panels/cell-grouping/factors.js';
import { setColours } from './set-colours.js';
import { limit } from './limits.js';

const W = VOCABULARY.countSets;
const P = VOCABULARY.phrase;

/** The most sets an UpSet takes (CNT-12; count-plot-model.js refuses more, and Add set stops here): the server's
 *  limits.grid_sets, 16 by default and at most. */
const setsMax = () => limit('grid_sets');
/** The kinds Add set offers (UX 4.6), in its order. */
export const SET_KINDS = Object.freeze(['table', 'boolean', 'levels', 'condition', 'group']);
/** An UpSet's own options when the config stores none (CNT-12). */
const UPSET = Object.freeze({ sort: 'size', top: 40, minSize: 0 });
const TOP_MAX = 65535;
const LETTERS = 'ABCDEFGHIJKLMNOP';
// the set colours live in their own pure module, which the figure reads too (utils/set-colours.js)
export { setColours } from './set-colours.js';


const BOOLEAN_DTYPE = /^bool/;
const obsInfo = (structure, key) => (structure && structure.obs && structure.obs.columns_info && structure.obs.columns_info[key]) || null;

/** Whether an obs column holds booleans (a set "Boolean column" is its `c:true`). */
export function isBooleanColumn(structure, key) {
    const info = obsInfo(structure, key);
    return !!info && BOOLEAN_DTYPE.test(String(info.type || ''));
}

/**
 * A set's kind, as Add set names it: a table; a boolean column (its `true`); levels of a column; a condition on a
 * number; a group of a grouping.
 * @param {Object} set - a stored set
 * @param {?Object} structure - the dataset structure
 * @returns {'table'|'boolean'|'levels'|'condition'|'group'}
 */
export function setKind(set, structure) {
    const m = set.member;
    if (!m) return 'table';
    if (Array.isArray(m.group)) return 'group';
    if (m.op !== undefined) return 'condition';
    const one = Array.isArray(m.levels) && m.levels.length === 1 && m.levels[0] === 'c:true';
    return one && set.source.type === 'obs' && isBooleanColumn(structure, set.source.key) ? 'boolean' : 'levels';
}

/**
 * A set's member as the grid request carries it (count-plot-model.js `planGrid`'s `memberFor`): a table has none; a
 * group is its key only, so Keep, following and the stored name never change the request or its key.
 * @param {Object} set
 * @returns {Object|undefined}
 */
export function memberOnWire(set) {
    const m = set.member;
    if (!m) return undefined;
    if (Array.isArray(m.group)) return { group: [...m.group] };
    if (m.op !== undefined) return { op: m.op, value: m.value };
    return { levels: [...m.levels] };
}

/**
 * The choices of a "Levels of a column" set from the obs route's category labels (core/categories.py
 * `labels_of_ranks`), which are the categories as JSON values: a string, a number or a boolean. Each id is the
 * category's canonical text (plan 1.6), as the engine writes it; a null category is no choice (it is out of every set).
 * `serverIds` are the ids the route sends beside the labels (`ids`): each is the id the engine gives that level, which a
 * JSON number cannot always give back (an integer past 2**53 arrives as another number). When given they are used as
 * they are; without them (an old server, a test) the id is made from the value as before.
 * @param {Array<string|number|boolean|null>} values
 * @param {Array<string|null>} [serverIds]
 * @returns {{ids: string[], labels: string[]}}
 */
export function categoryChoices(values, serverIds) {
    const ids = [];
    const labels = [];
    for (const [i, v] of values.entries()) {
        const given = Array.isArray(serverIds) ? serverIds[i] : undefined;
        const id = typeof given === 'string' ? given : canonLabel(v);
        if (id === RESERVED.na) continue;
        ids.push(id);
        labels.push(levelText(id));
    }
    return { ids, labels };
}

/** The text of a category id ("T cell" of `c:T cell`). */
function levelText(id) {
    const level = parseLevelId(id);
    if (level && level.kind === 'category') return level.text;
    if (id === RESERVED.na) return VOCABULARY.word.noValue;
    return id;
}

/** How a number is written in a row: at most six significant digits. */
const figure = (x) => String(Number(Number(x).toPrecision(6)));

/**
 * A set's text in its row and in the drawing (UX 4.6): its own name, else "in Table 1", "is_doublet", "cell_type is
 * T cell, NK", "Cd3e > 0.5 (logged_counts)", "Grouping 1: Cd3e 0.5 to 1.75" (the group's labels when last seen).
 * @param {Object} set
 * @param {{titleOf?: (source: Object) => (string|undefined), structure?: Object, separatorOf?: (id: string) => string}} [ctx]
 */
export function setText(set, ctx = {}) {
    if (typeof set.name === 'string' && set.name) return set.name;
    const source = set.source;
    const title = ctx.titleOf ? ctx.titleOf(source) : undefined;
    const kind = setKind(set, ctx.structure || null);
    switch (kind) {
        case 'table': return P.inTable(title || source.key);
        case 'boolean': return source.key;
        case 'levels': return W.levels(sourceName(source, ctx.titleOf), set.member.levels.map(levelText));
        case 'condition': {
            const op = W.ops[set.member.op];
            if (source.type === 'layer') return W.condition(source.column || '', op, figure(set.member.value), source.key);
            return W.condition(sourceName(source, ctx.titleOf), op, figure(set.member.value));
        }
        default: {
            const separator = ctx.separatorOf ? ctx.separatorOf(source.key) : ' | ';
            return W.group(title || source.key, set.member.groupWas.join(separator));
        }
    }
}

/** The panel behind a set's source, when it is another panel's (a table, a grouping, a score), else null. */
function panelOfSet(set) {
    const s = set && set.source;
    return s && PANEL_SOURCES.includes(s.type) && typeof s.key === 'string' && s.key ? s.key : null;
}

/** The grouping a group set names, or null. */
export function groupingOfSet(set) {
    return set && set.source && set.source.type === GROUP_SOURCE && set.member && Array.isArray(set.member.group) ? set.source.key : null;
}

/**
 * Where each set stands (SHR-38, UX 2.8): `deleted` when the panel behind it is gone; a group set `ok`, `changed`
 * (the key's default labels differ from the stored ones) or `gone` (the key is no longer a group). A group whose
 * grouping has no groups here yet is `ok` until it has.
 * @param {Object[]} sets - the config's sets
 * @param {{exists: (id: string) => boolean, labelledOf: (groupingId: string) => ({byKey: Map, separator: string}|null),
 *   seenOf: (groupingId: string) => Map, titleOf: (groupingId: string) => string}} ctx
 *   `labelledOf` is the grouping's groups by key (group-sources.js `labelsOf`); `seenOf` the session's memory of the
 *   changes said, one Map per grouping and consumer
 * @returns {{rows: {state: ('ok'|'changed'|'gone'|'deleted'), note: (null|{tag, text, actions}), update?: Object}[],
 *   summary: (null|{count, text, actions})}} `update` is a following reference to store with no history step
 */
export function setStates(sets, ctx) {
    const results = [];
    const rows = sets.map((set) => {
        const panel = panelOfSet(set);
        if (panel && !ctx.exists(panel)) return { state: 'deleted', note: null };
        const grouping = groupingOfSet(set);
        const labelled = grouping ? ctx.labelledOf(grouping) : null;
        if (!labelled) return { state: 'ok', note: null };
        const result = resolveGroup(set.member, labelled, ctx.seenOf(grouping));
        results.push(result);
        const row = { state: result.state, note: describeGroupReference(result, ctx.titleOf(grouping)) };
        if (result.update) row.update = result.update;
        return row;
    });
    return { rows, summary: summariseChanges(results) };
}

/** A SetPlot state of a set's row state: a group that is gone draws as deleted. */
const drawnState = (state) => (state === 'gone' ? 'deleted' : state);

/**
 * An UpSet's own options, from the config's style fields (`sort`, `top`, `minSize`; defaults not written). A field of
 * another mode's meaning (a bar's `sort: 'height'`) is not this one's.
 * @returns {{sort: 'size'|'degree', top: number, minSize: number}}
 */
export function upsetOptions(config) {
    const top = Number.isInteger(config.top) && config.top >= 1 && config.top <= TOP_MAX ? config.top : UPSET.top;
    const minSize = Number.isInteger(config.minSize) && config.minSize >= 0 ? config.minSize : UPSET.minSize;
    return { sort: config.sort === 'degree' ? 'degree' : UPSET.sort, top, minSize };
}

/**
 * A typed Show top or Minimum size: the number, or the sentence that says what it takes.
 * @param {'top'|'minSize'} field
 * @param {string} text
 * @returns {{ok: true, value: number}|{ok: false, message: string}}
 */
export function parseUpsetOption(field, text) {
    const s = String(text).trim();
    if (s === '') return { ok: true, value: UPSET[field] };
    const v = Number(s);
    if (field === 'top') return Number.isInteger(v) && v >= 1 && v <= TOP_MAX ? { ok: true, value: v } : { ok: false, message: W.topProblem(TOP_MAX) };
    return Number.isInteger(v) && v >= 0 ? { ok: true, value: v } : { ok: false, message: W.minSizeProblem };
}

/**
 * The config with an UpSet option set, the default left out (plan 1.6: defaults are not written).
 * @param {Object} config
 * @param {'sort'|'top'|'minSize'} field
 * @param {*} value
 */
export function withUpsetOption(config, field, value) {
    const next = { ...config };
    if (value === UPSET[field]) delete next[field]; else next[field] = value;
    return next;
}

/**
 * The options of a menu that picks the panel behind a set (a cell table, a grouping), each marked unavailable with the
 * reason when choosing it would close a loop through this plot (decision 15).
 * @param {{id: string, title: string}[]} panels
 * @param {string} plotId - the count plot whose menu is open
 * @returns {{value: string, label: string, disabled: boolean, title: string}[]}
 */
export function panelChoices(panels, plotId) {
    return panels.map(({ id, title }) => {
        const loops = wouldLoop(plotId, id);
        return { value: id, label: title, disabled: loops, title: loops ? loopReason(title, 'plot') : '' };
    });
}

/** Whether another set may be added, and why not (UX 4.3: Add set disabled at 16, with the reason). */
export function canAddSet(config) {
    const n = Array.isArray(config.sets) ? config.sets.length : 0;
    const most = setsMax();
    return n < most ? { ok: true } : { ok: false, reason: W.tooMany(most) };
}

/** What the bars of an UpSet are colored by (UX 4.5), or null: nothing for None (no value stored), and nothing in a Venn. */
function colorOf(config, table, words) {
    if (config.mode !== 'upset') return null;
    const value = config.value;
    if (!value) return null;
    if (value.kind === 'count') return { kind: 'count', label: (words.value && words.value.count) || 'Count', values: heightValues(config, table) };
    if (value.kind === 'share') return { kind: 'share', label: words.share(value.of || 'all'), values: heightValues(config, table) };
    if (value.kind === 'measure' && config.measure && table.moments) {
        return { kind: 'statistic', label: words.measure(config.measure.stat, words.measureSource || '', config.measure.above), values: heightValues(config, table) };
    }
    return null;
}

function compareBy(sort) {
    if (sort === 'degree') return (a, b) => a.degree - b.degree || b.count - a.count || a.code - b.code;
    return (a, b) => b.count - a.count || a.degree - b.degree || a.code - b.code;
}

/**
 * The SetPlot of a sets grid (lead-notes, "V1 output shape"): every region of degree 1 or more with its exclusive
 * count and share of the cells shown, each set's size and cells without a value, the cells in no set, and for an
 * UpSet the regions shown after the minimum size, the sort and the top, and what they leave out. One pass over the
 * table's rows (65,536 at 16 sets); made once per drawing, never per paint.
 * @param {Object} config - the count plot's config whose grid the table is
 * @param {Object} table - count-plot-model.js `countTable` of a sets grid: an axis per set, levels `@in` and `@out`
 * @param {{names: string[], states?: string[], words?: Object}} ctx - each set's text and row state; `words` the count
 *   plot's (VOCABULARY.countPlot with `measureSource`), for the title of an UpSet's Color
 * @returns {Object} the SetPlot
 */
export function setPlotModel(config, table, ctx) {
    const k = table.axes.length;
    const inLevel = table.axes.map((axis) => axis.levels.indexOf(RESERVED.in));
    if (inLevel.some((i) => i < 0)) throw new Error('A sets grid has the level @in on every axis.');
    const universe = table.shown;
    const color = colorOf(config, table, ctx.words || VOCABULARY.countPlot);
    const colours = setColours(config.sets || []);
    const size = new Float64Array(k);
    const byCode = new Map();
    let inNone = 0;
    for (let r = 0; r < table.rows; r++) {
        const n = table.count[r];
        let code = 0;
        for (let s = 0; s < k; s++) if (Math.floor(r / table.stride[s]) % table.dims[s] === inLevel[s]) code |= 1 << s;
        if (code === 0) { inNone += n; continue; }
        for (let s = 0; s < k; s++) if (code & (1 << s)) size[s] += n;
        if (n > 0 || config.mode === 'venn') byCode.set(code, { code, count: n, row: r });
    }
    if (config.mode === 'venn') for (let code = 1; code < 1 << k; code++) if (!byCode.has(code)) byCode.set(code, { code, count: 0, row: -1 });
    const regions = [...byCode.values()].sort((a, b) => a.code - b.code).map(({ code, count, row }) => {
        const key = new Uint8Array(k);
        let degree = 0;
        for (let s = 0; s < k; s++) if (code & (1 << s)) { key[s] = 1; degree++; }
        const value = color && row >= 0 ? color.values[row] : NaN;
        return { key, degree, count, share: universe > 0 ? count / universe : 0, color: color ? (Number.isFinite(value) ? value : null) : null, code };
    });
    const sets = table.axes.map((axis, s) => ({
        index: s, letter: LETTERS[s], name: ctx.names[s], size: size[s], colour: colours[s],
        noValue: Number.isInteger(axis.info && axis.info.n_no_value) ? axis.info.n_no_value : 0,
        state: drawnState((ctx.states && ctx.states[s]) || 'ok')
    }));
    const base = { mode: config.mode, universe, inNone, sets, regions: regions.map((r) => ({ key: r.key, degree: r.degree, count: r.count, share: r.share, color: r.color })) };
    if (config.mode !== 'upset') {
        return { ...base, shown: regions.map((_, i) => i), hidden: { regions: 0, cells: 0, share: 0 }, options: null, color: null };
    }
    const options = upsetOptions(config);
    const order = regions.map((r, i) => ({ ...r, i })).filter((r) => r.count >= options.minSize).sort(compareBy(options.sort)).slice(0, options.top);
    const shown = order.map((r) => r.i);
    const kept = new Set(shown);
    let cells = 0;
    let hiddenRegions = 0;
    regions.forEach((r, i) => { if (!kept.has(i)) { hiddenRegions++; cells += r.count; } });
    return {
        ...base, shown, hidden: { regions: hiddenRegions, cells, share: universe > 0 ? cells / universe : 0 }, options,
        color: color ? { label: color.label, kind: color.kind } : null
    };
}

/** The set list's last line (UX 4.6): "Universe: the 8,090 cells shown. 3,402 are in no set." */
export function universeLine(plot) {
    return W.universe(plot.universe, plot.inNone);
}

/** A set's count and its cells without a value, as its row says them ("2,431 cells", "312 without a value, counted as out"). */
export function setCounts(plotSet) {
    return { cells: W.cells(plotSet.size), noValue: plotSet.noValue > 0 ? W.noValue(plotSet.noValue) : '' };
}

