/**
 * X3a: a Cell-Gene Plot's own cell axis in the page's group sources (static/js/utils/group-host.js).
 *
 *   - 'axis:<panelId>' is the plot's obs column as a grouping of one factor with no panel (CXG-2): the page's sources
 *     read it from the plot's axisSource(), and ask the route for that one factor;
 *   - whether a source of groups is turned off (`off(id)`): an axis follows its OWNER's panel type, a panel that is a
 *     source of groups itself (a count plot, groupSource()) its own type, anything else (a grouping) Cell Grouping's.
 *
 * Run:  node --test annzarro/tests/js/cell-gene-axis-host.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

let policyValues = {};
const asked = [];
const enc = new TextEncoder();
const json = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const result = { type: 'result', version: 1, shape: 'grouping', n_shown: 3, n_grouped: 3,
    partitionings: [{ kind: 'categorical', levels: [{ id: 'c:B', n: 1 }, { id: 'c:T', n: 2 }] }],
    groups: [{ key: ['c:B'], n: 1 }, { key: ['c:T'], n: 2 }], features: [], measures: [], blocks: [] };
globalThis.fetch = async (url, init) => {
    if (String(url).includes('/policy/effective')) return json({ version: JSON.stringify(policyValues), values: policyValues });
    if (!init || !init.body) return json({});
    const body = JSON.parse(init.body);
    asked.push(body);
    if (body.estimate_only) return json({ estimate: { seconds: 0.1, tier: 'live', lane: 'light' } });
    const bytes = enc.encode(`${JSON.stringify({ type: 'start', lane: 'light', entries_total: 3 })}\n${JSON.stringify(result)}\n`);
    return { ok: true, status: 200, body: { getReader() {
        let sent = false;
        return { async read() { if (sent) return { done: true }; sent = true; return { done: false, value: bytes }; }, async cancel() {} };
    } } };
};

const { DataManager } = await import('../../../static/js/data-manager.js');
const { Policy } = await import('../../../static/js/policy.js');
const G = await import('../../../static/js/utils/group-host.js');
const { GROUPING } = await import('../../../static/js/utils/group-sources.js');

Object.assign(DataManager, {
    getCurrentDataset: () => 'd.zarr', getCells: () => ['a', 'b', 'c'], getSubsetParam: () => null, getGenes: () => [], isDatasetLoaded: () => false
});

const axisRecipe = { version: 1, partitionings: [{ source: { type: 'obs', key: 'cell_type' } }] };
let axisOn = true;
const plot = { getId: () => 'cell-gene-P', getType: () => 'cell-gene', getTitle: () => 'Cell-Gene Plot 1', getConfig: () => ({}),
    axisSource: () => (axisOn ? { title: 'cell_type', kind: 'grouping', recipe: () => axisRecipe, shape: GROUPING } : null) };
// a count plot is a source of groups itself; its groups are not this test's (source() leaves it to C2a)
const counts = { getId: () => 'cell-count-C', getType: () => 'cell-count', getTitle: () => 'Cell Count Plot 1', getConfig: () => ({}),
    groupSource: () => null };
const PANELS = { 'cell-gene-P': plot, 'cell-count-C': counts };
globalThis.PanelManager = {
    getPanel: (id) => PANELS[id] || null, getActivePanels: () => Object.values(PANELS), getAllPanels: () => Object.values(PANELS)
};

async function until(check, what) {
    for (let i = 0; i < 400; i++) {
        if (check()) return;
        await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`timed out: ${what}`);
}

const watch = (id) => G.groupSources().sources.watch(id, { consumer: { kind: 'plot', role: 'axis', panelId: 'cell-gene-P' }, option: {},
    visible: () => true, onChange() {} });

test('the prefix is the one the plot names its axis by', () => {
    assert.equal(G.AXIS_PREFIX, 'axis:');
});

test('an obs column of a plot is a source of groups: one factor, asked of the route', async () => {
    const h = watch('axis:cell-gene-P');
    await until(() => h.read().state === 'ready', 'the axis groups');
    const sent = asked.filter((b) => !b.estimate_only);
    assert.deepEqual(sent[sent.length - 1].partitionings, [{ source: { type: 'obs', key: 'cell_type' } }]);
    assert.deepEqual(h.read().values.reply.groups.map((g) => g.n), [1, 2]);
    h.release();
});

test('off(id): an axis follows its owner, a count plot its own type, a grouping Cell Grouping', async () => {
    axisOn = false;
    try {
        policyValues = { 'panel.cell-grouping.enabled': false };
        await Policy.load();
        assert.equal(Policy.panelEnabled('cell-grouping'), false);
        const axis = watch('axis:cell-gene-P');
        assert.equal(axis.read().state, 'deleted', 'a plot with no obs axis now: gone, not off');
        const grouping = watch('cell-grouping-gone');
        assert.equal(grouping.read().state, 'off', 'a grouping id still follows Cell Grouping');
        const count = watch('cell-count-C');
        assert.equal(count.read().state, 'deleted', 'a count plot does not follow Cell Grouping');
        axis.release();
        grouping.release();
        count.release();

        policyValues = { 'panel.cell-count.enabled': false };
        await Policy.load();
        const countOff = watch('cell-count-C');
        assert.equal(countOff.read().state, 'off', 'a count plot follows its own type');
        countOff.release();
        const axisOn2 = watch('axis:cell-gene-P');
        assert.equal(axisOn2.read().state, 'deleted', 'Cell Count Plot turned off leaves a Cell-Gene Plot alone');
        axisOn2.release();

        policyValues = { 'panel.cell-gene.enabled': false };
        await Policy.load();
        const off = watch('axis:cell-gene-P');
        assert.equal(off.read().state, 'off', 'the plot\'s own type turned off');
        off.release();
        const nobody = watch('axis:cell-gene-nobody');
        assert.equal(nobody.read().state, 'deleted', 'an axis whose plot is gone is gone');
        nobody.release();
    } finally {
        axisOn = true;
        policyValues = {};
        await Policy.load();
    }
});
