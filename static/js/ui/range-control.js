/**
 * The range control: Min and Max sliders over the drawn statistic, each with a number field and "auto" (the Cell Plot's
 * colour range, made reusable for the Cell-Gene Plot's colour, size and 3D height and the Count Plot's colour).
 *
 * The sliders move over percentiles of the drawn values (utils/range-control-model.js), so a skewed statistic keeps its
 * useful range under the thumb; the stored limit is the real value. While a slider moves, the number field follows; the
 * limit is committed on release (`change`), one undoable step. A number field commits on change or Enter: empty is
 * automatic, anything else that is not a number is refused with `onProblem`. "auto" sets the limit back to the data's
 * own end. A constant or empty statistic has nothing to slide over: the sliders are disabled, the fields still take a
 * typed limit.
 *
 * ```
 * const range = createRangeControl({ el, name: 'min', ends: [{ key: 'min', label: 'Min', option: 'min' }, ...],
 *     onCommit: (index, value) => ... });   // value: a number, or null for automatic
 * parent.append(range.element);
 * range.set({ values: Float64Array, limits: [lo|null, hi|null] });   // on every paint
 * ```
 */
import { SLIDER_STEPS } from '../utils/slider-scales.js';
import { rangeScales, sliderValue, sliderTrack, autoTrack } from '../utils/range-control-model.js';
import { formatRangeValue } from '../utils/array-stats.js';
import { VOCABULARY } from '../utils/vocabulary.js';

const R = VOCABULARY.range;

/**
 * @param {Object} o
 * @param {Function} o.el - the page's element maker (D.el)
 * @param {{key: string, label: string, option?: string, className?: string, id?: string}[]} o.ends - the min end then the
 *   max end: `option` is the field's data-option (the slider's is `${option}Slider`), `className` its class
 * @param {(index: number, value: (number|null)) => void} o.onCommit - 0 for min, 1 for max
 * @param {(text: string) => ({ok: boolean, value?: number, message?: string})} [o.parse] - a typed limit; the default
 *   takes a number or empty
 * @param {(message: string) => void} [o.onProblem] - a refused text's sentence ('' when the text is fine)
 * @param {'number'|'text'} [o.inputType]
 * @param {string} [o.what] - what the range is of, for the sliders' accessible names ("Color", "Size")
 * @returns {{element: HTMLElement, fields: HTMLInputElement[], sliders: HTMLInputElement[], set: Function}}
 */
export function createRangeControl({ el, ends, onCommit, parse = defaultParse, onProblem = () => {}, inputType = 'number', what = '' }) {
    const state = { scale: null, limits: [null, null] };
    const rows = ends.map((end, i) => {
        const side = i === 0 ? 'low' : 'high';
        const nameOf = (word) => (what ? `${what} ${word}` : end.label);
        const slider = el('input', { type: 'range', class: 'form-range az-range__slider', min: 0, max: SLIDER_STEPS, step: 1,
            value: autoTrack(side), data: { option: end.option ? `${end.option}Slider` : undefined }, title: R.sliderHelp,
            aria: { label: `${nameOf(end.label.toLowerCase())} (${R.percentile})` } });
        const attrs = { class: `form-control form-control-sm az-range__field ${end.className || ''}`.trim(), data: { option: end.option },
            aria: { label: nameOf(end.label.toLowerCase()) }, autocomplete: 'off', placeholder: R.auto };
        if (end.id) attrs.id = end.id;
        if (inputType === 'number') Object.assign(attrs, { type: 'number', step: 'any' });
        else Object.assign(attrs, { type: 'text', inputmode: 'decimal' });
        const field = el('input', attrs);
        const auto = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary az-range__auto', aria: { pressed: 'true' },
            data: { option: end.option ? `${end.option}Auto` : undefined }, title: R.autoHelp }, R.auto);
        const label = el('label', { class: 'az-range__label', text: end.label, for: end.id || undefined });
        const row = el('div', { class: 'az-range__row' }, label, slider, field, auto);
        const ref = { slider, field, auto, row, side, index: i };

        // the slider moves: the field follows; the limit is committed on release
        slider.addEventListener('input', () => {
            const v = sliderValue(state.scale, slider.value);
            field.value = String(roundTo(v));
        });
        slider.addEventListener('change', () => {
            // a value read off the track is rounded; the track's ends are the data's own ends, exactly
            const atEnd = Number(slider.value) <= 0 || Number(slider.value) >= SLIDER_STEPS;
            const raw = sliderValue(state.scale, slider.value);
            const v = atEnd ? raw : roundTo(raw);
            if (Number.isFinite(v)) { onProblem(''); onCommit(i, v); }
        });
        auto.addEventListener('click', () => { onProblem(''); onCommit(i, null); });
        const commitField = () => {
            const result = parse(field.value);
            onProblem(result.ok ? '' : result.message || '');
            if (!result.ok) { paintOne(ref); return; }
            const v = result.value === undefined ? null : result.value;
            if (v === state.limits[i]) { paintOne(ref); return; }
            onCommit(i, v);
        };
        field.addEventListener('change', commitField);
        field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitField(); } });
        return ref;
    });

    function paintOne(ref) {
        const limit = state.limits[ref.index];
        const set = Number.isFinite(limit);
        const scale = state.scale;
        const sliding = document.activeElement === ref.slider;
        ref.slider.disabled = !scale || !!scale.constant;
        if (!sliding) ref.slider.value = String(set ? sliderTrack(scale, limit, ref.side) : autoTrack(ref.side));
        if (document.activeElement !== ref.field) ref.field.value = set ? String(limit) : '';
        const end = scale ? (ref.side === 'low' ? scale.min : scale.max) : null;
        ref.field.placeholder = end !== null && Number.isFinite(end) ? `${R.auto} (${formatRangeValue(end)})` : R.auto;
        ref.auto.setAttribute('aria-pressed', set ? 'false' : 'true');
        ref.auto.classList.toggle('active', !set);
        ref.auto.disabled = !set;
    }

    const element = el('div', { class: 'az-range', role: 'group' }, ...rows.map((r) => r.row));
    return {
        element,
        fields: rows.map((r) => r.field),
        sliders: rows.map((r) => r.slider),
        /**
         * Show the control: the sliders over `values` (their quantiles), the limits as stored (null: automatic).
         * @param {{values?: ArrayLike<number>|null, limits?: Array<number|null>, centered?: boolean}} what
         */
        set({ values = null, limits = [null, null], centered = false } = {}) {
            if (values !== state.values || centered !== state.centered) {
                const scales = values ? rangeScales(values, centered) : null;
                state.values = values;
                state.centered = centered;
                state.scale = scales ? scales.max : null;
            }
            state.limits = limits.map((v) => (Number.isFinite(v) ? v : null));
            rows.forEach(paintOne);
        }
    };
}

function defaultParse(text) {
    const s = String(text).trim();
    if (s === '') return { ok: true, value: undefined };
    const v = Number(s);
    return Number.isFinite(v) ? { ok: true, value: v } : { ok: false, message: R.problem };
}

/** A value from a slider to 4 significant digits, so the field reads as a number, not a float's tail. */
function roundTo(v) {
    return Number.isFinite(v) && v !== 0 ? Number(v.toPrecision(4)) : v;
}
