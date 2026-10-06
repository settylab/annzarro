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

const { colorSortOrder, sortTracesByColor, unsortTraces, colorSortApplies } =
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

test('3D: depth decides what is in front, so strong-on-top does not reorder', async () => {
    assert.equal(colorSortApplies({}), true);                                   // on by default in 2D
    assert.equal(colorSortApplies({ sortByColor: false }), false);
    assert.equal(colorSortApplies({ z: { type: 'obsm', key: 'X_umap', column: '2' } }), false);
    assert.equal(colorSortApplies({ sortByColor: true, z: null }), true);      // the 2D setting applies again
    const trace = () => ({ type: 'scatter3d', x: [1, 2, 3], y: [1, 2, 3], z: [1, 2, 3],
                           marker: { color: [5, -1, 2], colorscale: 'Viridis' } });
    const gd = { data: [trace()] };
    await sortTracesByColor(gd, { sortByColor: true, z: { type: 'obsm', key: 'X_umap', column: '2' } });
    assert.deepEqual(gd.data[0].x, [1, 2, 3], 'points keep data order in 3D');
    assert.equal(gd.data[0]._azOrder, undefined);
    const stray = { data: [trace()] };                                          // a scatter3d trace is never sorted
    await sortTracesByColor(stray, { sortByColor: true });
    assert.deepEqual(stray.data[0].x, [1, 2, 3]);
});

const { strongOnTopKey, PALE_END } = await import('../../../static/js/utils/color-scales.js');
const order = (vals, o) => colorSortOrder(vals, strongOnTopKey(o)).map(i => vals[i]);

test('sequential map, pale low (Blues + Reverse), Min 0.3 locked: clamped pale values go underneath', () => {
    // the issue: -0.9 is clamped to the pale end but has the largest |value|; it was drawn on top
    const vals = [0.5, -0.9, 0.95, 0.31, -0.4, null, 0.1];
    const got = order(vals, { scale: 'Blues', reversed: true, min: 0.3, max: 1 });
    assert.deepEqual(got, [null, -0.9, -0.4, 0.1, 0.31, 0.5, 0.95], 'clamped ties keep data order, then by position');
});

test('the strong end is the one away from the pale end; Reverse moves it', () => {
    const vals = [0.2, 0.9, 0.5];
    assert.equal(PALE_END.Blues, 'high');
    assert.deepEqual(order(vals, { scale: 'Blues', min: 0, max: 1 }), [0.9, 0.5, 0.2], 'Blues: dark low is strong');
    assert.deepEqual(order(vals, { scale: 'Blues', reversed: true, min: 0, max: 1 }), [0.2, 0.5, 0.9]);
    assert.deepEqual(order(vals, { scale: 'Reds', min: 0, max: 1 }), [0.2, 0.5, 0.9], 'Reds: pale low');
    // no near-white end: the high end is strong, Reverse or not
    assert.deepEqual(order(vals, { scale: 'Viridis', min: 0, max: 1 }), [0.2, 0.5, 0.9]);
    assert.deepEqual(order(vals, { scale: 'Portland', reversed: true, min: 0, max: 1 }), [0.2, 0.5, 0.9]);
});

test('centred (Center at 0) and diverging maps keep |value|', () => {
    const vals = [0.5, -0.9, 0.95, -0.1];
    const abs = [-0.1, 0.5, -0.9, 0.95];
    assert.deepEqual(order(vals, { scale: 'Blues', reversed: true, centred: true, min: -1, max: 1 }), abs);
    for (const scale of ['RdBu', 'Picnic', 'Bluered']) assert.deepEqual(order(vals, { scale, min: 0.3, max: 1 }), abs, scale);
    // a constant range: nothing to place on a scale
    assert.deepEqual(order(vals, { scale: 'Blues', min: 1, max: 1 }), abs);
});

test('non-negative values on an unlocked range: the same order |value| gave', () => {
    const vals = [3, 0, 7.5, 1, null, 2];
    for (const scale of ['Viridis', 'Portland', 'Reds']) {
        assert.deepEqual(order(vals, { scale, min: 0, max: 7.5 }), order(vals, { scale: 'RdBu', min: 0, max: 7.5 }), scale);
    }
});
