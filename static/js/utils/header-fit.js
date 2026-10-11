/**
 * The header is one row that gives way step by step, measured (not by
 * breakpoint), only as far as it has to for everything to fit:
 *
 *   1. everything at its natural width, the buttons with their labels;
 *   2. `actions-compact`: the buttons keep their icons (the label is the tooltip);
 *   3. `dataset-tight`: the dataset box may shrink from its name's width to 140px,
 *      its name cut in the middle (the open list and the tooltip show it whole);
 *   4. `focus-tight`: the focused gene and cell columns give up as much width as
 *      the row is still short of, down to the minimum that shows an Ensembl ID or
 *      a barcode (a longer value is whole in the tooltip, its end shown);
 *   5. `dataset-stacked`: the dataset group takes a row of its own above the
 *      rest, which then gives way again (labels, then the inputs) on its row.
 *
 * The dataset box gives way before the focus inputs: its name is shown whole in
 * the open list, while the focused gene and cell are read in the box itself.
 *
 * Each step is tried with the earlier ones kept and the first that leaves the
 * row without overflow is the layout, so the outcome depends on nothing but
 * the window and the content and cannot flip back and forth. The dataset box
 * itself is always one line: a long name is cut in the middle by CSS.
 */
export const STEPS = ['actions-compact', 'dataset-tight', 'focus-tight'];
export const STACKED_CLASS = 'dataset-stacked';
const ALL_CLASSES = [...STEPS, STACKED_CLASS];
const ONE_ROW = STEPS.map((_, i) => STEPS.slice(0, i)).concat([STEPS]);
const STACKED = [[STACKED_CLASS], [STACKED_CLASS, 'actions-compact'], [STACKED_CLASS, 'actions-compact', 'focus-tight']];

/** Whether the header's one row of controls is wider than the room it has. */
export function rowOverflows(header) {
    const row = header.querySelector('.global-controls > .row');
    return !!row && row.scrollWidth > row.clientWidth + 1;
}

/** Whether, stacked, the focus pickers and buttons no longer share one line. */
export function restWraps(header) {
    const row = header.querySelector('.global-controls > .row');
    if (!row) return false;
    // the buttons are shorter than the pickers and centred beside them: compare with
    // the line's bottom, not the tops
    const boxes = [...row.children].filter(c => !c.classList.contains('dataset-col'))
        .map(c => c.getBoundingClientRect()).filter(b => b.height > 0);
    if (!boxes.length) return false;
    const firstBottom = boxes.reduce((m, b) => Math.min(m, b.bottom), Infinity);
    return boxes.some(b => b.top >= firstBottom - 1);
}

/**
 * The inputs' minimum widths come from the font they are drawn in (fonts differ
 * between systems): the reference string's width plus the input's padding and border.
 */
function measureFocusMinimums(header) {
    const canvas = datasetNaturalWidth._canvas || (datasetNaturalWidth._canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
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

import { truncateDatasetLabel } from './dataset-label.js';

/** The whole label of the closed box (its text is cut to fit by truncateBoxLabel). */
function boxLabel(rendered) {
    const span = rendered.querySelector('.dataset-name-mid');
    return span ? (span.dataset.full ?? span.textContent) : rendered.textContent;
}

function boxParts(header) {
    const rendered = header.querySelector('#dataset-selector + .select2-container .select2-selection__rendered');
    const span = rendered && rendered.querySelector('.dataset-name-mid');
    return span ? { rendered, span } : null;
}

/** Put the whole label back, so that the layout is measured with what the box would like to say. */
function restoreBoxLabel(header) {
    const parts = boxParts(header);
    if (parts && parts.span.textContent !== parts.span.dataset.full) parts.span.textContent = parts.span.dataset.full;
}

/**
 * Cut the label to the room the box has (keeping its start and its end, see
 * truncateDatasetLabel), so that it fits and no CSS ellipsis has to cut the end again.
 */
function truncateBoxLabel(header) {
    const parts = boxParts(header);
    if (!parts) return;
    const { rendered, span } = parts;
    const overflow = () => rendered.scrollWidth - rendered.clientWidth;
    if (overflow() <= 0) return;                       // the whole label fits
    const style = getComputedStyle(rendered);
    const canvas = datasetNaturalWidth._canvas || (datasetNaturalWidth._canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const measure = str => ctx.measureText(str).width;
    let room = rendered.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2;
    for (let i = 0; i < 8; i++) {                      // the canvas is a model of the DOM: check it, and tighten if it was off
        span.textContent = truncateDatasetLabel(span.dataset.full, room, measure);
        const over = overflow();
        if (over <= 0) return;
        room -= Math.max(4, over);
    }
}

/** The natural width of the closed box for its current label: the text and the box's padding. */
export function datasetNaturalWidth(header) {
    const rendered = header.querySelector('#dataset-selector + .select2-container .select2-selection__rendered');
    if (!rendered) return null;
    const style = getComputedStyle(rendered);
    const canvas = datasetNaturalWidth._canvas || (datasetNaturalWidth._canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const text = boxLabel(rendered).trim();
    return Math.ceil(ctx.measureText(text).width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 4);
}

let _pickObserver = null;

export function fitDatasetHeader(header) {
    if (!header) return;
    restoreBoxLabel(header);
    measureFocusMinimums(header);
    settleHeader(header);
    truncateBoxLabel(header);
    if (_pickObserver) _pickObserver.takeRecords();   // our own text changes are not news
}

function settleHeader(header) {
    const natural = datasetNaturalWidth(header);
    if (natural) header.style.setProperty('--dataset-natural', `${natural}px`);
    for (const classes of ONE_ROW) {
        apply(header, classes);
        if (!rowOverflows(header)) return;
    }
    for (const classes of STACKED) {
        apply(header, classes);
        if (!restWraps(header)) return;
    }
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
        const canvas = fitFocusInput._canvas || (fitFocusInput._canvas = document.createElement('canvas'));
        const ctx = canvas.getContext('2d');
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
    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(refit);
        // the header's own size does not change when the badge or title widens its first column
        for (const el of [header, header.querySelector('.col-auto'), header.querySelector('.global-controls')]) if (el) observer.observe(el);
    }
    const pick = header.querySelector('.dataset-pick');
    if (pick && typeof MutationObserver !== 'undefined') {
        _pickObserver = new MutationObserver(refit);
        _pickObserver.observe(pick, { childList: true, subtree: true, characterData: true });
    }
    // the strip's dataset title is cut at its end by CSS: its whole text is the tooltip
    const stripLabel = document.getElementById('dataset-path');
    if (stripLabel && typeof MutationObserver !== 'undefined') {
        const sync = () => { if (stripLabel.parentElement) stripLabel.parentElement.title = `Dataset: ${stripLabel.textContent}`; };
        new MutationObserver(sync).observe(stripLabel, { childList: true, characterData: true, subtree: true });
        sync();
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
    refit();
}
