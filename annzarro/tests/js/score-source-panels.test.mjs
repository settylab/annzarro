/**
 * Gene tables as sources of a gene score (static/js/utils/score-source-panels.js): the provider that makes a table's
 * passing rows the genes of a score, the gate while a closed table's genes are not known, and what the shared score
 * machinery (utils/score-sources.js) and notices (utils/score-notices.js) do with it.
 *
 * Run:  node --test annzarro/tests/js/score-source-panels.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../../../static/js/utils/score-store.js');
const D = await import('../../../static/js/utils/score-sources.js');
const N = await import('../../../static/js/utils/score-notices.js');
const P = await import('../../../static/js/utils/score-source-panels.js');
const R = await import('../../../static/js/utils/table-resolver.js');
const C = await import('../../../static/js/utils/score-column.js');

const GENES = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6'];

/** Wait until `check` holds (the store answers in a few turns of the loop). */
async function until(check, what = 'the condition') {
    for (let i = 0; i < 200; i++) {
        if (check()) return;
        await new Promise(r => setTimeout(r, 2));
    }
    assert.fail(`timed out waiting for ${what}`);
}

/** A gene table panel as the provider reads it. */
function table({ id = 'gene-table-1', title = 'Gene Table 1', entries = [0, 2, 4], closedNames = null, ready = true, options = null } = {}) {
    const cfg = { currentEntries: entries, closedSelection: closedNames ? { passing: new Set(closedNames) } : null };
    return {
        id, entries, options,
        getId: () => id, getTitle: () => title, getType: () => 'gene-table', isReady: () => ready,
        getConfig: () => cfg, getScoreOptions: () => options, cfg
    };
}
const signature = (id, genes) => ({ getId: () => id, getTitle: () => 'Sig', getType: () => 'gene-signature',
    getRecipe: () => ({ genes, down: [], input: 'X', method: 'zscore_mean', clip: 10, seed: null, bins: 25, controls: 50, detect_above: 0,
        version: 1, offered: ['zscore_mean', 'mean', 'sum'], layers: ['X'], directions: false, down_weight: 'gene' }) });

function adapterOf(panels, { open = new Set(), resolver = null } = {}) {
    return P.createSourceAdapter({
        panel: (id) => panels.get(id) || null, active: (p) => open.has(p.getId()), geneNames: () => GENES, resolver
    });
}

test('the source types and their kinds: a signature and a gene table, nothing else', () => {
    assert.deepEqual([...P.SOURCE_TYPES], ['gene-signature', 'gene-table']);
    assert.equal(P.isSourceType('gene-table'), true);
    assert.equal(P.isSourceType('cell-table'), false);
    assert.equal(P.kindOfType('gene-table'), 'table');
    assert.equal(P.kindOfType('gene-signature'), 'signature');
});

test('an open table\'s genes are the rows that pass its filter, sorted, with the default options', () => {
    const t = table({ entries: [4, 0, 2] });
    const sources = adapterOf(new Map([[t.id, t]]), { open: new Set([t.id]) });
    const source = sources.get(t.id);
    assert.equal(source.kind, 'table');
    assert.equal(source.title, 'Gene Table 1');
    const r = source.recipe();
    assert.deepEqual(r.genes, ['A1', 'C3', 'E5']);
    assert.deepEqual(r.down, []);
    assert.equal(r.method, 'zscore_mean');
    assert.deepEqual(r.offered, ['zscore_mean', 'mean', 'sum']);
    assert.equal(source.gate('p'), null);
});

test('a gene table has no down genes: every gene passing its filter is up, and the switch is off', () => {
    const t = table({ options: { offered: ['mean'], layers: ['X'] } });
    const sources = adapterOf(new Map([[t.id, t]]), { open: new Set([t.id]) });
    const r = sources.get(t.id).recipe();
    assert.deepEqual([r.down, r.directions], [[], false]);
    assert.ok(r.genes.length > 0);
});

test('the same options give the same recipe fields as a signature: one schema', () => {
    const opts = { offered: ['mean', 'detected'], layers: ['X', 'counts'], input: 'X', method: 'mean', clip: 3, detect_above: 1 };
    const t = table({ options: opts });
    const sources = adapterOf(new Map([[t.id, t], ['gene-signature-1', signature('gene-signature-1', ['A1'])]]), { open: new Set([t.id]) });
    const fromTable = sources.get(t.id).recipe();
    for (const key of ['input', 'method', 'offered', 'layers', 'clip', 'seed', 'bins', 'controls', 'detect_above', 'version']) {
        assert.deepEqual(fromTable[key], key in opts ? opts[key] : sources.get('gene-signature-1').recipe()[key] ?? fromTable[key], key);
    }
    assert.equal(fromTable.method, 'mean');
    assert.deepEqual(Object.keys(fromTable).sort(), Object.keys(sources.get('gene-signature-1').recipe()).sort(), 'same fields');
});

test('a closed table with a frozen selection is read as it was closed', () => {
    const t = table({ closedNames: ['B2', 'F6'] });
    const source = adapterOf(new Map([[t.id, t]])).get(t.id);
    assert.deepEqual(source.recipe().genes, ['B2', 'F6']);
    assert.equal(source.gate('p'), null);
});

test('a table that is opening is waited for; a closed table with no rows asks the resolver, and its states map to the score states', () => {
    const resolver = { status: { state: 'waiting' }, need(id, dep) { this.asked = [id, dep]; return this.status; }, accept() {}, cancel() {}, retry() {}, cycleOf: () => null };
    const opening = table({ ready: false });
    const sources = adapterOf(new Map([[opening.id, opening]]), { open: new Set([opening.id]), resolver });
    assert.deepEqual(sources.get(opening.id).gate('p'), { state: 'building', gate: { state: 'waiting', reason: 'opening' } });
    assert.equal(resolver.asked, undefined, 'an open table is not built');
    const closed = table({ id: 'gene-table-2' });
    const cs = adapterOf(new Map([[closed.id, closed]]), { resolver });
    for (const [status, state] of [[{ state: 'waiting' }, 'building'], [{ state: 'building', frozen: true }, 'building'], [{ state: 'ask', rows: 9 }, 'ask'],
        [{ state: 'refused', reason: 'size', rows: 5000000 }, 'refused'], [{ state: 'failed', reason: 'boom' }, 'failed']]) {
        resolver.status = status;
        const g = cs.get(closed.id).gate('plot-1');
        assert.equal(g.state, state, JSON.stringify(status));
        assert.deepEqual(resolver.asked, [closed.id, 'plot-1'], 'the dependant is named, so the resolver knows who needs the build');
    }
    resolver.status = { state: 'refused', reason: 'size', rows: 5000000 };
    assert.match(cs.get(closed.id).gate('p').message, /too large to build here \(5,000,000 rows\)/);
    resolver.status = { state: 'failed', reason: 'boom' };
    assert.equal(cs.get(closed.id).gate('p').message, 'boom');
    resolver.status = { state: 'ready' };
    assert.equal(cs.get(closed.id).gate('p'), null, 'the resolver has nothing to wait for');
});

test('a cycle is its own state, named by titles, and asks the resolver for nothing', () => {
    let asked = 0;
    const a = table({ id: 'gene-table-A', title: 'Genes A' });
    const b = { ...table({ id: 'cell-table-B', title: 'Cells B' }), getType: () => 'cell-table' };
    const resolver = { need() { asked++; return { state: 'waiting' }; }, accept() {}, cancel() {}, retry() {},
        cycleOf: (id) => R.findCycle(id, (x) => ({ 'gene-table-A': ['cell-table-B'], 'cell-table-B': ['gene-table-A'] }[x] || [])) };
    const sources = adapterOf(new Map([[a.id, a], [b.id, b]]), { resolver });
    const g = sources.get(a.id).gate('p');
    assert.equal(g.state, 'cycle');
    assert.deepEqual(g.cycle, ['Genes A', 'Cells B', 'Genes A']);
    assert.equal(asked, 0);
    assert.equal(sources.get(b.id), null, 'a cell table is not a source of a gene score');
});

test('a panel that is not a source is no source; a signature is unchanged by the provider', () => {
    const sig = signature('gene-signature-1', ['A1', 'B2']);
    const sources = adapterOf(new Map([[sig.getId(), sig]]));
    const source = sources.get('gene-signature-1');
    assert.equal(source.kind, 'signature');
    assert.deepEqual(source.recipe().genes, ['A1', 'B2']);
    assert.equal(source.gate('p'), null);
    assert.equal(sources.get('nothing'), null);
    assert.equal(sources.get(null), null);
});

test('readsScoreOf finds a plot axis, colour or hover and a table column, and nothing else', () => {
    const hit = { type: 'gene-score', key: 'gene-table-1', column: 'mean' };
    assert.equal(P.readsScoreOf({ color: hit }, 'gene-table-1'), true);
    assert.equal(P.readsScoreOf({ x: hit }, 'gene-table-1'), true);
    assert.equal(P.readsScoreOf({ hoverInfo: [{ type: 'obs', key: 'a' }, hit] }, 'gene-table-1'), true);
    assert.equal(P.readsScoreOf({ columns: [hit] }, 'gene-table-1'), true);
    assert.equal(P.readsScoreOf({ color: hit }, 'gene-table-2'), false);
    assert.equal(P.readsScoreOf({ color: { type: 'obs', key: 'gene-table-1' } }, 'gene-table-1'), false);
    assert.equal(P.readsScoreOf(null, 'gene-table-1'), false);
});

test('menus: signatures and tables are grouped when both exist, plain when only one kind does; hover lists say (table)', () => {
    const sig = { id: 's', title: 'Sig', kind: 'signature' };
    const tab = { id: 't', title: 'Tab', kind: 'table' };
    assert.deepEqual(P.scoreKeyOptions([sig]), [{ value: 's', text: 'Sig' }]);
    assert.deepEqual(P.scoreKeyOptions([tab]), [{ value: 't', text: 'Tab' }]);
    assert.deepEqual(P.scoreKeyOptions([sig, tab]), [{ value: 's', text: 'Sig', group: 'Gene signatures' }, { value: 't', text: 'Tab', group: 'Gene tables' }]);
    assert.equal(P.entityLabel(tab), 'Tab (table)');
    assert.equal(P.entityLabel(sig), 'Sig');
});

// ---------------------------------------------------------------------------------------------------------------
// The shared score machinery with a table as the source

function world({ seconds = 2 } = {}) {
    const calls = { estimate: [], compute: [] };
    const waiting = [];
    const api = {
        async estimate({ recipe }) {
            calls.estimate.push(recipe.genes.slice());
            return { estimate: { seconds: seconds, tier: 'auto', auto_max_s: 60, max_s: 600, live_max_s: 5 } };
        },
        compute(req) {
            calls.compute.push(req);
            return new Promise((resolve) => { waiting.push({ req, resolve }); });
        }
    };
    const store = S.createScoreStore({ api });
    const t = table({ entries: [0, 1] });
    const actions = [];
    const resolver = { status: { state: 'ready' }, need: () => resolver.status, accept: () => actions.push('accept'),
        cancel: () => actions.push('cancel'), retry: () => actions.push('retry'), cycleOf: () => null };
    const panels = new Map([[t.id, t]]);
    const open = new Set([t.id]);
    const adapter = adapterOf(panels, { open, resolver });
    const timers = [];
    const sources = D.createScoreSources({
        store, signatures: adapter, context: () => ({ dataset: 'd.zarr', subset: null, cells: 3 }), liveDelayMs: 10,
        setTimer: (fn) => { const x = { fn, off: false }; timers.push(x); return x; }, clearTimer: (x) => { if (x) x.off = true; }
    });
    const fire = async () => { for (const x of timers.splice(0)) if (!x.off) await x.fn(); await new Promise(r => setTimeout(r, 5)); };
    return { calls, waiting, store, t, panels, open, resolver, actions, sources, fire };
}

test('a plot\'s colour by a table: the score is asked for the passing genes, once, and shared', async () => {
    const w = world();
    const states = [];
    const h = w.sources.watch(w.t.id, { onChange: (s) => states.push(s), dependant: 'plot-1', sub: 'zscore_mean' });
    assert.equal(h.read().kind, 'table');
    await until(() => w.waiting.length === 1, 'the score request');
    assert.deepEqual(w.calls.estimate, [['A1', 'B2']]);
    w.waiting[0].resolve({ header: { n_used: 2 }, values: new Float32Array(3).fill(1) });
    await until(() => h.read().state === 'ready', 'the score');
    assert.equal(w.calls.compute.length, 1);
});

test('a filter change is an edit: applied at once when cheap, held behind Update score when the estimate is 5 s or more', async () => {
    const cheap = world({ seconds: 1 });
    const h = cheap.sources.watch(cheap.t.id, { onChange: () => {}, dependant: 'p' });
    h.read();                 // a dependant reads when it is told or draws: that asks for the score
    await until(() => cheap.waiting.length === 1, 'the first request');
    cheap.waiting[0].resolve({ header: { n_used: 2 }, values: new Float32Array(3) });
    await until(() => h.read().state === 'ready', 'the first score');
    cheap.t.cfg.currentEntries = [0, 1, 2];
    cheap.sources.recipeChanged(cheap.t.id);
    await cheap.fire();
    await until(() => cheap.waiting.length === 2, 'the second request');
    assert.deepEqual(cheap.calls.estimate.at(-1), ['A1', 'B2', 'C3'], 'the new genes were asked for');

    const slow = world({ seconds: 12 });
    const hs = slow.sources.watch(slow.t.id, { onChange: () => {}, dependant: 'p' });
    hs.read();
    await until(() => slow.waiting.length === 1, 'the first request');
    slow.waiting[0].resolve({ header: { n_used: 2 }, values: new Float32Array(3) });
    await until(() => hs.read().state === 'ready', 'the first score');
    slow.t.cfg.currentEntries = [0, 1, 2];
    slow.sources.recipeChanged(slow.t.id);
    await slow.fire();
    await until(() => hs.read().held, 'the held edit');
    const snap = hs.read();
    assert.equal(snap.state, 'ready');
    assert.ok(snap.held && snap.held.edits === 1 && snap.held.seconds === 12, 'held behind Update score');
    assert.equal(slow.calls.compute.length, 1);
    slow.sources.update(slow.t.id);
    await until(() => slow.calls.compute.length === 2, 'the second request');
    assert.deepEqual(slow.calls.compute[1].recipe.genes, ['A1', 'B2', 'C3']);
});

test('the same filter again changes nothing; the cache key includes the gene set', async () => {
    const w = world();
    w.sources.watch(w.t.id, { onChange: () => {}, dependant: 'p' }).read();
    await until(() => w.calls.estimate.length === 1, 'the estimate');
    const n = w.calls.estimate.length;
    w.sources.recipeChanged(w.t.id);
    await w.fire();
    assert.equal(w.calls.estimate.length, n);
    const G = await import('../../../static/js/utils/gene-signature.js');
    const a = G.recipeHash(P.tableRecipe(w.t, { open: true, geneNames: GENES }));
    w.t.cfg.currentEntries = [0, 1, 3];
    assert.notEqual(G.recipeHash(P.tableRecipe(w.t, { open: true, geneNames: GENES })), a);
    w.t.cfg.currentEntries = [1, 0];
    assert.equal(G.recipeHash(P.tableRecipe(w.t, { open: true, geneNames: GENES })), a, 'the order of the rows does not matter');
});

test('a closed table with no rows: its dependants wait on the resolver\'s states, then the score is asked for', async () => {
    const w = world();
    w.open.clear();
    w.t.cfg.closedSelection = null;
    w.resolver.status = { state: 'waiting' };
    const h = w.sources.watch(w.t.id, { onChange: () => {}, dependant: 'plot-1' });
    assert.equal(h.read().state, 'building');
    assert.equal(w.calls.estimate.length, 0, 'nothing is asked of the score before the genes are known');
    w.resolver.status = { state: 'ask', rows: 300000 };
    assert.equal(h.read().state, 'ask');
    assert.equal(h.compute(), true);
    assert.deepEqual(w.actions, ['accept'], 'Build filter is the resolver\'s accept');
    w.resolver.status = { state: 'building' };
    assert.equal(h.cancel(), true);
    w.resolver.status = { state: 'failed', reason: 'x' };
    assert.equal(h.read().state, 'failed');
    assert.equal(h.retry(), true);
    assert.deepEqual(w.actions, ['accept', 'cancel', 'retry']);
    w.resolver.status = { state: 'refused', reason: 'size', rows: 2000000 };
    assert.equal(h.read().state, 'refused');
    // the build published its selection: the table's change reaches the dependants, and the score is asked for
    w.t.cfg.closedSelection = { passing: new Set(['A1', 'B2']) };
    w.resolver.status = { state: 'ready' };
    w.sources.recipeChanged(w.t.id);
    await until(() => w.calls.estimate.length === 1, 'the estimate once the genes are known');
    assert.deepEqual(w.calls.estimate, [['A1', 'B2']]);
    assert.notEqual(h.read().state, 'building');
});

test('a cycle stops the dependants: the cycle state, with no request', async () => {
    const w = world();
    w.resolver.cycleOf = () => ['gene-table-1', 'cell-table-2', 'gene-table-1'];
    const h = w.sources.watch(w.t.id, { onChange: () => {}, dependant: 'plot-1' });
    const snap = h.read();
    assert.equal(snap.state, 'cycle');
    await new Promise(r => setTimeout(r, 10));
    assert.equal(w.calls.estimate.length, 0);
});

test('the notices say it in the table\'s words', () => {
    const base = { title: 'Gene Table 1', kind: 'table' };
    const building = N.describeScore({ ...base, state: 'building', gate: { state: 'waiting' } });
    assert.equal(building.tag.text, 'Building filter');
    assert.match(building.headline, /Building 'Gene Table 1' to find its genes, then scoring them\./);
    assert.deepEqual(building.actions.map(a => a[0]), ['score-cancel', 'score-open']);
    const opening = N.describeScore({ ...base, state: 'building', gate: { state: 'waiting', reason: 'opening' } });
    assert.equal(opening.tag.text, 'Opening table');
    const frozen = N.describeScore({ ...base, state: 'building', gate: { state: 'building', frozen: true } });
    assert.deepEqual(frozen.actions.map(a => a[0]), ['score-open'], 'the last step cannot be cancelled');
    const ask = N.describeScore({ ...base, state: 'ask', gate: { state: 'ask' } });
    assert.deepEqual(ask.actions[0], ['score-compute', 'Build filter']);
    assert.match(ask.headline, /will pause the page for a few seconds/);
    const cycle = N.describeScore({ ...base, state: 'cycle', cycle: ['Genes A', 'Cells B', 'Genes A'] }, { role: 'colour' });
    assert.match(cycle.headline, /'Genes A' and 'Cells B' depend on each other\./);
    assert.equal(cycle.state, 'cycle');
    assert.equal(N.describeScore({ ...base, state: 'deleted' }).headline, "Table 'Gene Table 1' was deleted.");
    assert.equal(N.describeScore({ title: 'S', state: 'deleted' }).headline, "Signature 'S' was deleted.");
    assert.equal(N.describeScore({ ...base, state: 'nogenes' }).headline, "No row of 'Gene Table 1' passes its filter, so there are no genes to score.");
    assert.equal(N.describeScore({ ...base, state: 'refused', message: 'too large' }).actions[0][1], 'Open table');
    assert.ok(N.PRIORITY.indexOf('cycle') < N.PRIORITY.indexOf('building'));
});

test('a cell table\'s score column over a table that is being built is pending, not a missing score', () => {
    assert.equal(C.columnView({ state: 'building' }, 'T').kind, 'pending');
    const ask = C.columnView({ state: 'ask' }, 'T');
    assert.equal(ask.kind, 'pending');
    assert.equal(ask.suffix, '(not built)');
    assert.equal(C.columnView({ state: 'cycle' }, 'T').kind, 'none');
});
