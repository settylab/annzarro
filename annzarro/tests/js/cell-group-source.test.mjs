/**
 * The `cell-group` provider (static/js/utils/cell-group-source.js, G8a): a Cell Grouping as a categorical source of a
 * Cell Plot's colour, x, y, z and hover (CAT-1, CAT-2, CAT-5, CAT-8, SHR-35 to SHR-38, GRP-17).
 *
 * - The provider contract of F3c-2: valueType 'categorical', no large axes yet (G8b), `load` with codes, MISSING, the
 *   group names in group order and their colours (SHR-11); past 64 groups `rankOf` by group order, and the large
 *   form ranked with `groupNames`; hover {group, options, valueOf, parse, label}.
 * - The key list (groupings open and closed, a deleted one kept, New grouping… last), the notices in a grouping's words,
 *   and the plot provider's actions, whose `available` and `run` agree in every state.
 * - The page's own binding over a fake cell_groups route: a load reads the codes through the page's group sources and
 *   names the setting by the grouping's title; a second read of the same reply does no work that grows with groups.
 *
 * This file imports the provider FIRST, before anything that reaches panels/cell-grouping/factors.js: the two are on
 * an import cycle (through utils/group-host.js), and the type must be readable whichever module the page loads first.
 *
 * Run:  node --test annzarro/tests/js/cell-group-source.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const CG = await import('../../../static/js/utils/cell-group-source.js');
const { DataManager } = await import('../../../static/js/data-manager.js');
const R = await import('../../../static/js/utils/source-registry.js');
const F = await import('../../../static/js/panels/cell-grouping/factors.js');
const A = await import('../../../static/js/utils/source-actions.js');
const PR = await import('../../../static/js/utils/panel-references.js');
const { generateDiscreteColors, groupColours: colourGroups } = await import('../../../static/js/panels/plot-utilities/colors.js');
const { ledger } = await import('../../../static/js/utils/memory-guard-ui.js');

// ------------------------------------------------------------------------------------------------ the page's fakes

const CELLS = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];
Object.assign(DataManager, {
    getCurrentDataset: () => 'd.zarr', getCells: () => CELLS, getSubsetParam: () => null, getGenes: () => [], isDatasetLoaded: () => false
});

const recipeOf = (keys) => ({ version: 1, partitionings: keys.map((key) => ({ source: { type: 'obs', key } })) });
function grouping(id, title, recipe) {
    const g = { id, title, recipe };
    return Object.assign(g, { getId: () => g.id, getType: () => 'cell-grouping', getTitle: () => g.title, getRecipe: () => g.recipe,
        getConfig: () => ({ title: g.title, ...g.recipe }) });
}
const G1 = grouping('cell-grouping-1', 'Cell type', recipeOf(['cell_type']));
const G2 = grouping('cell-grouping-2', 'Closed one', recipeOf(['condition']));
const EMPTY = grouping('cell-grouping-3', 'Grouping 3', { version: 1, partitionings: [] });
const plotConfig = {};
const PLOT = { getId: () => 'cell-plot-1', getType: () => 'cell-plot', getTitle: () => 'Cell Plot 1', getConfig: () => plotConfig };
const made = [];
let all = [G1, G2, EMPTY, PLOT];
globalThis.PanelManager = {
    getPanel: (id) => all.find((p) => p.getId() === id) || null,
    getActivePanels: () => all.filter((p) => p !== G2),
    getAllPanels: () => all,
    reopenClosedPanel: (id, opts) => { made.push(['reopen', id, opts]); return all.find((p) => p.getId() === id) || null; },
    createPanelNextTo: (type, nextTo) => { made.push(['create', type, nextTo]); return grouping('cell-grouping-9', 'Grouping 4', { version: 1, partitionings: [] }); }
};

// ------------------------------------------------------------------------------------------------ a fake route

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

/** cell_type: c0 B, c1 T, c2 T, c3 none (a level left out), c4 B, c5 NK. */
const CODES = new Uint8Array([0, 1, 1, 255, 0, 2]);
const RESULT = { type: 'result', version: 1, shape: 'grouping', n_shown: 6, n_grouped: 5,
    partitionings: [{ kind: 'categorical', levels: [{ id: 'c:B cell', n: 2 }, { id: 'c:T cell', n: 2 }, { id: 'c:NK cell', n: 1 }] }],
    groups: [{ key: ['c:B cell'], n: 2 }, { key: ['c:T cell'], n: 2 }, { key: ['c:NK cell'], n: 1 }], features: [], measures: [],
    blocks: [{ name: 'codes', dtype: 'uint8', length: 6 }] };

const asked = [];
globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    asked.push(body);
    if (body.estimate_only) return json({ estimate: { seconds: 0.1, tier: 'live', lane: 'light' } });
    return streamed(cat(line({ type: 'start', codes: 'miss', lane: 'light', entries_total: 6, queue: { ahead: 0, sharing: 0 } }), line(RESULT), CODES));
};

async function until(fn, what) {
    for (let i = 0; i < 400; i++) {
        if (fn()) return;
        await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`timed out: ${what}`);
}

/** A load once the groups are there: each attempt before then is refused with what the plot would say. */
async function loadReady(p, setting, opts) {
    for (let i = 0; i < 400; i++) {
        try {
            return await p.load(setting, opts);
        } catch (error) {
            if (error.name !== 'SourceUnavailable') throw error;
        }
        await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('timed out: the series');
}

const host = (panel = 'cell-plot-1') => ({ id: `plot-container-${panel}`, isConnected: true, dataset: {} });
const provider = () => R.getSource(CG.GROUP_TYPE);

// ------------------------------------------------------------------------------------------------ the type

test('the type is exported by the provider and is the one the grouping panel names (one literal, here)', () => {
    assert.equal(CG.GROUP_TYPE, 'cell-group');
    assert.equal(CG.cellGroupType(), CG.GROUP_TYPE);
    assert.equal(F.GROUP_SOURCE, CG.GROUP_TYPE, "a factor's source type is the provider's");
    assert.ok(F.PANEL_SOURCES.includes(CG.GROUP_TYPE));
});

test('the provider is registered as a categorical cell source of a Cell Plot, after gene-score (CAT-1)', () => {
    const p = provider();
    assert.ok(p, 'registered');
    assert.equal(p.valueType, 'categorical');
    assert.equal(p.entity, 'cells');
    assert.deepEqual(p.consumers, ['cell-plot']);
    assert.deepEqual(p.axes, ['x', 'y', 'z', 'color', 'hover']);
    assert.deepEqual(p.largeAxes, [], 'large-plot mode is G8b\'s');
    assert.equal(p.subKeyMenu, undefined, 'no third select');
    assert.equal(p.defaultSub, '');
    assert.equal(p.alsoListedUnder, 'obs', 'listed under obs too (UX 5)');
    assert.equal(p.alsoListedGroup, 'Groupings');
    const types = R.sourcesFor('cell-plot', ['color']).map((s) => s.type);
    assert.ok(types.indexOf('cell-group') > types.indexOf('gene-score') && types.indexOf('gene-score') >= 0, types.join(','));
    assert.deepEqual(R.sourcesFor('gene-plot', ['color']).filter((s) => s.type === CG.GROUP_TYPE), [], 'not a Gene Plot source');
});

// ------------------------------------------------------------------------------------------------ the key list

test('the key list: every grouping by its title, open or closed, a deleted one kept and marked, New grouping… last', () => {
    const p = provider();
    const list = p.entities();
    assert.deepEqual(list.map((e) => [e.id, e.title, e.open]), [['cell-grouping-1', 'Cell type', true],
        ['cell-grouping-2', 'Closed one', false], ['cell-grouping-3', 'Grouping 3', true]]);
    assert.deepEqual(p.keyEntries(list, { type: 'cell-group', key: 'cell-grouping-1' }), [
        { value: 'cell-grouping-1', text: 'Cell type' }, { value: 'cell-grouping-2', text: 'Closed one' },
        { value: 'cell-grouping-3', text: 'Grouping 3' }, { value: CG.NEW_GROUPING, text: 'New grouping…' }]);
    const gone = p.keyEntries(list, { type: 'cell-group', key: 'cell-grouping-7', label: 'Old grouping' });
    assert.deepEqual(gone.slice(-2), [{ value: 'cell-grouping-7', text: 'Old grouping (deleted)' }, { value: CG.NEW_GROUPING, text: 'New grouping…' }]);
    assert.deepEqual(p.keyEntries([], { type: 'cell-group', key: '' }), [{ value: '', text: 'No groupings yet' }, { value: CG.NEW_GROUPING, text: 'New grouping…' }]);
    // a key left over from another type is not a deleted grouping
    assert.equal(p.keyEntries(list, { type: 'cell-group', key: 'X_umap' }).some((o) => /deleted/.test(o.text)), false);
});

test('New grouping… makes a grouping beside the plot (GRP-17)', () => {
    made.length = 0;
    const p = provider();
    assert.equal(p.newEntity.value, CG.NEW_GROUPING);
    const panel = p.newEntity.run('cell-plot-1');
    assert.equal(panel.getId(), 'cell-grouping-9');
    assert.deepEqual(made, [['create', 'cell-grouping', 'cell-plot-1']]);
});

test('Open grouping reopens a closed grouping beside the plot, and a missing one opens nothing (GRP-17)', () => {
    made.length = 0;
    assert.equal(CG.openGrouping('cell-grouping-2', 'cell-plot-1'), G2);
    assert.deepEqual(made, [['reopen', 'cell-grouping-2', { nextTo: 'cell-plot-1' }]]);
    assert.equal(CG.openGrouping('cell-grouping-7', 'cell-plot-1'), null);
});

// ------------------------------------------------------------------------------------------------ the series

const values = (codes, groups, partitionings = [{ kind: 'categorical' }]) => ({ codes, reply: { n_shown: codes.length, groups, partitionings } });
const groupsOf = (n) => Array.from({ length: n }, (_, i) => ({ key: [`c:g${i}`], n: 1 }));
const namesOf = (n) => Array.from({ length: n }, (_, i) => `g${i}`);

test('a series: the codes as they came, MISSING by their width, the names in group order, colours in group order (CAT-2, SHR-11)', () => {
    const v = values(CODES, RESULT.groups);
    const s = CG.groupSeries(v, ['B cell', 'T cell', 'NK cell']);
    assert.equal(s.type, 'categorical');
    assert.equal(s.codes, CODES, 'not copied');
    assert.equal(s.MISSING, 255);
    assert.deepEqual(s.categories, ['B cell', 'T cell', 'NK cell']);
    assert.deepEqual(s.colours, generateDiscreteColors(3), "the app's palette in group order: a plot coloured by the column matches");
    assert.equal(s.rankOf, null);
    assert.equal(s.ranked, false);
    const wide = CG.groupSeries(values(new Uint16Array([0, 65535, 299]), groupsOf(300)), namesOf(300));
    assert.equal(wide.MISSING, 65535, '2 bytes past 255 groups (CAT-4)');
});

test("a grouping of one categorical factor takes that column's colours (SHR-11)", () => {
    const own = { kind: 'categorical', colors: { 'c:B cell': '#111111', 'c:T cell': '#222222', 'c:NK cell': '#333333' } };
    const s = CG.groupSeries(values(CODES, RESULT.groups, [own]), ['B cell', 'T cell', 'NK cell']);
    assert.deepEqual(s.colours, ['#111111', '#222222', '#333333']);
});

test('past 64 groups: every group ranked by its place in group order, so its colour is the colour-group rule of the grouping (SHR-11)', () => {
    const n = 150;
    const names = namesOf(n);
    const s = CG.groupSeries(values(new Uint8Array([0, 149, 64, 255]), groupsOf(n)), names);
    assert.equal(s.colours, null, 'colour groups take the palette, not one colour per group');
    assert.ok(s.rankOf instanceof Map);
    assert.equal(s.rankOf.size, n);
    for (const i of [0, 1, 63, 64, 149]) assert.equal(s.rankOf.get(names[i]), i);
    // the colour a plot gives rank r is colour group r mod 64: the grouping's own colours (cell-grouping.js groupColours)
    assert.deepEqual(CG.groupingColours(values(new Uint8Array(1), groupsOf(n)).reply).slice(60, 70),
        colourGroups(64).concat(colourGroups(64)).slice(60, 70));
});

test('the large form: the codes as they are, and past 64 groups ranked with the name of each colour group', () => {
    const small = CG.groupLargeSeries(values(CODES, RESULT.groups), ['B cell', 'T cell', 'NK cell']);
    assert.deepEqual(Object.keys(small).sort(), ['MISSING', 'categories', 'codes', 'colours', 'type']);
    assert.equal(small.codes, CODES);
    const n = 130;
    const big = CG.groupLargeSeries(values(new Uint8Array([0, 129]), groupsOf(n)), namesOf(n));
    assert.equal(big.ranked, true, 'a group code is its rank in group order already: nothing is copied');
    assert.equal(big.groupNames.length, 64);
    assert.equal(big.groupNames[0], 'g0, g64, g128');
    assert.equal(big.groupNames[2], 'g2, g66');
    assert.equal(big.groupNames[63], 'g63, g127');
    assert.deepEqual(big.categories, []);
});

test('a series is made once per reply and names: a repaint does no work that grows with the groups', () => {
    const n = 1500;
    const v = values(new Uint16Array(10), groupsOf(n));
    const names = namesOf(n);
    const first = CG.groupSeries(v, names);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 2000; i++) assert.equal(CG.groupSeries(v, names).categories, first.categories);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.equal(CG.groupSeries(v, names).rankOf, first.rankOf);
    assert.ok(ms < 200, `2,000 reads of a 1,500-group series took ${ms.toFixed(1)} ms`);
});

// ------------------------------------------------------------------------------------------------ hover

test('hover: its own group, one entry per grouping, a deleted one kept, valueOf and parse agree, the line names the title (CAT-5)', () => {
    const h = provider().hover;
    assert.equal(h.group, 'Groupings');
    assert.deepEqual(h.options([]), [{ value: 'cell-group:cell-grouping-1', label: 'Cell type' },
        { value: 'cell-group:cell-grouping-2', label: 'Closed one' }, { value: 'cell-group:cell-grouping-3', label: 'Grouping 3' }]);
    assert.deepEqual(h.options(['cell-group:cell-grouping-7']).slice(-1), [{ value: 'cell-group:cell-grouping-7', label: 'cell-grouping-7 (deleted)' }]);
    const setting = { type: 'cell-group', key: 'cell-grouping-1' };
    assert.ok(h.valueOf(setting).startsWith('cell-group:'));
    assert.deepEqual(h.parse(h.valueOf(setting)), { key: 'cell-grouping-1' });
    assert.equal(h.label(setting), 'Cell type');
    assert.equal(h.label({ type: 'cell-group', key: 'cell-grouping-7', label: 'Old grouping' }), 'Old grouping', 'a deleted one by its last title');
});

test('a hover line says "not in any group" for a cell in none, never NA', () => {
    const s = CG.groupSeries(values(CODES, RESULT.groups), ['B cell', 'T cell', 'NK cell'], { hover: true });
    assert.deepEqual(s.values, ['B cell', 'T cell', 'T cell', 'not in any group', 'B cell', 'NK cell']);
    assert.equal(CG.groupSeries(values(CODES, RESULT.groups), ['B cell', 'T cell', 'NK cell']).values, undefined, 'colour and axes: missing');
});

// ------------------------------------------------------------------------------------------------ notices

test("the notices say a grouping's words (SHR-35, UX 5)", () => {
    const say = (snap, role = 'colour') => CG.describeGrouping({ title: 'G1', ...snap }, { role });
    const open = ['score-open', 'Open grouping'];
    assert.equal(say({ state: 'computing' }).tag.text, 'Grouping…');
    assert.equal(say({ state: 'computing', progress: { done: 3, total: 9 } }).headline, "Computing 'G1': 3 of 9 values. This plot has no color.");
    const ask = say({ state: 'awaiting', estimate: { seconds: 120 } });
    assert.equal(ask.tag.text, 'Grouping not computed');
    assert.equal(ask.headline, "'G1' will take about 2 minutes. This plot has no color.");
    assert.deepEqual(ask.actions, [['score-compute', 'Compute'], ['score-choose', 'Choose another']]);
    const refused = say({ state: 'refused', message: '6,840 groups: a grouping holds up to 2,000.' }, 'x');
    assert.equal(refused.tag.text, 'Grouping refused');
    assert.deepEqual(refused.actions, [open, ['score-choose', 'Choose another']]);
    const deleted = say({ state: 'deleted' });
    assert.equal(deleted.tag.text, 'Grouping deleted');
    assert.equal(deleted.headline, "Grouping 'G1' was deleted.");
    const held = say({ state: 'ready', held: { edits: 2, seconds: 40 } });
    assert.equal(held.headline, "Showing the previous 'G1'. 2 changes are not applied. About 40 seconds.");
    assert.deepEqual(held.actions, [['score-update', 'Update grouping']]);
    assert.equal(say({ state: 'updating' }).headline, "Showing the previous 'G1'. Updating.");
    assert.equal(say({ state: 'building', table: 'cell-grouping-1', gate: { state: 'building' } }, 'x').headline,
        "Building 'Cell type' to find its cells, then grouping them.");
    const cycle = say({ state: 'cycle', cycle: ['G1', 'G2', 'G1'], cycleKinds: ['grouping', 'grouping', 'grouping'] });
    assert.equal(cycle.headline, "'G1' and 'G2' depend on each other. This plot has no color.");
    assert.equal(cycle.tag.text, 'Circular groupings');
    assert.deepEqual(cycle.actions, [open, ['score-choose', 'Choose another']]);
    // the group sources name each panel of the ring once
    assert.equal(say({ state: 'cycle', cycle: ['G1', 'G2'], cycleKinds: ['grouping', 'grouping'] }).headline,
        "'G1' and 'G2' depend on each other. This plot has no color.");
    assert.equal(say({ state: 'cycle', cycle: ['G1', 'Table 2', 'G3'], cycleKinds: ['grouping', 'table', 'grouping'] }).headline,
        "'G1', 'Table 2', 'G3' depend on each other in a circle. This plot has no color.");
    const empty = say({ state: 'nofactors' }, 'x');
    assert.equal(empty.headline, "'G1' has no factors yet.");
    assert.deepEqual(empty.actions, [open, ['score-choose', 'Choose another']]);
    assert.equal(say({ state: 'notcells' }).headline, 'Groupings are a cell source; not available in a Gene Plot.');
    assert.equal(say({ state: 'off' }).headline, 'Cell Grouping is turned off on this server.');
    assert.equal(say({ state: 'ready' }), null);
    for (const state of ['computing', 'awaiting', 'refused', 'deleted', 'cycle', 'failed', 'cancelled', 'queued', 'building', 'ask', 'nofactors']) {
        const n = say({ state, cycle: ['G1', 'G2', 'G1'], estimate: { seconds: 9 } });
        assert.doesNotMatch(`${n.headline} ${n.text} ${n.tag.text}`, /score|signature|gene|colour|partitioning|cluster/i, state);
    }
});

// ------------------------------------------------------------------------------------------------ actions

/** The contract, as source-actions.test.mjs holds it: available() and run() agree for every action and host. */
function checkContract(registry, hosts, spies) {
    for (const h of hosts) {
        for (const name of A.actions.known) {
            const before = spies.map((s) => s.calls);
            const available = registry.available(name, h);
            assert.deepEqual(spies.map((s) => s.calls), before, `${name}: asking changes nothing`);
            assert.equal(registry.run(name, h), available, `${name} on ${h.name}`);
            if (!available) assert.deepEqual(spies.map((s) => s.calls), before, `${name} on ${h.name}: unavailable does nothing`);
        }
    }
}

test("the plot provider's actions: every action of every state of its host agrees with itself", () => {
    const spy = { calls: 0 };
    const tick = () => { spy.calls++; };
    const handle = { compute: tick, cancel: tick, retry: tick };
    const rec = (groupId) => ({ groupId, role: 'color', handle });
    const registry = A.actions.fresh();
    registry.register(CG.createPlotGroupActions({
        shownRecord: (h) => h.rec, recordsOf: (h) => new Map(h.rec ? [['color', h.rec]] : []),
        groupingPanel: (id) => (id === 'cell-grouping-1' ? G1 : null), update: tick, openGrouping: tick,
        chooser: (h) => (h.chooser ? { focus: tick } : null), panelIdOf: () => 'cell-plot-1'
    }));
    const hosts = [{ name: 'none' }, { name: 'live', rec: rec('cell-grouping-1'), chooser: true },
        { name: 'gone', rec: rec('cell-grouping-7') }, { name: 'no chooser', rec: rec('cell-grouping-1') }];
    checkContract(registry, hosts, [spy]);
    assert.equal(registry.available('score-open', hosts[2]), false, 'a deleted grouping cannot be opened');
    assert.equal(registry.available('score-offer', hosts[1]), false, 'a grouping offers nothing');
    assert.equal(registry.available('score-open', hosts[1]), true);
});

test("the page registers the grouping's plot provider beside the score's", () => {
    assert.ok(A.actions.providerIds().includes('plot-group'));
    assert.ok(A.actions.providerIds().includes('plot-score'));
});

// ------------------------------------------------------------------------------------------------ references (CAT-9)

test("a plot's colour, axis and hover keys of a grouping follow a remap", () => {
    const cfg = { color: { type: 'cell-group', key: 'cell-grouping-1' }, x: { type: 'cell-group', key: 'cell-grouping-1' },
        hoverInfo: [{ type: 'cell-group', key: 'cell-grouping-1' }] };
    PR.remapReferences([cfg], { 'cell-grouping-1': 'cell-grouping-5' });
    assert.equal(cfg.color.key, 'cell-grouping-5');
    assert.equal(cfg.x.key, 'cell-grouping-5');
    assert.equal(cfg.hoverInfo[0].key, 'cell-grouping-5');
});

// ------------------------------------------------------------------------------------------------ the page's binding

test('a load reads the codes through the page group sources and names the setting by its title (CAT-8)', async () => {
    asked.length = 0;
    const h = host();
    const setting = { type: 'cell-group', key: 'cell-grouping-1', column: '', labelFull: 'left over\nfrom a score' };
    plotConfig.color = setting;
    const p = provider();
    await assert.rejects(p.load(setting, { host: h, role: 'color', axis: null, expected: 6, unit: 'cells' }),
        (e) => e.name === 'SourceUnavailable' && e.type === 'cell-group');
    await until(() => asked.some((b) => !b.estimate_only), 'the request');
    const got = await loadReady(p, setting, { host: h, role: 'color', axis: null, expected: 6, unit: 'cells' });
    assert.equal(got.type, 'categorical');
    assert.deepEqual(Array.from(got.codes), Array.from(CODES));
    assert.deepEqual(got.categories, ['B cell', 'T cell', 'NK cell']);
    assert.equal(setting.label, 'Cell type');
    assert.equal(setting.labelFull, undefined, "a title of one line: nothing left over from another source's");
    const request = asked.find((b) => !b.estimate_only);
    assert.equal(request.want.codes, true, 'a plot asks for the codes');
    assert.ok(ledger.heldBytes() >= CODES.length, 'the codes are on the memory guard ledger (CAT-4)');
    // the hover's line: values with the words for a cell in none
    plotConfig.hoverInfo = [{ type: 'cell-group', key: 'cell-grouping-1' }];
    const hover = await p.load(plotConfig.hoverInfo[0], { host: h, role: 'hover:cell-grouping-1::', axis: null, expected: 6, unit: 'cells' });
    assert.equal(hover.values[3], 'not in any group');
    assert.equal(asked.filter((b) => !b.estimate_only).length, 1, 'colour and hover share one request');
    CG.releaseGroupHost(h);
});

test('an empty grouping asks nothing of the server and says it has no factors', async () => {
    asked.length = 0;
    const h = host('cell-plot-2');
    const setting = { type: 'cell-group', key: 'cell-grouping-3' };
    await assert.rejects(provider().load(setting, { host: h, role: 'x', axis: 'x', expected: 6, unit: 'cells' }),
        (e) => e.name === 'SourceUnavailable' && e.notice.state === 'nofactors');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(asked.length, 0, 'nothing asked');
    CG.releaseGroupHost(h);
});

test('a Gene Plot cannot take a grouping: that axis says so', async () => {
    await assert.rejects(provider().load({ type: 'cell-group', key: 'cell-grouping-1' }, { host: host('gene-plot-1'), role: 'x', axis: 'x', expected: 4, unit: 'genes' }),
        (e) => e.name === 'SourceUnavailable' && e.notice.state === 'notcells');
});
