/**
 * A gene-signature score as a column of a Cell Table (static/js/utils/score-column.js): what each
 * state of the score does to the column, the gate a filter on a score puts on its rows, the notice,
 * and how a link follows a signature to a new id.
 *
 * Run:  node --test annzarro/tests/js/score-column.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { isScoreColumn, scoreColumnsOf, subOf, sameScoreColumn, usedScoreColumns, columnView, describeColumn,
    filterGate, describeHeldRows, followSignatureIds } = await import('../../../static/js/utils/score-column.js');
const { getColumnKey } = await import('../../../static/js/utils/column-key.js');

const col = (key = 'sig-1', column = 'zscore_mean') => ({ type: 'gene-score', key, column, label: 'T cell score' });
const values = new Float32Array([1, 2, 3]);
const snap = (state, extra = {}) => ({ state, title: 'T cell score', ...extra });

test('a column is a score column by its type, and its aggregation defaults to the z-score mean', () => {
    assert.equal(isScoreColumn(col()), true);
    assert.equal(isScoreColumn({ type: 'obs', key: 'x', column: '' }), false);
    assert.equal(isScoreColumn(null), false);
    assert.equal(subOf(col('s', '')), 'zscore_mean', 'a link made before aggregations existed');
    assert.equal(subOf(col('s', 'mean')), 'mean');
    assert.deepEqual(scoreColumnsOf([{ type: 'obs', key: 'a' }, col(), col('sig-2', 'mean')]).map(c => c.key), ['sig-1', 'sig-2']);
    assert.equal(sameScoreColumn(col('s', ''), col('s', 'zscore_mean')), true);
    assert.equal(sameScoreColumn(col('s', 'mean'), col('s', 'zscore_mean')), false, 'two aggregations are two columns');
});

test('the data key of a score column holds the signature id and the aggregation, and none of the characters DataTables reads as a path', () => {
    assert.equal(getColumnKey(col('gene-signature-12', 'mean')), 'gene-score_gene-signature-12_mean');
    assert.equal(getColumnKey(col('gene-signature-12', '')), 'gene-score_gene-signature-12_main');
    assert.ok(!/[.[\]()\\]/.test(getColumnKey({ type: 'gene-score', key: 'a.b[0]', column: 'c(d)' })));
});

// the table of 7.4 -------------------------------------------------------------------------

const TABLE = [
    // state of the score, kind, suffix, cell, sort, filter, export
    [snap('ready', { values }), 'ready', '', '', true, true, true],
    [snap('updating', { values }), 'updating', '(updating)', '', true, true, false],
    [snap('estimating'), 'pending', '(computing)', 'computing…', false, false, false],
    [snap('queued'), 'pending', '(computing)', 'computing…', false, false, false],
    [snap('computing'), 'pending', '(computing)', 'computing…', false, false, false],
    [snap('awaiting'), 'pending', '(not computed)', 'not computed', false, false, false],
    [snap('cancelled'), 'none', '(no score)', 'no score', false, false, false],
    [snap('refused'), 'none', '(no score)', 'no score', false, false, false],
    [snap('failed'), 'none', '(no score)', 'no score', false, false, false],
    [snap('noscore'), 'none', '(no score)', 'no score', false, false, false],
    [snap('nogenes'), 'none', '(no score)', 'no score', false, false, false],
    [snap('off'), 'none', '(no score)', 'no score', false, false, false],
    [snap('deleted'), 'none', '(deleted)', 'no score', false, false, false]
];

for (const [s, kind, suffix, cell, sortable, filterable, exportable] of TABLE) {
    test(`a score that is ${s.state} gives a ${kind} column: header "${suffix}", cells "${cell}", sort ${sortable}, filter ${filterable}, export ${exportable}`, () => {
        const v = columnView(s, 'T cell score');
        assert.deepEqual([v.kind, v.suffix, v.cell, v.sortable, v.filterable, v.exportable], [kind, suffix, cell, sortable, filterable, exportable]);
        assert.equal(v.hasValues, kind === 'ready' || kind === 'updating');
        if (!exportable) assert.match(v.exportNote, /'T cell score'/, 'the column that blocks the export is named');
    });
}

test('a score with no state yet is computing, not an error', () => {
    assert.equal(columnView(null, 'T').kind, 'pending');
    assert.equal(columnView({ state: 'ready' }, 'T').kind, 'none', 'ready without values is not a ready column');
});

test('export names what it waits for', () => {
    assert.equal(columnView(snap('computing'), 'T cell score').exportNote, "Available when 'T cell score' is ready");
    assert.equal(columnView(snap('updating', { values }), 'T cell score').exportNote, "Available when 'T cell score' is updated");
    assert.equal(columnView(snap('awaiting'), 'T cell score').exportNote, "Available when 'T cell score' is computed");
});

// notices -----------------------------------------------------------------------------------

test('the notice has the plot\'s words, no "Choose another", and Remove column where there is no score', () => {
    const failed = describeColumn(snap('failed', { message: 'the server stopped responding' }));
    assert.equal(failed.headline, "'T cell score' could not be computed: the server stopped responding.");
    assert.deepEqual(failed.actions.map(a => a[0]), ['score-retry', 'score-open', 'score-remove']);
    const cancelled = describeColumn(snap('cancelled'));
    assert.equal(cancelled.headline, "'T cell score' was cancelled.", 'a table has no colour to lose');
    assert.deepEqual(cancelled.actions.map(a => a[0]), ['score-compute', 'score-remove']);
    const deleted = describeColumn({ state: 'deleted', title: 'T cell score' });
    assert.equal(deleted.headline, "Signature 'T cell score' was deleted.");
    assert.deepEqual(deleted.actions.map(a => a[0]), ['score-remove']);
    const computing = describeColumn(snap('computing', { progress: { done: 31, total: 50 } }));
    assert.equal(computing.headline, "Computing 'T cell score': 31 of 50 genes.");
    assert.deepEqual(computing.actions.map(a => a[0]), ['score-cancel'], 'no Remove while it computes');
    assert.equal(describeColumn(snap('ready', { values })), null, 'a ready score says nothing');
    assert.deepEqual(describeColumn(snap('ready', { values, held: { edits: 2, seconds: 40 } })).actions.map(a => a[0]), ['score-update']);
    assert.equal(describeColumn(snap('computing'), { sharers: 3 }).actions[0][1], 'Cancel for 3 plots');
});

// the filter gate -----------------------------------------------------------------------------

const item = (s, title = 'T cell score') => ({ title, snap: s, view: columnView(s, title) });

test('a filter on scores that can be read is not held', () => {
    assert.equal(filterGate([]), null);
    assert.equal(filterGate([item(snap('ready', { values })), item(snap('updating', { values }))]), null);
});

test('a filter on a score that is not ready holds the rows and says waiting', () => {
    const g = filterGate([item(snap('computing'))]);
    assert.deepEqual([g.state, g.reason, g.title, g.scoreState], ['waiting', 'score', 'T cell score', 'computing']);
    assert.deepEqual(describeHeldRows(g), { headline: "Filter on 'T cell score' not applied yet.", text: 'Rows appear when the score is ready.' });
    const asks = filterGate([item(snap('awaiting'))]);
    assert.equal(describeHeldRows(asks).text, "Rows appear when 'T cell score' is computed.");
});

test('a filter on a score with no value fails or is refused, with the reason', () => {
    const f = filterGate([item(snap('failed', { message: 'boom' }))]);
    assert.deepEqual([f.state, f.scoreState], ['failed', 'failed']);
    assert.match(f.detail, /could not be computed: boom/);
    assert.match(describeHeldRows(f).text, /could not be computed: boom/);
    assert.equal(filterGate([item(snap('refused'))]).state, 'refused');
    assert.equal(filterGate([item({ state: 'deleted', title: 'T cell score' })]).state, 'failed');
});

test('of several scores the worst holds the rows, and a score with no value outranks one that is only computing', () => {
    const g = filterGate([item(snap('ready', { values }), 'A'), item(snap('computing'), 'B'), item(snap('cancelled'), 'C')]);
    assert.deepEqual([g.state, g.title], ['failed', 'C']);
    const w = filterGate([item(snap('ready', { values }), 'A'), item(snap('computing'), 'B')]);
    assert.deepEqual([w.state, w.title], ['waiting', 'B']);
});

test('only the score columns a condition names are a dependency of the filter', () => {
    const a = col('sig-1', 'zscore_mean');
    const b = col('sig-1', 'mean');
    const columns = [{ type: 'obs', key: 'x', column: '' }, a, b];
    const sb = { logic: 'AND', criteria: [
        { condition: '>', data: 'x', origData: getColumnKey(a), type: 'num', value: ['1'] },
        { logic: 'OR', criteria: [{ condition: '<', data: 'y', origData: 'obs_x_main', type: 'num', value: ['2'] }] }
    ] };
    assert.deepEqual(usedScoreColumns(columns, sb, getColumnKey), [a], 'b is shown but not filtered on');
    assert.deepEqual(usedScoreColumns(columns, { criteria: [] }, getColumnKey), []);
    assert.deepEqual(usedScoreColumns(columns, undefined, getColumnKey), []);
    assert.deepEqual(usedScoreColumns([{ type: 'obs', key: 'x' }], sb, getColumnKey), []);
    const nested = { criteria: [{ criteria: [{ origData: getColumnKey(b), condition: '>', type: 'num', value: ['1'] }], logic: 'AND' }], logic: 'AND' };
    assert.deepEqual(usedScoreColumns(columns, nested, getColumnKey), [b], 'groups are searched');
});

// links ---------------------------------------------------------------------------------------

test('a link follows a signature to its new id: the column and the conditions that name it', () => {
    const column = col('gene-signature-1', 'mean');
    const old = getColumnKey(column);
    const cfg = {
        columns: [{ type: 'obs', key: 'x', column: '' }, column, col('gene-signature-9', 'zscore_mean')],
        searchBuilderConfig: { logic: 'AND', criteria: [
            { condition: '>', data: 'T cell score', origData: old, type: 'az-num', value: ['2'] },
            { logic: 'OR', criteria: [{ condition: '<', data: 'T cell score', origData: old, type: 'az-num', value: ['9'] }] }
        ] }
    };
    assert.equal(followSignatureIds(cfg, new Map([['gene-signature-1', 'gene-signature-7']]), getColumnKey), true);
    assert.equal(cfg.columns[1].key, 'gene-signature-7');
    assert.equal(cfg.columns[2].key, 'gene-signature-9', 'another signature stays');
    const now = getColumnKey(cfg.columns[1]);
    assert.equal(now, 'gene-score_gene-signature-7_mean');
    assert.equal(cfg.searchBuilderConfig.criteria[0].origData, now);
    assert.equal(cfg.searchBuilderConfig.criteria[1].criteria[0].origData, now);
    assert.equal(cfg.columns[1].label, 'T cell score', 'the title it was last seen under stays');
});

test('an obs column that happens to be named like a signature is not renamed, and a config with no columns is left alone', () => {
    const cfg = { columns: [{ type: 'obs', key: 'gene-signature-1', column: '' }] };
    assert.equal(followSignatureIds(cfg, new Map([['gene-signature-1', 'gene-signature-7']]), getColumnKey), false);
    assert.equal(cfg.columns[0].key, 'gene-signature-1');
    assert.equal(followSignatureIds({}, new Map([['a', 'b']]), getColumnKey), false);
    assert.equal(followSignatureIds(null, new Map(), getColumnKey), false);
});

test('remapPanelReferences renames a table\'s score columns with everything else', async () => {
    const { remapPanelReferences } = await import('../../../static/js/utils/deeplink.js');
    const column = col('gene-signature-1');
    const table = { id: 'cell-table-1', columns: [column],
        searchBuilderConfig: { logic: 'AND', criteria: [{ condition: '>', data: 'T', origData: getColumnKey(column), type: 'num', value: ['1'] }] } };
    const plot = { id: 'cell-plot-1', tableFilter: 'cell-table-1', color: col('gene-signature-1') };
    remapPanelReferences([table, plot], { 'gene-signature-1': 'gene-signature-7', 'cell-table-1': 'cell-table-3' });
    assert.equal(table.columns[0].key, 'gene-signature-7');
    assert.equal(table.searchBuilderConfig.criteria[0].origData, 'gene-score_gene-signature-7_zscore_mean');
    assert.equal(plot.tableFilter, 'cell-table-3');
    assert.equal(plot.color.key, 'gene-signature-7');
});

// operator 2026-11-25: a refusal for something other than cost never quotes the estimate made before it, in a table column either
test('a table column refused for its size says why, not "would take about 1 second"', () => {
    const cheap = { seconds: 1.2, tier: 'auto', max_s: 600 };
    const size = describeColumn({ state: 'refused', title: 'T cell score', reason: 'too_many_values', estimate: cheap, message: null });
    assert.doesNotMatch(`${size.headline} ${size.text}`, /would take|second/i);
    assert.match(size.text, /too many values/);
    assert.ok(size.actions.some(([a]) => a === 'score-remove'));
    const cost = describeColumn({ state: 'refused', title: 'T cell score', reason: 'score_too_expensive', estimate: { seconds: 1500, tier: 'refused', max_s: 600 }, message: 'x' });
    assert.match(cost.headline, /would take about 25 minutes, so it was not run/);
});
