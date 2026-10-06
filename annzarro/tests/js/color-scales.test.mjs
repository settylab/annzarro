/**
 * The Map picker says which way each sequential map runs (utils/color-scales.js).
 *
 * Plotly's Blues runs dark to light, so "pale for little" needs Reverse; the
 * picker read just "Blues". The ends themselves are checked against the loaded
 * Plotly in annzarro/tests/browser/test_colour_scale_direction.py.
 *
 * Run:  node --test annzarro/tests/js/color-scales.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { SEQUENTIAL_LOW_END, scaleDirection, scaleOptionLabel, scaleGradient } from '../../../static/js/utils/color-scales.js';

globalThis.fetch = async () => ({ ok: false, statusText: 'offline in test' });   // config.js asks the server
const { Config } = await import('../../../static/js/config.js');

test('sequential maps are labelled low to high, Reverse included', () => {
    assert.equal(scaleOptionLabel('Blues'), 'Blues (dark → light)');
    assert.equal(scaleOptionLabel('Reds'), 'Reds (light → dark)');
    assert.equal(scaleDirection('Blues', true), 'light → dark');
    assert.equal(scaleDirection('Viridis'), 'dark → light');
});

test('diverging and rainbow maps, the default among them, are not labelled', () => {
    for (const s of ['Portland', 'RdBu', 'Bluered', 'Picnic', 'Jet', 'Rainbow']) {
        assert.equal(scaleOptionLabel(s), s);
        assert.equal(scaleDirection(s, true), null);
    }
    assert.equal(Config.DEFAULTS.COLOR_SCALE, 'Portland');
});

test('every labelled map is one the picker offers', () => {
    for (const s of Object.keys(SEQUENTIAL_LOW_END)) assert.ok(Config.DEFAULTS.COLOR_SCALES.includes(s), s);
});

test('the swatch gradient runs low to high, reversed end for end', () => {
    const stops = [[0, 'rgb(5,10,172)'], [0.35, 'rgb(40,60,190)'], [1, 'rgb(220,220,220)']];
    assert.equal(scaleGradient(stops), 'linear-gradient(to right, rgb(5,10,172) 0%, rgb(40,60,190) 35%, rgb(220,220,220) 100%)');
    assert.equal(scaleGradient(stops, true), 'linear-gradient(to right, rgb(220,220,220) 0%, rgb(40,60,190) 65%, rgb(5,10,172) 100%)');
});
