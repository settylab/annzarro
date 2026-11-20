/**
 * The recipe of a gene signature and the pure parts of building its list
 * (static/js/utils/gene-signature.js).
 *
 * The recipe is what a link, a panel set and a history entry carry, so what
 * matters here is that it is stable (equal lists are equal text), that it has
 * exactly the fields the score route reads, that its hash changes when and only
 * when a score could change, and that every list change can be undone. There
 * is no gene limit.
 *
 * Run:  node --test annzarro/tests/js/gene-signature.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const G = await import('../../../static/js/utils/gene-signature.js');
const { serializableConfig } = await import('../../../static/js/utils/deeplink.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const names = (n, prefix = 'G') => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(5, '0')}`);
const recipe = (raw) => G.normalizeRecipe(raw).recipe;

test('an empty or missing config is the default recipe: z-score mean of X, clipped at 10', () => {
    for (const raw of [undefined, null, {}, 'x', 5, []]) {
        assert.deepEqual(G.normalizeRecipe(raw).recipe,
            { genes: [], down: [], input: 'X', method: 'zscore_mean', clip: 10, seed: null, bins: 25, controls: 50, detect_above: 0, version: 1,
                offered: ['zscore_mean', 'mean', 'sum'], layers: ['X'], directions: false, down_weight: 'gene' });
    }
    assert.equal(G.definitionText(recipe({})), 'Z-score mean of X, clipped at ±10');
});

test('genes are kept sorted and without duplicates, whatever order or noise a link had', () => {
    const r = recipe({ genes: ['CD3E', 'CD3D', 'CD3E', '', 5, null, 'ACTB', { a: 1 }] });
    assert.deepEqual(r.genes, ['ACTB', 'CD3D', 'CD3E']);
    // sorting is by code point, not by locale: a link means the same on every machine
    assert.deepEqual(recipe({ genes: ['b', 'B', 'a', 'A'] }).genes, ['A', 'B', 'a', 'b']);
});

test('the recipe has exactly the fields the score route reads, and no title', () => {
    const body = G.serverRecipe(recipe({ genes: ['B', 'A'], title: 'x' }));
    assert.deepEqual(Object.keys(body).sort(), ['bins', 'clip', 'controls', 'detect_above', 'down', 'down_weight', 'genes', 'input', 'method', 'seed', 'version']);
    assert.deepEqual(body, { genes: ['A', 'B'], down: [], input: 'X', method: 'zscore_mean', clip: 10, seed: null, bins: 25, controls: 50, detect_above: 0, version: 1, down_weight: 'gene' });
    // what a link carries is those fields and the panel's own: which options and layers are offered
    assert.deepEqual(Object.keys(G.storedRecipe(recipe({ genes: ['B', 'A'] }))).sort(), [...Object.keys(body).filter(k => k !== 'down_weight'), 'layers', 'offered'].sort());
    // the server's own field list: every field but the title is here
    const py = readFileSync(path.join(here, '..', '..', 'core', 'gene_score.py'), 'utf8');
    const fields = /_FIELDS = \(([^)]*)\)/.exec(py)[1].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean);
    assert.deepEqual(Object.keys(body).sort(), fields.filter(f => f !== 'title').sort());
    assert.equal(G.GENE_LIMIT, undefined, 'there is no gene limit');
    assert.ok(!/MAX_GENES/.test(py), 'the server has none either');
    assert.equal(G.RECIPE_VERSION, Number(/ALGORITHM_VERSION = (\d+)/.exec(py)[1]));
});

test('clip: a number above 0, null for none, anything else the default', () => {
    assert.equal(recipe({ clip: 5 }).clip, 5);
    assert.equal(recipe({ clip: 2.5 }).clip, 2.5);
    assert.equal(recipe({ clip: null }).clip, null);
    assert.equal(G.definitionText(recipe({ clip: null })), 'Z-score mean of X, not clipped');
    for (const bad of [0, -1, NaN, Infinity, '10', true, {}]) assert.equal(recipe({ clip: bad }).clip, 10, String(bad));
    assert.equal(recipe({}).clip, 10);
});

test('method, input, seed and version are taken from the config or defaulted', () => {
    // there is no default method to set: it is the first offered one
    assert.equal(recipe({ method: 'mean' }).method, 'zscore_mean');
    assert.equal(recipe({ offered: ['mean', 'sum'] }).method, 'mean');
    assert.equal(G.definitionText({ ...recipe({ input: 'counts' }), method: 'mean' }), 'Mean of counts');
    assert.equal(recipe({ offered: ['control_adjusted'] }).method, 'control_adjusted');
    // nor a default layer: the first offered one, and an old link's `input` is that layer
    assert.equal(recipe({ layers: ['counts', 'X'], input: 'counts' }).input, 'counts');
    assert.deepEqual(recipe({ input: 'logged' }).layers, ['logged']);
    assert.equal(recipe({ method: 'nonsense' }).method, 'zscore_mean');
    assert.equal(recipe({ input: 'counts' }).input, 'counts');
    assert.equal(recipe({ input: '' }).input, 'X');
    assert.equal(recipe({ seed: 7 }).seed, 7);
    for (const bad of [-1, 1.5, '3', true]) assert.equal(recipe({ seed: bad }).seed, null);
    assert.equal(recipe({ version: 99 }).version, 1, 'a version this build does not know is read as the version it computes');
});

test('a gene on both sides counts as up, and the notes say so', () => {
    const { recipe: r, notes } = G.normalizeRecipe({ genes: ['A', 'B'], down: ['B', 'C'] });
    assert.deepEqual(r.genes, ['A', 'B']);
    assert.deepEqual(r.down, ['C']);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /1 gene was on both sides/);
});

test('there is no gene limit: a list of any length is kept whole', () => {
    const { recipe: r, notes } = G.normalizeRecipe({ genes: names(20000) });
    assert.equal(r.genes.length, 20000);
    assert.deepEqual(notes, []);
    const mixed = G.normalizeRecipe({ genes: names(30000), down: names(30000, 'D') }).recipe;
    assert.equal(mixed.genes.length + mixed.down.length, 60000);
});

test('normalising a normal recipe changes nothing (a saved config reads back as itself)', () => {
    const once = recipe({ genes: ['B', 'A'], offered: ['mean'], clip: 4, seed: 3 });
    assert.deepEqual(recipe(once), once);
    assert.deepEqual(recipe(JSON.parse(JSON.stringify(once))), once);
});

// ---------------------------------------------------------------- the hash

test('the hash does not change with the order of the genes, a title or duplicates', () => {
    const a = G.recipeHash(recipe({ genes: ['A', 'B', 'C'] }));
    assert.equal(G.recipeHash(recipe({ genes: ['C', 'A', 'B', 'A'], title: 'renamed' })), a);
    assert.equal(typeof a, 'string');
    assert.ok(a.length > 10);
});

test('the hash changes with each thing a score depends on', () => {
    const base = G.recipeHash(recipe({ genes: ['A', 'B'] }));
    const changed = [
        recipe({ genes: ['A', 'B', 'C'] }),
        recipe({ genes: ['A'] }),
        recipe({ genes: ['A', 'C'] }),
        recipe({ genes: ['A', 'B'], input: 'counts' }),
        { ...recipe({ genes: ['A', 'B'] }), method: 'mean' },
        recipe({ genes: ['A', 'B'], clip: 5 }),
        recipe({ genes: ['A', 'B'], clip: null }),
        recipe({ genes: ['A'], down: ['B'] })
    ].map(G.recipeHash);
    for (const h of changed) assert.notEqual(h, base);
    assert.equal(new Set(changed).size, changed.length, 'every change makes its own key');
});

test('a change that cannot change a number does not change the key', () => {
    // only the z-score mean clips
    const mean = (clip) => G.recipeHash({ ...recipe({ genes: ['A'], clip }), method: 'mean' });
    assert.equal(mean(5), mean(10));
    assert.equal(mean(null), mean(3));
    // the seed means nothing but to the control-adjusted score
    assert.equal(G.recipeHash(recipe({ genes: ['A'], seed: 1 })), G.recipeHash(recipe({ genes: ['A'], seed: 2 })));
    // an up gene and the same gene as a down gene differ
    assert.notEqual(G.recipeHash(recipe({ genes: ['A'] })), G.recipeHash(recipe({ down: ['A'] })));
});

test('the hash of 2,000 genes is quick and distinguishes one swapped gene', () => {
    const list = names(2000);
    const t0 = performance.now();
    const h = G.recipeHash(recipe({ genes: list }));
    assert.ok(performance.now() - t0 < 200);
    const swapped = [...list.slice(0, 1999), 'OTHER'];
    assert.notEqual(G.recipeHash(recipe({ genes: swapped })), h);
});

// -------------------------------------------------- persisted as configuration only

test('the saved config carries the recipe and never a derived list', () => {
    const cfg = { title: 'T', ...G.serverRecipe(recipe({ genes: ['A'] })), currentEntries: [0, 5], closedSelection: { passing: ['A'] }, scores: [1, 2] };
    const saved = serializableConfig(cfg);
    assert.ok(!('currentEntries' in saved) && !('closedSelection' in saved));
    assert.deepEqual(recipe(saved).genes, ['A']);
});

// -------------------------------------------------------------- adding genes

test('adding genes: merged sorted, duplicates ignored, the already selected counted', () => {
    const plan = G.planAddAs({ genes: ['B', 'D'], down: [] }, ['C', 'B', 'A', 'C', ''], 'up');
    assert.deepEqual(plan.added, ['A', 'C']);
    assert.equal(plan.already, 1);
    assert.deepEqual(plan.genes, ['A', 'B', 'C', 'D']);
});

test('adding has no limit: any number of genes is merged in one step', () => {
    const plan = G.planAddAs({ genes: names(1990), down: [] }, names(60000, 'X'), 'up');
    assert.equal(plan.added.length, 60000);
    assert.equal(plan.genes.length, 61990);
    assert.equal(G.limitMessage, undefined);
});

test('adding only genes already in the list changes nothing', () => {
    const plan = G.planAddAs({ genes: ['A', 'B'], down: [] }, ['B', 'A'], 'up');
    assert.deepEqual(plan.added, []);
    assert.equal(plan.already, 2);
    assert.deepEqual(plan.genes, ['A', 'B']);
});

test('mergeSorted of two sorted lists is sorted and distinct', () => {
    assert.deepEqual(G.mergeSorted(['A', 'C', 'E'], ['B', 'C', 'D']), ['A', 'B', 'C', 'D', 'E']);
    assert.deepEqual(G.mergeSorted([], ['A']), ['A']);
    const a = ['A'];
    assert.equal(G.mergeSorted(a, []), a);
});

test('the names of a table inside the dataset, and how many were not', () => {
    const { names: inside, outside } = G.inDatasetNames(['A', 'X', 'B', 'Y'], new Set(['A', 'B']));
    assert.deepEqual(inside, ['A', 'B']);
    assert.equal(outside, 2);
});

// ----------------------------------------------------------------- search

const GENES = ['ACTB', 'CD3D', 'CD3E', 'CD3G', 'Cd3x', 'GAPDH'];

test('search: plain text ignores case unless Match case is on', () => {
    const at = (q, o) => G.searchNames(GENES, q, o).indices.map(i => GENES[i]);
    assert.deepEqual(at('cd3'), ['CD3D', 'CD3E', 'CD3G', 'Cd3x']);
    assert.deepEqual(at('cd3', { matchCase: true }), []);
    assert.deepEqual(at('Cd3', { matchCase: true }), ['Cd3x']);
    assert.equal(G.searchNames(GENES, '').indices, null, 'an empty box is every gene');
});

test('search: a regular expression, with and without case', () => {
    const at = (q, o) => G.searchNames(GENES, q, { regex: true, ...o }).indices.map(i => GENES[i]);
    assert.deepEqual(at('^CD3[DE]$'), ['CD3D', 'CD3E']);
    assert.deepEqual(at('^cd3[de]$'), ['CD3D', 'CD3E']);
    assert.deepEqual(at('^cd3[de]$', { matchCase: true }), []);
    assert.deepEqual(at('D$'), ['CD3D']);
});

test('search: plain text is not a pattern, so a dot is a dot', () => {
    assert.deepEqual(G.searchNames(['A.B', 'AxB'], 'a.b').indices, [0]);
    assert.deepEqual(G.searchNames(['A.B', 'AxB'], 'a.b', { regex: true }).indices, [0, 1]);
});

test('an invalid pattern is reported, not thrown', () => {
    const r = G.searchNames(GENES, '(', { regex: true });
    assert.equal(r.error, 'Not a valid pattern');
    assert.equal(r.invalid, true);
    assert.equal(r.indices, null);
    assert.equal(G.searchNames(GENES, '(').error, null, 'the same text is fine as plain text');
});

test('Enter ticks the exact match, else the only match, else nothing', () => {
    assert.equal(G.enterTarget(['CD3D', 'CD3E'], 'cd3d'), 'CD3D');
    assert.equal(G.enterTarget(['CD3D'], 'cd3'), 'CD3D', 'the sole match');
    assert.equal(G.enterTarget(['CD3D', 'CD3E', 'CD3G'], 'cd3'), null, 'several, none exact');
    assert.equal(G.enterTarget(['CD3D', 'Cd3d'], 'cd3d'), null, 'two exact ignoring case: ambiguous');
    assert.equal(G.enterTarget(['CD3D', 'Cd3d'], 'cd3d', { matchCase: true }), null);
    assert.equal(G.enterTarget(['CD3D', 'Cd3d'], 'Cd3d', { matchCase: true }), 'Cd3d');
    assert.equal(G.enterTarget([], 'x'), null);
    assert.equal(G.enterTarget(['A'], ''), null);
});

test('search over a whole genome of names is quick', () => {
    const all = names(60000);
    const t0 = performance.now();
    const r = G.searchNames(all, 'G0123', {});
    assert.ok(performance.now() - t0 < 500);
    assert.equal(r.indices.length, 10);
});

// ------------------------------------------------------------------- undo

test('every list change is one step, and a step restores the list as it was', () => {
    const u = new G.UndoStack();
    u.push('add 3 genes', ['A']);
    u.push('clear 4 genes', ['A', 'B', 'C', 'D']);
    assert.equal(u.size, 2);
    assert.equal(u.peek().label, 'clear 4 genes');
    assert.deepEqual(u.pop().before, ['A', 'B', 'C', 'D']);
    assert.deepEqual(u.pop().before, ['A']);
    assert.equal(u.pop(), null);
    assert.equal(u.peek(), null);
});

test('single ticks in quick succession are one step; a pause or another kind of change starts a new one', () => {
    const u = new G.UndoStack({ coalesceMs: 1000 });
    u.push('tick A', [], { tick: true, now: 0 });
    u.push('tick B', ['A'], { tick: true, now: 400 });
    u.push('tick C', ['A', 'B'], { tick: true, now: 900 });
    assert.equal(u.size, 1);
    assert.equal(u.peek().label, 'change 3 genes');
    assert.deepEqual(u.peek().before, [], 'undoing the batch goes back to before the first tick');
    u.push('tick D', ['A', 'B', 'C'], { tick: true, now: 5000 });
    assert.equal(u.size, 2, 'after a pause');
    u.push('add 10 genes', ['A', 'B', 'C', 'D']);
    u.push('tick E', ['x'], { tick: true, now: 5100 });
    assert.equal(u.size, 4, 'a bulk change in between ends the batch');
});

test('a step keeps its own copy of the list: changing the list afterwards does not change undo', () => {
    const u = new G.UndoStack();
    const list = ['A', 'B'];
    u.push('x', list);
    list.push('C');
    assert.deepEqual(u.peek().before, ['A', 'B']);
});

test('the stack is bounded and clear empties it', () => {
    const u = new G.UndoStack({ max: 3 });
    for (let i = 0; i < 10; i++) u.push(`s${i}`, [String(i)]);
    assert.equal(u.size, 3);
    assert.equal(u.peek().label, 's9');
    u.clear();
    assert.equal(u.size, 0);
});
