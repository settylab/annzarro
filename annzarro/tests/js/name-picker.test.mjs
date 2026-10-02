/**
 * The header's Focused Cell / Gene pickers are server-backed typeaheads
 * (static/js/utils/name-picker.js) instead of <select>s holding every name,
 * which froze the tab for ~15 s at a million cells.
 *
 * A typeahead has one classic bug: answers arrive out of order, and a slow
 * answer to "c" overwrites the answer to "cell_01" typed after it. These
 * tests pin that the model only ever shows the answer to the LATEST query,
 * and the keyboard highlight rules the view relies on.
 *
 * Run:  node --test annzarro/tests/js/name-picker.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { NameSearchModel, fetchNameMatches } = await import('../../../static/js/utils/name-picker.js');

const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const page = (...names) => ({ matches: names.map((name, index) => ({ name, index })), truncated: false });

test('a slow answer to an older query never replaces the newer answer', async () => {
    const pending = {};
    const model = new NameSearchModel(q => { pending[q] = deferred(); return pending[q].p; });
    const first = model.setQuery('c');
    const second = model.setQuery('cell_01');
    pending['cell_01'].resolve(page('cell_010', 'cell_011'));
    assert.equal(await second, true);
    pending['c'].resolve(page('cell_000', 'cell_001', 'cell_002'));
    assert.equal(await first, false, 'the stale answer was applied');
    assert.deepEqual(model.items.map(i => i.name), ['cell_010', 'cell_011']);
});

test('a newer query aborts the request of the older one', async () => {
    const signals = [];
    const model = new NameSearchModel((q, { signal }) => { signals.push(signal); return new Promise(() => {}); });
    model.setQuery('a');
    model.setQuery('ab');
    assert.equal(signals[0].aborted, true);
    assert.equal(signals[1].aborted, false);
});

test('results highlight the first match; arrows wrap around', async () => {
    const model = new NameSearchModel(async () => page('a', 'b', 'c'));
    await model.setQuery('x');
    assert.equal(model.current().name, 'a');
    model.move(-1);
    assert.equal(model.current().name, 'c');
    model.move(1);
    model.move(1);
    assert.equal(model.current().name, 'b');
});

test('no match leaves nothing to pick', async () => {
    const model = new NameSearchModel(async () => page());
    await model.setQuery('zzz');
    assert.equal(model.current(), null);
    model.move(1);
    assert.equal(model.current(), null);
});

test('a server error is shown, not thrown', async () => {
    const model = new NameSearchModel(async () => { throw new Error('Invalid regular expression: missing )'); });
    assert.equal(await model.setQuery('(', { regex: true }), true);
    assert.equal(model.items.length, 0);
    assert.match(model.error, /regular expression/);
});

test('the regex flag is passed through and remembered', async () => {
    const seen = [];
    const model = new NameSearchModel(async (q, { regex }) => { seen.push([q, regex]); return page(); });
    await model.setQuery('^a', { regex: true });
    await model.setQuery('^ab');
    assert.deepEqual(seen, [['^a', true], ['^ab', true]]);
});

test('fetchNameMatches asks /data/names with the query, axis and limit', async () => {
    let url;
    globalThis.fetch = async (u) => { url = new URL(u, 'http://x'); return { ok: true, json: async () => page('GENE007') }; };
    const body = await fetchNameMatches('/api/v1/data/names', {
        datasetPath: '/d.zarr', entity: 'genes', query: 'gene007', limit: 5 });
    assert.equal(url.pathname, '/api/v1/data/names');
    assert.equal(url.searchParams.get('dataset_path'), '/d.zarr');
    assert.equal(url.searchParams.get('entity'), 'genes');
    assert.equal(url.searchParams.get('q'), 'gene007');
    assert.equal(url.searchParams.get('limit'), '5');
    assert.equal(url.searchParams.get('mode'), 'substring');
    assert.equal(body.matches[0].name, 'GENE007');

    globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'bad regex' }) });
    await assert.rejects(fetchNameMatches('/n', { datasetPath: '/d', entity: 'cells', query: '(' }), /bad regex/);
});
