/**
 * The seam between the tables and the providers of three-level sources (F3d): the column chooser, the column's key and
 * title, its handle, its cells (sort, filter, export), its notices and the gate of a filter that reads it ask the provider's
 * `table` half (static/js/utils/source-registry.js) and never name a source type. A fake CATEGORICAL provider, registered
 * here at run time, is the guard: no table file knows it. The page's half (the column in a real table, the painter, the link
 * round trip) is annzarro/tests/browser/test_source_seam_table.py.
 *
 * Run:  node --test annzarro/tests/js/source-seam-table.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// --- minimal DOM (as table-chooser.test.mjs) -------------------------------------------------

class El {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.attributes = {};
        this.style = {};
        this.dataset = {};
        this.listeners = {};
        this.id = '';
        this.className = '';
        this.textContent = '';
        this.value = '';
        this.checked = false;
        const self = this;
        this.classList = {
            add: (...cs) => { for (const c of cs) if (!self._has(c)) self.className = `${self.className} ${c}`.trim(); },
            remove: (...cs) => { self.className = self.className.split(/\s+/).filter(c => !cs.includes(c)).join(' '); },
            contains: (c) => self._has(c)
        };
    }
    _has(c) { return this.className.split(/\s+/).includes(c); }
    set innerHTML(v) { if (v === '') this.children = []; this._html = v; }
    get innerHTML() { return this._html || ''; }
    appendChild(n) { this.children.push(n); n.parentNode = this; return n; }
    append(...ns) { for (const n of ns) if (typeof n !== 'string') this.appendChild(n); }
    setAttribute(k, v) {
        this.attributes[k] = String(v);
        if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = String(v);
    }
    getAttribute(k) { return this.attributes[k]; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type) { for (const fn of this.listeners[type] || []) fn({ target: this }); }
    *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
    _matches(sel) { return sel.startsWith('.') ? this._has(sel.slice(1)) : this.tagName === sel.toUpperCase(); }
    querySelectorAll(sel) {
        const parts = sel.split(/\s+/);
        let scope = [this];
        for (const part of parts) {
            const [s, pseudo] = part.split(':');
            const next = [];
            for (const root of scope) for (const n of root.walk()) {
                if (n._matches(s) && (pseudo !== 'checked' || n.checked) && !next.includes(n)) next.push(n);
            }
            scope = next;
        }
        return scope;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    closest(sel) { for (let n = this; n; n = n.parentNode) if (n._matches(sel)) return n; return null; }
}

const body = new El('body');
globalThis.document = {
    body,
    createElement: (t) => new El(t),
    getElementById: (id) => { for (const n of body.walk()) if (n.id === id) return n; return null; },
    addEventListener() {}, dispatchEvent() {},
    querySelector: () => null
};
globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.CustomEvent = class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };

const R = await import('../../../static/js/utils/source-registry.js');
const { DataManager } = await import('../../../static/js/data-manager.js');
const { getColumnKey } = await import('../../../static/js/utils/column-key.js');
const SC = await import('../../../static/js/utils/score-column.js');
const { TableScores } = await import('../../../static/js/panels/table-utilities/table-scores.js');
const UI = await import('../../../static/js/panels/table-utilities/table-ui-make.js');
const { getColumnDisplayName } = await import('../../../static/js/panels/table-utilities/table-data.js');

const CATEGORIES = ['B cells', 'T cells', '<NK> cells'];
const MISSING = 255;
const handles = [];
let entities = [{ id: 'g1', title: 'Grouping A', open: true }];

/** A grouping-like provider: categorical, cells, no sub-keys, a handle whose snapshot the test sets. */
R.registerSource({
    type: 'fake-group', label: 'fake groups', entity: 'cells', consumers: ['cell-plot', 'cell-table'], axes: ['x', 'y', 'color', 'column'],
    defaultSub: '', valueType: 'categorical',
    entities: () => entities,
    keyEntries: (list) => list.map(e => ({ value: e.id, text: e.title })),
    subKeys: () => [],
    titleOf: (setting) => `grouping ${setting.label || setting.key}`,
    load: async () => { throw new Error('a table column is not a plot series'); },
    table: {
        tab: 'fake groups',
        watch: (column, { host, visible, onChange }) => {
            const handle = { column, host, visible, released: false, snap: { state: 'deleted', title: column.label },
                read() { return this.snap; }, release() { this.released = true; }, sharers: () => 1,
                compute: () => false, retry: () => false, cancel: () => false,
                push(snap) { this.snap = snap; onChange(snap); } };
            handles.push(handle);
            return handle;
        },
        update: () => false,
        describe: (snap) => ({ state: snap.state, headline: `Fake says ${snap.state}`, text: '', actions: [] }),
        label: (column) => `Grouping ${column.label || column.key}`,
        fullLabel: (column) => `Grouping ${column.label || column.key} (fake)`,
        chooser: {
            layerOf: () => '',
            entityLabel: (e) => e.title,
            options: (e) => [{ column: '', text: e.title }],
            note: () => {},
            empty: { text: 'No groupings yet.', button: 'New grouping…' }
        }
    }
});

const CELLS = ['c0', 'c1', 'c2', 'c3', 'c4'];
DataManager.getCells = () => CELLS;
const FAKE = { type: 'fake-group', key: 'g1', column: '', label: 'Grouping A' };
const ready = (extra = {}) => ({ state: 'ready', title: 'Grouping A', codes: Uint8Array.from([0, 1, MISSING, 2, 1]), categories: CATEGORIES, MISSING, ...extra });

test('a column of a provider with a table half is a source column, keyed like any other', () => {
    assert.equal(SC.isScoreColumn(FAKE), true);
    assert.equal(SC.isScoreColumn({ type: 'obs', key: 'x', column: '' }), false);
    assert.equal(SC.isScoreColumn({ type: 'fake-unregistered', key: 'x', column: '' }), false, 'a link may name a provider this page lacks');
    assert.equal(getColumnKey(FAKE), 'fake-group_g1_main');
    assert.equal(getColumnKey({ ...FAKE, layer: 'counts' }), 'fake-group_g1_main__of_counts', 'a column that names a layer is another column');
    assert.equal(SC.sameScoreColumn(FAKE, { ...FAKE, label: 'renamed' }), true);
    assert.equal(SC.sameScoreColumn(FAKE, { ...FAKE, key: 'g2' }), false);
    assert.deepEqual(SC.scoreColumnsOf([{ type: 'obs', key: 'a' }, FAKE]).map(c => c.key), ['g1']);
    assert.equal(getColumnDisplayName(FAKE), 'Grouping Grouping A', 'the title is the provider\'s');
});

test('the chooser lists a provider that accepts tables as a tab, after the built-in ones', () => {
    const ids = UI.cellTableSources().map(s => s.id);
    assert.deepEqual(ids.slice(0, 4), ['obs', 'obsm', 'obsp', 'layer']);
    assert.ok(ids.includes('fake-group'));
    assert.equal(UI.cellTableSources().find(s => s.id === 'fake-group').label, 'fake groups');
    assert.ok(!UI.geneTableSources().some(s => s.id === 'fake-group'), 'a gene table has no cells to group');
});

function chooser(id, settings) {
    const panel = body.appendChild(new El('div'));
    panel.className = 'table-panel';
    const box = panel.appendChild(new El('div'));
    box.id = `table-container-${id}`;
    const selected = panel.appendChild(new El('ul'));
    selected.id = `selected-columns-list-${id}`;
    const pane = panel.appendChild(new El('div'));
    pane.id = 'fake-group-content-' + id;
    pane.appendChild(new El('div')).appendChild(Object.assign(new El('input'), { className: 'form-control column-search' }));
    pane.appendChild(Object.assign(new El('div'), { className: 'checkbox-list' }));
    UI.populateColumnsCellTable([{ id: 'fake-group' }], {}, id, settings);
    return { pane, selected, items: () => pane.querySelectorAll('.column-checkbox') };
}

test('the chooser makes a group per entity, ticks the columns the table has and builds the entry of a tick from the provider', () => {
    entities = [{ id: 'g1', title: 'Grouping A', open: true }, { id: 'g2', title: 'Grouping B', open: false }];
    const settings = { columns: [{ ...FAKE }] };
    const { pane, selected, items } = chooser('T1', settings);
    assert.equal(pane.querySelectorAll('.az-score-group').length, 2);
    const boxes = items();
    assert.deepEqual(boxes.map(b => [b.getAttribute('data-type'), b.getAttribute('data-key'), b.getAttribute('data-column'), b.checked]),
        [['fake-group', 'g1', '', true], ['fake-group', 'g2', '', false]]);
    boxes[1].checked = true;
    boxes[1].dispatch('change');
    assert.deepEqual(settings.columns, [
        { type: 'fake-group', key: 'g1', column: '', label: 'Grouping A' },
        { type: 'fake-group', key: 'g2', column: '', label: 'Grouping B' }]);
    assert.ok(selected.querySelectorAll('li').length >= 2, 'both are listed as selected');
});

test('with no entity the tab says so and offers the provider\'s way to make one', () => {
    entities = [];
    const { pane } = chooser('T2', { columns: [] });
    const list = pane.querySelector('.checkbox-list');
    assert.match(list.innerHTML, /No groupings yet\./);
    assert.equal(list.querySelector('.az-score-new').textContent, 'New grouping…');
});

test('a source missing when the table is built appears later: the column says so, then fills in place', () => {
    entities = [];
    const seen = [];
    TableScores.setSink('T3', (entry, changed) => seen.push([entry.reader.view.state, changed]));
    const reader = TableScores.readerOf('T3', FAKE);
    const handle = handles.at(-1);
    assert.equal(handle.host, 'T3');
    assert.equal(reader.view.kind, 'none', 'the entity is not there yet');
    assert.equal(reader.render('display', 0), '<span class="text-muted az-score-wait">no score</span>');
    assert.equal(reader.render('sort', 0), '');
    handle.push(ready());
    assert.deepEqual(seen.at(-1), ['ready', true]);
    assert.equal(reader.view.kind, 'ready');
    assert.equal(reader.view.sortable && reader.view.filterable && reader.view.exportable, true);
    assert.deepEqual([0, 1, 2, 3, 4].map(i => reader.render('display', i)), ['B cells', 'T cells', '<span class="text-muted">N/A</span>', '&lt;NK&gt; cells', 'T cells'],
        'a label is text, never markup');
    assert.deepEqual([0, 1, 2, 3, 4].map(i => reader.render('filter', i)), ['B cells', 'T cells', '', '<NK> cells', 'T cells']);
    assert.deepEqual([0, 1, 2, 3, 4].map(i => reader.render('sort', i)), ['B cells', 'T cells', '', '<NK> cells', 'T cells']);
    assert.deepEqual([0, 1, 2, 3, 4].map(i => reader.render('export', i)), ['B cells', 'T cells', '', '<NK> cells', 'T cells']);
    TableScores.release('T3');
    assert.equal(handle.released, true);
});

test('a provider that ranks its categories sorts in that order', () => {
    const reader = TableScores.readerOf('T4', FAKE);
    handles.at(-1).push(ready({ rank: [2, 0, 1] }));
    const sorted = [0, 1, 3].map(i => [reader.render('sort', i), i]).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(p => p[1]);
    assert.deepEqual(sorted, [1, 3, 0], 'T cells, then NK cells, then B cells');
    TableScores.release('T4');
});

test('series of other cells than the rows are not shown', () => {
    const reader = TableScores.readerOf('T5', FAKE);
    handles.at(-1).push(ready({ codes: Uint8Array.from([0, 1]) }));
    assert.equal(reader.view.kind, 'none');
    assert.equal(reader.view.state, 'failed');
    TableScores.release('T5');
});

test('the gate of a filter that reads the column follows the column\'s state; entries leave with prune and release', () => {
    const cfg = { columns: [FAKE], searchBuilderConfig: { criteria: [{ origData: getColumnKey(FAKE), condition: '=', value: ['T cells'] }] } };
    TableScores.readerOf('T6', FAKE);
    const handle = handles.at(-1);
    handle.push({ state: 'computing', title: 'Grouping A' });
    const gate = TableScores.gateOf('T6', cfg);
    assert.equal(gate.state, 'waiting');
    assert.equal(gate.reason, 'score');
    handle.push(ready());
    assert.equal(TableScores.gateOf('T6', cfg), null);
    assert.equal(TableScores.entries('T6').length, 1);
    TableScores.prune('T6', []);
    assert.equal(TableScores.entries('T6').length, 0);
    assert.equal(handle.released, true);
});

test('the table asks the provider for the notice of a column, and the notice goes with the column\'s state', () => {
    TableScores.readerOf('T7', FAKE);
    const handle = handles.at(-1);
    handle.push({ state: 'failed', title: 'Grouping A' });
    const [entry] = TableScores.entries('T7');
    assert.deepEqual(TableScores.noticeOf(entry), { state: 'failed', headline: 'Fake says failed', text: '', actions: [] });
    TableScores.release('T7');
});
