/**
 * The dataset browser's search over descriptions (static/js/utils/dataset-browser-model.js): merging the
 * text hits under the name matches, snippets from UTF-16 offsets, the index line and the next page.
 *
 * Run:  node --test annzarro/tests/js/dataset-browser-text.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../../../static/js/utils/dataset-browser-model.js');

const hit = (name, extra = {}) => ({ name, path: `/d/${name}`, rel_path: name, title: `Title of ${name}`, score: 5, matched: ['readme'], ...extra });

test('text hits come after the name matches and a store found both ways is listed once', () => {
    const names = [{ kind: 'store', path: '/d/a.zarr', name: 'a.zarr' }];
    const rows = M.textRows(names, [hit('a.zarr'), hit('b.zarr'), hit('b.zarr'), hit('c.zarr', { matched: undefined })]);
    assert.deepEqual(rows.map(r => r.name), ['b.zarr', 'c.zarr']);
    assert.ok(rows.every(r => r.kind === 'store' && r.textHit === true));
    assert.deepEqual(rows[1].matched, [], 'a missing `matched` is an empty list');
    assert.deepEqual(M.textRows(names, null), []);
});

test('the match chip does not hide description hits, and a hit like the view carries its badge', () => {
    const like = new Map([['/d/b.zarr', { match: 'same' }]]);
    const annotate = row => (like.has(row.path) ? { ...row, ...like.get(row.path) } : row);
    const on = { ...M.emptyFilters(), matches: true };
    const rows = M.textSection([], [hit('b.zarr', { format: 'zarr' }), hit('c.zarr', { format: 'zarr' })], on, annotate);
    assert.deepEqual(rows.map(r => r.name), ['b.zarr', 'c.zarr'], 'the chip is on (as when it is switched on for a view without data): both hits stay');
    assert.equal(M.matchBadge(rows[0]), 'same cells and genes');
    assert.equal(M.matchBadge(rows[1]), '');
    // the bug this fixes: through applyFilters with the chip on, every hit was dropped, the matching one too
    assert.deepEqual(M.applyFilters(M.textRows([], [hit('b.zarr')]), on), []);
    // the other chips still narrow the section
    const h5 = { ...M.emptyFilters(), formats: new Set(['h5ad']), matches: true };
    assert.deepEqual(M.textSection([], [hit('b.zarr', { format: 'zarr' })], h5, annotate), []);
});

test('the match chip says what it keeps', () => {
    assert.equal(M.MATCH_CHIP.label, "Like this view's dataset");
    assert.match(M.MATCH_CHIP.title, /same cells and genes, the same size, or the same name as the dataset this view was made on/);
});

test('a hit without a path is keyed by its relative path', () => {
    const rows = M.textRows([], [{ name: 'x.zarr', path: null, rel_path: 'grant/x.zarr' }]);
    assert.equal(rows[0].path, 'grant/x.zarr');
});

test('a snippet is cut at its offsets', () => {
    const parts = M.snippetParts({ text: 'a Preprocessing step', highlights: [[2, 15]] });
    assert.deepEqual(parts, [{ text: 'a ', hit: false }, { text: 'Preprocessing', hit: true }, { text: ' step', hit: false }]);
    assert.deepEqual(M.snippetParts({ text: 'plain', highlights: [] }), [{ text: 'plain', hit: false }]);
    assert.deepEqual(M.snippetParts(null), []);
    assert.deepEqual(M.snippetParts({ text: '' }), []);
});

test('offsets count UTF-16 units: accents, astral characters and right-to-left text', () => {
    // "Zoë Müller" has no surrogate pairs; the emoji is two units, so what follows it is shifted by two
    const text = 'Zoë Müller 🧬 Müller';
    const second = text.lastIndexOf('Müller');
    assert.equal(second, 14);
    const parts = M.snippetParts({ text, highlights: [[4, 10], [second, second + 6]] });
    assert.deepEqual(parts.filter(p => p.hit).map(p => p.text), ['Müller', 'Müller']);
    const arabic = 'كلمة بحث';
    assert.deepEqual(M.snippetParts({ text: arabic, highlights: [[5, 8]] }).find(p => p.hit).text, 'بحث');
});

test('bad offsets are dropped, clamped, merged and never split a surrogate pair', () => {
    const text = 'ab🧬cd';
    assert.deepEqual(M.snippetParts({ text, highlights: [[3, 4]] }).find(p => p.hit).text, '🧬', 'a cut inside the pair takes the whole pair');
    assert.deepEqual(M.snippetParts({ text, highlights: [[-5, 1], [4, 99]] }).filter(p => p.hit).map(p => p.text), ['a', 'cd']);
    const merged = M.snippetParts({ text: 'abcdef', highlights: [[1, 3], [2, 5], [4, 2], ['x', 1], null, [3.5, 4]] });
    assert.deepEqual(merged, [{ text: 'a', hit: false }, { text: 'bcde', hit: true }, { text: 'f', hit: false }]);
});

test('the query is split into words and quoted phrases', () => {
    assert.deepEqual(M.queryTerms('  pre   "bone marrow" aging '), ['pre', 'bone marrow', 'aging']);
    assert.deepEqual(M.queryTerms(''), []);
    assert.deepEqual(M.queryTerms('""'), []);
});

test('terms are found without regard to case or accents, with offsets in the original text', () => {
    assert.deepEqual(M.termRanges('Zoë MÜLLER wrote it', ['zoe', 'muller']), [[0, 3], [4, 10]]);
    assert.deepEqual(M.termRanges('🧬 Preprocessing', ['preprocessing']), [[3, 16]]);
    assert.deepEqual(M.termRanges('aaa', ['aa']), [[0, 2]]);
    assert.deepEqual(M.termRanges('ab ab', ['ab', 'b a']), [[0, 5]], 'overlapping terms merge');
    assert.deepEqual(M.termRanges('nothing', ['xyz']), []);
    assert.deepEqual(M.termRanges('text', []), []);
});

test('the index line: nothing when every dataset is searched, else how far it is', () => {
    assert.equal(M.indexLine({ complete: true }), null, 'complete: no line');
    assert.equal(M.indexLine(null), null);
    assert.equal(M.indexLine({}), null, 'an answer that says nothing');
    assert.equal(M.indexLine({ complete: false, searched: 120, total: 3400 }), 'Descriptions of 120 of 3,400 datasets searched so far');
    assert.equal(M.indexLine({ complete: false, searched: 0, total: 3400 }), 'Descriptions of 0 of 3,400 datasets searched so far');
    assert.equal(M.indexLine({ complete: false, searched: 9, total: 4 }), 'Descriptions of 4 of 4 datasets searched so far', 'never more searched than there are');
    assert.equal(M.indexLine({ complete: false, searched: 5, total: null }), 'Descriptions of some datasets are not searched yet', 'total not known yet');
    assert.equal(M.indexLine({ complete: false }), 'Descriptions of some datasets are not searched yet', 'a restricted user: no counts');
    assert.match(M.indexLine({ complete: false, capped: true, searched: 20000 }), /^Descriptions of 20,000 datasets searched; .*limit/);
    assert.match(M.indexLine({ complete: false, capped: true }), /not searched.*limit/);
});

test('the label of the next page of hits', () => {
    assert.equal(M.moreLabel(12), '12 more');
    assert.equal(M.moreLabel(1234), '1,234 more');
    assert.equal(M.moreLabel(0), '');
    assert.equal(M.moreLabel(undefined), '');
});
