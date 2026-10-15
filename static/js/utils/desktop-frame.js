/**
 * Windows desktop app: the window controls (minimise, maximise, close) are drawn by the
 * system over the top right of the header (titleBarOverlay). Their colours are the header's
 * own, from the theme (static/css/theme.css), and follow a change of theme.
 *
 * Only the Windows frame needs this: macOS draws its buttons itself. The preload tells the
 * page which frame it has (<html data-desktop-frame>, see desktop-frame.css).
 */
import { THEME_EVENT } from './theme.js';

/**
 * A computed CSS colour ("rgb(1, 2, 3)", "rgba(1, 2, 3, 1)") as "#rrggbb"; null if it is not
 * an opaque rgb colour (the overlay cannot be transparent).
 * @param {string} css
 */
export function cssColorToHex(css) {
    const m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(String(css || '').trim());
    if (!m) return null;
    if (m[4] !== undefined) {
        const alpha = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        if (!(alpha >= 1)) return null;
    }
    const channels = [m[1], m[2], m[3]].map(Number);
    if (channels.some((c) => c > 255)) return null;
    return '#' + channels.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/**
 * The overlay's colours from the header's computed style: its background, and its text
 * colour for the buttons' symbols. Null if either is not usable.
 * @param {{backgroundColor: string, color: string}} style
 */
export function overlayColors(style) {
    const color = cssColorToHex(style.backgroundColor);
    const symbolColor = cssColorToHex(style.color);
    return color && symbolColor ? { color, symbolColor } : null;
}

/**
 * Keep the Windows window controls in the header's colours. A no-op elsewhere.
 * @returns {boolean} whether it is active
 */
export function startDesktopFrame(win = window) {
    const root = win.document.documentElement;
    const api = win.api;
    if (root.getAttribute('data-desktop-frame') !== 'win' || !api || typeof api.setTitleBarOverlay !== 'function') {
        return false;
    }
    const sync = () => {
        const header = win.document.getElementById('app-header');
        if (!header) return;
        const colors = overlayColors(win.getComputedStyle(header));
        if (colors) api.setTitleBarOverlay(colors);
    };
    sync();
    // The theme attribute changes first; the next frame has the new colours computed.
    win.addEventListener(THEME_EVENT, () => win.requestAnimationFrame(sync));
    return true;
}
