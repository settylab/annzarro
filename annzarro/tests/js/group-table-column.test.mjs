/**
 * A Cell Grouping as a column of a Cell Table (G10: CAT-6, CAT-7, SHR-34, operator decisions 15 and 18): the table half of
 * the `cell-group` provider, static/js/panels/cell-grouping/table-column.js, over fakes of the page's group sources and
 * panels. The column reads the grouping's codes as a table consumer, names each group as the grouping does, sorts in
 * group order, names the cells in no group, lists the groups in a filter's "Equals", says its states in a grouping's
 * words, and its menu marks a grouping that would close a loop through this table. The page's half (a real table on
 * the real route) is annzarro/tests/browser/test_group_table_column.py.
 *
 * Run:  node --test annzarro/tests/js/group-table-column.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// the provider first: it and panels/cell-grouping/factors.js are on an import cycle (see cell-group-source.test.mjs)
const CG = await import('../../../static/js/utils/cell-group-source.js');
const { getSource, sourcesFor } = await import('../../../static/js/utils/source-registry.js');
const { tableProviders } = await import('../../../static/js/utils/table-source.js');
const { createGroupTable } = await import('../../../static/js/panels/cell-grouping/table-column.js');
const { setReferenceHost, registerReferences } = await import('../../../static/js/utils/panel-references.js');
const { groupingReferences } = await import('../../../static/js/panels/cell-grouping/factors.js');
const { columnView, filterGate, describeHeldRows, dropConditions } = await import('../../../static/js/utils/score-column.js');
const { actions: pageActions } = await import('../../../static/js/utils/source-actions.js');

// a grouping's references as its panel module declares them (panels/cell-grouping.js needs the page)
registerReferences('cell-grouping', groupingReferences);

const GA = 'cell-grouping-A';
const TA = 'cell-table-T';
const TB = 'cell-table-U';
const NAMES = ['B cell', 'T cell', 'NK cell'];

/** A fake of the page's group sources: one watch per call, the snapshot set by the test. */
function fakeSources() {
    const watches = [];
    const sources = {
        watches,
        names: 0,
        updated: [],
        visibility: 0,
        watch(id, spec) {
            const w = { id, spec, snap: { state: 'computing', title: 'Grouping 1' }, released: false };
            watches.push(w);
            return {
                read: () => w.snap,
                release: () => { w.released = true; },
                sharers: () => 2,
                compute: () => true,
                retry: () => false,
                cancel: () => true
            };
        },
        namesOf: (id, reply) => { sources.names += 1; return reply.names; },
        update: (id) => { sources.updated.push(id); return true; },
        visibilityChanged: () => { sources.visibility += 1; }
    };
    return sources;
}

function readySnap(n = 12, groups = NAMES, width = 1) {
    const codes = width === 1 ? new Uint8Array(n) : new Uint16Array(n);
    const missing = width === 1 ? 0xff : 0xffff;
    for (let i = 0; i < n; i++) codes[i] = i % 4 === 3 ? missing : i % groups.length;
    return { state: 'ready', title: 'Grouping 1', key: 'k1', values: { codes, reply: { names: groups, n_shown: n } } };
}

const panels = new Map([[GA, { getTitle: () => 'Grouping 1' }]]);

function makeHalf(sources = fakeSources(), extra = {}) {
    const opened = [];
    const half = createGroupTable({
        sources: () => sources,
        titleOf: (setting) => (panels.get(setting.key) ? panels.get(setting.key).getTitle() : (setting.label || setting.key)),
        groupingPanel: (id) => panels.get(id) || null,
        describe: (snap, ctx) => ({ state: snap.state, headline: `${snap.title}: ${snap.state}`, text: '', role: ctx.role,
            actions: [['score-open', 'Open grouping'], ['score-choose', 'Choose another']] }),
        open: (id, hostId) => { opened.push([id, hostId]); return { id }; },
        missingOf: (codes) => (codes.BYTES_PER_ELEMENT === 1 ? 0xff : 0xffff),
        ...extra
    });
    return { half, sources, opened };
}

const COLUMN = { type: 'cell-group', key: GA, column: '' };

test('the cell-group provider gives Cell Tables a column (CAT-6)', () => {
    const provider = getSource(CG.cellGroupType());
    assert.ok(provider.consumers.includes('cell-table'));
    assert.ok(provider.axes.includes('column'));
    assert.ok(provider.table, 'a table half');
    assert.equal(provider.table.tab, 'Cell Grouping', 'the tab names the source in words, never its type id');
    assert.equal(provider.label, 'Cell Grouping', 'and so does every menu of source types');
    assert.ok(sourcesFor('cell-table', ['column']).includes(provider));
    assert.ok(tableProviders().includes(provider), 'a tab in the column chooser');
    assert.ok(!sourcesFor('gene-table', ['column']).includes(provider), 'not a gene table\'s');
});

test('the tab names the source in words, and a filter lists the groups', () => {
    const { half } = makeHalf();
    assert.equal(half.tab, 'Cell Grouping');
    assert.equal(half.listsCategories, true);
    assert.equal(half.chooser.layerOf(COLUMN), '');
});

test('a column watches the grouping as a table, for its codes', () => {
    const { half, sources } = makeHalf();
    const visible = () => true;
    half.watch(COLUMN, { host: TA, visible, onChange: () => {} });
    assert.equal(sources.watches.length, 1);
    const { id, spec } = sources.watches[0];
    assert.equal(id, GA);
    assert.deepEqual(spec.consumer, { kind: 'table', role: 'column', panelId: TA, host: TA });
    assert.deepEqual(spec.option, { codes: true });
    assert.equal(spec.visible, visible);
});

test('a ready grouping is a categorical series: its codes, the group names, group order and the cells in no group', () => {
    const { half, sources } = makeHalf();
    const h = half.watch(COLUMN, { host: TA, visible: () => true, onChange: () => {} });
    const snap = readySnap();
    sources.watches[0].snap = snap;
    const got = h.read();
    assert.equal(got.state, 'ready');
    assert.equal(got.values, null, 'never read as numbers (score-column.js seriesOf reads values first)');
    assert.equal(got.codes, snap.values.codes, 'the codes as held, never copied');
    assert.deepEqual(got.categories, NAMES);
    assert.equal(got.MISSING, 0xff);
    assert.deepEqual(got.rank, [0, 1, 2], 'a group sorts by its place in group order (CAT-6)');
    assert.equal(got.missingLabel, 'Not in any group');
    assert.deepEqual(got.words, { the: 'the groups', none: 'no groups', ready: 'the groups are ready' });
    // two-byte codes past 255 groups
    const wide = readySnap(8, Array.from({ length: 300 }, (_, i) => `g${i}`), 2);
    sources.watches[0].snap = wide;
    const w = h.read();
    assert.equal(w.MISSING, 0xffff);
    assert.equal(w.rank.length, 300);
    assert.equal(w.rank[299], 299);
});

test('a grouping with no groups yet has no series, in every state, and keeps its state and fields', () => {
    const { half, sources } = makeHalf();
    const h = half.watch(COLUMN, { host: TA, visible: () => true, onChange: () => {} });
    for (const state of ['computing', 'queued', 'awaiting', 'cycle', 'deleted', 'nofactors', 'refused', 'failed']) {
        sources.watches[0].snap = { state, title: 'Grouping 1', cycle: state === 'cycle' ? ['Grouping 1', 'Table 1', 'Grouping 1'] : undefined };
        const got = h.read();
        assert.equal(got.state, state);
        assert.equal(got.values, null);
        assert.equal(got.codes, undefined);
        assert.ok(got.words, 'its words, for the header, the cells and the held rows');
        if (state === 'cycle') assert.deepEqual(got.cycle, ['Grouping 1', 'Table 1', 'Grouping 1']);
    }
    // values without codes (another consumer's option) are no series either
    sources.watches[0].snap = { state: 'ready', title: 'Grouping 1', values: { reply: { names: NAMES } } };
    assert.equal(h.read().codes, undefined);
});

test('onChange hands the table the same view as read', () => {
    const { half, sources } = makeHalf();
    const seen = [];
    half.watch(COLUMN, { host: TA, visible: () => true, onChange: (s) => seen.push(s) });
    sources.watches[0].spec.onChange(readySnap());
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].categories, NAMES);
    assert.equal(seen[0].values, null);
});

test('the handle passes compute, retry, cancel, sharers and release through', () => {
    const { half, sources } = makeHalf();
    const h = half.watch(COLUMN, { host: TA, visible: () => true, onChange: () => {} });
    assert.equal(h.compute(), true);
    assert.equal(h.retry(), false);
    assert.equal(h.cancel(), true);
    assert.equal(h.sharers(), 2);
    h.release();
    assert.equal(sources.watches[0].released, true);
    assert.equal(half.update(COLUMN), true);
    assert.deepEqual(sources.updated, [GA]);
    half.visibilityChanged();
    assert.equal(sources.visibility, 1);
});

test('the column is named by the grouping title, which it keeps for when the grouping is gone (CAT-8)', () => {
    const { half } = makeHalf();
    const column = { ...COLUMN };
    assert.equal(half.label(column), 'Grouping 1');
    assert.equal(column.label, 'Grouping 1');
    assert.equal(half.fullLabel(column), 'Grouping 1');
    const gone = { type: 'cell-group', key: 'cell-grouping-Z', column: '', label: 'Old grouping' };
    assert.equal(half.label(gone), 'Old grouping');
    assert.equal(gone.label, 'Old grouping');
});

test('Open grouping opens the grouping beside the table', () => {
    const { half, opened } = makeHalf();
    half.open(COLUMN, TA);
    assert.deepEqual(opened, [[GA, TA]]);
});

test('a notice is the grouping\'s, read as a column: no other grouping to choose, Remove column where there are no groups', () => {
    const { half } = makeHalf();
    const cycle = half.describe({ state: 'cycle', title: 'Grouping 1' }, { sharers: 1 });
    assert.equal(cycle.role, 'column');
    assert.deepEqual(cycle.actions, [['score-open', 'Open grouping'], ['score-unfilter', 'Remove this filter']],
        'a loop through a table runs through a condition on the column: removing the conditions ends it (decision 18)');
    assert.ok(pageActions.known.includes('score-unfilter'), 'a known action of the registry');
    for (const state of ['deleted', 'off', 'failed', 'refused', 'cancelled', 'nofactors']) {
        const n = half.describe({ state, title: 'Grouping 1' }, { sharers: 1 });
        assert.ok(n.actions.some(([a]) => a === 'score-remove'), state);
        assert.ok(!n.actions.some(([a]) => a === 'score-choose'), state);
    }
    const computing = half.describe({ state: 'computing', title: 'Grouping 1' }, { sharers: 1 });
    assert.deepEqual(computing.actions, [['score-open', 'Open grouping']]);
    const none = makeHalf(fakeSources(), { describe: () => null }).half;
    assert.equal(none.describe({ state: 'ready' }, { sharers: 1 }), null);
});

test('the chooser lists a grouping by its title, with the way to make one when there is none', () => {
    const { half } = makeHalf();
    setReferenceHost({ panel: () => null, ids: () => [] });
    const g = { id: GA, title: 'Grouping 1', open: true };
    assert.equal(half.chooser.entityLabel(g), 'Grouping 1');
    assert.deepEqual(half.chooser.options(g, [], TA), [{ column: '', text: 'Grouping 1' }]);
    assert.deepEqual(half.chooser.empty, { text: 'No groupings yet.', button: 'New grouping…' });
});

test('a grouping built from this table can be shown but not filtered on there, and says so; in another table both (decision 15)', () => {
    const { half } = makeHalf();
    const configs = {
        [GA]: { type: 'cell-grouping', config: { partitionings: [{ source: { type: 'table', key: TA } }] } },
        [TA]: { type: 'cell-table', config: { columns: [{ type: 'obs', key: 'cell_type', column: '' }] } },
        [TB]: { type: 'cell-table', config: { columns: [] } }
    };
    // the grouping's references, as G9a declares them: a table factor is an edge to the table
    setReferenceHost({
        panel: (id) => configs[id] || null,
        ids: () => Object.keys(configs)
    });
    const g = { id: GA, title: 'Grouping 1', open: true };
    const inT = half.chooser.options(g, [], TA);
    assert.deepEqual(inT, [{ column: '', text: 'Grouping 1', note: "Can't be filtered here: Grouping 1 depends on this table" }]);
    assert.deepEqual(half.chooser.options(g, [], TB), [{ column: '', text: 'Grouping 1' }]);
    // no table id (an old caller): nothing is said
    assert.deepEqual(half.chooser.options(g, []), [{ column: '', text: 'Grouping 1' }]);
    // the condition builder: not in this table, yes in another
    assert.equal(half.filterable(COLUMN, TA), false);
    assert.equal(half.filterable(COLUMN, TB), true);
    assert.equal(half.filterable(COLUMN, null), true);
    // a column the table only shows is no edge: showing it closes no loop, so the grouping stays usable as a factor
    configs[TA].config.columns.push(COLUMN);
    assert.equal(half.filterable(COLUMN, TA), false);
    setReferenceHost({ panel: () => null, ids: () => [] });
});

test('the column states itself in a grouping\'s words, and the score\'s words are unchanged', () => {
    const { half, sources } = makeHalf();
    const h = half.watch(COLUMN, { host: TA, visible: () => true, onChange: () => {} });
    sources.watches[0].snap = { state: 'cycle', title: 'Grouping 1' };
    const snap = h.read();
    const view = columnView(snap, 'Grouping 1');
    assert.equal(view.suffix, '(no groups)');
    assert.equal(view.cell, 'no groups');
    assert.equal(view.exportNote, "'Grouping 1' has no groups: remove the column to export");
    sources.watches[0].snap = { state: 'computing', title: 'Grouping 1' };
    const gate = filterGate([{ title: 'Grouping 1', view: columnView(h.read(), 'Grouping 1'), snap: h.read() }]);
    assert.deepEqual(describeHeldRows(gate), { headline: "Filter on 'Grouping 1' not applied yet.", text: 'Rows appear when the groups are ready.' });
    // a score's column says what it said before
    const score = columnView({ state: 'failed' }, 'T score');
    assert.equal(score.suffix, '(no score)');
    assert.equal(score.cell, 'no score');
    const sgate = filterGate([{ title: 'T score', view: columnView({ state: 'computing' }, 'T score'), snap: { state: 'computing' } }]);
    assert.equal(describeHeldRows(sgate).text, 'Rows appear when the score is ready.');
});

test('a read does no work that grows with the cells or the groups: the rank is made once per group list', () => {
    const { half, sources } = makeHalf();
    const h = half.watch(COLUMN, { host: TA, visible: () => true, onChange: () => {} });
    const groups = Array.from({ length: 2000 }, (_, i) => `g${i}`);
    sources.watches[0].snap = readySnap(1000, groups, 2);
    const first = h.read();
    const again = h.read();
    assert.equal(again.rank, first.rank, 'the same rank array, not a new one per read');
    assert.equal(again.categories, first.categories);
    // a timing guard at 10x the cells: reads stay constant time (codes are never walked)
    const big = readySnap(1_000_000, groups, 2);
    sources.watches[0].snap = big;
    h.read();
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) h.read();
    const big1000 = performance.now() - t0;
    sources.watches[0].snap = readySnap(100_000, groups, 2);
    h.read();
    const t1 = performance.now();
    for (let i = 0; i < 1000; i++) h.read();
    const small1000 = performance.now() - t1;
    assert.ok(big1000 < Math.max(15 * small1000, 20), `1,000 reads at 1M cells ${big1000.toFixed(1)} ms vs 100k ${small1000.toFixed(1)} ms`);
});

test('Remove this filter drops the conditions on one column and keeps the rest', () => {
    const key = 'cell-group_cell-grouping-A_main';
    const other = { condition: '=', data: 'cell_type', origData: 'obs_cell_type_main', type: 'string', value: ['B cell'] };
    const mine = { condition: '=', data: 'Grouping 1', origData: key, type: 'string', value: ['in Table 1'] };
    assert.deepEqual(dropConditions({ criteria: [mine], logic: 'AND' }, key), { criteria: [], logic: 'AND' });
    assert.deepEqual(dropConditions({ criteria: [other, mine], logic: 'OR' }, key), { criteria: [other], logic: 'OR' });
    const nested = { criteria: [other, { criteria: [mine, { ...mine, value: ['x'] }], logic: 'OR' }], logic: 'AND' };
    const before = JSON.stringify(nested);
    assert.deepEqual(dropConditions(nested, key), { criteria: [other], logic: 'AND' }, 'a group left empty goes');
    assert.equal(JSON.stringify(nested), before, 'the filter given is not changed');
    assert.deepEqual(dropConditions(undefined, key), { criteria: [], logic: 'AND' });
});
