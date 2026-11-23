/**
 * The colour of a count plot is the config's (WP-6a): the colour map, Reverse, min, max, centre and the level palette
 * of `config.color` reach every trace that has a colour scale (the 2D histogram, a 2D density, an UpSet's coloured
 * bars) and the level colours of a 2D histogram's layers. Before this, every one of them drew a literal Viridis.
 *
 * Run:  node --test annzarro/tests/js/count-plot-colour.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const M = await import('../../../static/js/utils/count-plot-model.js');
const CM = await import('../../../static/js/panels/cell-count/controls-model.js');
const D = await import('../../../static/js/panels/cell-count/draw.js');
const DD = await import('../../../static/js/panels/cell-count/draw-density.js');
const DS = await import('../../../static/js/panels/cell-count/draw-sets.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');
const oracle = JSON.parse(readFileSync(new URL('../data/oracle/kde.json', import.meta.url), 'utf8'));

const obs = (key) => ({ source: { type: 'obs', key } });
const norm = (config) => M.normalizeCountPlot({ version: 1, ...config }).config;
const words = { count: 'Cell count', fill: '%', hoverCount: 'Cells', hoverShare: 'Share', share: (b) => b, measure: (a) => a, topLevel: (n) => n };
const PALETTE = ['#111111', '#222222', '#333333', '#444444'];
const inputNames = { x: 'a', y: 'b', split: 's', factor: 'f' };
const opts = (config, extra = {}) => ({ options: CM.drawOptions(config), words, inputNames, palette: PALETTE, theme: PLOT_PALETTES.light, ...extra });

const COLOUR = { map: 'Cividis', reverse: true, min: 1, max: 9, center: 5 };

const withContract = ({ counts, ...reply }) => ({
    reply: { n_shown: reply.n_counted, ...reply, axes: reply.axes.map((a) => ({ n_outside: [0, 0], ...a })) }, counts, measures: null });
const tableOf = (config, reply, inputs) => M.countTable(config, M.readGrid(withContract(reply)), inputs.map((input) => ({ input })));

function hist2d(over = {}) {
    const bins = (key, n) => ({ source: { type: 'obs', key }, binning: { method: 'equal_width', bins: n } });
    const config = norm({ mode: 'hist2d', x: bins('a', 3), y: bins('b', 2), ...over });
    const reply = { axes: [{ levels: ['bin:0', 'bin:1', 'bin:2'], edges: [0, 10, 20, 30], bins_made: 3, degenerate: false },
        { levels: ['bin:0', 'bin:1'], edges: [0, 10, 20], bins_made: 2, degenerate: false }], counts: [1, 0, 2, 3, 4, 5], n_counted: 15 };
    return { config, table: tableOf(config, reply, ['x', 'y']) };
}

test('config.color is normalized: a known field is kept, a bad one is reported and dropped', () => {
    const ok = M.normalizeCountPlot({ version: 1, mode: 'hist2d', color: COLOUR });
    assert.deepEqual(ok.config.color, COLOUR);
    assert.deepEqual(ok.problems, []);
    const bad = M.normalizeCountPlot({ version: 1, mode: 'hist2d', color: { map: 3, min: 'x', reverse: 'yes', palette: 'tab10' } });
    assert.deepEqual(bad.config.color, { palette: 'tab10' });
    assert.deepEqual(bad.problems.map((p) => p.field).sort(), ['color.map', 'color.min', 'color.reverse']);
    assert.equal(norm({ mode: 'hist2d', color: {} }).color, undefined, 'an empty colour is no colour');
});

test('drawOptions carries the colour map, Reverse and the limits; nothing stored means Viridis and no limits', () => {
    const o = CM.drawOptions(norm({ mode: 'hist2d', color: COLOUR }));
    assert.equal(o.colorscale, 'Cividis');
    assert.deepEqual(o.colour, { reverse: true, min: 1, max: 9, center: 5 });
    const none = CM.drawOptions(norm({ mode: 'hist2d' }));
    assert.equal(none.colorscale, undefined);
    assert.deepEqual(none.colour, { reverse: false });
});

test('a 2D histogram without a Color by draws the config\'s colour scale, not a literal Viridis', () => {
    const { config, table } = hist2d({ color: COLOUR });
    const t = D.countFigure(config, table, opts(config)).data[0];
    assert.equal(t.colorscale, 'Cividis');
    assert.equal(t.reversescale, true);
    assert.equal(t.zmin, 1);
    assert.equal(t.zmax, 9);
    assert.equal(t.zmid, 5);
    const plain = hist2d();
    const p = D.countFigure(plain.config, plain.table, opts(plain.config)).data[0];
    assert.equal(p.colorscale, 'Viridis');
    assert.equal(p.reversescale, undefined);
    assert.equal(p.zmin, undefined);
});

test('a z-score keeps its diverging map around zero until a map is chosen', () => {
    const base = { mode: 'heatmap', x: obs('a'), y: obs('b'), value: { kind: 'measure' }, measure: { stat: 'zscore', source: { type: 'obs', key: 's' } } };
    const table = (config) => M.countTable(config, M.readGrid({ reply: { n_shown: 16, n_counted: 16, axes: [{ levels: ['c:p', 'c:q'], n_outside: [0, 0] }, { levels: ['c:u', 'c:v'], n_outside: [0, 0] }] },
        counts: [4, 4, 4, 4], measures: [[2, 4, 8, 4, 2], [1, 2, 3, 2, 1], [3, 9, 27, 9, 3], [1, 1, 1, 1, 1]] }), [{ input: 'x' }, { input: 'y' }]);
    const a = norm(base);
    assert.equal(D.countFigure(a, table(a), opts(a)).data[0].colorscale, 'RdBu');
    const b = norm({ ...base, color: { map: 'Cividis' } });
    const t = D.countFigure(b, table(b), opts(b)).data[0];
    assert.equal(t.colorscale, 'Cividis');
    assert.equal(t.zmid, 0);
});

test('the layers of a 2D histogram by a Color by take the palette passed and the max as the top of their scale', () => {
    const config = norm({ mode: 'hist2d', x: { source: { type: 'obs', key: 'a' }, binning: { method: 'equal_width', bins: 2 } },
        y: { source: { type: 'obs', key: 'b' }, binning: { method: 'equal_width', bins: 2 } }, split: obs('s'), color: { max: 7 } });
    const edges = { edges: [0, 1, 2], bins_made: 2, degenerate: false };
    const table = tableOf(config, { axes: [{ levels: ['bin:0', 'bin:1'], ...edges }, { levels: ['bin:0', 'bin:1'], ...edges }, { levels: ['c:p', 'c:q'] }],
        counts: [1, 2, 3, 4, 5, 6, 7, 8], n_counted: 36 }, ['x', 'y', 'split']);
    const fig = D.countFigure(config, table, opts(config));
    const layers = fig.data.filter((t) => t.type === 'heatmap');
    assert.equal(layers.length, 2);
    assert.ok(layers.every((t) => t.zmax === 7), 'Max is the top of every level\'s scale');
    assert.ok(layers[0].colorscale[1][1].startsWith('rgba(17, 17, 17'), 'the palette\'s first colour');
});

function twoD(config) {
    const c = oracle.cases['score_depth__a1'];
    const axis = (d) => {
        const step = (c.step[d] * c.bins) / c.grid;
        return { levels: Array.from({ length: c.grid }, (_, i) => `bin:${i}`), edges: Array.from({ length: c.grid + 1 }, (_, i) => c.lo[d] + i * step), bins_made: c.grid, degenerate: false,
            n_outside: [c.n_out, 0], density: { n: c.n, sigma: c.sigma[d], bandwidth: c.sigma[d] * c.n ** (-1 / 6), quantiles: [c.lo[d], c.hi[d]], range: [c.lo[d], c.hi[d]] } };
    };
    const counts = new Float64Array(c.grid ** 2);
    c.cells.forEach((cell, i) => { counts[cell] = c.counts[i]; });
    return M.countTable(config, M.readGrid({ reply: { n_shown: c.n_in + 5, n_counted: c.n_in, axes: [axis(0), axis(1)] }, counts, measures: null }), [{ input: 'x' }, { input: 'y' }]);
}

test('a 2D density without a split draws the config\'s colour scale, as an image or as contours', () => {
    for (const style of ['image', 'contours']) {
        const config = norm({ mode: 'density2d', x: obs('score'), y: obs('depth'), style, color: { map: 'Inferno', reverse: true, min: 0, max: 3 } });
        const t = DD.densityFigure(config, twoD(config), opts(config)).data[0];
        assert.ok(Array.isArray(t.colorscale), `${style}: Inferno's stops`);
        assert.equal(t.reversescale, true, style);
        assert.equal(t.zmin, 0, style);
        assert.equal(t.zmax, 3, style);
    }
    const plain = norm({ mode: 'density2d', x: obs('score'), y: obs('depth'), style: 'image' });
    assert.equal(DD.densityFigure(plain, twoD(plain), opts(plain)).data[0].colorscale, 'Viridis');
});

test('an UpSet coloured by a number draws the config\'s colour scale on its bars', () => {
    const regions = [1, 2, 3].map((n, i) => ({ key: Uint8Array.from([i === 0 ? 1 : 0, i === 1 ? 1 : 0]), degree: 1, count: 10 * n, share: 0.1, color: n }));
    const plot = { mode: 'upset', universe: 100, inNone: 40, regions, shown: [0, 1, 2], hidden: { regions: 0, cells: 0, share: 0 }, options: { sort: 'size', top: 40, minSize: 0 },
        color: { label: 'Mean', kind: 'statistic' },
        sets: [0, 1].map((i) => ({ index: i, letter: 'AB'[i], name: `set ${i}`, size: 10, noValue: 0, state: 'ok' })) };
    const config = norm({ mode: 'upset', color: COLOUR });
    const m = DS.buildFigure(plot, PLOT_PALETTES.light, { colour: CM.drawOptions(config).colour, colorscale: CM.drawOptions(config).colorscale })
        .data.find((t) => t.name === 'intersections').marker;
    assert.equal(m.colorscale, 'Cividis');
    assert.equal(m.reversescale, true);
    assert.deepEqual([m.cmin, m.cmax, m.cmid], [1, 9, 5]);
    const plain = DS.buildFigure(plot, PLOT_PALETTES.light, {}).data.find((t) => t.name === 'intersections').marker;
    assert.equal(plain.colorscale, 'Viridis');
});

test('colorUse says when a colour map and when a level palette apply', () => {
    const use = (c) => CM.colorUse(norm(c));
    const cats = { mode: 'bar', x: obs('a') };
    assert.deepEqual(use(cats), { map: false, palette: false }, 'a plain bar has neither');
    assert.deepEqual(use({ ...cats, split: obs('s') }), { map: false, palette: true });
    assert.deepEqual(use({ mode: 'hist2d', x: obs('a'), y: obs('b') }), { map: true, palette: false });
    assert.deepEqual(use({ mode: 'hist2d', x: obs('a'), y: obs('b'), split: obs('s') }), { map: false, palette: true });
    assert.deepEqual(use({ mode: 'heatmap', x: obs('a'), y: obs('b'), value: { kind: 'top_level', factor: obs('f') } }), { map: false, palette: true });
    assert.deepEqual(use({ mode: 'heatmap', x: obs('a'), y: obs('b'), value: { kind: 'measure' }, measure: { stat: 'mean', source: { type: 'obs', key: 's' } } }), { map: true, palette: false });
    assert.deepEqual(use({ mode: 'bar', x: obs('a'), value: { kind: 'measure' }, measure: { stat: 'mean', source: { type: 'obs', key: 's' } } }), { map: false, palette: false });
    assert.deepEqual(use({ mode: 'density2d', x: obs('a'), y: obs('b') }), { map: true, palette: false });
    assert.deepEqual(use({ mode: 'density2d', x: obs('a'), y: obs('b'), split: obs('s') }), { map: false, palette: true });
    assert.deepEqual(use({ mode: 'pie', x: obs('a') }), { map: false, palette: true }, 'a pie colours its slices');
    assert.equal(use({ mode: 'upset' }).map, false, 'an UpSet without a colour has no scale');
});

test('a typed limit is a number or empty (auto); anything else says so', () => {
    assert.deepEqual(CM.parseColourLimit(' 2.5 '), { ok: true, value: 2.5 });
    assert.deepEqual(CM.parseColourLimit(''), { ok: true, value: undefined });
    assert.equal(CM.parseColourLimit('abc').ok, false);
    assert.equal(CM.parseColourLimit('abc').message, 'Enter a number, or leave it empty for automatic.');
});
