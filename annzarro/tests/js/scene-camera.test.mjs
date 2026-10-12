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

const { syncSceneCamera, withShownCamera, recordCameraOnRelease, CAMERA_SETTLE_MS } = await import('../../../static/js/utils/scene-camera.js');

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

test('a wheel zoom is recorded once the camera has caught up, not at the wheel', async () => {
    // the scene saves on the wheel but reads a camera that lags the input:
    // the stand-in camera reaches the zoomed view only after the wheel event
    const { gd, scene } = turnedGraph({ saved: false });
    const ZOOMED = { ...copy(TURNED), eye: { x: 0.15, y: -0.95, z: 0.3 } };
    let shown = copy(DEFAULT);
    scene.getCamera = () => copy(shown);
    scene.isCameraChanged = (layout) => JSON.stringify(layout.scene.camera) !== JSON.stringify(shown);
    scene.saveLayout = function (layout) {
        if (!this.isCameraChanged(layout)) return;
        layout.scene.camera = copy(shown);
        this.fullLayout.scene.camera = copy(shown);
    };
    scene.saveLayout(gd.layout);
    const listeners = {};
    globalThis.window = { addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); } };
    globalThis.document = { querySelectorAll: () => [gd] };
    const emitted = [];
    gd.emit = (name, data) => emitted.push([name, data]);
    recordCameraOnRelease();
    assert.ok(listeners.wheel && listeners.wheel.length, 'listens to the wheel');

    listeners.wheel.forEach((fn) => fn({}));          // Plotly saves here: the camera is behind
    shown = copy(ZOOMED);                              // then the camera catches up
    assert.equal(emitted.length, 0, 'nothing is recorded at the wheel itself');
    await new Promise((resolve) => setTimeout(resolve, CAMERA_SETTLE_MS + 100));
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0][0], 'plotly_relayout');
    assert.deepEqual(emitted[0][1]['scene.camera'], ZOOMED);
    assert.deepEqual(gd.layout.scene.camera, ZOOMED, 'a later redraw restores the zoom');

    // a burst of wheel steps is one record, after the last
    emitted.length = 0;
    shown = { ...copy(ZOOMED), eye: { x: 0.1, y: -0.5, z: 0.2 } };
    for (let i = 0; i < 3; i++) listeners.wheel.forEach((fn) => fn({}));
    await new Promise((resolve) => setTimeout(resolve, CAMERA_SETTLE_MS + 100));
    assert.equal(emitted.length, 1);
    delete globalThis.window;
    delete globalThis.document;
});
