/**
 * The last sessions: what the autosave kept from earlier pages, offered on
 * the welcome screen and in Load Panel Set, and whether a page restores one
 * by itself. Pure (no storage, no DOM), so Node tests cover it; the storage
 * is session-manager.js's.
 *
 * Why: a page that restored the autosave by itself could not be stopped. A
 * panel set kept on "All cells", switched to a 95.6M-cell dataset, ran the
 * tab out of memory; the reload restored the same set and ran out again.
 *
 * - The autosave (ui.autosave.storage_key) holds the newest session. When a
 *   page autosaves over a session another page wrote, that one moves to
 *   HISTORY_KEY. At most MAX_SESSIONS are listed: newest first, one per
 *   page, and the same view (dataset, layout, subset) only once.
 * - A RESTORE MARKER (RESTORING_KEY) is written when a page restores a
 *   session, switches the dataset under open panels or changes the subset,
 *   and removed once every panel is drawn (or refused by the memory guard).
 *   A marker that outlives its page (the page ended mid-draw, or a draw ran
 *   out of memory) marks the session it was drawing "did not finish
 *   loading", and that session is never restored by itself again.
 * - ui.autosave.auto_restore says when a page restores the autosave by
 *   itself (autoRestoreMode).
 */

export const HISTORY_KEY = 'annzarro_last_sessions';
export const RESTORING_KEY = 'annzarro_restoring';
/** Sessions listed (the autosave and the history together). */
export const MAX_SESSIONS = 3;
/** A session larger than this (characters of JSON) is not kept in the history. */
export const MAX_ENTRY_CHARS = 1000000;
/** The history's share of the browser's storage (characters of JSON; browsers give an origin about 5M). */
export const MAX_HISTORY_CHARS = 2500000;
/** A marker its page refreshed this recently belongs to a page still drawing (another tab). */
export const MARKER_LIVE_MS = 15000;

/**
 * ui.autosave.auto_restore:
 * - 'reload' (the default): a reload of the tab (or Back/Forward to it)
 *   restores the autosave; a fresh visit (the bare address typed, a
 *   bookmark, a new tab or window, the desktop app's start) lists it first
 *   and waits for Restore;
 * - 'always': every visit to the bare address restores it;
 * - 'never': it is only listed.
 * true and false (the older boolean form) are 'always' and 'never'.
 * Whatever the mode, a session that did not finish loading is not restored
 * by itself, and a link with a view (?dataset_path=...#view=...) opens what
 * it names.
 */
export const AUTO_RESTORE_MODES = ['reload', 'always', 'never'];

export function autoRestoreMode(value) {
    if (value === true) return 'always';
    if (value === false) return 'never';
    const v = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
    return AUTO_RESTORE_MODES.includes(v) ? v : 'reload';
}

/**
 * How this page was reached: 'reload', 'back_forward', 'navigate' (a link,
 * the address bar, a new tab) or 'prerender'.
 * @param {Object} [perf] - window.performance
 */
export function navigationType(perf) {
    try {
        const entry = perf && typeof perf.getEntriesByType === 'function' ? perf.getEntriesByType('navigation')[0] : null;
        if (entry && entry.type) return entry.type;
        // the older interface: 1 reload, 2 back/forward
        const legacy = perf && perf.navigation ? perf.navigation.type : null;
        return legacy === 1 ? 'reload' : legacy === 2 ? 'back_forward' : 'navigate';
    } catch {
        return 'navigate';
    }
}

/** Whether the page restores the autosave by itself. */
export function shouldAutoRestore({ mode, navigation, unfinished = false }) {
    const m = autoRestoreMode(mode);
    if (unfinished || m === 'never') return false;
    if (m === 'always') return true;
    return navigation === 'reload' || navigation === 'back_forward';
}

/** A short hash of a string (FNV-1a, 32 bits, hex). */
export function hashString(s) {
    let h = 0x811c9dc5;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/**
 * What makes two sessions the same view: the dataset and the view (layout,
 * subset, focus), not when or by which page or version it was saved.
 */
export function sessionFingerprint(session) {
    if (!session || typeof session !== 'object') return '';
    const view = session.view && typeof session.view === 'object' ? { ...session.view } : null;
    if (view) delete view.annzarro;
    return hashString(JSON.stringify({ d: session.dataset || null, v: view, p: view ? null : session.panelConfigs || null }));
}

/** Ids of the panels a session has open (its layout's tiles). */
export function openPanelIds(session) {
    const out = [];
    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (node.type === 'tile' && node.id) out.push(node.id);
        if (Array.isArray(node.children)) node.children.forEach(walk);
    };
    const layout = session && session.view && session.view.layout;
    if (layout) walk(layout.hierarchy);
    else if (session && session.panelConfigs) {
        Object.values(session.panelConfigs).forEach(p => {
            if (p && !p.isSelectionTile && (!p.config || p.config.active !== false)) out.push(p.id);
        });
    }
    return out;
}

export function panelCount(session) {
    return openPanelIds(session).length;
}

function savedAt(session) {
    const t = Date.parse(session && session.timestamp);
    return Number.isFinite(t) ? t : 0;
}

/** The key a listed session is restored and deleted by: its page, or 'autosave' for one saved before pages had ids. */
export function sessionKey(session) {
    return (session && session.page) || 'autosave';
}

/**
 * The history after `session` (the autosave another page is replacing) is
 * kept: newest first, one entry per page and per view, at most `cap`, and
 * within `maxChars` (the oldest go first). A session without panels, or
 * larger than MAX_ENTRY_CHARS, is not kept.
 * @param {Array} history
 * @param {Object} session
 * @returns {Array}
 */
export function pushHistory(history, session, { cap = MAX_SESSIONS, maxChars = MAX_HISTORY_CHARS } = {}) {
    const list = Array.isArray(history) ? history.filter(e => e && typeof e === 'object') : [];
    if (!session || !panelCount(session) || JSON.stringify(session).length > MAX_ENTRY_CHARS) return trimHistory(list, { cap, maxChars });
    const fp = sessionFingerprint(session);
    const key = sessionKey(session);
    const rest = list.filter(e => sessionKey(e) !== key && sessionFingerprint(e) !== fp);
    return trimHistory([session, ...rest], { cap, maxChars });
}

/** Newest first, at most `cap`, within `maxChars`. */
export function trimHistory(history, { cap = MAX_SESSIONS, maxChars = MAX_HISTORY_CHARS } = {}) {
    const list = [...(history || [])].sort((a, b) => savedAt(b) - savedAt(a)).slice(0, Math.max(0, cap));
    while (list.length && JSON.stringify(list).length > maxChars) list.pop();
    return list;
}

/**
 * The sessions to list, newest first: the autosave unless this page wrote it
 * (that one is what is open now, and an earlier session of the same view is
 * left out too), then the history; one per page and per view, at most
 * `cap`. Each says whether it did not finish loading.
 * @param {Object} p
 * @param {Object|null} p.autosave
 * @param {Array} p.history
 * @param {string} p.page - this page's id
 * @param {Object|null} [p.marker] - a restore marker another page left (deadMarker)
 * @param {Object|null} [p.crashed] - the crash marker the previous page left (memory-guard.js takeCrashed)
 * @returns {Array<{key: string, session: Object, savedAt: number, dataset: string, panels: number,
 *   unfinished: {reason: string}|null}>}
 */
export function lastSessionList({ autosave, history, page, marker = null, crashed = null, cap = MAX_SESSIONS }) {
    const all = [];
    const mine = !!(autosave && page && autosave.page === page);
    if (autosave && !mine && panelCount(autosave)) all.push(autosave);
    for (const e of history || []) if (e && panelCount(e)) all.push(e);
    all.sort((a, b) => savedAt(b) - savedAt(a));
    // what this page has open is not a session to go back to
    const keys = new Set(), fps = new Set(mine ? [sessionFingerprint(autosave)] : []), out = [];
    for (const s of all) {
        const key = sessionKey(s), fp = sessionFingerprint(s);
        if (keys.has(key) || fps.has(fp)) continue;
        keys.add(key); fps.add(fp);
        out.push({
            key, session: s, savedAt: savedAt(s),
            dataset: s.datasetName || (s.dataset ? String(s.dataset).split('/').filter(Boolean).pop() : '') || '',
            panels: panelCount(s),
            unfinished: unfinishedReason(s, marker, crashed)
        });
        if (out.length >= cap) break;
    }
    return out;
}

/**
 * Why `session` did not finish loading, or null: its own mark, or a marker
 * left by the page that wrote it (the restore marker, or the memory guard's
 * crash marker of a draw).
 */
export function unfinishedReason(session, marker = null, crashed = null) {
    if (!session) return null;
    if (session.unfinished && typeof session.unfinished === 'object') return session.unfinished;
    const key = sessionKey(session);
    if (marker && marker.page && marker.page === key) return { reason: marker.failed && marker.failed.length ? 'memory' : 'ended' };
    if (crashed && crashed.page && crashed.page === key) return { reason: 'ended' };
    return null;
}

/**
 * A marker another page left, if that page is gone: its own tab's previous
 * page (`previousPage`, from the tab's history entry), or one that has not
 * refreshed it for MARKER_LIVE_MS (a page that is still drawing refreshes
 * it). This page's own marker is never dead.
 */
export function deadMarker(marker, { page, previousPage = null, now = Date.now() } = {}) {
    if (!marker || typeof marker !== 'object' || !marker.page || marker.page === page) return null;
    if (previousPage && marker.page === previousPage) return marker;
    const beat = Number(marker.beat || marker.at) || 0;
    return now - beat > MARKER_LIVE_MS ? marker : null;
}

/**
 * Whether a link's view must not be drawn by itself: the restore marker
 * says that this tab's previous page (a reload after the tab ended) or a
 * page restoring the same link did not finish it.
 * @param {Object|null} marker - deadMarker()
 * @param {{previousPage: string|null, linkHash: string}} where
 */
export function linkDidNotFinish(marker, { previousPage = null, linkHash = '' } = {}) {
    if (!marker) return false;
    return (!!previousPage && marker.page === previousPage) || (!!linkHash && marker.link === linkHash);
}

/** The session with its saved subset dropped: it opens on the dataset's default subset. */
export function withDefaultSubset(session) {
    const copy = JSON.parse(JSON.stringify(session || {}));
    if (copy.view && typeof copy.view === 'object') delete copy.view.subset;
    delete copy.subset;
    return copy;
}

const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Last session (autosaved 14:32)", "Earlier session (autosaved 12 Oct, 09:05)". */
export function sessionLabel(entry, index = 0, now = new Date()) {
    const at = new Date(entry.savedAt);
    const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
    const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
    const when = sameDay ? time : `${at.getDate()} ${MONTHS[at.getMonth()]}${at.getFullYear() === now.getFullYear() ? '' : ` ${at.getFullYear()}`}, ${time}`;
    return `${index === 0 ? 'Last session' : 'Earlier session'} (autosaved ${when})`;
}

/** "tahoe_95.6M.zarr, 4 panels". */
export function sessionSummary(entry) {
    const panels = `${entry.panels} panel${entry.panels === 1 ? '' : 's'}`;
    return entry.dataset ? `${entry.dataset}, ${panels}` : panels;
}

/** The line under a session that did not finish loading. */
export function unfinishedText(unfinished) {
    if (!unfinished) return '';
    const why = unfinished.reason === 'memory'
        ? 'a plot ran out of browser memory while it was drawn'
        : 'the tab ended while it was drawn (most likely out of memory)';
    return `Did not finish loading: ${why}. Restore it with the default subset to draw fewer cells.`;
}
