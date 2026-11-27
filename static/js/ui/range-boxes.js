/**
 * Range boxes: the Min and Max (and, for a colour, Center) boxes of one scale in the Cell-Gene and Count Plots' Color
 * pop-overs, all in one style. A scale that is not set shows the value the plot draws now, "0.12", as the box's muted
 * placeholder (the value alone, so it fits a 5.5rem box; the box's title says it is automatic), or "auto" when none is
 * drawn, so it reads as a value and never as an empty field; a scale that is set shows its number.
 * Each group has a reset button (↺) that returns all of its boxes to auto in one step.
 *
 * A box commits on change or Enter: empty is automatic; text that is no number is refused with `onProblem`. A limit is
 * stored as the plot's own field says (`onCommit(index, value|null)`); a reset is `onReset()`.
 *
 * ```
 * const boxes = createRangeBoxes({ el, what: 'Size', ends: [{ label: 'Size min', option: 'dotMin' }, ...],
 *     onCommit: (index, value) => ..., onReset: () => ... });
 * boxes.set({ limits: [lo|null, hi|null], drawn: [lo, hi] });   // on every paint
 * ```
 */
import { formatRangeValue, arrayMinMax } from '../utils/array-stats.js';
import { VOCABULARY } from '../utils/vocabulary.js';

const R = VOCABULARY.range;

/**
 * The smallest and largest finite value of a statistic as the boxes' auto hint: `[lo, hi]`, or null with none.
 * @param {ArrayLike<number>|null} values
 * @returns {[number, number]|null}
 */
export function drawnRange(values) {
    if (!values || !values.length) return null;
    const { min, max } = arrayMinMax(values);
    return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : null;
}

/**
 * @param {Object} o
 * @param {Function} o.el - the page's element maker (D.el)
 * @param {{label: string, option?: string, className?: string, id?: string, hint?: boolean}[]} o.ends - the boxes in
 *   order; `hint: false` for a box with no drawn value (a colour's Center)
 * @param {(index: number, value: (number|null)) => void} o.onCommit
 * @param {() => void} o.onReset - all the boxes to auto, one undoable step
 * @param {(text: string) => ({ok: boolean, value?: number, message?: string})} [o.parse]
 * @param {(message: string) => void} [o.onProblem]
 * @param {'number'|'text'} [o.inputType]
 * @param {string} [o.what] - what the scale is of, for the reset's accessible name ("Color", "Size", "Height")
 * @param {string} [o.group] - the data-option of the reset button
 * @returns {{element: HTMLElement, fields: HTMLInputElement[], reset: HTMLButtonElement, set: Function}}
 */
export function createRangeBoxes({ el, ends, onCommit, onReset, parse = defaultParse, onProblem = () => {}, inputType = 'number', what = '', group }) {
    const state = { limits: ends.map(() => null), drawn: null };
    const fields = ends.map((end, i) => {
        const attrs = { class: `form-control form-control-sm az-range__field ${end.className || ''}`.trim(), data: { option: end.option },
            aria: { label: end.label }, autocomplete: 'off', placeholder: R.auto };
        if (end.id) attrs.id = end.id;
        if (inputType === 'number') Object.assign(attrs, { type: 'number', step: 'any' });
        else Object.assign(attrs, { type: 'text', inputmode: 'decimal' });
        const input = el('input', attrs);
        const commit = () => {
            const result = parse(input.value);
            onProblem(result.ok ? '' : result.message || '');
            if (!result.ok) { show(i); return; }
            const v = result.value === undefined ? null : result.value;
            if (v === state.limits[i]) { show(i); return; }
            onCommit(i, v);
        };
        input.addEventListener('change', commit);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
        return input;
    });
    const reset = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary az-range__reset', data: { option: group },
        title: R.resetHelp(what), aria: { label: R.resetHelp(what) }, on: { click: () => { onProblem(''); onReset(); } } }, R.reset);
    const labelEls = ends.map((end) => el('span', { class: 'az-range__label', text: end.label }));
    const boxes = ends.map((end, i) => el('label', { class: 'az-range__box', for: end.id || undefined }, labelEls[i], fields[i]));
    const element = el('div', { class: 'az-range', role: 'group', aria: { label: what } }, ...boxes, reset);

    function show(i) {
        const limit = state.limits[i];
        const input = fields[i];
        if (document.activeElement !== input) input.value = Number.isFinite(limit) ? String(limit) : '';
        const at = i === 0 ? 0 : 1;
        const drawn = ends[i].hint !== false && state.drawn ? state.drawn[at] : null;
        input.placeholder = drawn !== null && Number.isFinite(drawn) ? formatRangeValue(drawn) : R.auto;
        input.classList.toggle('az-range__field--auto', !Number.isFinite(limit));
        const hint = drawn !== null && Number.isFinite(drawn) ? formatRangeValue(drawn) : null;
        input.title = Number.isFinite(limit) ? R.fixed(formatRangeValue(limit)) : hint !== null ? R.follows(at === 0 ? R.smallest : R.largest, hint) : R.followsNone;
    }

    return {
        element, fields, reset,
        /** Show the boxes: `limits` as stored (null is auto), `drawn` the [smallest, largest] value drawn now,
         * `labels` the boxes' names when they follow the data (the size statistic's). */
        set({ limits = [], drawn = null, labels = null } = {}) {
            if (labels) labels.forEach((text, i) => { labelEls[i].textContent = text; fields[i].setAttribute('aria-label', text); });
            state.limits = ends.map((_, i) => (Number.isFinite(limits[i]) ? limits[i] : null));
            state.drawn = drawn;
            fields.forEach((_, i) => show(i));
            reset.disabled = state.limits.every((v) => v === null);
        }
    };
}

function defaultParse(text) {
    const s = String(text).trim();
    if (s === '') return { ok: true, value: undefined };
    const v = Number(s);
    return Number.isFinite(v) ? { ok: true, value: v } : { ok: false, message: R.problem };
}
