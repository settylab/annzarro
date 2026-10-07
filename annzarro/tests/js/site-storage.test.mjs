/**
 * Clearing the site's browser storage (static/js/utils/site-storage.js), used
 * by "Close all panels" with its tick box.
 *
 * Pinned: every store is cleared; a store that fails does not stop the
 * others; cookies are never touched; the bare URL has no query or fragment.
 *
 * Run:  node --test annzarro/tests/js/site-storage.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { clearSiteStorage, bareUrl, KEEP } = await import('../../../static/js/utils/site-storage.js');

function area(initial = {}) {
    const m = new Map(Object.entries(initial));
    return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
        clear: () => m.clear() };
}

function fakeEnv(over = {}) {
    const deleted = [];
    const env = {
        localStorage: area({ annzarro_autosave: '{}', 'annzarro:external-ok': '{}' }),
        sessionStorage: area({ a: '1' }),
        indexedDB: {
            databases: async () => [{ name: 'one' }, { name: 'two' }, {}],
            deleteDatabase(name) { deleted.push(name); const r = {}; setTimeout(() => r.onsuccess(), 0); return r; },
        },
        caches: { names: ['c1', 'c2'], keys: async function () { return this.names; },
            delete: async function (n) { this.names = this.names.filter(x => x !== n); return true; } },
        navigator: { serviceWorker: { regs: [{ unregister: async function () { this.gone = true; } }],
            getRegistrations: async function () { return this.regs; } } },
        cookie: 'session=abc',
        ...over,
    };
    return { env, deleted };
}

test('clears every store and reports each', async () => {
    const { env, deleted } = fakeEnv();
    const r = await clearSiteStorage(env);
    assert.deepEqual(r.failed, []);
    assert.deepEqual(r.cleared, ['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'serviceWorkers']);
    assert.equal(env.localStorage.m.size, 0);
    assert.equal(env.sessionStorage.m.size, 0);
    assert.deepEqual(deleted, ['one', 'two']);
    assert.deepEqual(env.caches.names, []);
    assert.equal(env.navigator.serviceWorker.regs[0].gone, true);
});

test('cookies are never touched', async () => {
    const { env } = fakeEnv();
    await clearSiteStorage(env);
    assert.equal(env.cookie, 'session=abc');
});

test('no auth or CSRF key is kept in web storage, so nothing is preserved', () => {
    assert.deepEqual([...KEEP.local, ...KEEP.session], []);
});

test('one failing store does not stop the others', async () => {
    const { env } = fakeEnv({
        localStorage: { getItem: () => null, clear() { throw new Error('blocked'); } },
        indexedDB: { databases: async () => { throw new Error('nope'); } },
    });
    const r = await clearSiteStorage(env);
    assert.deepEqual(r.failed, ['localStorage', 'indexedDB']);
    assert.deepEqual(r.cleared, ['sessionStorage', 'caches', 'serviceWorkers']);
    assert.equal(env.sessionStorage.m.size, 0);
});

test('missing APIs are skipped, not errors', async () => {
    const r = await clearSiteStorage({ localStorage: area({ x: '1' }) });
    assert.deepEqual(r, { cleared: ['localStorage', 'sessionStorage'], failed: [] });
});

test('bare URL drops the query and the fragment, keeps the path', () => {
    assert.equal(bareUrl({ origin: 'http://h:1', pathname: '/explore/', search: '?dataset_path=/x', hash: '#view=abc' }),
        'http://h:1/explore/');
});

test('clearSiteStorageNow empties both synchronous stores', async () => {
    const { clearSiteStorageNow } = await import('../../../static/js/utils/site-storage.js');
    const { env } = fakeEnv();
    clearSiteStorageNow(env);
    assert.equal(env.localStorage.m.size + env.sessionStorage.m.size, 0);
});
