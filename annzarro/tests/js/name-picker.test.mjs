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

const { NameSearchModel, fetchNameMatches, mergeScopedMatches } = await import('../../../static/js/utils/name-picker.js');

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

test('the dataset scope is sent for cells under a subset, and nowhere else', async () => {
    const urls = [];
    globalThis.fetch = async (u) => { urls.push(new URL(u, 'http://x')); return { ok: true, json: async () => page() }; };
    const base = { datasetPath: '/d.zarr', query: 'c1', subset: '{"n":2}' };
    await fetchNameMatches('/n', { ...base, entity: 'cells', scope: 'dataset' });
    await fetchNameMatches('/n', { ...base, entity: 'cells' });
    await fetchNameMatches('/n', { ...base, entity: 'genes', scope: 'dataset' });
    await fetchNameMatches('/n', { ...base, subset: null, entity: 'cells', scope: 'dataset' });
    assert.deepEqual(urls.map(u => u.searchParams.get('scope')), ['dataset', null, null, null]);
    assert.deepEqual(urls.map(u => u.searchParams.get('subset')), ['{"n":2}', '{"n":2}', null, null]);
});

const at = (name, index, row) => ({ name, index, row });

test('shown cells come first, then the others tagged outside, each once', () => {
    const shown = { matches: [at('c13', 0, 13), at('c1', 1, 1)], truncated: false };
    const all = { matches: [at('c1', 1, 1), at('c10', null, 10), at('c11', null, 11), at('c13', 0, 13)],
                  truncated: false };
    const merged = mergeScopedMatches(shown, all, 10);
    assert.deepEqual(merged.matches.map(m => [m.name, !!m.outside]),
                     [['c13', false], ['c1', false], ['c10', true], ['c11', true]]);
    assert.equal(merged.truncated, false);
});

test('the merged list keeps the limit and says when it cut', () => {
    const shown = { matches: [at('c1', 0, 1)], truncated: false };
    const all = { matches: [at('c2', null, 2), at('c3', null, 3), at('c4', null, 4)], truncated: false };
    const merged = mergeScopedMatches(shown, all, 2);
    assert.deepEqual(merged.matches.map(m => m.name), ['c1', 'c2']);
    assert.equal(merged.truncated, true);
    assert.equal(mergeScopedMatches(shown, { matches: [], truncated: true }, 5).truncated, true);
});

test('later results replace the list for the same query only, and keep the highlight', async () => {
    const more = deferred();
    const updates = [];
    const model = new NameSearchModel(async () => ({ ...page('c1', 'c2'), more: more.p }));
    model.onUpdate = () => updates.push(model.items.map(i => i.name));
    await model.setQuery('c');
    model.move(1);                                     // c2 highlighted
    more.resolve({ matches: [at('c1', 0, 1), at('c2', 1, 2), at('c9', null, 9)], truncated: false });
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(updates, [['c1', 'c2', 'c9']]);
    assert.equal(model.current().name, 'c2');

    const stale = deferred();
    const model2 = new NameSearchModel(async q => (q === 'a' ? { ...page('a1'), more: stale.p } : page('ab1')));
    model2.onUpdate = () => assert.fail('a stale extension was applied');
    await model2.setQuery('a');
    await model2.setQuery('ab');
    stale.resolve({ matches: [at('a9', null, 9)], truncated: false });
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(model2.items.map(i => i.name), ['ab1']);
});

test('a failed dataset-wide search leaves the shown cells\' matches', async () => {
    const model = new NameSearchModel(async () => ({ ...page('c1'), more: Promise.reject(new Error('x')) }));
    await model.setQuery('c');
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(model.items.map(i => i.name), ['c1']);
    assert.equal(model.error, null);
});
