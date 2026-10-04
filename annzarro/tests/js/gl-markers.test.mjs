/**
 * Size/opacity in large-plot mode go to the regl scene directly
 * (static/js/utils/gl-markers.js), not through Plotly.restyle, which reruns
 * calc for every trace and ran the tab out of V8 heap at 95.6M points.
 * Without the scene internals it falls back to Plotly.restyle, warning once.
 *
 * Run:  node --test annzarro/tests/js/gl-markers.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = { addEventListener() {}, getElementById: () => null, createElement: () => ({}) };
const restyles = [];
globalThis.Plotly = new Proxy({}, {
    get: (_, name) => (...args) => { if (name === 'restyle') restyles.push(args.slice(1)); return Promise.resolve(); }
});

const { setGlMarkers, _resetGlMarkersWarning } = await import('../../../static/js/utils/gl-markers.js');
const { DataManager } = await import('../../../static/js/data-manager.js');
void DataManager;
const { restyleMarkers } = await import('../../../static/js/panels/plot-utilities/plot-update.js');

function fakeGd() {
    const calls = { update: null, clear: 0, draw: 0 };
    const traces = [
        { meta: 'az-points', x: [1, 2], marker: { size: 5, opacity: 1 } },
        { meta: 'az-legend', x: [null], marker: { size: 5, opacity: 1 } },   // legend entry: full opacity
        { meta: 'az-points', x: [3, 4], marker: { size: 5, opacity: 1 } }
    ];
    const gd = {
        data: traces,
        _fullData: traces.map(t => ({ ...t, marker: { ...t.marker } })),
        _fullLayout: {
            _plots: { xy: { _scene: {
                markerOptions: traces.map(() => ({ size: 5, opacity: 1 })),
                scatter2d: { update: (u) => { calls.update = u; } },
                draw: () => { calls.draw++; }
            } } },
            _glcanvas: { each: (fn) => [{ regl: { clear: () => { calls.clear++; } } }].forEach(fn) }
        }
    };
    return { gd, calls };
}

const isProxy = (t) => t.meta === 'az-legend';

test('the scene gets the new size and opacity; Plotly state follows; legend entries are left alone', () => {
    const { gd, calls } = fakeGd();
    assert.equal(setGlMarkers(gd, 1.18, 0.16, isProxy), true);
    assert.deepEqual(calls.update, [{ size: 1.18, opacity: 0.16 }, {}, { size: 1.18, opacity: 0.16 }]);
    assert.equal(calls.clear, 1, 'the canvas is cleared before the draw');
    assert.equal(calls.draw, 1);
    const scene = gd._fullLayout._plots.xy._scene;
    assert.deepEqual(scene.markerOptions.map(o => o.size), [1.18, 5, 1.18]);
    assert.deepEqual(gd.data.map(t => t.marker.opacity), [0.16, 1, 0.16]);
    assert.deepEqual(gd._fullData.map(t => t.marker.size), [1.18, 5, 1.18]);
});

test('without the scene internals: false, nothing changed, one warning', () => {
    _resetGlMarkersWarning();
    const warnings = [];
    const warn = console.warn;
    console.warn = (...a) => warnings.push(a.join(' '));
    try {
        const { gd } = fakeGd();
        delete gd._fullLayout._plots.xy._scene.scatter2d;
        assert.equal(setGlMarkers(gd, 2, 0.5, isProxy), false);
        assert.equal(setGlMarkers(gd, 2, 0.5, isProxy), false);
        assert.equal(gd.data[0].marker.size, 5);
        assert.equal(warnings.length, 1, warnings.join('\n'));
        assert.equal(setGlMarkers({ data: [] }, 2, 0.5), false);
    } finally {
        console.warn = warn;
    }
});

test('restyleMarkers: large plots go to the scene, otherwise (or on fallback) Plotly.restyle', async () => {
    const settings = { pointSize: 1.96, pointOpacity: 0.39 };
    const { gd, calls } = fakeGd();
    gd._largePlot = true;
    restyles.length = 0;
    await restyleMarkers(gd, settings);
    assert.equal(restyles.length, 0, 'no restyle in large-plot mode');
    assert.equal(calls.draw, 1);

    const broken = fakeGd().gd;
    broken._largePlot = true;
    delete broken._fullLayout._plots;              // the fallback
    const warn = console.warn; console.warn = () => {};
    try { await restyleMarkers(broken, settings); } finally { console.warn = warn; }
    assert.deepEqual(restyles[0], [{ 'marker.size': 1.96, 'marker.opacity': 0.39 }, [0, 2]]);

    const regular = fakeGd();
    restyles.length = 0;
    await restyleMarkers(regular.gd, settings);   // regular mode: restyle, as before
    assert.equal(restyles.length, 1);
    assert.equal(regular.calls.draw, 0);
});
