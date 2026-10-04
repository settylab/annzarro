/**
 * Size/opacity of 2D plots go to the regl scene directly
 * (static/js/utils/gl-markers.js), not through Plotly.restyle, which reruns
 * calc for every trace: out of V8 heap at 95.6M points, the heap nearly
 * doubled at 5M. Without the scene internals it falls back to
 * Plotly.restyle, warning once; 3D plots always restyle.
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
        { type: 'scattergl', meta: 'az-points', x: [1, 2], marker: { size: 5, opacity: 1 } },
        { type: 'scattergl', meta: 'az-legend', x: [null], marker: { size: 5, opacity: 1 } },   // legend entry: full opacity
        { type: 'scattergl', meta: 'az-points', x: [3, 4], marker: { size: 5, opacity: 1 } },
        { type: 'scattergl', name: 'Focused Cell', x: [3], marker: { size: 10, opacity: 1 } }
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
const style = (size, opacity) => (t) => (isProxy(t) ? null : { size, opacity });

test('the scene gets the new size and opacity; Plotly state follows; legend entries are left alone', () => {
    const { gd, calls } = fakeGd();
    assert.equal(setGlMarkers(gd, style(1.18, 0.16)), true);
    assert.deepEqual(calls.update, [{ size: 1.18, opacity: 0.16 }, {}, { size: 1.18, opacity: 0.16 }, { size: 1.18, opacity: 0.16 }]);
    assert.equal(calls.clear, 1, 'the canvas is cleared before the draw');
    assert.equal(calls.draw, 1);
    const scene = gd._fullLayout._plots.xy._scene;
    assert.deepEqual(scene.markerOptions.map(o => o.size), [1.18, 5, 1.18, 1.18]);
    assert.deepEqual(gd.data.map(t => t.marker.opacity), [0.16, 1, 0.16, 0.16]);
    assert.deepEqual(gd._fullData.map(t => t.marker.size), [1.18, 5, 1.18, 1.18]);
});

test('without the scene internals: false, nothing changed, one warning', () => {
    _resetGlMarkersWarning();
    const warnings = [];
    const warn = console.warn;
    console.warn = (...a) => warnings.push(a.join(' '));
    try {
        const { gd } = fakeGd();
        delete gd._fullLayout._plots.xy._scene.scatter2d;
        assert.equal(setGlMarkers(gd, style(2, 0.5)), false);
        assert.equal(setGlMarkers(gd, style(2, 0.5)), false);
        assert.equal(gd.data[0].marker.size, 5);
        assert.equal(warnings.length, 1, warnings.join('\n'));
        assert.equal(setGlMarkers({ data: [] }, style(2, 0.5)), false);
        const svg = fakeGd().gd;                     // a trace that is not scattergl: group i is not trace i
        svg._fullData[2].type = 'scatter';
        assert.equal(setGlMarkers(svg, style(2, 0.5)), false);
    } finally {
        console.warn = warn;
    }
});

test('restyleMarkers: 2D plots go to the scene (the highlight at twice the size), 3D and fallback restyle', async () => {
    const settings = { pointSize: 1.96, pointOpacity: 0.39 };
    const { gd, calls } = fakeGd();
    restyles.length = 0;
    await restyleMarkers(gd, settings);
    assert.equal(restyles.length, 0, 'no restyle for a 2D plot');
    assert.equal(calls.draw, 1);
    assert.deepEqual(calls.update, [{ size: 1.96, opacity: 0.39 }, {}, { size: 1.96, opacity: 0.39 }, { size: 3.92 }]);

    const broken = fakeGd().gd;
    delete broken._fullLayout._plots;              // the fallback
    const warn = console.warn; console.warn = () => {};
    try { await restyleMarkers(broken, settings); } finally { console.warn = warn; }
    assert.deepEqual(restyles[0], [{ 'marker.size': 1.96, 'marker.opacity': 0.39 }, [0, 2]]);
    assert.deepEqual(restyles[1], [{ 'marker.size': 3.92 }, [3]]);

    const flat = fakeGd();
    flat.gd.data.forEach(t => { t.type = 'scatter3d'; });   // 3D: restyle, no scene
    restyles.length = 0;
    await restyleMarkers(flat.gd, settings);
    assert.equal(restyles.length, 2);
    assert.equal(flat.calls.draw, 0);
});
