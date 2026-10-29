/**
 * Copy the view with the hover text; paste it onto a panel. The clipboard side of
 * utils/view-descriptor.js (what a view is and how it is matched).
 *
 * Pressing C over a point (utils/hover-copy.js) puts the hover text on the clipboard as `text/plain`,
 * as ever, and next to it the view descriptor as the custom type VIEW_MIME, set by a `copy` event
 * handler (clipboard.js legacyCopy), which works on plain http too. The JSON is never put in
 * `text/plain`. Pasting (main.js) over a panel applies it there where the coordinates exist.
 */
import { buildViewDescriptor, parseView } from './view-descriptor.js';

export const VIEW_MIME = 'application/x-annzarro-view+json';

/**
 * The descriptor on a paste's clipboard: the custom type, else the `data-annzarro-view`
 * attribute of the HTML flavour (a browser that drops custom types).
 * @param {DataTransfer|null} data
 */
export function readView(data) {
    if (!data || typeof data.getData !== 'function') return null;
    let v = null;
    try { v = parseView(data.getData(VIEW_MIME)); } catch { /* none */ }
    if (v) return v;
    try {
        const html = data.getData('text/html');
        const m = html && /data-annzarro-view="([^"]*)"/.exec(html);
        if (m) {
            const raw = m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
            return parseView(raw);
        }
    } catch { /* none */ }
    return null;
}

/** The HTML flavour: the hover text in a wrapper carrying the descriptor. */
export function viewHtml(text, view) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<div data-annzarro-view="${esc(JSON.stringify(view))}">${esc(text).replace(/\n/g, '<br>')}</div>`;
}

// -- page glue --

/** The hovered point's name: the first line of the hover text (the cell or the gene). */
export function entityOf(text, tileId) {
    const id = String(text || '').split('\n')[0].trim();
    if (!id) return null;
    return { kind: /^gene-plot/.test(tileId || '') ? 'gene' : 'cell', id };
}

/** The descriptor for the graph a copy was made on, or null. */
export function descriptorFor(gd, text, currentDataset = null) {
    if (!gd || !gd.__azSettings) return null;
    const tile = typeof gd.closest === 'function' ? gd.closest('.tile') : null;
    const tileId = (tile && tile.dataset && tile.dataset.tileId) || '';
    const panel = /^(cell|gene)-plot/.exec(tileId);
    return buildViewDescriptor(gd, gd.__azSettings, {
        dataset: gd.__azDrawnDataset || currentDataset,
        entity: entityOf(text, tileId),
        panel: panel ? panel[0] : null
    });
}

/**
 * Follow the pointer; the returned function gives the graph of the panel under it, or null when
 * it is over anything else (the header, a boundary, the panel chooser, empty space) or outside the page.
 * @param {Document} [doc]
 * @returns {function(): ?HTMLElement}
 */
export function trackPointerPanel(doc = document) {
    let at = null;
    doc.addEventListener('pointermove', (e) => { at = [e.clientX, e.clientY]; }, { passive: true, capture: true });
    if (doc.documentElement) doc.documentElement.addEventListener('pointerleave', () => { at = null; });
    return () => {
        if (!at) return null;
        const el = doc.elementFromPoint(at[0], at[1]);
        const tile = el && typeof el.closest === 'function' ? el.closest('.tile:not(.tile-selector)') : null;
        return tile ? tile.querySelector('.js-plotly-plot') : null;
    };
}
