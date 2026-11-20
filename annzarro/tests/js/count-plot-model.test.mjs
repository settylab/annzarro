/**
 * The count plot's model (utils/count-plot-model.js): the stored config, the grid request of each mode with its limits
 * checked first, the table of each mode, shares by each base, measures, the z-score, the most frequent level, the
 * strip numbers and the CSV (C1).
 *
 * Expected numbers come from F0's fixture (tests/data/grouping_expected.json, "grid") and are recomputed here from the
 * fixture's own obs columns by brute force, so a wrong reading of the fixture shows.
 *
 * Run:  node --test annzarro/tests/js/count-plot-model.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expected, columns, categoryLabels } from './fixtures/grouping.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = (name) => JSON.parse(fs.readFileSync(path.join(here, '..', 'data', 'golden', `${name}.json`), 'utf8'));

const M = await import('../../../static/js/utils/count-plot-model.js');

const obs = (key, extra = {}) => ({ source: { type: 'obs', key }, ...extra });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

/** What the interface knows of the fixture's columns: numeric or not, and how many levels a categorical one has. */
const NUMERIC = new Set(['pseudotime', 'depth', 'constant', 'signed', 'is_doublet', 'batch', 'score']);
const ctxOf = (extra = {}) => ({
    isNumeric: (source) => NUMERIC.has(source.key) && source.type === 'obs' || source.type === 'layer',
    levelCount: (p) => (columns.obs[p.source.key] && columns.obs[p.source.key].categories ? columns.obs[p.source.key].categories.length : null),
    subset: null,
    ...extra
});

const withContract = (reply, extra = {}) => ({ n_shown: reply.n_counted + (extra.left || 0), ...reply,
    axes: reply.axes.map((a, i) => {
        const bins = a.levels.filter((id) => id.startsWith('bin:')).length;
        const binned = bins ? { edges: Array.from({ length: bins + 1 }, (_, k) => k), bins_made: bins, degenerate: false } : {};
        return { n_outside: i === 0 ? [extra.outside || 0, 0] : [0, 0], ...binned, ...a };
    }) });
const gridOf = (name, extra) => M.readGrid(withContract(expected.grid[name], extra));

// --- the stored config ---------------------------------------------------------------------------------------------

test('a golden count config is read unchanged: nothing added, nothing dropped', () => {
    for (const name of ['cell_count_bar_split_measure', 'cell_count_upset_8_tables']) {
        const raw = golden(name);
        const { config, problems } = M.normalizeCountPlot(raw);
        assert.deepEqual(problems, [], name);
        assert.deepEqual(config, raw, name);
    }
});

test('defaults are not written, and unknown fields are kept', () => {
    const { config } = M.normalizeCountPlot({ version: 1, mode: 'bar', x: obs('cell_type'), arrangement: 'stack',
        value: { kind: 'count' }, futureField: { a: 1 } });
    assert.deepEqual(config, { version: 1, mode: 'bar', x: obs('cell_type'), futureField: { a: 1 } });
});

test('a bin count is kept as typed, including 10 and up to 2,000', () => {
    for (const bins of [10, 50, 1500, 2000]) {
        const { config, problems } = M.normalizeCountPlot({ version: 1, mode: 'histogram',
            x: obs('depth', { binning: { method: 'equal_width', bins } }) });
        assert.deepEqual(problems, [], String(bins));
        assert.equal(config.x.binning.bins, bins);
    }
    const bad = M.normalizeCountPlot({ version: 1, mode: 'histogram', x: obs('depth', { binning: { method: 'equal_width', bins: 2001 } }) });
    assert.ok(bad.problems.some((p) => p.reason === 'bad_bins'));
});

test('outside = exclude survives in an input', () => {
    const { config } = M.normalizeCountPlot({ version: 1, mode: 'histogram',
        x: obs('depth', { binning: { method: 'equal_width', bins: 20, range: [0, 5], outside: 'exclude' } }) });
    assert.equal(config.x.binning.outside, 'exclude');
    assert.deepEqual(config.x.binning.range, [0, 5]);
});

test('a bad field is reported and repaired, not thrown', () => {
    const { config, problems } = M.normalizeCountPlot({ version: 1, mode: 'nope', x: 3, arrangement: 'wide',
        value: { kind: 'share', of: 'sideways' }, measure: { stat: 'median', source: obs('score').source } });
    assert.equal(config.mode, 'bar');
    assert.ok(!('x' in config) && !('arrangement' in config) && !('measure' in config));
    const reasons = problems.map((p) => p.reason).sort();
    assert.deepEqual(reasons, ['bad_arrangement', 'bad_input', 'bad_measure', 'bad_mode', 'bad_value']);
});

test('a newer version is returned as it is and reported', () => {
    const raw = { version: 2, mode: 'bar', thing: 1 };
    const { config, problems } = M.normalizeCountPlot(raw);
    assert.deepEqual(config, raw);
    assert.deepEqual(problems, [{ field: 'version', reason: 'newer_version' }]);
});

test('the ids are the frozen ones', () => {
    assert.deepEqual([...M.COUNT_MODES], ['bar', 'histogram', 'hist2d', 'density', 'density2d', 'pie', 'heatmap', 'venn', 'upset']);
    assert.deepEqual([...M.MEASURE_STATS], ['mean', 'sum', 'pct_above', 'sd', 'zscore']);
    assert.deepEqual([...M.SHARE_BASES], ['all', 'x', 'split', 'row', 'column', 'total']);
    assert.deepEqual([...M.ARRANGEMENTS], ['stack', 'dodge', 'fill']);
});

// --- inputs per mode (CNT-6) ---------------------------------------------------------------------------------------

test('each mode reads the inputs of UX 4.2', () => {
    const reads = (mode) => M.modeReads(mode);
    assert.deepEqual(reads('bar'), { x: true, y: false, split: true, sets: false });
    assert.deepEqual(reads('pie'), { x: true, y: false, split: false, sets: false });
    assert.deepEqual(reads('histogram'), { x: true, y: false, split: true, sets: false });
    assert.deepEqual(reads('hist2d'), { x: true, y: true, split: false, sets: false });
    assert.deepEqual(reads('heatmap'), { x: true, y: true, split: false, sets: false });
    assert.deepEqual(reads('density2d'), { x: true, y: true, split: true, sets: false });
    assert.deepEqual(reads('venn'), { x: false, y: false, split: false, sets: true });
});

test('inputs a mode cannot read stay stored and are listed as kept for other modes', () => {
    const config = { version: 1, mode: 'bar', x: obs('cell_type'), y: obs('pseudotime'), split: obs('condition'),
        sets: [{ source: { type: 'table', key: 'cell-table-1' }, member: { levels: ['@in'] } }] };
    assert.deepEqual(M.keptForOtherModes(config), ['y', 'sets']);
    assert.deepEqual(M.keptForOtherModes({ ...config, mode: 'pie' }), ['y', 'split', 'sets']);
    assert.deepEqual(M.keptForOtherModes({ ...config, mode: 'venn' }), ['x', 'y', 'split']);
    const switched = M.normalizeCountPlot({ ...config, mode: 'heatmap' }).config;
    assert.deepEqual(switched.y, config.y, 'the mode change drops nothing');
});

// --- the grid request and its limits -------------------------------------------------------------------------------

const planOf = (config, ctx = ctxOf()) => M.planGrid(M.normalizeCountPlot({ version: 1, ...config }).config, ctx);

test('no X, no Y or too few sets is an empty plot with the reason', () => {
    assert.deepEqual(planOf({ mode: 'bar' }), { state: 'empty', reason: 'choose_x' });
    assert.deepEqual(planOf({ mode: 'hist2d', x: obs('depth') }), { state: 'empty', reason: 'choose_y' });
    assert.deepEqual(planOf({ mode: 'venn', sets: [] }), { state: 'empty', reason: 'choose_sets' });
});

test('a numeric mode with a categorical X is unusable, and nothing is sent', () => {
    const plan = planOf({ mode: 'histogram', x: obs('cell_type') });
    assert.deepEqual(plan, { state: 'unusable', reason: 'needs_numeric', mode: 'histogram', input: 'x' });
    assert.equal(planOf({ mode: 'density', x: obs('cell_type') }).reason, 'needs_numeric');
    assert.equal(planOf({ mode: 'hist2d', x: obs('depth'), y: obs('cell_type') }).input, 'y');
});

test('a Venn of four sets is unusable and an UpSet of seventeen is over the limit', () => {
    const set = (i) => ({ source: { type: 'table', key: `cell-table-${i}` }, member: { levels: ['@in'] } });
    const sets = (n) => Array.from({ length: n }, (_, i) => set(i));
    assert.deepEqual(planOf({ mode: 'venn', sets: sets(4) }), { state: 'unusable', reason: 'too_many_sets', mode: 'venn', count: 4, limit: 3 });
    assert.equal(planOf({ mode: 'venn', sets: sets(3) }, ctxOf({ memberFor: () => ({ levels: ['@in'] }) })).state, 'ready');
    const over = planOf({ mode: 'upset', sets: sets(17) });
    assert.deepEqual(over, { state: 'refused', reason: 'too_many_sets', mode: 'upset', inputs: ['sets'], counts: [17], limits: [16], over: ['sets'] });
    assert.equal(planOf({ mode: 'upset', sets: sets(16) }, ctxOf({ memberFor: () => ({ levels: ['@in'] }) })).state, 'ready');
});

test('each mode refuses over its limit before any request, with the counts and limits', () => {
    const many = { levelCount: (p) => ({ sample: 380, cell_type: 14, age: 12, condition: 2 })[p.source.key] ?? null };
    const bar = planOf({ mode: 'bar', x: obs('sample') }, ctxOf(many));
    assert.deepEqual(bar, { state: 'refused', reason: 'too_many_levels', mode: 'bar', inputs: ['x'], counts: [380], limits: [200], over: ['x'] });
    assert.equal(planOf({ mode: 'pie', x: obs('sample') }, ctxOf(many)).limits[0], 200);
    const heat = planOf({ mode: 'heatmap', x: obs('sample'), y: obs('cell_type') }, ctxOf(many));
    assert.deepEqual([heat.counts, heat.limits, heat.over], [[380, 14], [200, 200], ['x']]);
    const hist = planOf({ mode: 'histogram', x: obs('depth'), split: obs('sample') }, ctxOf(many));
    assert.deepEqual([hist.reason, hist.counts, hist.limits, hist.over], ['too_many_levels', [50, 380], [2000, 200], ['split']]);
    const two = planOf({ mode: 'density2d', x: obs('depth'), y: obs('pseudotime'), split: obs('age') }, ctxOf(many));
    assert.deepEqual([two.counts, two.limits, two.over], [[256, 256, 12], [512, 512, 8], ['split']]);
    assert.equal(planOf({ mode: 'bar', x: obs('cell_type') }, ctxOf(many)).state, 'ready');
});

test('bins over the mode limit are refused with the count, and the typed range is known', () => {
    const plan = planOf({ mode: 'hist2d', x: obs('depth', { binning: { method: 'equal_width', bins: 600 } }), y: obs('pseudotime') });
    assert.deepEqual([plan.state, plan.reason, plan.counts, plan.limits, plan.over], ['refused', 'too_many_bins', [600, 100], [512, 512], ['x']]);
    assert.deepEqual(M.binsRange('histogram'), { min: 2, max: 2000 });
    assert.deepEqual(M.binsRange('hist2d'), { min: 2, max: 512 });
    assert.equal(M.binsProblem('histogram', 2001), 'bad_bins');
    assert.equal(M.binsProblem('histogram', 2000), null);
    assert.equal(M.binsProblem('hist2d', 513), 'bad_bins');
    assert.equal(M.binsProblem('hist2d', 1.5), 'bad_bins');
});

test('a bar of a categorical column is a categorical grid, with no codes, no small groups and nothing else', () => {
    const plan = planOf({ mode: 'bar', x: obs('cell_type'), split: obs('condition') });
    assert.equal(plan.state, 'ready');
    const r = plan.request;
    assert.equal(r.shape, 'grid');
    assert.equal(r.mode, 'categorical');
    assert.deepEqual(r.partitionings.map((p) => p.source.key), ['cell_type', 'condition']);
    assert.ok(!('small' in r) && !('want' in r) && !('measures' in r) && !('features' in r));
    assert.deepEqual(plan.inputs.map((i) => i.input), ['x', 'split']);
    assert.equal(r.subset, null);
});

test('the default is equal width, 50 bins in a histogram and 100 per axis in a 2D histogram, outside excluded', () => {
    const one = planOf({ mode: 'histogram', x: obs('depth') }).request;
    assert.equal(one.mode, '1d');
    assert.deepEqual(one.partitionings[0].binning, { method: 'equal_width', bins: 50, outside: 'exclude', edges_from: 'shown' });
    const two = planOf({ mode: 'hist2d', x: obs('depth'), y: obs('pseudotime') }).request;
    assert.equal(two.mode, '2d');
    for (const p of two.partitionings) assert.deepEqual(p.binning, { method: 'equal_width', bins: 100, outside: 'exclude', edges_from: 'shown' });
});

test('a stored binning is sent as stored, with outside excluded and an edited range', () => {
    const request = planOf({ mode: 'histogram', x: obs('depth', { binning: { method: 'log', bins: 30, range: [1, null] } }) }).request;
    assert.deepEqual(request.partitionings[0].binning, { method: 'log', bins: 30, range: [1, null], outside: 'exclude', edges_from: 'shown' });
});

test('a density asks for the two passes at the fixed grid: 512 bins, and 256 by 256 in 2D', () => {
    const one = planOf({ mode: 'density', x: obs('depth'), split: obs('condition') }).request;
    assert.equal(one.density, true);
    assert.equal(one.partitionings[0].binning.bins, 512);
    const two = planOf({ mode: 'density2d', x: obs('depth'), y: obs('pseudotime') }).request;
    assert.deepEqual(two.partitionings.map((p) => p.binning.bins), [256, 256]);
    assert.ok(!('density' in planOf({ mode: 'histogram', x: obs('depth') }).request));
});

test('the measure goes on the wire only when the height or colour is a measure', () => {
    const measure = { stat: 'zscore', source: { type: 'obs', key: 'score' }, above: 5 };
    const on = planOf({ mode: 'bar', x: obs('cell_type'), value: { kind: 'measure' }, measure }).request;
    assert.deepEqual(on.measures, [{ id: 'm0', source: { type: 'obs', key: 'score' }, above: 5 }]);
    const off = planOf({ mode: 'bar', x: obs('cell_type'), value: { kind: 'count' }, measure }).request;
    assert.ok(!('measures' in off));
});

test('most frequent level adds its factor as the last axis; sets send their members and bitsets', () => {
    const top = planOf({ mode: 'heatmap', x: obs('cell_type'), y: obs('condition'), value: { kind: 'top_level', factor: obs('sample') } });
    assert.deepEqual(top.request.partitionings.map((p) => p.source.key), ['cell_type', 'condition', 'sample']);
    assert.deepEqual(top.inputs.map((i) => i.input), ['x', 'y', 'factor']);
    const flags = [true, false, true];
    const sets = [{ source: { type: 'table', key: 'cell-table-1' }, member: { levels: ['@in'] } },
        { source: { type: 'obs', key: 'depth' }, member: { op: '>', value: 2 } }];
    const plan = planOf({ mode: 'venn', sets }, ctxOf({ bitsetFor: (s) => (s.type === 'table' ? flags : null), memberFor: (s) => s.member }));
    assert.equal(plan.request.mode, 'sets');
    assert.deepEqual(plan.request.partitionings[0].source, { type: 'table', ref: 's0' });
    assert.deepEqual(plan.request.sets, { s0: { encoding: 'bitset-base64', length: 3, data: 'BQ==' } });
    assert.deepEqual(plan.request.partitionings[1].member, { op: '>', value: 2 });
    assert.deepEqual(plan.request.partitionings[0].member, { levels: ['@in'] });
});

// --- the table of each mode ----------------------------------------------------------------------------------------

const scores = columns.obs.score.values;
const byGroup = () => {
    const types = categoryLabels('cell_type');
    const conds = categoryLabels('condition');
    const out = new Map();
    types.forEach((t, i) => {
        const key = `${t}|${conds[i]}`;
        if (!out.has(key)) out.set(key, []);
        out.get(key).push(scores[i]);
    });
    return out;
};
const stats = (vs, above) => {
    const n = vs.length;
    const sum = vs.reduce((s, v) => s + v, 0);
    const mean = sum / n;
    const sd = Math.sqrt(vs.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
    return { n, sum, mean, sd, pct: (100 * vs.filter((v) => v > above).length) / n };
};

const barConfig = { version: 1, mode: 'bar', x: obs('cell_type'), split: obs('condition'), value: { kind: 'measure' },
    measure: { stat: 'mean', source: { type: 'obs', key: 'score' }, above: 5 } };
const barTable = (over = {}) => {
    const config = M.normalizeCountPlot({ ...barConfig, ...over }).config;
    const g = gridOf('cell_type_x_condition');
    return { config, table: M.countTable(config, g, [{ input: 'x' }, { input: 'split' }]) };
};

test('a bar table has one row per x and split level, in the engine order, with the fixture counts', () => {
    const { table } = barTable();
    assert.equal(table.rows, 12);
    assert.deepEqual(Array.from(table.count), expected.grid.cell_type_x_condition.counts);
    assert.deepEqual(M.levelsAt(table, 0), ['c:B cell', 'c:ctrl']);
    assert.deepEqual(M.levelsAt(table, 11), ['c:Platelet', 'c:treated']);
    assert.equal(table.total, 1200);
});

test('every measure statistic equals the brute-force statistic of the cells', () => {
    const groups = byGroup();
    const { config, table } = barTable();
    for (const stat of M.MEASURE_STATS.filter((s) => s !== 'zscore')) {
        const values = M.measureValues(table, stat);
        for (let r = 0; r < table.rows; r++) {
            const [type, cond] = M.levelsAt(table, r).map((id) => id.slice(2));
            const want = stats(groups.get(`${type}|${cond}`), 5);
            const field = { mean: want.mean, sum: want.sum, sd: want.sd, pct_above: want.pct }[stat];
            near(values[r], field, `${stat} ${type} ${cond}`);
        }
    }
    assert.equal(M.heightValues(config, table)[0] > 0, true);
});

test('the z-score is the group mean against the mean and SD of all counted cells', () => {
    const { table } = barTable();
    const all = stats(Array.from(scores), 5);
    const groups = byGroup();
    const z = M.measureValues(table, 'zscore');
    for (let r = 0; r < table.rows; r++) {
        const [type, cond] = M.levelsAt(table, r).map((id) => id.slice(2));
        near(z[r], (stats(groups.get(`${type}|${cond}`), 5).mean - all.mean) / all.sd, `z ${type} ${cond}`);
    }
});

test('a group with no measured cell has no value, and a constant measure has z-score 0', () => {
    const grid = M.readGrid(withContract({ axes: [{ levels: ['c:a', 'c:b'] }], counts: [3, 2], n_counted: 5,
        measure: [[0, 0, 0, 0, 0], [2, 4, 8, 0, 0]] }));
    const table = M.countTable({ version: 1, mode: 'bar', x: obs('k') }, grid, [{ input: 'x' }]);
    const mean = M.measureValues(table, 'mean');
    assert.ok(Number.isNaN(mean[0]));
    assert.equal(mean[1], 2);
    assert.ok(Number.isNaN(M.measureValues(table, 'sum')[0]));
    assert.equal(M.measureValues(table, 'zscore')[1], 0);
});

test('shares by each base add to 1 within the base and equal the count over its total', () => {
    const { table } = barTable();
    const counts = Array.from(table.count);
    const types = 6, conds = 2;
    const all = M.shareValues(table, 'all');
    near(all[0], counts[0] / 1200, 'all');
    near(all.reduce((s, v) => s + v, 0), 1, 'all adds to 1');
    const x = M.shareValues(table, 'x');
    for (let t = 0; t < types; t++) near(x[t * conds] + x[t * conds + 1], 1, `x level ${t}`);
    near(x[0], counts[0] / (counts[0] + counts[1]), 'within x');
    const split = M.shareValues(table, 'split');
    for (let c = 0; c < conds; c++) {
        let s = 0;
        for (let t = 0; t < types; t++) s += split[t * conds + c];
        near(s, 1, `split level ${c}`);
    }
    near(split[2], counts[2] / (counts[0] + counts[2] + counts[4] + counts[6] + counts[8] + counts[10]), 'within split');
    assert.equal(M.shareValues(table, 'all'), all, 'memoised: the same array comes back');
});

test('a heatmap has shares of the row, the column and the total', () => {
    const grid = gridOf('cell_type_x_condition');
    const config = { version: 1, mode: 'heatmap', x: obs('cell_type'), y: obs('condition') };
    const table = M.countTable(config, grid, [{ input: 'x' }, { input: 'y' }]);
    const c = Array.from(table.count);
    const row = M.shareValues(table, 'row');
    near(row[0], c[0] / (c[0] + c[2] + c[4] + c[6] + c[8] + c[10]), 'row: the cells with the same y');
    const column = M.shareValues(table, 'column');
    near(column[0], c[0] / (c[0] + c[1]), 'column: the cells with the same x');
    near(M.shareValues(table, 'total')[0], c[0] / 1200, 'total');
    assert.deepEqual(M.shareBasesFor(config), ['row', 'column', 'total']);
});

test('the bases offered follow the mode and the split', () => {
    assert.deepEqual(M.shareBasesFor({ mode: 'bar', x: obs('a') }), ['all']);
    assert.deepEqual(M.shareBasesFor({ mode: 'bar', x: obs('a'), split: obs('b') }), ['all', 'x', 'split']);
    assert.deepEqual(M.shareBasesFor({ mode: 'histogram', x: obs('a'), split: obs('b') }), ['all', 'x', 'split']);
    assert.deepEqual(M.shareBasesFor({ mode: 'pie', x: obs('a') }), ['all']);
    assert.deepEqual(M.shareBasesFor({ mode: 'upset', sets: [] }), ['all']);
});

test('height follows the value: count, a share of the chosen base, or a measure', () => {
    const { table } = barTable({ value: { kind: 'count' } });
    assert.equal(M.heightValues({ ...barConfig, value: { kind: 'count' } }, table), table.count);
    const share = M.heightValues({ ...barConfig, value: { kind: 'share', of: 'x' } }, table);
    assert.equal(share, M.shareValues(table, 'x'));
    const unset = M.heightValues({ ...barConfig, value: { kind: 'share' } }, table);
    assert.equal(unset, M.shareValues(table, 'all'), 'the base defaults to all');
    const measure = M.heightValues(barConfig, table);
    assert.equal(measure, M.measureValues(table, 'mean'));
});

test('a numeric axis drops its cells without a value and counts them apart', () => {
    const grid = gridOf('pseudotime_x_cell_type');
    const config = { version: 1, mode: 'heatmap', x: obs('pseudotime', { binning: { method: 'equal_width', bins: 5 } }), y: obs('cell_type') };
    const table = M.countTable(config, grid, [{ input: 'x' }, { input: 'y' }]);
    assert.equal(table.rows, 5 * 6, '@na is not a bin');
    const c = expected.grid.pseudotime_x_cell_type.counts;
    const naCells = c.slice(5 * 6);
    assert.deepEqual(table.noValue, { x: naCells.reduce((s, v) => s + v, 0), y: 0 });
    assert.equal(table.total, 1200 - table.noValue.x);
    assert.equal(table.counted, 1200);
});

test('a categorical axis keeps its levels, even @other', () => {
    const grid = gridOf('kept_other_x_condition');
    const table = M.countTable({ version: 1, mode: 'bar', x: obs('cell_type'), split: obs('condition') }, grid, [{ input: 'x' }, { input: 'split' }]);
    assert.deepEqual([M.levelsAt(table, 0)[0], M.levelsAt(table, 2)[0]], ['c:T cell', '@other']);
    assert.equal(table.rows, 4);
});

test('the most frequent level of each rectangle, and its share', () => {
    const grid = gridOf('three_axes');
    const config = { version: 1, mode: 'heatmap', x: obs('cell_type'), y: obs('condition'),
        value: { kind: 'top_level', factor: obs('is_doublet') } };
    const table = M.countTable(config, grid, [{ input: 'x' }, { input: 'y' }, { input: 'factor' }]);
    const c = expected.grid.three_axes.counts;
    assert.equal(table.rows, 12);
    for (let r = 0; r < 12; r++) {
        const a = c[2 * r], b = c[2 * r + 1];
        assert.equal(table.count[r], a + b);
        assert.equal(table.top.level[r], b > a ? 1 : 0, `rectangle ${r}`);
        near(table.top.share[r], Math.max(a, b) / (a + b), `share ${r}`);
    }
    assert.deepEqual(table.top.levels, ['c:false', 'c:true']);
});

test('a tie goes to the first level and an empty rectangle has none', () => {
    const grid = M.readGrid(withContract({ axes: [{ levels: ['c:a'] }, { levels: ['c:b'] }, { levels: ['c:p', 'c:q'] }], counts: [2, 2], n_counted: 4 }));
    const table = M.countTable({ version: 1, mode: 'heatmap', x: obs('a'), y: obs('b'), value: { kind: 'top_level', factor: obs('f') } }, grid,
        [{ input: 'x' }, { input: 'y' }, { input: 'factor' }]);
    assert.equal(table.top.level[0], 0);
    const empty = M.readGrid(withContract({ axes: [{ levels: ['c:a'] }, { levels: ['c:p', 'c:q'] }], counts: [0, 0], n_counted: 0 }));
    const t2 = M.countTable({ version: 1, mode: 'bar', x: obs('a'), value: { kind: 'top_level', factor: obs('f') } }, empty, [{ input: 'x' }, { input: 'factor' }]);
    assert.equal(t2.top.level[0], -1);
    assert.ok(Number.isNaN(t2.top.share[0]));
});

test('a pie keeps its 12 largest levels and collects the rest into other', () => {
    const levels = Array.from({ length: 15 }, (_, i) => `c:L${i}`);
    const counts = levels.map((_, i) => 100 - i * 5);
    const grid = M.readGrid(withContract({ axes: [{ levels }], counts, n_counted: counts.reduce((s, v) => s + v, 0) }));
    const table = M.countTable({ version: 1, mode: 'pie', x: obs('k') }, grid, [{ input: 'x' }]);
    assert.equal(table.rows, 13);
    assert.equal(M.levelsAt(table, 12)[0], '@other');
    assert.equal(table.count[12], counts.slice(12).reduce((s, v) => s + v, 0));
    assert.equal(table.total, grid.counted);
    const small = M.readGrid(withContract({ axes: [{ levels: levels.slice(0, 12) }], counts: counts.slice(0, 12), n_counted: 1 }));
    assert.equal(M.countTable({ version: 1, mode: 'pie', x: obs('k') }, small, [{ input: 'x' }]).rows, 12);
});

test('a set grid is a table of regions, whatever the mode', () => {
    const grid = M.readGrid(withContract({ axes: [{ levels: ['@in', '@out'] }, { levels: ['@in', '@out'] }], counts: [10, 20, 30, 40], n_counted: 100 }));
    const table = M.countTable({ version: 1, mode: 'upset' }, grid, [{ input: 'sets', set: 0 }, { input: 'sets', set: 1 }]);
    assert.deepEqual(M.levelsAt(table, 1), ['@in', '@out']);
    assert.deepEqual(Array.from(table.count), [10, 20, 30, 40]);
});

test('levels can be sorted by height and reversed', () => {
    const { table } = barTable({ value: { kind: 'count' } });
    const height = M.heightValues({ ...barConfig, value: { kind: 'count' } }, table);
    assert.deepEqual(M.axisOrder(table, 0, height, {}), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(M.axisOrder(table, 0, height, { reverse: true }), [5, 4, 3, 2, 1, 0]);
    const tallest = M.axisOrder(table, 0, height, { sort: 'height' });
    assert.deepEqual(tallest, [0, 1, 2, 3, 4, 5], 'the fixture is already in descending order');
    const flipped = M.axisOrder(table, 0, Float64Array.from(height).reverse(), { sort: 'height' });
    assert.deepEqual(flipped, [5, 4, 3, 2, 1, 0], 'the tallest level of each comes first');
    assert.deepEqual(M.axisOrder(table, 0, height, { sort: 'height', reverse: true }), [5, 4, 3, 2, 1, 0]);
});

// --- the strip and the CSV -----------------------------------------------------------------------------------------

test('the strip is made of the reply: cells shown, counted, without a value per input, and outside the range', () => {
    const grid = gridOf('pseudotime_x_cell_type', { left: 50, outside: 50 });
    const config = { version: 1, mode: 'heatmap', x: obs('pseudotime', { binning: { method: 'equal_width', bins: 5 } }), y: obs('cell_type') };
    const table = M.countTable(config, grid, [{ input: 'x' }, { input: 'y' }]);
    assert.deepEqual(M.stripNumbers(table), { shown: 1250, counted: 1200 - table.noValue.x, noValue: { x: table.noValue.x, y: 0 }, outside: 50 });
});

test('an axis reports its outside cells as the grouping reply does, below and above, and the strip sums them', () => {
    const reply = withContract(expected.grid.kept_other_x_condition);
    reply.axes[0].n_outside = [3, 4];
    reply.axes[1].n_outside = [1, 1];
    const table = M.countTable({ version: 1, mode: 'bar', x: obs('a') }, M.readGrid(reply), [{ input: 'x' }, { input: 'split' }]);
    assert.equal(M.stripNumbers(table).outside, 9);
});

test('a reply without n_shown or an axis\'s n_outside is a contract error, not a guess', () => {
    const noShown = withContract(expected.grid.three_axes);
    delete noShown.n_shown;
    assert.throws(() => M.readGrid(noShown), (e) => e.reason === 'bad_grid_reply');
    const noOutside = withContract(expected.grid.three_axes);
    delete noOutside.axes[1].n_outside;
    assert.throws(() => M.readGrid(noOutside), (e) => e.reason === 'bad_grid_reply');
    noOutside.axes[1].n_outside = 3;
    assert.throws(() => M.readGrid(noOutside), (e) => e.reason === 'bad_grid_reply', 'one integer is not the form');
    noOutside.axes[1].n_outside = [-1, 0];
    assert.throws(() => M.readGrid(noOutside), (e) => e.reason === 'bad_grid_reply');
});

test('a binned axis must carry edges, bins_made and degenerate, and a degenerate one its value', () => {
    const fresh = () => withContract(expected.grid.pseudotime_x_cell_type);
    for (const field of ['edges', 'bins_made', 'degenerate']) {
        const reply = fresh();
        delete reply.axes[0][field];
        assert.throws(() => M.readGrid(reply), (e) => e.reason === 'bad_grid_reply' && e.message.includes(field), field);
    }
    const flat = fresh();
    flat.axes[0].degenerate = true;
    assert.throws(() => M.readGrid(flat), (e) => e.message.includes('value'));
    flat.axes[0].value = 3;
    assert.equal(M.readGrid(flat).axes[0].value, 3);
    const categorical = withContract(expected.grid.three_axes);
    assert.doesNotThrow(() => M.readGrid(categorical), 'a categorical axis carries no edges');
    const table = M.countTable({ version: 1, mode: 'heatmap', x: obs('p'), y: obs('c') }, M.readGrid(fresh()), [{ input: 'x' }, { input: 'y' }]);
    assert.deepEqual(table.axes[0].info.edges, [0, 1, 2, 3, 4, 5], 'the table keeps the axis info for the bin labels');
});

test('the CSV has the levels, count, share and measure of the plotted table, and the headers are the caller\'s', () => {
    const { config, table } = barTable();
    const rows = M.tableRows(config, table, { labelOf: (id) => id.replace(/^c:/, ''), inputNames: { x: 'type', split: 'cond' },
        headers: { count: 'n', share: 'sh', measure: 'm' }, shareBase: 'x' });
    assert.deepEqual(rows[0], ['type', 'cond', 'n', 'sh', 'm']);
    assert.equal(rows.length, 13);
    assert.deepEqual(rows[1].slice(0, 3), ['B cell', 'ctrl', 261]);
    near(rows[1][3], 261 / (261 + 239), 'share within x of the first row');
    const csv = M.tableCsv(rows);
    assert.equal(csv.split('\n')[0], 'type,cond,n,sh,m');
    assert.equal(M.tableCsv([['a,b', '=x']]), '"a,b",\'=x');
});

// --- the work is done once ----------------------------------------------------------------------------------------

test('a large grid is projected once: the table, its shares and its measures are reused', () => {
    const levels = Array.from({ length: 512 }, (_, i) => `bin:${i}`);
    const cells = 512 * 512;
    const grid = M.readGrid(withContract({ axes: [{ levels }, { levels }], counts: new Uint32Array(cells).fill(1), n_counted: cells,
        measure: new Float64Array(cells * 5).fill(1) }));
    const config = { version: 1, mode: 'hist2d', x: obs('a'), y: obs('b') };
    const a = M.countTable(config, grid, [{ input: 'x' }, { input: 'y' }]);
    const b = M.countTable(config, grid, [{ input: 'x' }, { input: 'y' }]);
    assert.equal(a, b, 'one projection per grid and axes');
    assert.equal(M.measureValues(a, 'mean'), M.measureValues(a, 'mean'));
    assert.equal(a.rows, cells);
});

test('a grid whose blocks do not fit its axes is refused', () => {
    assert.throws(() => M.readGrid(withContract({ axes: [{ levels: ['c:a', 'c:b'] }], counts: [1], n_counted: 1 })), /counts/);
    assert.throws(() => M.readGrid(withContract({ axes: [{ levels: ['c:a'] }], counts: [1], n_counted: 1, measure: [[1, 2]] })), /measure/);
});

test('the binning options widen the limit and keep a default bin count; without them the grouping rules hold', async () => {
    const { normalizeBinning } = await import('../../../static/js/utils/binning.js');
    const raw = { method: 'equal_width', bins: 10 };
    assert.deepEqual(normalizeBinning(raw).binning, { method: 'equal_width' });
    assert.deepEqual(normalizeBinning(raw, { keepDefault: true }).binning, raw);
    assert.equal(normalizeBinning({ method: 'equal_width', bins: 1500 }).problems[0].reason, 'bad_bins');
    assert.equal(normalizeBinning({ method: 'equal_width', bins: 1500 }, { max: 2000 }).binning.bins, 1500);
});

test('the levels are labelled from the reply: closed ranges for the bins, plain names for the categories', () => {
    const grid = gridOf('pseudotime_x_cell_type');
    const config = { version: 1, mode: 'heatmap', x: obs('pseudotime', { binning: { method: 'equal_width', bins: 5 } }), y: obs('cell_type') };
    const table = M.countTable(config, grid, [{ input: 'x' }, { input: 'y' }]);
    const [x, y] = M.levelLabelsOf(config, table);
    assert.deepEqual([x.get('bin:0'), x.get('bin:2'), x.get('bin:4')], ['pseudotime 0 to 1', 'pseudotime 2 to 3', 'pseudotime 4 to 5']);
    assert.equal(y.get('c:T cell'), 'T cell');
    const pie = M.countTable({ version: 1, mode: 'pie', x: obs('k') }, M.readGrid(withContract({ axes: [{ levels: Array.from({ length: 14 }, (_, i) => `c:L${i}`) }],
        counts: Array.from({ length: 14 }, (_, i) => 20 - i), n_counted: 1 })), [{ input: 'x' }]);
    assert.equal(M.levelLabelsOf({ version: 1, mode: 'pie', x: obs('k') }, pie)[0].get('@other'), 'k other');
});
