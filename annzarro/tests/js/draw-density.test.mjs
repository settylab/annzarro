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
const dense = (c) => { const a = new Float64Array(c.grid ** c.dims); c.cells.forEach((cell, i) => { a[cell] = c.counts[i]; }); return a; };
/** A density on the engine's grid read at the oracle's cell centres (two grid cells per axis straddle each). */
function atOracle(f, c) {
    const r = c.grid / c.bins;
    const at = (i) => (r === 1 ? [i] : [r * i + r / 2 - 1, r * i + r / 2]);
    const out = [];
    for (let i = 0; i < c.bins; i++) {
        if (c.dims === 1) { out.push(at(i).reduce((s, a) => s + f[a], 0) / at(i).length); continue; }
        for (let j = 0; j < c.bins; j++) {
            let s = 0;
            for (const a of at(i)) for (const b of at(j)) s += f[a * c.grid + b];
            out.push(s / (at(i).length * at(j).length));
        }
    }
    return out;
}
const peak = (a) => { let m = 0; for (const v of a) if (v > m) m = v; return m; };
const worst = (got, want) => { let d = 0; for (let i = 0; i < want.length; i++) d = Math.max(d, Math.abs(got[i] - want[i])); return d / peak(want); };

/** An axis of the grid reply as E4 writes a density's: equal-width bins over the padded range, with the pre-pass. */
function axisOf(c, d) {
    const bins = c.grid;
    const step = (c.step[d] * c.bins) / c.grid;
    const edges = Array.from({ length: bins + 1 }, (_, i) => c.lo[d] + i * step);
    return { levels: Array.from({ length: bins }, (_, i) => `bin:${i}`), edges, bins_made: bins, degenerate: false,
        n_outside: [c.n_out, 0],
        density: { n: c.n, sigma: c.sigma[d], bandwidth: c.sigma[d] * c.n ** (-1 / (c.dims + 4)), quantiles: [c.lo[d], c.hi[d]], range: [c.lo[d], c.hi[d]] } };
}
const gridOf = (axes, counts, n) => M.readGrid({ reply: { n_shown: n + 5, n_counted: n, axes }, counts, measures: null });

/** The 1D case `name`, drawn with `options`; `split` cuts every bin's cells into two levels. */
function oneD(name, options, split = false) {
    const c = oracle.cases[name];
    const config = norm({ mode: 'density', x: obs('score'), ...(split ? { split: obs('cell_type') } : {}) });
    const axes = [axisOf(c, 0)];
    let counts = dense(c);
    if (split) {
        axes.push({ levels: ['c:a', 'c:b'], n_outside: [0, 0] });
        counts = Array.from(dense(c)).flatMap((n) => [Math.floor(n / 3), n - Math.floor(n / 3)]);
    }
    const table = M.countTable(config, gridOf(axes, counts, c.n_in), axes.map((_, i) => ({ input: i ? 'split' : 'x' })));
    return { c, config, table, figure: D.densityFigure(config, table, opts(options)) };
}

function twoD(name, options, split = false) {
    const c = oracle.cases[name];
    const config = norm({ mode: 'density2d', x: obs('score'), y: obs('depth'), ...(split ? { split: obs('cell_type') } : {}) });
    const axes = [axisOf(c, 0), axisOf(c, 1)];
    let counts = dense(c);
    if (split) {
        axes.push({ levels: ['c:a', 'c:b'], n_outside: [0, 0] });
        counts = Array.from(counts).flatMap((n) => [Math.floor(n / 3), n - Math.floor(n / 3)]);
    }
    const table = M.countTable(config, gridOf(axes, counts, c.n_in), axes.map((_, i) => ({ input: ['x', 'y', 'split'][i] })));
    return { c, config, table, figure: D.densityFigure(config, table, opts(options)) };
}

// --- the curve against the oracle ------------------------------------------------------------------------------------

for (const name of ['score__a1', 'signed__a0.5', 'depth__a2', 'pseudotime__a1']) {
    test(`${name}: the drawn curve is the oracle's within 2% of its peak, on the centres of the bins`, () => {
        const { c, figure } = oneD(name, { adjust: c0(name) });
        const trace = figure.data[0];
        assert.equal(trace.type, 'scatter');
        assert.equal(trace.mode, 'lines');
        assert.equal(trace.x.length, c.grid);
        assert.ok(Math.abs(trace.x[0] - (c.lo[0] + c.step[0] / 2)) < 1e-9);
        assert.ok(worst(atOracle(trace.y, c), c.density_binned) < 0.02, String(worst(atOracle(trace.y, c), c.density_binned)));
    });
}
function c0(name) { return oracle.cases[name].adjust; }

for (const name of ['umap__a1', 'corr__a1', 'score_depth__a1', 'score_depth__a2', 'umap__a2']) {
    test(`${name} (2D): the image is the oracle's within 2% of its peak, with the diagonal bandwidth`, () => {
        const { c, figure } = twoD(name, { adjust: c0(name), style: 'image' });
        const trace = figure.data[0];
        assert.equal(trace.type, 'heatmap');
        assert.equal(trace.z.length, c.grid);
        // z[iy][ix]; the oracle is [ix][iy]
        const flat = new Float64Array(c.grid * c.grid);
        for (let ix = 0; ix < c.grid; ix++) for (let iy = 0; iy < c.grid; iy++) flat[ix * c.grid + iy] = trace.z[iy][ix];
        const got = atOracle(flat, c);
        assert.ok(worst(got, c.density_binned) < 0.02, String(worst(got, c.density_binned)));
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
    const axis = { ...axisOf(c, 0), n_outside: [1200, 82] };
    const table = M.countTable(config, gridOf([axis], dense(c), c.n_in), [{ input: 'x' }]);
    assert.equal(D.densityFigure(config, table, opts()).notes.range, 'Range from the 0.1st to the 99.9th percentile: 1,282 cells outside are not counted.');
});

test('no cell outside the range says so', () => {
    const { figure } = oneD('score__a1', {});
    assert.equal(figure.notes.range, 'Range from the 0.1st to the 99.9th percentile: all cells are counted.');
});

test('the floor sentence appears only when the floor applies, and the sentence names the raised bandwidth', () => {
    assert.equal(oneD('score__a1', { adjust: 1 }).figure.notes.floor, null);
    // a tenth of Scott's rule on 256 x 256 is finer than 1.5 grid steps on both axes
    const floored = twoD('umap__a1', { adjust: 0.1, style: 'image' }).figure;
    assert.equal(floored.notes.floor, 'Bandwidth raised to the grid\'s resolution.');
    assert.equal(floored.floored, true);
    assert.ok(floored.notes.bandwidth.startsWith('Bandwidth 0.043 and 0.046 (Scott\'s rule × 0.1)'), floored.notes.bandwidth);
});

// --- layout, themes and the contract ---------------------------------------------------------------------------------

test('axes are titled by the input, the range covers the padded grid, and the colors follow the theme', () => {
    for (const theme of ['light', 'dark']) {
        const c = oracle.cases['score__a1'];
        const config = norm({ mode: 'density', x: obs('score') });
        const axes = [axisOf(c, 0)];
        const table = M.countTable(config, gridOf(axes, dense(c), c.n_in), [{ input: 'x' }]);
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
    const axis = axisOf(c, 0);
    delete axis.density;
    const table = M.countTable(config, gridOf([axis], dense(c), c.n_in), [{ input: 'x' }]);
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
    const axis = axisOf(c, 0);
    axis.density = { n: 0 };
    axis.n_outside = [0, 0];
    const table = M.countTable(config, gridOf([axis], new Array(c.grid).fill(0), 0), [{ input: 'x' }]);
    const f = D.densityFigure(config, table, opts());
    assert.deepEqual(f.data, []);
});

test('2D contours of a split are drawn in each level\'s own color, not the default colorscale', () => {
    const { figure } = twoD('umap__a1', { adjust: 1, style: 'contours' }, true);
    const contours = figure.data.filter((t) => t.type === 'contour');
    assert.equal(contours.length, 2);
    for (const t of contours) {
        assert.equal(t.contours.coloring, 'lines');
        assert.deepEqual(t.colorscale, [[0, t.line.color], [1, t.line.color]], 'Plotly colors contour lines from the colorscale, not from line.color');
    }
    assert.notEqual(contours[0].line.color, contours[1].line.color);
});

test('a 2D image of a split shows every level\'s density as opacity on one scale: 0 to the highest density of any level', () => {
    for (const scale of ['level', 'size']) {
        const { figure } = twoD('umap__a1', { adjust: 1, style: 'image', scale }, true);
        const layers = figure.data.filter((t) => t.type === 'heatmap');
        assert.equal(layers.length, 2);
        const peak = layers.reduce((m, t) => t.z.flat().reduce((a, v) => (v > a ? v : a), m), 0);
        for (const t of layers) {
            assert.equal(t.zmin, 0, scale);
            assert.ok(Math.abs(t.zmax - peak) < 1e-12 * peak, `${scale}: zmax ${t.zmax} is the common peak ${peak}`);
            assert.match(t.colorscale[0][1], /, 0\)$/, 'the lowest density is transparent');
        }
    }
});

// --- the layers of a 2D density: opacity image, isolines and filled isolines, in any combination --------------------

const COMBOS = [
    { image: true }, { lines: true }, { fill: true }, { image: true, lines: true }, { image: true, fill: true },
    { fill: true, lines: true }, { image: true, fill: true, lines: true }
];
const kinds = (figure) => figure.data.filter((t) => t.type === 'heatmap' || t.type === 'contour');

test('each combination of layers draws the traces it names, per level of a Color by and for one group', () => {
    for (const layers of COMBOS) {
        for (const split of [true, false]) {
            const { figure } = twoD('umap__a1', { adjust: 1, layers }, split);
            const n = split ? 2 : 1;
            const images = figure.data.filter((t) => t.type === 'heatmap');
            const contours = figure.data.filter((t) => t.type === 'contour');
            const tag = `${JSON.stringify(layers)} split=${split}`;
            assert.equal(images.length, layers.image ? n : 0, tag);
            assert.equal(contours.length, layers.fill || layers.lines ? n : 0, tag);
            for (const t of contours) {
                assert.equal(t.contours.coloring, layers.fill ? 'fill' : 'lines', tag);
                assert.equal(t.contours.showlines, !!layers.lines, tag);
            }
            // the image is under the contours
            if (layers.image && contours.length) assert.ok(figure.data.indexOf(images[0]) < figure.data.indexOf(contours[0]), tag);
        }
    }
});

test('filled isolines of a Color by are bands of constant opacity in the level color, stepping up with the density, on one set of levels', () => {
    const { figure } = twoD('umap__a1', { adjust: 1, layers: { fill: true } }, true);
    const bands = figure.data.filter((t) => t.type === 'contour');
    assert.equal(bands.length, 2);
    const peak = bands.reduce((m, t) => t.z.flat().reduce((a, v) => (v > a ? v : a), m), 0);
    for (const t of bands) {
        assert.equal(t.contours.coloring, 'fill');
        assert.equal(t.contours.size, bands[0].contours.size, 'the same density levels for every group');
        assert.equal(t.contours.start, bands[0].contours.start);
        assert.ok(t.contours.end <= peak + 1e-12);
        assert.equal(t.zmin, 0);
        assert.ok(Math.abs(t.zmax - peak) < 1e-12 * peak);
        assert.match(t.colorscale[0][1], /, 0\)$/, 'below the first level: transparent');
        assert.match(t.colorscale[1][1], /, 0\.9\)$/, 'the top band is the level color at 0.9');
    }
    assert.notEqual(bands[0].colorscale[1][1], bands[1].colorscale[1][1], 'each group in its own color');
    // levels are equally spaced, so the opacity steps by equal amounts
    const k = (bands[0].contours.end - bands[0].contours.start) / bands[0].contours.size;
    assert.ok(Number.isInteger(Math.round(k)) && Math.abs(k - Math.round(k)) < 1e-9);
});

test('one group takes the color map, its direction and its range from the options, for the image and the contours', () => {
    const color = { map: 'Cividis', reverse: true, min: 0.001, max: 0.02 };
    for (const layers of [{ image: true }, { fill: true }, { lines: true }]) {
        const { figure } = twoD('umap__a1', { adjust: 1, layers, color }, false);
        const t = kinds(figure).at(-1);
        assert.equal(t.colorscale, 'Cividis', JSON.stringify(layers));
        assert.equal(t.reversescale, true);
        assert.equal(t.zmin, 0.001);
        assert.equal(t.zmax, 0.02);
        assert.equal(t.showscale, true, 'a color bar for the map');
    }
    const over = twoD('umap__a1', { adjust: 1, layers: { image: true, fill: true } }, false).figure.data.filter((t) => t.type === 'contour')[0];
    assert.ok(over.opacity > 0 && over.opacity < 1, 'filled isolines over the image let it show');
    assert.equal(twoD('umap__a1', { adjust: 1, layers: { fill: true } }, false).figure.data[0].opacity, undefined);
    const plain = twoD('umap__a1', { adjust: 1, layers: { fill: true } }, false).figure.data[0];
    assert.equal(plain.colorscale, 'Viridis', 'the default map');
    assert.equal(plain.zmin, undefined, 'no range set: the data decides');
});

test('a link with the old style maps onto layers', () => {
    assert.deepEqual(M.densityLayers(undefined, 'image', true), { image: true, lines: false, fill: false });
    assert.deepEqual(M.densityLayers(undefined, 'image', false), { image: true, lines: false, fill: false });
    assert.deepEqual(M.densityLayers(undefined, 'contours', true), { image: false, lines: true, fill: false });
    assert.deepEqual(M.densityLayers(undefined, 'contours', false), { image: false, lines: false, fill: true });
    assert.deepEqual(M.densityLayers(undefined, undefined, true), { image: false, lines: true, fill: true }, 'the default with a Color by');
    assert.deepEqual(M.densityLayers(undefined, undefined, false), { image: false, lines: false, fill: true }, 'the default for one group');
    assert.deepEqual(M.densityLayers({ lines: true }, 'image', true), { image: false, lines: true, fill: false }, 'layers win over a style');
    assert.deepEqual(M.densityLayers({}, undefined, true), { image: false, lines: true, fill: true }, 'no layer at all: the default');
    assert.deepEqual(M.densityLayers({ image: true, fill: true }, undefined, false), { image: true, lines: false, fill: true });
});
