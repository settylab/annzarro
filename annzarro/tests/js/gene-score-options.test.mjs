/**
 * Scoring options of a gene signature (step 8): the clip, the input, the seed and the control-adjusted score as
 * a third aggregation. Pure parts only; the panel itself is covered in the browser
 * (annzarro/tests/browser/test_gene_score_options.py).
 *
 * What matters: a number typed into the panel is checked the way the server checks it; the score key changes
 * exactly when a score could change (the clip not for a plain mean, the seed only for the control-adjusted
 * score, the input and the genes always); an edit that changes no score a plot shows costs no request; the
 * warning for raw counts has its sentences and names a layer when there is one.
 *
 * Run:  node --test annzarro/tests/js/gene-score-options.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const G = await import('../../../static/js/utils/gene-signature.js');
const S = await import('../../../static/js/utils/score-store.js');
const D = await import('../../../static/js/utils/score-sources.js');
const K = await import('../../../static/js/utils/matrix-kind-client.js');

const settle = () => new Promise(resolve => setTimeout(resolve, 5));
const recipe = (raw) => G.normalizeRecipe({ genes: ['A', 'B'], ...raw }).recipe;
const withMethod = (r, method) => ({ ...r, method });

// ---------------------------------------------------------------- typed numbers

test('a clip is a number above 0 in any notation, and everything else is refused with the same sentence', () => {
    for (const [text, value] of [['10', 10], [' 3.5 ', 3.5], ['0.001', 0.001], ['1e3', 1000], ['1000000', 1e6], ['.5', 0.5]]) {
        assert.deepEqual(G.parseClipText(text), { ok: true, value }, text);
    }
    for (const bad of ['', '   ', '0', '-1', '-0.001', 'abc', '1,5', 'NaN', 'Infinity', '-Infinity', '1e999', '5%', '10 20', null, undefined]) {
        assert.deepEqual(G.parseClipText(bad), { ok: false, error: 'Enter a number above 0.' }, String(bad));
    }
});

test('a seed is a whole number from 0 up that the browser holds exactly', () => {
    for (const [text, value] of [['0', 0], [' 42 ', 42], ['007', 7], [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER]]) {
        assert.deepEqual(G.parseSeedText(text), { ok: true, value }, text);
    }
    for (const bad of ['', '-1', '1.5', '1e3', 'x', '0x10', ' ', '9007199254740993', '99999999999999999999', null, undefined]) {
        assert.deepEqual(G.parseSeedText(bad), { ok: false, error: 'Enter a whole number from 0 up.' }, String(bad));
    }
});

test('the collapsed row states the shared settings, the seed only when it is set', () => {
    assert.equal(G.settingsText(recipe({})), 'X, clipped at ±10');
    assert.equal(G.settingsText(recipe({ clip: null })), 'X, not clipped');
    assert.equal(G.settingsText(recipe({ input: 'logged_counts', clip: 3, seed: 7 })), 'logged_counts, clipped at ±3, seed 7');
});

// ---------------------------------------------------------------- the key

test('the key moves with the input, the genes and the method, and only then with the clip and the seed', () => {
    const base = recipe({});
    const hash = (r, method) => G.recipeHash(withMethod(r, method));
    for (const m of G.METHODS) assert.equal(hash(base, m), hash(recipe({ genes: ['B', 'A'] }), m), 'gene order');
    for (const m of G.METHODS) assert.notEqual(hash(base, m), hash(recipe({ input: 'counts' }), m), `input, ${m}`);
    for (const m of G.METHODS) assert.notEqual(hash(base, m), hash(recipe({ genes: ['A', 'B', 'C'] }), m), `genes, ${m}`);
    assert.notEqual(hash(base, 'zscore_mean'), hash(base, 'mean'));
    assert.notEqual(hash(base, 'mean'), hash(base, 'control_adjusted'));
    // the clip: the z-score mean only
    assert.notEqual(hash(base, 'zscore_mean'), hash(recipe({ clip: 3 }), 'zscore_mean'));
    assert.notEqual(hash(base, 'zscore_mean'), hash(recipe({ clip: null }), 'zscore_mean'));
    assert.equal(hash(base, 'mean'), hash(recipe({ clip: 3 }), 'mean'));
    assert.equal(hash(base, 'mean'), hash(recipe({ clip: null }), 'mean'));
    assert.equal(hash(base, 'control_adjusted'), hash(recipe({ clip: 3 }), 'control_adjusted'));
    // the seed: the control-adjusted score only, and no seed is seed 0
    assert.notEqual(hash(base, 'control_adjusted'), hash(recipe({ seed: 5 }), 'control_adjusted'));
    assert.equal(hash(base, 'control_adjusted'), hash(recipe({ seed: 0 }), 'control_adjusted'));
    assert.equal(hash(base, 'zscore_mean'), hash(recipe({ seed: 5 }), 'zscore_mean'));
    assert.equal(hash(base, 'mean'), hash(recipe({ seed: 5 }), 'mean'));
});

test('the score route is sent the clip and the seed as the recipe holds them', () => {
    const body = G.serverRecipe(recipe({ method: 'control_adjusted', seed: 9, clip: null, input: 'logged_counts' }));
    assert.deepEqual(body, { genes: ['A', 'B'], down: [], input: 'logged_counts', method: 'control_adjusted', clip: null, seed: 9, version: 1 });
});

// ---------------------------------------------------------------- edits and their cost

function world({ estimateSeconds = () => 2 } = {}) {
    const calls = { estimate: [], compute: [] };
    const api = {
        async estimate({ recipe: r }) {
            calls.estimate.push({ method: r.method, clip: r.clip, seed: r.seed });
            return { estimate: { seconds: estimateSeconds(r), tier: 'auto', auto_max_s: 60, max_s: 600, live_max_s: 5 } };
        },
        compute(req) {
            calls.compute.push({ method: req.recipe.method, clip: req.recipe.clip, seed: req.recipe.seed, input: req.recipe.input });
            return Promise.resolve({ header: { n_used: 2 }, values: new Float32Array(3).fill(calls.compute.length) });
        }
    };
    const store = S.createScoreStore({ api });
    const sigs = new Map();
    const timers = [];
    const sources = D.createScoreSources({
        store,
        signatures: { get: (id) => sigs.get(id) || null, off: () => false },
        context: () => ({ dataset: 'd.zarr', subset: null }),
        liveDelayMs: 10,
        setTimer: (fn) => { const t = { fn, off: false }; timers.push(t); return t; },
        clearTimer: (t) => { if (t) t.off = true; }
    });
    const sig = { title: 'T', settings: {}, recipe: () => recipe(sig.settings) };
    sigs.set('S1', sig);
    const fire = async () => { for (const t of timers.splice(0)) if (!t.off) await t.fn(); await settle(); };
    const edit = async (settings) => { Object.assign(sig.settings, settings); sources.recipeChanged('S1'); await fire(); };
    return { calls, sources, sig, edit };
}

async function ready(w, sub) {
    const handle = w.sources.watch('S1', { onChange: () => {}, sub });
    handle.read();
    await settle();
    await settle();
    assert.equal(handle.read().state, 'ready');
    return handle;
}

test('a clip edit costs a plain mean nothing: no estimate, no request, the same key, and the setting is kept', async () => {
    const w = world();
    const mean = await ready(w, 'mean');
    const key = mean.read().key;
    const computes = w.calls.compute.length, estimates = w.calls.estimate.length;
    await w.edit({ clip: 3 });
    assert.equal(mean.read().key, key);
    assert.equal(mean.read().state, 'ready');
    assert.equal(w.calls.compute.length, computes);
    assert.equal(w.calls.estimate.length, estimates, 'nothing it shows can change, so nothing is estimated');
    assert.equal(w.sources.appliedOf('S1').clip, 3, 'a later z-score consumer reads the new clip');
    assert.equal(w.sources.pendingOf('S1'), null);
});

test('a clip edit recomputes a z-score mean, with the new clip', async () => {
    const w = world();
    const z = await ready(w, 'zscore_mean');
    const key = z.read().key;
    await w.edit({ clip: 3 });
    await settle();
    assert.notEqual(z.read().key, key);
    assert.deepEqual(w.calls.compute.map(c => c.clip), [10, 3]);
    await w.edit({ clip: null });
    await settle();
    assert.deepEqual(w.calls.compute.map(c => c.clip), [10, 3, null]);
});

test('a seed edit recomputes a control-adjusted score and nothing else', async () => {
    const w = world();
    const z = await ready(w, 'zscore_mean');
    const m = await ready(w, 'mean');
    const c = await ready(w, 'control_adjusted');
    const [kz, km, kc] = [z, m, c].map(h => h.read().key);
    assert.deepEqual(w.calls.compute.map(x => x.method).sort(), ['control_adjusted', 'mean', 'zscore_mean']);
    await w.edit({ seed: 4 });
    await settle();
    assert.equal(z.read().key, kz);
    assert.equal(m.read().key, km);
    assert.notEqual(c.read().key, kc);
    assert.deepEqual(w.calls.compute.filter(x => x.method === 'control_adjusted').map(x => x.seed), [null, 4]);
    assert.equal(w.calls.compute.length, 4, 'one new request');
});

test('an input edit recomputes every aggregation', async () => {
    const w = world();
    const handles = [await ready(w, 'zscore_mean'), await ready(w, 'mean'), await ready(w, 'control_adjusted')];
    const keys = handles.map(h => h.read().key);
    await w.edit({ input: 'logged_counts' });
    await settle();
    handles.forEach((h, i) => assert.notEqual(h.read().key, keys[i]));
    assert.deepEqual(w.calls.compute.slice(3).map(x => x.input), ['logged_counts', 'logged_counts', 'logged_counts']);
});

test('an edit of 5 seconds or more is held behind Update score, and applying it asks for the new score once', async () => {
    const w = world({ estimateSeconds: (r) => (r.clip === 3 ? 12 : 1) });
    const z = await ready(w, 'zscore_mean');
    const key = z.read().key;
    await w.edit({ clip: 3 });
    assert.ok(w.sources.pendingOf('S1'), 'held');
    assert.equal(w.sources.pendingOf('S1').edits, 1);
    assert.equal(z.read().key, key, 'the dependant keeps the previous score');
    assert.equal(w.calls.compute.length, 1);
    w.sources.update('S1');
    await settle();
    assert.equal(w.sources.pendingOf('S1'), null);
    assert.notEqual(z.read().key, key);
    assert.equal(w.calls.compute.length, 2);
    assert.equal(w.calls.compute[1].clip, 3);
});

test('a slow control-adjusted score holds an edit even when the z-score mean beside it is quick', async () => {
    const w = world({ estimateSeconds: (r) => (r.method === 'control_adjusted' ? 30 : 1) });
    const z = await ready(w, 'zscore_mean');
    await ready(w, 'control_adjusted');
    await w.edit({ input: 'logged_counts' });
    assert.ok(w.sources.pendingOf('S1'), 'the slowest score decides');
    assert.equal(w.calls.compute.length, 2);
    assert.equal(z.read().state, 'ready');
});

// ---------------------------------------------------------------- what an input looks like

test('raw counts and unlogged normalised values each get their sentence; log-normalised values and the unknown none', () => {
    const counts = K.warningFor({ input: 'X', kind: 'counts', stats: { max: 557 }, suggest: null });
    assert.equal(counts.kind, 'counts');
    assert.match(counts.text, /^X looks like raw counts \(whole numbers up to 557\)\. Scores should be computed on normalised, log-transformed data/);
    assert.equal(counts.suggest, null);
    const layer = K.warningFor({ input: 'raw_counts', kind: 'counts', stats: { max: 1234 }, suggest: 'logged_counts' });
    assert.match(layer.text, /^Layer raw_counts looks like raw counts \(whole numbers up to 1,234\)/);
    assert.match(layer.text, /logged_counts looks log-normalised\.$/);
    assert.equal(layer.suggest, 'logged_counts');
    const unlogged = K.warningFor({ input: 'normalized_counts', kind: 'normalised', stats: { max: 1140.2 }, suggest: null });
    assert.match(unlogged.text, /looks normalised but not log-transformed \(values reach 1,140\)/);
    for (const kind of ['log', 'signed', 'other', 'unknown']) assert.equal(K.warningFor({ input: 'X', kind, stats: {} }), null, kind);
    assert.equal(K.warningFor(null), null);
});

test('the kind of an input is asked once per dataset and input, a failure is quiet and asked again', async () => {
    const urls = [];
    let fail = true;
    const client = K.createKindClient({
        url: '/api/v1/data/matrix_kind',
        fetchImpl: async (url) => {
            urls.push(url);
            if (fail) return { ok: false, status: 500, json: async () => ({}) };
            return { ok: true, json: async () => ({ input: 'X', kind: 'counts' }) };
        }
    });
    assert.equal(await client.kind('d.zarr', 'X'), null);
    fail = false;
    assert.equal((await client.kind('d.zarr', 'X')).kind, 'counts');
    await client.kind('d.zarr', 'X');
    await client.kind('d.zarr', 'logged');
    await client.kind('e.zarr', 'X');
    assert.equal(urls.length, 4, 'failed once, then three distinct questions answered once');
    assert.ok(urls[1].includes('dataset_path=d.zarr') && urls[1].includes('input=X'));
    client.clear();
    await client.kind('d.zarr', 'X');
    assert.equal(urls.length, 5);
});

test('a network error is quiet too', async () => {
    const client = K.createKindClient({ url: '/x', fetchImpl: async () => { throw new Error('offline'); } });
    assert.equal(await client.kind('d.zarr', 'X'), null);
});
