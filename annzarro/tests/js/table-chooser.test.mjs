/**
 * The table column chooser (issues #9, #27).
 *
 *   #9  A column picked from the focused cell or gene names that entity, so
 *       the table no longer follows the focus; every cell/gene locked in any
 *       plot is offered; a column picked earlier stays listed after the focus
 *       moves on, so it can still be removed.
 *   #27 The search box on the obsm/varm tabs filters the lists (they sit in an
 *       accordion, below the box, and the lookup only searched downward), and
 *       a layer "focused cell" column is labelled with the focused CELL.
 *
 * No browser here: a small DOM stand-in carries the real table-ui-make.js.
 *
 * Run:  node --test annzarro/tests/js/table-chooser.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// --- minimal DOM -----------------------------------------------------------

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
        // '.a' or '.a:checked' or '.a .b' (descendant) is all this module needs
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
    addEventListener() {}, dispatchEvent() {}
};
globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.CustomEvent = class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };

const { DataManager } = await import('../../../static/js/data-manager.js');
const { PanelManager } = await import('../../../static/js/panel-manager.js');
const { populateColumnsCellTable, populateColumnsGeneTable } =
    await import('../../../static/js/panels/table-utilities/table-ui-make.js');
const { getColumnDisplayName } = await import('../../../static/js/panels/table-utilities/table-data.js');

let focusedCell = 'cell_X';
let focusedGene = 'S100a9';
DataManager.getFocusedCell = () => focusedCell;
DataManager.getFocusedGene = () => focusedGene;

/** Two plots, each with an axis locked on a different cell. */
const plot = (id, title, color) => ({
    getType: () => 'cell-plot', getId: () => id, getTitle: () => title, getConfig: () => ({ color })
});
PanelManager.getAllActivePanels = () => [
    plot('p1', 'Plot A', { type: 'obsp', key: 'connectivities', column: 'cell_A', locked: true }),
    plot('p2', 'Plot B', { type: 'obsp', key: 'connectivities', column: 'cell_B', locked: true }),
    plot('p3', 'Plot C', { type: 'obsp', key: 'connectivities', column: 'cell_C', locked: false })
];

const structure = {
    obsm: { dataframes: { X_umap: { columns: ['0', '1'] }, X_pca: { columns: ['PC1', 'PC2', 'PC3'] } } },
    obsp: { keys: ['connectivities'] }
};

/** A tab pane the way createDataTabs builds it: search box, then the list. */
function tabPane(sourceId, id) {
    const pane = new El('div');
    pane.className = 'tab-pane';
    pane.id = `${sourceId}-content-${id}`;
    const group = pane.appendChild(new El('div'));
    const search = group.appendChild(new El('input'));
    search.className = 'form-control column-search';
    const list = pane.appendChild(new El('div'));
    list.className = 'checkbox-list';
    body.appendChild(pane);
    return pane;
}

function chooser(id, settings) {
    const panes = { obsm: tabPane('obsm', id), obsp: tabPane('obsp', id) };
    populateColumnsCellTable([{ id: 'obsm' }, { id: 'obsp' }], structure, id, settings);
    const items = (pane) => pane.querySelectorAll('.column-checkbox').map(cb => ({
        column: cb.getAttribute('data-column'), source: cb.getAttribute('data-source'),
        label: cb.parentNode.children[1].textContent, checked: cb.checked
    }));
    return { panes, items };
}

test('the focused cell is offered by NAME, beside every locked cell (#9)', () => {
    focusedCell = 'cell_X';
    const { panes, items } = chooser('t1', { columns: [] });
    const got = items(panes.obsp);
    assert.deepEqual(got.map(i => i.column).sort(), ['cell_A', 'cell_B', 'cell_X']);
    assert.equal(got.find(i => i.column === 'cell_X').label, 'connectivities: cell_X (focused)');
    assert.equal(got.find(i => i.column === 'cell_B').label, 'connectivities: cell_B (fixed in Plot B)');
    assert.ok(!got.some(i => i.column === 'cell_C'), 'an unlocked axis follows the focus; it is not a fixed cell');
    assert.ok(!got.some(i => /focused_cell/.test(i.column)));
});

test('a column added from an earlier focus stays listed and ticked (#9)', () => {
    focusedCell = 'cell_Y';
    const { panes, items } = chooser('t2', { columns: [{ type: 'obsp', key: 'connectivities', column: 'cell_X' }] });
    const got = items(panes.obsp);
    const kept = got.find(i => i.column === 'cell_X');
    assert.ok(kept && kept.checked);
    assert.equal(kept.label, 'connectivities: cell_X (in this table)');
    assert.ok(got.some(i => i.column === 'cell_Y' && i.source === 'focused' && !i.checked));
});

test('the obsm search box filters the accordion lists below it (#27)', () => {
    const { panes } = chooser('t3', { columns: [] });
    const search = panes.obsm.querySelector('.column-search');
    const rows = panes.obsm.querySelectorAll('.form-check');
    assert.equal(rows.length, 5);
    search.value = 'pca';
    search.dispatch('input');
    const visible = rows.filter(r => r.style.display !== 'none')
        .map(r => r.children[1].textContent);
    assert.deepEqual(visible.sort(), ['X_pca:PC1', 'X_pca:PC2', 'X_pca:PC3']);
});

test('a layer "focused cell" column is labelled with the focused cell, not the gene (#27)', () => {
    focusedCell = 'cell_Q';
    focusedGene = 'Gata1';
    assert.equal(getColumnDisplayName({ type: 'layer', key: 'X', column: 'focused_cell' }),
        'X: cell_Q (follows focus)');
    assert.equal(getColumnDisplayName({ type: 'layer', key: 'X', column: 'focused_gene' }),
        'X: Gata1 (follows focus)');
    assert.equal(getColumnDisplayName({ type: 'layer', key: 'X', column: 'Gata1' }), 'X: Gata1');
});

test('loadLayer survives a cleared dataset and still sends a gene request (#27)', async () => {
    const urls = [];
    globalThis.fetch = async (url) => {
        urls.push(url);
        // a Response has headers: the client checks Content-Type for the
        // binary (format=f32) encoding before parsing
        return { ok: true, headers: new Headers({ 'Content-Type': 'application/json' }),
                 text: async () => JSON.stringify({ data: [[1], [2], [3]] }) };
    };
    // fresh module: no dataset loaded, so its cell and gene names are null
    const out = await DataManager.loadLayer({ datasetPath: '/d.zarr', layerName: 'X', cols: [4] });
    assert.deepEqual(out.data, [1, 2, 3], 'the one-gene answer is flattened like any gene request');
    assert.match(urls[0], /cols=4/);
});

// keep the unused import honest: the gene table builds through the same path
test('gene table chooser builds without a varp section', () => {
    const pane = tabPane('varp', 'g1');
    populateColumnsGeneTable([{ id: 'varp' }], { var: { columns: [] } }, 'g1', { columns: [] });
    assert.equal(pane.querySelectorAll('.column-checkbox').length, 0);
});
