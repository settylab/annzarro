/**
 * Long axis and colour-bar titles fit their plot; the full text shows on hover.
 *
 * Titles name their source in full ("obsp.diffusion_walk_t5.HSPC_Old_1#
 * GAAGCCCGTGGCTCTG-1"), which ran past the plot: off the top of a half-height
 * tile's colour bar, over the neighbouring tile's edge on the x axis. After
 * every draw, a title longer than the side it labels is shortened in the
 * middle (both the source and the entity stay recognisable) and gets an SVG
 * <title>, which the browser shows as a tooltip. The layout keeps the full
 * text, so exports and deep links are unchanged.
 */

/**
 * Shorten `text` in the middle with an ellipsis until `fits(candidate)`.
 * @param {string} text
 * @param {(s: string) => boolean} fits
 * @returns {string} text itself if it fits, else the longest fitting
 *   head + '…' + tail (at least one character each side when possible)
 */
export function middleEllipsis(text, fits) {
    if (fits(text)) return text;
    const chars = Array.from(text);
    let lo = 1, hi = chars.length - 1, best = '…';
    while (lo <= hi) {
        const keep = Math.floor((lo + hi) / 2);
        const head = Math.ceil(keep / 2), tail = Math.floor(keep / 2);
        const candidate = chars.slice(0, head).join('') + '…' + (tail ? chars.slice(-tail).join('') : '');
        if (fits(candidate)) { best = candidate; lo = keep + 1; } else { hi = keep - 1; }
    }
    return best;
}

/**
 * The colour bar's (and categorical legend's) title for a colour source
 * {type, key, column}. It was the raw key ("obsp.chemical_synapses.AVA");
 * the source type is dropped and the column says what it is:
 *   obs/var        total_counts
 *   obsm/varm      X_pca · 3
 *   obsp/varp      chemical_synapses · row AVA   (the focused entity's row)
 *   layer          counts · Gata1
 * @param {{type?: string, key?: string, column?: string}} color
 * @returns {string}
 */
export function colourTitle(color) {
    if (!color || !color.key) return '';
    const { type, key, column } = color;
    if (!column) return key;
    return type === 'obsp' || type === 'varp' ? `${key} · row ${column}` : `${key} · ${column}`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function _fit(textEl, available) {
    if (!textEl || !(available > 0) || typeof textEl.getComputedTextLength !== 'function') return;
    const oldTip = textEl.querySelector('title');
    if (oldTip) oldTip.remove();
    // Still our shortened text: fit the full one again. Otherwise Plotly has
    // redrawn the title (new text), so that is the full text now.
    const full = textEl.__fullTitle && textEl.textContent === textEl.__shownTitle
        ? textEl.__fullTitle : textEl.textContent;
    if (!full) return;
    textEl.textContent = full;
    const shown = middleEllipsis(full, (s) => {
        textEl.textContent = s;
        return textEl.getComputedTextLength() <= available;
    });
    textEl.textContent = shown;
    textEl.__fullTitle = full;
    textEl.__shownTitle = shown;
    if (shown !== full) {
        const tip = textEl.ownerDocument.createElementNS(SVG_NS, 'title');
        tip.textContent = full;
        textEl.appendChild(tip);
        textEl.style.pointerEvents = 'all';
    }
}

/**
 * Fit the x, y and colour-bar titles of one Plotly graph div.
 * @param {HTMLElement} gd
 */
export function fitPlotTitles(gd) {
    const size = gd && gd._fullLayout && gd._fullLayout._size;
    if (!size) return;
    _fit(gd.querySelector('.g-xtitle text'), size.w);
    _fit(gd.querySelector('.g-ytitle text'), size.h);
    gd.querySelectorAll('.colorbar').forEach(cb => {
        const title = cb.querySelector('.cbtitle text');
        const bar = cb.querySelector('.cbbg') || cb.querySelector('.cbfills');
        const len = bar && bar.getBoundingClientRect ? bar.getBoundingClientRect().height : 0;
        // vertical bars carry a rotated title along their length
        _fit(title, len || size.h);
    });
}

/**
 * Keep a graph's titles fitted across redraws, relayouts and resizes.
 * Safe to call more than once per graph div.
 * @param {HTMLElement} gd
 */
export function keepTitlesFitted(gd) {
    if (!gd || gd.__titlesFitted || typeof gd.on !== 'function') {
        if (gd) fitPlotTitles(gd);
        return;
    }
    gd.__titlesFitted = true;
    const run = () => requestAnimationFrame(() => fitPlotTitles(gd));
    gd.on('plotly_afterplot', run);
    gd.on('plotly_relayout', run);
    gd.on('plotly_restyle', run);
    run();
}
