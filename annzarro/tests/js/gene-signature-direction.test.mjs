/**
 * Up and down genes in the model (static/js/utils/gene-signature.js, signature-options.js, score-sources.js):
 * moving genes between the sides, adding on a side, the key that changes when a gene flips, undo that restores both
 * sides, the methods that cannot score down genes, and the stored form (old links have none).
 *
 * Run:  node --test annzarro/tests/js/gene-signature-direction.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const G = await import('../../../static/js/utils/gene-signature.js');
const O = await import('../../../static/js/utils/signature-options.js');
const S = await import('../../../static/js/utils/score-sources.js');
const SS = await import('../../../static/js/utils/score-store.js');
const N = await import('../../../static/js/utils/score-notices.js');

const recipe = (raw) => G.normalizeRecipe(raw).recipe;

test('the methods that can score down genes are the server\'s', () => {
    const py = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'core', 'gene_score.py'), 'utf8');
    const methods = /DOWN_METHODS = \(([^)]*)\)/.exec(py)[1].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean);
    assert.deepEqual(methods, [...O.DOWN_METHODS]);
    assert.ok(O.canScoreDown('zscore_mean') && O.canScoreDown('mean') && O.canScoreDown('control_adjusted'));
    assert.ok(!O.canScoreDown('sum') && !O.canScoreDown('fraction_of_genes') && !O.canScoreDown('fraction_of_total'));
});

test('an old link has no down genes and the switch is off; down genes switch it on', () => {
    const old = recipe({ genes: ['A', 'B'] });
    assert.deepEqual([old.down, old.directions], [[], false]);
    assert.equal('directions' in G.storedRecipe(old), false, 'nothing about direction is stored when it is off');
    const withDown = recipe({ genes: ['A'], down: ['B'] });
    assert.equal(withDown.directions, true);
    assert.equal(G.storedRecipe(withDown).directions, true);
    assert.deepEqual(G.storedRecipe(withDown).down, ['B']);
    assert.equal(recipe({ genes: ['A'], directions: true }).directions, true, 'left on with no down genes');
    assert.equal(recipe({ genes: ['A'], directions: 'yes' }).directions, false);
    // a round trip through a link's JSON
    assert.deepEqual(recipe(JSON.parse(JSON.stringify(G.storedRecipe(withDown)))), withDown);
});

test('the switch is not a score setting: it is not sent to the server and not in the key', () => {
    const a = recipe({ genes: ['A'] });
    const b = recipe({ genes: ['A'], directions: true });
    assert.equal('directions' in G.serverRecipe(b), false);
    assert.equal(G.recipeHash(a), G.recipeHash(b));
    assert.deepEqual(G.serverRecipe(recipe({ genes: ['A'], down: ['B'] })).down, ['B']);
});

test('flipping a gene changes the cache key; swapping the order of the lists does not', () => {
    const base = recipe({ genes: ['A', 'B', 'C'], down: ['D'] });
    const flipped = recipe({ genes: ['A', 'B'], down: ['C', 'D'] });
    assert.notEqual(G.recipeHash(base), G.recipeHash(flipped));
    assert.equal(G.recipeHash(base), G.recipeHash(recipe({ genes: ['C', 'B', 'A'], down: ['D'] })));
    assert.notEqual(G.recipeHash(recipe({ genes: ['A'], down: ['B'] })), G.recipeHash(recipe({ genes: ['B'], down: ['A'] })), 'the sides are not interchangeable');
    assert.notEqual(G.recipeHash(recipe({ genes: ['A', 'B'] })), G.recipeHash(base));
});

test('a gene named on both sides counts as up and the panel is told', () => {
    const { recipe: r, notes } = G.normalizeRecipe({ genes: ['A', 'B'], down: ['B', 'C'] });
    assert.deepEqual([r.genes, r.down], [['A', 'B'], ['C']]);
    assert.match(notes[0], /both sides/);
});

test('planDirection moves genes between the sides and leaves strangers alone', () => {
    const r = recipe({ genes: ['A', 'B', 'C'], down: ['D'] });
    let p = G.planDirection(r, ['B', 'D', 'Z'], 'down');
    assert.deepEqual([p.genes, p.down, p.changed, p.same], [['A', 'C'], ['B', 'D'], ['B'], 1]);
    p = G.planDirection(r, ['D'], 'up');
    assert.deepEqual([p.genes, p.down, p.changed], [['A', 'C', 'B', 'D'].sort(), [], ['D']]);
    p = G.planDirection(r, ['A', 'B', 'C'], 'up');
    assert.deepEqual([p.changed, p.same, p.genes, p.down], [[], 3, r.genes, r.down], 'nothing to do');
    p = G.planDirection(r, ['nope'], 'down');
    assert.deepEqual(p.changed, []);
});

test('planDirection keeps both lists sorted and disjoint, whatever the moves', () => {
    const names = Array.from({ length: 40 }, (_, i) => `G${String(i * 7 % 40).padStart(2, '0')}`);
    let r = recipe({ genes: names.slice(0, 25), down: names.slice(25) });
    for (const [pick, dir] of [[names.filter((_, i) => i % 3 === 0), 'down'], [names.filter((_, i) => i % 5 === 0), 'up'], [names, 'down'], [names.slice(10, 20), 'up']]) {
        const p = G.planDirection(r, pick, dir);
        r = { ...r, genes: p.genes, down: p.down };
        assert.deepEqual(p.genes, [...p.genes].sort(), 'up sorted');
        assert.deepEqual(p.down, [...p.down].sort(), 'down sorted');
        assert.equal(p.genes.filter(g => p.down.includes(g)).length, 0, 'disjoint');
        assert.equal(p.genes.length + p.down.length, 40, 'no gene lost or made twice');
    }
});

test('planAddAs adds on a side and leaves genes already in the signature where they are', () => {
    const r = recipe({ genes: ['A'], down: ['B'] });
    let p = G.planAddAs(r, ['A', 'B', 'C', 'D', 'C', ''], 'down');
    assert.deepEqual([p.genes, p.down, p.added, p.already], [['A'], ['B', 'C', 'D'], ['C', 'D'], 2]);
    p = G.planAddAs(r, ['C'], 'up');
    assert.deepEqual([p.genes, p.down], [['A', 'C'], ['B']]);
});

test('a bulk change of direction on a long list says exactly what moved', () => {
    // no gene limit: 20,000 genes on each side, every other one moved (a quadratic walk here would take seconds)
    const pad = (i) => `G${String(i).padStart(6, '0')}`;
    const up = Array.from({ length: 20000 }, (_, i) => pad(2 * i));
    const down = Array.from({ length: 20000 }, (_, i) => pad(2 * i + 1));
    const r = recipe({ genes: up, down });
    const asked = [...up.filter((_, i) => i % 2 === 0), ...down.slice(0, 5), 'NOT_IN_IT', up[0]];
    const p = G.planDirection(r, asked, 'down');
    assert.equal(p.changed.length, 10000);
    assert.equal(p.same, 5);
    assert.equal(p.genes.length, 10000);
    assert.equal(p.down.length, 30000);
    assert.deepEqual(p.down.slice(0, 4), [pad(0), pad(1), pad(3), pad(4)], 'merged in name order');
    assert.deepEqual(G.planDirection(r, ['NOT_IN_IT'], 'up'), { genes: r.genes, down: r.down, changed: [], same: 0 });
});

test('the Selected view lists both sides in name order; the counts and formula are in plain words', () => {
    const r = recipe({ genes: ['A', 'C'], down: ['B', 'D'] });
    assert.deepEqual(G.selectedNames(r), ['A', 'B', 'C', 'D']);
    assert.equal(G.directionCounts(r), '2 up, 2 down');
    assert.equal(G.directionCounts(recipe({ genes: ['A'] })), '', 'nothing to say without down genes');
    // the formula follows the weighting in force: by gene is the default, by side is the difference of two means
    assert.equal(G.directionFormula(r), 'Score = the 2 up genes minus the 2 down genes, averaged over all 4 genes: each gene weighs equally.'
        + ' Control-adjusted takes each side minus its own control genes.');
    assert.equal(G.directionFormula({ ...r, down_weight: 'side' }), 'Score = average of the 2 up genes minus average of the 2 down genes: each side weighs equally.'
        + ' Control-adjusted takes each side minus its own control genes.');
    assert.equal(G.directionFormula(recipe({ genes: ['A'], down: ['B'] })), 'Score = the 1 up gene minus the 1 down gene, averaged over both genes: each gene weighs equally.'
        + ' Control-adjusted takes each side minus its own control genes.');
    assert.match(G.directionFormula(recipe({ down: ['A'] })), /negative of their average/);
    assert.equal(G.directionFormula(recipe({ genes: ['A'] })), '');
});

test('undo restores both sides', () => {
    const u = new G.UndoStack();
    u.push('make B down', ['A', 'B'], { down: ['C'] });
    u.push('add 2 genes', ['A'], {});
    assert.equal(u.pop().down, null, 'a step that did not record the down genes says so');
    const step = u.pop();
    assert.deepEqual([step.before, step.down], [['A', 'B'], ['C']]);
    const down = ['C'];
    u.push('x', [], { down });
    down.push('D');
    assert.deepEqual(u.peek().down, ['C'], 'the step keeps its own copy');
});

// ------------------------------------------------------------------ what can be offered

test('with down genes sum, fraction of genes and % of total cannot, with the reason, and are disabled where chosen', () => {
    const choices = (r, kind) => Object.fromEntries(O.scoreMethodChoices({ recipe: r, layer: 'X', kinds: { X: kind } }).map(o => [o.value, o]));
    const by = choices(recipe({ genes: ['A'], down: ['B'] }), 'normalised');
    for (const m of ['zscore_mean', 'mean', 'control_adjusted']) assert.equal(by[m].disabled, false, m);
    for (const m of ['sum', 'fraction_of_genes', 'fraction_of_total']) {
        assert.equal(by[m].disabled, true, m);
        assert.match(by[m].title, / cannot be computed with down genes: /);
    }
    assert.notEqual(by.sum.reason, by.fraction_of_genes.reason);
    // without down genes nothing changes
    const plain = choices(recipe({ genes: ['A'] }), 'counts');
    assert.equal(plain.sum.disabled || plain.fraction_of_genes.disabled, false);
    assert.equal(O.gradeOption('sum', 'X', 'normalised').grade, 'ok');
    assert.equal(O.gradeOption('sum', 'X', 'normalised', true).down, true);
});

// ------------------------------------------------------------------ a consumer of a method that cannot

test('a consumer on a method that cannot score down genes asks nothing of the server and says so', async () => {
    let asked = 0;
    const api = { async estimate() { asked++; return { estimate: { seconds: 1, tier: 'auto', auto_max_s: 60, max_s: 600, live_max_s: 5 } }; },
        compute() { asked++; return new Promise(() => {}); } };
    const store = SS.createScoreStore({ api });
    const sigs = new Map();
    const sig = { title: 'T', recipe: () => recipe({ genes: sig.genes, down: sig.down }), genes: ['A'], down: ['B'] };
    sigs.set('S1', sig);
    const sources = S.createScoreSources({ store, signatures: { get: (id) => sigs.get(id), off: () => false }, context: () => ({ dataset: 'd', subset: null }) });
    const sum = sources.watch('S1', { onChange() {}, kind: 'plot', sub: 'sum', layer: 'X' });
    const snap = sum.read();
    assert.equal(snap.state, 'nodown');
    assert.equal(snap.method, 'sum');
    const notice = N.describeScore(snap, { role: 'colour' });
    assert.equal(notice.state, 'nodown');
    assert.match(notice.headline, /has down genes, which sum cannot score/);
    await new Promise(r => setTimeout(r, 5));
    assert.equal(asked, 0, 'no request');
    const mean = sources.watch('S1', { onChange() {}, kind: 'plot', sub: 'mean', layer: 'X' });
    assert.notEqual(mean.read().state, 'nodown', 'a method that can goes on');
    // dropping the down genes brings the sum back
    sig.down = [];
    sources.update('S1');                      // Update score: the edit is applied
    assert.notEqual(sum.read().state, 'nodown');
});

// ------------------------------------------------------------------ the sign column of a pasted table

test('a sign column gives each gene the sign of its first row; zero, blank and text have none', async () => {
    const P = await import('../../../static/js/utils/gene-paste.js');
    const text = 'gene,logfc,other\nA,2.5,1\nB,-1,1\nC,0,1\nD,,1\nE,x,1\nA,-9,1\n';
    const r = P.parseGeneInput(text, { readAs: 'table', header: true, column: 0, signColumn: 1 });
    assert.deepEqual([...r.signs.entries()].map(([k, v]) => [k, Number.isNaN(v) ? 'none' : v]),
        [['A', 1], ['B', -1], ['C', 'none'], ['D', 'none'], ['E', 'none']]);
    assert.equal(P.parseGeneInput(text, { readAs: 'table', header: true, column: 0 }).signs, null, 'no sign column, no signs');
    assert.equal(P.parseGeneInput(text, { readAs: 'table', header: true, column: 0, signColumn: 0 }).signs, null, 'the gene column is not a sign');
    const m = P.matchGenes(['a', 'B'], { geneNames: ['A', 'B'], currentGenes: ['B'] });
    assert.equal(m.inputOf.get('A'), 'a', 'a case match remembers what was pasted');
    assert.deepEqual([m.toAdd, m.alreadyNames], [['A'], ['B']]);
});


// ------------------------------------------------------------------ how down genes weigh

test('the weighting defaults to each gene, is stored only when it is by side, and a bad value reads as the default', () => {
    assert.equal(recipe({ genes: ['A'], down: ['B'] }).down_weight, 'gene');
    assert.equal(recipe({ genes: ['A'], down: ['B'], down_weight: 'side' }).down_weight, 'side');
    assert.equal(recipe({ genes: ['A'], down: ['B'], down_weight: 'both' }).down_weight, 'gene');
    assert.equal('down_weight' in G.storedRecipe(recipe({ genes: ['A'], down: ['B'] })), false, 'an old config with down genes reads as each gene');
    assert.equal(G.storedRecipe(recipe({ genes: ['A'], down: ['B'], down_weight: 'side' })).down_weight, 'side');
    assert.equal(G.serverRecipe(recipe({ genes: ['A'], down: ['B'], down_weight: 'side' })).down_weight, 'side');
    assert.deepEqual(recipe(JSON.parse(JSON.stringify(G.storedRecipe(recipe({ genes: ['A'], down: ['B'], down_weight: 'side' }))))).down_weight, 'side');
});

test('the weighting is in the key where it changes a number, and nowhere else', () => {
    const base = { genes: ['A', 'B'], down: ['C'] };
    const hash = (extra, method = 'zscore_mean') => G.recipeHash({ ...recipe({ ...base, ...extra }), method });
    for (const method of ['zscore_mean', 'mean']) assert.notEqual(hash({ down_weight: 'gene' }, method), hash({ down_weight: 'side' }, method), method);
    assert.equal(hash({ down_weight: 'gene' }, 'control_adjusted'), hash({ down_weight: 'side' }, 'control_adjusted'), 'control-adjusted is per side');
    const plain = { genes: ['A', 'B'] };
    assert.equal(G.recipeHash(recipe({ ...plain, down_weight: 'gene' })), G.recipeHash(recipe({ ...plain, down_weight: 'side' })), 'no down genes, no weighting');
    assert.equal(hash({}), hash({ down_weight: 'gene' }), 'absent reads as the default');
    // the hash of a recipe with no down genes is what it was before this setting
    assert.ok(!G.recipeHash(recipe(plain)).includes('"dw"'));
});

test('a method with down genes states its formula in plain words with the weighting in force', () => {
    const r = recipe({ genes: ['A'], down: ['B'] });
    assert.match(G.downDefinition(r, 'zscore_mean'), /averaged over all genes: each gene weighs equally/);
    assert.match(G.downDefinition({ ...r, down_weight: 'side' }, 'mean'), /minus the mean of the down genes' values: each side weighs equally/);
    assert.match(G.downDefinition(r, 'control_adjusted'), /no weighting to choose/);
    assert.equal(G.downDefinition(r, 'sum'), '');
    assert.equal(G.downDefinition(recipe({ genes: ['A'] }), 'mean'), '');
});
