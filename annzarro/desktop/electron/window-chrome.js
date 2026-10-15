/**
 * The desktop window's frame, as pure functions (no Electron) so
 * annzarro/tests/js/desktop-frame.test.mjs can test them.
 *
 * macOS and Windows have no native title bar: the AnnZarro header is the
 * title bar. macOS floats the traffic lights over the top left of
 * the header; Windows draws minimise / maximise / close over the top right
 * (titleBarOverlay), in the colours of the header. Linux keeps the native frame.
 * static/css/desktop-frame.css makes room for them and sets the drag region.
 */
'use strict';

// How far down the traffic lights reach (the title below them starts lower), and the
// height of the Windows overlay, which the panel set buttons clear. The header keeps its
// height; static/css/desktop-frame.css uses the same numbers.
const MAC_LIGHTS_BOTTOM_PX = 24;
const WIN_OVERLAY_HEIGHT_PX = 32;
const TRAFFIC_LIGHTS = { x: 14, y: 8 };

// What <html data-desktop-frame> says: 'mac', 'win', or null (a native frame).
function frameFlag(platform) {
    if (platform === 'darwin') return 'mac';
    if (platform === 'win32') return 'win';
    return null;
}

// The title bar colours before the page has told its own: those of loading.html / error.html.
function pageOverlay(dark) {
    return dark
        ? { color: '#14171a', symbolColor: '#e6e9ec' }
        : { color: '#f5f5f5', symbolColor: '#333333' };
}

// BrowserWindow options for the frame of `platform`.
function frameOptions(platform, dark) {
    const flag = frameFlag(platform);
    if (flag === 'mac') {
        return { titleBarStyle: 'hidden', trafficLightPosition: { ...TRAFFIC_LIGHTS } };
    }
    if (flag === 'win') {
        return { titleBarStyle: 'hidden', titleBarOverlay: { ...pageOverlay(dark), height: WIN_OVERLAY_HEIGHT_PX } };
    }
    return {};
}

// The preload reads the flag from the page's own process arguments.
const FRAME_ARG = '--annzarro-frame=';
function frameArguments(platform) {
    const flag = frameFlag(platform);
    return flag ? [FRAME_ARG + flag] : [];
}

// A colour the page sends for the title bar overlay: #rgb or #rrggbb only, as #rrggbb.
function sanitizeColor(value) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value || '').trim());
    if (!m) return null;
    const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    return '#' + hex.toLowerCase();
}

// {color, symbolColor} for setTitleBarOverlay, or null if either is not a colour.
function sanitizeOverlay(input) {
    const color = sanitizeColor(input && input.color);
    const symbolColor = sanitizeColor(input && input.symbolColor);
    return color && symbolColor ? { color, symbolColor } : null;
}

module.exports = {
    MAC_LIGHTS_BOTTOM_PX,
    WIN_OVERLAY_HEIGHT_PX,
    FRAME_ARG,
    frameFlag,
    pageOverlay,
    frameOptions,
    frameArguments,
    sanitizeColor,
    sanitizeOverlay,
};
