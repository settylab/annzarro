/**
 * What the dataset browser shares with the page (static/js/utils/dataset-picker.js): compiling a search (substring
 * and regex; an invalid regex is an error, not a throw), where it matches, and the typed-path wording.
 * The searched rows, filters and sorting are tested in dataset-browser-model.test.mjs, the recents' storage in
 * dataset-recents.test.mjs.
 *
 * Run:  node --test annzarro/tests/js/dataset-picker.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
    compileQuery, splitByRanges, searchParts, pathFieldWording
} = await import('../../../static/js/utils/dataset-picker.js');

test('a substring query is literal: regex characters match themselves', () => {
    assert.equal(compileQuery('a.b').test('a.b.zarr'), true);
    assert.equal(compileQuery('a.b').test('axb.zarr'), false);
    assert.equal(compileQuery('(').test('a(b'), true, 'an unbalanced bracket is only text');
    assert.equal(compileQuery('LIVER').test('liver.zarr'), true, 'case-insensitive');
});

test('a regex query matches patterns', () => {
    const q = compileQuery('liver_v\\d+\\.zarr$', { regex: true });
    assert.equal(q.test('liver_v22.zarr'), true);
    assert.equal(q.test('lung.zarr'), false);
    assert.equal(compileQuery('^liver_v\\d$', { regex: true }).test('liver_v1.zarr'), false);
});

test('an invalid regex is an error and matches everything, never a throw', () => {
    let q;
    assert.doesNotThrow(() => { q = compileQuery('(', { regex: true }); });
    assert.match(q.error, /Invalid regular expression/);
    assert.equal(q.test('anything'), true);
});

test('an empty query is empty and matches everything', () => {
    const q = compileQuery('');
    assert.equal(q.empty, true);
    assert.equal(q.test('x'), true);
});

test('match ranges are found for highlighting, and zero-length matches do not loop', () => {
    const q = compileQuery('ab', {});
    assert.deepEqual(q.ranges('xxabyyab'), [[2, 4], [6, 8]]);
    const empty = compileQuery('x*', { regex: true });
    assert.deepEqual(empty.ranges('abc'), []);
    assert.deepEqual(splitByRanges('xxabyy', [[2, 4]]), [{ text: 'xx', hit: false }, { text: 'ab', hit: true }, { text: 'yy', hit: false }]);
});

test('a store is searched by its name and its relative path, each on its own', () => {
    assert.deepEqual(searchParts({ path: '/data/projects/deep.zarr', name: 'deep.zarr', rel_path: 'projects/deep.zarr' }), { name: 'deep.zarr', rel: 'projects/deep.zarr' });
    assert.deepEqual(searchParts({ path: '/x/a.zarr' }), { name: 'a.zarr', rel: '' });
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
