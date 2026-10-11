/**
 * The dataset picker's logic (static/js/utils/dataset-picker.js): search by
 * name and relative path (substring and regex; an invalid regex is an error,
 * not a throw), sort, the per-server recents (storage may be broken),
 * grouping and paging.
 *
 * Run:  node --test annzarro/tests/js/dataset-picker.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
    compileQuery, searchEntries, sortEntries, loadRecents, pushRecent, buildGroups, pageGroups,
    splitByRanges, countsLabel, modifiedLabel, RECENT_LIMIT, folderOf, displayPath, searchParts, pathFieldWording
} = await import('../../../static/js/utils/dataset-picker.js');

const E = (name, extra = {}) => ({ path: `/data/${name}`, name, rel_path: name, cells: 10, genes: 5, match: 'other', ...extra });
const names = list => list.map(e => e.name);
const memory = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }; };

test('substring search is case-insensitive over the name and the relative path', () => {
    const list = [E('liver.zarr', { rel_path: 'proj/liver.zarr' }), E('lung.zarr'), E('x.zarr', { rel_path: 'Liver/x.zarr' })];
    assert.deepEqual(names(searchEntries(list, 'liver').entries), ['liver.zarr', 'x.zarr']);
    assert.deepEqual(names(searchEntries(list, 'proj/').entries), ['liver.zarr'], 'the relative path is searched');
    assert.equal(searchEntries(list, '').entries.length, 3);
});

test('a substring query is literal: regex characters match themselves', () => {
    const list = [E('a.b.zarr'), E('axb.zarr')];
    assert.deepEqual(names(searchEntries(list, 'a.b').entries), ['a.b.zarr']);
    assert.deepEqual(names(searchEntries(list, '(').entries), [], 'an unbalanced bracket is only text');
});

test('regex search matches patterns', () => {
    const list = [E('liver_v1.zarr'), E('liver_v22.zarr'), E('lung.zarr')];
    assert.deepEqual(names(searchEntries(list, '^liver_v\\d$', { regex: true }).entries), []);
    assert.deepEqual(names(searchEntries(list, 'liver_v\\d+\\.zarr$', { regex: true }).entries), ['liver_v1.zarr', 'liver_v22.zarr']);
});

test('an invalid regex is reported as an error and filters nothing', () => {
    const list = [E('a.zarr'), E('b.zarr')];
    let result;
    assert.doesNotThrow(() => { result = searchEntries(list, '(', { regex: true }); });
    assert.match(result.error, /Invalid regular expression/);
    assert.equal(result.entries.length, 2);
});

test('match ranges are found for highlighting, and zero-length matches do not loop', () => {
    const q = compileQuery('ab', {});
    assert.deepEqual(q.ranges('xxabyyab'), [[2, 4], [6, 8]]);
    const empty = compileQuery('x*', { regex: true });
    assert.deepEqual(empty.ranges('abc'), []);
    assert.deepEqual(splitByRanges('xxabyy', [[2, 4]]), [{ text: 'xx', hit: false }, { text: 'ab', hit: true }, { text: 'yy', hit: false }]);
});

test('sort by name (natural), cells and modified; best keeps the given order', () => {
    const list = [E('s10', { cells: 5, modified: 1 }), E('s2', { cells: 50, modified: 3 }), E('s1', { cells: null, modified: 2 })];
    assert.deepEqual(names(sortEntries(list, 'name')), ['s1', 's2', 's10']);
    assert.deepEqual(names(sortEntries(list, 'cells')), ['s2', 's10', 's1'], 'largest first, unknown last');
    assert.deepEqual(names(sortEntries(list, 'modified')), ['s2', 's1', 's10'], 'newest first');
    assert.deepEqual(names(sortEntries(list, 'best')), ['s10', 's2', 's1']);
    assert.deepEqual(names(list), ['s10', 's2', 's1'], 'the input is not reordered');
});

test('recents: newest first, no duplicates, capped, kept per server', () => {
    const st = memory();
    for (let i = 0; i < RECENT_LIMIT + 3; i++) pushRecent(st, 'http://a', `/p${i}`);
    pushRecent(st, 'http://a', '/p5');
    const list = loadRecents(st, 'http://a');
    assert.equal(list.length, RECENT_LIMIT);
    assert.equal(list[0], '/p5');
    assert.equal(new Set(list).size, RECENT_LIMIT);
    assert.deepEqual(loadRecents(st, 'http://b'), []);
});

test('recents survive broken storage', () => {
    const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
    assert.deepEqual(loadRecents(throwing, 's'), []);
    assert.doesNotThrow(() => pushRecent(throwing, 's', '/x'));
    const garbage = { getItem: () => '{not json', setItem() {} };
    assert.deepEqual(loadRecents(garbage, 's'), []);
    const wrong = { getItem: () => '{"a":1}', setItem() {} };
    assert.deepEqual(loadRecents(wrong, 's'), []);
});

test('groups: recents first, match groups, other, unreadable last; a store shows once', () => {
    const list = [E('a', { match: 'same' }), E('b', { match: 'name' }), E('c'), E('d', { error: 'zarr format 4' }), E('e', { match: 'counts' })];
    const groups = buildGroups(list, { recents: ['/data/c', '/data/gone', '/data/a'] });
    assert.deepEqual(groups.map(g => g.title), ['Recently opened', 'Same size (cell and gene names not compared yet)', 'Same name', 'Cannot be opened']);
    assert.deepEqual(names(groups[0].entries), ['c', 'a'], 'recents in recency order; a missing store is skipped');
    assert.deepEqual(names(groups.at(-1).entries), ['d']);
    const all = groups.flatMap(g => names(g.entries));
    assert.equal(new Set(all).size, all.length);
});

test('without recents the first group is the best match', () => {
    const groups = buildGroups([E('a', { match: 'same' }), E('z')]);
    assert.deepEqual(groups.map(g => g.title), ['Same cells and genes', 'Other datasets in the data directory']);
});

test('paging cuts across groups and counts what is left (2,000 entries)', () => {
    const big = Array.from({ length: 2000 }, (_, i) => E(`s${i}`, { match: i < 5 ? 'same' : 'other' }));
    const groups = buildGroups(big);
    const page = pageGroups(groups, 200);
    assert.equal(page.groups.reduce((n, g) => n + g.entries.length, 0), 200);
    assert.equal(page.remaining, 1800);
    assert.equal(page.groups[0].entries.length, 5);
    assert.equal(pageGroups(groups, 5000).remaining, 0);
});

test('labels', () => {
    assert.equal(countsLabel(E('a', { cells: 1234, genes: 56 })), '1,234 cells x 56 genes');
    assert.equal(countsLabel(E('a', { cells: null })), '');
    assert.match(modifiedLabel({ modified: 1760000000 }), /^modified 20\d\d-\d\d-\d\d$/);
    assert.equal(modifiedLabel({}), '');
});

test('the folder line is the relative folder, empty at the top', () => {
    assert.equal(folderOf(E('a.zarr')), '');
    assert.equal(folderOf(E('a.zarr', { rel_path: 'projects/liver/a.zarr' })), 'projects/liver/');
    assert.equal(folderOf({ path: '/x/a.zarr' }), '');
});

test('paths are shown relative to the data directory, as the listing says', () => {
    const listing = [E('a.zarr', { rel_path: 'projects/a.zarr' })];
    assert.equal(displayPath('/data/a.zarr', listing), 'projects/a.zarr');
    assert.equal(displayPath('/elsewhere/b.zarr', listing, { relPath: 'b.zarr' }), 'b.zarr', 'what the server said about it');
    assert.equal(displayPath('/elsewhere/b.zarr', listing), '/elsewhere/b.zarr', 'outside the data directory: as it is');
});

test('a regex is anchored to the name or to the path, not to both joined', () => {
    const list = [E('deep.zarr', { rel_path: 'projects/deep.zarr' })];
    assert.equal(searchEntries(list, '^deep\\.zarr$', { regex: true }).entries.length, 1);
    assert.equal(searchEntries(list, '^projects/', { regex: true }).entries.length, 1);
    assert.deepEqual(searchParts(list[0]), { name: 'deep.zarr', rel: 'projects/deep.zarr' });
});

test('the typed-path field says what this user can open', () => {
    const confined = { may_open_any_path: false, auth_enabled: true, is_admin: false };
    assert.deepEqual(pathFieldWording({ ...confined, remote_stores: true }), {
        label: 'Open a path in the data directory, or a remote store URL',
        placeholder: 'projects/liver/sample.zarr or https://\u2026' });
    assert.equal(pathFieldWording({ ...confined, remote_stores: false }).label, 'Open a path in the data directory');
    const admin = { may_open_any_path: true, auth_enabled: true, is_admin: true };
    assert.equal(pathFieldWording({ ...admin, remote_stores: true }).label, 'Open any path on this server, or a remote store URL (admin)');
    assert.equal(pathFieldWording({ ...admin, remote_stores: false }).label, 'Open any path on this server (admin)');
    const local = { may_open_any_path: true, auth_enabled: false, is_admin: false };
    assert.equal(pathFieldWording({ ...local, remote_stores: true }).label, 'Open any path, or a remote store URL');
    assert.equal(pathFieldWording({ ...local, remote_stores: false }).label, 'Open any path');
    assert.equal(pathFieldWording(null).label, 'Open a path in the data directory', 'unknown: the safe wording');
});
