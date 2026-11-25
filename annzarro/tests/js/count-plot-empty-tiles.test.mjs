/**
 * What a 2D histogram draws for a tile with no cells, by the statistic it is coloured by: where zero is a real value
 * (a count, a share, a sum) the tile is drawn at 0 in the colour scale's 0 colour, with a hover that says so; where the
 * statistic is undefined with no cells (mean, SD, fraction of cells, z-score) it stays empty.
 *
 * Run:  node --test annzarro/tests/js/count-plot-empty-tiles.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../../../static/js/utils/count-plot-model.js');
const CM = await import('../../../static/js/panels/cell-count/controls-model.js');
const D = await import('../../../static/js/panels/cell-count/draw.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');

const obs = (key) => ({ source: { type: 'obs', key } });
const norm = (config) => M.normalizeCountPlot({ version: 1, ...config }).config;
const words = {
    count: 'Cell count', fill: '%', hoverCount: 'Cells', hoverShare: 'Share',
    share: (base) => `Share of ${base}`, measure: (stat, source) => `${stat} of ${source}`, topLevel: (n) => n
};
const PALETTE = ['#111111', '#222222'];
const inputNames = { x: 'a', y: 'b', split: 's', factor: 'f' };
const bins = (key, n) => ({ source: { type: 'obs', key }, binning: { method: 'equal_width', bins: n } });
const edges = (n) => ({ edges: Array.from({ length: n + 1 }, (_, i) => i * 10), bins_made: n, degenerate: false });

/** 3 x 2 bins; the tile at x = 1, y = 0 (row 2 of the table, `[0][1]` of z) has no cells. */
const COUNTS = [1, 0, 2, 3, 4, 5];
const MOMENTS_ROWS = [[1, 4, 16, 1, 0], [0, 0, 0, 0, 0], [2, 6, 20, 2, 0], [3, 3, 5, 0, 0], [4, 8, 20, 4, 0], [5, 5, 7, 0, 0]];

function figure(over, withMeasure, counts = COUNTS) {
    const config = norm({ mode: 'hist2d', x: bins('a', 3), y: bins('b', 2), ...over });
    const reply = { axes: [{ levels: ['bin:0', 'bin:1', 'bin:2'], ...edges(3), n_outside: [0, 0] }, { levels: ['bin:0', 'bin:1'], ...edges(2), n_outside: [0, 0] }],
        counts, n_counted: 15, n_shown: 15 };
    const grid = M.readGrid({ reply, counts, measures: withMeasure ? MOMENTS_ROWS : null });
    const table = M.countTable(config, grid, [{ input: 'x' }, { input: 'y' }]);
    return D.countFigure(config, table, { options: CM.drawOptions(config), words, inputNames, palette: PALETTE, theme: PLOT_PALETTES.light, measureSource: 'score' });
}
const measure = (stat) => ({ value: { kind: 'measure' }, measure: { stat, source: { type: 'obs', key: 'score' } } });
/** z of the empty tile: the table's row 1 is x = 0, y = 1, so z[1][0]. */
const empty = (f) => ({ z: f.data[0].z[1][0], hover: f.data[0].hovertext[1][0] });

test('a count draws the empty tile at 0 and says "0 cells" in its hover', () => {
    const t = empty(figure({}));
    assert.equal(t.z, 0);
    assert.match(t.hover, /Cells: 0/);
});

for (const of of ['all', 'x', 'y']) {
    test(`a share of ${of} draws the empty tile at 0 %, with its hover`, () => {
        const f = figure({ value: { kind: 'share', of } });
        const t = empty(f);
        assert.equal(t.z, 0, 'zero is a real share');
        assert.match(t.hover, /Cells: 0/);
        assert.match(t.hover, /Share: 0$/);
    });
}

test('a sum draws the empty tile at 0, and the hover names the sum', () => {
    const f = figure(measure('sum'), true);
    const t = empty(f);
    assert.equal(t.z, 0);
    assert.match(t.hover, /Cells: 0/);
    assert.match(t.hover, /sum of score: 0/);
});

for (const stat of ['mean', 'sd', 'pct_above', 'zscore']) {
    test(`${stat} leaves the empty tile empty: it has no value`, () => {
        const f = figure(measure(stat), true);
        assert.equal(empty(f).z, null);
        // the tiles that have cells are drawn
        assert.ok(f.data[0].z.flat().filter((v) => v !== null).length >= 5);
    });
}

test('an auto colour range then starts at 0: the zeros are part of the values, none is stretched or clamped', () => {
    const t = figure({}).data[0];
    assert.equal(t.zmin, undefined, 'auto');
    assert.equal(t.z.flat().filter((v) => v !== null).reduce((m, v) => (v < m ? v : m), Infinity), 0);
    const mine = figure({ color: { min: 2 } }).data[0];
    assert.equal(mine.zmin, 2, 'a typed Min is still the scale\'s');
});

test('with a Color by, an empty tile of a level is a real 0 of that level\'s layer, with a hover', () => {
    const config = norm({ mode: 'hist2d', x: bins('a', 2), y: bins('b', 2), split: obs('s') });
    const ax = (n) => ({ levels: Array.from({ length: n }, (_, i) => `bin:${i}`), ...edges(n), n_outside: [0, 0] });
    const counts = [1, 0, 2, 3, 4, 5, 0, 6];
    const reply = { axes: [ax(2), ax(2), { levels: ['c:p', 'c:q'], n_outside: [0, 0] }], counts, n_counted: 21, n_shown: 21 };
    const table = M.countTable(config, M.readGrid({ reply, counts, measures: null }), [{ input: 'x' }, { input: 'y' }, { input: 'split' }]);
    const f = D.countFigure(config, table, { options: CM.drawOptions(config), words, inputNames, palette: PALETTE, theme: PLOT_PALETTES.light });
    const layers = f.data.filter((t) => t.type === 'heatmap');
    const zeros = layers.map((l) => l.z.flat().filter((v) => v === 0).length);
    assert.deepEqual(zeros, [1, 1], 'one empty tile in each level');
    for (const l of layers) {
        const at = l.z.flatMap((row, j) => row.map((v, i) => (v === 0 ? [j, i] : null))).find(Boolean);
        assert.match(l.hovertext[at[0]][at[1]], /Cells: 0/);
    }
});

test('a share within X of a column with no cell at all is 0 % too: it is the share of nothing, drawn as a real 0', () => {
    // x = 1 holds no cell (rows 2 and 3 of the table)
    const f = figure({ value: { kind: 'share', of: 'x' } }, false, [1, 2, 0, 0, 4, 5]);
    assert.deepEqual([f.data[0].z[0][1], f.data[0].z[1][1]], [0, 0]);
    assert.match(f.data[0].hovertext[0][1], /Cells: 0/);
    assert.match(f.data[0].hovertext[0][1], /Share: 0$/);
});
