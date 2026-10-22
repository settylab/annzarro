/**
 * The browser memory guard on the page: the one ledger of what the open
 * panels hold, the checks the controls ask before an action, and the crash
 * marker. The models and the arithmetic are in memory-guard.js (pure).
 *
 * Who asks what:
 * - the Cell/Gene Plot draw (plot-make.js loadDataAndCreatePlot): drawCheck,
 *   then reserve / commit / cancel. Every way a plot is drawn goes through
 *   it: a new, duplicated or reopened panel, a restored panel set, a subset
 *   change, a recolour that redraws;
 * - the create and duplicate tiles (selection-tile.js): newPanelCheck;
 * - the subset dialog (subset-dialog.js): subsetCheck, maxSubsetCells;
 *   the dataset switch (main.js): maxSubsetCells for the size kept;
 * - image export (plot-aesthetics-menu.js, the modebar camera): exportCheck.
 */
import { Config } from '../config.js';
import { CacheManager } from '../cache-manager.js';
import {
    Ledger, memorySettings, readLimits, panelCost, exportCost, recolourCost, labelCost, check, addCost, predictSubsetChange, drawNeed,
    largestFitting, headroomLine, markPending, clearPending, takeCrashed, learnFromCrash,
    formatGB, CONTEXTS_PER_PLOT, DrawTurns, isHeavyDraw, shortWhy, emptyPageWhy, roundDownNice, DRAW_ANYWAY_RISK,
    panelBuffers, bufferDrawNeed, predictSubsetBuffers, bindingLabel, refusalHeadline,
    readLearned, learnedFor, forgetLearned, learnedSucceeded
} from './memory-guard.js';
import { compactCount } from './coverage.js';
import { liveWebglContexts } from './release-plot.js';
import { probe, blockParts, PROBE_MIN_BYTES } from './alloc-probe.js';
import { PAGE_ID } from './page-id.js';

export const MEMORY_EVENT = 'annzarro:memory-changed';

/** The page's ledger. */
export const ledger = new Ledger();

function _storage() {
    if (typeof window === 'undefined') return null;
    try { return window.localStorage || null; } catch { return null; }
}
const NO_STORAGE = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const storage = () => _storage() || NO_STORAGE;

// -- crash marker: what the previous page was doing when it died -------------

let _crashed = null;
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    _crashed = takeCrashed(storage());
    // an extra margin, and the buffers the page held, for actions of about that size (memory-guard.js readLearned)
    if (_crashed) learnFromCrash(storage(), _crashed);
    // a page that is closed or reloaded on purpose did not crash
    window.addEventListener('pagehide', () => clearPending(storage()));
}

/** What the previous page was drawing when it died ({panel, n, action, at, page}), or null. */
export function crashedLastTime() {
    return _crashedAtLoad;
}
const _crashedAtLoad = _crashed;

/**
 * The action the previous page died in, if it was drawing panel `id`. It
 * holds for this page until "Draw anyway" (overrideOnce): a panel's init and
 * the dataset's arrival both ask to draw it.
 */
export function crashedDrawing(id) {
    return _crashed && _crashed.panel === id ? _crashed : null;
}

/** Panels the user told to draw although the guard or the crash marker said no. */
const _overrides = new Set();
export function overrideOnce(id) {
    _overrides.add(id);
    if (_crashed && _crashed.panel === id) _crashed = null;
}
export function takeOverride(id) { return _overrides.delete(id); }

// -- settings, limits, what is held ------------------------------------------

/**
 * ui.memory, with what this browser learned from a crash for an action of
 * `n` points (none for n null, or outside the crash's scope: memory-guard.js
 * learnedFor). `learned: false` gives the settings without it.
 */
export function settings(n = null, learned = true) {
    const s = memorySettings(Config.DEFAULTS && Config.DEFAULTS.MEMORY);
    const l = learned ? learnedFor(readLearned(storage()), n) : { margin: 0, buffers: null };
    return { ...s, margin: s.margin + l.margin, crashedBuffers: l.buffers };
}

export function limits(n = null, learned = true) {
    return readLimits({ performance: globalThis.performance, navigator: globalThis.navigator }, settings(n, learned));
}

/** What this browser learned from a crash ({margin, buffers, n, at}), or null. */
export function learned() { return readLearned(storage()); }

/** Forget it ("Reset the margin"): every control asks again. */
export function resetLearned() {
    forgetLearned(storage());
    inputsChanged();
}

function _cacheBytes() {
    try { return typeof CacheManager.bytes === 'function' ? CacheManager.bytes() : 0; } catch { return 0; }
}

/** What everything but `exclude` holds now; WebGL contexts as counted on the page. */
export function held(exclude = []) {
    ledger.setCacheBytes(_cacheBytes());
    const t = ledger.totals({ exclude });
    return { ...t, contexts: Math.max(t.contexts, liveWebglContexts()) };
}

function _observed() {
    return ledger.observed ? ledger.observed.bytes : 0;
}

/**
 * `buffers`: {need, held} ArrayBuffer bytes, for an action of plots (check()'s
 * opts.buffers); `n`: the action's points, for what a crash taught. A
 * refusal that only the learned margin makes carries `learned` (the entry),
 * so the panel can say so and offer to reset it.
 */
function _check(need, heldNow, panels, buffers = null, n = null) {
    const opts = { observed: _observed(), panels, ...(buffers ? { buffers } : {}) };
    const r = check(need, heldNow, limits(n), settings(n), opts);
    if (r.fits || n === null) return r;
    const entry = readLearned(storage());
    if (!entry || !learnedFor(entry, n).margin) return r;
    const plain = check(need, heldNow, limits(n, false), settings(n, false), opts);
    return plain.fits ? { ...r, learned: entry } : r;
}

// The create tiles ask on every memory change: one answer per size is kept for a few seconds.
const PROBE_TTL_MS = 3000;
const _answers = new Map();
/**
 * Forget the probe answers: after a plot is closed its buffers are freed by
 * the collector some time later, and an answer taken in between says no.
 */
export function freshProbes() { _answers.clear(); }
/** Whether the browser gives `bytes` now (utils/alloc-probe.js); false when it refuses. */
function _probeAnswer(bytes) {
    const key = Math.ceil(bytes / 1e6), now = Date.now();
    const seen = _answers.get(key);
    if (seen && now - seen.at < PROBE_TTL_MS) return seen.ok;
    const r = probe(blockParts(bytes));
    r.release();
    _answers.set(key, { ok: r.ok, at: now });
    return r.ok;
}

/**
 * The allocation probe for a step the RAM check let through: ask the browser
 * for the step's transient buffers (`bytes`; released at once) and refuse
 * the step if it says no. The RAM budget protects the machine; this asks
 * the browser (utils/alloc-probe.js). Steps under PROBE_MIN_BYTES are not
 * probed. The verdict follows ui.memory.enforce as the budget's does.
 * @param {Object} result - from _check
 * @param {number} bytes - what the step allocates at its peak
 * @param {string} what - "export", "hover labels", ...
 */
export function probed(result, bytes, what) {
    if (!result || !result.fits || !(bytes >= PROBE_MIN_BYTES)) return result;
    // the browser gives the bytes: the step goes ahead
    if (_probeAnswer(bytes)) return result;
    const s = settings();
    return { ...result, fits: false, binding: 'alloc', needBytes: bytes,
        verdict: s.enforce === 'off' ? 'ok' : s.enforce === 'warn' ? 'warn' : 'block',
        why: `this browser cannot allocate the ~${formatGB(bytes)} the ${what} needs` };
}

/** "Browser memory: 2.1 of 4.0 GB JS memory free with 2 plots open (estimated)". */
export function headroomText() {
    return headroomLine(held(), limits(), { panels: ledger.plotCount(), measured: _observed() > 0 });
}

// -- the checks -----------------------------------------------------------------

/**
 * Before panel `id` draws: whether its peak fits next to what the other
 * panels hold. Its previous plot stays until the new one replaces it.
 * @param {Object} p - {id, kind, n, large, colour, threeD, livePlot}
 */
export function drawCheck({ id, kind, n, large = false, colour = 'numeric', threeD = false, livePlot = false }) {
    const cost = panelCost({ kind, n, large, colour, threeD }).peak;
    const old = ledger.get(id);
    // a plot redrawn in place in large-plot mode replaces itself (drawNeed)
    const add = drawNeed(cost, livePlot ? old : null, large, settings(n).margin);
    const need = { ...add, contexts: livePlot ? 0 : cost.contexts };
    let h = held([id]);
    if (old) h = addCost(h, { ...old.resident, contexts: 0 });
    // the tab's buffers, with every other plot's (and this one's old plot until it is replaced)
    const buffers = { need: bufferDrawNeed({ kind, n, large, threeD }, livePlot ? old : null),
        held: ledger.buffers({ exclude: [id] }) + (old && old.buffers ? old.buffers.resident : 0) };
    return _check(need, h, ledger.plotCount() + (old ? 0 : 1), buffers, n);
}

/**
 * Before a table panel loads its rows: whether `n` rows fit next to what the
 * other panels hold (its previous rows are replaced). Tables of millions of
 * rows hold hundreds of bytes a row on the JS heap.
 * @param {{id: string, kind: string, n: number}} p
 */
export function tableCheck({ id, kind, n }) {
    const need = panelCost({ kind, n }).peak;
    return _check(need, held([id]), ledger.plotCount(), null, n);
}

/**
 * What a refused table or plot panel says and offers (the placeholder and the
 * strip's popover). A refusal that closing the other panels can fix says what
 * is free; one that even an empty page cannot hold (check()'s `hopeless`)
 * says so, offers no "Close other plots", offers "Show N cells" for the
 * largest subset that fits (a Cell Table or Cell Plot) and "Subset…", and
 * offers "draw anyway" only while the estimate without the margin fits the
 * ceiling (above it the browser ends the tab).
 * @param {Object} p
 * @param {Object} p.result - the refused check
 * @param {'cell-table'|'gene-table'|'cell-plot'|'gene-plot'} p.kind
 * @param {number} p.n - rows or points asked for
 * @param {(n: number) => Object} p.checkAt - the same check at another size
 * @param {string} p.anyway - the label of the draw-anyway action
 * @param {number} [p.cap] - most cells "Show N cells" offers (a table that loads slowly past it), whatever fits
 * @returns {{headline: string, why: string, risk: string|null, actions: Array<[string, string]>, hopeless: boolean}}
 */
export function refusalPanel({ result, kind, n, checkAt, anyway, cap = Infinity }) {
    const p = _refusalPanel({ result, kind, n, checkAt, anyway, cap });
    // refused only for what a crash taught: say so, and offer to forget it
    if (result.learned) {
        p.why = `${p.why} ${learnedNote(result.learned)}`;
        p.actions = [['memory-reset', 'Reset the margin'], ...p.actions];
    }
    return p;
}

/**
 * The sentence of a refusal that only the margin learned from a crash makes:
 * "After this browser's tab ended on Oct 17, AnnZarro keeps an extra margin
 * for this size."
 */
export function learnedNote(entry) {
    const day = new Date(Number(entry && entry.at) || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `After this browser's tab ended on ${day}, AnnZarro keeps an extra margin for this size.`;
}

function _refusalPanel({ result, kind, n, checkAt, anyway, cap }) {
    const isTable = kind.endsWith('table');
    const cells = kind.startsWith('cell');
    const noun = isTable ? 'rows' : 'points';
    const verb = anyway.replace(/ anyway$/, '');
    const risk = DRAW_ANYWAY_RISK.replace(/^Draw anyway/, `${verb} anyway`);
    if (!result.hopeless) {
        const fewer = cells ? [['subset-half', 'Half the cells'], ['subset', 'Subset\u2026']] : [];
        return { headline: refusalHeadline(result.binding, isTable ? 'Not loaded' : 'Not drawn'),
            why: shortRefusalText(result), risk, hopeless: false,
            actions: [...fewer, ['close-others', 'Close other plots'], ['draw-anyway', anyway]] };
    }
    let fit = 0;
    if (cells) {
        try { fit = roundDownNice(Math.min(cap, largestFitting(m => checkAt(m).fits, 1, n - 1))); } catch { fit = 0; }
    }
    const actions = [];
    if (fit >= 1) actions.push([`subset-n:${fit}`, `Show ${fit.toLocaleString('en-US')} cells`]);
    if (cells) actions.push(['subset', 'Subset\u2026']);
    if (!result.doomed) actions.push(['draw-anyway', anyway]);
    let why = emptyPageWhy(result, `${compactCount(n)} ${noun}`);
    if (!cells) why += ' Genes cannot be subset; this panel shows every gene of the dataset.';
    return { headline: `Too many ${noun} for this browser`, why, risk: result.doomed ? null : risk, hopeless: true, actions };
}

// -- heavy draws take turns ------------------------------------------------------

const turns = new DrawTurns();
const _turnOf = new Map();    // ledger token -> ticket

/**
 * Before the draw of panel `p` ({kind, n, large, colour, threeD}) is
 * checked: a heavy draw (memory-guard.js isHeavyDraw) waits until the heavy
 * draw before it is done, so that its check and its allocation probe see
 * what that one holds. Resolves to a ticket (null for a light draw, which
 * does not wait); bindTurn() hands it to the ledger token, or release it
 * with releaseTurn() when nothing is reserved.
 */
export async function takeTurn(id, p) {
    let heavy = false;
    try {
        heavy = isHeavyDraw(panelCost(p).peak, limits(), !!p.large);
    } catch { /* the guard must never be why a plot is not drawn */ }
    return heavy ? turns.take(id) : null;
}
/** The draw with ledger `token` holds `ticket` until it is committed or cancelled. */
export function bindTurn(token, ticket) { if (token && ticket) _turnOf.set(token, ticket); }
export function releaseTurn(ticket) { turns.release(ticket); }
function _releaseToken(token) {
    const ticket = token ? _turnOf.get(token) : null;
    if (ticket) { _turnOf.delete(token); turns.release(ticket); }
}
/** Heavy draws drawing or waiting for their turn (for tests and the restore marker). */
export function turnsInUse() { return (turns.holder() ? 1 : 0) + turns.waiting().length; }

// -- out of memory: panels whose draw or read ran out ----------------------------

const _outOfMemory = new Set();
/** Panel `id`'s draw or read failed because the browser ran out of memory. */
export function noteOutOfMemory(id) {
    if (id === null || id === undefined) return;
    _outOfMemory.add(String(id));
    ledger._changed();
}
/** Plots (cell and gene) other than panel `id` that hold memory now, the same count on every browser. */
export function otherPlotCount(id) {
    const all = new Map([...ledger.entries, ...ledger.pending].map(([k, e]) => [String(k), e]));
    all.delete(String(id));
    return [...all.values()].filter(e => e.kind === 'cell-plot' || e.kind === 'gene-plot').length;
}
/** Panels whose last draw ran out of memory and that are still open. */
export function outOfMemoryPanels() { return [..._outOfMemory]; }
/** Draws in flight (reserved, not yet committed or cancelled). */
export function drawsInFlight() { return ledger._drawing.size + turns.waiting().length; }

/**
 * Before a plot reads the hover labels of a categorical column: `labels`
 * distinct labels of about `chars` characters over `points` points
 * (memory-guard.js labelCost). A refusal leaves the plot coloured, its
 * hover off.
 */
export function hoverLabelsCheck({ points, labels, chars }) {
    const need = labelCost({ points, labels, chars });
    // labels live on the V8 heap, whose exhaustion cannot be caught: ask for
    // as many bytes as a proxy for what the process can still commit
    return probed(_check(need, held(), ledger.plotCount(), null, points), need.heap + need.off, 'hover labels');
}

/** Before a recolour of the drawn regular plot `gd` (large-plot mode redraws, and is checked as a draw). */
export function recolourCheck(gd) {
    const n = Number(gd && gd._pointCount) || 0;
    const need = recolourCost({ n, large: !!(gd && gd.__isLarge) });
    return probed(_check(need, held(), ledger.plotCount(), null, n), need.off, 'recolour');
}

/** Before a new or duplicated panel of `kind` with `config` (its colour and 3D) is created. */
export function newPanelCheck(kind, { n, large = false, colour = 'numeric', threeD = false } = {}) {
    if (kind !== 'cell-plot' && kind !== 'gene-plot') return _check({ heap: 0, off: 0, gpu: 0, contexts: 0 }, held(), ledger.plotCount());
    const need = panelCost({ kind, n, large, colour, threeD }).peak;
    const now = held();
    const buffers = { need: panelBuffers({ kind, n, large, threeD }).peak, held: ledger.buffers() };
    // the probe asks for what the draw's own probe will (large-plot.js): its buffers at their peak
    return probed(_check(need, now, ledger.plotCount() + 1, buffers, n), large ? buffers.need : 0, 'new plot');
}

/**
 * Before a full-resolution export of `gd`: the plot is drawn again off
 * screen, so it needs about what the plot needs, while the plot stays.
 */
export function exportCheck(gd, { width = 1200, height = 800, scale = 1 } = {}) {
    const n = Number(gd && gd._pointCount) || ((gd && gd.data) || []).reduce((s, t) => s + ((t && t.x && t.x.length) || 0), 0);
    const need = exportCost({ n, large: !!(gd && gd.__isLarge), width, height, scale });
    return probed(_check(need, held(), ledger.plotCount(), { need: need.off, held: ledger.buffers() }, n), need.off, 'export');
}

/**
 * Before the subset changes to `n` cells: every open Cell Plot and cell
 * table redraws at once, each keeping its old points until the new ones
 * replace them. `need` is what the change adds on top of what is held.
 * The tab's buffers are checked for all plots together (large plots draw in
 * turns, each beside the ones drawn before it: predictSubsetBuffers).
 * @param {number} n
 * @param {number} threshold - large-plot mode above this many points
 */
export function subsetCheck(n, threshold) {
    const panels = ledger.panels();
    const { peak, changed } = predictSubsetChange(n, panels, threshold, ledger.model, p => !p.threeD, settings(n).margin);
    const b = predictSubsetBuffers(n, panels, threshold, ledger.model, p => !p.threeD);
    const now = held();
    const base = held(panels.map(p => p.id));
    // what the change adds: the peak of all panels less what they hold now
    const need = {
        heap: Math.max(0, base.heap + peak.heap - now.heap),
        off: Math.max(0, base.off + peak.off - now.off),
        gpu: Math.max(0, base.gpu + peak.gpu - now.gpu),
        contexts: 0
    };
    const buffers = { need: Math.max(0, b.peak - b.before), held: ledger.buffers() };
    return { ..._check(need, now, ledger.plotCount(), buffers, n), changed };
}

/**
 * The allocation probe of a subset change to `n` cells (not part of
 * subsetCheck, which the size chips ask many times): when Cell Plots will
 * draw large at that size, allocate the buffers all of them add at the
 * change's peak (predictSubsetBuffers, beyond what they hold now), release
 * them. Safari gives untouched blocks of any size, so there it is the
 * model's ceiling (subsetCheck) that refuses.
 * @returns {{ok: boolean, why: string}}
 */
export function subsetProbe(n, threshold) {
    const panels = ledger.panels();
    const plots = panels.filter(p => p.kind === 'cell-plot' && !p.threeD).length;
    if (!(n > threshold) || !plots) return { ok: true, why: '' };
    const b = predictSubsetBuffers(n, panels, threshold, ledger.model, p => !p.threeD);
    const bytes = Math.max(0, b.peak - b.before);
    if (!(bytes >= PROBE_MIN_BYTES)) return { ok: true, why: '' };
    const r = probe(blockParts(bytes));
    r.release();
    if (r.ok) return { ok: true, why: '' };
    return { ok: false, why: `this browser cannot hold ${Math.round(n).toLocaleString('en-US')} points`
        + (plots > 1 ? ` in each of ${plots} plots (~${formatGB(bytes)} of browser buffers)` : '') };
}

/** The largest subset (cells, at most `eligible`) that subsetCheck lets through, or 0. */
export function maxSubsetCells(eligible, threshold) {
    const s = settings();
    if (s.enforce === 'off') return Number(eligible) || 0;
    return Math.max(0, largestFitting(n => subsetCheck(n, threshold).fits, 1, Number(eligible) || 0));
}

/** The sentence beside a refused control: why, and the ways out. */
export function refusalText(result, advice) {
    // a browser that cannot allocate: closing other plots may not help, a smaller step does
    if (result && result.binding === 'alloc') advice = advice.replace(/^Close a plot, or s/, 'S');
    const learnedText = result && result.learned ? ` ${learnedNote(result.learned)} Reset it to check without it.` : '';
    return `${result.why ? result.why.charAt(0).toUpperCase() + result.why.slice(1) : 'Not enough browser memory'}.${learnedText} ${advice}`;
}

/** The short form for a refused panel: one line of numbers (memory-guard.js shortWhy); its ways out are buttons. */
export function shortRefusalText(result) {
    return shortWhy(result && result.why);
}

/** Leave a crash marker when `result` says the action comes close to the ceiling. */
export function markIfRisky(result, action) {
    if (result && result.risky) {
        markPending(storage(), { ...action, page: PAGE_ID, ...(result.buffersPeakBytes > 0 ? { buffers: result.buffersPeakBytes } : {}) });
    }
}

/** The marked action finished (or was never marked). */
export function unmark() {
    clearPending(storage());
}

/**
 * Run `fn` with a crash marker when the check said the action comes close
 * to the ceiling: if the tab dies, the next page knows which panel did it.
 */
export async function guarded(result, action, fn) {
    if (!result || !result.risky) return fn();
    markPending(storage(), { ...action, page: PAGE_ID });
    try {
        return await fn();
    } finally {
        clearPending(storage());
    }
}

// -- measured totals (cross-origin isolated pages only) -------------------------

let _measureTimer = null;
function _scheduleMeasure() {
    const perf = globalThis.performance;
    if (!globalThis.crossOriginIsolated || !perf || typeof perf.measureUserAgentSpecificMemory !== 'function') return;
    clearTimeout(_measureTimer);
    _measureTimer = setTimeout(async () => {
        try {
            const r = await perf.measureUserAgentSpecificMemory();
            if (r && r.bytes > 0) ledger.observe(r.bytes, 'measureUserAgentSpecificMemory');
        } catch { /* not allowed here after all */ }
    }, 3000);
}

let _notifyTimer = null;
ledger.onChange(() => {
    clearTimeout(_notifyTimer);
    _notifyTimer = setTimeout(() => {
        if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
            document.dispatchEvent(new CustomEvent(MEMORY_EVENT));
        }
    }, 50);
});

/** A panel's draw starts; returns its token (Ledger.reserve). */
export function reserve(id, p) { return ledger.reserve(id, p); }
/** A panel's draw finished (that draw's token, or a cost `p`, e.g. a table's rows). */
export function commit(id, p = null, token = null) {
    _outOfMemory.delete(String(id));
    ledger.commit(id, p, token);
    _releaseToken(token);
    _scheduleMeasure();
    // a draw as large as the one that crashed went through: the extra margin is forgotten
    const e = ledger.get(id);
    if (e && learnedSucceeded(storage(), e.n)) inputsChanged();
}
/** A panel's draw did not happen. */
export function cancel(id, token = null) { ledger.cancel(id, token); _releaseToken(token); }
/** A panel was closed or cleared. */
export function forget(id) {
    const was = _outOfMemory.delete(String(id));
    ledger.remove(id);
    if (was) ledger._changed();
    _scheduleMeasure();
    _recheckSoon();
}

/**
 * Ask every check again once the collector has had time to free what a
 * closed panel held, and once more after that: a probe right after the
 * close finds its buffers still taken (a 95.6M-cell plot's 7 GB: the
 * collector frees them after the failed allocation that made it run), and
 * nothing else would ask again until another panel changed.
 */
const RECHECKS = 2;
let _recheckTimer = null;
function _recheckSoon(left = RECHECKS) {
    freshProbes();
    if (typeof setTimeout !== 'function') return;
    clearTimeout(_recheckTimer);
    _recheckTimer = setTimeout(() => {
        _recheckTimer = null;
        inputsChanged();
        if (left > 1) _recheckSoon(left - 1);
    }, PROBE_TTL_MS + 500);
}

/**
 * What the checks depend on beyond the ledger changed (the cells shown: a
 * subset change, another dataset): every control that asks the guard asks
 * again (MEMORY_EVENT). Without it a create tile refused at every cell of a
 * dataset stayed refused at 100,000 cells, with no panel open to change.
 */
export function inputsChanged() {
    freshProbes();
    ledger._changed();
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    for (const type of ['datasetChanged', 'datasetCleared', 'cellsChanged']) document.addEventListener(type, () => inputsChanged());
}

export { formatGB, CONTEXTS_PER_PLOT, bindingLabel };
