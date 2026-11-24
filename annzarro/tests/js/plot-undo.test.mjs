/**
 * WP-5b: what a Cell Plot or Gene Plot undo step compares (panels/plot-utilities/plot-undo.js): the stored config
 * without the view (zoom, 3D camera, Toggle Controls) and without a point size or opacity that is automatic (it follows
 * the zoom). A zoom is therefore never a step, and a point size set by hand is.
 *
 * Run:  node --test annzarro/tests/js/plot-undo.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { storedConfig } = await import('../../../static/js/panels/plot-utilities/plot-undo.js');
const { createPanelUndo } = await import('../../../static/js/ui/panel-undo.js');

test('the view and an automatic point style are not part of a step', () => {
    const c = { x: { key: 'X_umap' }, viewport2D: { x: [0, 1] }, viewport3D: { eye: 1 }, controlsVisible: false,
        autoPointSize: true, pointSize: 3.1, autoPointOpacity: false, pointOpacity: 0.4 };
    assert.deepEqual(storedConfig(c), { x: { key: 'X_umap' }, autoPointSize: true, autoPointOpacity: false, pointOpacity: 0.4 });
});

test('a zoom alone records nothing; a point size set by hand is one step', () => {
    let config = { showGrid: true, autoPointSize: true, pointSize: 3, viewport2D: null };
    const undo = createPanelUndo({ snapshot: () => storedConfig(config), restore: (c) => { config = { ...config, ...c }; } });
    config = { ...config, viewport2D: { x: [2, 3] }, pointSize: 2.2 };            // a zoom: the automatic size follows it
    assert.equal(undo.observe(), false);
    config = { ...config, autoPointSize: false, pointSize: 7 };
    assert.equal(undo.observe(), true);
    assert.equal(undo.size, 1);
});
