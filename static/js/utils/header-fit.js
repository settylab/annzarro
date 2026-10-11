/**
 * Keep the dataset name in the header whole and short.
 *
 * The dataset column takes the header's free width (CSS), so the box is as
 * wide as its name needs. When even that leaves the name on more than two
 * lines, the dataset group moves to its own row above the focus pickers and
 * buttons (class `dataset-stacked` on the header) instead of wrapping into a
 * tall narrow column. A name that fits keeps the one-row header.
 *
 * The decision is made from the rendered name each time: the class is taken
 * off, the lines the name occupies are counted, and it is put back only when
 * they are over MAX_LINES, or when the one row is wider than the window (the
 * focus pickers keep a minimum width that shows a gene or cell name whole, so a
 * cramped row overflows rather than cutting them). The outcome depends on
 * nothing but the window and the name, so it cannot flip back and forth.
 */
export const MAX_LINES = 2;
export const STACKED_CLASS = 'dataset-stacked';

/** Lines the dataset name occupies in the closed box (0 when there is none). */
export function nameLines(header) {
    const name = header.querySelector('#dataset-selector + .select2-container .dataset-name');
    if (!name) return 0;
    const rects = [...name.getClientRects()].filter(r => r.width > 0);
    // inline fragments of one line share a top; count distinct tops
    return new Set(rects.map(r => Math.round(r.top))).size;
}

/** Whether the header's one row of controls is wider than the room it has. */
export function rowOverflows(header) {
    const row = header.querySelector('.global-controls > .row');
    return !!row && row.scrollWidth > row.clientWidth + 1;
}

export function fitDatasetHeader(header) {
    if (!header) return;
    header.classList.remove(STACKED_CLASS);
    if (nameLines(header) > MAX_LINES || rowOverflows(header)) header.classList.add(STACKED_CLASS);
}

/** Refit on resize, and when the box or the header's size or text changes. */
export function installDatasetHeaderFit(header = document.getElementById('app-header')) {
    if (!header) return;
    let queued = false;
    const refit = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; fitDatasetHeader(header); });
    };
    window.addEventListener('resize', refit);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(refit).observe(header);
    const pick = header.querySelector('.dataset-pick');
    if (pick && typeof MutationObserver !== 'undefined') {
        new MutationObserver(refit).observe(pick, { childList: true, subtree: true, characterData: true });
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
    refit();
}
