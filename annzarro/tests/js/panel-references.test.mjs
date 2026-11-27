/**
 * What a panel's configuration refers to (static/js/utils/panel-references.js): one declaration per panel
 * type serves the id remap of links and panel sets, the dependency graph and its cycles, and who uses a
 * panel. The graph is mixed: a table, a signature or a grouping is a node alike.
 *
 * Run:  node --test annzarro/tests/js/panel-references.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const refs = await import('../../../static/js/utils/panel-references.js');
const { registerReferences, registerPanelSourceType, remapReferences, setReferenceHost,
    dependsOn, usersOf, keptInUse } = refs;
const { remapPanelReferences, panelsToAdd } = await import('../../../static/js/utils/deeplink.js');
const { createResolver, depthOf, findCycle: findCycleIn } = await import('../../../static/js/utils/table-resolver.js');
/** A cycle in the page's graph, as the table resolver finds it. */
const findCycle = (id) => findCycleIn(id, dependsOn);
const { getColumnKey } = await import('../../../static/js/utils/column-key.js');

const clone = (x) => JSON.parse(JSON.stringify(x));
const score = (key, extra = {}) => ({ type: 'gene-score', key, column: 'mean', ...extra });

// A grouping-like panel type that does not exist yet: it partitions cells by a table's rows, by a
// signature's score and by a set, and measures a score. Every reference kind a later type needs.
registerPanelSourceType('fake-group');
registerReferences('fake-grouping', (cfg) => {
    const out = [];
    for (const p of Array.isArray(cfg.partitionings) ? cfg.partitionings : []) {
        const s = p && p.source;
        if (s && typeof s.key === 'string' && ['table', 'gene-score', 'fake-group'].includes(s.type)) {
            out.push({ id: s.key, via: 'partitioning', get: () => s.key, set: (v) => { s.key = v; } });
        }
    }
    for (const s of Array.isArray(cfg.sets) ? cfg.sets : []) {
        if (s && typeof s.ref === 'string') out.push({ id: s.ref, via: 'set', get: () => s.ref, set: (v) => { s.ref = v; } });
    }
    if (cfg.measure && typeof cfg.measure.key === 'string') {
        const m = cfg.measure;
        out.push({ id: m.key, via: 'measure', get: () => m.key, set: (v) => { m.key = v; } });
    }
    for (const sec of Array.isArray(cfg.sections) ? cfg.sections : []) {
        if (sec && typeof sec.source === 'string') out.push({ id: sec.source, via: 'section', get: () => sec.source, set: (v) => { sec.source = v; } });
    }
    return out;
});

/** A page of panels for the graph: id -> {type, config}. */
function page(panels) {
    setReferenceHost({
        panel: (id) => (Object.prototype.hasOwnProperty.call(panels, id) ? panels[id] : null),
        ids: () => Object.keys(panels)
    });
    return panels;
}

// ---------------------------------------------------------------- one example per existing type

const examples = {
    'cell-plot': () => ({
        id: 'cell-plot-1', tableFilter: 'cell-table-1',
        x: { type: 'obsm', key: 'X_umap', column: '0' },
        y: score('gene-signature-1', { history: { 'gene-score': { key: 'gene-table-1' } } }),
        z: { type: 'obs', key: 'gene-signature-1', history: { 'gene-score': { key: 'gene-signature-2' } } },
        color: score('gene-table-1'),
        hoverInfo: [{ type: 'obs', key: '_index' }, score('gene-signature-2'), null, 'junk']
    }),
    'gene-plot': () => ({ id: 'gene-plot-1', tableFilter: 'gene-signature-1', x: { type: 'var', key: 'mean' } }),
    'cell-table': () => {
        const filtered = score('gene-table-1');
        const shown = score('gene-signature-1');
        return {
            id: 'cell-table-1', tableFilter: 'none',
            columns: [{ type: 'obs', key: 'gene-signature-1', column: '' }, filtered, shown],
            searchBuilderConfig: { logic: 'AND', criteria: [
                { condition: '>', origData: getColumnKey(filtered), value: ['1'] },
                { logic: 'OR', criteria: [{ condition: '<', origData: getColumnKey(filtered), value: ['9'] }] }] }
        };
    },
    'gene-table': () => ({ id: 'gene-table-1', columns: [{ type: 'var', key: 'mean', column: '' }] }),
    'gene-set': () => ({ id: 'gene-set-1', tableFilter: 'gene-table-1', idColumn: 'gene-table-1' }),
    'gene-signature': () => ({ id: 'gene-signature-1', title: 'T', genes: ['gene-table-1'] })
};

/** Every example on one page, with each panel they name. */
function examplesPage() {
    const panels = {};
    for (const [type, make] of Object.entries(examples)) panels[make().id] = { type, config: make() };
    for (const id of ['gene-signature-2']) panels[id] = { type: 'gene-signature', config: {} };
    return page(panels);
}

test('each existing panel type declares exactly the references it has', () => {
    examplesPage();
    assert.deepEqual(dependsOn('cell-plot-1'), ['cell-table-1', 'gene-signature-1', 'gene-table-1', 'gene-signature-2']);
    assert.deepEqual(dependsOn('gene-plot-1'), ['gene-signature-1']);
    assert.deepEqual(dependsOn('cell-table-1'), ['gene-table-1'],
        "'none' is no reference; a column the filter does not read is only shown");
    assert.deepEqual(dependsOn('gene-table-1'), []);
    assert.deepEqual(dependsOn('gene-set-1'), ['gene-table-1']);
    assert.deepEqual(dependsOn('gene-signature-1'), [], 'a signature refers to nothing: a gene named like a panel is a gene');
    assert.deepEqual(usersOf('gene-signature-1').map(u => u.panelId), ['cell-plot-1', 'gene-plot-1', 'cell-table-1'],
        'a column only shown is a use');
});

test('a remap round trip leaves every existing type as it was, and the forward map renames every reference', () => {
    // how many places of each example name a panel: a remembered setting and a filter condition count
    const places = { 'cell-plot': 6, 'gene-plot': 1, 'cell-table': 4, 'gene-table': 0, 'gene-set': 1, 'gene-signature': 0 };
    const ids = ['cell-table-1', 'gene-signature-1', 'gene-signature-2', 'gene-table-1'];
    const forward = new Map(ids.map(id => [id, `${id}-new`]));
    const back = new Map([...forward].map(([a, b]) => [b, a]));
    for (const [type, make] of Object.entries(examples)) {
        const original = make();
        const cfg = make();
        remapPanelReferences([cfg], forward);
        assert.equal(JSON.stringify(cfg).split('-new').length - 1, places[type], `${type}: every reference followed, nothing else`);
        remapPanelReferences([cfg], back);
        assert.deepEqual(cfg, original, `${type} round trip`);
    }
    const plot = remapPanelReferences([examples['cell-plot']()], forward)[0];
    assert.equal(plot.y.history['gene-score'].key, 'gene-table-1-new', 'what an axis remembers follows too');
    assert.equal(plot.z.key, 'gene-signature-1', 'an obs key is no panel');
});

// ---------------------------------------------------------------- a type that does not exist yet

test('remap follows a reference kind of a new panel type, through links and panel sets', () => {
    const cfg = () => ({ id: 'fake-grouping-1',
        partitionings: [{ source: { type: 'obs', key: 't1' } }, { source: { type: 'table', key: 't1' } },
            { source: { type: 'fake-group', key: 'g2' } }],
        sets: [{ ref: 't1' }], measure: { key: 's1' }, sections: [{ source: 's1' }] });
    const [c] = remapPanelReferences([cfg()], { t1: 'T1', g2: 'G2', s1: 'S1' });
    assert.deepEqual(c.partitionings.map(p => p.source.key), ['t1', 'T1', 'G2'], 'an obs key is no panel');
    assert.equal(c.sets[0].ref, 'T1');
    assert.equal(c.measure.key, 'S1');
    assert.equal(c.sections[0].source, 'S1');
    page({ g: { type: 'fake-grouping', config: c }, T1: { type: 'cell-table', config: {} }, G2: { type: 'fake-grouping', config: {} },
        S1: { type: 'gene-signature', config: {} } });
    assert.deepEqual(dependsOn('g'), ['T1', 'G2', 'S1'], 'partitioning, set, measure and section are edges, each panel once');

    const plan = { view: { layout: { hierarchy: [], panelConfigs: {} } }, closedPanels: [
        { type: 'cell-table', id: 't1', config: { id: 't1', columns: [] } },
        { type: 'fake-grouping', id: 'fake-grouping-1', config: cfg() }] };
    let n = 100;
    const added = panelsToAdd(plan, (id) => id === 't1', (type) => `${type}-${n++}`);
    const grouping = added.find(p => p.type === 'fake-grouping').config;
    assert.equal(grouping.partitionings[1].source.key, 'cell-table-100');
    assert.equal(grouping.sets[0].ref, 'cell-table-100');
});

test('a source type whose key is a panel is followed in plot axes, colour, hover, history and table columns', () => {
    const col = { type: 'fake-group', key: 'g1', column: 'level' };
    const cfg = { id: 'cell-plot-1', x: { type: 'fake-group', key: 'g1' }, color: { type: 'obs', key: 'g1', history: { 'fake-group': { key: 'g1' } } },
        hoverInfo: [{ type: 'fake-group', key: 'g1' }], columns: [col],
        searchBuilderConfig: { criteria: [{ origData: getColumnKey(col) }] } };
    remapPanelReferences([cfg], { g1: 'g9' });
    assert.equal(cfg.x.key, 'g9');
    assert.equal(cfg.color.key, 'g1', 'an obs key stays');
    assert.equal(cfg.color.history['fake-group'].key, 'g9');
    assert.equal(cfg.hoverInfo[0].key, 'g9');
    assert.equal(cfg.columns[0].key, 'g9');
    assert.equal(cfg.searchBuilderConfig.criteria[0].origData, getColumnKey(cfg.columns[0]));
});

test('a declaration that names an unknown reference kind throws; so does a type registered twice or a bad declaration', () => {
    // only a config that has the field: every declaration is asked for a config of no type
    registerReferences('fake-typo', (cfg) => (cfg.typo ? [{ id: 'x', via: 'axes', get: () => 'x', set: () => {} }] : []));
    assert.throws(() => remapPanelReferences([{ typo: true }], { x: 'y' }), /axes/);
    assert.throws(() => registerReferences('fake-typo', () => []), /already/);
    assert.throws(() => registerReferences('fake-bad', null), /function/);
    assert.throws(() => registerReferences('cell-plot', () => []), /already/);
});

// ---------------------------------------------------------------- the graph

test('dependsOn names the panels that exist and that the panel is computed from', () => {
    page({
        't': { type: 'cell-table', config: examples['cell-table']() },
        'p': { type: 'cell-plot', config: { tableFilter: 't', x: score('gone'), y: { type: 'obs', key: 'a', history: { 'gene-score': { key: 's' } } }, color: score('s') } },
        's': { type: 'gene-signature', config: {} },
        'gene-table-1': { type: 'gene-table', config: {} },
        'gene-signature-1': { type: 'gene-signature', config: {} }
    });
    assert.deepEqual(dependsOn('t'), ['gene-table-1'], 'a column only shown is no input');
    assert.deepEqual(dependsOn('p'), ['t', 's'], 'a missing panel and a remembered setting are no edges; each once');
    assert.deepEqual(dependsOn('s'), []);
    assert.deepEqual(dependsOn('nope'), []);
});

test('a cycle through a node that is not a table is found and stops the table resolver', async () => {
    // a table filtered on a grouping's column, the grouping partitioning by that table's rows
    const tableOn = (key) => {
        const column = { type: 'fake-group', key, column: 'level' };
        return { columns: [column], searchBuilderConfig: { criteria: [{ origData: getColumnKey(column) }] } };
    };
    page({
        T: { type: 'cell-table', config: tableOn('G') },
        G: { type: 'fake-grouping', config: { partitionings: [{ source: { type: 'table', key: 'T' } }] } }
    });
    assert.deepEqual(findCycle('T'), ['T', 'G', 'T']);
    assert.deepEqual(findCycle('G'), ['G', 'T', 'G']);

    const builds = [];
    const resolver = createResolver({
        panel: (id) => (id === 'T' ? { id, kind: 'cell-table', open: false, title: 'Table T', config: {} } : null),
        isDependant: () => true, visible: () => true, cellsKey: () => 'k', rowCount: () => 10,
        mayLoad: () => ({ ok: true }), depends: dependsOn,
        build: (job) => { builds.push(job); return new Promise(() => {}); },
        publish: () => {}, notify: () => {}, schedule: (fn) => setTimeout(fn, 0)
    });
    const status = resolver.need('T', 'plot');
    assert.equal(status.state, 'cycle');
    assert.deepEqual(status.cycle, ['T', 'G', 'T']);
    await new Promise(r => setTimeout(r, 5));
    assert.equal(builds.length, 0, 'it computes nothing');
});

test('cycles of length 2 and 3 through mixed nodes, and a panel that names itself', () => {
    page({
        T1: { type: 'cell-table', config: { tableFilter: 'T2' } },
        T2: { type: 'cell-table', config: { tableFilter: 'G' } },
        G: { type: 'fake-grouping', config: { partitionings: [{ source: { type: 'table', key: 'T1' } }] } },
        A: { type: 'fake-grouping', config: { measure: { key: 'B' } } },
        B: { type: 'fake-grouping', config: { sets: [{ ref: 'A' }] } },
        S: { type: 'fake-grouping', config: { sections: [{ source: 'S' }] } },
        free: { type: 'fake-grouping', config: { sets: [{ ref: 'T1' }] } }
    });
    assert.deepEqual(findCycle('T1'), ['T1', 'T2', 'G', 'T1']);
    assert.deepEqual(findCycle('A'), ['A', 'B', 'A']);
    assert.deepEqual(findCycle('S'), ['S', 'S']);
    assert.deepEqual(findCycle('free'), ['T1', 'T2', 'G', 'T1'], 'a panel upstream of a cycle is stopped by it');
    page({ x: { type: 'cell-table', config: { tableFilter: 'y' } }, y: { type: 'gene-signature', config: {} } });
    assert.equal(findCycle('x'), null);
});

test('a crafted link never loops: a dense graph is walked once per node, and garbage configs are read without throwing', () => {
    const n = 22;
    const panels = {};
    for (let i = 0; i < n; i++) {
        panels[`t${i}`] = { type: 'fake-grouping', config: { sets: Array.from({ length: i }, (_, j) => ({ ref: `t${j}` })) } };
    }
    page(panels);
    let calls = 0;
    const counted = (id) => { calls++; return dependsOn(id); };
    assert.equal(depthOf(`t${n - 1}`, counted), n - 1);
    assert.ok(calls <= n, `depthOf asked ${calls} times for ${n} panels`);
    calls = 0;
    assert.equal(findCycle(`t${n - 1}`), null);

    const junk = [null, 7, 'x', [], { columns: 'no', hoverInfo: {}, x: 'str', tableFilter: 5 },
        { columns: [null, 1, { type: 'gene-score' }], searchBuilderConfig: { criteria: 'no' } },
        { x: { type: 'gene-score', key: 3, history: 'no' }, y: { history: { 'gene-score': null } } },
        { partitionings: [null, { source: null }], sets: 'no', sections: [7] }];
    for (const cfg of junk) {
        for (const type of ['cell-plot', 'cell-table', 'gene-set', 'fake-grouping', 'unknown-type']) {
            page({ p: { type, config: cfg }, x: { type: 'gene-signature', config: {} } });
            assert.doesNotThrow(() => [dependsOn('p'), usersOf('x'), keptInUse(['x'])]);
        }
    }
    assert.doesNotThrow(() => remapPanelReferences(clone(junk), { x: 'y' }));
    assert.doesNotThrow(() => remapReferences([undefined, null], new Map()));
});

// ---------------------------------------------------------------- who uses a panel

test('usersOf names each panel that uses another once, with its type, and never the panel itself', () => {
    page({
        sig: { type: 'gene-signature', config: {} },
        plot: { type: 'cell-plot', config: { x: score('sig'), color: score('sig'), hoverInfo: [score('sig')] } },
        remembered: { type: 'cell-plot', config: { x: { type: 'obs', key: 'a', history: { 'gene-score': { key: 'sig' } } } } },
        table: { type: 'cell-table', config: { columns: [score('sig')] } },
        set: { type: 'gene-set', config: { tableFilter: 'sig' } },
        group: { type: 'fake-grouping', config: { sections: [{ source: 'sig' }, { source: 'group' }] } }
    });
    assert.deepEqual(usersOf('sig'), [
        { panelId: 'plot', kind: 'cell-plot' }, { panelId: 'table', kind: 'cell-table' },
        { panelId: 'set', kind: 'gene-set' }, { panelId: 'group', kind: 'fake-grouping' }],
        'a column only shown is a use; a setting only remembered is not');
    assert.deepEqual(usersOf('group'), []);
    assert.deepEqual(usersOf('plot'), []);
});

test('Clear closed panels keeps a closed panel an open one uses, and what a kept one uses, transitively', () => {
    page({
        plot: { type: 'cell-plot', config: { tableFilter: 'table' } },
        table: { type: 'cell-table', config: { columns: [score('gtable')] } },
        gtable: { type: 'gene-table', config: { tableFilter: 'sig' } },
        sig: { type: 'gene-signature', config: {} },
        lonely: { type: 'cell-plot', config: { color: score('sig2') } },
        sig2: { type: 'gene-signature', config: {} },
        loop1: { type: 'cell-table', config: { tableFilter: 'loop2' } },
        loop2: { type: 'cell-table', config: { tableFilter: 'loop1' } },
        remembering: { type: 'cell-plot', config: { x: { type: 'obs', key: 'a', history: { 'gene-score': { key: 'old' } } } } },
        old: { type: 'gene-signature', config: {} }
    });
    const closed = ['table', 'gtable', 'sig', 'lonely', 'sig2', 'loop1', 'loop2', 'old'];
    assert.deepEqual([...keptInUse(closed)].sort(), ['gtable', 'sig', 'table'],
        'a closed plot keeps nothing; two closed tables using each other keep neither; a remembered setting is no use');
    assert.deepEqual([...keptInUse([])], []);
});
