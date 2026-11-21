/**
 * The density figure of the count plot (panels/cell-count/draw-density.js, V3, CNT-10, UX 4.4). The grid reply of a
 * density request (E4: the cells binned to 512 bins, or 256 by 256, with the pre-pass's n, sigma and range) is read
 * through the model as C3's tests do, smoothed in the browser, and drawn. The curve is compared with R2's oracle (a
 * Gaussian kernel with a diagonal bandwidth, by direct summation) within 2% of its peak; the three sentences of UX 4.4
 * (bandwidth, range, floor) are read as the strings the interface shows.
 *
 * Run:  node --test annzarro/tests/js/draw-density.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const M = await import('../../../static/js/utils/count-plot-model.js');
const D = await import('../../../static/js/panels/cell-count/draw-density.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');
const oracle = JSON.parse(readFileSync(new URL('../data/oracle/kde.json', import.meta.url), 'utf8'));

const obs = (key) => ({ source: { type: 'obs', key } });
const norm = (config) => M.normalizeCountPlot({ version: 1, ...config }).config;
const PALETTE = ['#111111', '#222222', '#333333', '#444444'];
const inputNames = { x: 'score', y: 'depth', split: 'cell_type', factor: 'f' };
const opts = (options = {}, extra = {}) => ({ options, inputNames, palette: PALETTE, theme: PLOT_PALETTES.light, ...extra });
const peak = (a) => { let m = 0; for (const v of a) if (v > m) m = v; return m; };
const worst = (got, want) => { let d = 0; for (let i = 0; i < want.length; i++) d = Math.max(d, Math.abs(got[i] - want[i])); return d / peak(want); };

/** An axis of the grid reply as E4 writes a density's: equal-width bins over the padded range, with the pre-pass. */
function axisOf(c, d, bins) {
    const edges = Array.from({ length: bins + 1 }, (_, i) => c.lo[d] + i * c.step[d]);
    return { levels: Array.from({ length: bins }, (_, i) => `bin:${i}`), edges, bins_made: bins, degenerate: false,
        n_outside: [c.n_out, 0],
        density: { n: c.n, sigma: c.sigma[d], bandwidth: c.sigma[d] * c.n ** (-1 / (c.dims + 4)), quantiles: [c.lo[d], c.hi[d]], range: [c.lo[d], c.hi[d]] } };
}
const gridOf = (axes, counts, n) => M.readGrid({ reply: { n_shown: n + 5, n_counted: n, axes }, counts, measures: null });

/** The 1D case `name`, drawn with `options`; `split` cuts every bin's cells into two levels. */
function oneD(name, options, split = false) {
    const c = oracle.cases[name];
    const config = norm({ mode: 'density', x: obs('score'), ...(split ? { split: obs('cell_type') } : {}) });
    const axes = [axisOf(c, 0, c.bins)];
    let counts = c.counts;
    if (split) {
        axes.push({ levels: ['c:a', 'c:b'], n_outside: [0, 0] });
        counts = c.counts.flatMap((n) => [Math.floor(n / 3), n - Math.floor(n / 3)]);
    }
    const table = M.countTable(config, gridOf(axes, counts, c.n_in), axes.map((_, i) => ({ input: i ? 'split' : 'x' })));
    return { c, config, table, figure: D.densityFigure(config, table, opts(options)) };
}

function twoD(name, options) {
    const c = oracle.cases[name];
    const config = norm({ mode: 'density2d', x: obs('score'), y: obs('depth') });
    const axes = [axisOf(c, 0, c.bins), axisOf(c, 1, c.bins)];
    const table = M.countTable(config, gridOf(axes, c.counts, c.n_in), [{ input: 'x' }, { input: 'y' }]);
    return { c, config, table, figure: D.densityFigure(config, table, opts(options)) };
}

// --- the curve against the oracle ------------------------------------------------------------------------------------

for (const name of ['score__a1', 'signed__a0.5', 'depth__a2', 'pseudotime__a1']) {
    test(`${name}: the drawn curve is the oracle's within 2% of its peak, on the centres of the bins`, () => {
        const { c, figure } = oneD(name, { adjust: c0(name) });
        const trace = figure.figure ? figure.figure.data[0] : figure.data[0];
        assert.equal(trace.type, 'scatter');
        assert.equal(trace.mode, 'lines');
        assert.equal(trace.x.length, c.bins);
        assert.ok(Math.abs(trace.x[0] - (c.lo[0] + c.step[0] / 2)) < 1e-9);
        assert.ok(worst(trace.y, c.density) < 0.02, String(worst(trace.y, c.density)));
    });
}
function c0(name) { return oracle.cases[name].adjust; }

for (const name of ['umap__a1', 'corr__a1', 'score_depth__a2', 'umap__a0.5', 'score_depth__a0.5']) {
    test(`${name} (2D): the image is the oracle's within 2% of its peak, with the diagonal bandwidth`, () => {
        const { c, figure } = twoD(name, { adjust: c0(name), style: 'image' });
        const trace = figure.data[0];
        assert.equal(trace.type, 'heatmap');
        assert.equal(trace.z.length, c.bins);
        // z[iy][ix]; the oracle is [ix][iy]
        const flat = [];
        for (let ix = 0; ix < c.bins; ix++) for (let iy = 0; iy < c.bins; iy++) flat.push(trace.z[iy][ix]);
        assert.ok(worst(flat, c.density) < 0.02, String(worst(flat, c.density)));
    });
}

test('the contours style draws filled contours of the same numbers', () => {
    const { figure } = twoD('umap__a1', { adjust: 1, style: 'contours' });
    assert.equal(figure.data[0].type, 'contour');
    assert.equal(figure.data[0].contours.coloring, 'fill');
});

test('the adjust scales the bandwidth: a wider one gives a lower, broader peak', () => {
    const narrow = oneD('score__a1', { adjust: 0.5 }).figure.data[0].y;
    const wide = oneD('score__a1', { adjust: 4 }).figure.data[0].y;
    assert.ok(peak(wide) < peak(narrow));
});

// --- a split ---------------------------------------------------------------------------------------------------------

test('a split draws one curve per level, each normalised to 1 by default', () => {
    const { c, figure } = oneD('score__a1', { adjust: 1 }, true);
    assert.equal(figure.data.length, 2);
    for (const t of figure.data) {
        let area = 0;
        for (const v of t.y) area += v * c.step[0];
        assert.ok(Math.abs(area - 1) < 0.03, String(area));
    }
    assert.deepEqual(figure.data.map((t) => t.line.color), ['#111111', '#222222']);
});

test('scaled by size the curves sum to the oracle\'s density of all the cells', () => {
    const { c, figure } = oneD('score__a1', { adjust: 1, scale: 'size' }, true);
    const sum = figure.data[0].y.map((v, i) => v + figure.data[1].y[i]);
    assert.ok(worst(sum, c.density) < 0.02);
});

// --- the sentences of UX 4.4 -----------------------------------------------------------------------------------------

test('the bandwidth sentence names the bandwidth, Scott\'s rule and the adjust', () => {
    const { figure } = oneD('score__a1', { adjust: 1 });
    assert.equal(figure.notes.bandwidth, 'Bandwidth 0.48 (Scott\'s rule × 1.0).');
    assert.equal(oneD('score__a1', { adjust: 2.5 }).figure.notes.bandwidth, 'Bandwidth 1.2 (Scott\'s rule × 2.5).');
});

test('in 2D the bandwidth is per axis and the sentence says it ignores the correlation between X and Y', () => {
    const { figure } = twoD('corr__a1', { adjust: 1 });
    assert.equal(figure.notes.bandwidth, 'Bandwidth 0.93 and 0.98 (Scott\'s rule × 1.0), per axis; it ignores correlation between X and Y.');
});

test('the range sentence counts the cells outside, singular and plural, with thousands separated', () => {
    const { figure } = oneD('depth__a1', {});
    assert.equal(figure.notes.range, 'Range from the 0.1st to the 99.9th percentile: 1 cell outside is not counted.');
    const c = oracle.cases['score__a1'];
    const config = norm({ mode: 'density', x: obs('score') });
    const axis = { ...axisOf(c, 0, c.bins), n_outside: [1200, 82] };
    const table = M.countTable(config, gridOf([axis], c.counts, c.n_in), [{ input: 'x' }]);
    assert.equal(D.densityFigure(config, table, opts()).notes.range, 'Range from the 0.1st to the 99.9th percentile: 1,282 cells outside are not counted.');
});

test('no cell outside the range says so', () => {
    const { figure } = oneD('score__a1', {});
    assert.equal(figure.notes.range, 'Range from the 0.1st to the 99.9th percentile: all cells are counted.');
});

test('the floor sentence appears only when the floor applies, and the sentence names the raised bandwidth', () => {
    assert.equal(oneD('score__a1', { adjust: 1 }).figure.notes.floor, null);
    const floored = twoD('umap__a0.5', { adjust: 0.5, style: 'image' }).figure;
    assert.equal(floored.notes.floor, 'Bandwidth raised to the grid\'s resolution.');
    assert.equal(floored.floored, true);
    assert.ok(floored.notes.bandwidth.startsWith('Bandwidth 0.15 and 0.16 '), floored.notes.bandwidth);
});

// --- layout, themes and the contract ---------------------------------------------------------------------------------

test('axes are titled by the input, the range covers the padded grid, and the colors follow the theme', () => {
    for (const theme of ['light', 'dark']) {
        const c = oracle.cases['score__a1'];
        const config = norm({ mode: 'density', x: obs('score') });
        const axes = [axisOf(c, 0, c.bins)];
        const table = M.countTable(config, gridOf(axes, c.counts, c.n_in), [{ input: 'x' }]);
        const f = D.densityFigure(config, table, opts({}, { theme: PLOT_PALETTES[theme] }));
        assert.equal(f.layout.xaxis.title.text, 'score');
        assert.equal(f.layout.xaxis.color, PLOT_PALETTES[theme].axisColor);
        assert.equal(f.layout.plot_bgcolor, PLOT_PALETTES[theme].bgColor);
        assert.ok(Math.abs(f.layout.xaxis.range[0] - c.lo[0]) < 1e-9 && Math.abs(f.layout.xaxis.range[1] - c.hi[0]) < 1e-6);
    }
});

test('a reply without the pre-pass is a contract error, not a flat curve', () => {
    const c = oracle.cases['score__a1'];
    const config = norm({ mode: 'density', x: obs('score') });
    const axis = axisOf(c, 0, c.bins);
    delete axis.density;
    const table = M.countTable(config, gridOf([axis], c.counts, c.n_in), [{ input: 'x' }]);
    assert.throws(() => D.densityFigure(config, table, opts()), /density/);
});

test('a column of one value draws a marker at the value, not a curve', () => {
    const config = norm({ mode: 'density', x: obs('score') });
    const axis = { levels: ['bin:0'], edges: [3, 3], bins_made: 1, degenerate: true, value: 3, n_outside: [0, 0],
        density: { n: 10, sigma: 0, bandwidth: 0, quantiles: [3, 3], range: [3, 3] } };
    const table = M.countTable(config, gridOf([axis], [10], 10), [{ input: 'x' }]);
    const f = D.densityFigure(config, table, opts());
    assert.equal(f.data.length, 1);
    assert.deepEqual(f.data[0].x, [3, 3]);
});

test('only the density modes draw here', () => {
    const { table } = oneD('score__a1', {});
    assert.throws(() => D.densityFigure(norm({ mode: 'bar', x: obs('score') }), table, opts()), /density/);
});

test('no cell in any bin draws no curve and the sentences still read', () => {
    const c = oracle.cases['score__a1'];
    const config = norm({ mode: 'density', x: obs('score') });
    const axis = axisOf(c, 0, c.bins);
    axis.density = { n: 0 };
    axis.n_outside = [0, 0];
    const table = M.countTable(config, gridOf([axis], new Array(c.bins).fill(0), 0), [{ input: 'x' }]);
    const f = D.densityFigure(config, table, opts());
    assert.deepEqual(f.data, []);
});
