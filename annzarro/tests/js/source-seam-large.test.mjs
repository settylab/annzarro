/**
 * The second half of the plots' provider seam (F3c-2): the Hover picker, large-plot mode's controls and refusals ask
 * the provider (static/js/utils/source-registry.js) and never name a source type. Fake providers, registered here at
 * run time, are the guard: no consumer file knows them. The colour groups, hover lines and large-plot colours are the
 * browser half (annzarro/tests/browser/test_source_seam_large.py).
 *
 * Run:  node --test annzarro/tests/js/source-seam-large.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const R = await import('../../../static/js/utils/source-registry.js');
const H = await import('../../../static/js/panels/plot-utilities/hover-columns.js');
const { updateLargePlotControls, largePlotTooltip } = await import('../../../static/js/panels/plot-utilities/large-plot-controls.js');

const KEPT = [];
/** A grouping-like provider: categorical; colour and hover in a large plot, never an axis there. */
R.registerSource({
    type: 'fake-group', label: 'fake groups', valueType: 'categorical', entity: 'cells', consumers: ['cell-plot'],
    axes: ['x', 'y', 'color', 'hover'], largeAxes: ['color'], defaultSub: '',
    entities: () => [{ id: 'grp-1', title: 'Grouping A', open: true }, { id: 'grp-2', title: 'Grouping B', open: false }],
    keyEntries: (list) => list.map(e => ({ value: e.id, text: e.title })), subKeys: () => [],
    titleOf: (s) => `grouping ${s.label || s.key}`,
    load: async () => { throw new Error('not read here'); },
    loadLarge: async () => { throw new Error('not read here'); },
    hover: {
        group: 'Fake groupings',
        options: (kept) => {
            KEPT.push([...kept]);
            const out = [{ value: 'fake-group:grp-1', label: 'Grouping A' }, { value: 'fake-group:grp-2', label: 'Grouping B' }];
            for (const v of kept) if (!out.some(o => o.value === v)) out.push({ value: v, label: `${v.slice(11)} (deleted)` });
            return out;
        },
        valueOf: (s) => `fake-group:${s.key}`,
        parse: (v) => ({ key: v.slice('fake-group:'.length) }),
        label: (s) => s.label || s.key
    }
});
/** A score-like provider: numerical, every axis of a large plot. */
R.registerSource({
    type: 'fake-score', label: 'fake scores', valueType: 'numerical', entity: 'cells', consumers: ['cell-plot'],
    axes: ['x', 'y', 'z', 'color'], largeAxes: ['x', 'y', 'color'], defaultSub: 'a',
    entities: () => [], keyEntries: () => [], subKeys: () => [{ value: 'a', label: 'A' }], titleOf: (s) => `fake ${s.key}`,
    load: async () => { throw new Error('not read here'); }, loadLarge: async () => { throw new Error('not read here'); }
});

const structure = { obs: { columns: ['_index', 'Age', 'cell_type'] }, var: { columns: ['_index', 'means'] } };

test('the Hover picker lists every hover provider in its own group, by what the provider offers and with what is chosen', () => {
    const info = [{ type: 'obs', key: '_index' }, { type: 'fake-group', key: 'grp-2' }];
    const opts = H.hoverColumnOptions('cells', structure, info, false);
    const mine = opts.filter(o => o.group === 'Fake groupings');
    assert.deepEqual(mine.map(o => [o.value, o.label, o.selected]),
        [['fake-group:grp-1', 'Grouping A', false], ['fake-group:grp-2', 'Grouping B', true]]);
    assert.deepEqual(KEPT.at(-1), ['fake-group:grp-2'], 'the provider is told what is chosen, by its picker value');
    assert.equal(opts.some(o => o.group === 'fake scores' || o.value.startsWith('fake-score:')), false, 'no hover role: not listed');
    // a gene plot lists no cell source
    assert.equal(H.hoverColumnOptions('genes', structure, info, false).some(o => o.group), false);
    // "No hover" leaves nothing selected
    assert.equal(H.hoverColumnOptions('cells', structure, info, true).filter(o => o.group).some(o => o.selected), false);
});

test('a pick becomes the provider\'s setting and back; what the picker cannot show is kept', () => {
    const previous = [{ type: 'obs', key: '_index' }, { type: 'obsm', key: 'X_umap', column: '0' }, { type: 'fake-group', key: 'grp-1' }];
    const next = H.hoverInfoFromSelection('cells', ['Age', 'fake-group:grp-2'], previous);
    assert.deepEqual(next, [{ type: 'obs', key: '_index' }, { type: 'obsm', key: 'X_umap', column: '0' }, { type: 'obs', key: 'Age' },
        { type: 'fake-group', key: 'grp-2' }]);
    assert.deepEqual(H.hoverColumnOptions('cells', structure, next, false).filter(o => o.selected).map(o => o.value), ['Age', 'fake-group:grp-2']);
    assert.equal(H.pickerValue({ type: 'fake-group', key: 'grp-2' }), 'fake-group:grp-2');
    assert.equal(H.pickerValue({ type: 'obs', key: 'Age' }), 'Age');
    // a provider this page has not loaded (a link names it) is kept as it is
    const unknown = { type: 'not-loaded', key: 'k1' };
    assert.deepEqual(H.hoverInfoFromSelection('cells', ['Age'], [unknown]), [{ type: 'obs', key: '_index' }, unknown, { type: 'obs', key: 'Age' }]);
});

test('large-plot mode accepts a provider on the axes it declares, and refuses the rest with the existing sentence', async () => {
    // imported here: large-plot.js brings the page's own providers (a score's Hover entries need its panels), which
    // the picker tests above leave out
    const { largePlotRefusal } = await import('../../../static/js/panels/plot-utilities/large-plot.js');
    for (const axis of ['x', 'y', 'color']) assert.equal(R.largeAccepts('fake-score', axis), true, axis);
    assert.equal(R.largeAccepts('fake-group', 'color'), true);
    assert.equal(R.largeAccepts('fake-group', 'x'), false);
    assert.equal(R.largeAccepts('not-loaded', 'color'), false);
    for (const [axis, types] of [['x', ['obsm', 'obs', 'layer']], ['color', ['obsm', 'obs', 'layer', 'none']]]) {
        for (const t of types) assert.equal(R.largeAccepts(t, axis), true, `${axis} ${t}`);
        assert.equal(R.largeAccepts('obsp', axis), false);
    }
    const base = { x: { type: 'obsm', key: 'X_umap', column: '0' }, y: { type: 'obsm', key: 'X_umap', column: '1' }, z: null, tableFilter: 'none' };
    assert.equal(largePlotRefusal({ ...base, color: { type: 'fake-group', key: 'grp-1' } }, 6e6), null, 'a grouping colours a large plot');
    assert.equal(largePlotRefusal({ ...base, x: { type: 'fake-group', key: 'grp-1' }, color: { type: 'none' } }, 6e6),
        'An x axis from fake-group is not available for 6M points: turn on a subset, or choose an embedding (obsm), an obs column or a gene');
    assert.equal(largePlotRefusal({ ...base, y: { type: 'fake-score', key: 's' }, color: { type: 'fake-score', key: 's' } }, 6e6), null);
});

test('the large-plot controls disable a provider\'s type option where the mode cannot draw it, and restore it', () => {
    const option = (value) => ({ value, disabled: false, dataset: {}, attrs: {},
        getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } });
    const selects = ['x', 'y', 'color'].map(axis => ({ axis, options: ['obsm', 'fake-group', 'fake-score'].map(option) }));
    const root = { querySelectorAll: (sel) => {
        const m = sel.match(/^select\.axis-type-select\[data-axis="(\w+)"\]$/);
        return m ? selects.filter(s => s.axis === m[1]) : [];
    } };
    updateLargePlotControls(root, true, 1000000);
    const state = () => Object.fromEntries(selects.map(s => [s.axis, s.options.filter(o => o.disabled).map(o => o.value)]));
    assert.deepEqual(state(), { x: ['fake-group'], y: ['fake-group'], color: [] });
    assert.equal(selects[0].options[1].getAttribute('title'), largePlotTooltip(1000000));
    updateLargePlotControls(root, false, 1000000);
    assert.deepEqual(state(), { x: [], y: [], color: [] });
});
