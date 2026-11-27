/**
 * The page's group sources (static/js/utils/group-host.js, FX-H): ONE binding for the page, lifted from the Cell
 * Grouping panel, with the codes on the memory guard's ledger (CAT-4): held while a consumer holds them, pinned while
 * one on screen does, evictable while only hidden ones do, released with the last.
 *
 * This runs the page's own binding (groupSources()) over a fake fetch of the cell_groups route and the page's own
 * ledger (memory-guard-ui.js), so what is tested is the wiring the page uses.
 *
 * Run:  node --test annzarro/tests/js/group-host.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { DataManager } = await import('../../../static/js/data-manager.js');
const G = await import('../../../static/js/utils/group-host.js');
const { ledger } = await import('../../../static/js/utils/memory-guard-ui.js');

const CELLS = ['c0', 'c1', 'c2', 'c3', 'c4'];
Object.assign(DataManager, {
    getCurrentDataset: () => 'd.zarr', getCells: () => CELLS, getSubsetParam: () => null, getGenes: () => [], isDatasetLoaded: () => false
});

const recipe = { version: 1, partitionings: [{ source: { type: 'obs', key: 'cell_type' } }] };
const grouping = { getId: () => 'cell-grouping-1', getType: () => 'cell-grouping', getTitle: () => 'Grouping 1', getRecipe: () => recipe,
    getConfig: () => ({}) };
globalThis.PanelManager = {
    getPanel: (id) => (id === 'cell-grouping-1' ? grouping : null), getActivePanels: () => [grouping], getAllPanels: () => [grouping]
};

const enc = new TextEncoder();
const line = (obj) => enc.encode(`${JSON.stringify(obj)}\n`);
const cat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
};
const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const streamed = (bytes) => ({ ok: true, status: 200, body: { getReader() {
    let sent = false;
    return { async read() { if (sent) return { done: true }; sent = true; return { done: false, value: bytes }; }, async cancel() {} };
} } });

const codes = new Uint8Array([0, 1, 1, 0, 1]);
const result = { type: 'result', version: 1, shape: 'grouping', n_shown: 5, n_grouped: 5,
    partitionings: [{ kind: 'categorical', levels: [{ id: 'c:B cell', n: 2 }, { id: 'c:T cell', n: 3 }] }],
    groups: [{ key: ['c:B cell'], n: 2 }, { key: ['c:T cell'], n: 3 }], features: [], measures: [],
    blocks: [{ name: 'codes', dtype: 'uint8', length: 5 }] };

const asked = [];
globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    asked.push({ url: String(url), body });
    if (body.estimate_only) return json({ estimate: { seconds: 0.1, tier: 'live', lane: 'light' } });
    return streamed(cat(line({ type: 'start', codes: 'miss', lane: 'light', entries_total: 5, queue: { ahead: 0, sharing: 0 } }), line(result), codes));
};

async function until(test, what) {
    for (let i = 0; i < 400; i++) {
        if (test()) return;
        await new Promise(r => setTimeout(r, 5));
    }
    throw new Error(`timed out: ${what}`);
}

const codesHolding = () => [...ledger.holdings.entries()].find(([name]) => name.startsWith('C\u0001'));

test('the page has one binding: the same store and sources for every consumer', () => {
    assert.equal(G.groupSources(), G.groupSources());
    assert.equal(G.groupSources().sources, G.groupSources().sources);
});

test('codes are held on the ledger, pinned while a consumer on screen holds them, evictable when hidden, released with the last', async () => {
    const { sources } = G.groupSources();
    let shownA = true;
    let shownB = false;
    const a = sources.watch('cell-grouping-1', { consumer: { kind: 'plot', role: 'color', panelId: 'cell-plot-A' }, option: { codes: true },
        visible: () => shownA, onChange() {} });
    a.read();
    await until(() => a.read().state === 'ready', 'the groups and their codes');
    assert.ok(asked.some(c => !c.body.estimate_only && c.body.want && c.body.want.codes === true), 'the codes were asked for');
    assert.ok(asked.every(c => c.url.startsWith('/api/v1/data/cell_groups?dataset_path=d.zarr')), "the page's route");
    let held = codesHolding();
    assert.ok(held, 'the codes are on the ledger');
    assert.equal(held[1].bytes, 5);
    assert.equal(held[1].pinned, true, 'a consumer on screen holds them');

    // a second consumer, hidden, of the same groups: no second copy, still pinned by the first
    const b = sources.watch('cell-grouping-1', { consumer: { kind: 'plot', role: 'color', panelId: 'cell-plot-B' }, option: { codes: true },
        visible: () => shownB, onChange() {} });
    b.read();
    await until(() => b.read().state === 'ready', 'the second consumer');
    assert.equal([...ledger.holdings.keys()].filter(n => n.startsWith('C\u0001')).length, 1, 'one copy of the codes');
    assert.equal(asked.filter(c => !c.body.estimate_only).length, 1, 'one request for both');

    // both hidden: evictable; one shown again: pinned
    shownA = false;
    sources.visibilityChanged();
    held = codesHolding();
    assert.equal(held[1].pinned, false, 'held by hidden consumers only, the guard may evict them');
    assert.equal(ledger.evictable() >= 5, true);
    shownB = true;
    sources.visibilityChanged();
    assert.equal(codesHolding()[1].pinned, true);

    // the consumers go: the codes go with the last
    a.release();
    assert.ok(codesHolding(), 'the other consumer still holds them');
    b.release();
    assert.equal(codesHolding(), undefined, 'released with the last');
});

test('the host hooks are filled once: a grouping panel is a source, anything else is not', () => {
    const { sources } = G.groupSources();
    const h = sources.watch('cell-plot-A', { consumer: { kind: 'plot', role: 'color', panelId: 'cell-plot-B' }, option: { codes: true },
        visible: () => true, onChange() {} });
    assert.equal(h.read().state, 'deleted', 'a panel that is not a grouping is no source of groups');
    h.release();
    assert.equal(G.titleOfPanel('cell-grouping-1'), 'Grouping 1');
    assert.equal(G.sourceTitleOf({ type: 'obs', key: 'cell_type' }), undefined, 'a column has no panel title');
    assert.equal(G.cycleIds('cell-grouping-1'), null);
});
