/**
 * The dataset browser's field-name hits (static/js/utils/dataset-browser-model.js): the snippet lines per kind,
 * the open dataset's own names, the index and no-hit sentences, the placeholder and the toggle's title.
 * The reply is the frozen one of plan 1.5, read from the fixture file the server tests also read.
 *
 * Run:  node --test annzarro/tests/js/dataset-browser-fields.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const M = await import('../../../static/js/utils/dataset-browser-model.js');
const reply = JSON.parse(readFileSync(new URL('../data/text_search_fields_reply.json', import.meta.url), 'utf8'));

const texts = line => line.names.map(n => n.parts.map(p => p.text).join(''));

test('a result of the frozen reply gives one line per kind, with the labels of the interface', () => {
    const lines = M.fieldLines(reply.results[0], 'donor');
    assert.deepEqual(lines.map(l => l.kind), ['obs', 'uns']);
    assert.deepEqual(lines.map(l => l.label), ['obs column', 'uns']);
    assert.deepEqual(texts(lines[0]), ['donor_id', 'donor_sex']);
    assert.deepEqual(texts(lines[1]), ['donor_metadata/age']);
    assert.equal(lines[0].moreText, '');
    assert.equal(lines[1].moreText, '+3 more');
    assert.equal(lines[1].cutText, '');
});

test('every kind has its label', () => {
    assert.deepEqual(M.FIELD_KINDS, ['obs', 'var', 'obsm', 'varm', 'layers', 'obsp', 'varp', 'uns']);
    assert.deepEqual(M.FIELD_KINDS.map(k => M.FIELD_LABELS[k]),
        ['obs column', 'var column', 'embedding (obsm)', 'varm', 'layer', 'obsp', 'varp', 'uns']);
});

test('the matched part of a name is marked with the query terms', () => {
    const [line] = M.fieldLines({ fields: [{ kind: 'obs', names: ['donor_id'], more: 0, cut: false }] }, 'ID "donor_"');
    assert.deepEqual(line.names[0].parts, [{ text: 'donor_', hit: true }, { text: 'id', hit: true }]);
});

test('"more" counts after five names and a cut store says its list was shortened', () => {
    const hit = { fields: [{ kind: 'layers', names: ['a', 'b', 'c', 'd', 'e'], more: 12, cut: true }] };
    const [line] = M.fieldLines(hit, 'x');
    assert.equal(line.names.length, 5);
    assert.equal(line.moreText, '+12 more');
    assert.equal(line.cutText, '(field list shortened)');
});

test('bad entries are dropped, not thrown on', () => {
    assert.deepEqual(M.fieldLines({}, 'x'), []);
    assert.deepEqual(M.fieldLines({ fields: 'no' }, 'x'), []);
    const lines = M.fieldLines({ fields: [null, { kind: 'bogus', names: ['a'] }, { kind: 'obs', names: [] }, { kind: 'obs', names: ['a', 7, null] }] }, 'a');
    assert.equal(lines.length, 1);
    assert.deepEqual(texts(lines[0]), ['a']);
});

test('Show field names the first field and the term that found it', () => {
    const target = M.showFieldTarget(reply.results[0], 'counts donor');
    assert.deepEqual(target, { name: 'donor_id', term: 'donor' });
    assert.equal(M.showFieldTarget({ fields: [] }, 'x'), null);
    assert.equal(M.showFieldLabel('donor_id', 'bm_aging.zarr'), 'Show donor_id in the structure of bm_aging.zarr');
});

const STRUCTURE = {
    obs: { total: 3, columns: [{ name: 'donor_id' }, { name: 'cell_type' }, { name: 'Donor_sex' }] },
    var: { total: 1, columns: [{ name: 'gene_name' }] },
    obsm: { total: 1, items: [{ name: 'X_umap' }] },
    layers: { total: 2, items: [{ name: 'counts' }, { name: 'donor_counts' }] },
    uns: { total: 1, children: [{ name: 'donor_metadata', type: 'group', total: 2, children: [{ name: 'age', type: 'array' }, { name: 'deep', type: 'group', total: 1, children: [{ name: 'x', type: 'group', total: 1, children: [{ name: 'too', type: 'array' }] }] }] }] }
};

test('the names of a structure, per kind, uns as paths to depth 3', () => {
    const names = M.structureNames(STRUCTURE);
    assert.deepEqual(names.obs, ['donor_id', 'cell_type', 'Donor_sex']);
    assert.deepEqual(names.obsm, ['X_umap']);
    assert.deepEqual(names.layers, ['counts', 'donor_counts']);
    assert.deepEqual(names.uns, ['donor_metadata', 'donor_metadata/age', 'donor_metadata/deep', 'donor_metadata/deep/x']);
    assert.deepEqual(M.structureNames(null), {});
});

test('the open dataset matches by its own structure and has the shape of the reply', () => {
    const hit = M.openDatasetHit({ path: '/d/bm.zarr', label: 'bm.zarr', structure: STRUCTURE, query: 'donor' });
    assert.equal(hit.path, '/d/bm.zarr');
    assert.deepEqual(hit.matched, ['obs', 'layers', 'uns']);
    assert.deepEqual(hit.fields.map(f => f.kind), ['obs', 'layers', 'uns']);
    assert.deepEqual(hit.fields[0].names, ['donor_id', 'Donor_sex']);
    assert.deepEqual(hit.fields[1].names, ['donor_counts']);
    assert.deepEqual(hit.fields[2].names, ['donor_metadata', 'donor_metadata/age', 'donor_metadata/deep', 'donor_metadata/deep/x']);
    assert.ok(hit.fields.every(f => f.more === 0 && f.cut === false));
});

test('every term must occur somewhere, in any kind; none occurring anywhere means no hit', () => {
    assert.ok(M.openDatasetHit({ path: '/d/a', label: 'a', structure: STRUCTURE, query: 'donor umap' }));
    assert.equal(M.openDatasetHit({ path: '/d/a', label: 'a', structure: STRUCTURE, query: 'donor zzz' }), null);
    assert.equal(M.openDatasetHit({ path: '/d/a', label: 'a', structure: null, query: 'donor' }), null);
    assert.equal(M.openDatasetHit({ path: '/d/a', label: 'a', structure: STRUCTURE, query: '  ' }), null);
});

test('a term that only the dataset name holds counts, but gives no field line of its own', () => {
    const hit = M.openDatasetHit({ path: '/d/bm_aging.zarr', label: 'bm_aging.zarr', structure: STRUCTURE, query: 'aging umap' });
    assert.deepEqual(hit.fields.map(f => f.kind), ['obsm']);
});

test('a whole-name match is listed first, five names at most, and the rest is counted', () => {
    const many = { obs: { total: 9, columns: ['b_x', 'c_x', 'd_x', 'e_x', 'f_x', 'g_x', 'x', 'h_x', 'i_x'].map(name => ({ name })) } };
    const hit = M.openDatasetHit({ path: '/d/a', label: 'a', structure: many, query: 'x' });
    assert.equal(hit.fields[0].names[0], 'x');
    assert.equal(hit.fields[0].names.length, 5);
    assert.equal(hit.fields[0].more, 4);
});

test('a structure that was cut says so', () => {
    const cut = { obs: { total: 600, columns: [{ name: 'donor_id' }] } };
    assert.equal(M.openDatasetHit({ path: '/d/a', label: 'a', structure: cut, query: 'donor' }).fields[0].cut, true);
});

test('the open dataset is put first and its names replace the server fields; other hits keep their order', () => {
    const server = [{ path: '/d/x', rel_path: 'x' }, { path: '/d/bm.zarr', rel_path: 'bm.zarr', title: 'T', score: 9, matched: ['readme'], snippet: { field: 'readme', text: 'r', highlights: [] } }];
    const open = M.openDatasetHit({ path: '/d/bm.zarr', label: 'bm.zarr', structure: STRUCTURE, query: 'donor' });
    const merged = M.withOpenHit(server, open);
    assert.deepEqual(merged.map(h => h.path), ['/d/bm.zarr', '/d/x']);
    assert.equal(merged[0].title, 'T');
    assert.deepEqual(merged[0].matched, ['readme', 'obs', 'layers', 'uns']);
    assert.equal(merged[0].fields.length, 3);
    // not in the server's answer at all (the crawl has not reached it)
    const alone = M.withOpenHit([{ path: '/d/x' }], open);
    assert.deepEqual(alone.map(h => h.path), ['/d/bm.zarr', '/d/x']);
    assert.equal(M.withOpenHit(server, null), server);
});

test('a store found by name still shows its field lines, once', () => {
    const rows = [{ kind: 'store', path: '/d/a', name: 'a' }, { kind: 'store', path: '/d/b', name: 'b' }];
    const hits = [{ path: '/d/a', fields: [{ kind: 'obs', names: ['x'], more: 0, cut: false }] }, { path: '/d/b', fields: [] }];
    const out = M.withFieldHits(rows, hits);
    assert.equal(out.length, 2);
    assert.equal(out[0].fields.length, 1);
    assert.equal(out[1].fields, undefined);
    assert.equal(rows[0].fields, undefined, 'the input rows are not changed');
});

test('the line about the index says field names are being read, with the counts when there are some', () => {
    const building = { complete: false, names: { state: 'building', read: 41, total: 212 } };
    assert.equal(M.indexLine(building), 'Field names are still being indexed: 41 of 212 datasets read. Results may be incomplete.');
    assert.equal(M.indexLine({ complete: false, names: { state: 'building' } }), 'Field names are still being indexed. Results may be incomplete.');
    assert.equal(M.indexLine({ complete: true, names: { state: 'ready' } }), null);
    assert.equal(M.indexLine({ complete: false, searched: 3, total: 9, names: { state: 'ready' } }), 'Descriptions of 3 of 9 datasets searched so far');
    assert.equal(M.fieldNamesBuilding(building), true);
    assert.equal(M.fieldNamesBuilding({ names: { state: 'ready' } }), false);
    assert.equal(M.fieldNamesBuilding(null), false);
});

test('a query with no hit', () => {
    assert.equal(M.noHitText('donr', null), "No dataset has a name, description or field matching 'donr'.");
    assert.equal(M.noHitText('donr', { names: { state: 'building', read: 1, total: 2 } }), 'No dataset matches yet: field names are still being indexed');
});

test('the placeholder and the toggle name what is searched', () => {
    assert.equal(M.searchPlaceholder({ textOn: true, narrow: false }), 'Search names, descriptions, READMEs and field names (columns, layers, embeddings)');
    assert.equal(M.searchPlaceholder({ textOn: true, narrow: true }), 'Search names, descriptions and fields');
    assert.equal(M.searchPlaceholder({ textOn: false, narrow: false }), 'Search name or path');
    assert.equal(M.TEXT_TOGGLE.title, 'Also search descriptions, READMEs and field names (Alt+D)');
    assert.equal(M.TEXT_TOGGLE.label, 'Descriptions');
});
