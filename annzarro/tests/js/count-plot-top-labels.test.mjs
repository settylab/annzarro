/**
 * C2a: the most frequent level's factor is labelled as an axis is (CNT-18). C1's table carries the factor's axis of
 * the reply as `top.info` (whether it is a boolean column, a grouping's group names), so the drawing labels its levels
 * from it and from the factor's own renames, with no labels of its own passed in (C3's `opts.topLabels` is gone).
 *
 * Run:  node --test annzarro/tests/js/count-plot-top-labels.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../../../static/js/utils/count-plot-model.js');
const D = await import('../../../static/js/panels/cell-count/draw.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');
const { VOCABULARY } = await import('../../../static/js/utils/vocabulary.js');

const obs = (key, extra = {}) => ({ source: { type: 'obs', key }, ...extra });
const norm = (config) => M.normalizeCountPlot({ version: 1, ...config }).config;
const opts = { options: {}, words: VOCABULARY.countPlot, inputNames: { x: 'a', y: 'b', factor: 'f' }, palette: ['#111111', '#222222'],
    theme: PLOT_PALETTES.light };

/** A 1 x 1 heatmap whose factor's axis of the reply is `factor`. */
function tableWith(factor, config) {
    const grid = M.readGrid({ reply: { n_shown: 5, n_counted: 5, axes: [
        { levels: ['c:p'], n_outside: [0, 0] }, { levels: ['c:u'], n_outside: [0, 0] }, { n_outside: [0, 0], ...factor }] },
    counts: [3, 2], measures: null });
    return M.countTable(config, grid, [{ input: 'x' }, { input: 'y' }, { input: 'factor' }]);
}

test('the table carries the factor\'s axis of the reply as top.info', () => {
    const config = norm({ mode: 'heatmap', x: obs('a'), y: obs('b'), value: { kind: 'top_level', factor: obs('is_doublet') } });
    const table = tableWith({ levels: ['c:false', 'c:true'], boolean: true }, config);
    assert.equal(table.top.info.boolean, true);
    assert.deepEqual(table.top.info.levels, ['c:false', 'c:true']);
    assert.deepEqual(table.top.levels, ['c:false', 'c:true']);
});

test('a boolean factor\'s levels are its name and "not" its name', () => {
    const config = norm({ mode: 'heatmap', x: obs('a'), y: obs('b'), value: { kind: 'top_level', factor: obs('is_doublet') } });
    const f = D.countFigure(config, tableWith({ levels: ['c:false', 'c:true'], boolean: true }, config), opts);
    assert.deepEqual(f.data.slice(1).map((s) => s.name), ['not is_doublet', 'is_doublet']);
});

test('a grouping\'s levels are its groups\' names', () => {
    const config = norm({ mode: 'heatmap', x: obs('a'), y: obs('b'), value: { kind: 'top_level', factor: { source: { type: 'cell-group', key: 'cell-grouping-G' } } } });
    const ids = ['g:["c:B"]', 'g:["c:T"]'];
    const f = D.countFigure(config, tableWith({ levels: ids, names: { [ids[0]]: 'B cell', [ids[1]]: 'T cell' } }, config), opts);
    assert.deepEqual(f.data.slice(1).map((s) => s.name), ['B cell', 'T cell']);
});

test('the factor\'s renames are its labels, over the defaults', () => {
    const config = norm({ mode: 'heatmap', x: obs('a'), y: obs('b'), value: { kind: 'top_level', factor: obs('f', { labels: { 'c:A': 'Alpha' } }) } });
    const f = D.countFigure(config, tableWith({ levels: ['c:A', 'c:B'] }, config), { ...opts, topLabels: new Map([['c:A', 'ignored']]) });
    assert.deepEqual(f.data.slice(1).map((s) => s.name), ['Alpha', 'B']);
});

// --- a measure on the wire (lead notes, G7b "Open": planGrid's measures need ctx.inlineRecipe for a score) ----------

test('a score as the statistic carries its recipe inline, and only the fields the server reads', () => {
    const config = norm({ mode: 'bar', x: obs('cell_type'), value: { kind: 'measure' },
        measure: { stat: 'mean', source: { type: 'gene-score', key: 'gene-signature-S', column: 'zscore_mean', layer: 'logged', extra: 1 }, locked: true } });
    const recipe = { genes: ['A', 'B'], method: 'zscore_mean' };
    const ctx = { isNumeric: () => false, levelCount: () => 6,
        inlineRecipe: (source) => (source.type === 'gene-score' ? { recipe } : null) };
    const plan = M.planGrid(config, ctx);
    assert.deepEqual(plan.request.measures, [{ id: 'm0',
        source: { type: 'gene-score', key: 'gene-signature-S', column: 'zscore_mean', layer: 'logged', recipe } }]);
    const column = M.planGrid(norm({ ...config, measure: { stat: 'pct_above', above: 1, source: { type: 'obs', key: 'depth' } } }), ctx);
    assert.deepEqual(column.request.measures, [{ id: 'm0', source: { type: 'obs', key: 'depth' }, above: 1 }]);
});

test('the key names a score statistic by the hash of its recipe, not by its panel or its recipe sent', () => {
    const source = { type: 'gene-score', key: 'gene-signature-S', column: 'zscore_mean' };
    const config = norm({ mode: 'bar', x: obs('cell_type'), value: { kind: 'measure' }, measure: { stat: 'mean', source } });
    const ctxFor = (hash, recipe) => ({ isNumeric: () => false, levelCount: () => 6, inlineRecipe: () => ({ recipe }),
        hashOf: (s) => (s === config.measure.source ? hash : undefined) });
    const a = M.planGrid(config, ctxFor('h1', { genes: ['A'] })).key;
    assert.equal(a, M.planGrid(config, ctxFor('h1', { genes: ['A'] })).key);
    assert.notEqual(a, M.planGrid(config, ctxFor('h2', { genes: ['B'] })).key);
    assert.ok(!a.includes('gene-signature-S'), 'the panel id is not in the key');
});

test('two scores whose recipes hash equal give the same key, whatever their recipe objects', () => {
    const make = () => norm({ mode: 'bar', x: obs('cell_type'), value: { kind: 'measure' },
        measure: { stat: 'mean', source: { type: 'gene-score', key: 'gene-signature-S', column: 'zscore_mean' } } });
    const keyOf = (config) => M.planGrid(config, { isNumeric: () => false, levelCount: () => 6,
        inlineRecipe: () => ({ recipe: { genes: ['A', 'B'] } }), hashOf: (s) => (s === config.measure.source ? 'same' : undefined) }).key;
    const [a, b] = [make(), make()];
    assert.notEqual(a.measure.source, b.measure.source);
    assert.equal(keyOf(a), keyOf(b));
});

test('a field the normaliser keeps on a statistic\'s source never reaches the wire', () => {
    const config = norm({ mode: 'bar', x: obs('cell_type'), value: { kind: 'measure' },
        measure: { stat: 'sum', source: { type: 'obs', key: 'depth', future: { x: 1 } } } });
    assert.deepEqual(config.measure.source.future, { x: 1 }, 'kept in the config');
    const plan = M.planGrid(config, { isNumeric: () => false, levelCount: () => 6 });
    assert.deepEqual(plan.request.measures, [{ id: 'm0', source: { type: 'obs', key: 'depth' } }]);
    assert.ok(!JSON.stringify(plan.request).includes('future'));
});
