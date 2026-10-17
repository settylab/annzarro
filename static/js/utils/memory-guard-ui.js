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
 * - image export (plot-aesthetics-menu.js, the modebar camera): exportCheck.
 */
import { Config } from '../config.js';
import { CacheManager } from '../cache-manager.js';
import {
    Ledger, memorySettings, readLimits, panelCost, exportCost, recolourCost, labelCost, check, addCost, predictSubsetChange, drawNeed,
    largestFitting, headroomLine, markPending, clearPending, takeCrashed, learnedMargin, learnFromCrash,
    formatGB, CONTEXTS_PER_PLOT, DrawTurns, isHeavyDraw, shortWhy
} from './memory-guard.js';
import { liveWebglContexts } from './release-plot.js';
import { probe, blockParts, largePlotParts, PROBE_MIN_BYTES } from './alloc-probe.js';
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
    if (_crashed) learnFromCrash(storage());
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

export function settings() {
    const s = memorySettings(Config.DEFAULTS && Config.DEFAULTS.MEMORY);
    return { ...s, margin: s.margin + learnedMargin(storage()) };
}

export function limits() {
    return readLimits({ performance: globalThis.performance, navigator: globalThis.navigator }, settings());
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

function _check(need, heldNow, panels) {
    return check(need, heldNow, limits(), settings(), { observed: _observed(), panels });
}

// The create tiles ask on every memory change: one answer per size is kept for a few seconds.
const PROBE_TTL_MS = 3000;
const _answers = new Map();
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
    if (!_probeAnswer(bytes)) return result;
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
    const add = drawNeed(cost, livePlot ? old : null, large, settings().margin);
    const need = { ...add, contexts: livePlot ? 0 : cost.contexts };
    let h = held([id]);
    if (old) h = addCost(h, { ...old.resident, contexts: 0 });
    return _check(need, h, ledger.plotCount() + (old ? 0 : 1));
}

/**
 * Before a table panel loads its rows: whether `n` rows fit next to what the
 * other panels hold (its previous rows are replaced). Tables of millions of
 * rows hold hundreds of bytes a row on the JS heap.
 * @param {{id: string, kind: string, n: number}} p
 */
export function tableCheck({ id, kind, n }) {
    const need = panelCost({ kind, n }).peak;
    return _check(need, held([id]), ledger.plotCount());
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
    return probed(_check(need, held(), ledger.plotCount()), need.heap + need.off, 'hover labels');
}

/** Before a recolour of the drawn regular plot `gd` (large-plot mode redraws, and is checked as a draw). */
export function recolourCheck(gd) {
    const need = recolourCost({ n: Number(gd && gd._pointCount) || 0, large: !!(gd && gd.__isLarge) });
    return probed(_check(need, held(), ledger.plotCount()), need.off, 'recolour');
}

/** Before a new or duplicated panel of `kind` with `config` (its colour and 3D) is created. */
export function newPanelCheck(kind, { n, large = false, colour = 'numeric', threeD = false } = {}) {
    if (kind !== 'cell-plot' && kind !== 'gene-plot') return _check({ heap: 0, off: 0, gpu: 0, contexts: 0 }, held(), ledger.plotCount());
    const need = panelCost({ kind, n, large, colour, threeD }).peak;
    return probed(_check(need, held(), ledger.plotCount() + 1), large ? need.off : 0, 'new plot');
}

/**
 * Before a full-resolution export of `gd`: the plot is drawn again off
 * screen, so it needs about what the plot needs, while the plot stays.
 */
export function exportCheck(gd, { width = 1200, height = 800, scale = 1 } = {}) {
    const n = Number(gd && gd._pointCount) || ((gd && gd.data) || []).reduce((s, t) => s + ((t && t.x && t.x.length) || 0), 0);
    const need = exportCost({ n, large: !!(gd && gd.__isLarge), width, height, scale });
    return probed(_check(need, held(), ledger.plotCount()), need.off, 'export');
}

/**
 * Before the subset changes to `n` cells: every open Cell Plot and cell
 * table redraws at once, each keeping its old points until the new ones
 * replace them. `need` is what the change adds on top of what is held.
 * @param {number} n
 * @param {number} threshold - large-plot mode above this many points
 */
export function subsetCheck(n, threshold) {
    const panels = ledger.panels();
    const { peak, changed } = predictSubsetChange(n, panels, threshold, ledger.model, p => !p.threeD, settings().margin);
    const now = held();
    const base = held(panels.map(p => p.id));
    // what the change adds: the peak of all panels less what they hold now
    const need = {
        heap: Math.max(0, base.heap + peak.heap - now.heap),
        off: Math.max(0, base.off + peak.off - now.off),
        gpu: Math.max(0, base.gpu + peak.gpu - now.gpu),
        contexts: 0
    };
    return { ..._check(need, now, ledger.plotCount()), changed };
}

/**
 * The allocation probe of a subset change to `n` cells (not part of
 * subsetCheck, which the size chips ask many times): when Cell Plots will
 * draw large at that size, allocate the buffers one needs, release them.
 * @returns {{ok: boolean, why: string}}
 */
export function subsetProbe(n, threshold) {
    if (!(n > threshold) || !ledger.panels().some(p => p.kind === 'cell-plot' && !p.threeD)) return { ok: true, why: '' };
    const r = probe(largePlotParts(n, { bytesPerPoint: ledger.model.large.arrayBuffers }));
    r.release();
    if (r.ok) return { ok: true, why: '' };
    return { ok: false, why: `this browser cannot hold ${Math.round(n).toLocaleString('en-US')} points` };
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
    return `${result.why ? result.why.charAt(0).toUpperCase() + result.why.slice(1) : 'Not enough browser memory'}. ${advice}`;
}

/** The short form for a refused panel: one line of numbers (memory-guard.js shortWhy); its ways out are buttons. */
export function shortRefusalText(result) {
    return shortWhy(result && result.why);
}

/** Leave a crash marker when `result` says the action comes close to the ceiling. */
export function markIfRisky(result, action) {
    if (result && result.risky) markPending(storage(), { ...action, page: PAGE_ID });
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
}
/** A panel's draw did not happen. */
export function cancel(id, token = null) { ledger.cancel(id, token); _releaseToken(token); }
/** A panel was closed or cleared. */
export function forget(id) {
    const was = _outOfMemory.delete(String(id));
    ledger.remove(id);
    if (was) ledger._changed();
    _scheduleMeasure();
}

export { formatGB, CONTEXTS_PER_PLOT };
