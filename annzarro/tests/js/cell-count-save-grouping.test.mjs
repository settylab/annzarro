/**
 * C2b: Save as grouping and Show as table of a Cell Count Plot, without a page (CNT-7, CNT-23, UX 4.7, UX 7).
 *
 *   - the recipe is made by G6's model (utils/cell-grouping.js normalizeGrouping) from the plot's own inputs (X, Y,
 *     Color by), with each bin count the plot used written out, and `outside` turned to the grouping's clamp (SHR-45);
 *   - the dialog's lines: the factors with their bins, the groups the plot shows, and the clamp sentence only when cells
 *     are affected;
 *   - over the grouping limits (SHR-13), Save is refused with the reason and by how much; nothing is built;
 *   - Show as table shows exactly the CSV's rows (one column specification), cut with a sentence past its row cap.
 *
 * Run:  node --test annzarro/tests/js/cell-count-save-grouping.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'offline in test' });

const G = await import('../../../static/js/panels/cell-count/save-grouping.js');
const T = await import('../../../static/js/panels/cell-count/table-view.js');
const M = await import('../../../static/js/utils/count-plot-model.js');
const D = await import('../../../static/js/panels/cell-count/draw.js');
const { normalizeGrouping, GROUPING_LIMITS } = await import('../../../static/js/utils/cell-grouping.js');
const { VOCABULARY } = await import('../../../static/js/utils/vocabulary.js');

const obs = (key, extra = {}) => ({ source: { type: 'obs', key }, ...extra });
const norm = (config) => M.normalizeCountPlot({ version: 1, ...config }).config;
const NUMERIC = new Set(['depth', 'score', 'total_counts']);
const page = { isNumeric: (source) => source.type === 'obs' && NUMERIC.has(source.key), levelCount: () => 3 };

/** A grid reply as the group store holds it: axes `{levels, n_outside}` (binned ones with their edges), counts. */
function gridOf(axes, counts, outside = 0) {
    return M.readGrid({
        reply: { n_shown: counts.reduce((a, b) => a + b, 0) + outside, n_counted: counts.reduce((a, b) => a + b, 0),
            axes: axes.map((levels, i) => {
                const bins = levels.filter((id) => id.startsWith('bin:')).length;
                const binned = bins ? { edges: Array.from({ length: bins + 1 }, (_, k) => k), bins_made: bins, degenerate: false } : {};
                return { levels, ...binned, n_outside: i === 0 ? [outside, 0] : [0, 0] };
            }) },
        counts, measures: null
    });
}
const inputsOf = (config) => M.planGrid(config, page).inputs;
const nameOf = (config) => (field) => (field === 'factor' ? config.value.factor : config[field]).source.key;
const plan = (config, grid) => G.savePlan(config, grid, inputsOf(config), { nameOf: nameOf(config) });
const bins = (n) => Array.from({ length: n }, (_, i) => `bin:${i}`);

test('a bar by cell type and condition saves both as factors, through the grouping model', () => {
    const config = norm({ mode: 'bar', x: obs('cell_type'), split: obs('condition') });
    const grid = gridOf([['c:B', 'c:T', 'c:NK'], ['c:ctrl', 'c:stim']], [10, 5, 7, 0, 3, 3]);
    const out = plan(config, grid);
    assert.equal(out.available, true);
    assert.deepEqual(out.recipe, normalizeGrouping({ partitionings: [obs('cell_type'), obs('condition')] }).recipe);
    assert.equal(out.groups, 5, 'the groups are the combinations that hold a cell');
    assert.deepEqual(out.lines, ['Factors: cell_type, condition. 5 groups.']);
    assert.equal(out.problem, null);
});

test('a binned input keeps the bins the plot drew; outside cells go into the end bins, and the dialog says so', () => {
    const config = norm({ mode: 'histogram', x: obs('total_counts'), split: obs('age') });
    const counts = [];
    for (let b = 0; b < 50; b++) counts.push(b % 2, 1, 0);
    const grid = gridOf([bins(50), ['c:young', 'c:mid', 'c:old']], counts, 41);
    const out = plan(config, grid);
    const p = out.recipe.partitionings[0];
    assert.deepEqual(p.binning, { method: 'equal_width', bins: 50 }, 'the count plot\'s default 50 is written; outside is the grouping\'s clamp');
    assert.equal(p.binning.outside, undefined);
    assert.deepEqual(normalizeGrouping(out.recipe).problems, [], 'the recipe is a valid grouping as it is');
    assert.equal(out.groups, 75);
    assert.deepEqual(out.lines, [
        'Factors: total_counts (50 bins), age. 75 groups.',
        '41 cells outside the range will go into the end bins (a grouping keeps every cell).'
    ]);
    assert.equal(out.clamped, 41);
    const one = plan(config, gridOf([bins(50), ['c:young', 'c:mid', 'c:old']], counts, 1));
    assert.equal(one.lines[1], '1 cell outside the range will go into the end bins (a grouping keeps every cell).');
});

test('a stored range and a manual binning are kept as the plot has them', () => {
    const config = norm({ mode: 'histogram', x: obs('depth', { binning: { method: 'equal_width', bins: 20, range: [1, null] } }) });
    const out = plan(config, gridOf([bins(20)], Array(20).fill(1)));
    assert.deepEqual(out.recipe.partitionings[0].binning, { method: 'equal_width', bins: 20, range: [1, null] });
    const manual = norm({ mode: 'histogram', x: obs('depth', { binning: { method: 'manual', thresholds: [1, 2] } }) });
    const m = plan(manual, gridOf([bins(3)], [1, 1, 1]));
    assert.deepEqual(m.recipe.partitionings[0].binning, { method: 'manual', thresholds: [1, 2] });
    assert.deepEqual(m.lines, ['Factors: depth (3 bins). 3 groups.']);
});

test('a heatmap saves X and Y; a 2D histogram\'s most frequent level colors the plot and is not a factor', () => {
    const heat = norm({ mode: 'heatmap', x: obs('cell_type'), y: obs('condition') });
    assert.equal(plan(heat, gridOf([['c:B', 'c:T'], ['c:ctrl', 'c:stim']], [1, 1, 1, 0])).recipe.partitionings.length, 2);
    const h2 = norm({ mode: 'hist2d', x: obs('depth'), y: obs('score'), value: { kind: 'top_level', factor: obs('cell_type') } });
    const counts = Array(100 * 100 * 3).fill(0);
    counts[0] = 4; counts[1] = 2; counts[3 * 101 + 2] = 1;          // two rectangles hold cells, one with two cell types
    const out = plan(h2, gridOf([bins(100), bins(100), ['c:B', 'c:T', 'c:NK']], counts));
    assert.deepEqual(out.recipe.partitionings.map((q) => q.source.key), ['depth', 'score']);
    assert.equal(out.groups, 2);
    assert.equal(out.lines[0], 'Factors: depth (100 bins), score (100 bins). 2 groups.');
});

test('over the grouping\'s 2,000 groups Save is refused with the reason and by how much', () => {
    const config = norm({ mode: 'hist2d', x: obs('depth'), y: obs('score') });
    const counts = Array(100 * 100).fill(0);
    for (let i = 0; i < 6840; i++) counts[i] = 1;
    const out = plan(config, gridOf([bins(100), bins(100)], counts));
    assert.equal(out.groups, 6840);
    assert.equal(out.problem, `Would make 6,840 groups; a grouping holds up to ${GROUPING_LIMITS.groups.toLocaleString('en-US')}. Use fewer bins first.`);
});

test('a factor with more bins than a grouping takes is refused by name, never saved with its bins dropped', () => {
    const config = norm({ mode: 'histogram', x: obs('depth', { binning: { method: 'equal_width', bins: 1500 } }) });
    const counts = Array(1500).fill(0);
    counts[0] = 3;
    const out = plan(config, gridOf([bins(1500)], counts));
    assert.equal(out.problem, 'depth has 1,500 bins; a factor of a grouping holds up to 1,000. Use fewer bins first.');
});

test('densities and sets are not offered: their bins are the smoothing grid, and a set is not a factor', () => {
    for (const config of [norm({ mode: 'density', x: obs('depth') }), norm({ mode: 'density2d', x: obs('depth'), y: obs('score') })]) {
        assert.equal(G.saveOffered(config), false, config.mode);
    }
    assert.equal(G.saveOffered(norm({ mode: 'upset', sets: [{ source: { type: 'table', key: 'cell-table-1' } }] })), false);
    for (const mode of ['bar', 'histogram', 'pie', 'hist2d', 'heatmap']) assert.equal(G.saveOffered(norm({ mode, x: obs('depth') })), true, mode);
});

test('the dialog\'s buttons and title are the vocabulary\'s', () => {
    const words = VOCABULARY.countPlot.saveGrouping;
    assert.equal(words.title, 'Save as grouping');
    assert.equal(words.save, 'Save');
    assert.equal(words.cancel, 'Cancel');
});

// --- Show as table ---------------------------------------------------------------------------------------------------

test('Show as table holds exactly the CSV\'s rows, headers first', () => {
    const config = norm({ mode: 'bar', x: obs('cell_type'), split: obs('condition') });
    const grid = gridOf([['c:B', 'c:T'], ['c:ctrl', 'c:stim']], [10, 5, 7, 3]);
    const table = M.countTable(config, grid, inputsOf(config));
    const opts = { inputNames: { x: 'cell_type', split: 'condition' }, headers: VOCABULARY.countPlot.csv };
    const rows = D.countRows(config, table, opts);
    assert.equal(M.tableCsv(rows), D.countCsv(config, table, opts), 'one column specification for the CSV and the table');
    const view = T.tableView(rows);
    assert.deepEqual(view.header, ['cell_type', 'condition', 'Cells', 'Share']);
    assert.equal(view.rows.length, 4);
    assert.deepEqual(view.rows[0].slice(0, 3), ['B', 'ctrl', 10]);
    assert.equal(view.cut, null);
});

test('a table longer than its cap shows the first rows and says the CSV has them all', () => {
    const header = ['x', 'Cells', 'Share'];
    const rows = [header, ...Array.from({ length: 2500 }, (_, i) => [`l${i}`, i, null])];
    const view = T.tableView(rows);
    assert.equal(view.rows.length, 2000);
    assert.equal(view.cut, 'Showing the first 2,000 of 2,500 rows; Download CSV has them all.');
});
