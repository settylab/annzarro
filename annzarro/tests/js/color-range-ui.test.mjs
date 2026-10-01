/**
 * The colour min/max NUMBER BOXES must show the range the plot is drawn with
 * after a restore (deep link / session), not the panel template's defaults.
 *
 * On first load `updateColorSliderUI` deliberately keeps the provided range,
 * but it only wrote the SLIDERS. The boxes kept the template's
 * `value="${settings.colorMin ?? 0}"` / `?? 100`, so a deep link without an
 * explicit range showed "0" and "100" next to a plot coloured over the data's
 * real range.
 *
 * Run:  node --test annzarro/tests/js/color-range-ui.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = { addEventListener() {}, getElementById: () => null, createElement: () => ({}) };
globalThis.Plotly = new Proxy({}, { get: () => () => Promise.resolve() });

/** Fake controls keyed by selector; jQuery(container).find(sel) looks them up. */
function makeControls(id, { min = '0', max = '100' } = {}) {
    const mk = (value) => ({ value, attrs: {} });
    return {
        [`#color-min-${id}`]: mk(min), [`#color-max-${id}`]: mk(max),
        [`#color-min-slider-${id}`]: mk(min), [`#color-max-slider-${id}`]: mk(max),
    };
}
function wrap(el) {
    const w = {
        length: el ? 1 : 0,
        val(v) { if (v === undefined) return el?.value; if (el) el.value = String(v); return w; },
        attr(k, v) {
            if (typeof k === 'object') { if (el) Object.assign(el.attrs, k); return w; }
            if (v === undefined) return el?.attrs[k];
            if (el) el.attrs[k] = v; return w;
        }
    };
    return w;
}
globalThis.jQuery = (container) => ({ find: (sel) => wrap(container[sel]) });

const { DataManager } = await import('../../../static/js/data-manager.js');
void DataManager;
const { updateColorSliderUI } = await import('../../../static/js/panels/plot-utilities/panel-ui-update.js');

const data = { color: [-2.5, 0, 1.25, 7.75, NaN] };

test('first load with no stored range shows the data range in the boxes', () => {
    const controls = makeControls('p');
    const settings = { colorMin: null, colorMax: null, lockColorRange: false };
    updateColorSliderUI(controls, data, settings, 'p', true);
    assert.equal(controls['#color-min-p'].value, '-2.50');
    assert.equal(controls['#color-max-p'].value, '7.75');
    assert.equal(settings.colorMin, -2.5);
    assert.equal(settings.colorMax, 7.75);
});

test('first load with a restored range shows THAT range', () => {
    const controls = makeControls('q', { min: '0', max: '100' });
    const settings = { colorMin: -1, colorMax: 3.14159, lockColorRange: false };
    updateColorSliderUI(controls, data, settings, 'q', true);
    assert.equal(controls['#color-min-q'].value, '-1.00');
    assert.equal(controls['#color-max-q'].value, '3.14');
    assert.equal(controls['#color-max-slider-q'].value, '3.14159');
    assert.equal(settings.colorMax, 3.14159, 'the restored value itself is not rounded');
});

test('a locked range is kept and shown when new data arrives', () => {
    const controls = makeControls('r', { min: '', max: '' });
    const settings = { colorMin: 0.5, colorMax: 2, lockColorRange: true };
    updateColorSliderUI(controls, data, settings, 'r', false);
    assert.equal(controls['#color-min-r'].value, '0.50');
    assert.equal(controls['#color-max-r'].value, '2.00');
});

test('an unlocked later load still follows the data', () => {
    const controls = makeControls('s');
    const settings = { colorMin: -1, colorMax: 3, lockColorRange: false };
    updateColorSliderUI(controls, data, settings, 's', false);
    assert.equal(controls['#color-min-s'].value, '-2.50');
    assert.equal(controls['#color-max-s'].value, '7.75');
});
