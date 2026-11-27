/**
 * G9c: what the group grid of a Cell Grouping shows, without a page (panels/cell-grouping/group-rows.js): the rows
 * (colour, name, cells, share, the small mark), the search, the cross-table of two factors, and the CSV, whose columns
 * are the grid's (GRP-18).
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

test('the list grid\'s columns, and the CSV that has exactly them after the key', () => {
    const rows = M.groupRows({ reply: REPLY, names: NAMES, colors: COLORS, small: SMALL });
    const columns = M.listColumns();
    assert.deepEqual(columns.map((c) => c.header), ['Name', 'Cells', 'Share'], 'no column for a focused gene');
    const csv = M.listCsv({ rows, columns });
    const lines = csv.trimEnd().split('\n');
    assert.equal(lines[0], 'Key,Name,Cells,Share');
    assert.equal(lines.length, 6);
    assert.equal(lines[1], '"[""c:B"",""c:old""]",B | old,40,40%', 'the key is the typed ids as JSON; the share is a percent');
});

test('a name or key that looks like a formula is written as text', () => {
    const reply = { n_shown: 1, partitionings: [{ levels: ['c:=1+1'] }], groups: [{ key: ['c:=1+1'], n: 1 }] };
    const rows = M.groupRows({ reply, names: ['=1+1'], colors: ['#000000'], small: SMALL });
    const csv = M.listCsv({ rows, columns: M.listColumns() });
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


test('a cross-table column is as wide as its longest name needs, between the number width and a cap', async () => {
    const { crossColumnWidth } = await import('../../../static/js/panels/cell-grouping/group-rows.js');
    assert.equal(crossColumnWidth([{ label: 'B' }, { label: 'T' }]), 84, 'short names keep the number width');
    assert.equal(crossColumnWidth([]), 84);
    const long = crossColumnWidth([{ label: 'kompot_da_Young_to_Old_lfc < -1' }, { label: 'kompot_da_Young_to_Old_lfc >= 1' }]);
    assert.ok(long > 200 && long <= 280, `a default bin name fits: ${long}`);
    assert.equal(crossColumnWidth([{ label: 'x'.repeat(200) }]), 280, 'capped: a longer name is cut and its title says it');
});
