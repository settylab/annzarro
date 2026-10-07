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
    formatGB, CONTEXTS_PER_PLOT
} from './memory-guard.js';
import { liveWebglContexts } from './release-plot.js';

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
 * Before a plot reads the hover labels of a categorical column: `labels`
 * distinct labels of about `chars` characters over `points` points
 * (memory-guard.js labelCost). A refusal leaves the plot coloured, its
 * hover off.
 */
export function hoverLabelsCheck({ points, labels, chars }) {
    return _check(labelCost({ points, labels, chars }), held(), ledger.plotCount());
}

/** Before a recolour of the drawn regular plot `gd` (large-plot mode redraws, and is checked as a draw). */
export function recolourCheck(gd) {
    const need = recolourCost({ n: Number(gd && gd._pointCount) || 0, large: !!(gd && gd.__isLarge) });
    return _check(need, held(), ledger.plotCount());
}

/** Before a new or duplicated panel of `kind` with `config` (its colour and 3D) is created. */
export function newPanelCheck(kind, { n, large = false, colour = 'numeric', threeD = false } = {}) {
    if (kind !== 'cell-plot' && kind !== 'gene-plot') return _check({ heap: 0, off: 0, gpu: 0, contexts: 0 }, held(), ledger.plotCount());
    const need = panelCost({ kind, n, large, colour, threeD }).peak;
    return _check(need, held(), ledger.plotCount() + 1);
}

/**
 * Before a full-resolution export of `gd`: the plot is drawn again off
 * screen, so it needs about what the plot needs, while the plot stays.
 */
export function exportCheck(gd, { width = 1200, height = 800, scale = 1 } = {}) {
    const n = Number(gd && gd._pointCount) || ((gd && gd.data) || []).reduce((s, t) => s + ((t && t.x && t.x.length) || 0), 0);
    const need = exportCost({ n, large: !!(gd && gd.__isLarge), width, height, scale });
    return _check(need, held(), ledger.plotCount());
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

/** The largest subset (cells, at most `eligible`) that subsetCheck lets through, or 0. */
export function maxSubsetCells(eligible, threshold) {
    const s = settings();
    if (s.enforce === 'off') return Number(eligible) || 0;
    return Math.max(0, largestFitting(n => subsetCheck(n, threshold).fits, 1, Number(eligible) || 0));
}

/** The sentence beside a refused control: why, and the ways out. */
export function refusalText(result, advice) {
    return `${result.why ? result.why.charAt(0).toUpperCase() + result.why.slice(1) : 'Not enough browser memory'}. ${advice}`;
}

/** Leave a crash marker when `result` says the action comes close to the ceiling. */
export function markIfRisky(result, action) {
    if (result && result.risky) markPending(storage(), action);
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
    markPending(storage(), action);
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
export function commit(id, p = null, token = null) { ledger.commit(id, p, token); _scheduleMeasure(); }
/** A panel's draw did not happen. */
export function cancel(id, token = null) { ledger.cancel(id, token); }
/** A panel was closed or cleared. */
export function forget(id) { ledger.remove(id); _scheduleMeasure(); }

export { formatGB, CONTEXTS_PER_PLOT };
