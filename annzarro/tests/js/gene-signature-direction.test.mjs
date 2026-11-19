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
    assert.ok(!O.canScoreDown('sum') && !O.canScoreDown('detected') && !O.canScoreDown('fraction_of_total'));
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

test('the Selected view lists both sides in name order; the counts and formula are in plain words', () => {
    const r = recipe({ genes: ['A', 'C'], down: ['B', 'D'] });
    assert.deepEqual(G.selectedNames(r), ['A', 'B', 'C', 'D']);
    assert.equal(G.directionOf(r, 'B'), 'down');
    assert.equal(G.directionOf(r, 'A'), 'up');
    assert.equal(G.directionOf(r, 'Z'), null);
    assert.equal(G.directionCounts(r), '2 up, 2 down');
    assert.equal(G.directionCounts(recipe({ genes: ['A'] })), '', 'nothing to say without down genes');
    assert.match(G.directionFormula(r), /average of the 2 up genes minus average of the 2 down genes/);
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

test('with down genes sum, fraction detected and % of total cannot, with the reason, and leave the menus', () => {
    const r = recipe({ genes: ['A'], down: ['B'], offered: ['zscore_mean', 'mean', 'sum', 'control_adjusted', 'detected', 'fraction_of_total'] });
    const graded = O.gradedOptions(r, null, { X: 'normalised' });
    const by = Object.fromEntries(graded.map(o => [o.method, o]));
    for (const m of ['zscore_mean', 'mean', 'control_adjusted']) assert.equal(by[m].grade, 'ok', m);
    for (const m of ['sum', 'detected', 'fraction_of_total']) {
        assert.equal(by[m].grade, 'cannot', m);
        assert.match(by[m].reason, /down genes/);
    }
    assert.notEqual(by.sum.reason, by.detected.reason);
    assert.deepEqual(O.offeredOptions(r, null, { X: 'normalised' }).map(o => o.method), ['zscore_mean', 'mean', 'control_adjusted']);
    // without down genes nothing changes
    const plain = recipe({ genes: ['A'], offered: ['sum', 'detected'] });
    assert.deepEqual(O.offeredOptions(plain, null, { X: 'counts' }).map(o => o.method), ['sum', 'detected']);
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
    const sum = sources.watch('S1', { onChange() {}, sub: 'sum', layer: 'X' });
    const snap = sum.read();
    assert.equal(snap.state, 'nodown');
    assert.equal(snap.method, 'sum');
    const notice = N.describeScore(snap, { role: 'colour' });
    assert.equal(notice.state, 'nodown');
    assert.match(notice.headline, /has down genes, which sum cannot score/);
    await new Promise(r => setTimeout(r, 5));
    assert.equal(asked, 0, 'no request');
    const mean = sources.watch('S1', { onChange() {}, sub: 'mean', layer: 'X' });
    assert.notEqual(mean.read().state, 'nodown', 'a method that can goes on');
    // dropping the down genes brings the sum back
    sig.down = [];
    sources.update('S1');                      // Update score: the edit is applied
    assert.notEqual(sum.read().state, 'nodown');
});

// ------------------------------------------------------------------ Inspect

test('Inspect names each gene\'s side only when there are down genes, and the CSV keeps its header otherwise', async () => {
    const I = await import('../../../static/js/utils/score-inspect.js');
    const up = [{ name: 'A', status: 'used', detected: 0.5, mean: 1, sd: 1, clipped: 0, direction: 'up' }];
    assert.equal(I.geneCsv(up).split('\r\n')[0], 'gene,status,detected_fraction,mean,sd,clipped_fraction');
    const both = [...up, { name: 'B', status: 'used', detected: 0.25, mean: 2, sd: 1, clipped: 0, direction: 'down' }];
    const lines = I.geneCsv(both).split('\r\n');
    assert.equal(lines[0], 'gene,direction,status,detected_fraction,mean,sd,clipped_fraction');
    assert.deepEqual(lines.slice(1, 3).map(l => l.split(',').slice(0, 2).join(',')), ['A,up', 'B,down']);
    assert.equal(I.geneRows(both, 'mean').find(r => r.name === 'B').direction, 'down');
    assert.equal(I.geneRows([{ name: 'C', status: 'used', detected: 0.1, mean: 1, sd: 1, clipped: 0 }], 'mean')[0].direction, 'up', 'an older reply has none: up');
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
