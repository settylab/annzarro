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

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const obs = (key, extra = {}) => ({ source: { type: 'obs', key }, ...extra });

function world({ cells = 6, seconds = () => 1 } = {}) {
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
    const store = createGroupStore({ api, limiter: createLimiter(2) });
    const panels = new Map();           // id -> {title, kind, raw}
    const ports = new Map();            // a source's key -> (dependant) => what the host says of it
    const cycles = new Map();
    let off = false;
    const host = {
        panel: (id) => {
            const p = panels.get(id);
            return p && p.kind === 'grouping' ? { title: p.title, recipe: () => p.raw } : null;
        },
        off: () => off,
        upstream: (source, dependant) => (ports.has(source.key) ? ports.get(source.key)(dependant) : null),
        cycleOf: (id) => cycles.get(id) || null,
        titleOf: (id) => (panels.get(id) || {}).title || id,
        kindOf: (id) => (panels.get(id) || {}).kind || 'panel',
        sourceTitle: (source) => (panels.has(source.key) ? panels.get(source.key).title : undefined)
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
    const watch = (id, option = {}, consumer = {}) => {
        const states = [];
        const handle = sources.watch(id, { consumer: { kind: 'plot', panelId: 'p1', ...consumer }, option,
            onChange: (snap) => states.push(snap.state) });
        handle.states = states;
        return handle;
    };
    return { sources, store, calls, waiting, panels, ports, cycles, ctx, fire, finish, grouping, watch,
        setOff: (v) => { off = v; } };
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
