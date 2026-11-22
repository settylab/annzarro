/**
 * The `cell-group` provider (static/js/utils/cell-group-source.js, G8a): a Cell Grouping as a categorical source of a
 * Cell Plot's colour, x, y, z and hover (CAT-1, CAT-2, CAT-5, CAT-8, SHR-35 to SHR-38, GRP-17).
 *
 * Everything is reached the way the page reaches it: the provider in the source registry, the page's action registry
 * and the page's one group binding (utils/group-host.js) over a fake cell_groups route, with fake panels.
 *
 * - The provider contract of F3c-2: valueType 'categorical', large axes: colour only (CAT-3), `load` with codes, MISSING, the
 *   group names in group order and their colours (SHR-11); past 64 groups `rankOf` by group order, and the large form
 *   ranked with `groupNames`; hover {group, options, valueOf, parse, label}.
 * - The key list (groupings open and closed, a deleted one kept, New grouping… last), the notices in a grouping's words,
 *   and the plot provider's actions, whose `available` and `run` agree in every state of a real host.
 * - A second read of the same reply does no work that grows with the groups.
 *
 * This file imports the provider FIRST, before anything that reaches panels/cell-grouping/factors.js: the two are on an
 * import cycle (through utils/group-host.js), and the type must be readable whichever module the page loads first.
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
const { Config } = await import('../../../static/js/config.js');
const { panelBuffers, GB } = await import('../../../static/js/utils/memory-guard.js');

const TYPE = 'cell-group';
const provider = () => R.getSource(TYPE);

// ------------------------------------------------------------------------------------------------ the page's fakes

const CELLS = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];
Object.assign(DataManager, {
    getCurrentDataset: () => 'd.zarr', getCells: () => CELLS, getSubsetParam: () => null, getGenes: () => [], isDatasetLoaded: () => false
});

const byColumn = (...keys) => ({ version: 1, partitionings: keys.map((key) => ({ source: { type: 'obs', key } })) });
const byGrouping = (key) => ({ version: 1, partitionings: [{ source: { type: TYPE, key } }] });
function grouping(id, title, recipe) {
    const g = { id, title, recipe };
    return Object.assign(g, { getId: () => g.id, getType: () => 'cell-grouping', getTitle: () => g.title, getRecipe: () => g.recipe,
        getConfig: () => ({ title: g.title, ...g.recipe }) });
}
const G1 = grouping('cell-grouping-1', 'Cell type', byColumn('cell_type'));
const G2 = grouping('cell-grouping-2', 'Closed one', byColumn('condition'));
const EMPTY = grouping('cell-grouping-3', 'Grouping 3', { version: 1, partitionings: [] });
const MANY = grouping('cell-grouping-4', 'Many', byColumn('many'));
const WIDE = grouping('cell-grouping-5', 'Wide', byColumn('wide'));
const OWN = grouping('cell-grouping-6', 'Coloured', byColumn('coloured'));
const BIG = grouping('cell-grouping-7', 'Too many', byColumn('too_many'));
const SLOW = grouping('cell-grouping-8', 'Slow', byColumn('slow'));
const RING_A = grouping('cell-grouping-10', 'Ring A', byGrouping('cell-grouping-11'));
const RING_B = grouping('cell-grouping-11', 'Ring B', byGrouping('cell-grouping-10'));
const GONE = grouping('cell-grouping-12', 'Soon gone', byColumn('cell_type'));
const FRESH = grouping('cell-grouping-13', 'Fresh', byColumn('batch'));
const SLOW_TOO = grouping('cell-grouping-14', 'Slow too', byColumn('slow_too'));
const ALONE = grouping('cell-grouping-15', 'Alone', byColumn('alone'));
const LARGE = grouping('cell-grouping-16', 'Large colour', byColumn('cell_type'));
const UNHELD = grouping('cell-grouping-17', 'Unheld', byColumn('cell_type'));
const plotConfigs = new Map();
const plots = new Map();
const plot = (id) => ({ getId: () => id, getType: () => 'cell-plot', getTitle: () => id,
    getConfig: () => { if (!plotConfigs.has(id)) plotConfigs.set(id, {}); return plotConfigs.get(id); } });
const made = [];
let all = [G1, G2, EMPTY, MANY, WIDE, OWN, BIG, SLOW, RING_A, RING_B, GONE, FRESH, SLOW_TOO, ALONE, LARGE, UNHELD];
function panelOf(id) {
    const found = all.find((p) => p.getId() === id);
    if (found) return found;
    if (!id || !id.startsWith('cell-plot-')) return null;
    if (!plots.has(id)) plots.set(id, plot(id));
    return plots.get(id);
}
globalThis.PanelManager = {
    getPanel: panelOf,
    getActivePanels: () => all.filter((p) => p !== G2),
    getAllPanels: () => all,
    reopenClosedPanel: (id, opts) => { made.push(['reopen', id, opts]); return panelOf(id); },
    createPanelNextTo: (type, nextTo) => { made.push(['create', type, nextTo]); return grouping('cell-grouping-9', 'Grouping 4', { version: 1, partitionings: [] }); }
};
// the page's graph of references (panels/cell-grouping.js declares a grouping's; the panel module is not loaded here)
PR.registerReferences('cell-grouping', F.groupingReferences);
PR.setReferenceHost({ panel: (id) => { const p = all.find((x) => x.getId() === id); return p ? { type: p.getType(), config: p.getConfig() } : null; },
    ids: () => all.map((p) => p.getId()) });

// ------------------------------------------------------------------------------------------------ a fake route

const enc = new TextEncoder();
const line = (obj) => enc.encode(`${JSON.stringify(obj)}\n`);
const cat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
    let at = 0;
    for (const p of parts) { out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), at); at += p.byteLength; }
    return out;
};
const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const streamed = (bytes) => ({ ok: true, status: 200, body: { getReader() {
    let sent = false;
    return { async read() { if (sent) return { done: true }; sent = true; return { done: false, value: bytes }; }, async cancel() {} };
} } });

const groupsOf = (n) => Array.from({ length: n }, (_, i) => ({ key: [`c:g${i}`], n: 1 }));
const namesOf = (n) => Array.from({ length: n }, (_, i) => `g${i}`);
const levelsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: `c:g${i}`, n: 1 }));

/** cell_type: c0 B, c1 T, c2 T, c3 in no group (a level left out), c4 B, c5 NK. */
const TYPES = ['B cell', 'T cell', 'NK cell'];
const REPLIES = {
    cell_type: { codes: new Uint8Array([0, 1, 1, 255, 0, 2]), levels: TYPES.map((t) => ({ id: `c:${t}`, n: 1 })), groups: TYPES.map((t) => ({ key: [`c:${t}`], n: 2 })) },
    coloured: { codes: new Uint8Array([0, 1, 1, 255, 0, 2]), levels: TYPES.map((t) => ({ id: `c:${t}`, n: 1 })), groups: TYPES.map((t) => ({ key: [`c:${t}`], n: 2 })),
        colors: { 'c:B cell': '#111111', 'c:T cell': '#222222', 'c:NK cell': '#333333' } },
    many: { codes: new Uint8Array([0, 149, 64, 255, 1, 2]), levels: levelsOf(150), groups: groupsOf(150) },
    wide: { codes: new Uint16Array([0, 65535, 299, 3, 4, 5]), levels: levelsOf(300), groups: groupsOf(300) }
};

const asked = [];
globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    asked.push(body);
    const key = body.partitionings && body.partitionings[0] && body.partitionings[0].source.key;
    if (body.estimate_only) return json({ estimate: String(key).startsWith('slow') ? { seconds: 120, tier: 'confirm', lane: 'heavy' } : { seconds: 0.1, tier: 'live', lane: 'light' } });
    const start = line({ type: 'start', codes: 'miss', lane: 'light', entries_total: 6, queue: { ahead: 0, sharing: 0 } });
    if (key === 'too_many') {
        return streamed(cat(start, line({ type: 'result', version: 1, shape: 'grouping', n_shown: 6, blocks: [],
            refused: { reason: 'too_many_groups', count: 6840, limit: 2000 } })));
    }
    const r = REPLIES[key] || REPLIES.cell_type;
    const part = { kind: 'categorical', levels: r.levels, ...(r.colors ? { colors: r.colors } : {}) };
    const header = { type: 'result', version: 1, shape: 'grouping', n_shown: 6, n_grouped: 5, partitionings: [part], groups: r.groups,
        features: [], measures: [], blocks: [{ name: 'codes', dtype: r.codes.BYTES_PER_ELEMENT === 1 ? 'uint8' : 'uint16', length: 6 }] };
    return streamed(cat(start, line(header), r.codes));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what) {
    for (let i = 0; i < 400; i++) {
        if (fn()) return;
        await sleep(5);
    }
    throw new Error(`timed out: ${what}`);
}

let hostCount = 0;
/** A plot's container, its plot's config holding `config`. */
function plotHost(config = {}) {
    const id = `cell-plot-${++hostCount}`;
    plotConfigs.set(id, config);
    return { id: `plot-container-${id}`, isConnected: true, dataset: {}, panelId: id };
}

const setting = (key, extra = {}) => ({ type: TYPE, key, column: '', ...extra });

const loadOf = (s, h, role = 'color') => provider().load(s, { host: h, role, axis: role === 'color' ? null : role, expected: 6, unit: 'cells' });

/** What a load says now: the series, or the SourceUnavailable it throws. */
async function attempt(s, h, role = 'color', large = false) {
    try {
        return large ? await provider().loadLarge(s, { host: h, role, expected: 6, unit: 'cells' }) : await loadOf(s, h, role);
    } catch (error) {
        if (error.name !== 'SourceUnavailable') throw error;
        return error;
    }
}

/** A load once the groups are there, or the refusal once its state is `state`. The plot's config holds the setting. */
async function settle(s, h, { role = 'color', large = false, state = null } = {}) {
    const cfg = plotConfigs.get(h.panelId);
    if (!role.startsWith('hover') && !cfg[role]) cfg[role] = s;
    let got = null;
    for (let i = 0; i < 400; i++) {
        got = await attempt(s, h, role, large);
        if (state ? got.name === 'SourceUnavailable' && got.notice.state === state : got.name !== 'SourceUnavailable') return got;
        await sleep(5);
    }
    throw new Error(`timed out: ${state || 'the series'} (last: ${got && got.notice ? got.notice.state : 'a series'})`);
}

// ------------------------------------------------------------------------------------------------ the type

test("the type is the provider's, and is the one the grouping panel names (one literal, there)", () => {
    assert.equal(CG.cellGroupType(), TYPE);
    assert.equal(provider().type, TYPE);
    assert.equal(F.GROUP_SOURCE, TYPE, "a factor's source type is the provider's");
    assert.ok(F.PANEL_SOURCES.includes(TYPE));
});

test('the provider is registered as a categorical cell source of a Cell Plot, after gene-score (CAT-1)', () => {
    const p = provider();
    assert.equal(p.valueType, 'categorical');
    assert.equal(p.entity, 'cells');
    assert.deepEqual(p.consumers, ['cell-plot']);
    assert.deepEqual(p.axes, ['x', 'y', 'z', 'color', 'hover']);
    assert.deepEqual(p.largeAxes, ['color'], 'large-plot mode draws a grouping as colour only, never as an axis (CAT-3)');
    assert.equal(p.subKeyMenu, undefined, 'no third select');
    assert.deepEqual(p.subKeys('cell-grouping-1'), []);
    assert.equal(p.defaultSub, '');
    assert.equal(p.alsoListedUnder, 'obs', 'listed under obs too (UX 5)');
    assert.equal(p.alsoListedGroup, 'Groupings');
    const types = R.sourcesFor('cell-plot', ['color']).map((s) => s.type);
    assert.ok(types.indexOf('gene-score') >= 0 && types.indexOf(TYPE) > types.indexOf('gene-score'), types.join(','));
    assert.deepEqual(R.sourcesFor('gene-plot', ['color']).filter((s) => s.type === TYPE), [], 'not a Gene Plot source');
    assert.equal(p.titleOf(setting('cell-grouping-1')), 'grouping Cell type');
});

// ------------------------------------------------------------------------------------------------ the key list

test('the key list: every grouping by its title, open or closed, a deleted one kept and marked, New grouping… last', () => {
    const p = provider();
    const list = p.entities();
    assert.deepEqual(list.slice(0, 3).map((e) => [e.id, e.title, e.open]), [['cell-grouping-1', 'Cell type', true],
        ['cell-grouping-2', 'Closed one', false], ['cell-grouping-3', 'Grouping 3', true]]);
    const NEW = p.newEntity.value;
    const two = list.slice(0, 2);
    assert.deepEqual(p.keyEntries(two, setting('cell-grouping-1')), [
        { value: 'cell-grouping-1', text: 'Cell type' }, { value: 'cell-grouping-2', text: 'Closed one' }, { value: NEW, text: 'New grouping…' }]);
    assert.deepEqual(p.keyEntries(two, setting('cell-grouping-70', { label: 'Old grouping' })).slice(-2),
        [{ value: 'cell-grouping-70', text: 'Old grouping (deleted)' }, { value: NEW, text: 'New grouping…' }]);
    assert.deepEqual(p.keyEntries([], setting('')), [{ value: '', text: 'No groupings yet' }, { value: NEW, text: 'New grouping…' }]);
    assert.equal(p.keyEntries(two, setting('X_umap')).some((o) => /deleted/.test(o.text)), false, 'a key left from another type is not a deleted grouping');
});

test('New grouping… makes a grouping beside the plot (GRP-17)', () => {
    made.length = 0;
    const panel = provider().newEntity.run('cell-plot-1');
    assert.equal(panel.getId(), 'cell-grouping-9');
    assert.deepEqual(made, [['create', 'cell-grouping', 'cell-plot-1']]);
});

// ------------------------------------------------------------------------------------------------ the series

test('a series: the codes as they came, MISSING by their width, the names in group order, colours in group order (CAT-2, SHR-11)', async () => {
    asked.length = 0;
    const h = plotHost();
    const s = setting('cell-grouping-1', { labelFull: 'left over\nfrom a score' });
    plotConfigs.get(h.panelId).color = s;
    const first = await attempt(s, h);
    assert.equal(first.name, 'SourceUnavailable', 'nothing yet: the plot has nothing to keep, so it is told');
    assert.equal(first.type, TYPE, "the provider's placeholder draws an axis");
    const got = await settle(s, h);
    assert.equal(got.type, 'categorical');
    assert.deepEqual(Array.from(got.codes), [0, 1, 1, 255, 0, 2]);
    assert.equal(got.MISSING, 255);
    assert.deepEqual(got.categories, TYPES);
    assert.deepEqual(got.colours, generateDiscreteColors(3), "the app's palette in group order: a plot coloured by the column matches");
    assert.equal(got.rankOf, null);
    assert.equal(got.values, undefined, 'colour and axes: a cell in no group is missing');
    assert.equal(s.label, 'Cell type', 'named by its title (CAT-8)');
    assert.equal(s.labelFull, undefined, "a title of one line: nothing left over from another source's");
    const request = asked.find((b) => !b.estimate_only);
    assert.equal(request.want.codes, true, 'a plot asks for the codes');
    assert.ok(ledger.heldBytes() >= 6, 'the codes are on the memory guard ledger (CAT-4)');
    // the plain series a regular plot draws: one label per point, null for a cell in no group
    assert.deepEqual(R.plotSeries(got).values, ['B cell', 'T cell', 'T cell', null, 'B cell', 'NK cell']);
});

test('a hover line names the group, and "not in any group" for a cell in none (CAT-5)', async () => {
    const h = plotHost();
    const s = setting('cell-grouping-1');
    plotConfigs.get(h.panelId).hoverInfo = [s];
    await settle(setting('cell-grouping-1'), h);
    asked.length = 0;
    const hover = await loadOf(s, h, 'hover:cell-grouping-1::');
    assert.deepEqual(R.plotSeries(hover).values, ['B cell', 'T cell', 'T cell', 'not in any group', 'B cell', 'NK cell']);
    assert.equal(provider().hover.label(s), 'Cell type');
    assert.equal(asked.length, 0, 'colour and hover read the groups held: no request');
});

test('2 bytes past 255 groups, with their missing value (CAT-4)', async () => {
    const got = await settle(setting('cell-grouping-5'), plotHost());
    assert.ok(got.codes instanceof Uint16Array);
    assert.equal(got.MISSING, 65535);
    assert.equal(got.categories.length, 300);
});

test("a grouping of one categorical factor takes that column's colours (SHR-11)", async () => {
    const got = await settle(setting('cell-grouping-6'), plotHost());
    assert.deepEqual(got.colours, ['#111111', '#222222', '#333333']);
});

test("past 64 groups: each group ranked by its place in group order, so its colour group is the grouping's (SHR-11)", async () => {
    const got = await settle(setting('cell-grouping-4'), plotHost());
    const names = namesOf(150);
    assert.deepEqual(got.categories, names);
    assert.equal(got.colours, null, 'colour groups take the palette, not one colour per group');
    assert.ok(got.rankOf instanceof Map);
    assert.equal(got.rankOf.size, 150);
    for (const i of [0, 1, 63, 64, 149]) assert.equal(got.rankOf.get(names[i]), i);
    // the plot gives rank r the colour group r mod 64: the grouping's own colour (cell-grouping.js groupColours)
    const palette = colourGroups(64);
    assert.equal(palette[got.rankOf.get('g70') % 64], palette[6]);
});

test('the large form: the codes as they are; past 64 groups ranked with the name of each colour group', async () => {
    const small = await settle(setting('cell-grouping-1'), plotHost(), { large: true });
    assert.deepEqual(Object.keys(small).sort(), ['MISSING', 'categories', 'codes', 'colours', 'missingLabel', 'type']);
    assert.equal(small.missingLabel, 'Not in any group', "the legend's word for a cell in no group (large mode's `NA` otherwise)");
    assert.deepEqual(small.categories, TYPES);
    const big = await settle(setting('cell-grouping-4'), plotHost(), { large: true });
    assert.equal(big.missingLabel, 'Not in any group');
    assert.equal(big.ranked, true, "a group's code is its rank in group order already: nothing is copied");
    assert.equal(big.groupNames.length, 64);
    assert.equal(big.groupNames[0], 'g0, g64, g128');
    assert.equal(big.groupNames[2], 'g2, g66, g130');
    assert.equal(big.groupNames[30], 'g30, g94');
    assert.equal(big.groupNames[63], 'g63, g127');
    assert.deepEqual(big.categories, []);
    assert.deepEqual(Array.from(big.codes), [0, 149, 64, 255, 1, 2]);
});

test('a series is made once per reply: a repaint does no work that grows with the groups', async () => {
    const h = plotHost();
    const s = setting('cell-grouping-5');
    const first = await settle(s, h);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 300; i++) {
        const again = await loadOf(s, h);
        assert.equal(again.categories, first.categories);
        assert.equal(again.colours, first.colours);
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 300, `300 reads of a 300-group series took ${ms.toFixed(1)} ms`);
});

// ------------------------------------------------------------------------------------------------ hover entries

test('the Hover picker: its own group, one entry per grouping, a deleted one kept, valueOf and parse agree', () => {
    const h = provider().hover;
    assert.equal(h.group, 'Groupings');
    const options = h.options([]);
    assert.deepEqual(options.slice(0, 2), [{ value: 'cell-group:cell-grouping-1', label: 'Cell type' },
        { value: 'cell-group:cell-grouping-2', label: 'Closed one' }]);
    assert.equal(options.length, all.length);
    assert.deepEqual(h.options(['cell-group:cell-grouping-70']).slice(-1), [{ value: 'cell-group:cell-grouping-70', label: 'cell-grouping-70 (deleted)' }]);
    const s = setting('cell-grouping-1');
    assert.ok(h.valueOf(s).startsWith(`${TYPE}:`));
    assert.deepEqual(h.parse(h.valueOf(s)), { key: 'cell-grouping-1' });
    assert.equal(h.label(setting('cell-grouping-70', { label: 'Old grouping' })), 'Old grouping', 'a deleted one by its last title');
});

// ------------------------------------------------------------------------------------------------ the states

const OPEN = ['score-open', 'Open grouping'];
const CHOOSE = ['score-choose', 'Choose another'];

test("computing, then asks first, in a grouping's words (SHR-35, UX 5)", async () => {
    const computing = (await attempt(setting('cell-grouping-13'), plotHost(), 'x')).notice;
    assert.ok(['estimating', 'computing'].includes(computing.state));
    assert.equal(computing.tag.text, 'Grouping…');
    const ask = (await settle(setting('cell-grouping-8'), plotHost(), { state: 'awaiting' })).notice;
    assert.equal(ask.tag.text, 'Grouping not computed');
    assert.equal(ask.headline, "'Slow' will take about 2 minutes. This plot has no color.");
    assert.deepEqual(ask.actions, [['score-compute', 'Compute'], CHOOSE]);
});

test('refused for its size: the figures and the way out (SHR-35)', async () => {
    const note = (await settle(setting('cell-grouping-7'), plotHost(), { role: 'x', state: 'refused' })).notice;
    assert.equal(note.headline, "'Too many' has 6,840 groups: a grouping holds up to 2,000, so it was not computed.");
    assert.equal(note.tag.text, 'Grouping refused');
    assert.deepEqual(note.actions, [OPEN, CHOOSE]);
});

test('a loop computes nothing and names the panels once each (SHR-34)', async () => {
    asked.length = 0;
    const note = (await settle(setting('cell-grouping-10'), plotHost(), { role: 'x', state: 'cycle' })).notice;
    assert.equal(note.headline, "'Ring A' and 'Ring B' depend on each other.");
    assert.equal(note.tag.text, 'Circular groupings');
    assert.deepEqual(note.actions, [OPEN, CHOOSE]);
    assert.equal(asked.length, 0);
});

test('an empty grouping asks nothing and says it has no factors', async () => {
    asked.length = 0;
    const note = (await settle(setting('cell-grouping-3'), plotHost(), { role: 'x', state: 'nofactors' })).notice;
    assert.equal(note.headline, "'Grouping 3' has no factors yet.");
    assert.deepEqual(note.actions, [OPEN, CHOOSE]);
    await sleep(30);
    assert.equal(asked.length, 0, 'nothing asked');
});

test('a deleted grouping says so by its last title and keeps the setting (SHR-38)', async () => {
    const h = plotHost();
    const s = setting('cell-grouping-12');
    await settle(s, h, { role: 'x' });
    all = all.filter((p) => p !== GONE);
    const note = (await settle(s, h, { role: 'x', state: 'deleted' })).notice;
    assert.equal(note.headline, "Grouping 'Soon gone' was deleted.");
    assert.equal(note.tag.text, 'Grouping deleted');
    assert.deepEqual(note.actions, [CHOOSE]);
    assert.equal(s.key, 'cell-grouping-12');
});

test('a Gene Plot cannot take a grouping: that axis says so', async () => {
    const got = await provider().load(setting('cell-grouping-1'), { host: plotHost(), role: 'x', axis: 'x', expected: 4, unit: 'genes' })
        .catch((e) => e);
    assert.equal(got.notice.state, 'notcells');
    assert.equal(got.notice.headline, 'Groupings are a cell source; not available in a Gene Plot.');
});

test('no notice speaks of scores, signatures, genes, partitionings or clusters', async () => {
    for (const [key, state] of [['cell-grouping-8', 'awaiting'], ['cell-grouping-7', 'refused'], ['cell-grouping-10', 'cycle'], ['cell-grouping-3', 'nofactors']]) {
        const note = (await settle(setting(key), plotHost(), { role: 'x', state })).notice;
        assert.doesNotMatch(`${note.headline} ${note.text} ${note.tag.text}`, /score|signature|gene|colour|partitioning|cluster/i, state);
    }
});

// ------------------------------------------------------------------------------------------------ actions

/** The contract, as source-actions.test.mjs holds it: available() and run() agree for every action and host. */
function checkContract(hostsList) {
    let checked = 0;
    for (const h of hostsList) {
        for (const name of A.actions.known) {
            const available = A.actions.available(name, h);
            assert.equal(typeof available, 'boolean');
            assert.equal(A.actions.run(name, h), available, `${name} on ${h.id}`);
            checked++;
        }
    }
    return checked;
}

test("the page's grouping provider: every action of every state of a real host agrees with itself", async () => {
    assert.ok(A.actions.providerIds().includes('plot-group'));
    const states = [['cell-grouping-1', null], ['cell-grouping-8', 'awaiting'], ['cell-grouping-7', 'refused'], ['cell-grouping-10', 'cycle'],
        ['cell-grouping-3', 'nofactors'], ['cell-grouping-70', 'deleted']];
    const list = [];
    for (const [key, state] of states) {
        const h = plotHost();
        await settle(setting(key), h, { role: 'x', state });
        list.push(h);
    }
    assert.equal(checkContract(list), list.length * A.actions.known.length);
    assert.equal(A.actions.available('score-open', list[list.length - 1]), false, 'a deleted grouping cannot be opened');
    assert.equal(A.actions.available('score-offer', list[2]), false, 'a grouping offers nothing');
});

test('Open grouping reopens a closed grouping beside the plot (GRP-17); Compute computes one that asks first', async () => {
    const h = plotHost();
    made.length = 0;
    await settle(setting('cell-grouping-2'), h, { role: 'x' });
    assert.equal(A.actions.available('score-open', h), true);
    A.actions.run('score-open', h);
    assert.deepEqual(made, [['reopen', 'cell-grouping-2', { nextTo: h.panelId }]]);
    const slow = plotHost();
    await settle(setting('cell-grouping-14'), slow, { role: 'x', state: 'awaiting' });
    asked.length = 0;
    assert.equal(A.actions.run('score-compute', slow), true);
    await until(() => asked.some((b) => !b.estimate_only), 'the request Compute sends');
});

// ------------------------------------------------------------------------------------------------ references (CAT-9)

test("a plot's colour, axis and hover keys of a grouping follow a remap", () => {
    const cfg = { color: setting('cell-grouping-1'), x: setting('cell-grouping-1'), hoverInfo: [setting('cell-grouping-1')] };
    PR.remapReferences([cfg], { 'cell-grouping-1': 'cell-grouping-5' });
    assert.equal(cfg.color.key, 'cell-grouping-5');
    assert.equal(cfg.x.key, 'cell-grouping-5');
    assert.equal(cfg.hoverInfo[0].key, 'cell-grouping-5');
});

// ------------------------------------------------------------------------------------------------ the shared seams

test('the legend names the cells in no group "Not in any group"; every other source keeps NA (SHR-5)', async () => {
    const got = await settle(setting('cell-grouping-1'), plotHost());
    assert.equal(R.plotSeries(got).missingLabel, 'Not in any group');
    const column = R.plotSeries({ type: 'categorical', codes: new Uint8Array([0, 255]), MISSING: 255, categories: ['a'], coverage: null });
    assert.equal(column.missingLabel, null, "another provider's series: the plot's own 'NA'");
    assert.equal(R.plotSeries({ type: 'numerical', values: [1], coverage: null }).missingLabel, null);
});

test('the obs key list lists the groupings under "Groupings"; the entry is a way to choose, never a key', () => {
    const entries = R.alsoListedEntries('obs', 'cell-plot', ['color']);
    assert.deepEqual(entries.slice(0, 2).map((e) => [e.text, e.group]), [['Cell type', 'Groupings'], ['Closed one', 'Groupings']]);
    for (const e of entries) {
        assert.ok(e.value.startsWith('\u0001'), 'no stored key or column name can look like it');
        const parsed = R.parseAlsoListed(e.value);
        assert.equal(parsed.type, TYPE);
        assert.ok(all.some((p) => p.getId() === parsed.key));
    }
    assert.equal(R.parseAlsoListed('cell_type'), null);
    assert.equal(R.parseAlsoListed('\u0001no-such-type\u0001x'), null);
    assert.deepEqual(R.alsoListedEntries('obs', 'gene-plot', ['color']), [], 'not a Gene Plot source');
    assert.deepEqual(R.alsoListedEntries('obsm', 'cell-plot', ['color']), []);
});

test('a plot is no panel\'s dependency, so no choice of a grouping in a plot can close a loop (operator decision 15)', () => {
    // a page with every kind of reference a plot, a table, a signature and a grouping can hold
    const page = new Map([
        ['cell-plot-P', { type: 'cell-plot', config: { tableFilter: 'cell-table-T', color: setting('cell-grouping-1'), x: setting('cell-grouping-2'),
            y: { type: 'gene-score', key: 'gene-signature-S', column: '' }, hoverInfo: [setting('cell-grouping-1')],
            z: { type: 'obs', key: 'c', column: '', history: { [TYPE]: { key: 'cell-grouping-2' } } } } }],
        ['cell-table-T', { type: 'cell-table', config: { tableFilter: 'cell-table-U', columns: [setting('cell-grouping-1'),
            { type: 'gene-score', key: 'gene-signature-S', column: '' }] } }],
        ['cell-table-U', { type: 'cell-table', config: { columns: [] } }],
        ['gene-table-V', { type: 'gene-table', config: { tableFilter: 'gene-signature-S', columns: [] } }],
        ['gene-signature-S', { type: 'gene-signature', config: {} }],
        ['cell-grouping-1', { type: 'cell-grouping', config: { partitionings: [{ source: { type: 'table', key: 'cell-table-T' } },
            { source: { type: 'gene-score', key: 'gene-signature-S' } }, { source: { type: TYPE, key: 'cell-grouping-2' } }] } }],
        ['cell-grouping-2', { type: 'cell-grouping', config: { partitionings: [{ source: { type: 'obs', key: 'c' } }] } }]
    ]);
    PR.setReferenceHost({ panel: (id) => page.get(id) || null, ids: () => [...page.keys()] });
    try {
        for (const id of page.keys()) assert.ok(!PR.dependsOn(id).includes('cell-plot-P'), `${id} depends on no plot`);
        assert.deepEqual(PR.usersOf('cell-plot-P'), []);
        // what a plot's colour, axis or hover may name: the entities of the providers, none of them a plot
        for (const p of R.sourcesFor('cell-plot', ['color'])) {
            for (const e of p.entities()) assert.ok(!e.id.startsWith('cell-plot-') && !e.id.startsWith('gene-plot-'), `${p.type}: ${e.id}`);
        }
        // a grouping's factors name tables, scores and groupings only
        assert.deepEqual([...F.PANEL_SOURCES].sort(), ['cell-group', 'gene-score', 'table']);
        for (const g of ['cell-grouping-1', 'cell-grouping-2']) assert.equal(PR.wouldLoop('cell-plot-P', g), false, g);
    } finally {
        PR.setReferenceHost({ panel: (id) => { const p = all.find((x) => x.getId() === id); return p ? { type: p.getType(), config: p.getConfig() } : null; },
            ids: () => all.map((p) => p.getId()) });
    }
});

test('a closed plot lets go of its groupings at once, in every provider (the codes leave the ledger)', async () => {
    const h = plotHost();
    const s = setting('cell-grouping-15');
    await settle(s, h);
    const held = ledger.heldBytes();
    R.releaseSourceHost(h);
    assert.equal(ledger.heldBytes(), held - 6, "the plot's codes, nothing else's");
    assert.equal(A.actions.available('score-choose', h), false, 'no record is left on the host');
});

// ------------------------------------------------------------------------------------------------ large plots and memory (G8b)

/** Run `fn` with the tab's buffer ceiling at `gb` (ui.memory.buffers_gb), as a small device has it. */
async function withBuffers(gb, fn) {
    const was = Config.DEFAULTS.MEMORY;
    Config.DEFAULTS.MEMORY = { ...(was || {}), buffers_gb: gb };
    try {
        return await fn();
    } finally {
        Config.DEFAULTS.MEMORY = was;
    }
}

test('large-plot mode draws a grouping as colour, never as an axis (CAT-3)', () => {
    assert.equal(R.largeAccepts(TYPE, 'color'), true);
    for (const axis of ['x', 'y', 'z']) assert.equal(R.largeAccepts(TYPE, axis), false, axis);
});

test('cost: 1 byte a cell up to 255 groups, 2 above, (CAT-4)', () => {
    const { cost } = provider();
    assert.equal(typeof cost, 'function');
    assert.deepEqual(cost({ cells: 95_600_000, groups: 6 }), { bytes: 95_600_000 });
    assert.deepEqual(cost({ cells: 95_600_000, groups: 255 }), { bytes: 95_600_000 });
    assert.deepEqual(cost({ cells: 95_600_000, groups: 256 }), { bytes: 191_200_000 });
    assert.deepEqual(cost({ cells: 1000 }), { bytes: 1000 }, 'groups not known yet: the narrow codes');
    assert.deepEqual(cost({ cells: 0, groups: 3 }), { bytes: 0 });
});

test('large: colour codes are typed and nothing is copied; a ready grouping is drawn as colour in large-plot mode', async () => {
    const got = await settle(setting('cell-grouping-1'), plotHost(), { large: true });
    assert.ok(got.codes instanceof Uint8Array);
    assert.equal(got.MISSING, 255);
    assert.deepEqual(got.categories, TYPES);
    assert.equal(got.colours.length, 3);
});

test('the guard refuses codes that do not fit BEFORE the request, in its own words, and holds nothing (CAT-4)', async () => {
    const h = plotHost();
    const s = setting('cell-grouping-16');
    plotConfigs.get(h.panelId).color = s;
    const before = { asked: asked.length, held: ledger.heldBytes() };
    const got = await withBuffers(1e-9, () => attempt(s, h, 'color', true));
    assert.equal(got.name, 'SourceUnavailable');
    assert.equal(got.notice.state, 'refused');
    assert.match(got.notice.headline + got.notice.text, /buffers/i, "the guard's wording: it names what it ran out of");
    assert.deepEqual(got.notice.actions.map((a) => a[0]), ['score-choose']);
    assert.equal(asked.length, before.asked, 'no request of any kind: not even an estimate');
    assert.equal(ledger.heldBytes(), before.held, 'nothing held');
});

test('the same grouping is drawn once the guard has room again; a draw already holding the codes asks nothing more', async () => {
    const h = plotHost();
    const s = setting('cell-grouping-16');
    const got = await settle(s, h, { large: true });
    assert.equal(got.codes.length, 6);
    const held = ledger.heldBytes();
    // a redraw of a plot that holds its codes is not a new holding: the guard is not asked again
    const again = await withBuffers(1e-9, () => attempt(s, h, 'color', true));
    assert.equal(again.name, undefined, 'still a series');
    assert.equal(ledger.heldBytes(), held);
});

test('a refusal is not a size refusal: the figures of too_many_groups stay for the route', async () => {
    const got = await settle(setting('cell-grouping-7'), plotHost(), { large: true, state: 'refused' });
    assert.match(got.notice.headline, /6,840 groups/);
});

test('the asking plot is counted once beside its codes: a large plot redrawn in place does not refuse itself (CAT-4)', async () => {
    const id = 'cell-plot-own';
    const p = { kind: 'cell-plot', n: 2_000_000, large: true, colour: 'categorical' };
    ledger.commit(id, null, ledger.reserve(id, p));
    // its redraw is under way: the ledger holds the old plot and the draw at its peak
    ledger.reserve(id, p);
    try {
        const peak = panelBuffers(p).peak;
        const mine = { id: `plot-container-${id}`, isConnected: true, dataset: {}, panelId: id };
        const other = plotHost();
        const room = (extra) => ledger.buffers({ exclude: [id] }) + peak + extra;
        const refused = async (host, s) => {
            const got = await withBuffers(room(1_000_000) / GB, () => attempt(s, host, 'color', true));
            return got.name === 'SourceUnavailable' && got.notice.state === 'refused';
        };
        const s1 = setting('cell-grouping-15');
        plotConfigs.set(id, { color: s1 });
        assert.equal(await refused(mine, s1), false, 'one copy of the plot, and a megabyte spare for 6 bytes of codes');
        R.releaseSourceHost(mine);
        const s2 = setting('cell-grouping-15');
        plotConfigs.get(other.panelId).color = s2;
        assert.equal(await refused(other, s2), true, "another plot sees the redraw's plot twice (old and new), as the ledger counts it");
    } finally {
        ledger.remove(id);
        R.releaseSourceHost({ id: `plot-container-${id}`, isConnected: true, dataset: {}, panelId: id });
    }
});

test('a second plot of a grouping whose codes are held is not refused; a plot of another grouping is (one copy fits, two do not)', async () => {
    const first = plotHost();
    await settle(setting('cell-grouping-16'), first, { large: true });
    // room for the held codes and 3 bytes more: a second copy (6 bytes) would not fit
    const tight = (ledger.buffers() + 3) / GB;
    const refused = async (key) => {
        const host = plotHost();
        const s = setting(key);
        plotConfigs.get(host.panelId).color = s;
        const got = await withBuffers(tight, () => attempt(s, host, 'color', true));
        return got.name === 'SourceUnavailable' && got.notice.state === 'refused';
    };
    assert.equal(await refused('cell-grouping-16'), false, 'the same codes are shared: nothing more to hold');
    assert.equal(await refused('cell-grouping-17'), true, 'other codes would be a second copy');
});
