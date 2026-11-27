/**
 * The Count Plot's views follow the X axis type (operator, 0.8.0): with a number the engine bins, Histogram is the default
 * and Bar stays (bins as categories); with categories, Histogram is disabled with "Histogram needs a numeric axis.", and
 * a stored Histogram of categories falls back to Bar with a one-time note. Histogram keeps its numeric drawing and gains
 * Filled (each bar to 1); its arrangements are graded, side by side disabled with its reason.
 *
 * Run:  node --test annzarro/tests/js/count-views.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const M = await import('../../../static/js/utils/count-plot-model.js');
const D = await import('../../../static/js/panels/cell-count/draw.js');
const K = await import('../../../static/js/panels/cell-count/controls-model.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');
const { CASES, drawCase } = await import('./fixtures/count-histogram-links.mjs');
const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/count-histogram-figures.json', import.meta.url), 'utf8'));

const obs = (key, extra = {}) => ({ source: { type: 'obs', key }, ...extra });
const norm = (config) => M.normalizeCountPlot({ version: 1, ...config }).config;
const isNumeric = (source) => ['depth', 'score', 'n'].includes(source.key);
const NUMERIC_AXIS = 'Histogram needs a numeric axis.';

test('Histogram is graded by the X axis type: disabled with its reason on categories, offered on a number', () => {
    assert.equal(K.modeRefusal(norm({ mode: 'bar', x: obs('cell_type') }), 'histogram', isNumeric), NUMERIC_AXIS);
    assert.equal(K.modeRefusal(norm({ mode: 'bar', x: obs('depth') }), 'histogram', isNumeric), '');
    // an integer read by its values is categories
    assert.equal(K.modeRefusal(norm({ mode: 'bar', x: obs('n', { binning: { method: 'categories' } }) }), 'histogram', isNumeric), NUMERIC_AXIS);
    // no X yet: nothing to grade
    assert.equal(K.modeRefusal(norm({ mode: 'bar' }), 'histogram', isNumeric), '');
    // Bar takes either
    assert.equal(K.modeRefusal(norm({ mode: 'histogram', x: obs('depth') }), 'bar', isNumeric), '');
});

test('choosing a number as X makes Histogram the view; Bar stays available, and categories go back to Bar', () => {
    const bar = norm({ mode: 'bar', x: obs('cell_type') });
    const toNumber = K.viewForX(bar, { ...bar, x: obs('depth') }, isNumeric);
    assert.equal(toNumber.config.mode, 'histogram');
    assert.match(toNumber.note, /Histogram/);
    // Bar chosen on purpose with a number: kept (the X did not change)
    const chosen = norm({ mode: 'histogram', x: obs('depth') });
    assert.equal(K.viewForX(chosen, { ...chosen, mode: 'bar' }, isNumeric).config.mode, 'bar');
    // another number while on Bar keeps Bar: the user chose it for this kind of axis
    const barOfNumber = norm({ mode: 'bar', x: obs('depth') });
    assert.equal(K.viewForX(barOfNumber, { ...barOfNumber, x: obs('score') }, isNumeric).config.mode, 'bar');
    // a categorical X while on Histogram: Bar, said once
    const hist = norm({ mode: 'histogram', x: obs('depth') });
    const toCats = K.viewForX(hist, { ...hist, x: obs('cell_type') }, isNumeric);
    assert.equal(toCats.config.mode, 'bar');
    assert.match(toCats.note, /numeric axis/);
    // nothing else is touched
    const pie = norm({ mode: 'pie', x: obs('cell_type') });
    assert.equal(K.viewForX(pie, { ...pie, x: obs('depth') }, isNumeric).config.mode, 'pie');
});

test('a link stored as a Histogram of categories falls back to Bar with a one-time note; one of a number is untouched', () => {
    const stored = norm({ mode: 'histogram', x: obs('cell_type'), split: obs('condition'), arrangement: 'fill' });
    const back = K.histogramFallback(stored, isNumeric);
    assert.equal(back.config.mode, 'bar');
    assert.equal(back.config.arrangement, 'fill', 'every other field stays');
    assert.equal(back.note, 'Histogram needs a numeric axis, so this plot is drawn as Bar.');
    assert.equal(K.histogramFallback(norm({ mode: 'histogram', x: obs('depth') }), isNumeric), null);
    assert.equal(K.histogramFallback(norm({ mode: 'bar', x: obs('cell_type') }), isNumeric), null);
});

test('Histogram\'s arrangements match Bar\'s where they apply: Overlaid and 100% are added, side by side disabled with why', () => {
    assert.deepEqual([...M.ARRANGEMENTS], ['stack', 'dodge', 'overlay', 'fill']);
    const hist = K.arrangementChoices(norm({ mode: 'histogram', x: obs('depth'), split: obs('condition') }));
    assert.deepEqual(hist.map((c) => [c.value, c.label, c.disabled]),
        [['stack', 'Stacked', false], ['dodge', 'Side by side', true], ['overlay', 'Overlaid', false], ['fill', 'Filled', false]]);
    assert.match(hist[1].title, /bins/i);
    const bar = K.arrangementChoices(norm({ mode: 'bar', x: obs('cell_type'), split: obs('condition') }));
    assert.deepEqual(bar.map((c) => [c.value, c.disabled]), [['stack', false], ['dodge', false], ['fill', false]]);
});

test('the arrangement shown and drawn is never two things: a histogram\'s stored side by side is overlaid, a bar\'s overlaid is side by side', () => {
    assert.equal(M.arrangementShown(norm({ mode: 'histogram', x: obs('depth'), arrangement: 'dodge' })), 'overlay');
    assert.equal(M.arrangementShown(norm({ mode: 'bar', x: obs('cell_type'), arrangement: 'overlay' })), 'dodge');
    assert.equal(M.arrangementShown(norm({ mode: 'histogram', x: obs('depth'), arrangement: 'fill' })), 'fill');
    // stored as it was: switching views and back restores it
    assert.equal(norm({ mode: 'bar', x: obs('cell_type'), arrangement: 'overlay' }).arrangement, 'overlay');
});

test('every figure a histogram link drew, it still draws', () => {
    assert.deepEqual(Object.keys(GOLDEN), CASES.map((c) => c[0]));
    for (const c of CASES) {
        const { config, figure } = drawCase({ M, D, K, theme: PLOT_PALETTES.light }, c);
        assert.equal(config.mode, 'histogram', c[0]);
        assert.deepEqual(figure, GOLDEN[c[0]], `${c[0]}: the same figure`);
    }
});

test('a filled histogram stacks each bin to 1, at the bins\' widths', () => {
    const config = norm({ mode: 'histogram', x: obs('depth', { binning: { method: 'equal_width', bins: 3 } }), split: obs('condition'), arrangement: 'fill' });
    const reply = { reply: { n_counted: 21, n_shown: 21, axes: [{ levels: ['bin:0', 'bin:1', 'bin:2'], edges: [0, 10, 20, 30], bins_made: 3, degenerate: false, n_outside: [0, 0] },
        { levels: ['c:p', 'c:q'], n_outside: [0, 0] }] }, counts: [1, 2, 3, 4, 5, 6], measures: null };
    const table = M.countTable(config, M.readGrid(reply), [{ input: 'x' }, { input: 'split' }]);
    const f = D.countFigure(config, table, { options: K.drawOptions(config), words: { count: 'Cells', fill: 'Fraction of cells in each bar', hoverCount: 'Cells', hoverShare: 'Share', share: () => '' },
        inputNames: { x: 'depth', split: 'condition' }, palette: ['#111111'], theme: PLOT_PALETTES.light });
    assert.equal(f.layout.barmode, 'stack');
    assert.equal(f.layout.barnorm, 'fraction');
    assert.deepEqual(f.data[0].width, [10, 10, 10]);
    assert.equal(f.layout.bargap, 0.02, 'touching bins');
    assert.ok(f.data.every((t) => t.opacity === undefined));
});
