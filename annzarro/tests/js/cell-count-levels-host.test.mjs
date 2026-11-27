/**
 * C2b: Choose levels of a refused count-plot input asks for that input's levels at 'axis:<count panel id>' of the
 * page's group sources (utils/group-host.js), through the panel's axisSource(). That source follows its owner's type:
 * with Cell Count Plot turned off by policy the page makes the panel a placeholder (panel-manager.js), which has no
 * axisSource, so the source is off and asks nothing; on, it asks one grouping request of that input.
 *
 * Run:  node --test annzarro/tests/js/cell-count-levels-host.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

let policyValues = {};
const asked = [];
const enc = new TextEncoder();
const json = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const result = { type: 'result', version: 1, shape: 'grouping', n_shown: 3, n_grouped: 3,
    partitionings: [{ kind: 'categorical', levels: [{ id: 'c:m0', n: 1 }, { id: 'c:m1', n: 2 }], categories: ['c:m0', 'c:m1', 'c:m2'] }],
    groups: [{ key: ['c:m0'], n: 1 }, { key: ['c:m1'], n: 2 }], features: [], measures: [], blocks: [] };
let refuseNext = false;
globalThis.fetch = async (url, init) => {
    if (String(url).includes('/policy/effective')) return json({ version: JSON.stringify(policyValues), values: policyValues });
    if (!init || !init.body) return json({});
    const body = JSON.parse(init.body);
    asked.push(body);
    if (body.estimate_only) return json({ estimate: { seconds: 0.1, tier: 'live', lane: 'light' } });
    const frame = refuseNext ? { type: 'result', version: 1, shape: 'grouping', n_shown: 3, refused: { reason: 'too_many_groups', count: 2345, limit: 2000 },
        message: 'Too many groups.', blocks: [] } : result;
    const bytes = enc.encode(`${JSON.stringify({ type: 'start', lane: 'light', entries_total: 3 })}\n${JSON.stringify(frame)}\n`);
    return { ok: true, status: 200, body: { getReader() {
        let sent = false;
        return { async read() { if (sent) return { done: true }; sent = true; return { done: false, value: bytes }; }, async cancel() {} };
    } } };
};

const { DataManager } = await import('../../../static/js/data-manager.js');
const { Policy } = await import('../../../static/js/policy.js');
const G = await import('../../../static/js/utils/group-host.js');
const { GROUPING } = await import('../../../static/js/utils/group-sources.js');
const S = await import('../../../static/js/panels/cell-count/states.js');

Object.assign(DataManager, {
    getCurrentDataset: () => 'd.zarr', getCells: () => ['a', 'b', 'c'], getSubsetParam: () => null, getGenes: () => [], isDatasetLoaded: () => false
});

// the levels of one input, as panels/cell-count.js axisSource() gives them
let levels = { version: 1, partitionings: [{ source: { type: 'obs', key: 'many' } }] };
const count = { getId: () => 'cell-count-C', getType: () => 'cell-count', getTitle: () => 'Count 1', getConfig: () => ({}),
    groupSource: () => null, axisSource: () => ({ title: 'Count 1', kind: 'count', recipe: () => levels, shape: GROUPING }) };
// what panel-manager.js stands in a disabled type's place: the settings kept, no source of groups
const placeholder = { getId: () => 'cell-count-C', getType: () => 'cell-count', getTitle: () => 'Count 1', getConfig: () => ({}), isPlaceholder: true };
const shown = () => (Policy.panelEnabled('cell-count') ? count : placeholder);
globalThis.PanelManager = { getPanel: (id) => (id === 'cell-count-C' ? shown() : null), getActivePanels: () => [shown()], getAllPanels: () => [shown()] };

const watch = () => G.groupSources().sources.watch('axis:cell-count-C', { consumer: { kind: 'inspect', role: 'levels', panelId: 'cell-count-C' },
    option: {}, visible: () => true, onChange() {} });
const tick = () => new Promise((r) => setTimeout(r, 50));

test('Cell Count Plot turned off: its levels source is off and asks nothing', async () => {
    policyValues = { 'panel.cell-count.enabled': false };
    await Policy.load();
    try {
        assert.equal(Policy.panelEnabled('cell-count'), false);
        const h = watch();
        assert.equal(h.read().state, 'off');
        await tick();
        assert.equal(h.read().state, 'off');
        assert.deepEqual(asked, [], 'no estimate and no request');
        h.release();
    } finally {
        policyValues = {};
        await Policy.load();
    }
});

test('turned on: one grouping request of that input alone, with no codes', async () => {
    const h = watch();
    for (let i = 0; i < 400 && h.read().state !== 'ready'; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(h.read().state, 'ready');
    const sent = asked.filter((b) => !b.estimate_only);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].partitionings, [{ source: { type: 'obs', key: 'many' } }]);
    assert.notEqual(sent[0].shape, 'grid');
    assert.ok(!(sent[0].want && sent[0].want.codes));
    assert.deepEqual(h.read().values.reply.partitionings[0].categories, ['c:m0', 'c:m1', 'c:m2']);
    h.release();
});

test('more used categories than a grouping holds: the levels are refused with their figures, and Choose levels says so', async () => {
    refuseNext = true;
    levels = { version: 1, partitionings: [{ source: { type: 'obs', key: 'barcode' } }] };
    try {
        const h = watch();
        for (let i = 0; i < 400 && h.read().state !== 'refused'; i++) await new Promise((r) => setTimeout(r, 5));
        const snap = h.read();
        assert.equal(snap.state, 'refused');
        assert.equal(snap.reason, 'too_many_groups');
        // the figures the panel reads from the store, as utils/cell-group-source.js does
        const figures = G.groupSources().store.snapshot(snap.key).header.refused;
        assert.deepEqual(figures, { reason: 'too_many_groups', count: 2345, limit: 2000 });
        assert.equal(S.levelsNote({ ...snap, refused: figures }, { field: 'x', name: 'barcode', numeric: false }).text,
            'barcode has 2,345 levels that hold a cell; Choose levels lists up to 2,000.');
        h.release();
    } finally {
        refuseNext = false;
    }
});
