/**
 * How a plot's own colours follow the app theme (utils/theme.js).
 *
 * Rule: a plot follows the app theme for every colour the user has NOT set.
 * The state is explicit and small: a themed colour is either absent from the
 * panel's settings (auto: it is the theme's colour, light or dark, and changes
 * with the app theme) or a stored colour string (pinned: kept across theme
 * changes). Nothing but pinned colours is saved in a link or a panel set.
 * Choosing a colour, or a plot theme button (Light colours, Dark colours, the
 * Publication preset), pins; Follow app theme, a colour's Reset and the
 * Default preset unpin.
 *
 * Links saved before this model stored every themed colour, the light
 * defaults included, so "pinned" and "never touched" looked the same. A
 * settings object without `colourModel` is therefore migrated once: a colour
 * equal to the light default becomes auto, any other value stays pinned. This
 * is safe because the light default is exactly what the plot showed anyway:
 * in the Light theme nothing changes, and the only difference is in Dark,
 * which no old link was ever viewed in. A person who chose white deliberately
 * and shares an old link sees it follow the dark theme there; picking the
 * colour again (or Light colours) pins it for good. The one case it cannot
 * tell apart is cheap to correct, the other way round (treating a light
 * default as pinned) would leave every old link a white sheet in a dark app.
 *
 * Pure functions, no DOM except `currentTheme`, which reads <html data-theme>;
 * annzarro/tests/js/plot-theme.test.mjs runs them in Node.
 */
import { currentTheme } from './theme.js';

/** Settings written by the model above carry this; older ones do not. */
export const COLOUR_MODEL = 2;

/** The colours that follow the app theme, by their settings key. */
export const THEMED_COLOURS = Object.freeze(['bgColor', 'gridColor', 'axisColor', 'textColor', 'zeroLineColor', 'backdropColor', 'notInTableColor',
    'focusedColor', 'focusedEdgeColor']);

/** The colours the plot theme buttons set (the grey of points not in the table and the focused marker have their own controls). */
export const BUTTON_COLOURS = Object.freeze(['bgColor', 'gridColor', 'axisColor', 'textColor', 'zeroLineColor', 'backdropColor']);

export const PLOT_PALETTES = Object.freeze({
    light: Object.freeze({
        bgColor: '#ffffff', gridColor: '#e6e6e6', axisColor: '#000000', textColor: '#000000',
        zeroLineColor: '#cccccc', backdropColor: '#f0f0f0', notInTableColor: '#b4b4b4',
        focusedColor: '#ff0000', focusedEdgeColor: '#000000'
    }),
    dark: Object.freeze({
        bgColor: '#1e1e1e', gridColor: '#444444', axisColor: '#ffffff', textColor: '#ffffff',
        zeroLineColor: '#666666', backdropColor: '#121212', notInTableColor: '#6b7178',
        // the focused marker is the same red dot with a black edge in both themes
        focusedColor: '#ff0000', focusedEdgeColor: '#000000'
    })
});

const hasValue = (v) => typeof v === 'string' && v.trim() !== '';

/** '#abc' and '#AABBCC' as '#aabbcc'; anything else unchanged and lower case. */
export function normalizeHex(value) {
    const s = String(value).trim().toLowerCase();
    return /^#[0-9a-f]{3}$/.test(s) ? '#' + s.slice(1).split('').map(c => c + c).join('') : s;
}

/** Whether the colour `key` is auto (no stored colour): it follows the app theme. */
export function isFollowing(settings, key) {
    return !hasValue(settings && settings[key]);
}

/** Whether every themed colour is auto. */
export function followsTheme(settings) {
    return THEMED_COLOURS.every(k => isFollowing(settings, k));
}

/** The colour `key` shows now: the pinned one, else the theme's. */
export function plotColour(settings, key, theme = currentTheme()) {
    if (settings && hasValue(settings[key])) return settings[key];
    return PLOT_PALETTES[theme === 'dark' ? 'dark' : 'light'][key];
}

/**
 * Migrate a settings object from before the colour model (see the top of this
 * file) and mark it. Idempotent; returns the keys that became auto.
 */
export function adoptColourModel(settings) {
    const freed = [];
    if (settings.colourModel !== COLOUR_MODEL) {
        for (const key of THEMED_COLOURS) {
            if (!hasValue(settings[key])) { delete settings[key]; continue; }
            if (normalizeHex(settings[key]) === PLOT_PALETTES.light[key]) { delete settings[key]; freed.push(key); }
        }
        settings.colourModel = COLOUR_MODEL;
    }
    return freed;
}

/** Pin the plot theme buttons' colours to a palette ('light' or 'dark'). */
export function pinPalette(settings, theme) {
    const palette = PLOT_PALETTES[theme === 'dark' ? 'dark' : 'light'];
    for (const key of BUTTON_COLOURS) settings[key] = palette[key];
    settings.colourModel = COLOUR_MODEL;
}

/** Make colours auto again (all of them without `keys`); returns the keys changed. */
export function followTheme(settings, keys = THEMED_COLOURS) {
    const changed = [];
    for (const key of keys) {
        if (!isFollowing(settings, key)) changed.push(key);
        delete settings[key];
    }
    settings.colourModel = COLOUR_MODEL;
    return changed;
}

/** '#rrggbb' as 'rgba(r, g, b, a)'; a colour that is not a hex code is returned as it is. */
export function withAlpha(colour, alpha) {
    const m = /^#([0-9a-f]{6})$/.exec(normalizeHex(colour));
    if (!m) return colour;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Plotly's toolbar draws a fixed grey (invisible on a dark plot), so it takes
 * the plot's text colour: faint at rest, full when pressed or hovered.
 */
export function modebarColours(settings, theme = currentTheme()) {
    const text = plotColour(settings, 'textColor', theme);
    return { bgcolor: 'rgba(0, 0, 0, 0)', color: withAlpha(text, 0.55), activecolor: text };
}
