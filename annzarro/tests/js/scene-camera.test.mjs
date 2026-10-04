/**
 * The camera a user turned a 3D plot to is what Plotly keeps
 * (static/js/utils/scene-camera.js).
 *
 * plotly.js 2.20's gl3d scene saves a turned camera into the full layout of
 * the draw that last replotted it, not into gd._fullLayout once the graph
 * has been laid out again; uirevision then restored the default camera at
 * the next Plotly.react. These tests use a stand-in scene with the same
 * methods (getCamera, isCameraChanged, saveLayout) and the same flaw.
 *
 * Run:  node --test annzarro/tests/js/scene-camera.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { syncSceneCamera, withShownCamera } = await import('../../../static/js/utils/scene-camera.js');

const DEFAULT = { eye: { x: 1.25, y: 1.25, z: 1.25 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } };
const TURNED = { eye: { x: 0.3, y: -1.9, z: 0.6 }, center: { x: 0.1, y: 0, z: -0.1 }, up: { x: 0, y: 0, z: 1 } };
const copy = (o) => JSON.parse(JSON.stringify(o));

/** A graph turned to TURNED whose scene still points at an older full layout. */
function turnedGraph({ saved = true } = {}) {
    const oldFull = { uirevision: 'd', scene: { camera: copy(DEFAULT) } };
    const gd = { layout: { uirevision: 'd', scene: {} }, _fullLayout: { uirevision: 'd', scene: { camera: copy(DEFAULT) } } };
    const scene = {
        fullLayout: oldFull,
        getCamera: () => copy(TURNED),
        isCameraChanged(layout) { return JSON.stringify(layout.scene.camera) !== JSON.stringify(TURNED); },
        saveLayout(layout) {
            if (!this.isCameraChanged(layout)) return;
            layout.scene.camera = copy(TURNED);
            this.fullLayout.scene.camera = copy(TURNED);   // Plotly writes to ITS full layout
        }
    };
    gd._fullLayout.scene._scene = scene;
    if (saved) scene.saveLayout(gd.layout);                // the mouseup: into the stale layout
    return { gd, scene };
}

test('a turn saved into a stale full layout is recorded in gd._fullLayout', () => {
    const { gd, scene } = turnedGraph();
    assert.deepEqual(gd._fullLayout.scene.camera, DEFAULT, 'the stand-in reproduces the flaw');
    syncSceneCamera(gd);
    assert.deepEqual(gd._fullLayout.scene.camera, TURNED);
    assert.equal(scene.fullLayout, gd._fullLayout, 'later saves go to the current full layout');
});

test('a turn released outside the plot (never saved) is saved and reported', () => {
    const { gd } = turnedGraph({ saved: false });
    assert.equal(gd.layout.scene.camera, undefined);
    assert.equal(syncSceneCamera(gd), true, 'it says the camera had moved');
    assert.deepEqual(gd.layout.scene.camera, TURNED);
    assert.equal(syncSceneCamera(gd), false, 'nothing new the second time');
});

test('a redraw in place sends the camera on screen, not the one from the settings', () => {
    const { gd } = turnedGraph();
    const layout = { uirevision: 'd', scene: { camera: copy(DEFAULT), bgcolor: 'white' } };
    const out = withShownCamera(gd, layout);
    assert.deepEqual(out.scene.camera, TURNED);
    assert.equal(out.scene.bgcolor, 'white');
    assert.deepEqual(layout.scene.camera, DEFAULT, 'the caller\'s layout is not changed');
    // also when the settings had no camera at all
    assert.deepEqual(withShownCamera(gd, { uirevision: 'd', scene: {} }).scene.camera, TURNED);
});

test('a new graph, another dataset or a 2D plot takes the layout as it is', () => {
    const { gd } = turnedGraph();
    const other = { uirevision: 'another dataset', scene: { camera: copy(DEFAULT) } };
    assert.equal(withShownCamera(gd, other), other);
    const flat = { uirevision: 'd', xaxis: {} };
    assert.equal(withShownCamera(gd, flat), flat);
    const fresh = { layout: {}, _fullLayout: undefined };
    const layout = { uirevision: 'd', scene: { camera: copy(DEFAULT) } };
    assert.equal(withShownCamera(fresh, layout), layout);
    assert.equal(syncSceneCamera(fresh), false);
});
