/**
 * A 2D density drawn on the cell locations (panels/cell-count/density-points.js): the bin a cell falls in, the density
 * it reads there, the opacity step it is drawn in, the seeded sample above the draw cap and the words that say it.
 *
 * Run:  node --test annzarro/tests/js/density-points.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../../../static/js/panels/cell-count/density-points.js');

test('the caps are named: draw 1,000,000 cells, load 25,000,000', () => {
    assert.equal(P.DENSITY_POINTS_DRAW, 1_000_000);
    assert.equal(P.DENSITY_POINTS_LOAD, 25_000_000);
});

test('a cell falls in the bin whose edges hold it; the top edge belongs to the last bin; outside and NaN fall in none', () => {
    const g = { lo: 10, step: 2, bins: 5 };            // edges 10, 12, 14, 16, 18, 20
    assert.equal(P.binIndex(10, g), 0);
    assert.equal(P.binIndex(11.99, g), 0);
    assert.equal(P.binIndex(12, g), 1);
    assert.equal(P.binIndex(19.9, g), 4);
    assert.equal(P.binIndex(20, g), 4, 'the top edge is in the last bin');
    assert.equal(P.binIndex(20.001, g), -1);
    assert.equal(P.binIndex(9.999, g), -1);
    assert.equal(P.binIndex(NaN, g), -1);
});

test('the density a cell reads is its bin\'s, on the grid x slowest; outside the grid it reads nothing', () => {
    const gx = { lo: 0, step: 1, bins: 3 };
    const gy = { lo: 0, step: 1, bins: 2 };
    const f = Float64Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);   // [ix * 2 + iy]
    assert.equal(P.densityAt(f, gx, gy, 0.5, 1.5), 0.2);
    assert.equal(P.densityAt(f, gx, gy, 2.5, 0.5), 0.5);
    assert.ok(Number.isNaN(P.densityAt(f, gx, gy, 3.5, 0.5)));
    assert.ok(Number.isNaN(P.densityAt(f, gx, gy, 0.5, -1)));
});

test('the opacity steps: the density over the common peak in equal steps, none for no density, the peak in the last', () => {
    assert.equal(P.ALPHA_STEPS, 8);
    assert.equal(P.alphaStep(0, 1), -1);
    assert.equal(P.alphaStep(NaN, 1), -1);
    assert.equal(P.alphaStep(0.0001, 1), 0, 'a little density is the faintest step');
    assert.equal(P.alphaStep(0.125, 1), 0);
    assert.equal(P.alphaStep(0.126, 1), 1);
    assert.equal(P.alphaStep(0.5, 1), 3);
    assert.equal(P.alphaStep(1, 1), 7);
    assert.equal(P.alphaStep(5, 1), 7, 'above the peak: the last step');
    // the opacity of a step rises evenly to the top step's
    const a = Array.from({ length: P.ALPHA_STEPS }, (_, k) => P.stepAlpha(k));
    assert.ok(a.every((v, i) => i === 0 || v > a[i - 1]));
    assert.equal(a[P.ALPHA_STEPS - 1], P.POINT_ALPHA);
});

test('the sample above the cap is exactly the cap, sorted, the same for one seed and another for another', () => {
    assert.equal(P.sampleIndices(900, 1000, 7), null, 'under the cap: every cell');
    assert.equal(P.sampleIndices(1000, 1000, 7), null);
    const s = P.sampleIndices(10_000, 1000, 7);
    assert.equal(s.length, 1000);
    assert.ok(s.every((v, i) => (i === 0 || v > s[i - 1]) && v >= 0 && v < 10_000), 'sorted, distinct and in range');
    assert.deepEqual(Array.from(P.sampleIndices(10_000, 1000, 7)), Array.from(s));
    assert.notDeepEqual(Array.from(P.sampleIndices(10_000, 1000, 8)), Array.from(s));
    // uniform: each tenth of the cells holds about a tenth of the sample
    for (let k = 0; k < 10; k++) {
        const inTenth = s.filter((v) => v >= k * 1000 && v < (k + 1) * 1000).length;
        assert.ok(inTenth > 60 && inTenth < 140, `tenth ${k}: ${inTenth}`);
    }
});

test('the words: all the cells, or a sample of how many, and why the option is refused', () => {
    assert.equal(P.pointsNote(500, 500), 'Cells drawn as points: 500.');
    assert.equal(P.pointsNote(1_000_000, 12_345_678), 'Cells drawn as points: 1,000,000 of 12,345,678 (a sample).');
    assert.match(P.pointsRefusal({ kind: 'too_many', total: 30_000_000, limit: 25_000_000 }), /30,000,000 cells.*25,000,000.*subset/);
    assert.match(P.pointsRefusal({ kind: 'source', input: 'split' }), /Color by/);
    assert.match(P.pointsRefusal({ kind: 'source', input: 'x' }), /X/);
});

// --- the traces ------------------------------------------------------------------------------------------------------

const gx = { lo: 0, step: 1, bins: 2 };
const gy = { lo: 0, step: 1, bins: 2 };
const colors = ['#ff0000', '#0000ff'];

test('with a Color by the points are one trace per level and opacity step, in the level color, none for a cell with no density', () => {
    const x = Float32Array.from([0.5, 0.5, 1.5, 1.5, 0.5]);
    const y = Float32Array.from([0.5, 1.5, 0.5, 1.5, 0.5]);
    const level = Int16Array.from([0, 0, 1, 1, 1]);
    // level 0 density: bins (0,0) = 1.0 (the peak), (0,1) = 0.5; level 1: (1,0) = 0.25, (1,1) = 0, (0,0) = 1.0
    const smooth = [Float64Array.from([1.0, 0.5, 0, 0]), Float64Array.from([1.0, 0, 0.25, 0])];
    const traces = P.pointTraces({ x, y, level }, { gx, gy, smooth, peak: 1, colors, size: 3 });
    const total = traces.reduce((n, t) => n + t.x.length, 0);
    assert.equal(total, 4, 'the cell with no density is not drawn');
    for (const t of traces) {
        assert.equal(t.type, 'scattergl');
        assert.equal(t.mode, 'markers');
        assert.equal(t.hoverinfo, 'skip');
        assert.equal(t.showlegend, false);
        assert.equal(t.marker.size, 3);
        assert.ok(t.x.length < 100_000, 'every piece is under the size at which scattergl builds a hover index');
    }
    const byColor = (c) => traces.filter((t) => t.marker.color.startsWith(`rgba(${c}`));
    assert.equal(byColor('255, 0, 0').reduce((n, t) => n + t.x.length, 0), 2);
    assert.equal(byColor('0, 0, 255').reduce((n, t) => n + t.x.length, 0), 2);
    // the peak is in the last step: the full point opacity
    const peakTrace = traces.find((t) => t.marker.color === `rgba(255, 0, 0, ${P.POINT_ALPHA})`);
    assert.deepEqual(Array.from(peakTrace.x), [0.5]);
    assert.deepEqual(Array.from(peakTrace.y), [0.5]);
    // the half-density cell of level 0 is in the step of half the peak
    const half = traces.find((t) => t.marker.color === `rgba(255, 0, 0, ${P.stepAlpha(P.alphaStep(0.5, 1))})`);
    assert.deepEqual(Array.from(half.y), [1.5]);
});

test('a piece never holds 100,000 points: more cells in one step are cut into several traces, none lost', () => {
    const n = 250_000;
    const x = new Float32Array(n).fill(0.5);
    const y = new Float32Array(n).fill(0.5);
    const traces = P.pointTraces({ x, y, level: new Int16Array(n) }, { gx, gy, smooth: [Float64Array.from([1, 0, 0, 0])], peak: 1, colors, size: 3 });
    assert.equal(traces.length, 3);
    assert.equal(traces.reduce((m, t) => m + t.x.length, 0), n);
    assert.ok(traces.every((t) => t.x.length < 100_000));
});

test('one group: the points carry the density as a number on the plot\'s color map, from 0 to the peak, with a color bar once', () => {
    const x = Float32Array.from([0.5, 1.5]);
    const y = Float32Array.from([0.5, 1.5]);
    const smooth = [Float64Array.from([0.8, 0, 0, 0.2])];
    const scale = { colorscale: 'Cividis', reversescale: true };
    const traces = P.pointTraces({ x, y, level: null }, { gx, gy, smooth, peak: 0.8, colors: [], size: 4, scale, bar: { title: 'Density' } });
    assert.equal(traces.length, 1);
    const [t] = traces;
    assert.deepEqual(Array.from(t.marker.color), [0.8, 0.2].map(Math.fround));
    assert.equal(t.marker.colorscale, 'Cividis');
    assert.equal(t.marker.reversescale, true);
    assert.equal(t.marker.cmin, 0);
    assert.equal(t.marker.cmax, 0.8);
    assert.equal(t.marker.showscale, true);
    assert.equal(t.marker.size, 4);
    assert.equal(t.hoverinfo, 'skip');
});

test('one group with a range set: the points read it, as the other layers do', () => {
    const traces = P.pointTraces({ x: Float32Array.from([0.5]), y: Float32Array.from([0.5]), level: null },
        { gx, gy, smooth: [Float64Array.from([0.5, 0, 0, 0])], peak: 0.5, colors: [], size: 3, scale: { colorscale: 'Viridis', cmin: 0.1, cmax: 0.4 } });
    assert.equal(traces[0].marker.cmin, 0.1);
    assert.equal(traces[0].marker.cmax, 0.4);
    assert.equal(traces[0].marker.showscale, false, 'no color bar unless asked');
});
