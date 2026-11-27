/**
 * Group sources (static/js/utils/group-sources.js): a Cell Grouping panel as a derived source. Its consumers' handles,
 * the request each one makes, the gates upstream (a table, a score, another grouping, a cycle, a table above 1M cells
 * shown), and the names of a group of a grouping used as a factor, which come from the browser (PER-3). The page is a
 * fake host; the server is a fake api under the real group store.
 *
 * Run:  node --test annzarro/tests/js/group-sources.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const GS = await import('../../../static/js/utils/group-sources.js');
const { createGroupStore } = await import('../../../static/js/utils/group-store.js');
const { createLimiter } = await import('../../../static/js/utils/derived-store.js');
const { packBitset } = await import('../../../static/js/utils/cell-grouping.js');
const { resolveGroup } = await import('../../../static/js/utils/group-reference.js');
const { Ledger } = await import('../../../static/js/utils/memory-guard.js');
const CP = await import('../../../static/js/utils/count-plot-model.js');

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const obs = (key, extra = {}) => ({ source: { type: 'obs', key }, ...extra });

function world({ cells = 6, seconds = () => 1, ledger = undefined } = {}) {
    const calls = { estimate: [], compute: [] };
    const waiting = [];
    const api = {
        async estimate({ recipe }) {
            calls.estimate.push(recipe);
            const s = seconds(recipe);
            return { estimate: { seconds: s, tier: s < 5 ? 'live' : 'auto', live_max_s: 5, auto_max_s: 60, max_s: 600 } };
        },
        compute(req) {
            calls.compute.push(req);
            return new Promise((resolve, reject) => {
                waiting.push({ req, resolve, reject });
                req.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
            });
        }
    };
    const store = createGroupStore({ api, limiter: createLimiter(2), codes: ledger });
    const panels = new Map();           // id -> {title, kind, raw}
    const ports = new Map();            // a source's key -> (dependant) => what the host says of it
    const cycles = new Map();
    const upstreamListeners = [];
    let off = false;
    const host = {
        source: (id) => {
            const p = panels.get(id);
            if (p && p.shape) return { title: p.title, kind: p.kind, recipe: () => p.raw, shape: p.shape };
            return p && p.kind === 'grouping' ? { title: p.title, kind: 'grouping', recipe: () => p.raw, shape: GS.GROUPING } : null;
        },
        off: () => off,
        upstream: (source, dependant) => (ports.has(source.key) ? ports.get(source.key)(dependant) : null),
        cycleOf: (id) => cycles.get(id) || null,
        titleOf: (id) => (panels.get(id) || {}).title || id,
        kindOf: (id) => (panels.get(id) || {}).kind || 'panel',
        sourceTitle: (source) => (panels.has(source.key) ? panels.get(source.key).title : undefined),
        onUpstreamChange: (fn) => { upstreamListeners.push(fn); }
    };
    const ctx = { dataset: 'd.zarr', subset: null, cells };
    const timers = [];
    const sources = GS.createGroupSources({
        store, host, context: () => ({ ...ctx }), liveDelayMs: 10,
        setTimer: (fn) => { const t = { fn, off: false }; timers.push(t); return t; },
        clearTimer: (t) => { if (t) t.off = true; }
    });
    const fire = async () => {
        for (const t of timers.splice(0)) if (!t.off) await t.fn();
        await settle();
    };
    const grouping = (id, title, partitionings, extra = {}) => {
        panels.set(id, { title, kind: 'grouping', raw: { version: 1, partitionings, ...extra } });
        return panels.get(id);
    };
    /** The server's answer to computation i: these levels and groups, with codes when asked. */
    const finish = async (i, { levels = ['c:B cell', 'c:T cell'], groups = null, extra = {} } = {}) => {
        const body = waiting[i].req.recipe;
        const keys = groups || levels.map((id) => [id]);
        const header = { type: 'result', version: 1, shape: 'grouping', n_shown: ctx.cells, n_grouped: ctx.cells,
            partitionings: [{ kind: 'categorical', levels: levels.map((id) => ({ id, n: 1 })), ...extra }],
            groups: keys.map((key) => ({ key, n: 1 })), small: {} };
        const values = {};
        if (body.want.codes) values.codes = Uint8Array.from({ length: ctx.cells }, (_, c) => c % keys.length);
        if (body.features && body.features.length) {
            header.features = body.features.map((f) => ({ id: f.id, status: 'ok' }));
            values.feature_moments = new Float64Array(body.features.length * keys.length * 5).fill(1);
        }
        waiting[i].resolve({ header, values });
        await settle();
    };
    const watch = (id, option = {}, consumer = {}, visible = () => true) => {
        const states = [];
        const handle = sources.watch(id, { consumer: { kind: 'plot', panelId: 'p1', ...consumer }, option, visible,
            onChange: (snap) => states.push(snap.state) });
        handle.states = states;
        handle.read();              // a consumer reads its handle when it draws: that asks for the groups
        return handle;
    };
    return { sources, store, calls, waiting, panels, ports, cycles, ctx, fire, finish, grouping, watch,
        setOff: (v) => { off = v; },
        /** The page tells that a table or a score panel changed (a filter, a build, a score edit). */
        upstreamChanged: (panelId) => { for (const fn of upstreamListeners) fn(panelId); },
        /** Answer every computation still waiting, in order, until none is left. */
        async drain(opts) {
            for (let n = 0; n < 50; n++) {
                await settle();
                const i = waiting.findIndex((x) => !x.answered);
                if (i < 0) return;
                waiting[i].answered = true;
                await finish(i, opts);
            }
        } };
}

test('a plot colored by a grouping: one request, the codes, and the names of its groups', async () => {
    const w = world();
    w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    const h = w.watch('g1', { codes: true });
    assert.equal(h.read().state, 'estimating');
    await settle();
    assert.equal(w.calls.compute.length, 1);
    const body = w.calls.compute[0].recipe;
    assert.deepEqual(body.partitionings, [{ source: { type: 'obs', key: 'cell_type' } }]);
    assert.equal(body.want.codes, true);
    assert.equal(body.shape, 'grouping');
    await w.finish(0);
    const snap = h.read();
    assert.equal(snap.state, 'ready');
    assert.equal(snap.kind, 'grouping');
    assert.equal(snap.values.codes.length, 6);
    assert.deepEqual(w.sources.namesOf('g1', snap.values.reply), ['B cell', 'T cell']);
});

test('a rename recomputes nothing and the names follow at once', async () => {
    const w = world();
    const g = w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    const h = w.watch('g1', { codes: true });
    await settle();
    await w.finish(0);
    const before = h.read();
    g.raw = { version: 1, partitionings: [obs('cell_type', { labels: { 'c:B cell': 'B' } })], separator: ' / ' };
    w.sources.sourceChanged('g1');
    await w.fire();
    assert.equal(w.calls.compute.length, 1);
    const after = h.read();
    assert.equal(after.key, before.key);
    assert.equal(after.values, before.values);
    assert.deepEqual(w.sources.namesOf('g1', after.values.reply), ['B', 'T cell']);
    // the names are made once per reply and recipe
    assert.equal(w.sources.namesOf('g1', after.values.reply), w.sources.namesOf('g1', after.values.reply));
});

test('an edit that changes the groups is a new key, and an edit back is the cached one', async () => {
    const w = world();
    const g = w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    const h = w.watch('g1', { features: [{ kind: 'gene', name: 'Cd3e', layer: 'X', detect_above: 0 }] });
    await settle();
    await w.finish(0);
    const first = h.read().key;
    g.raw = { version: 1, partitionings: [obs('cell_type', { levels: ['c:B cell'] })] };
    w.sources.sourceChanged('g1');
    await w.fire();
    assert.equal(h.read().state, 'updating');
    assert.equal(w.calls.compute.length, 2);
    assert.deepEqual(w.calls.compute[1].recipe.partitionings[0].levels, ['c:B cell']);
    await w.finish(1, { levels: ['c:B cell', '@other'] });
    assert.notEqual(h.read().key, first);
    g.raw = { version: 1, partitionings: [obs('cell_type')] };
    w.sources.sourceChanged('g1');
    await w.fire();
    assert.equal(h.read().key, first);
    assert.equal(h.read().state, 'ready', 'the group table and the gene are cached');
    assert.equal(w.calls.compute.length, 2);
});

test('features: a Cell-Gene Plot asks for its genes, one entry each', async () => {
    const w = world();
    w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    const cd3e = { kind: 'gene', name: 'Cd3e', layer: 'X', detect_above: 0 };
    const h = w.watch('g1', { features: [cd3e] });
    await settle();
    assert.deepEqual(w.calls.compute[0].recipe.features, [{ id: 'f0', ...cd3e }]);
    assert.equal(w.calls.compute[0].recipe.want.codes, false);
    await w.finish(0);
    assert.equal(h.read().values.features.length, 1);
    const more = w.watch('g1', { features: [cd3e, { ...cd3e, name: 'Nkg7' }] });
    await settle();
    assert.deepEqual(w.calls.compute[1].recipe.features.map((f) => f.name), ['Nkg7']);
    await w.finish(1);
    assert.equal(more.read().values.features.length, 2);
});

test('histograms of the factors a panel shows are asked for, and are part of the key', async () => {
    const w = world();
    w.grouping('g1', 'Grouping 1', [obs('total_counts', { binning: { method: 'equal_width', bins: 4 } })]);
    const panel = w.watch('g1', { histograms: [0] }, { kind: 'grouping', panelId: 'g1' });
    const plot = w.watch('g1', { codes: true });
    await settle();
    assert.equal(w.calls.compute.length, 2);
    assert.deepEqual(w.calls.compute.map((c) => c.recipe.want.histograms), [[0], []]);
    assert.notEqual(panel.read().key, plot.read().key);
});

test('a histogram position past the recipe makes no separate key and no separate request', async () => {
    const w = world();
    w.grouping('g1', 'Grouping 1', [obs('total_counts', { binning: { method: 'equal_width', bins: 4 } })]);
    const plain = w.watch('g1', {}, { kind: 'grouping', panelId: 'g1' });
    const early = w.watch('g1', { histograms: [1] }, { kind: 'grouping', panelId: 'g1' });
    await settle();
    assert.equal(w.calls.compute.length, 1, 'the card of an edit not yet applied asks for nothing more');
    assert.deepEqual(w.calls.compute[0].recipe.want.histograms, []);
    assert.equal(plain.read().key, early.read().key);
    const both = w.watch('g1', { histograms: [0, 3] }, { kind: 'grouping', panelId: 'g1' });
    await settle();
    assert.deepEqual(w.calls.compute[1].recipe.want.histograms, [0], 'a position the recipe has is kept, the rest left out');
    assert.notEqual(both.read().key, plain.read().key);
});

test('a table gate upstream: its state, its buttons, then the cells it passes as a bitset', async () => {
    const w = world();
    w.panels.set('t1', { title: 'Table 1', kind: 'table' });
    w.grouping('g1', 'Grouping 1', [{ source: { type: 'table', key: 't1' } }]);
    const pressed = [];
    let rows = null;
    w.ports.set('t1', (dependant) => (rows ? { bitset: () => rows } : {
        gate: { state: 'building', dependant },
        actions: { accept: () => pressed.push('accept'), cancel: () => pressed.push('cancel'), retry: () => pressed.push('retry') }
    }));
    const h = w.watch('g1', { codes: true });
    await settle();
    const gated = h.read();
    assert.equal(gated.state, 'building');
    assert.equal(gated.dependant, 'p1', 'the gate is asked for the consumer');
    assert.equal(w.calls.estimate.length + w.calls.compute.length, 0);
    assert.equal(h.compute(), true);
    assert.equal(h.cancel(), true);
    assert.deepEqual(pressed, ['accept', 'cancel']);

    rows = { flags: [1, 0, 1, 1, 0, 0], hash: 'rows-A' };
    w.sources.sourceChanged('g1');
    await settle();
    const body = w.calls.compute[0].recipe;
    assert.deepEqual(body.partitionings, [{ source: { type: 'table', ref: 's0' } }]);
    assert.deepEqual(body.sets, { s0: packBitset(rows.flags) });
    await w.finish(0, { levels: ['@in', '@out'] });
    assert.equal(h.read().state, 'ready');
    assert.deepEqual(w.sources.namesOf('g1', h.read().values.reply), ['in Table 1', 'not in Table 1']);

    // the same rows again: nothing; other rows: an edit, computed after the pause
    const key = h.read().key;
    rows = { flags: [1, 0, 1, 1, 0, 0], hash: 'rows-A' };
    w.sources.sourceChanged('g1');
    await w.fire();
    assert.equal(w.calls.compute.length, 1);
    rows = { flags: [0, 0, 1, 1, 0, 0], hash: 'rows-B' };
    w.sources.sourceChanged('g1');
    await w.fire();
    assert.equal(w.calls.compute.length, 2);
    assert.notEqual(h.read().key, key);
});

test('a table above 1M cells shown cannot be a factor: refused with the way out, nothing asked', async () => {
    const w = world({ cells: 12000000 });
    w.panels.set('t1', { title: 'Table 1', kind: 'table' });
    w.grouping('g1', 'Grouping 1', [{ source: { type: 'table', key: 't1' } }]);
    w.ports.set('t1', () => ({ bitset: () => ({ flags: [], hash: 'x' }) }));
    const h = w.watch('g1', { codes: true });
    await settle();
    const snap = h.read();
    assert.equal(snap.state, 'refused');
    assert.equal(snap.reason, 'table_too_many_cells');
    assert.equal(snap.message, 'A cell table cannot list 12M cells. Use a subset of up to 1M cells, or divide by a column.');
    const note = (await import('../../../static/js/utils/source-notices.js')).describeSource(snap, { role: 'colour' },
        { thing: 'grouping', source: 'grouping', result: 'grouping', Computing: 'Computing' });
    assert.doesNotMatch(note.headline, /too large|would take|second/i, note.headline);
    assert.match(note.headline, /reads a cell table of 12,000,000 cells; a cell table lists up to 1,000,000, so it was not computed\.$/, note.headline);
    assert.equal(w.calls.estimate.length + w.calls.compute.length, 0);
});

test('a score gate upstream: the score source asks first; then its recipe goes inline', async () => {
    const w = world();
    w.panels.set('s1', { title: 'T cell score', kind: 'gene-table' });
    const score = { type: 'gene-score', key: 's1', column: 'mean', layer: 'X' };
    w.grouping('g1', 'Grouping 1', [{ source: score, binning: { method: 'equal_count', bins: 3 } }]);
    const pressed = [];
    let ready = false;
    w.ports.set('s1', () => (ready ? { recipe: () => ({ recipe: { genes: ['Cd3e'], method: 'mean', input: 'X' }, hash: 'score-1' }) }
        : { gate: { state: 'ask' }, actions: { accept: () => pressed.push('accept'), cancel() {}, retry() {} } }));
    const h = w.watch('g1', { codes: true });
    await settle();
    assert.equal(h.read().state, 'ask');
    h.compute();
    assert.deepEqual(pressed, ['accept']);
    ready = true;
    w.sources.sourceChanged('g1');
    await settle();
    const wire = w.calls.compute[0].recipe.partitionings[0];
    assert.deepEqual(wire.source, { ...score, recipe: { genes: ['Cd3e'], method: 'mean', input: 'X' } });
    assert.equal(wire.binning.method, 'equal_count');
});

test('a cycle computes nothing and names the panels on it', async () => {
    const w = world();
    w.panels.set('t1', { title: 'Table 1', kind: 'table' });
    w.grouping('g1', 'Grouping 1', [{ source: { type: 'table', key: 't1' } }]);
    w.ports.set('t1', () => ({ bitset: () => ({ flags: [1, 1, 1, 1, 1, 1], hash: 'all' }) }));
    w.cycles.set('g1', ['g1', 't1', 'g1']);
    const h = w.watch('g1', { codes: true });
    await settle();
    const snap = h.read();
    assert.equal(snap.state, 'cycle');
    assert.deepEqual(snap.cycle, ['Grouping 1', 'Table 1', 'Grouping 1']);
    assert.deepEqual(snap.cycleKinds, ['grouping', 'table', 'grouping']);
    assert.equal(w.calls.estimate.length + w.calls.compute.length, 0);
});

test('a grouping with no factor asks nothing: a gate of its own for every consumer, lifted by the first factor', async () => {
    const w = world();
    const g = w.grouping('g1', 'Grouping 3', []);
    const h = w.watch('g1', { codes: true });
    await settle();
    const snap = h.read();
    assert.equal(snap.state, 'nofactors');
    assert.equal(snap.reason, 'no_factors');
    assert.equal(w.calls.estimate.length + w.calls.compute.length, 0, 'nothing asked');
    // a grouping that uses it says so as the upstream's, not as its own
    w.grouping('g2', 'Grouping 4', [{ source: { type: 'cell-group', key: 'g1' } }]);
    w.ports.set('g1', () => ({ grouping: 'g1' }));
    const down = w.watch('g2', { codes: true });
    await settle();
    assert.equal(down.read().state, 'failed');
    assert.equal(down.read().message, 'the grouping it uses has no factors yet.');
    assert.equal(w.calls.estimate.length + w.calls.compute.length, 0);
    g.raw = { version: 1, partitionings: [obs('cell_type')] };
    w.sources.sourceChanged('g1');
    await settle();
    assert.notEqual(h.read().state, 'nofactors');
    assert.ok(w.calls.estimate.length + w.calls.compute.length > 0, 'the first factor asks for the groups');
});

test('a grouping of a grouping: the upstream first, its recipe inline, its names from the browser', async () => {
    const w = world();
    const g1 = w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    w.grouping('g2', 'Grouping 2', [{ source: { type: 'cell-group', key: 'g1' } }, obs('condition')]);
    w.ports.set('g1', () => ({ grouping: 'g1' }));
    const h = w.watch('g2', { codes: true });
    await settle();
    // the upstream is computed first, for its group table only
    assert.equal(w.calls.compute.length, 1);
    assert.deepEqual(w.calls.compute[0].recipe.partitionings, [{ source: { type: 'obs', key: 'cell_type' } }]);
    assert.equal(w.calls.compute[0].recipe.want.codes, false);
    assert.equal(h.read().state, 'computing', "the upstream's state");
    assert.equal(w.sources.consumersOf('g1').length, 1);
    assert.equal(w.sources.consumersOf('g1')[0].kind, 'grouping');
    await w.finish(0);
    await settle();
    assert.equal(w.calls.compute.length, 2);
    const wire = w.calls.compute[1].recipe.partitionings[0];
    assert.deepEqual(wire.source, { type: 'cell-group', key: 'g1',
        recipe: { partitionings: [{ source: { type: 'obs', key: 'cell_type' } }], small: { threshold: 10, mode: 'keep' } } });
    const gB = 'g:["c:B cell"]';
    const gT = 'g:["c:T cell"]';
    await w.finish(1, { levels: [gB, gT], groups: [[gB], [gT]] });
    const reply = h.read().values.reply;
    assert.deepEqual(w.sources.namesOf('g2', reply), ['B cell', 'T cell']);
    // a rename upstream renames the downstream's groups, and asks for nothing
    g1.raw = { version: 1, partitionings: [obs('cell_type', { labels: { 'c:B cell': 'B' } })] };
    w.sources.sourceChanged('g1');
    await w.fire();
    assert.equal(w.calls.compute.length, 2);
    assert.deepEqual(w.sources.namesOf('g2', reply), ['B', 'T cell']);
    assert.deepEqual(w.sources.labelsOf('g2', reply).byKey.get(JSON.stringify([gB])), ['B']);
    // the downstream's last consumer releases the upstream it held
    h.release();
    assert.equal(w.sources.consumersOf('g1').length, 0);
});

test('an edit upstream that changes its groups is an edit of the downstream', async () => {
    const w = world();
    const g1 = w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    w.grouping('g2', 'Grouping 2', [{ source: { type: 'cell-group', key: 'g1' } }]);
    w.ports.set('g1', () => ({ grouping: 'g1' }));
    const h = w.watch('g2', { codes: true });
    await settle();
    await w.finish(0);
    await settle();
    await w.finish(1, { levels: ['g:["c:B cell"]'] });
    const key = h.read().key;
    g1.raw = { version: 1, partitionings: [obs('cell_type', { rest: 'exclude', levels: ['c:B cell'] })] };
    w.sources.sourceChanged('g1');
    await w.fire();
    await w.finish(2, { levels: ['c:B cell'] });
    await w.fire();
    assert.equal(w.calls.compute.length, 4);
    assert.deepEqual(w.calls.compute[3].recipe.partitionings[0].source.recipe.partitionings[0].levels, ['c:B cell']);
    assert.notEqual(h.read().key, key);
});

test('the labelled groups serve a group reference', async () => {
    const w = world();
    w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    const h = w.watch('g1', { codes: true });
    await settle();
    await w.finish(0);
    const labelled = w.sources.labelsOf('g1', h.read().values.reply);
    assert.equal(resolveGroup({ group: ['c:T cell'], groupWas: ['T cell'] }, labelled, new Map()).state, 'ok');
    assert.equal(w.sources.labelsOf('g1', h.read().values.reply), labelled, 'made once per reply');
});

test('a grouping that is gone is deleted, and off when the panel type is switched off', async () => {
    const w = world();
    const h = w.watch('g9', { codes: true });
    assert.equal(h.read().state, 'deleted');
    w.setOff(true);
    assert.equal(h.read().state, 'off');
});

test('a consumer of an unknown kind throws', () => {
    const w = world();
    w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    assert.throws(() => w.sources.watch('g1', { consumer: { kind: 'nope' }, option: {}, onChange() {} }), /Unknown consumer kind/);
});

// --- the review's scenarios (G7b) -----------------------------------------------------------------------------------

const geneWire = (name) => ({ kind: 'gene', name, layer: 'X', detect_above: 0 });

test('H1: a factor added while the old groups are shown: they are named by the recipe that made them', async () => {
    const w = world();
    const g = w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    const h = w.watch('g1', { codes: true });
    await settle();
    await w.finish(0);
    g.raw = { version: 1, partitionings: [obs('cell_type'), obs('n_genes', { binning: { method: 'equal_count' } })] };
    w.sources.sourceChanged('g1');
    // the plot repaints its legend at once, and again when the edit is applied
    const now = h.read();
    assert.deepEqual(w.sources.namesOf('g1', now.values.reply), ['B cell', 'T cell']);
    await w.fire();
    const updating = h.read();
    assert.equal(updating.state, 'updating');
    assert.deepEqual(w.sources.namesOf('g1', updating.values.reply), ['B cell', 'T cell']);
});

test('H1: a column swapped behind Update groups: the groups shown keep their names until the new ones come', async () => {
    const w = world({ seconds: (r) => (r.partitionings[0].source.key === 'is_doublet' ? 100 : 1) });
    const g = w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    const h = w.watch('g1', { codes: true });
    await settle();
    await w.finish(0);
    g.raw = { version: 1, partitionings: [obs('is_doublet', { labels: { 'c:T cell': 'doublet' } })] };
    w.sources.sourceChanged('g1');
    await w.fire();
    const held = h.read();
    assert.equal(held.state, 'ready');
    assert.ok(held.held, 'the edit waits for Update groups');
    assert.deepEqual(w.sources.namesOf('g1', held.values.reply), ['B cell', 'T cell']);
    assert.deepEqual(w.sources.labelsOf('g1', held.values.reply).byKey.get(JSON.stringify(['c:T cell'])), ['T cell']);
});

test('H1: a rename made with a structural edit applies to the groups shown where the factor is the same', async () => {
    const w = world({ seconds: (r) => (r.partitionings.length > 1 ? 100 : 1) });
    const g = w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    const h = w.watch('g1', { codes: true });
    await settle();
    await w.finish(0);
    g.raw = { version: 1, partitionings: [obs('condition'), obs('cell_type', { labels: { 'c:B cell': 'B' } })] };
    w.sources.sourceChanged('g1');
    await w.fire();
    assert.deepEqual(w.sources.namesOf('g1', h.read().values.reply), ['B', 'T cell']);
});

test('H2: codes the guard evicts leave the handle too: a hidden consumer no longer reads them', async () => {
    const ledger = new Ledger();
    const w = world({ ledger });
    w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    let shown = true;
    const h = w.watch('g1', { codes: true }, {}, () => shown);
    await settle();
    await w.finish(0);
    const codes = h.read().values.codes;
    assert.equal(ledger.heldBytes(), codes.byteLength);
    shown = false;
    w.sources.visibilityChanged();
    const freed = ledger.evict();
    assert.equal(freed, codes.byteLength);
    assert.equal(ledger.heldBytes(), 0);
    const snap = h.read();
    assert.notEqual(snap.state, 'updating', 'nothing still shown is uncounted');
    assert.notEqual(snap.state, 'ready');
    assert.equal(snap.values || null, null);
    await settle();
    assert.equal(w.calls.compute.length, 1, 'nothing is asked while hidden');
    shown = true;
    w.sources.visibilityChanged();
    await settle();
    assert.equal(w.calls.compute.length, 2);
    await w.finish(1);
    assert.equal(h.read().state, 'ready');
    assert.equal(ledger.heldBytes(), codes.byteLength);
});

test('H2: an edit keeps the codes shown on the ledger until the new codes replace them', async () => {
    const ledger = new Ledger();
    const w = world({ ledger });
    const g = w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    const h = w.watch('g1', { codes: true });
    await settle();
    await w.finish(0);
    const before = h.read();
    const bytes = before.values.codes.byteLength;
    g.raw = { version: 1, partitionings: [obs('condition')] };
    w.sources.sourceChanged('g1');
    await w.fire();
    const updating = h.read();
    assert.equal(updating.state, 'updating');
    assert.equal(updating.values.codes, before.values.codes);
    assert.equal(ledger.heldBytes(), bytes, 'the codes still drawn are counted');
    await w.finish(1, { levels: ['c:ctrl', 'c:stim'] });
    assert.equal(h.read().state, 'ready');
    assert.equal(ledger.holdings.size, 1, 'the old codes went when the new ones came');
    assert.equal(ledger.heldBytes(), bytes);
    h.release();
    assert.equal(ledger.heldBytes(), 0);
});

test('H5: the progress frame reaches the handle: the place in the queue, the seconds running, the stage', async () => {
    const w = world();
    w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    const h = w.watch('g1', { codes: true });
    await settle();
    w.waiting[0].req.onProgress(10, 40, { type: 'progress', stage: 'groups', entries_done: 10, entries_total: 40,
        running_s: 1.5, queue: { ahead: 0, sharing: 1 } });
    assert.deepEqual(h.read().progress, { done: 10, total: 40, stage: 'groups', entries_done: 10, entries_total: 40,
        running_s: 1.5, queue: { ahead: 0, sharing: 1 } });
    w.waiting[0].req.onProgress(0, 40, { type: 'start', queue: { ahead: 2, sharing: 0 } });
    assert.deepEqual(h.read().progress, { done: 0, total: 40, queue: { ahead: 2, sharing: 0 } });
});

test('H5: the progress of an upstream grouping reaches the grouping that waits on it', async () => {
    const w = world();
    w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    w.grouping('g2', 'Grouping 2', [{ source: { type: 'cell-group', key: 'g1' } }]);
    w.ports.set('g1', () => ({ grouping: 'g1' }));
    const h = w.watch('g2', { codes: true });
    await settle();
    w.waiting[0].req.onProgress(3, 9, { type: 'progress', stage: 'groups', running_s: 4 });
    const snap = h.read();
    assert.equal(snap.state, 'computing');
    assert.deepEqual(snap.progress, { done: 3, total: 9, stage: 'groups', running_s: 4 });
});

test('M2: six nested groupings are refused with a reason, never an exception', async () => {
    const w = world();
    w.grouping('g6', 'G6', [obs('cell_type')]);
    for (let i = 5; i >= 1; i--) {
        w.grouping(`g${i}`, `G${i}`, [{ source: { type: 'cell-group', key: `g${i + 1}` } }]);
        w.ports.set(`g${i + 1}`, () => ({ grouping: `g${i + 1}` }));
    }
    const h2 = w.watch('g2', { codes: true });
    await w.drain();
    assert.equal(h2.read().state, 'ready', 'four nested below the top are allowed');
    const asked = w.calls.compute.length;
    const h1 = w.watch('g1', { codes: true });
    const snap = h1.read();
    assert.equal(snap.state, 'refused');
    assert.equal(snap.reason, 'nested_too_deep');
    assert.ok(snap.message);
    // its notice names the nesting and its limit, not "too large to compute here"
    const note = (await import('../../../static/js/utils/source-notices.js')).describeSource(snap, { role: 'colour' },
        { thing: 'grouping', source: 'grouping', result: 'grouping', Computing: 'Computing' });
    assert.doesNotMatch(note.headline, /too large|would take|second/i, note.headline);
    assert.match(note.headline, /nests groupings 5 deep; a grouping can use groupings at most 4 deep, so it was not computed\.$/, note.headline);
    assert.equal(note.text, 'Use a column of a deeper grouping instead.');
    await settle();
    assert.equal(w.calls.compute.length, asked);
});

test('M3: an edit of another factor packs no table bitset again', async () => {
    const w = world();
    w.panels.set('t1', { title: 'Table 1', kind: 'table' });
    const rows = { flags: [1, 0, 1, 1, 0, 0], hash: 'rows-A' };
    w.ports.set('t1', () => ({ bitset: () => rows }));
    const g = w.grouping('g1', 'Grouping 1', [{ source: { type: 'table', key: 't1' } }, obs('n_genes', { binning: { method: 'equal_width', bins: 4 } })]);
    const h = w.watch('g1', { codes: true });
    await settle();
    await w.finish(0, { levels: ['@in', '@out'] });
    const btoa = globalThis.btoa;
    let packed = 0;
    globalThis.btoa = (s) => { packed++; return btoa(s); };
    try {
        for (let bins = 5; bins <= 9; bins++) {
            g.raw = { version: 1, partitionings: [{ source: { type: 'table', key: 't1' } }, obs('n_genes', { binning: { method: 'equal_width', bins } })] };
            w.sources.sourceChanged('g1');
            h.read();
            w.sources.recheck();
        }
        await w.fire();
    } finally {
        globalThis.btoa = btoa;
    }
    assert.equal(packed, 0, 'the cells of the table are packed once, by their hash');
    assert.equal(w.calls.compute.length, 2);
});

test('M5: a grouping on a grouping waits for the upstream\'s new groups, keeping its own meanwhile', async () => {
    const w = world();
    const g1 = w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    w.grouping('g2', 'Grouping 2', [{ source: { type: 'cell-group', key: 'g1' } }]);
    w.ports.set('g1', () => ({ grouping: 'g1' }));
    const h = w.watch('g2', { codes: true });
    await settle();
    await w.finish(0);
    await settle();
    const gB = 'g:["c:B cell"]';
    const gT = 'g:["c:T cell"]';
    await w.finish(1, { levels: [gB, gT] });
    const shown = h.read().values;
    g1.raw = { version: 1, partitionings: [obs('cell_type', { levels: ['c:B cell'] })] };
    w.sources.sourceChanged('g1');
    await w.fire();
    await w.fire();
    assert.equal(w.calls.compute.length, 3, 'the upstream first: the downstream is not asked with groups it cannot name');
    const waiting = h.read();
    assert.equal(waiting.state, 'updating');
    assert.equal(waiting.values, shown);
    assert.deepEqual(w.sources.namesOf('g2', waiting.values.reply), ['B cell', 'T cell']);
    await w.finish(2, { levels: ['c:B cell', '@other'] });
    await w.fire();
    assert.equal(w.calls.compute.length, 4);
    const gO = 'g:["@other"]';
    await w.finish(3, { levels: [gB, gO] });
    const snap = h.read();
    assert.equal(snap.state, 'ready');
    assert.deepEqual(w.sources.namesOf('g2', snap.values.reply), ['B cell', 'cell_type other']);
});

test('M5: the upstream\'s new groups repaint the downstream that names them', async () => {
    const w = world();
    const g1 = w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    w.grouping('g2', 'Grouping 2', [{ source: { type: 'cell-group', key: 'g1' } }]);
    w.ports.set('g1', () => ({ grouping: 'g1' }));
    const h = w.watch('g2', { codes: true });
    await w.drain();
    const told = h.states.length;
    g1.raw = { version: 1, partitionings: [obs('cell_type', { levels: ['c:B cell'] })] };
    w.sources.sourceChanged('g1');
    await w.fire();
    await w.finish(2);
    assert.ok(h.states.length > told + 1, 'the downstream hears the upstream\'s new reply');
});

test('M6: an edit made while a gate stood is applied when the gate lifts', async () => {
    const w = world();
    w.panels.set('t1', { title: 'Table 1', kind: 'table' });
    const rows = { flags: [1, 0, 1, 1, 0, 0], hash: 'rows-A' };
    w.ports.set('t1', () => ({ bitset: () => rows }));
    const factors = (bins) => [{ source: { type: 'table', key: 't1' } }, obs('n_genes', { binning: { method: 'equal_width', bins } })];
    const g = w.grouping('g1', 'Grouping 1', factors(4));
    const h = w.watch('g1', { codes: true });
    await settle();
    await w.finish(0, { levels: ['@in', '@out'] });
    const key = h.read().key;
    w.ctx.cells = 2000000;
    w.sources.contextChanged();
    assert.equal(h.read().state, 'refused');
    g.raw = { version: 1, partitionings: factors(5) };
    w.sources.sourceChanged('g1');
    await w.fire();
    w.ctx.cells = 6;
    w.sources.contextChanged();
    await w.fire();
    assert.notEqual(h.read().key, key, 'the bins asked for are the new ones');
    assert.equal(w.calls.compute.length, 2);
});

test('M8: a consumer changes its option and keeps what it shows, and the held edits stay held', async () => {
    const w = world({ seconds: (r) => (r.partitionings.length > 1 ? 100 : 1) });
    const g = w.grouping('g1', 'Grouping 1', [obs('cell_type')]);
    const h = w.watch('g1', { features: [geneWire('Cd3e')] });
    await settle();
    await w.finish(0);
    const shown = h.read().values;
    g.raw = { version: 1, partitionings: [obs('cell_type'), obs('condition')] };
    w.sources.sourceChanged('g1');
    await w.fire();
    assert.ok(w.sources.heldOf('g1'));
    h.setOption({ features: [geneWire('Cd3e'), geneWire('Lyz')] });
    const snap = h.read();
    assert.equal(snap.state, 'updating', 'the previous matrix stays until the new one comes');
    assert.equal(snap.values, shown);
    assert.ok(w.sources.heldOf('g1'), 'the edits behind Update groups are still held');
    await settle();
    const last = w.calls.compute[w.calls.compute.length - 1].recipe;
    assert.deepEqual(last.features.map((f) => f.name), ['Lyz'], 'only the new gene, for the groups shown');
    assert.equal(last.partitionings.length, 1);
});

test('M10: a table panel that changes reaches the groupings that use it through the host', async () => {
    const w = world();
    w.panels.set('t1', { title: 'Table 1', kind: 'table' });
    let rows = { flags: [1, 0, 1, 1, 0, 0], hash: 'rows-A' };
    w.ports.set('t1', () => ({ bitset: () => rows }));
    w.grouping('g1', 'Grouping 1', [{ source: { type: 'table', key: 't1' } }]);
    w.grouping('g2', 'Grouping 2', [obs('cell_type')]);
    const h = w.watch('g1', { codes: true });
    w.watch('g2', { codes: true });
    await w.drain({ levels: ['@in', '@out'] });
    const key = h.read().key;
    const asked = w.calls.compute.length;
    rows = { flags: [0, 0, 1, 1, 0, 0], hash: 'rows-B' };
    w.upstreamChanged('t1');
    await w.fire();
    assert.notEqual(h.read().key, key);
    assert.equal(w.calls.compute.length, asked + 1, 'only the grouping that uses the table');
});

// --- what C2a and X3a build on (H4) ---------------------------------------------------------------------------------

test('H4: a count plot is a source of groups: its grid request, its key, gates upstream, and readGrid of its value', async () => {
    const w = world();
    w.panels.set('t1', { title: 'Table 1', kind: 'table' });
    let rows = { flags: [1, 0, 1, 1, 0, 0], hash: 'rows-A' };
    w.ports.set('t1', () => ({ bitset: () => rows }));
    const shape = CP.gridShape({ isNumeric: () => false, levelCount: () => 2 });
    const plot = w.panels.set('c1', { title: 'Count 1', kind: 'count', shape,
        raw: { version: 1, mode: 'bar', x: obs('cell_type'), split: { source: { type: 'table', key: 't1' } } } }).get('c1');
    const h = w.watch('c1', {}, { panelId: 'c1' });
    await settle();
    assert.equal(w.calls.compute.length, 1);
    const body = w.calls.compute[0].recipe;
    assert.equal(body.shape, 'grid');
    assert.equal(body.mode, 'categorical');
    assert.deepEqual(body.partitionings[1].source, { type: 'table', ref: 's0' });
    assert.ok(!('want' in body));
    const axes = [{ levels: [{ id: 'c:B cell', n: 3 }, { id: 'c:T cell', n: 3 }], n_outside: [0, 0] },
        { levels: [{ id: '@in', n: 3 }, { id: '@out', n: 3 }], n_outside: [0, 0] }];
    w.waiting[0].resolve({ header: { type: 'result', shape: 'grid', n_shown: 6, n_counted: 6, axes }, values: { counts: Uint32Array.from([2, 1, 1, 2]) } });
    await settle();
    const snap = h.read();
    assert.equal(snap.state, 'ready');
    const grid = CP.readGrid(snap.values);
    assert.equal(CP.readGrid(h.read().values), grid, 'one grid per value: a paint reuses its tables');
    assert.deepEqual(grid.dims, [2, 2]);
    assert.equal(grid.shown, 6);
    // the arrangement is the drawing's: nothing is asked
    plot.raw = { ...plot.raw, arrangement: 'fill' };
    w.sources.sourceChanged('c1');
    await w.fire();
    assert.equal(w.calls.compute.length, 1);
    // the table's other cells: a new key, asked after the pause
    const key = h.read().key;
    rows = { flags: [0, 0, 1, 1, 0, 0], hash: 'rows-B' };
    w.upstreamChanged('t1');
    await w.fire();
    assert.equal(w.calls.compute.length, 2);
    assert.notEqual(h.read().key, key);
    // a plan that is not ready asks nothing and is the handle's state
    plot.raw = { version: 1, mode: 'histogram' };
    w.sources.sourceChanged('c1');
    await w.fire();
    assert.equal(h.read().state, 'empty');
    assert.equal(h.read().reason, 'choose_x');
});

test('H4: a Cell-Gene Plot groups by its own obs axis, and adding a gene keeps the matrix while that gene comes', async () => {
    const w = world();
    w.panels.set('axis:x1', { title: '', kind: 'axis', shape: GS.GROUPING, raw: { version: 1, partitionings: [obs('cell_type')] } });
    const h = w.watch('axis:x1', { features: [geneWire('Cd3e')] }, { panelId: 'x1' });
    await settle();
    await w.finish(0);
    const shown = h.read().values;
    assert.deepEqual(w.sources.namesOf('axis:x1', shown.reply), ['B cell', 'T cell']);
    h.setOption({ features: [geneWire('Cd3e'), geneWire('Lyz')] });
    assert.equal(h.read().values, shown);
    await settle();
    assert.deepEqual(w.calls.compute[1].recipe.features.map((f) => f.name), ['Lyz']);
    await w.finish(1);
    assert.equal(h.read().state, 'ready');
    assert.equal(h.read().values.features.length, 2);
});
