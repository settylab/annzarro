/**
 * The seam between the plots and the providers of three-level sources (F3c-1): the load, the titles, view copy,
 * the panel-set follow and the cycle's kinds ask the provider (static/js/utils/source-registry.js) and never name a
 * source type. A fake CATEGORICAL provider, registered here at run time, is the guard: no consumer file knows it.
 * The menus and the link round trip are the browser half (annzarro/tests/browser/test_source_seam.py).
 *
 * Run:  node --test annzarro/tests/js/source-seam.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// plot-make.js reaches for `window` once at module scope (guarded) and `document` through its loading indicator
globalThis.window = globalThis.window || { addEventListener() {}, location: { href: 'http://localhost/' } };
globalThis.document = globalThis.document || {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelectorAll: () => [], remove() {} }),
    body: { appendChild() {} }
};

const R = await import('../../../static/js/utils/source-registry.js');
const { Coverage } = await import('../../../static/js/utils/coverage.js');
const { coordinateId } = await import('../../../static/js/utils/view-descriptor.js');
const { colourTitle } = await import('../../../static/js/utils/plot-titles.js');
const { axisTitle } = await import('../../../static/js/panels/plot-utilities/plot-make-helper.js');
const { DataManager } = await import('../../../static/js/data-manager.js');
const { loadAxisData, seriesSource } = await import('../../../static/js/panels/plot-utilities/plot-make.js');
const refs = await import('../../../static/js/utils/panel-references.js');
const P = await import('../../../static/js/utils/score-source-panels.js');
const { findCycle } = await import('../../../static/js/utils/table-resolver.js');
const N = await import('../../../static/js/utils/score-notices.js');

const CELLS = ['c0', 'c1', 'c2', 'c3', 'c4'];
const CATEGORIES = ['B cells', 'T cells', 'NK cells'];
const COLOURS = ['#111111', '#222222', '#333333'];
const MISSING = 255;
const loads = [];

/** A grouping-like provider: categorical, cells, no sub-keys, its own colours. */
R.registerSource({
    type: 'fake-group', label: 'fake groups', entity: 'cells', consumers: ['cell-plot'], axes: ['x', 'y', 'color'], defaultSub: '',
    entities: () => [{ id: 'grp-1', title: 'Grouping A', open: false }],
    keyEntries: (list) => list.map(e => ({ value: e.id, text: e.title })),
    subKeys: () => [],
    titleOf: (setting) => `grouping ${setting.label || setting.key}`,
    load: async (setting, opts) => {
        loads.push({ key: setting.key, role: opts.role, unit: opts.unit, expected: opts.expected });
        setting.label = 'Grouping A';
        return { type: 'categorical', codes: Uint8Array.from([0, 1, MISSING, 2, 1]), MISSING, categories: CATEGORIES, colours: COLOURS,
            coverage: Coverage.complete(CELLS.length, 'cells') };
    }
});
/** A numerical provider with sub-keys and a layer of its own (a score's shape). */
R.registerSource({
    type: 'fake-score', label: 'fake scores', entity: 'cells', consumers: ['cell-plot'], axes: ['x', 'y', 'z', 'color'], defaultSub: 'a', layered: true,
    entities: () => [], keyEntries: () => [], subKeys: () => [{ value: 'a', label: 'A' }], titleOf: (s) => `fake ${s.key}`,
    load: async () => ({ type: 'numerical', values: [1, 2, 3, 4, 5], vector: Float32Array.from([1, 2, 3, 4, 5]), coverage: Coverage.complete(5, 'cells') })
});

function stubCells() {
    const saved = { ...DataManager };
    Object.assign(DataManager, {
        getCells: () => CELLS, getGenes: () => ['g0'], getCurrentDataset: () => '/fixture.zarr',
        getDatasetStructure: async () => ({ obs: { columns: ['leiden'] }, obsm: { dataframes: {} } }),
        loadUns: async () => { throw new Error('a provider\'s colours are its own: uns is not asked'); }
    });
    return () => Object.assign(DataManager, saved);
}

test('a categorical provider loads through the registry: one label per point, its categories and its own colours', async () => {
    const restore = stubCells();
    try {
        const setting = { type: 'fake-group', key: 'grp-1', column: '' };
        const got = await loadAxisData(setting, 'cells', null, { role: 'colour' });
        assert.deepEqual(got.values, ['B cells', 'T cells', null, 'NK cells', 'T cells'], 'codes become labels; MISSING is no category');
        assert.equal(got.type, 'categorical');
        assert.deepEqual(got.categories, CATEGORIES);
        assert.deepEqual(got.colours, COLOURS);
        assert.equal(got.coverage.shown, 5);
        assert.equal(setting.label, 'Grouping A', 'the load names what it read in the setting');
        assert.deepEqual(loads.at(-1), { key: 'grp-1', role: 'color', unit: 'cells', expected: 5 });
        const axis = await loadAxisData(setting, 'cells', null, { axis: 'x' });
        assert.equal(loads.at(-1).role, 'x');
        assert.deepEqual(axis.values, got.values);
        const num = await loadAxisData({ type: 'fake-score', key: 's', column: '' }, 'cells', null, { axis: 'y' });
        assert.deepEqual([num.type, num.values, num.colours], ['numerical', [1, 2, 3, 4, 5], null]);
    } finally { restore(); }
});

test('a provider\'s unavailable series passes through the load unwrapped, so the plot can say why', async () => {
    const restore = stubCells();
    R.registerSource({
        type: 'fake-late', label: 'late', entity: 'cells', consumers: ['cell-plot'], axes: ['x'], defaultSub: '', entities: () => [], keyEntries: () => [],
        subKeys: () => [], titleOf: () => 'late',
        load: async () => { throw new R.SourceUnavailable('Computing', { headline: 'Computing' }, Coverage.complete(0, 'cells'), 'computing'); }
    });
    try {
        await assert.rejects(loadAxisData({ type: 'fake-late', key: 'k' }, 'cells', null, { axis: 'x' }),
            (e) => e.name === 'SourceUnavailable' && e.state === 'computing' && e.notice.headline === 'Computing');
    } finally { restore(); }
});

test('titles name a provider\'s setting by what its load wrote, never by the type', () => {
    const one = { type: 'fake-group', key: 'grp-1', label: 'Grouping A', column: '' };
    assert.equal(colourTitle(one), 'Grouping A');
    assert.equal(axisTitle({ x: one }, 'x'), 'Grouping A');
    const two = { type: 'fake-score', key: 's', label: 'S', labelFull: 'S\na · X' };
    assert.equal(colourTitle(two), 'S<br>a · X', 'a colour bar has two lines');
    assert.equal(axisTitle({ x: two }, 'x'), 'S · a · X');
    assert.equal(axisTitle({ x: { type: 'fake-group', key: 'grp-9' } }, 'x'), 'grp-9', 'the id until the title is known');
    assert.equal(colourTitle({ type: 'not-loaded-here', key: 'k', label: 'Kept' }), 'Kept', 'a provider this page has not loaded is named alike');
    assert.equal(seriesSource(one), 'grouping Grouping A');
    assert.equal(seriesSource({ type: 'obsm', key: 'X_umap', column: '0' }), 'obsm.X_umap.0');
});

test('view copy keys a provider axis by entity and sub-key, the default for an empty column; a layer only where the provider has them', () => {
    assert.deepEqual(coordinateId({ type: 'fake-group', key: 'grp-1', column: '' }), { key: 'fake-group:grp-1', dim: null });
    assert.deepEqual(coordinateId({ type: 'fake-group', key: 'grp-1', layer: 'counts' }), { key: 'fake-group:grp-1', dim: null });
    assert.deepEqual(coordinateId({ type: 'fake-score', key: 's', column: '' }), { key: 'fake-score:s', dim: 'a' });
    assert.deepEqual(coordinateId({ type: 'fake-score', key: 's', column: 'a', layer: 'counts' }), { key: 'fake-score:s@counts', dim: 'a' });
    assert.deepEqual(coordinateId({ type: 'obsm', key: 'X_umap', column: '1' }), { key: 'obsm:X_umap', dim: 1 }, 'a built-in source is unchanged');
    assert.deepEqual(coordinateId({ type: 'layer', key: 'counts', column: 'GATA1', layer: 'x' }), { key: 'layer:counts', dim: 'GATA1' });
});

test('the type menu lists a provider for a consumer only when it takes every role asked', () => {
    assert.deepEqual(R.sourcesFor('cell-plot', ['color']).map(p => p.type).filter(t => t.startsWith('fake-g')), ['fake-group']);
    assert.deepEqual(R.sourcesFor('cell-plot', ['z']).map(p => p.type), ['fake-score']);
    assert.deepEqual(R.sourcesFor('cell-plot', ['x', 'z']).map(p => p.type), ['fake-score']);
    assert.deepEqual(R.sourcesFor('gene-plot', ['x']).map(p => p.type), [], 'a cell source is not a gene plot\'s');
    assert.equal(R.isProviderType('fake-group'), true);
    assert.equal(R.isProviderType('obsm'), false);
    assert.equal(R.isProviderType(''), false);
});

// ------------------------------------------------------------------ the panel-set follow

const score = (key) => ({ type: 'gene-score', key, column: 'mean' });

test('referencedFields: the top-level keys of a configuration that hold references, each once', () => {
    const plot = {
        tableFilter: 'gene-table-1', x: score('gene-signature-1'), y: { type: 'obsm', key: 'X_umap', column: '1' },
        color: { type: 'obs', key: 'leiden', history: { 'gene-score': { key: 'gene-signature-2' } } },
        hoverInfo: [{ type: 'obs', key: 'a' }, score('gene-signature-3'), score('gene-signature-4')]
    };
    assert.deepEqual(refs.referencedFields(plot, 'cell-plot'), ['tableFilter', 'x', 'hoverInfo', 'color'],
        'an axis that only remembers a source still holds a reference: it follows a remap');
    const key = 'gene-score_gene-signature-1_mean';
    const table = { tableFilter: 'none', columns: [{ type: 'obs', key: 'n' }, score('gene-signature-1')],
        searchBuilderConfig: { criteria: [{ origData: key, condition: '>', value: ['1'] }] } };
    assert.deepEqual(refs.referencedFields(table, 'cell-table'), ['columns', 'searchBuilderConfig'],
        'a filter condition names a column by its key: it follows with it');
    assert.deepEqual(refs.referencedFields({ ...table, searchBuilderConfig: {} }, 'cell-table'), ['columns']);
    assert.deepEqual(refs.referencedFields({ tableFilter: 'gene-table-9' }, 'gene-set'), ['tableFilter']);
    assert.deepEqual(refs.referencedFields({ genes: ['A'] }, 'gene-signature'), []);
    assert.deepEqual(refs.referencedFields({ x: { type: 'obsm', key: 'X_umap' } }, 'cell-plot'), [], 'nothing to push');
    assert.deepEqual(refs.referencedFields(null, 'cell-plot'), []);
});

test('who uses a gene table is who readsScoreOf found: an axis, the colour, a hover entry, a column, its filter; not a key that only looks alike', () => {
    const hit = { type: 'gene-score', key: 'gene-table-1', column: '' };
    const panels = {
        'gene-table-1': { type: 'gene-table', config: {} },
        'p-colour': { type: 'cell-plot', config: { color: hit } }, 'p-x': { type: 'cell-plot', config: { x: hit } },
        'p-hover': { type: 'cell-plot', config: { hoverInfo: [{ type: 'obs', key: 'a' }, hit] } },
        't-column': { type: 'cell-table', config: { columns: [hit] } }, 'p-filter': { type: 'cell-plot', config: { tableFilter: 'gene-table-1' } },
        'p-other': { type: 'cell-plot', config: { color: { ...hit, key: 'gene-table-2' } } },
        'p-obs': { type: 'cell-plot', config: { color: { type: 'obs', key: 'gene-table-1' } } },
        'p-remembered': { type: 'cell-plot', config: { color: { type: 'obs', key: 'a', history: { 'gene-score': { key: 'gene-table-1' } } } } }
    };
    refs.setReferenceHost({ panel: (id) => panels[id] || null, ids: () => Object.keys(panels) });
    assert.deepEqual(refs.usersOf('gene-table-1').map(u => u.panelId), ['p-colour', 'p-x', 'p-hover', 't-column', 'p-filter']);
    assert.equal(P.readsScoreOf, undefined, 'the hand-written list is gone');
});

// ------------------------------------------------------------------ the cycle's kinds

test('a cycle says the kind of each panel on it, beside its titles: a mixed ring is "Circular references"', () => {
    const panel = (id, type, title) => ({ getId: () => id, getType: () => type, getTitle: () => title, getConfig: () => ({}) });
    const panels = new Map([
        ['gene-table-A', panel('gene-table-A', 'gene-table', 'Genes A')],
        ['cell-grouping-G', panel('cell-grouping-G', 'cell-grouping', 'Grouping G')],
        ['cell-table-B', panel('cell-table-B', 'cell-table', 'Cells B')]
    ]);
    const edges = { 'gene-table-A': ['cell-grouping-G'], 'cell-grouping-G': ['cell-table-B'], 'cell-table-B': ['gene-table-A'] };
    const resolver = { need: () => ({ state: 'waiting' }), accept() {}, cancel() {}, retry() {}, cycleOf: (id) => findCycle(id, (x) => edges[x] || []) };
    const sources = P.createSourceAdapter({ panel: (id) => panels.get(id) || null, active: () => false, geneNames: () => [], resolver });
    const g = sources.get('gene-table-A').gate('p');
    assert.equal(g.state, 'cycle');
    assert.deepEqual(g.cycle, ['Genes A', 'Grouping G', 'Cells B', 'Genes A']);
    assert.deepEqual(g.cycleKinds, ['table', 'cell-grouping', 'table', 'table'], 'parallel to the titles');
    const base = { title: 'Genes A', kind: 'table', state: 'cycle', cycle: g.cycle, cycleKinds: g.cycleKinds };
    assert.equal(N.describeScore(base, { role: 'colour' }).tag.text, 'Circular references');
    const tables = P.gateState({ state: 'cycle', cycle: ['Genes A', 'Cells B', 'Genes A'], cycleKinds: ['table', 'table', 'table'] });
    assert.deepEqual(tables.cycleKinds, ['table', 'table', 'table']);
    assert.equal(N.describeScore({ ...base, cycle: tables.cycle, cycleKinds: tables.cycleKinds }, { role: 'colour' }).tag.text, 'Circular tables');
});
