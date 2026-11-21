/**
 * The shared binning control (UX 2.4; SHR-14 to SHR-18, SHR-45, SHR-46, GRP-5, GRP-12): the method, the bin count, the
 * zero bin, the population the edges come from, manual thresholds, a range, a 100-bin preview of the source with the
 * edges on it, Freeze thresholds, and the sentences that say what the engine did.
 *
 * It lives in a binned factor's card in Cell Grouping and, compact, in the count plot. It never computes an edge: the
 * edges, the preview and the counts come from the server's reply (`info`, one partitioning of it), and the control only
 * writes the stored binning (utils/binning.js), which the panel commits as one undoable step.
 *
 * The first half is pure (Node tests cover it): what typed text means, what each control writes, the slider geometry
 * and the sentences. The second half draws it. The panel redraws the card on every edit and every reply, so the DOM is
 * stateless; what must outlive a redraw (an invalid entry's sentence, a freeze's Undo, the focused slider) is kept in a
 * small table by source.
 *
 * Mounted through factors.js `BINNING_SLOT.mount(host, {partitioning, info, commit, fresh?, settled?, levels?, titleOf?, cells?, kind?, max?})`.
 */
import { BINNING_SLOT } from '../cell-grouping/factors.js';
import {
    BINS_MIN, BINS_MAX, DEFAULT_BINS, normalizeBinning, freezeThresholds, recipeEdges
} from '../../utils/binning.js';
import { VOCABULARY } from '../../utils/vocabulary.js';
import { sourceName } from '../../utils/cell-grouping.js';
import { stableStringify } from '../../utils/url-history.js';

const P = VOCABULARY.phrase;
const fmt = (n) => Number(n).toLocaleString('en-US');
/** A number to three significant digits, written plainly. */
const figure = (x) => String(Number(Number(x).toPrecision(3)));

const METHOD_LABEL = Object.freeze({
    equal_count: 'Equal count', equal_width: 'Equal width', log: 'Log-spaced', manual: 'Manual thresholds', categories: 'Categories'
});
const METHOD_HELP = Object.freeze({
    equal_count: 'About the same cells per bin.',
    equal_width: 'Bins of equal range.',
    log: 'Equal ratios, for values spanning orders of magnitude.',
    manual: 'Your thresholds.',
    categories: 'One bin for each value.'
});
/** The order of the menu (UX 2.4); `categories` only for a column that is already split by its values. */
const METHOD_ORDER = Object.freeze(['equal_count', 'equal_width', 'log', 'manual', 'categories']);
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

// ---------------------------------------------------------------------------------------------- typed entry (GRP-5)

/**
 * A typed bin count.
 * @param {string} text
 * @param {{max?: number}} [options] - the most bins taken (a count plot has its own)
 * @returns {{ok: true, value: number}|{ok: false, message: string}}
 */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export function parseBins(text, { max = BINS_MAX } = {}) {
    const s = String(text).trim();
    const n = /^\d+$/.test(s) ? Number(s) : NaN;
    if (Number.isInteger(n) && n >= BINS_MIN && n <= max) return { ok: true, value: n };
    return { ok: false, message: `Enter a whole number from ${BINS_MIN} to ${fmt(max)}.` };
}

/**
 * Typed manual thresholds: numbers separated by commas, sorted and de-duplicated.
 * @param {string} text
 * @returns {{ok: true, value: number[]}|{ok: false, message: string}}
 */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export function parseThresholds(text) {
    const bad = { ok: false, message: 'Enter numbers separated by commas.' };
    const parts = String(text).split(',').map((s) => s.trim());
    if (!parts.length || parts.some((s) => !NUMBER.test(s))) return bad;
    const numbers = parts.map(Number);
    if (!numbers.every(Number.isFinite)) return bad;
    const value = [...new Set(numbers)].sort((a, b) => a - b);
    if (value.length > BINS_MAX - 1) return { ok: false, message: `Enter at most ${fmt(BINS_MAX - 1)} thresholds.` };
    return { ok: true, value };
}

/**
 * A typed range: a number or "auto" (or nothing) on each side.
 * @returns {{ok: true, value: (Array<?number>|null)}|{ok: false, message: string}}
 */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export function parseRange(loText, hiText, method) {
    const side = (t) => {
        const s = String(t).trim();
        if (s === '' || s.toLowerCase() === 'auto') return null;
        return NUMBER.test(s) && Number.isFinite(Number(s)) ? Number(s) : undefined;
    };
    const lo = side(loText);
    const hi = side(hiText);
    if (lo === undefined || hi === undefined) return { ok: false, message: 'Enter a number, or leave the side on auto.' };
    if (lo === null && hi === null) return { ok: true, value: null };
    if (lo !== null && hi !== null && !(lo < hi)) return { ok: false, message: 'Enter two numbers, the first below the second.' };
    if (method === 'log' && lo !== null && lo <= 0) return { ok: false, message: 'Log-spaced bins need a range above 0.' };
    return { ok: true, value: [lo, hi] };
}

/** A threshold as the field shows it: six significant digits. */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export const thresholdText = (x) => String(Number(Number(x).toPrecision(6)));

/**
 * Typed thresholds with the stored ones kept whole: a number that reads the same as a stored threshold as the field showed
 * it is that threshold, so editing one of several does not round the others.
 */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export function keepStored(typed, stored) {
    const shown = new Map(stored.map((t) => [thresholdText(t), t]));
    return typed.map((v) => (shown.has(thresholdText(v)) && thresholdText(v) === String(v) ? shown.get(thresholdText(v)) : v));
}

// ---------------------------------------------------------------------------------------------- what each control writes

/**
 * A binning as the host stores it. `options` are normalizeBinning's: a count plot takes more bins than a grouping, and
 * keeps a bin count equal to the grouping's default, since its own default differs (`{max, keepDefault: true}`).
 */
const renormalised = (raw, options) => normalizeBinning(raw, options).binning;

/**
 * Another method. The zero bin, the population and the bin count stay (the new method takes its own default when none
 * was set); a range does not (its meaning is the method's). Manual thresholds start at today's inner edges, else the
 * middle of the preview, else 0.
 * @param {Object} binning - from normalizeBinning
 * @param {string} method
 * @param {Object|null} [info] - this partitioning of the reply
 */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export function setMethod(binning, method, info = null, options) {
    if (binning.method === method) return binning;
    const raw = { ...binning, method };
    delete raw.thresholds;
    delete raw.range;
    if (method === 'manual') {
        const frozen = freezeThresholds(binning, info);
        const h = info && info.histogram;
        raw.thresholds = frozen ? frozen.thresholds
            : h && Number.isFinite(h.lo) && Number.isFinite(h.hi) && h.lo < h.hi ? [Number(((h.lo + h.hi) / 2).toPrecision(3))] : [0];
    }
    return renormalised(raw, options);
}

// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export const setBins = (binning, bins, options) => renormalised({ ...binning, bins }, options);

// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export function setZeroBin(binning, on, options) {
    const raw = { ...binning };
    if (on) raw.zero_bin = true; else delete raw.zero_bin;
    return renormalised(raw, options);
}

// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export function setEdgesFrom(binning, population, options) {
    const raw = { ...binning };
    if (population === 'all') raw.edges_from = 'all'; else delete raw.edges_from;
    return renormalised(raw, options);
}

/** @param {?Array<?number>} range - `[lo, hi]` with a side null for auto; null for no range */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export function setRange(binning, range, options) {
    const raw = { ...binning };
    if (range) raw.range = range; else delete raw.range;
    return renormalised(raw, options);
}

// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export const setThresholds = (binning, thresholds, options) => renormalised({ ...binning, thresholds }, options);

/**
 * One threshold moved, between its neighbours and never onto or across one.
 * @returns {Object|null} the new binning, or null when the move is not allowed or changes nothing
 */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export function moveThreshold(binning, index, value, options) {
    const ts = binning.method === 'manual' ? binning.thresholds : null;
    if (!ts || !Number.isInteger(index) || index < 0 || index >= ts.length || !Number.isFinite(value) || value === ts[index]) return null;
    if (index > 0 && value <= ts[index - 1]) return null;
    if (index < ts.length - 1 && value >= ts[index + 1]) return null;
    const next = [...ts];
    next[index] = value;
    return setThresholds(binning, next, options);
}

/** Freeze thresholds (SHR-17): the manual binning that puts every cell where it is now, or null. */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export const freeze = (binning, info) => freezeThresholds(binning, info);

// ---------------------------------------------------------------------------------------------- the zero bin (SHR-15)

/** Whether the zero bin is offered: not when the preview found a negative value. */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export const zeroBinOffered = (info) => !(info && info.histogram && info.histogram.has_negative);

/**
 * Whether the zero bin should be turned on now (SHR-15): the preview found at least 25% zeros and no negative value, and
 * the binning is still what a factor starts with, so nothing the user chose is overruled.
 */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export function zeroBinDefault(binning, info) {
    return binning.method === 'equal_count' && Object.keys(binning).length === 1
        && !!(info && info.histogram && info.histogram.zero_bin_default === true);
}

// ---------------------------------------------------------------------------------------------- the preview and its lines

/** Where a value falls along the preview, 0 to 1. */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export function fractionOf(value, histogram) {
    const span = histogram.hi - histogram.lo;
    if (!(span > 0)) return 0.5;
    return Math.min(1, Math.max(0, (value - histogram.lo) / span));
}

/** The value at a place along the preview, 0 to 1. */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export const valueAt = (fraction, histogram) => histogram.lo + fraction * (histogram.hi - histogram.lo);

/** One key press moves a line by 1% of the preview's span, 10% with Shift. */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export function keyStep(histogram, big) {
    const span = histogram.hi - histogram.lo;
    return (span > 0 ? span : 1) / (big ? 10 : 100);
}

/**
 * The height of each bar, 0 to 1, of the tallest. With the zero bin on, the cells at exactly 0 are not in the bars (they
 * have a bar of their own), so the spike does not flatten the distribution the edges sit on.
 * @param {Object} histogram
 * @param {{zeroBin?: boolean}} [options]
 */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export function barHeights(histogram, { zeroBin = false } = {}) {
    const counts = [...(histogram.counts || [])];
    if (zeroBin && counts.length && histogram.lo === 0 && histogram.n_zero > 0) counts[0] = Math.max(0, counts[0] - histogram.n_zero);
    let top = 0;
    for (const c of counts) if (c > top) top = c;
    return counts.map((c) => (top > 0 ? c / top : 0));
}

/**
 * The values of the lines drawn on the preview: the thresholds of a manual binning; else the inner edges of the reply,
 * or of a range that fixes them. Nothing for degenerate data (no edge is invented, SHR-46).
 */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export function lineValues(binning, info) {
    if (binning.method === 'manual') return [...binning.thresholds];
    if (info && info.degenerate) return [];
    const edges = (info && Array.isArray(info.edges) && info.edges) || recipeEdges(binning);
    return edges && edges.length >= 3 && binning.method !== 'categories' ? edges.slice(1, -1) : [];
}

// ---------------------------------------------------------------------------------------------- sentences (UX 2.4)

/** The line that names the population the edges came from (SHR-16). */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export function edgesLine(info) {
    if (!info || !Number.isInteger(info.edges_n)) return '';
    const n = fmt(info.edges_n);
    if (info.edges_from === 'all') return `Edges from all ${n} cells of the dataset.`;
    return info.edges_from === 'shown' ? `Edges from the ${n} ${info.edges_n === 1 ? 'cell' : 'cells'} shown.` : '';
}

/** The population as a phrase, for "Frozen from equal count on ...". */
function populationPhrase(info) {
    const n = info && Number.isInteger(info.edges_n) ? fmt(info.edges_n) : null;
    if (n === null) return 'the cells shown';
    return info.edges_from === 'all' ? `all ${n} cells of the dataset` : `the ${n} cells shown`;
}

/**
 * What the engine did that the user should know: fewer bins made, cells with no bin, degenerate data, clamped cells.
 * @param {Object} binning
 * @param {Object|null} info
 * @param {{kind?: 'grouping'|'count'}} [options] - a count plot says its excluded cells in its status strip
 * @returns {Array<{id: string, text: string}>}
 */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export function binningNotes(binning, info, { kind = 'grouping' } = {}) {
    if (!info) return [];
    if (info.degenerate) return [{ id: 'degenerate', text: 'All cells share one value.' }];
    const notes = [];
    if (binning.method in DEFAULT_BINS && Number.isInteger(info.bins_asked) && Number.isInteger(info.bins_made) && info.bins_made < info.bins_asked) {
        notes.push({ id: 'merged', text: `${info.bins_asked} bins asked, ${info.bins_made} made: many cells share the same value, so edges merged.` });
    }
    if (binning.method === 'log' && !binning.zero_bin && typeof info.n_no_value === 'number') {
        const missing = (info.histogram && info.histogram.n_no_value) || 0;
        const n = info.n_no_value - missing;
        if (n > 0) notes.push({ id: 'nobin', text: `${fmt(n)} cells at or below 0 have no bin. Turn on Zero as its own bin to keep them.` });
    }
    const outside = outsideCount(info);
    if (kind === 'grouping' && binning.outside !== 'exclude' && outside > 0) {
        notes.push({ id: 'clamped', text: `${fmt(outside)} cells outside the range are in the end bins.` });
    }
    return notes;
}

/** The cells below the first edge and above the last: the reply gives `[below, above]`. */
function outsideCount(info) {
    const v = info && info.n_outside;
    return Array.isArray(v) ? v.reduce((a, b) => a + (Number(b) || 0), 0) : Number(v) || 0;
}

/** The help under Range: who asks decides what happens to values outside (SHR-45). */
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export const rangeHelp = (kind) => (kind === 'count'
    ? 'Values outside are left out and counted.'
    : 'Values outside go into the first or last bin, labelled ≤ and ≥.');

// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export const frozenLine = ({ method, population }) => `Frozen from ${METHOD_LABEL[method].toLowerCase()} on ${population}.`;
// export-unused-ok: the control's model is read by its Node tests, and the count plot (C2a) reads it
export const movedLine = (n) => `Edges now come from the ${fmt(n)} cells shown.`;

// ---------------------------------------------------------------------------------------------- what outlives a redraw

/**
 * By source: the sentence of an invalid entry, the last freeze, the moved-edges notice, text
 * typed and not yet entered, the zero-bin decision.
 */
const memory = new Map();
const MEMORY_MAX = 200;
const FOCUS_MS = 4000;

/**
 * The control that had the focus when an edit was made: the panel redraws the card, and the focus goes back to the same
 * slider or field (for a few seconds, and until the focus goes anywhere else).
 * @type {?{key: string, kind: ('slider'|'field'), index?: number, cls?: string, at: number}}
 */
let held = null;

/** What a focused element is, for `held`. */
function identify(el) {
    if (!el || !el.closest || !el.closest('.pbc')) return null;
    if (el.getAttribute('role') === 'slider') return { kind: 'slider', index: [...el.parentNode.children].indexOf(el) };
    if (el.matches('input, select')) return { kind: 'field', cls: [...el.classList].find((c) => /^pbc-[a-z-]+$/.test(c) && c !== 'pbc-input') };
    return null;
}

if (typeof document !== 'undefined') {
    document.addEventListener('focusin', (e) => {
        if (!held) return;
        const now = identify(e.target);
        if (!now || now.kind !== held.kind || now.index !== held.index || now.cls !== held.cls) held = null;
    });
}

function memoryOf(key) {
    let m = memory.get(key);
    if (!m) {
        m = { error: null, frozen: null, moved: null, last: null, drafts: {} };
        memory.set(key, m);
        if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
    }
    return m;
}

// ---------------------------------------------------------------------------------------------- drawing

let _serial = 0;

function h(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
        else if (k === 'data') Object.assign(e.dataset, v);
        else if (k === 'aria') for (const [a, val] of Object.entries(v)) e.setAttribute(`aria-${a}`, val);
        else if (k in e && k !== 'list') e[k] = v;
        else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
    return e;
}

const label = (text, ...inner) => h('label', { class: 'pbc-field' }, h('span', { class: 'pbc-field__name', text }), ...inner);

/**
 * Draw the control in `host`.
 * @param {HTMLElement} host
 * @param {Object} ctx
 * @param {Object} ctx.partitioning - the stored factor: `{source, binning, ...}`
 * @param {?Object} ctx.info - this partitioning of the reply (edges, counts, histogram, ...)
 * @param {(next: Object, label: string) => void} ctx.commit - one undoable step
 * @param {boolean} [ctx.fresh] - the factor was added in this session and has had no preview yet (SHR-15)
 * @param {() => void} [ctx.settled] - the factor is no longer new
 * @param {HTMLElement} [ctx.levels] - the factor's list of bins with their cells, drawn under the preview
 * @param {(source: Object) => (string|undefined)} [ctx.titleOf]
 * @param {'grouping'|'count'} [ctx.kind]
 * @param {number} [ctx.max] - the most bins this host takes
 * @returns {{destroy: Function}}
 */
function mount(host, ctx) {
    const p = ctx.partitioning;
    const info = ctx.info || null;
    const kind = ctx.kind || 'grouping';
    const max = ctx.max || BINS_MAX;
    const key = stableStringify(p.source);
    const mem = memoryOf(key);
    // a count plot's bins go past the grouping's limit, and its own default differs, so a count it is given is kept
    const nb = kind === 'count' ? { max, keepDefault: true } : undefined;
    const binning = normalizeBinning(p.binning, nb).binning;
    const sig = stableStringify(binning);
    const name = sourceName(p.source, ctx.titleOf);
    const method = binning.method;
    const hist = info && info.histogram && Number.isFinite(info.histogram.lo) && Number.isFinite(info.histogram.hi) ? info.histogram : null;
    const serial = ++_serial;
    let destroyed = false;

    const apply = (next, text) => {
        if (destroyed || stableStringify(next) === sig) return;
        mem.error = null;
        mem.moved = null;
        if (ctx.settled) ctx.settled();
        const now = host.contains(document.activeElement) ? identify(document.activeElement) : null;
        held = now ? { key, ...now, at: Date.now() } : null;
        ctx.commit({ ...p, binning: next }, text);
    };

    // The edges moved because the cells shown changed (UX 2.4): said once, until the next edit.
    if (info && Number.isInteger(info.edges_n) && method !== 'manual' && method !== 'categories') {
        if (mem.last && mem.last.sig === sig && mem.last.from === 'shown' && info.edges_from === 'shown' && mem.last.n !== info.edges_n) {
            mem.moved = info.edges_n;
        }
        mem.last = { sig, n: info.edges_n, from: info.edges_from };
    }

    // The zero bin is on at 25% zeros (SHR-15), for a factor the user has just added, on its first preview, once. A
    // factor that comes from a link, a panel set or a reload is never changed: its binning is the user's.
    if (hist && ctx.fresh) {
        if (ctx.settled) ctx.settled();
        if (zeroBinDefault(binning, info)) {
            setTimeout(() => ctx.commit({ ...p, binning: setZeroBin(binning, true, nb) }, `zero as its own bin of ${name}`), 0);
        }
    }

    // ---- the message of an invalid entry
    const message = h('div', { class: 'pbc-message', role: 'alert', hidden: !mem.error, text: mem.error || '' });
    const refuse = (input, text, shown) => {
        mem.error = text;
        input.value = shown;
        message.textContent = text;
        message.hidden = false;
    };
    const textInput = (cls, value, title, onValue, width) => {
        const input = h('input', { type: 'text', class: `form-control form-control-sm pbc-input ${cls}`, value, title, inputMode: 'decimal',
            style: width ? `width:${width}` : undefined, autocomplete: 'off', spellcheck: false });
        if (mem.drafts[cls] !== undefined) input.value = mem.drafts[cls];
        const run = () => {
            delete mem.drafts[cls];
            if (input.value !== value) onValue(input, value);
        };
        input.addEventListener('input', () => { mem.drafts[cls] = input.value; });
        // a change made by leaving the field is entered once the focus has moved, so the field that has it is known
        input.addEventListener('change', () => setTimeout(run, 0));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); run(); }
            else if (e.key === 'Escape') { delete mem.drafts[cls]; input.value = value; }
        });
        return input;
    };

    // ---- the first row: method, bins or thresholds, zero bin
    const methods = METHOD_ORDER.filter((m) => m !== 'categories' || method === 'categories');
    const select = h('select', { class: 'form-select form-select-sm pbc-method', title: METHOD_HELP[method],
        on: { change: () => apply(setMethod(binning, select.value, info, nb), `${METHOD_LABEL[select.value].toLowerCase()} bins of ${name}`) } },
    methods.map((m) => h('option', { value: m, text: METHOD_LABEL[m], selected: m === method })));
    const row = h('div', { class: 'pbc-row' }, label('Method', select));

    if (method in DEFAULT_BINS) {
        const shown = String(binning.bins === undefined ? DEFAULT_BINS[method] : binning.bins);
        row.append(label('Bins', textInput('pbc-bins', shown, `A whole number from ${BINS_MIN} to ${fmt(max)}.`, (input, was) => {
            const r = parseBins(input.value, { max });
            if (!r.ok) refuse(input, r.message, was);
            else apply(setBins(binning, r.value, nb), `${r.value} bins of ${name}`);
        }, '5rem')));
    }
    if (method === 'manual') {
        const shown = binning.thresholds.map(thresholdText).join(', ');
        row.append(label('Thresholds', textInput('pbc-thresholds', shown, 'Numbers separated by commas; sorted for you. Drag a line on the chart to move one.', (input, was) => {
            const r = parseThresholds(input.value);
            if (!r.ok) refuse(input, r.message, was);
            else apply(setThresholds(binning, keepStored(r.value, binning.thresholds), nb), `thresholds of ${name}`);
        }, '12rem')));
    }
    if (method !== 'categories' && zeroBinOffered(info)) {
        const box = h('input', { type: 'checkbox', class: 'pbc-zero', checked: !!binning.zero_bin,
            on: { change: () => apply(setZeroBin(binning, box.checked, nb), `${box.checked ? 'zero as its own bin' : 'no zero bin'} of ${name}`) } });
        row.append(h('label', { class: 'pbc-zero-field', title: 'Cells at exactly 0 form one bin; the method divides the rest.' }, box, ' Zero as its own bin'));
    }

    // ---- the second row: the population of the edges, the range
    const rows = [row];
    if (method !== 'manual' && method !== 'categories') {
        const group = `pbc-edges-${serial}`;
        const radio = (value, text, tip) => {
            const input = h('input', { type: 'radio', name: group, value, checked: (binning.edges_from || 'shown') === value,
                on: { change: () => { if (input.checked) apply(setEdgesFrom(binning, value, nb), `edges from ${value === 'all' ? 'all cells' : 'cells shown'} of ${name}`); } } });
            return h('label', { class: 'pbc-radio', title: tip }, input, ` ${text}`);
        };
        rows.push(h('div', { class: 'pbc-row' },
            h('div', { class: 'pbc-edges', role: 'radiogroup', aria: { label: 'Edges from' } }, h('span', { class: 'pbc-field__name', text: 'Edges from' }),
                radio('shown', 'cells shown', 'Edges follow the subset.'), radio('all', 'all cells', 'The same edges for every subset.'))));
    }
    if (method === 'equal_width' || method === 'log') {
        const range = binning.range || [null, null];
        const side = (cls, value, which) => {
            const input = textInput(cls, value === null ? '' : String(value), 'A number, or empty for auto.', (inp) => {
                const lo = which === 0 ? inp.value : (range[0] === null ? '' : String(range[0]));
                const hi = which === 1 ? inp.value : (range[1] === null ? '' : String(range[1]));
                const r = parseRange(lo, hi, method);
                if (!r.ok) refuse(inp, r.message, value === null ? '' : String(value));
                else apply(setRange(binning, r.value, nb), `range of ${name}`);
            }, '5rem');
            input.placeholder = 'auto';
            return input;
        };
        rows.push(h('div', { class: 'pbc-row pbc-range' }, h('span', { class: 'pbc-field__name', text: 'Range' }),
            side('pbc-range-lo', range[0], 0), ' to ', side('pbc-range-hi', range[1], 1)),
        h('div', { class: 'pbc-help pbc-range-help', text: rangeHelp(kind) }));
    }

    // ---- the preview with the edges on it (SHR-18), and the sliders (GRP-5)
    const values = lineValues(binning, info);
    const preview = h('div', { class: `pbc-hist${hist ? '' : ' is-empty'}`, role: 'group', aria: { label: `Distribution of ${name} with the edges` } });
    const bars = h('div', { class: 'pbc-bars', aria: { hidden: 'true' } });
    if (hist) for (const f of barHeights(hist, { zeroBin: !!binning.zero_bin })) bars.append(h('span', { class: 'pbc-bar', style: `height:${(f * 100).toFixed(1)}%` }));
    const lines = h('div', { class: 'pbc-lines' });
    preview.append(bars, lines);
    if (hist && binning.zero_bin && hist.lo === 0 && hist.n_zero > 0) {
        preview.classList.add('has-zero');
        preview.append(h('span', { class: 'pbc-zero-bar', title: `${P.zero(name)}: ${fmt(hist.n_zero)} cells`, aria: { hidden: 'true' } }));
    }
    const slidable = method === 'manual' && !!hist;
    const drag = { i: -1 };
    const readout = h('div', { class: 'pbc-readout', aria: { hidden: 'true' }, hidden: true });
    const neighbours = (i) => {
        const lo = i > 0 ? values[i - 1] : hist.lo;
        const hi = i < values.length - 1 ? values[i + 1] : hist.hi;
        return [lo, hi];
    };
    const place = (line, v) => {
        line.style.left = `${(fractionOf(v, hist) * 100).toFixed(3)}%`;
        line.setAttribute('aria-valuenow', String(v));
        line.setAttribute('aria-valuetext', figure(v));
    };
    const commitMove = (i, v) => {
        const next = moveThreshold(binning, i, v, nb);
        if (next) apply(next, `move threshold ${i + 1} of ${name}`);
    };
    if (hist) {
        values.forEach((v, i) => {
            if (!slidable) { lines.append(h('div', { class: 'pbc-line pbc-line--fixed', style: `left:${(fractionOf(v, hist) * 100).toFixed(3)}%`, aria: { hidden: 'true' } })); return; }
            const [lo, hi] = neighbours(i);
            const line = h('div', { class: 'pbc-line', role: 'slider', tabIndex: 0, aria: { label: `Threshold ${i + 1} of ${values.length}`,
                valuemin: String(lo), valuemax: String(hi), valuenow: String(v), valuetext: figure(v), orientation: 'horizontal' } });
            line.style.left = `${(fractionOf(v, hist) * 100).toFixed(3)}%`;
            const margin = (hist.hi - hist.lo) / 1000;
            line.addEventListener('keydown', (e) => {
                const step = keyStep(hist, e.shiftKey);
                const [a, b] = neighbours(i);
                let target = null;
                if (e.key === 'ArrowRight' || e.key === 'ArrowUp') target = values[i] + step;
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') target = values[i] - step;
                else if (e.key === 'Home') target = i === 0 ? hist.lo : a + keyStep(hist, false);
                else if (e.key === 'End') target = i === values.length - 1 ? hist.hi : b - keyStep(hist, false);
                if (target === null) return;
                e.preventDefault();
                commitMove(i, Math.min(Math.max(target, a + (i > 0 ? margin : 0)), b - (i < values.length - 1 ? margin : 0)));
            });
            line.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                line.setPointerCapture(e.pointerId);
                line.focus();
                const rect = line.getBoundingClientRect();
                drag.i = i;
                drag.offset = e.clientX - (rect.left + rect.width / 2);
                drag.value = v;
                readout.hidden = false;
                readout.textContent = figure(v);
                readout.style.left = line.style.left;
            });
            line.addEventListener('pointermove', (e) => {
                if (drag.i !== i) return;
                const box = preview.getBoundingClientRect();
                const [a, b] = neighbours(i);
                const raw = valueAt(Math.min(1, Math.max(0, (e.clientX - drag.offset - box.left) / box.width)), hist);
                drag.value = Math.min(Math.max(raw, a + (i > 0 ? margin : 0)), b - (i < values.length - 1 ? margin : 0));
                place(line, drag.value);
                readout.textContent = figure(drag.value);
                readout.style.left = line.style.left;
            });
            const release = (e, keep) => {
                if (drag.i !== i) return;
                drag.i = -1;
                readout.hidden = true;
                if (line.hasPointerCapture(e.pointerId)) line.releasePointerCapture(e.pointerId);
                if (keep) commitMove(i, drag.value); else place(line, v);
            };
            line.addEventListener('pointerup', (e) => release(e, true));
            line.addEventListener('pointercancel', (e) => release(e, false));
            lines.append(line);
        });
        preview.append(readout);
    }
    const ticks = h('div', { class: `pbc-ticks${preview.classList.contains('has-zero') ? ' has-zero' : ''}`, aria: { hidden: 'true' } });
    if (hist && values.length <= 12) for (const v of values) ticks.append(h('span', { class: 'pbc-tick', text: figure(v), style: `left:${(fractionOf(v, hist) * 100).toFixed(3)}%` }));

    // ---- under the chips: the population, Freeze thresholds, and what the engine did
    const frozen = freeze(binning, info);
    const freezeBtn = h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary pbc-freeze', disabled: !frozen,
        title: 'Keeps today\'s edges as manual thresholds, so the bins no longer move.',
        on: { click: () => {
            if (!frozen) return;
            mem.frozen = { before: binning, after: stableStringify(frozen), method, population: populationPhrase(info) };
            apply(frozen, `freeze thresholds of ${name}`);
        } } }, 'Freeze thresholds');
    const line = method === 'manual' || method === 'categories' ? '' : edgesLine(info);
    const foot = h('div', { class: 'pbc-foot' }, h('span', { class: 'pbc-edges-line', text: line }), freezeBtn);
    const extra = [];
    if (mem.moved !== null && method !== 'manual' && method !== 'categories') {
        extra.push(h('div', { class: 'pbc-moved', role: 'status' }, movedLine(mem.moved), ' ',
            h('button', { type: 'button', class: 'btn btn-sm btn-link pbc-moved__freeze', disabled: !frozen, on: { click: () => freezeBtn.click() } }, 'Freeze thresholds')));
    }
    if (mem.frozen && method === 'manual' && mem.frozen.after === sig) {
        extra.push(h('div', { class: 'pbc-frozen pbc-help' }, frozenLine(mem.frozen), ' ',
            h('button', { type: 'button', class: 'btn btn-sm btn-link pbc-undo', on: { click: () => {
                const before = mem.frozen.before;
                mem.frozen = null;
                apply(before, `undo freeze of ${name}`);
            } } }, 'Undo')));
    }
    const notes = h('div', { class: 'pbc-notes', role: 'status' }, binningNotes(binning, info, { kind }).map((n) => h('p', { class: `pbc-note pbc-note--${n.id}`, text: n.text })));

    const root = h('div', { class: 'pbc', data: { method } }, rows, preview, ticks, ctx.levels || null, foot, extra, notes, message);
    host.replaceChildren(root);

    // the card is attached after it is built, so the focus goes back once it is in the page
    if (held && held.key === key && Date.now() - held.at < FOCUS_MS) {
        const wanted = held;
        setTimeout(() => {
            if (held !== wanted || !root.isConnected) return;
            const target = wanted.kind === 'slider' ? lines.children[wanted.index] : root.querySelector(`.${wanted.cls}`);
            if (target && document.activeElement !== target) {
                target.focus();
                if (target.type === 'text') target.setSelectionRange(target.value.length, target.value.length);
            }
        }, 0);
    }

    return { destroy() { destroyed = true; } };
}
BINNING_SLOT.mount = mount;
