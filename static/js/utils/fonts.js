/**
 * The fonts of the plots. Open Sans is the default (bundled, static/fonts/open-sans/NOTICE.md, loaded by static/css/fonts.css);
 * Arial is what the Publication preset sets, and what a plot saved before Open Sans was the default drew.
 *
 * - `FONT_CHOICES`: the one font list every plot's Plot Options offers, in this order.
 * - `legacyFont(config)`: a Cell, Gene or Cell-Gene plot read from a link, a session or a panel set with no stored font drew in
 *   Arial, so Arial is written into it (a plot made from the chooser, on Default, has none and gets the default).
 * - `embedFonts(svg)`: an image (SVG or PNG) is made from SVG text, which cannot see the page's web fonts, so the font is put in
 *   the SVG itself as a data URL once the page's fonts are loaded.
 *
 * The pure parts run in Node (annzarro/tests/js/fonts.test.mjs).
 */
export const DEFAULT_FONT = '"Open Sans", verdana, arial, sans-serif';
export const ARIAL = 'Arial, Helvetica, sans-serif';

/** [css value, label] in the order every Plot Options shows. */
export const FONT_CHOICES = Object.freeze([
    [DEFAULT_FONT, 'Open Sans'],
    [ARIAL, 'Arial'],
    ["'Times New Roman', Times, serif", 'Times New Roman'],
    ['Courier, monospace', 'Courier'],
    ['Georgia, serif', 'Georgia'],
    ["'Trebuchet MS', sans-serif", 'Trebuchet MS'],
    ['Verdana, sans-serif', 'Verdana']
]);

/**
 * `settings` of a Cell Plot or Gene Plot (a flat object: their plots keep their font stored, so none stored means saved before
 * Open Sans was the default) or the configuration of a Cell-Gene Plot (`nested`: `look.fontFamily`, absent when it is the
 * default, so `fontModel: 2` says it was saved with Open Sans the default). Arial is written into one with no font that is not on
 * Default (a plot from the chooser is). Changes the object it is given; returns it.
 * @param {Object} config
 * @param {boolean} [nested]
 */
export function legacyFont(config, nested = false) {
    if (!config || typeof config !== 'object') return config;
    if (nested) {
        if (config.fontModel === undefined && config.styleDefault !== true) {
            const look = config.look && typeof config.look === 'object' ? config.look : {};
            if (look.fontFamily === undefined || look.fontFamily === null) config.look = { ...look, fontFamily: ARIAL };
        }
        if (config.fontModel === undefined) config.fontModel = FONT_MODEL;
    } else if (config.styleDefault !== true && (config.fontFamily === undefined || config.fontFamily === null)) config.fontFamily = ARIAL;
    return config;
}

/** Cell-Gene configurations written since Open Sans became the default carry this. */
// export-unused-ok: the Node test reads it
export const FONT_MODEL = 2;

const FILE = 'static/fonts/open-sans/OpenSans-latin-greek.woff2';
let _face = null;

/** The @font-face rule that holds the font as a data URL (made once). */
async function fontFace() {
    if (_face) return _face;
    const { appUrl } = await import('./app-url.js');
    const res = await fetch(appUrl(FILE));
    if (!res.ok) throw new Error(`font file ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    _face = `@font-face{font-family:"Open Sans";font-style:normal;font-weight:400 700;src:url(data:font/woff2;base64,${btoa(bin)}) format("woff2");}`;
    return _face;
}

/** The page's fonts are loaded (the plot is measured and drawn with them). */
export async function fontsReady() {
    if (typeof document === 'undefined' || !document.fonts) return;
    try {
        await document.fonts.load('12px "Open Sans"');
        await document.fonts.ready;
    } catch { /* a font that did not load is the fallback's */ }
}

/** SVG text with the font in it when it names Open Sans; otherwise as it came. */
export async function embedFonts(svg) {
    if (typeof svg !== 'string' || !svg.includes('Open Sans')) return svg;
    await fontsReady();
    let css;
    try { css = await fontFace(); } catch (err) { console.warn('Open Sans not embedded:', err && err.message); return svg; }
    return svg.replace(/(<svg\b[^>]*>)/, `$1<defs><style type="text/css">${css}</style></defs>`);
}
