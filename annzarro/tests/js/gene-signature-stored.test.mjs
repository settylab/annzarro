/**
 * What a Gene Signature and a Gene Table store of their score options since decision 31 (SO-2): parameters, and the
 * legacy `method`/`input` pair an old consumer without a layer resolves through, never `offered` or `layers`. A link
 * made before still loads with every consumer on the layer it had; the reserved `methods` field (custom methods, after
 * 0.8.0) is kept as stored.
 *
 * Run:  node --test annzarro/tests/js/gene-signature-stored.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const G = await import('../../../static/js/utils/gene-signature.js');
const O = await import('../../../static/js/utils/signature-options.js');
const C = await import('../../../static/js/utils/score-column.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = (name) => JSON.parse(fs.readFileSync(path.join(here, '..', 'data', 'golden', `${name}.json`), 'utf8'));
const recipe = (raw) => G.normalizeRecipe(raw).recipe;

test('storedRecipe writes no offered and no layers, at the defaults and after any edit', () => {
    for (const raw of [{ genes: ['A'] }, { genes: ['A'], offered: ['sum', 'mean'], layers: ['counts', 'X'], input: 'counts' },
        { genes: ['A'], down: ['B'], clip: null, method: 'control_adjusted', seed: 4 }]) {
        const stored = G.storedRecipe(recipe(raw));
        assert.equal('offered' in stored, false, JSON.stringify(raw));
        assert.equal('layers' in stored, false, JSON.stringify(raw));
    }
});

test('the recipe in the panel has no offered or layers either: nothing reads them after loading', () => {
    const r = recipe(golden('gene_signature_offered_legacy'));
    assert.equal('offered' in r, false);
    assert.equal('layers' in r, false);
});

test('a golden old signature link loads on the same method and layer, and round-trips without the retired fields', () => {
    const raw = golden('gene_signature_offered_legacy');
    const r = recipe(raw);
    assert.equal(r.method, 'sum', 'the first offered method');
    assert.equal(r.input, 'logged', 'the stored input, the first offered layer');
    assert.equal(r.clip, 3, 'parameters kept');
    const stored = G.storedRecipe(r);
    assert.equal(stored.method, 'sum');
    assert.equal(stored.input, 'logged');
    const again = recipe(JSON.parse(JSON.stringify(stored)));
    assert.deepEqual(again, r, 'reloading the new link gives the same recipe');
    assert.equal(G.recipeHash(again), G.recipeHash(r), 'and the same score key');
});

test('a consumer of the golden old link saved without a layer is pinned to the layer it read before', () => {
    const r = recipe(golden('gene_signature_offered_legacy'));
    const plot = { color: { type: 'gene-score', key: 'gene-signature-S', column: 'mean' },
        x: { type: 'gene-score', key: 'gene-signature-S', column: 'sum', layer: 'X' } };
    const inputOf = (id) => (id === 'gene-signature-S' ? recipe(JSON.parse(JSON.stringify(G.storedRecipe(r)))).input : null);
    assert.equal(C.pinScoreLayers(plot, inputOf, () => ''), true);
    assert.equal(plot.color.layer, 'logged', 'the layer the old link drew');
    assert.equal(plot.x.layer, 'X', 'a stored layer is never moved');
});

test('a golden old gene table keeps its pair and stores no offered or layers', () => {
    const o = O.writableOptions(golden('gene_table_score_options_legacy'));
    assert.equal(o.method, 'mean');
    assert.equal(o.input, 'counts');
    assert.equal('offered' in o, false);
    assert.equal('layers' in o, false);
    assert.equal(O.isDefaultParams(o), true, 'parameters at their defaults');
    // read back as the panel reads its options (score-source-panels.js optionsOf)
    const read = O.normalizeOptions(JSON.parse(JSON.stringify(o)));
    assert.equal(read.method, 'mean');
    assert.equal(read.input, 'counts');
});

test('the reserved methods field (custom methods, after 0.8.0) is kept as stored and never reaches the server', () => {
    const custom = [{ id: 'c1', name: 'Mean weighted by logFC', base: 'mean', params: {}, weight: { type: 'var', key: 'logfoldchanges' } }];
    const r = recipe({ genes: ['A'], methods: custom });
    assert.deepEqual(G.storedRecipe(r).methods, custom);
    assert.equal('methods' in G.serverRecipe(r), false);
    assert.equal(G.recipeHash(r), G.recipeHash(recipe({ genes: ['A'] })), 'not in the score key');
    assert.equal('methods' in G.storedRecipe(recipe({ genes: ['A'] })), false, 'absent unless stored');
    assert.deepEqual(O.writableOptions({ methods: custom }).methods, custom, 'a gene table keeps it too');
});
