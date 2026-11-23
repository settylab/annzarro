/**
 * What a Cell Count Plot says (UX 4.2, 4.3, 4.7; SHR-35, SHR-37, SHR-39, CNT-14, CNT-22): pure wording, a snapshot in
 * and a sentence out, so Node tests hold every sentence. Every word is utils/vocabulary.js's.
 *
 * TWO KINDS OF STATE.
 *
 * - THE PLAN'S: the config asks nothing yet (no X), asks for an input its mode cannot use (a histogram of a category,
 *   SHR-37), or breaks a limit of its mode (UX 4.3). utils/count-plot-model.js `planGrid` decides each before any
 *   request (SHR-39), and its plan is the handle's state. The panel says it in its own plot area box (`describePlan`),
 *   with the WAY OUT that ends it: Bin it, Choose levels, Remove Color by, Show as Bar. A way out acts on this panel's
 *   config (`wayOut`): one undoable step, or a control opened in place. It is never a notice of a source, so it never
 *   goes through the page's painter.
 * - THE ROUTE'S: computing, queued, asks first, refused for its cost, failed, cancelled, a cycle, out of date. These are
 *   a source's states and go through the page's painter (utils/host-binding.js) with the shared wording of
 *   utils/source-notices.js (`gridNotice`), as every source's do: the overlay, the strip tag, the progress bar of
 *   operator decision 21, and the buttons routed by the action registry.
 *
 * And the sentence of a drawn plot's cells counted (`stripSentence`, CNT-22); the page says it in the coverage banner.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { describeSource } from '../../utils/source-notices.js';
import { binsRange } from '../../utils/count-plot-model.js';
import { setMode } from './controls-model.js';

const C = VOCABULARY.countPlot;
const L = C.limit;

/** The inputs a way out names, by the plan's input id: X and Y are axes, Color by is a split or a most frequent level. */
const AXES = Object.freeze(['x', 'y']);
const COLOR_BY = Object.freeze(['split', 'factor']);

/** The mode a categorical input can be drawn in, for a mode that needs numbers (UX 4.2): one input or two. */
const CATEGORICAL_TWIN = Object.freeze({ histogram: 'bar', density: 'bar', hist2d: 'heatmap', density2d: 'heatmap' });

/** Whether a snapshot is the plan's own (it asked nothing), not the route's. */
export const isPlanState = (snap) => !!snap && (snap.state === 'empty' || snap.state === 'unusable'
    || (snap.state === 'refused' && Array.isArray(snap.inputs)));

/** The partitioning behind a plan's input id. */
function inputOf(config, field) {
    return field === 'factor' ? (config.value && config.value.factor) || null : config[field] || null;
}

/** Whether an input is a number the engine bins as against a column read by its values. */
const isBinned = (p, isNumeric) => !!p && !!isNumeric && isNumeric(p.source) && !(p.binning && p.binning.method === 'categories');

/**
 * The way out of an axis with too many levels or bins: Bin it for a number, Choose levels for a categorical column;
 * both for a number read by its values (a whole-number column), which either fixes.
 */
function axisWays(field, p, isNumeric) {
    const numeric = !!p && !!isNumeric && isNumeric(p.source);
    const ways = [];
    if (numeric) ways.push([`bin:${field}`, C.wayOut.bin]);
    if (!isBinned(p, isNumeric)) ways.push([`levels:${field}`, C.wayOut.levels]);
    return ways;
}

/** The sentence and way out of a plan over a limit of its mode (UX 4.3). */
function refusal(snap, { config, nameOf, isNumeric }) {
    const mode = C.modes[snap.mode] || snap.mode;
    if (snap.reason === 'too_many_sets') return { text: L.sets(mode, snap.limits[0]), actions: [] };
    if (snap.reason === 'grid_too_large') return { text: L.grid(mode, snap.counts[0], snap.limits[0]), actions: [] };
    const first = snap.over[0];
    const at = (field) => snap.inputs.indexOf(field);
    if (COLOR_BY.includes(first)) {
        const i = at(first);
        return { text: L.colorBy(nameOf(first), snap.counts[i], L.colorsAs[snap.mode] || mode, snap.limits[i]),
            actions: [[`remove:${first}`, C.wayOut.removeSplit]] };
    }
    const actions = axisWays(first, inputOf(config, first), isNumeric);
    const axes = AXES.filter((f) => at(f) >= 0);
    if (axes.length === 2) {
        const [x, y] = axes.map(at);
        return { text: L.pair([nameOf('x'), nameOf('y')], [snap.counts[x], snap.counts[y]], mode, [snap.limits[x], snap.limits[y]]), actions };
    }
    const i = at(first);
    const say = snap.reason === 'too_many_bins' ? L.bins : L.levels;
    return { text: say(nameOf(first), snap.counts[i], mode, snap.limits[i]), actions };
}

/**
 * What the plot area says for a plan that asks nothing, with its way out; null for any other state.
 * @param {Object} snap - the handle's snapshot (a plan's: utils/count-plot-model.js planGrid)
 * @param {{config: Object, nameOf?: (field: string) => string, isNumeric?: (source: Object) => boolean}} ctx - the config
 *   the plan is of, the name of an input ('x', 'y', 'split', 'factor'), whether a source is a number
 * @returns {null|{state: string, reason: string, text: string, actions: Array<[string, string]>}} each action is
 *   `<kind>:<field or mode>`, for `wayOut`
 */
export function describePlan(snap, ctx) {
    if (!isPlanState(snap)) return null;
    const { reason } = snap;
    const mode = C.modes[snap.mode] || snap.mode;
    const out = (text, actions = []) => ({ state: snap.state, reason, text, actions });
    if (snap.state === 'empty') return out(C.empty[reason] || '');
    if (reason === 'needs_numeric') {
        const twin = CATEGORICAL_TWIN[snap.mode];
        return out(C.needsNumeric(mode, C.rows[snap.input], ctx.nameOf(snap.input)), twin ? [[`mode:${twin}`, C.wayOut.showAs(C.modes[twin])]] : []);
    }
    if (reason === 'too_many_sets' && snap.state === 'unusable') return out(C.tooManySets, [['mode:upset', C.wayOut.showAs(C.modes.upset)]]);
    const { text, actions } = refusal(snap, ctx);
    return out(text, actions);
}

/**
 * What a way out does to the config: a new config with its undo label (one step), a control to open in place
 * (`reveal`), or both; null for an action this module does not know.
 * @param {string} action - from describePlan
 * @param {Object} config - the config now
 * @returns {null|{config?: Object, label?: string, reveal?: {field: string, what: 'levels'|'binning'}}}
 */
export function wayOut(action, config) {
    const [kind, arg] = String(action).split(':');
    switch (kind) {
        case 'mode':
            return C.modes[arg] ? { config: setMode(config, arg), label: `mode ${C.modes[arg]}` } : null;
        case 'remove': {
            if (!COLOR_BY.includes(arg)) return null;
            const next = { ...config };
            if (arg === 'split') delete next.split; else delete next.value;
            return { config: next, label: `no ${C.rows.split}` };
        }
        case 'bin': {
            const p = config[arg];
            if (!AXES.includes(arg) || !p) return null;
            const reveal = { field: arg, what: 'binning' };
            const label = `bin ${C.rows[arg]}`;
            if (p.binning && p.binning.method === 'categories') {
                // a whole-number column read by its values: binned by the count plot's default (equal width, written as nothing)
                const binned = { ...p };
                delete binned.binning;
                return { config: { ...config, [arg]: binned }, label, reveal };
            }
            // more bins than the input takes (from a link; a typed count is checked where it is typed): the most it takes
            const { max } = binsRange(config.mode, arg);
            if (p.binning && Number.isInteger(p.binning.bins) && p.binning.bins > max) {
                return { config: { ...config, [arg]: { ...p, binning: { ...p.binning, bins: max } } }, label, reveal };
            }
            return { reveal };
        }
        case 'levels':
            return AXES.includes(arg) && config[arg] ? { reveal: { field: arg, what: 'levels' } } : null;
        default:
            return null;
    }
}

/** The size refusals of the grouping route whose figures name a count and a limit. */
const SIZE_REASONS = Object.freeze(['too_many_groups', 'too_many_levels']);

/**
 * What Choose levels says when an input's levels, asked for alone, did not come: refused for their number (the route's
 * figures: how many, and the limit), refused otherwise, or failed (with Retry). Null while they are on their way or ready.
 * @param {Object|null} snap - the levels handle's snapshot, with the route's figures as `refused` when it gave them
 * @param {{field: string, name: string, numeric?: boolean}} input - which input, its name, whether it is a number (then
 *   Bin it is the way out)
 * @returns {null|{state: string, text: string, actions: Array<[string, string]>}}
 */
export function levelsNote(snap, { field, name, numeric = false }) {
    if (!snap || (snap.state !== 'refused' && snap.state !== 'failed')) return null;
    const L = C.levelsList;
    const f = snap.refused;
    if (snap.state === 'refused' && f && SIZE_REASONS.includes(f.reason) && Number.isFinite(Number(f.count)) && Number.isFinite(Number(f.limit))) {
        return { state: 'refused', text: L.tooMany(name, Number(f.count), Number(f.limit)), actions: numeric ? [[`bin:${field}`, C.wayOut.bin]] : [] };
    }
    if (snap.state === 'refused') return { state: 'refused', text: L.notRead(name, snap.message), actions: [] };
    return { state: 'failed', text: L.notRead(name, snap.message), actions: [[`levels-retry:${field}`, L.retry]] };
}

/** What a notice calls a count plot's grid (utils/source-notices.js), and how it says that it computes. */
function noticeWords(cells) {
    const N = C.notice;
    const counting = (snap, { out, cancelLabel, tagOf }) => {
        const q = snap.progress && snap.progress.queue;
        if (q && Number(q.ahead) > 0) return undefined;
        return out(snap.state, 'notice', tagOf('computing', N.computing), C.counting(cells), '', [['score-cancel', cancelLabel]]);
    };
    return {
        thing: N.thing, source: N.source, result: N.result, Computing: N.Computing, found: N.found,
        act: N.act, tags: { computing: N.computing }, cycleKind: N.thing, off: N.off,
        states: {
            // "Counting 8,090 cells…" (UX 4.7) from the moment it is asked; a place in the server's line keeps the shared
            // sentence
            estimating: counting,
            computing: counting
        }
    };
}

/**
 * The notice of the route's state of a count plot's grid, for the page's painter; null for a plan's state (the panel
 * says those with their way out) and for a ready grid.
 * @param {Object} snap - the handle's snapshot, with the plot's `title`
 * @param {{role?: string, sharers?: number}} ctx
 * @param {number} cells - the cells shown, which the count counts
 */
export function gridNotice(snap, ctx, cells) {
    if (!snap || isPlanState(snap)) return null;
    return describeSource(snap, ctx, noticeWords(cells));
}

/**
 * The strip of a drawn plot (CNT-22, UX 4.7): the cells counted, then the cells left out by reason: without a value
 * on each input, outside a range, in levels left out (the rest of the cells shown).
 * @param {{shown: number, total: number, noValue: Object<string, number>, outside: number}} table - from countTable
 * @param {Object<string, string>} names - each input's name
 */
// export-unused-ok: the sentence of the cells counted, read by Node tests; the coverage banner says it on the page
export function stripSentence(table, names) {
    const parts = [C.strip.counted(table.total)];
    let accounted = 0;
    for (const [input, n] of Object.entries(table.noValue || {})) {
        if (!(n > 0)) continue;
        parts.push(C.strip.noValue(n, names[input] || input));
        accounted += n;
    }
    if (table.outside > 0) {
        parts.push(C.strip.outside(table.outside));
        accounted += table.outside;
    }
    const rest = table.shown - table.total - accounted;
    if (rest > 0) parts.push(C.strip.leftOut(rest));
    return parts.join(C.strip.join);
}
