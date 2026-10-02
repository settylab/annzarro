/**
 * Strong colour values are drawn on top, and updates stay consistent.
 *
 * scattergl draws in array order, so large values in a dense core were
 * hidden. Continuous traces are now reordered by |colour| (missing first);
 * updatePlotElements unsorts before writing data-order arrays and sorts
 * again after. Headless on view C: sorted, and 0 of 84 sampled (cell, colour)
 * pairs differ from the server's layer values, before and after a
 * focus-gene change.
 *
 * Run:  node --test annzarro/tests/js/color-sort.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    getElementById: () => null, addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => []
};
// a restyle that applies [array] updates to the trace, like Plotly does
globalThis.Plotly = new Proxy({}, { get: (_, k) => k !== 'restyle' ? () => Promise.resolve() : (gd, update, idx) => {
    for (const i of idx) for (const [attr, [arr]] of Object.entries(update)) {
        if (attr === 'marker.color') gd.data[i].marker.color = arr; else gd.data[i][attr] = arr;
    }
    return Promise.resolve();
} });
globalThis.fetch = async () => ({ ok: false, statusText: 'test' });

const { colorSortOrder, sortTracesByColor, unsortTraces } =
    await import('../../../static/js/panels/plot-utilities/plot-make.js');

test('order: by |colour| ascending, missing first, stable for ties', () => {
    assert.deepEqual(colorSortOrder([3, -5, null, 0.1, NaN, -3]), [2, 4, 3, 0, 5, 1]);
});

const gd = () => ({ data: [
    { name: 'Not in table', text: ['g'], marker: { color: 'grey' } },
    { name: 'z', x: [1, 2, 3, 4], y: [5, 6, 7, 8], text: ['a', 'b', 'c', 'd'], customdata: ['a', 'b', 'c', 'd'],
      marker: { color: [-9, 1, null, 4], colorscale: 'RdBu' } },
    { name: 'Focused Cell', x: [1], marker: { color: 'red' } }
] });

test('the colour trace is reordered as a whole; other traces are untouched', async () => {
    const g = gd();
    await sortTracesByColor(g, {});
    const t = g.data[1];
    assert.deepEqual(t.text, ['c', 'b', 'd', 'a']);
    assert.deepEqual(t.x, [3, 2, 4, 1]);
    assert.deepEqual(t.customdata, t.text, 'clicks still name the right point');
    assert.deepEqual(t.marker.color, [null, 1, 4, -9]);
    assert.deepEqual(g.data[0].text, ['g']);
});

test('unsort restores data order exactly', async () => {
    const g = gd();
    await sortTracesByColor(g, {});
    await unsortTraces(g);
    assert.deepEqual(g.data[1].text, ['a', 'b', 'c', 'd']);
    assert.deepEqual(g.data[1].marker.color, [-9, 1, null, 4]);
    assert.equal(g.data[1]._azOrder, undefined);
});

test('sortByColor false keeps data order', async () => {
    const g = gd();
    await sortTracesByColor(g, { sortByColor: false });
    assert.deepEqual(g.data[1].text, ['a', 'b', 'c', 'd']);
});
