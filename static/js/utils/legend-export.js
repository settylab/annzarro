/**
 * An exported image holds the whole legend.
 *
 * On screen Plotly keeps a legend no taller than the plot (half the graph for a legend above or below
 * it): the rest sits in a clipped box that scrolls. An image has no scrolling, so a long legend lost
 * its end. The export takes the clip and the scroll bar off the legend and, where the legend now runs
 * past the bottom of the image, makes the image taller (the plot keeps its size). A legend that fit is
 * left alone.
 *
 * `extraHeight` and `translateY` are pure; annzarro/tests/js/legend-export.test.mjs runs them in Node.
 */

/** Px of room left under a legend that was taller than the plot. */
export const LEGEND_PAD = 8;

/** The y of a `translate(x,y)` attribute, 0 when there is none. */
export function translateY(transform) {
    const m = /translate\(\s*(-?[\d.eE+-]+)[ ,]+(-?[\d.eE+-]+)/.exec(String(transform || ''));
    return m ? parseFloat(m[2]) : 0;
}

/** Px the image must grow so a legend at `top` with `height` ends inside it, with a margin; 0 if it already does. */
export function extraHeight(imageHeight, top, height, pad = LEGEND_PAD) {
    const need = Math.ceil(top + height + pad - imageHeight);
    return Number.isFinite(need) && need > 0 ? need : 0;
}

/** The drawn legends of a layout: `legend`, `legend2`, ... (a legend in columns is one legend per column). */
function legendsOf(fullLayout) {
    const out = [];
    for (let i = 1; fullLayout && fullLayout[i === 1 ? 'legend' : `legend${i}`]; i++) {
        out.push([i === 1 ? 'legend' : `legend${i}`, fullLayout[i === 1 ? 'legend' : `legend${i}`]]);
    }
    return out;
}

/** Whether Plotly shows only part of a legend of a drawn graph. */
export function legendIsClipped(fullLayout) {
    return !!fullLayout && fullLayout.showlegend !== false
        && legendsOf(fullLayout).some(([, lg]) => lg._height > (lg._effHeight ?? lg._height) + 0.5);
}

/**
 * Show the whole legend in an SVG of `fullLayout`'s graph (an element, edited in place).
 * @returns {number} px the image grew by (the SVG's height and viewBox are already updated), 0 if nothing changed
 */
export function unclipLegend(svg, fullLayout) {
    if (!svg || !legendIsClipped(fullLayout)) return 0;
    let extra = 0;
    const height = parseFloat(svg.getAttribute('height')) || fullLayout.height;
    for (const [id, lg] of legendsOf(fullLayout)) {
        const box = svg.querySelector(`g.${id}`);
        if (!box) continue;
        const scroll = box.querySelector('.scrollbox');
        if (scroll) { scroll.removeAttribute('clip-path'); scroll.setAttribute('transform', ''); }
        box.querySelectorAll('.scrollbar').forEach(n => n.remove());
        const bg = box.querySelector('rect.bg');
        if (bg) bg.setAttribute('height', String(lg._height));
        extra = Math.max(extra, extraHeight(height, translateY(box.getAttribute('transform')), lg._height));
    }
    if (extra) {
        const grown = height + extra;
        svg.setAttribute('height', String(grown));
        const vb = (svg.getAttribute('viewBox') || '').split(/[ ,]+/).map(Number);
        if (vb.length === 4 && vb.every(Number.isFinite)) svg.setAttribute('viewBox', `${vb[0]} ${vb[1]} ${vb[2]} ${vb[3] + extra}`);
        // the white behind the plot (the snapshot's own rect) grows with it
        const back = svg.querySelector(':scope > rect[fill][width][height]');
        if (back && parseFloat(back.getAttribute('height')) === height) back.setAttribute('height', String(grown));
    }
    return extra;
}
