/**
 * A legend below the plot sits below the x-axis text: the offset in px becomes a paper fraction.
 *
 * Run:  node --test annzarro/tests/js/legend-below.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isBelowLegend, belowLegendY, syncBelowLegend } from '../../../static/js/utils/legend-below.js';

const below = { legend: { orientation: 'h', yanchor: 'top', x: 0.5, y: 0 } };

test('only the horizontal legend hanging from the axes down is a bottom legend', () => {
    assert.equal(isBelowLegend(below), true);
    assert.equal(isBelowLegend({ legend: { ...below.legend, y: -0.2 } }), true);
    assert.equal(isBelowLegend({ legend: { orientation: 'h', yanchor: 'bottom', y: 1 } }), false);     // top
    assert.equal(isBelowLegend({ legend: { orientation: 'v', yanchor: 'middle', y: 0.5 } }), false);   // right or left
    assert.equal(isBelowLegend({ legend: { orientation: 'h', yanchor: 'bottom', y: 1.02 } }), false);  // beside a colour bar
    assert.equal(isBelowLegend({}), false);
    assert.equal(isBelowLegend(undefined), false);
});

test('the same pixels are a bigger fraction of a shorter plot', () => {
    assert.equal(belowLegendY(68, 340), -0.2);
    assert.equal(belowLegendY(68, 120), -0.5667);
    assert.ok(belowLegendY(68, 120) < belowLegendY(68, 340));
});

test('no usable plot height gives no fraction', () => {
    assert.equal(belowLegendY(68, 0), null);
    assert.equal(belowLegendY(NaN, 300), null);
});

test('a graph that is not drawn, or has another legend, is left alone', () => {
    let calls = 0;
    globalThis.Plotly = { relayout: () => { calls++; return Promise.resolve(); } };
    syncBelowLegend({});
    syncBelowLegend({ _fullLayout: { _size: { h: 300 } }, layout: { legend: { orientation: 'v', yanchor: 'middle', y: 0.5 } } });
    assert.equal(calls, 0);
});

test('a bottom legend is moved once, to the fraction for the plot as drawn', async () => {
    const sent = [];
    globalThis.Plotly = { relayout: (gd, u) => { sent.push(u); gd.layout.legend.y = u['legend.y']; return Promise.resolve(); } };
    const gd = { layout: JSON.parse(JSON.stringify(below)), _fullLayout: { _size: { t: 80, h: 340 } }, querySelector: () => null };
    syncBelowLegend(gd);
    await new Promise(r => setTimeout(r, 0));
    syncBelowLegend(gd);                            // already there: nothing more
    assert.deepEqual(sent, [{ 'legend.y': -0.2 }]);   // (60 estimate + 8 gap) / 340
});
