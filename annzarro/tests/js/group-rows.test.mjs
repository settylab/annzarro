/**
 * G9c: what the group grid of a Cell Grouping shows, without a page (panels/cell-grouping/group-rows.js): the rows
 * (colour, name, cells, share, the small mark), the search, the cross-table of two factors, the focused gene's
 * columns and the gate that decides when they are asked for (GRP-6), and the CSV, whose columns are the grid's (GRP-18).
 *
 * Run:  node --test annzarro/tests/js/group-rows.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../../../static/js/panels/cell-grouping/group-rows.js');

const REPLY = {
    n_shown: 100, n_grouped: 96,
    partitionings: [
        { kind: 'categorical', levels: ['c:B', 'c:T'], counts: [60, 36] },
        { kind: 'categorical', levels: ['c:old', 'c:young', 'c:mid'], counts: [50, 40, 6] }],
    groups: [{ key: ['c:B', 'c:old'], n: 40 }, { key: ['c:B', 'c:young'], n: 20 },
        { key: ['c:T', 'c:old'], n: 10 }, { key: ['c:T', 'c:young'], n: 20 }, { key: ['c:T', 'c:mid'], n: 6 }]
};
const NAMES = ['B | old', 'B | young', 'T | old', 'T | young', 'T | mid'];
const COLORS = ['#111111', '#222222', '#333333', '#444444', '#555555'];
const SMALL = { threshold: 10, mode: 'keep' };

test('a row has colour, name, cells, share and a small mark; the mark is a count under the threshold', () => {
    const rows = M.groupRows({ reply: REPLY, names: NAMES, colors: COLORS, small: SMALL });
    assert.equal(rows.length, 5);
    assert.deepEqual(rows[0], { index: 0, key: ['c:B', 'c:old'], keyText: 'c:B\u0001c:old', name: 'B | old', color: '#111111', n: 40, share: 0.4, small: false });
    assert.equal(rows[4].small, true, '6 cells is under 10');
    assert.equal(rows[2].small, false, '10 cells is not under 10');
    assert.equal(M.groupRows({ reply: REPLY, names: NAMES, colors: COLORS, small: { threshold: 7, mode: 'keep' } })[4].small, true);
    assert.equal(M.groupRows({ reply: REPLY, names: NAMES, colors: COLORS, small: { threshold: 6, mode: 'keep' } })[4].small, false);
});

test('the share is of the cells shown, to one decimal, and a tiny share is not 0', () => {
    assert.equal(M.shareText(0.0756), '7.6%');
    assert.equal(M.shareText(1), '100%');
    assert.equal(M.shareText(0.00001), '<0.1%');
    assert.equal(M.shareText(0), '0%');
});

test('the search keeps the groups whose name has the text, in any case, and keeps their order', () => {
    const rows = M.groupRows({ reply: REPLY, names: NAMES, colors: COLORS, small: SMALL });
    assert.deepEqual(M.filterRows(rows, 't |').map((r) => r.name), ['T | old', 'T | young', 'T | mid']);
    assert.equal(M.filterRows(rows, '').length, 5);
    assert.equal(M.filterRows(rows, '  ').length, 5);
    assert.equal(M.filterRows(rows, 'zzz').length, 0);
});

test('a cross-table of two factors: the first one down, the second across, counts, a muted 0 where nothing is', () => {
    const cross = M.crossTable({ reply: REPLY, levelName: (i, id) => id.slice(2) });
    assert.deepEqual(cross.rows.map((r) => r.label), ['B', 'T']);
    assert.deepEqual(cross.cols.map((c) => c.label), ['old', 'young', 'mid']);
    assert.equal(cross.count(0, 0), 40);
    assert.equal(cross.count(1, 2), 6);
    assert.equal(cross.count(0, 2), 0, 'B and mid hold no cell');
    assert.equal(cross.holds, 5);
    assert.equal(cross.combinations, 6);
    assert.equal(cross.text, '5 of 6 combinations hold cells.');
});

test('a cross-table needs exactly two factors', () => {
    assert.equal(M.crossTable({ reply: { ...REPLY, partitionings: [REPLY.partitionings[0]] }, levelName: (i, id) => id }), null);
    assert.equal(M.crossTable({ reply: { ...REPLY, partitionings: [...REPLY.partitionings, REPLY.partitionings[0]] }, levelName: (i, id) => id }), null);
});

test('a collected small group is not a combination', () => {
    const reply = { ...REPLY, groups: [...REPLY.groups, { key: ['@small'], n: 3 }] };
    const cross = M.crossTable({ reply, levelName: (i, id) => id });
    assert.equal(cross.holds, 5);
});

test('a cross-table of 2,000 groups holds what the groups hold, not the product of its levels', () => {
    const levels = Array.from({ length: 2000 }, (_, i) => `c:L${i}`);
    const reply = { n_shown: 2000, partitionings: [{ levels }, { levels }], groups: levels.map((id) => ({ key: [id, id], n: 1 })) };
    const cross = M.crossTable({ reply, levelName: (i, id) => id });
    assert.equal(cross.combinations, 4000000);
    assert.equal(cross.holds, 2000);
    assert.equal(cross.count(1999, 1999), 1);
    assert.equal(cross.count(1999, 0), 0);
});

test('the focused gene: its columns are the offered statistics on the first offered layer', () => {
    const cols = M.focusColumns({ gene: 'Mrpl15', recipe: {} });
    assert.deepEqual(cols.map((c) => [c.id, c.header]), [['mean', 'Mrpl15 mean'], ['pct_expressing', 'Mrpl15 % expressing']]);
    const own = M.focusColumns({ gene: 'Mrpl15', recipe: { offered: ['sum', 'sd', 'count', 'mean_expressing'], layers: ['logged', 'X'] } });
    assert.deepEqual(own.map((c) => c.id), ['sum', 'sd', 'mean_expressing'], 'the cell count is the grid\'s own column');
    assert.equal(M.layerOf({ layers: ['logged', 'X'] }), 'logged');
    assert.equal(M.layerOf({}), 'X');
});

test('a statistic that cannot be computed on the layer is left out, with the reason said once', () => {
    const cols = M.focusColumns({ gene: 'G', recipe: {}, kind: 'signed' });
    assert.deepEqual(cols.map((c) => c.id), ['mean']);
});

test('the request for the focused gene: one gene, the first layer, the threshold', () => {
    assert.deepEqual(M.featureWire('Mrpl15', {}), { kind: 'gene', name: 'Mrpl15', layer: 'X', detect_above: 0 });
    assert.deepEqual(M.featureWire('Mrpl15', { layers: ['logged'], detect_above: 0.5 }), { kind: 'gene', name: 'Mrpl15', layer: 'logged', detect_above: 0.5 });
});

test('live means an estimate under the server\'s live limit, and not asking first or refused', () => {
    assert.equal(M.isLive({ seconds: 1.2, tier: 'auto', live_max_s: 5 }), true);
    assert.equal(M.isLive({ seconds: 5, tier: 'auto', live_max_s: 5 }), false);
    assert.equal(M.isLive({ seconds: 4.9, tier: 'auto' }), true, 'the limit is 5 s when the reply does not say');
    assert.equal(M.isLive({ seconds: 40, tier: 'auto', live_max_s: 5 }), false);
    assert.equal(M.isLive({ seconds: 1, tier: 'confirm', live_max_s: 5 }), false);
    assert.equal(M.isLive({ seconds: 1, tier: 'refused', live_max_s: 5 }), false);
    assert.equal(M.isLive(null), false);
});

test('the gate: nothing is asked with no gene, off screen, or after the estimate said slow; a click forces it', () => {
    assert.equal(M.gateOf({ gene: null, visible: true, blocked: false, forced: false }), 'nogene');
    assert.equal(M.gateOf({ gene: 'A', visible: false, blocked: false, forced: false }), 'wait');
    assert.equal(M.gateOf({ gene: 'A', visible: true, blocked: false, forced: false }), 'estimate');
    assert.equal(M.gateOf({ gene: 'A', visible: true, blocked: true, forced: false }), 'button');
    assert.equal(M.gateOf({ gene: 'A', visible: false, blocked: true, forced: false }), 'button');
    assert.equal(M.gateOf({ gene: 'A', visible: true, blocked: true, forced: true }), 'compute');
});

test('a gene\'s values per row come from the moments by group key, whatever the order of the reply', () => {
    // two groups, moments [n, sum, sumsq, n_above, sum_above] each, in the order T|old then B|old
    const moments = new Float64Array([10, 5, 0, 4, 4, 40, 40, 0, 20, 30]);
    const featureReply = { groups: [{ key: ['c:T', 'c:old'], n: 10 }, { key: ['c:B', 'c:old'], n: 40 }] };
    const rows = M.groupRows({ reply: REPLY, names: NAMES, colors: COLORS, small: SMALL });
    const cols = M.focusColumns({ gene: 'G', recipe: {} });
    const v = M.focusValues({ columns: cols, rows, featureReply, moments });
    assert.deepEqual(Array.from(v[0]), [1, NaN, 0.5, NaN, NaN], 'mean: B|old 40/40, T|old 5/10');
    assert.deepEqual(Array.from(v[1]), [50, NaN, 40, NaN, NaN], '% expressing: 20/40, 4/10');
});

test('a value is text with three figures, and a missing one is a dash, never 0', () => {
    assert.equal(M.valueText(0.4213), '0.421');
    assert.equal(M.valueText(61.04), '61');
    assert.equal(M.valueText(1234.5), '1,235');
    assert.equal(M.valueText(0), '0');
    assert.equal(M.valueText(NaN), '—');
    assert.equal(M.valueText(null), '—');
});

test('the list grid\'s columns, and the CSV that has exactly them after the key', () => {
    const rows = M.groupRows({ reply: REPLY, names: NAMES, colors: COLORS, small: SMALL });
    const focus = M.focusColumns({ gene: 'G', recipe: {} });
    const columns = M.listColumns({ focus });
    assert.deepEqual(columns.map((c) => c.header), ['Name', 'Cells', 'Share', 'G mean', 'G % expressing']);
    const moments = new Float64Array([40, 40, 0, 20, 30, 0, 0, 0, 0, 0, 10, 5, 0, 4, 4, 0, 0, 0, 0, 0, 6, 3, 0, 0, 0]);
    const featureReply = { groups: REPLY.groups };
    const values = M.focusValues({ columns: focus, rows, featureReply, moments });
    const csv = M.listCsv({ rows, columns, values });
    const lines = csv.trimEnd().split('\n');
    assert.equal(lines[0], 'Key,Name,Cells,Share,G mean,G % expressing');
    assert.equal(lines.length, 6);
    assert.equal(lines[1], '"[""c:B"",""c:old""]",B | old,40,40%,1,50', 'the key is the typed ids as JSON; the share is a percent');
    assert.ok(lines[2].startsWith('"[""c:B"",""c:young""]",B | young,20,20%,'), lines[2]);
    assert.equal(lines[2].endsWith(',,'), true, 'a group with no value is an empty field');
});

test('a name or key that looks like a formula is written as text', () => {
    const reply = { n_shown: 1, partitionings: [{ levels: ['c:=1+1'] }], groups: [{ key: ['c:=1+1'], n: 1 }] };
    const rows = M.groupRows({ reply, names: ['=1+1'], colors: ['#000000'], small: SMALL });
    const csv = M.listCsv({ rows, columns: M.listColumns({ focus: [] }), values: [] });
    assert.ok(csv.split('\n')[1].includes("'=1+1"), csv);
});

test('the cross-table CSV is the table: the first factor down, the second across', () => {
    const cross = M.crossTable({ reply: REPLY, levelName: (i, id) => id.slice(2) });
    assert.equal(M.crossCsv(cross, ['cell_type', 'age']), 'cell_type,old,young,mid\nB,40,20,0\nT,10,20,6\n');
});

test('the reasons a cell is in no group are rows of their own', () => {
    const rows = M.reasonRows(['78 have no value for Cd3e', '5 small groups (under 10 cells) are hidden']);
    assert.deepEqual(rows.map((r) => r.name), ['78 have no value for Cd3e', '5 small groups (under 10 cells) are hidden']);
    assert.equal(rows.length, 2);
});

test('one format per column: % expressing to one decimal, the others to the decimals their smallest figure needs', () => {
    const pct = M.columnFormat('pct_expressing', [58, 64.4, 100, NaN]);
    assert.deepEqual([58, 64.4, 100].map(pct), ['58.0', '64.4', '100.0']);
    assert.equal(pct(NaN), '\u2014');
    const mean = M.columnFormat('mean', [3.88, 0.4213, 5.2]);
    assert.deepEqual([3.88, 0.4213, 5.2].map(mean), ['3.880', '0.421', '5.200']);
    assert.equal(M.columnFormat('mean', [1234.5, 2000])(1234.5), '1,235');
    assert.equal(M.columnFormat('mean', [NaN, NaN])(NaN), '\u2014');
    assert.equal(M.columnFormat('mean', [0, 0])(0), '0');
});
