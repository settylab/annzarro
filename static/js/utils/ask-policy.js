/**
 * "Don't ask again for this panel" (aggregation-unify-080.md 14.4): one flag per panel, kept for the page session only.
 *
 * A level says how far the panel's computations start without asking: `'confirm'` skips the question of the `awaiting` tier;
 * `'try'` also runs a refused tier within the server's Try anyway bounds. Nothing else is skipped: a size limit never is.
 *
 * It is state of the page, deliberately outside every panel's configuration: it is in no link, no saved session, no panel
 * set and no autosave (a shared link must not start a 30-minute job on another person's server unasked), it is no undo
 * step, and it is gone with a reload, a dataset change, the panel's closing and the indicator's "Ask again".
 * Pure: no DOM, so Node tests hold its rules.
 */

/** The levels, weakest first. */
const LEVELS = Object.freeze(['confirm', 'try']);

const rank = (level) => LEVELS.indexOf(level);

/** The panel a host (a plot's or a table's container) belongs to, or null. */
export function panelOfHost(host) {
    if (!host || typeof host.id !== 'string') return (host && host.__azPanelId) || null;
    const m = /^(?:plot|table)-container-(.+)$/.exec(host.id);
    return m ? m[1] : host.__azPanelId || null;
}

/** A policy of its own (the page uses `askPolicy`; a test makes one). */
// export-unused-ok: a test makes its own policy
export function createAskPolicy() {
    /** @type {Map<string, string>} */
    const levels = new Map();
    const listeners = new Set();
    const told = () => { for (const fn of [...listeners]) { try { fn(); } catch (error) { console.error('Ask policy listener:', error); } } };
    return {
        /** The panel's level: 'confirm', 'try' or null. */
        get(panelId) { return (panelId && levels.get(panelId)) || null; },
        /** Whether the panel's level covers `level` (a 'try' also skips the question). */
        covers(panelId, level) { return rank(this.get(panelId)) >= rank(level) && rank(this.get(panelId)) >= 0; },
        /** Set the panel's level (null clears it). */
        set(panelId, level) {
            if (!panelId) return;
            if (level === null || level === undefined) { this.clear(panelId); return; }
            if (!LEVELS.includes(level)) throw new Error(`Unknown ask level '${level}'`);
            if (levels.get(panelId) === level) return;
            levels.set(panelId, level);
            told();
        },
        clear(panelId) {
            if (panelId && levels.delete(panelId)) told();
        },
        /** A dataset change, or a new page: nothing is remembered. */
        clearAll() {
            if (!levels.size) return;
            levels.clear();
            told();
        },
        /** The panels that have a level. */
        panels() { return [...levels.keys()]; },
        /** Be told of every change. Returns the way to stop. */
        onChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        }
    };
}

/** The page's. */
export const askPolicy = createAskPolicy();
