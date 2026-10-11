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

export const FOCUS_INPUT_IDS = ['focused-gene', 'focused-cell'];
export const FOCUS_INPUT_MAX = 420;

/**
 * The focused gene and cell inputs show their value whole: they grow with it
 * (CSS field-sizing, or here by measuring where that is unsupported) up to
 * FOCUS_INPUT_MAX px. A value still longer is whole in the tooltip, and an
 * input that is not being edited shows its end, where a barcode differs.
 */
export function fitFocusInput(input) {
    if (!input) return;
    if (!(window.CSS && CSS.supports && CSS.supports('field-sizing', 'content'))) {
        const style = getComputedStyle(input);
        const canvas = fitFocusInput._canvas || (fitFocusInput._canvas = document.createElement('canvas'));
        const ctx = canvas.getContext('2d');
        ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const extra = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
            + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) + 4;
        const want = Math.ceil(ctx.measureText(input.value || input.placeholder || '').width + extra);
        const min = parseFloat(style.minWidth) || 0;
        input.style.width = `${Math.min(FOCUS_INPUT_MAX, Math.max(min, want))}px`;
    }
    const cut = input.scrollWidth > input.clientWidth + 1;
    if (cut) input.title = input.value; else input.removeAttribute('title');
    if (cut && document.activeElement !== input) input.scrollLeft = input.scrollWidth;
    else if (!cut) input.scrollLeft = 0;
}

/** Keep the focus inputs fitted as their value changes (typed, or set by the picker). */
function installFocusInputFit(refit) {
    for (const id of FOCUS_INPUT_IDS) {
        const input = document.getElementById(id);
        if (!input) continue;
        const run = () => { fitFocusInput(input); refit(); };
        // a value set from code fires no event: watch the property
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        Object.defineProperty(input, 'value', {
            configurable: true,
            get() { return desc.get.call(this); },
            set(v) { desc.set.call(this, v); requestAnimationFrame(run); }
        });
        for (const type of ['input', 'change', 'blur', 'focus']) input.addEventListener(type, () => requestAnimationFrame(run));
        run();
    }
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
    installFocusInputFit(refit);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(refit).observe(header);
    const pick = header.querySelector('.dataset-pick');
    if (pick && typeof MutationObserver !== 'undefined') {
        new MutationObserver(refit).observe(pick, { childList: true, subtree: true, characterData: true });
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
    refit();
}
