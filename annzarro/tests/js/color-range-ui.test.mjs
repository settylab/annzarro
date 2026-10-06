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
    const mk = (value) => ({ value, attrs: {}, data: {}, props: {} });
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
        },
        data(k, v) { if (v === undefined) return el?.data[k]; if (el) el.data[k] = v; return w; },
        prop(k, v) { if (v === undefined) return el?.props[k]; if (el) el.props[k] = v; return w; }
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
    assert.equal(controls['#color-min-p'].value, '-2.5');
    assert.equal(controls['#color-max-p'].value, '7.75');
    assert.equal(settings.colorMin, -2.5);
    assert.equal(settings.colorMax, 7.75);
});

test('first load with a restored range shows THAT range', () => {
    const controls = makeControls('q', { min: '0', max: '100' });
    const settings = { colorMin: -1, colorMax: 3.14159, lockColorRange: false };
    updateColorSliderUI(controls, data, settings, 'q', true);
    assert.equal(controls['#color-min-q'].value, '-1');
    assert.equal(controls['#color-max-q'].value, '3.14');
    // the slider is a percentile track: its thumb shows 3.14159 in quantile space
    const scale = controls['#color-max-slider-q'].data.scale;
    assert.ok(Math.abs(scale.fromPos(Number(controls['#color-max-slider-q'].value) / 1000) - 3.14159) < 0.05);
    assert.equal(settings.colorMax, 3.14159, 'the restored value itself is not rounded');
});

test('a locked range is kept and shown when new data arrives', () => {
    const controls = makeControls('r', { min: '', max: '' });
    const settings = { colorMin: 0.5, colorMax: 2, lockColorRange: true };
    updateColorSliderUI(controls, data, settings, 'r', false);
    assert.equal(controls['#color-min-r'].value, '0.5');
    assert.equal(controls['#color-max-r'].value, '2');
});

test('an unlocked later load still follows the data', () => {
    const controls = makeControls('s');
    const settings = { colorMin: -1, colorMax: 3, lockColorRange: false };
    updateColorSliderUI(controls, data, settings, 's', false);
    assert.equal(controls['#color-min-s'].value, '-2.5');
    assert.equal(controls['#color-max-s'].value, '7.75');
});

test('a small range is shown with its significant digits, not rounded to 0.01', () => {
    // A diffusion-walk row: the colour bar ends at 0.012; toFixed(2) showed "0.01"
    const controls = makeControls('t');
    const settings = { colorMin: null, colorMax: null, lockColorRange: false };
    updateColorSliderUI(controls, { color: [0, 0.00042, 0.012345] }, settings, 't', true);
    assert.equal(controls['#color-min-t'].value, '0');
    assert.equal(controls['#color-max-t'].value, '0.0123');
    assert.equal(settings.colorMax, 0.012345, 'the range itself keeps full precision');
});

test('the sliders are percentile tracks, the boxes and settings keep values', () => {
    const controls = makeControls('u');
    const settings = { colorMin: null, colorMax: null, lockColorRange: false };
    // skewed: one huge value; a linear track would put everything else in its first 1%
    const values = [...Array(99).keys()].map((i) => i / 10).concat([1000]);
    updateColorSliderUI(controls, { color: values }, settings, 'u', false);
    assert.equal(settings.colorMax, 1000);
    assert.equal(controls['#color-max-slider-u'].value, '1000');
    assert.equal(controls['#color-min-slider-u'].value, '0');
    const scale = controls['#color-max-slider-u'].data.scale;
    assert.ok(scale.fromPos(0.5) < 6, 'the middle of the track is the median, not 500');
    assert.equal(controls['#color-max-slider-u'].props.disabled, false);
});

test('typed arrays (large-plot mode) feed the sliders as well', () => {
    const controls = makeControls('w');
    const settings = { colorMin: null, colorMax: null, lockColorRange: false };
    updateColorSliderUI(controls, { color: new Float32Array([NaN, 1, 2, 3, 40]) }, settings, 'w', false);
    assert.equal(settings.colorMin, 1);
    assert.equal(settings.colorMax, 40);
});

test('a constant column disables the sliders but keeps the boxes', () => {
    const controls = makeControls('c');
    const settings = { colorMin: null, colorMax: null, lockColorRange: false };
    updateColorSliderUI(controls, { color: [4, 4, 4] }, settings, 'c', false);
    assert.equal(controls['#color-min-slider-c'].props.disabled, true);
    assert.equal(controls['#color-max-slider-c'].props.disabled, true);
    assert.equal(controls['#color-min-c'].value, '4');
});

test('centred at 0: symmetric range, min thumb mirrors the max thumb', () => {
    const controls = makeControls('z');
    const settings = { colorMin: null, colorMax: null, lockColorRange: false, centeringActive: true };
    updateColorSliderUI(controls, { color: [-3, -1, 0.5, 2, 8] }, settings, 'z', false);
    assert.equal(settings.colorMin, -8);
    assert.equal(settings.colorMax, 8);
    assert.equal(controls['#color-min-slider-z'].value, '0');
    assert.equal(controls['#color-max-slider-z'].value, '1000');
    const lo = controls['#color-min-slider-z'].data.scale, hi = controls['#color-max-slider-z'].data.scale;
    for (const p of [0.1, 0.37, 0.8]) assert.ok(Math.abs(lo.fromPos(1 - p) + hi.fromPos(p)) < 1e-12);
});

test('under Log the boxes show data values, the settings log10', () => {
    // data 1 .. 82 on a log scale: the boxes read 1 and 82, not 0 and 1.91
    // (typing 82 used to mean 10^82)
    const controls = makeControls('l');
    const settings = { color: { type: 'obs', key: 'n', log: true }, colorMin: null, colorMax: null, lockColorRange: false };
    updateColorSliderUI(controls, { color: [0, 0.5, 1, Math.log10(82)] }, settings, 'l', false);
    assert.equal(settings.colorMin, 0);
    assert.equal(settings.colorMax, Math.log10(82));
    assert.equal(controls['#color-min-l'].value, '1');
    assert.equal(controls['#color-max-l'].value, '82');
});
