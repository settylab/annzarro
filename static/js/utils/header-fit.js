/**
 * The header is one row that gives way step by step, measured (not by
 * breakpoint), only as far as it has to for everything to fit:
 *
 *   1. everything at its natural width, the buttons with their labels;
 *   2. `actions-compact`: the buttons keep their icons (the label is the tooltip);
 *   3. `focus-tight`: the focused gene and cell columns give up as much width as
 *      the row is still short of, down to the minimum that shows an Ensembl ID or
 *      a barcode (a longer value is whole in the tooltip, its end shown);
 *   4. `header-wrapped`: the buttons take a row of their own under the focus
 *      inputs, which keep the tight layout.
 *
 * The dataset is not in the header: it is the button at the left of the dataset
 * bar under it (utils/dataset-button.js), so the header has no widest, most
 * variable column to make room for.
 *
 * Each step is tried with the earlier ones kept and the first that leaves the
 * row without overflow is the layout, so the outcome depends on nothing but
 * the window and the content and cannot flip back and forth.
 */
export const STEPS = ['actions-compact', 'focus-tight'];
export const WRAPPED_CLASS = 'header-wrapped';
const ALL_CLASSES = [...STEPS, WRAPPED_CLASS];
const ONE_ROW = STEPS.map((_, i) => STEPS.slice(0, i)).concat([STEPS]);
const WRAPPED = [WRAPPED_CLASS, ...STEPS];

/** Whether the header's one row of controls is wider than the room it has. */
export function rowOverflows(header) {
    const row = header.querySelector('.global-controls > .row');
    return !!row && row.scrollWidth > row.clientWidth + 1;
}

let _canvas = null;
const measuringContext = () => (_canvas || (_canvas = document.createElement('canvas'))).getContext('2d');

/**
 * The inputs' minimum widths come from the font they are drawn in (fonts differ
 * between systems): the reference string's width plus the input's padding and border.
 */
function measureFocusMinimums(header) {
    const ctx = measuringContext();
    for (const id of FOCUS_INPUT_IDS) {
        const input = document.getElementById(id);
        if (!input) continue;
        const style = getComputedStyle(input);
        ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
        const width = ctx.measureText(FOCUS_REFERENCE[id]).width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
            + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) + 3;
        header.style.setProperty(`--${id === 'focused-gene' ? 'focus-gene' : 'focus-cell'}-min`, `${Math.ceil(width)}px`);
    }
}

function apply(header, classes) {
    for (const c of ALL_CLASSES) header.classList.toggle(c, classes.includes(c));
    for (const id of FOCUS_INPUT_IDS) fitFocusInput(document.getElementById(id));
}

export function fitDatasetHeader(header) {
    if (!header) return;
    measureFocusMinimums(header);
    settleHeader(header);
}

function settleHeader(header) {
    for (const classes of ONE_ROW) {
        apply(header, classes);
        if (!rowOverflows(header)) return;
    }
    apply(header, WRAPPED);
}

export const FOCUS_INPUT_IDS = ['focused-gene', 'focused-cell'];
/** What each input must at least show whole: an Ensembl ID, and a 10x cell barcode. */
export const FOCUS_REFERENCE = { 'focused-gene': 'ENSG00000141510', 'focused-cell': 'AAACCTGAGAAACCAT-1' };
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
        const ctx = measuringContext();
        ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const extra = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
            + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) + 4;
        const want = Math.ceil(ctx.measureText(input.value || input.placeholder || '').width + extra);
        const min = parseFloat(style.minWidth) || 0;
        // tight: the column may narrow it further (CSS caps it at the column's width)
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

/** Refit on resize, and when the header's size or text changes. */
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
    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(refit);
        // the header's own size does not change when the badge or title widens its first column
        for (const el of [header, header.querySelector('.col-auto'), header.querySelector('.global-controls')]) if (el) observer.observe(el);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
    refit();
}
