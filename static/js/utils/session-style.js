/**
 * The session's default plot style: "Use as default for new plots" in Plot
 * Options (Apply to other panels) keeps the look of a plot here, and a plot
 * created afterwards without a look of its own starts from it instead of the
 * built-in one.
 *
 * "Look" is exactly what Apply to other panels copies (STYLE_KEYS in
 * panels/plot-utilities/plot-options.js): colours, axes, ticks, text, margins,
 * legend, colour bar, scale bar, Not in table, the focused marker and the
 * export size; never what a plot shows (axes, colour-by, subset).
 *
 * One default per plot kind, as Apply to other panels copies within a kind:
 * a cell plot's look is not a gene plot's.
 *
 * It lives in this page's memory and travels with the session: the autosave
 * and a saved panel set carry it (session-manager.js), so a reload or
 * a panel set opened with its panels restores it. A plot that has its own look
 * (restored from a link, a panel set or the autosave, or a Duplicate) never
 * takes it: only a plot a person just made from the chooser does, and only
 * for the options the plot leaves unset. No DOM here, so
 * annzarro/tests/js/session-style.test.mjs runs it in Node.
 */
import { STYLE_KEYS, pickStyle } from '../panels/plot-utilities/plot-options.js';
import { COLOUR_MODEL } from './plot-theme.js';

/** The panel types that have a session default, and how the menu names them. */
export const STYLE_TYPES = Object.freeze({ 'cell-plot': 'cell', 'gene-plot': 'gene' });

const copy = (v) => JSON.parse(JSON.stringify(v));

let _styles = {};
const _listeners = new Set();

function changed() {
    for (const fn of _listeners) {
        try { fn(); } catch (e) { console.error('Session style listener failed:', e); }
    }
}

/** Call `fn` whenever the session default is set or reset by the person. Returns the unsubscribe. */
export function onSessionStyleChange(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}

/**
 * A stored default made safe: only the known types, only the style keys, plain values.
 * Anything else (an old or a hand-edited file) is dropped. Returns {} for no default.
 */
export function cleanSessionStyles(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const type of Object.keys(STYLE_TYPES)) {
        const style = raw[type];
        if (!style || typeof style !== 'object' || Array.isArray(style)) continue;
        const kept = {};
        for (const k of STYLE_KEYS) if (k in style) kept[k] = copy(style[k]);
        if (Object.keys(kept).length) out[type] = kept;
    }
    return out;
}

/** The default of `type` as a copy, or null. */
export function sessionStyle(type) {
    return _styles[type] ? copy(_styles[type]) : null;
}

export function hasSessionStyle(type) {
    return !!_styles[type];
}

/** Make the look of `settings` the default for new plots of `type`. */
export function setSessionStyle(type, settings) {
    if (!(type in STYLE_TYPES)) return false;
    _styles = { ..._styles, [type]: pickStyle(settings) };
    changed();
    return true;
}

/** Back to the built-in look: for `type`, or for every type. */
export function clearSessionStyle(type = null) {
    const had = type ? hasSessionStyle(type) : Object.keys(_styles).length > 0;
    if (!had) return;
    _styles = type ? Object.fromEntries(Object.entries(_styles).filter(([t]) => t !== type)) : {};
    changed();
}

/**
 * Replace the whole default with a stored one (a panel set, the autosave). Silent: it is
 * a load, and the autosave a change would trigger must not run before the panels are back.
 */
export function replaceSessionStyles(raw) {
    _styles = cleanSessionStyles(raw);
}

/** What a panel set or the autosave stores: the default, or undefined when none is set. */
export function storableSessionStyles() {
    return Object.keys(_styles).length ? copy(_styles) : undefined;
}

/**
 * The config of a new plot with the session default filled in: every option the
 * default sets and `config` leaves undefined. Set options stay as they are.
 * A default's unset option (null: follows the theme, or the built-in) fills nothing.
 * The config is not changed; without a default it is returned as it is.
 */
export function withSessionStyle(type, config = {}) {
    const style = _styles[type];
    if (!style) return config;
    const out = { ...config };
    let filled = false;
    for (const k of STYLE_KEYS) {
        if (out[k] !== undefined || style[k] === undefined || style[k] === null) continue;
        out[k] = copy(style[k]);
        filled = true;
    }
    // the colours set are the person's; the ones left unset follow the app theme, not an old light default
    if (filled && out.colourModel === undefined) out.colourModel = COLOUR_MODEL;
    return out;
}

/** The tab's own copy, which a reload of the tab reads back (the autosave is shared by every tab). */
export const STORAGE_KEY = 'annzarro_session_style';

/** Write the default to `storage` (sessionStorage), or remove it when none is set. */
export function saveSessionStylesTo(storage) {
    try {
        const stored = storableSessionStyles();
        if (stored) storage.setItem(STORAGE_KEY, JSON.stringify(stored));
        else storage.removeItem(STORAGE_KEY);
    } catch { /* storage blocked or full: the default lasts as long as the page */ }
}

/** Read the default back from `storage`; what is there that is not a default is ignored. */
export function loadSessionStylesFrom(storage) {
    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw) _styles = cleanSessionStyles(JSON.parse(raw));
    } catch { /* storage blocked or not JSON */ }
}
