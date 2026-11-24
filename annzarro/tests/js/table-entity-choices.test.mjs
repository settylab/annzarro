/**
 * T3 (table-chooser-080.md 4): what the Layers, obsp and varp tabs of a table offer, without a page. Never the cross
 * product: the entities once each (the focused one first, then those fixed in plots, then those the table holds), the
 * keys to read them in, and the table's own columns, a placeholder listed as one.
 *
 * Run:  node --test annzarro/tests/js/table-entity-choices.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    getElementById: () => null, addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => []
};

const { entityChoices } = await import('../../../static/js/panels/table-utilities/panel-tracker.js');

const entities = [
    { name: 'CD8A', source: 'focused', panelTitle: 'Focused Gene' },
    { name: 'GZMB', source: 'panel', panelTitle: 'Cell Plot 2', panelId: 'cell-plot-2' },
    { name: 'CD8A', source: 'panel', panelTitle: 'Cell Plot 3', panelId: 'cell-plot-3' }
];
const keys = ['X', 'counts', 'logged'];

test('each entity is listed once, with its origin, the focused one first', () => {
    const c = entityChoices({ type: 'layer', keys, entities, kind: 'gene', selected: [] });
    assert.deepEqual(c.entities.map((e) => [e.name, e.note]), [['CD8A', 'focused'], ['GZMB', 'fixed in Cell Plot 2']]);
    assert.deepEqual(c.keys, keys);
    assert.deepEqual(c.held, []);
});

test('the table\'s own columns are held in the order added, and an entity only they name joins the list', () => {
    const selected = [
        { type: 'layer', key: 'logged', column: 'CD3E' }, { type: 'layer', key: 'X', column: 'GZMB' },
        { type: 'obs', key: 'score', column: '' }, { type: 'layer', key: 'gone', column: 'CD3E' }
    ];
    const c = entityChoices({ type: 'layer', keys, entities, kind: 'gene', selected });
    assert.deepEqual(c.held.map((h) => [h.key, h.column]), [['logged', 'CD3E'], ['X', 'GZMB']], 'another type and an unknown layer are not held');
    assert.deepEqual(c.entities.map((e) => [e.name, e.note]),
        [['CD8A', 'focused'], ['GZMB', 'fixed in Cell Plot 2'], ['CD3E', 'in this table']]);
});

test('an unresolved placeholder is held as one and never offered as an item', () => {
    const selected = [{ type: 'layer', key: 'X', column: '_focused_gene' }, { type: 'layer', key: 'X', column: 'focused_gene' }];
    const c = entityChoices({ type: 'layer', keys, entities: [], kind: 'gene', selected });
    assert.deepEqual(c.held.map((h) => h.placeholder), [true, true]);
    assert.deepEqual(c.entities, []);
    // a cell placeholder is not a gene one
    const cells = entityChoices({ type: 'obsp', keys: ['connectivities'], entities: [], kind: 'cell',
        selected: [{ type: 'obsp', key: 'connectivities', column: 'focused_gene' }] });
    assert.equal(cells.held[0].placeholder, false);
});
