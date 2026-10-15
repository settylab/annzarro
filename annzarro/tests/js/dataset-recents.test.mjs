/**
 * The recently opened datasets (static/js/utils/dataset-recents.js): kept per
 * origin and user, timestamped, capped, migrated once from the old user-less
 * list, and never throwing when storage is missing, full or broken.
 *
 * Run:  node --test annzarro/tests/js/dataset-recents.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
    RECENTS_LIMIT, loadRecents, recordRecent, clearRecents, recentsKey, userKey, LEGACY_KEY_PREFIX,
    lookupPaths, recentEntries
} = await import('../../../static/js/utils/dataset-recents.js');

const memory = () => {
    const m = new Map();
    return {
        m,
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: k => m.delete(k)
    };
};
const paths = list => list.map(r => r.path);

test('the user part of the key: the signed-in user, else local', () => {
    assert.equal(userKey({ auth_enabled: true, username: 'ada' }), 'user:ada');
    assert.equal(userKey({ auth_enabled: false, username: 'ada' }), 'local');
    assert.equal(userKey({ auth_enabled: true }), 'local');
    assert.equal(userKey(null), 'local');
    assert.notEqual(recentsKey('http://a', 'user:ada'), recentsKey('http://a', 'user:bob'));
    assert.notEqual(recentsKey('http://a', 'local'), recentsKey('http://b', 'local'));
});

test('newest first, timestamped, one entry per path, the label kept', () => {
    const st = memory();
    recordRecent(st, 'http://a', 'local', { path: '/d/x.zarr', label: 'x.zarr' }, 1000);
    recordRecent(st, 'http://a', 'local', { path: '/d/projects/liver/y.zarr', label: 'projects/liver/y.zarr' }, 2000);
    recordRecent(st, 'http://a', 'local', { path: '/d/x.zarr', label: 'x.zarr' }, 3000);
    const list = loadRecents(st, 'http://a', 'local');
    assert.deepEqual(list, [
        { path: '/d/x.zarr', label: 'x.zarr', openedAt: 3000 },
        { path: '/d/projects/liver/y.zarr', label: 'projects/liver/y.zarr', openedAt: 2000 }
    ]);
});

test('a store in a subfolder and a remote URL are kept as opened', () => {
    const st = memory();
    recordRecent(st, 'o', 'local', { path: 's3://lab/pbmc.zarr' }, 1);
    recordRecent(st, 'o', 'local', { path: '/d/a/b/c.zarr', label: 'a/b/c.zarr' }, 2);
    assert.deepEqual(paths(loadRecents(st, 'o', 'local')), ['/d/a/b/c.zarr', 's3://lab/pbmc.zarr']);
    assert.equal(loadRecents(st, 'o', 'local')[1].label, 's3://lab/pbmc.zarr', 'a label defaults to the path');
});

test('capped at RECENTS_LIMIT, the oldest dropped', () => {
    const st = memory();
    for (let i = 0; i < RECENTS_LIMIT + 5; i++) recordRecent(st, 'o', 'local', { path: `/p${i}` }, i + 1);
    const list = loadRecents(st, 'o', 'local');
    assert.equal(list.length, RECENTS_LIMIT);
    assert.equal(list[0].path, `/p${RECENTS_LIMIT + 4}`);
    assert.equal(list.at(-1).path, '/p5');
    recordRecent(st, 'o', 'local', { path: '/p10' }, 999);
    assert.equal(loadRecents(st, 'o', 'local')[0].path, '/p10');
    assert.equal(loadRecents(st, 'o', 'local').length, RECENTS_LIMIT);
});

test('kept per origin and per user: nobody sees another user\'s list', () => {
    const st = memory();
    recordRecent(st, 'http://a', 'user:ada', { path: '/ada.zarr' }, 1);
    recordRecent(st, 'http://a', 'user:bob', { path: '/bob.zarr' }, 2);
    recordRecent(st, 'http://b', 'user:ada', { path: '/other-server.zarr' }, 3);
    assert.deepEqual(paths(loadRecents(st, 'http://a', 'user:ada')), ['/ada.zarr']);
    assert.deepEqual(paths(loadRecents(st, 'http://a', 'user:bob')), ['/bob.zarr']);
    assert.deepEqual(paths(loadRecents(st, 'http://b', 'user:ada')), ['/other-server.zarr']);
    assert.deepEqual(loadRecents(st, 'http://a', 'local'), []);
    clearRecents(st, 'http://a', 'user:ada');
    assert.deepEqual(loadRecents(st, 'http://a', 'user:ada'), []);
    assert.deepEqual(paths(loadRecents(st, 'http://a', 'user:bob')), ['/bob.zarr'], 'clearing one user leaves the other');
});

test('the old list moves to the first user that loads, once, and no second user inherits it', () => {
    const st = memory();
    st.setItem(LEGACY_KEY_PREFIX + 'http://a', JSON.stringify(['/old1.zarr', '/old2.zarr', '/old1.zarr', 7, '']));
    const first = loadRecents(st, 'http://a', 'user:ada');
    assert.deepEqual(first, [
        { path: '/old1.zarr', label: '/old1.zarr', openedAt: 0 },
        { path: '/old2.zarr', label: '/old2.zarr', openedAt: 0 }
    ]);
    assert.equal(st.getItem(LEGACY_KEY_PREFIX + 'http://a'), null, 'the old key is removed');
    assert.deepEqual(loadRecents(st, 'http://a', 'user:bob'), []);
    // a new open goes above the migrated ones, which stay in order
    recordRecent(st, 'http://a', 'user:ada', { path: '/new.zarr' }, 5);
    assert.deepEqual(paths(loadRecents(st, 'http://a', 'user:ada')), ['/new.zarr', '/old1.zarr', '/old2.zarr']);
    // migrated once: the list the user now has is not replaced by a late old key
    st.setItem(LEGACY_KEY_PREFIX + 'http://a', JSON.stringify(['/late.zarr']));
    assert.deepEqual(paths(loadRecents(st, 'http://a', 'user:ada')), ['/new.zarr', '/old1.zarr', '/old2.zarr']);
});

test('a broken old list migrates to nothing; the old list of another origin stays', () => {
    const st = memory();
    st.setItem(LEGACY_KEY_PREFIX + 'http://a', '{not json');
    st.setItem(LEGACY_KEY_PREFIX + 'http://b', JSON.stringify(['/b.zarr']));
    assert.deepEqual(loadRecents(st, 'http://a', 'local'), []);
    assert.equal(st.getItem(LEGACY_KEY_PREFIX + 'http://a'), null);
    assert.equal(st.getItem(LEGACY_KEY_PREFIX + 'http://b') !== null, true);
});

test('broken storage and garbage never throw', () => {
    const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('denied'); } };
    assert.deepEqual(loadRecents(throwing, 's', 'local'), []);
    assert.doesNotThrow(() => recordRecent(throwing, 's', 'local', { path: '/x' }));
    assert.doesNotThrow(() => clearRecents(throwing, 's', 'local'));
    const at = value => ({ getItem: () => value, setItem() {}, removeItem() {} });
    assert.deepEqual(loadRecents(at('{not json'), 's', 'local'), []);
    assert.deepEqual(loadRecents(at('{"a":1}'), 's', 'local'), []);
    assert.deepEqual(loadRecents(at(JSON.stringify([null, 3, { path: '' }, { path: '/ok', openedAt: 'x' }])), 's', 'local'),
        [{ path: '/ok', label: '/ok', openedAt: 0 }]);
    assert.deepEqual(recordRecent(memory(), 's', 'local', { path: '' }), []);
});

test('lookupPaths posts the paths as JSON and returns the results; a refusal throws its sentence', async () => {
    const sent = [];
    const reply = (status, body) => async (url, init) => {
        sent.push([url, init.method, init.headers['Content-Type'], init.body]);
        return { ok: status < 400, status, statusText: 'x', json: async () => body };
    };
    const results = await lookupPaths('/api/v1/datasets/lookup', ['/a', 's3://b'], { send: reply(200, { results: [{ path: '/a' }, { path: 's3://b' }] }) });
    assert.deepEqual(results.map(r => r.path), ['/a', 's3://b']);
    assert.deepEqual(sent[0], ['/api/v1/datasets/lookup', 'POST', 'application/json', '{"paths":["/a","s3://b"]}']);
    await assert.rejects(lookupPaths('/u', ['/a'], { send: reply(400, { error: 'At most 200 paths' }) }), /At most 200 paths/);
    assert.deepEqual(await lookupPaths('/u', [], { send: () => { throw new Error('no request for no paths'); } }), []);
});

test('recentEntries: the listing entry when readable, greyed when not available, the label alone when unchecked', () => {
    const recents = [
        { path: '/d/projects/liver/deep.zarr', label: 'projects/liver/deep.zarr', openedAt: 3 },
        { path: '/d/gone.zarr', label: 'gone.zarr', openedAt: 2 },
        { path: 's3://lab/x.zarr', label: 's3://lab/x.zarr', openedAt: 1 }
    ];
    const deep = { path: '/d/projects/liver/deep.zarr', name: 'deep.zarr', cells: 200, genes: 20 };
    const entries = recentEntries(recents, [deep, { path: '/d/gone.zarr', status: 'unavailable' }, { path: 's3://lab/x.zarr', status: 'unchecked' }]);
    assert.equal(entries[0], deep);
    assert.deepEqual(entries[1], { path: '/d/gone.zarr', name: 'gone.zarr', rel_path: 'gone.zarr', error: 'Not available', unavailable: true });
    assert.deepEqual(entries[2], { path: 's3://lab/x.zarr', name: 'x.zarr', rel_path: 's3://lab/x.zarr' });
    assert.deepEqual(recentEntries(recents.slice(0, 1), []).map(e => e.name), ['deep.zarr'], 'no answer: the label alone');
});
