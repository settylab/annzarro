/**
 * Hide NaN works on categorical colours, and hiding points keeps the axes.
 *
 * - Hide NaN acted on numerical colours only: a categorical colour with
 *   missing labels kept every point.
 * - Hide NaN / Hide Outliers REMOVE points, and autorange then refitted the
 *   axes to the remaining ones, so toggling them zoomed the plot.
 *
 * Run:  node --test annzarro/tests/js/hide-filters.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    getElementById: () => null, addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => []
};
globalThis.Plotly = new Proxy({}, { get: () => () => Promise.resolve() });
globalThis.fetch = async () => ({ ok: false, statusText: 'test' });

const { createFilterMask, stableAxisRanges } = await import('../../../static/js/panels/plot-utilities/plot-make.js');

const base = () => ({
    entities: 'cells', cells: ['a', 'b', 'c', 'd'],
    x: { values: [0, 1, 2, 10] }, y: { values: [0, 1, 2, 3] },
    colorType: 'categorical', color: ['HSC', null, 'nan', 'GMP'],
    tableEntities: null, tableFilterMask: null
});

test('Hide NaN hides points without a category', () => {
    const { indexMask, filterStats } = createFilterMask(base(), { hideNaN: true, tableFilter: 'none', z: null });
    assert.deepEqual(indexMask, [true, false, false, true]);
    assert.equal(filterStats.colorNaN, 2);
    assert.equal(filterStats.filtered, 2);
});

test('without Hide NaN every categorical point stays', () => {
    const { indexMask } = createFilterMask(base(), { hideNaN: false, tableFilter: 'none', z: null });
    assert.deepEqual(indexMask, [true, true, true, true]);
});

test('hiding pins the axes to all points; turning it off restores autorange', () => {
    const d = base();
    const pinned = stableAxisRanges(d, { hideOutliers: true, z: null });
    const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
    assert.ok(close(pinned['xaxis.range'], [-0.5, 10.5]), String(pinned['xaxis.range']));
    assert.ok(close(pinned['yaxis.range'], [-0.15, 3.15]), String(pinned['yaxis.range']));
    assert.deepEqual(stableAxisRanges(d, { z: null }), { 'xaxis.autorange': true, 'yaxis.autorange': true });
    assert.equal(stableAxisRanges(d, { hideNaN: true, z: { type: 'obsm' } }), null, '3D plots keep their camera');
});
