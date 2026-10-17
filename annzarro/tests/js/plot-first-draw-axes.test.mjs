/**
 * A plot opened from a config draws its axes as Plot Options does.
 *
 * The first draw took the axis line and the zero line from the grid switch, so the Publication
 * preset (grid off) lost its axes whenever its link, panel set, autosave or a Duplicate was
 * opened: the axis colours were stored and restored, and there was no line to colour.
 *
 * Run:  node --test annzarro/tests/js/plot-first-draw-axes.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    getElementById: () => null, addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => []
};
globalThis.Plotly = new Proxy({}, { get: () => () => Promise.resolve() });

const { createLayout } = await import('../../../static/js/panels/plot-utilities/plot-make-helper.js');
const { presetChanges } = await import('../../../static/js/panels/plot-utilities/plot-options.js');

const axes = { x: { type: 'obsm', key: 'X_umap', column: 0 }, y: { type: 'obsm', key: 'X_umap', column: 1 }, z: null };

test('the grid switch leaves the axis line and the zero line alone', () => {
    const off = createLayout({ ...axes, showGrid: false, showAxisLines: true, showZeroLines: false });
    for (const a of [off.xaxis, off.yaxis]) {
        assert.equal(a.showgrid, false);
        assert.equal(a.showline, true);
        assert.equal(a.zeroline, false);
    }
    const on = createLayout({ ...axes, showGrid: true, showAxisLines: false, showZeroLines: true });
    for (const a of [on.xaxis, on.yaxis]) {
        assert.equal(a.showgrid, true);
        assert.equal(a.showline, false);
        assert.equal(a.zeroline, true);
    }
});

test('the Publication preset keeps its axis lines on the first draw', () => {
    const settings = { ...axes, ...presetChanges('publication') };
    assert.equal(settings.showGrid, false);
    const layout = createLayout(settings);
    assert.equal(layout.xaxis.showline, true);
    assert.equal(layout.yaxis.showline, true);
});

test('a 3D plot takes the same switches', () => {
    const layout = createLayout({ ...axes, z: { type: 'obsm', key: 'X_umap', column: 0 }, showGrid: false, showAxisLines: true });
    for (const a of [layout.scene.xaxis, layout.scene.yaxis, layout.scene.zaxis]) assert.equal(a.showline, true);
});
