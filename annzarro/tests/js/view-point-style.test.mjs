/**
 * The points in a zoomed 2D view (static/js/utils/view-point-style.js), the
 * count the automatic point size and opacity follow there (issue #85).
 *
 * Run:  node --test annzarro/tests/js/view-point-style.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { pointsInView, debounced, SAMPLE } = await import('../../../static/js/utils/view-point-style.js');

const graph = (traces, xrange = [0, 10], yrange = [0, 10], type = 'linear') => ({
    data: traces,
    _fullLayout: { xaxis: { type, range: xrange }, yaxis: { type, range: yrange } }
});

test('counts the shown traces\' points inside both ranges, ends included', () => {
    const gd = graph([
        { type: 'scattergl', x: [0, 5, 10, 11, 5], y: [5, 5, 5, 5, 12] },
        { type: 'scattergl', x: new Float32Array([1, 2]), y: new Float32Array([1, -1]) },
        { type: 'scattergl', visible: 'legendonly', x: [1, 1], y: [1, 1] },
        { type: 'scattergl', meta: 'az-legend', x: [null], y: [null] }
    ], [10, 0], [0, 10]);
    assert.equal(pointsInView(gd, t => t.meta === 'az-legend'), 4);
});

test('no plain count: no graph, 3D, a category or log axis', () => {
    assert.equal(pointsInView(null), null);
    assert.equal(pointsInView({ data: [] }), null);
    assert.equal(pointsInView(graph([], [0, 1], [0, 1], 'category')), null);
    const g3 = graph([]);
    g3._fullLayout.scene = {};
    assert.equal(pointsInView(g3), null);
});

test('above SAMPLE points: every k-th point, across traces, scaled back up', () => {
    const n = SAMPLE + 10;   // stride 2
    const half = Math.floor(n / 2);
    const x = new Float64Array(half).map((_, i) => (i % 4 < 2 ? 1 : -1));   // half of them in view
    const gd = graph([{ type: 'scattergl', x, y: new Float64Array(half).fill(1) },
        { type: 'scattergl', x: x.slice(), y: new Float64Array(half).fill(1) }]);
    const got = pointsInView(gd);
    assert.ok(Math.abs(got - n / 2) <= 4, `${got} vs ${n / 2}`);
});

test('debounced: one run, after the last call', async () => {
    let runs = 0;
    const d = debounced(() => { runs++; }, 20);
    d(); d(); d();
    await new Promise(r => setTimeout(r, 5));
    d();
    assert.equal(runs, 0);
    await new Promise(r => setTimeout(r, 40));
    assert.equal(runs, 1);
    d(); d.cancel();
    await new Promise(r => setTimeout(r, 40));
    assert.equal(runs, 1);
});
