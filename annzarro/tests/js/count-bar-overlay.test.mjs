/**
 * The Count Plot's Histogram view folds into Bar (operator, 0.8.0): "the histogram is just a type of a bar plot, and we
 * should just add its Overlay option to the bar plot and drop it". A Bar of a number is drawn as the histogram was (each
 * bar at its bin, its bin's width), Bar gains Overlaid, and a link stored with `mode: 'histogram'` opens as a Bar that
 * draws the same figure, with no problem reported.
 *
 * Run:  node --test annzarro/tests/js/count-bar-overlay.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const M = await import('../../../static/js/utils/count-plot-model.js');
const D = await import('../../../static/js/panels/cell-count/draw.js');
const K = await import('../../../static/js/panels/cell-count/controls-model.js');
const { VOCABULARY } = await import('../../../static/js/utils/vocabulary.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');
const { CASES, drawCase } = await import('./fixtures/count-histogram-links.mjs');
const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/count-histogram-figures.json', import.meta.url), 'utf8'));

const obs = (key, extra = {}) => ({ source: { type: 'obs', key }, ...extra });
const norm = (config) => M.normalizeCountPlot({ version: 1, ...config });
const numeric = (source) => ['depth', 'score', 'n'].includes(source.key);

test('there is no Histogram view: not a mode, not in the Mode select, and Bar has Overlaid', () => {
    assert.equal(M.COUNT_MODES.includes('histogram'), false);
    assert.equal(VOCABULARY.countPlot.modeGroups.some((g) => g.modes.includes('histogram')), false);
    assert.deepEqual(VOCABULARY.countPlot.modeGroups[0].modes, ['bar', 'pie']);
    assert.deepEqual([...M.ARRANGEMENTS], ['stack', 'dodge', 'overlay', 'fill']);
    assert.deepEqual(K.rowsOf('bar').arrangement, ['stack', 'dodge', 'overlay', 'fill']);
    assert.equal(VOCABULARY.countPlot.arrangement.overlay, 'Overlaid');
});

test('a link stored as a histogram opens as a Bar, overlaid where it was "dodge", with no problem reported', () => {
    const over = norm({ mode: 'histogram', x: obs('depth'), split: obs('condition'), arrangement: 'dodge' });
    assert.deepEqual(over.problems, []);
    assert.equal(over.config.mode, 'bar');
    assert.equal(over.config.arrangement, 'overlay');
    const stacked = norm({ mode: 'histogram', x: obs('depth'), split: obs('condition') });
    assert.equal(stacked.config.mode, 'bar');
    assert.equal('arrangement' in stacked.config, false, 'stacked is the default');
    // the binning and everything else stays as stored
    const kept = norm({ mode: 'histogram', x: obs('depth', { binning: { method: 'equal_width', bins: 1500, zero_bin: true } }), log: true });
    assert.deepEqual(kept.config.x.binning, { method: 'equal_width', bins: 1500, zero_bin: true });
    assert.equal(kept.config.log, true);
    // a Bar's own dodge is side by side, as before
    assert.equal(norm({ mode: 'bar', x: obs('cell_type'), split: obs('condition'), arrangement: 'dodge' }).config.arrangement, 'dodge');
});

test('every figure a histogram link drew, it draws again as a Bar', () => {
    assert.deepEqual(Object.keys(GOLDEN), CASES.map((c) => c[0]));
    for (const c of CASES) {
        const { config, figure } = drawCase({ M, D, K, theme: PLOT_PALETTES.light }, c);
        assert.equal(config.mode, 'bar', c[0]);
        assert.deepEqual(figure, GOLDEN[c[0]], `${c[0]}: the same figure`);
    }
});

test('a Bar of a number is asked for on the 1D grid, with a histogram\'s bin limit; a Bar of categories as before', () => {
    const ctx = { isNumeric: numeric, levelCount: () => 3 };
    const binned = M.planGrid(norm({ mode: 'bar', x: obs('depth', { binning: { method: 'equal_width', bins: 1500 } }), split: obs('condition') }).config, ctx);
    assert.equal(binned.state, 'ready');
    assert.equal(binned.request.mode, '1d');
    const cats = M.planGrid(norm({ mode: 'bar', x: obs('cell_type'), split: obs('condition') }).config, ctx);
    assert.equal(cats.request.mode, 'categorical');
    // an integer read by its values is categories: the categorical grid
    assert.equal(M.planGrid(norm({ mode: 'bar', x: obs('n', { binning: { method: 'categories' } }) }).config, ctx).request.mode, 'categorical');
    assert.deepEqual(M.binsRange('bar', 'x'), { min: 2, max: 2000 });
    assert.equal(M.binsProblem('bar', 2000, 'x'), null);
    assert.equal(M.binsProblem('bar', 2001, 'x'), 'bad_bins');
});

test('arrangements are graded: side by side cannot place bins of a number, and says why; the rest apply', () => {
    const cats = K.arrangementChoices(norm({ mode: 'bar', x: obs('cell_type'), split: obs('condition') }).config, numeric);
    assert.deepEqual(cats.map((c) => [c.value, c.disabled]), [['stack', false], ['dodge', false], ['overlay', false], ['fill', false]]);
    assert.deepEqual(cats.map((c) => c.label), ['Stacked', 'Side by side', 'Overlaid', '100%']);
    const bins = K.arrangementChoices(norm({ mode: 'bar', x: obs('depth'), split: obs('condition') }).config, numeric);
    const dodge = bins.find((c) => c.value === 'dodge');
    assert.equal(dodge.disabled, true);
    assert.match(dodge.title, /bins/i);
    assert.deepEqual(bins.filter((c) => !c.disabled).map((c) => c.value), ['stack', 'overlay', 'fill']);
    // a stored side by side on bins of a number (X changed after it was chosen) is drawn and shown overlaid, never two things
    const held = norm({ mode: 'bar', x: obs('depth'), split: obs('condition'), arrangement: 'dodge' }).config;
    assert.equal(K.arrangementShown(held, numeric), 'overlay');
    assert.equal(K.arrangementShown({ ...held, x: obs('cell_type') }, numeric), 'dodge');
});

test('Sort by height does not apply to bins of a number, and says why', () => {
    assert.equal(K.sortRefusal(norm({ mode: 'bar', x: obs('cell_type') }).config, numeric), '');
    assert.match(K.sortRefusal(norm({ mode: 'bar', x: obs('depth') }).config, numeric), /bins/i);
});

test('a Bar overlaid on categories is translucent bars over each other; side by side and stacked are opaque', () => {
    const config = norm({ mode: 'bar', x: obs('cell_type'), split: obs('condition'), arrangement: 'overlay' }).config;
    const reply = { reply: { n_counted: 21, n_shown: 21, axes: [{ levels: ['c:a', 'c:b', 'c:c'], n_outside: [0, 0] }, { levels: ['c:p', 'c:q'], n_outside: [0, 0] }] },
        counts: [1, 2, 3, 4, 5, 6], measures: null };
    const table = M.countTable(config, M.readGrid(reply), [{ input: 'x' }, { input: 'split' }]);
    const draw = (c) => D.countFigure(c, table, { options: K.drawOptions(c), words: { count: 'Cells', fill: '%', hoverCount: 'Cells', hoverShare: 'Share', share: () => '' },
        inputNames: { x: 'cell_type', split: 'condition' }, palette: ['#111111'], theme: PLOT_PALETTES.light });
    const over = draw(config);
    assert.equal(over.layout.barmode, 'overlay');
    assert.ok(over.data.every((t) => t.opacity > 0 && t.opacity < 1));
    assert.equal(over.layout.bargap, 0.15, 'categories keep the bar plot\'s gap');
    for (const [arrangement, barmode] of [['dodge', 'group'], ['stack', 'stack']]) {
        const f = draw({ ...config, arrangement });
        assert.equal(f.layout.barmode, barmode);
        assert.ok(f.data.every((t) => t.opacity === undefined), arrangement);
    }
});

test('a density keeps the inputs of a Bar of a number; its zero bin is stored and left out of the request (CNT-6)', () => {
    const bar = norm({ mode: 'bar', x: obs('depth', { binning: { method: 'equal_width', zero_bin: true } }) }).config;
    const density = K.setMode(bar, 'density');
    assert.equal(density.x.binning.zero_bin, true, 'stored');
    const shown = K.shownConfig(density);
    assert.equal(shown.x.binning.zero_bin, undefined, 'a density is smoothed over one run of bins');
    const plan = M.planGrid(shown, { isNumeric: numeric, levelCount: () => 3 });
    assert.equal(plan.request.partitionings[0].binning.zero_bin, undefined);
    // and back to Bar, the zero bin is there again
    assert.equal(K.shownConfig(K.setMode(density, 'bar')).x.binning.zero_bin, true);
});
