/**
 * The session's default plot style: "Make this the session default" in Plot
 * Options (Apply to other panels) keeps the look of a plot here, and it
 * redefines "Default" for the session: every plot that is on Default (made
 * from the chooser, or put back by the Default preset) follows it, now and
 * when it changes, and a plot with a look of its own does not.
 *
 * "Look" is exactly what Apply to other panels copies (STYLE_KEYS in
 * panels/plot-utilities/plot-options.js): colours, axes, ticks, text, margins,
 * legend, colour bar, scale bar, Not in table, the focused marker and the
 * export size; never what a plot shows (axes, colour-by, subset).
 *
 * The default is kept as the keys that differ from the built-in look, so it
 * is small in a link; a key it does not list is the built-in value. One default
 * per plot kind, as Apply to other panels copies within a kind: a cell plot's
 * look is not a gene plot's.
 *
 * A plot says it is on Default with `styleDefault: true` in its settings; any
 * change to its look in Plot Options clears it (plot-aesthetics-menu.js), and
 * a plot saved on Default opens on Default in whatever session it opens in.
 *
 * It lives in this page's memory and travels with the session: the tab's
 * session storage keeps it over a reload (gone with the tab), and a link, the
 * autosave and a saved panel set carry it in their view (`sessionStyles`).
 * No DOM here, so annzarro/tests/js/session-style.test.mjs runs it in Node.
 */
import { STYLE_KEYS, pickStyle } from '../panels/plot-utilities/plot-options.js';

/** The panel types that have a session default, and how the menu names them. */
export const STYLE_TYPES = Object.freeze({ 'cell-plot': 'cell', 'gene-plot': 'gene' });

const copy = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

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

/** The default of `type` as a copy (only its keys that differ from built-in), or null. */
export function sessionStyle(type) {
    return _styles[type] ? copy(_styles[type]) : null;
}

export function hasSessionStyle(type) {
    return !!_styles[type];
}

/** The style keys of `picked` whose value differs from `base` (both pickStyle results). */
export function diffStyle(picked, base) {
    const out = {};
    for (const k of STYLE_KEYS) {
        if (!same(picked[k], base[k])) out[k] = picked[k] === undefined ? null : copy(picked[k]);
    }
    return out;
}

/**
 * Make the look of `settings` the default for plots of `type`. Only what differs from
 * `base` (the built-in look, as pickStyle gives it) is kept; a look that is the built-in
 * one is no default at all and clears it. Returns whether a default is set now.
 */
export function setSessionStyle(type, settings, base = {}) {
    if (!(type in STYLE_TYPES)) return false;
    const diff = diffStyle(pickStyle(settings), base);
    const rest = Object.fromEntries(Object.entries(_styles).filter(([t]) => t !== type));
    _styles = Object.keys(diff).length ? { ...rest, [type]: diff } : rest;
    changed();
    return hasSessionStyle(type);
}

/** Back to the built-in look: for `type`, or for every type. */
export function clearSessionStyle(type = null) {
    const had = type ? hasSessionStyle(type) : Object.keys(_styles).length > 0;
    if (!had) return;
    _styles = type ? Object.fromEntries(Object.entries(_styles).filter(([t]) => t !== type)) : {};
    changed();
}

/**
 * Replace the whole default with a stored one (a link, a panel set, the autosave). Silent: it is
 * a load, and the autosave a change would trigger must not run before the panels are back.
 */
export function replaceSessionStyles(raw) {
    _styles = cleanSessionStyles(raw);
}

/** What a link, a panel set or the autosave stores: the default, or undefined when none is set. */
export function storableSessionStyles() {
    return Object.keys(_styles).length ? copy(_styles) : undefined;
}

/**
 * The look plots of `type` that are on Default have: `base` (the built-in look, as pickStyle gives it)
 * with the session default's keys on top. A key the default sets to null is unset.
 */
export function effectiveStyle(type, base) {
    const out = { ...base };
    const style = _styles[type];
    if (style) for (const k of Object.keys(style)) out[k] = copy(style[k]);
    return out;
}

/** The config of a plot of `type` made from the chooser: on Default, so it follows the session default. */
export function onDefault(type, config = {}) {
    return type in STYLE_TYPES ? { ...config, styleDefault: true } : config;
}

/**
 * What a view (a link, a panel set, the autosave) does to the session default when it opens with
 * its panels: its own `sessionStyles` replace the current default; with none, a view that has
 * plots on Default clears it, so they look built-in as they did for the sender; a view with no
 * plot on Default (every view from before this existed) leaves it alone.
 * @returns {{styles: Object}|null} the default to set ({} for none), or null to leave it
 */
export function viewStyleChange(view) {
    if (!view || typeof view !== 'object') return null;
    const styles = cleanSessionStyles(view.sessionStyles);
    if (Object.keys(styles).length) return { styles };
    const configs = [
        ...Object.values((view.layout && view.layout.panelConfigs) || {}),
        ...(Array.isArray(view.panels) ? view.panels.map(p => p && p.config) : [])
    ];
    return configs.some(c => c && c.styleDefault === true) ? { styles: {} } : null;
}

/**
 * Whether a panel set is only a style: it brings a default style and opens no panel (saved with none, or with
 * none open). Loading it applies the style and leaves everything open as it is.
 */
export function isStyleOnly(set) {
    if (!set || typeof set !== 'object') return false;
    if (!Object.keys(cleanSessionStyles(set.view && set.view.sessionStyles)).length) return false;
    const layout = set.view && set.view.layout;
    const tiles = JSON.stringify((layout && layout.hierarchy) || []).includes('"type":"tile"');
    return set.styleOnly === true || !tiles;
}

/** What a panel set's card says about its style: the kinds it brings and whether it is only a style; null for none. */
export function styleSummary(set) {
    const styles = cleanSessionStyles(set && set.view && set.view.sessionStyles);
    const kinds = Object.keys(styles).map(t => STYLE_TYPES[t]);
    if (!kinds.length) return null;
    return { kinds, only: isStyleOnly(set) };
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
