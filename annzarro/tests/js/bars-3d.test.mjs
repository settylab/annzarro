/**
 * The 3D bar builder (UX 6b, WP-10).
 *
 * Run:  node --test annzarro/tests/js/bars-3d.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bars3d, checkBarCap, footprintFromSize, axisTicks, BARS_3D_MAX, BAR_FILL } from '../../../static/js/utils/bars-3d.js';
import { arrayMin, arrayMax } from '../../../static/js/utils/array-stats.js';
import { VOCABULARY as V } from '../../../static/js/utils/vocabulary.js';

const cont = (values, extra = {}) => ({ kind: 'continuous', values, colorscale: 'Viridis', ...extra });

test('n bars give 8n vertices and 10n triangles', () => {
    const r = bars3d({ xs: [0, 1, 2], ys: [0, 0, 1], heights: [1, 2, 3], colour: cont([1, 2, 3]) });
    assert.equal(r.drawn, 3);
    assert.equal(r.trace.type, 'mesh3d');
    assert.equal(r.trace.x.length, 24);
    assert.equal(r.trace.y.length, 24);
    assert.equal(r.trace.z.length, 24);
    assert.equal(r.trace.i.length, 30);
    assert.equal(r.trace.j.length, 30);
    assert.equal(r.trace.k.length, 30);
});

test('geometry of one box: footprint, height, indices in range, no floor face', () => {
    const r = bars3d({ xs: [4], ys: [7], heights: [5], colour: cont([1]) });
    const { x, y, z, i, j, k } = r.trace;
    const half = BAR_FILL / 2;
    assert.ok(Math.abs(arrayMin(x) - (4 - half)) < 1e-5);
    assert.ok(Math.abs(arrayMax(x) - (4 + half)) < 1e-5);
    assert.ok(Math.abs(arrayMin(y) - (7 - half)) < 1e-5);
    assert.ok(Math.abs(arrayMax(y) - (7 + half)) < 1e-5);
    assert.deepEqual([...z], [0, 0, 0, 0, 5, 5, 5, 5]);
    for (const idx of [...i, ...j, ...k]) assert.ok(idx >= 0 && idx < 8);
    // No triangle lies wholly on the floor (vertices 0..3).
    for (let t = 0; t < 10; t++) assert.ok(i[t] >= 4 || j[t] >= 4 || k[t] >= 4);
    // The top is built: a triangle with all three vertices at height.
    assert.ok([...i].some((_, t) => i[t] >= 4 && j[t] >= 4 && k[t] >= 4));
});

test('indices of the second bar are offset by 8', () => {
    const r = bars3d({ xs: [0, 1], ys: [0, 0], heights: [1, 1], colour: cont([1, 2]) });
    for (let t = 10; t < 20; t++) {
        assert.ok(r.trace.i[t] >= 8 && r.trace.j[t] >= 8 && r.trace.k[t] >= 8);
    }
});

test('a gap: fill sets the side, and the default leaves 0.15 between neighbours', () => {
    const r = bars3d({ xs: [0, 1], ys: [0, 0], heights: [1, 1], colour: cont([1, 2]) });
    const x = r.trace.x;
    assert.ok(Math.abs((arrayMin(x.slice(8)) - arrayMax(x.slice(0, 8))) - 0.15) < 1e-5);
    const full = bars3d({ xs: [0], ys: [0], heights: [1], fill: 1, colour: cont([1]) });
    assert.ok(Math.abs(arrayMax(full.trace.x) - arrayMin(full.trace.x) - 1) < 1e-5);
});

test('a negative height spans v..0 and zRange covers it', () => {
    const r = bars3d({ xs: [0, 1], ys: [0, 0], heights: [-3, 2], colour: cont([1, 2]) });
    assert.deepEqual([...r.trace.z.slice(0, 8)], [0, 0, 0, 0, -3, -3, -3, -3]);
    assert.deepEqual(r.zRange, [-3, 2]);
    assert.equal(r.drawn, 2);
});

test('footprint scales the side; dots encode Size as area', () => {
    const f = footprintFromSize(25, 100);
    assert.equal(f, 0.5);
    const r = bars3d({ xs: [0], ys: [0], heights: [1], footprint: [f], colour: cont([1]) });
    const side = arrayMax(r.trace.x) - arrayMin(r.trace.x);
    assert.ok(Math.abs(side - BAR_FILL * 0.5) < 1e-5);
    // Area ratio equals size ratio.
    const a = footprintFromSize(25, 100) ** 2;
    const b = footprintFromSize(100, 100) ** 2;
    assert.ok(Math.abs(a / b - 0.25) < 1e-12);
    assert.ok(Number.isNaN(footprintFromSize(1, 0)));
    assert.ok(Number.isNaN(footprintFromSize(NaN, 10)));
    assert.equal(footprintFromSize(500, 100), 1);
});

test('a footprint of 0 or NaN omits the bar, counted separately', () => {
    const r = bars3d({ xs: [0, 1, 2], ys: [0, 0, 0], heights: [1, 1, 1], footprint: [0, NaN, 1], colour: cont([1, 2, 3]) });
    assert.equal(r.drawn, 1);
    assert.equal(r.skipped.footprint, 2);
});

test('continuous colour: intensity per vertex, constant within a bar, with scale and bar', () => {
    const r = bars3d({
        xs: [0, 1], ys: [0, 0], heights: [1, 2],
        colour: cont([10, 20], { cmin: 0, cmax: 30, cmid: 15, colorbar: { title: { text: 'Mean' } } })
    });
    const t = r.trace;
    assert.equal(t.intensitymode, 'vertex');
    assert.equal(t.intensity.length, 16);
    assert.ok(t.intensity.slice(0, 8).every((v) => v === 10));
    assert.ok(t.intensity.slice(8).every((v) => v === 20));
    assert.equal(t.colorscale, 'Viridis');
    assert.equal(t.cmin, 0);
    assert.equal(t.cmax, 30);
    assert.equal(t.cmid, 15);
    assert.equal(t.showscale, true);
    assert.deepEqual(t.colorbar, { title: { text: 'Mean' } });
    assert.equal(t.facecolor, undefined);
});

test('no colorbar given: no scale shown', () => {
    const r = bars3d({ xs: [0], ys: [0], heights: [1], colour: cont([1]) });
    assert.equal(r.trace.showscale, false);
    assert.equal(r.trace.colorbar, undefined);
});

test('categorical colour: one facecolor per triangle, none of intensity', () => {
    const r = bars3d({ xs: [0, 1], ys: [0, 0], heights: [1, 2], colour: { kind: 'categorical', colors: ['#ff0000', '#00ff00'] } });
    const fc = r.trace.facecolor;
    assert.equal(fc.length, 20);
    assert.ok(fc.slice(0, 10).every((c) => c === '#ff0000'));
    assert.ok(fc.slice(10).every((c) => c === '#00ff00'));
    assert.equal(r.trace.intensity, undefined);
    assert.equal(r.trace.showscale, false);
});

test('hover text on every vertex of a bar', () => {
    const r = bars3d({ xs: [0, 1], ys: [0, 0], heights: [1, 2], colour: cont([1, 2]), hover: ['a', 'b'] });
    const h = r.trace.hovertext;
    assert.equal(h.length, 16);
    assert.ok(h.slice(0, 8).every((s) => s === 'a'));
    assert.ok(h.slice(8).every((s) => s === 'b'));
    assert.equal(r.trace.hoverinfo, 'text');
});

test('no hover given: hover is skipped', () => {
    const r = bars3d({ xs: [0], ys: [0], heights: [1], colour: cont([1]) });
    assert.equal(r.trace.hoverinfo, 'skip');
    assert.equal(r.trace.hovertext, undefined);
});

test('NaN, null and zero heights are omitted and counted; later bars keep their own data', () => {
    const r = bars3d({
        xs: [0, 1, 2, 3, 4], ys: [0, 0, 0, 0, 0], heights: [NaN, null, 0, 4, undefined],
        colour: cont([1, 2, 3, 40, 5]), hover: ['a', 'b', 'c', 'd', 'e']
    });
    assert.equal(r.drawn, 1);
    assert.deepEqual(r.skipped, { nan: 3, zero: 1, footprint: 0 });
    assert.equal(r.trace.x.length, 8);
    assert.ok(r.trace.intensity.every((v) => v === 40));
    assert.ok(r.trace.hovertext.every((s) => s === 'd'));
    assert.ok(Math.abs(arrayMin(r.trace.x) - (3 - BAR_FILL / 2)) < 1e-5);
});

test('a non-finite colour value omits the bar of a continuous colour', () => {
    const r = bars3d({ xs: [0, 1], ys: [0, 0], heights: [1, 1], colour: cont([NaN, 2]) });
    assert.equal(r.drawn, 1);
    assert.equal(r.skipped.nan, 1);
});

test('an empty grid builds an empty trace without throwing', () => {
    const r = bars3d({ xs: [], ys: [], heights: [], colour: cont([]) });
    assert.equal(r.drawn, 0);
    assert.equal(r.trace.x.length, 0);
    assert.deepEqual(r.zRange, [0, 0]);
});

test('ticks: one per index, thinned to the maximum, first kept', () => {
    const labels = Array.from({ length: 10 }, (_, n) => `L${n}`);
    assert.deepEqual(axisTicks(labels), { tickvals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], ticktext: labels });
    const thin = axisTicks(labels, 4);
    assert.deepEqual(thin.tickvals, [0, 3, 6, 9]);
    assert.deepEqual(thin.ticktext, ['L0', 'L3', 'L6', 'L9']);
    assert.deepEqual(axisTicks([]), { tickvals: [], ticktext: [] });
    assert.deepEqual(axisTicks(null), { tickvals: [], ticktext: [] });
    const r = bars3d({ xs: [0], ys: [0], heights: [1], colour: cont([1]), xLabels: ['a', 'b'], yLabels: ['c'] });
    assert.deepEqual(r.ticks.x, { tickvals: [0, 1], ticktext: ['a', 'b'] });
    assert.deepEqual(r.ticks.y, { tickvals: [0], ticktext: ['c'] });
});

test('the cap: at the limit is fine, over it refuses with the spec text', () => {
    assert.equal(BARS_3D_MAX, 40000);
    assert.equal(checkBarCap(40000).ok, true);
    assert.equal(checkBarCap(40000).text, '');
    const over = checkBarCap(262144);
    assert.equal(over.ok, false);
    assert.equal(over.text, '3D draws at most 40,000 bars; this plot has 262,144. Use fewer bins.');
    assert.equal(checkBarCap(50000, { hint: 'matrix' }).text, '3D draws at most 40,000 bars; this plot has 50,000. Use fewer genes or groups.');
    assert.equal(checkBarCap(10, { max: 5 }).ok, false);
    assert.equal(V.view3d.tooMany(40000, 262144), over.text);
});

test('40,000 bars: counts are exact (the build time is reported, not asserted)', () => {
    const n = BARS_3D_MAX;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const heights = new Float64Array(n);
    const values = new Float64Array(n);
    const hover = new Array(n);
    for (let b = 0; b < n; b++) {
        xs[b] = b % 200;
        ys[b] = Math.floor(b / 200);
        heights[b] = 1 + (b % 17);
        values[b] = b % 31;
        hover[b] = `bar ${b}`;
    }
    const t0 = process.hrtime.bigint();
    const r = bars3d({ xs, ys, heights, colour: cont(values), hover });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`bars3d: ${n} bars built in ${ms.toFixed(1)} ms`);
    assert.equal(r.drawn, n);
    assert.equal(r.trace.x.length, 8 * n);
    assert.equal(r.trace.i.length, 10 * n);
});
