/**
 * The app's colour theme: System (follow prefers-color-scheme, live), Light or
 * Dark. The choice is kept per browser in localStorage; the resolved theme is
 * <html data-theme="light|dark">, which static/css/theme.css styles. The
 * attribute is first set before the CSS paints by static/js/theme-init.js (the
 * same rule, without modules); this module keeps it current and tells the plots.
 *
 * `annzarro:themechange` is dispatched on window with detail {mode, theme}
 * whenever the resolved theme or the mode changes.
 */

export const THEME_KEY = 'annzarro-theme';
export const THEME_MODES = Object.freeze(['system', 'light', 'dark']);
export const THEME_EVENT = 'annzarro:themechange';

/** A stored value as a mode; anything unknown is System. */
export function normalizeMode(value) {
    return value === 'light' || value === 'dark' ? value : 'system';
}

/** The theme a mode gives when the system prefers dark (or not). */
export function resolveTheme(mode, systemDark) {
    const m = normalizeMode(mode);
    return m === 'dark' || (m === 'system' && !!systemDark) ? 'dark' : 'light';
}

/** The stored mode; System when nothing is stored or storage is blocked. */
export function readMode(storage) {
    try { return normalizeMode(storage && storage.getItem(THEME_KEY)); } catch { return 'system'; }
}

/** Remember a mode (System forgets the choice); false when storage is blocked. */
export function saveMode(storage, mode) {
    try {
        if (normalizeMode(mode) === 'system') storage.removeItem(THEME_KEY);
        else storage.setItem(THEME_KEY, mode);
        return true;
    } catch { return false; }
}

/** The theme on screen now: the document's data-theme (light when unset). */
export function currentTheme(doc = globalThis.document) {
    const root = doc && doc.documentElement;
    return root && root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** The mode on screen now (System when unset). */
export function currentMode(doc = globalThis.document) {
    const root = doc && doc.documentElement;
    return normalizeMode(root && root.getAttribute('data-theme-mode'));
}

function systemQuery(win) {
    return win && typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-color-scheme: dark)') : null;
}

/**
 * Keep the document's theme current: the stored choice now, and the system
 * setting while the mode is System. Returns {mode, theme, setMode(mode)}.
 * @param {Object} [env] {window, document, storage}, injectable for tests
 */
export function startTheme(env = {}) {
    const win = env.window || globalThis.window;
    const doc = env.document || (win && win.document);
    const storage = 'storage' in env ? env.storage : (() => { try { return win.localStorage; } catch { return null; } })();
    const query = systemQuery(win);
    let mode = readMode(storage);
    let theme = doc.documentElement.getAttribute('data-theme');     // set before first paint by theme-init.js

    const apply = () => {
        const next = resolveTheme(mode, !!(query && query.matches));
        const changedMode = doc.documentElement.getAttribute('data-theme-mode') !== mode;
        const changed = next !== theme || changedMode;
        theme = next;
        const root = doc.documentElement;
        if (root.getAttribute('data-theme') !== next) root.setAttribute('data-theme', next);   // no rewrite of what is already right
        if (changedMode) root.setAttribute('data-theme-mode', mode);
        if (changed && win && typeof win.dispatchEvent === 'function' && typeof win.CustomEvent === 'function') {
            win.dispatchEvent(new win.CustomEvent(THEME_EVENT, { detail: { mode, theme: next } }));
        }
    };
    if (query) {
        const onSystem = () => { if (mode === 'system') apply(); };
        if (typeof query.addEventListener === 'function') query.addEventListener('change', onSystem);
        else if (typeof query.addListener === 'function') query.addListener(onSystem);
    }
    apply();
    return {
        get mode() { return mode; },
        get theme() { return theme; },
        setMode(next) {
            mode = normalizeMode(next);
            saveMode(storage, mode);
            apply();
        }
    };
}
