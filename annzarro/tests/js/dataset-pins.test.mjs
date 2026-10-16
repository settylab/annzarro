/**
 * The pinned datasets (static/js/utils/dataset-pins.js): per server and user, newest first,
 * a path kept as pinned, storage failures never throw.
 *
 * Run:  node --test annzarro/tests/js/dataset-pins.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../../../static/js/utils/dataset-pins.js');

function store() {
    const data = new Map();
    return { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, removeItem: k => { data.delete(k); }, data };
}

test('a pin is kept per origin and user, newest first, once', () => {
    const s = store();
    P.addPin(s, 'http://a', 'user:x', { path: '/d/a.zarr', label: 'a.zarr' }, 1);
    P.addPin(s, 'http://a', 'user:x', { path: 's3://b/c.zarr', label: 's3://b/c.zarr' }, 2);
    P.addPin(s, 'http://a', 'user:x', { path: '/d/a.zarr', label: 'a.zarr' }, 3);
    assert.deepEqual(P.loadPins(s, 'http://a', 'user:x').map(p => p.path), ['/d/a.zarr', 's3://b/c.zarr']);
    assert.deepEqual(P.loadPins(s, 'http://a', 'user:y'), [], 'another user has none');
    assert.deepEqual(P.loadPins(s, 'http://b', 'user:x'), [], 'another server has none');
});

test('toggle pins and unpins', () => {
    const s = store();
    assert.equal(P.togglePin(s, 'o', 'local', { path: '/d/a.zarr' }).pinned, true);
    assert.equal(P.isPinned(s, 'o', 'local', '/d/a.zarr'), true);
    assert.equal(P.togglePin(s, 'o', 'local', { path: '/d/a.zarr' }).pinned, false);
    assert.equal(P.isPinned(s, 'o', 'local', '/d/a.zarr'), false);
});

test('broken or blocked storage gives an empty list and never throws', () => {
    const s = store();
    s.setItem(P.pinsKey('o', 'local'), '{not json');
    assert.deepEqual(P.loadPins(s, 'o', 'local'), []);
    const blocked = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
    assert.deepEqual(P.loadPins(blocked, 'o', 'local'), []);
    assert.doesNotThrow(() => P.addPin(blocked, 'o', 'local', { path: '/x' }));
    assert.doesNotThrow(() => P.removePin(blocked, 'o', 'local', '/x'));
});

test('entries without a path are dropped and the label defaults to the path', () => {
    const s = store();
    s.setItem(P.pinsKey('o', 'local'), JSON.stringify([{ path: '' }, { nope: 1 }, { path: '/d/a.zarr' }]));
    assert.deepEqual(P.loadPins(s, 'o', 'local'), [{ path: '/d/a.zarr', label: '/d/a.zarr', pinnedAt: 0 }]);
});
