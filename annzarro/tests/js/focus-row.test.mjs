/**
 * A matrix slice taken AT the focused entity that comes back entirely blank
 * must say WHICH entity is not covered and what to do about it.
 *
 * Reported from a live instance: a gene plot (volcano) coloured by a varp row
 * of the focused gene turned uniformly grey whenever the focused gene was not
 * one the varp matrix was computed for -- e.g. the dataset's default first
 * gene. The server answers such a row with a full-length run of NaN/null, so
 * every request succeeded and the only sentence available was the generic
 * "every entry in this column is blank". On the incremental colour path
 * (refocus, colour dropdown) not even that reached the screen, because
 * `data.colorCoverage` was never rewritten there (settylab/annzarro#40).
 *
 * Drives the REAL plot loader, table loader and incremental colour update.
 *
 * Run:  node --test annzarro/tests/js/focus-row.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {
    addEventListener() {}, location: { href: 'http://localhost/' }, Config: {},
    getComputedStyle: () => ({ position: 'relative' })
};
const created = [];
function mkEl(tag) {
    const el = {
        tagName: tag, style: {}, dataset: {}, children: [], _attrs: {},
        innerHTML: '', className: '',
        classList: { add() {}, remove() {} },
        appendChild(c) { this.children.push(c); return c; },
        insertBefore(c) { this.children.push(c); return c; },
        querySelectorAll: () => [], querySelector: () => null,
        remove() {}, setAttribute(k, v) { this._attrs[k] = v; }
    };
    created.push(el);
    return el;
}
globalThis.document = {
    createElement: mkEl, getElementById: () => null, body: mkEl('body'),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}
};
globalThis.Plotly = new Proxy({}, { get: () => () => Promise.resolve() });
// Chainable no-op jQuery: the colour controls are not under test here.
const chain = new Proxy(function () {}, {
    get: (_t, p) => (p === 'length' ? 0 : p === Symbol.iterator ? [][Symbol.iterator] : () => chain),
    apply: () => chain
});
globalThis.jQuery = () => chain;
globalThis.$ = globalThis.jQuery;

const { GAP } = await import('../../../static/js/utils/coverage.js');
const { DataManager } = await import('../../../static/js/data-manager.js');
const { loadAxisData } = await import('../../../static/js/panels/plot-utilities/plot-make.js');
const { loadColorDataAndUpdatePlot } = await import('../../../static/js/panels/plot-utilities/plot-update.js');
const { loadTableData } = await import('../../../static/js/panels/table-utilities/table-data.js');

const N = 50;
const GENES = Array.from({ length: N }, (_, i) => `GENE_${i}`);
let varpRow = Array(N).fill(null);           // the uncovered gene's row
Object.assign(DataManager, {
    getGenes: () => GENES, getCells: () => [],
    getCurrentDataset: () => '/fixture.zarr',
    getGeneIndex: (g) => GENES.indexOf(g),
    getCellIndex: () => -1,
    resolveCellIndex: async () => -1,
    getFocusedGene: () => 'GENE_0', getFocusedCell: () => null,
    loadVarp: async () => ({ data: [varpRow] })
});

const COLOR = { type: 'varp', key: 'corr', column: 'GENE_0' };

test('plot: an all-blank varp row names the gene and the fix', async () => {
    varpRow = Array(N).fill(null);
    const { values, coverage } = await loadAxisData({ ...COLOR }, 'genes');
    assert.equal(values.length, N);
    assert.equal(coverage.worstReason, GAP.EMPTY);
    const text = coverage.lines().join('\n');
    assert.match(text, /focused gene "GENE_0" has no values in "corr"/);
    assert.match(text, /focus a gene that "corr" covers/);
});

test('plot: a LOCKED axis advises picking, not focusing', async () => {
    varpRow = Array(N).fill(NaN);
    const { coverage } = await loadAxisData({ ...COLOR, locked: true }, 'genes');
    assert.match(coverage.lines().join('\n'), /the gene "GENE_0" has no values.*pick a gene/s);
});

test('plot: a covered row stays complete', async () => {
    varpRow = Array.from({ length: N }, (_, i) => i / N);
    const { coverage } = await loadAxisData({ ...COLOR }, 'genes');
    assert.equal(coverage.isComplete, true);
});

test('table and plot give the same sentence for the uncovered row', async () => {
    varpRow = Array(N).fill(null);
    const plot = (await loadAxisData({ ...COLOR }, 'genes')).coverage;
    const table = await loadTableData(
        { columns: [{ type: 'varp', key: 'corr', column: 'focused_gene' }] }, 'genes');
    const tableText = table.coverage.lines().join('\n');
    assert.ok(tableText.includes('focused gene "GENE_0" has no values in "corr"'), JSON.stringify(table.coverage.lines()));
    assert.equal(table.coverage.worstReason, plot.worstReason);
    const sentence = 'focused gene "GENE_0" has no values in "corr"';
    assert.ok(plot.lines().join('\n').includes(sentence));
});

test('incremental colour update rewrites data.colorCoverage (refocus path)', async () => {
    varpRow = Array.from({ length: N }, (_, i) => i / N);
    const healthy = await loadAxisData({ ...COLOR }, 'genes');
    const data = {
        entities: 'genes', genes: GENES,
        x: { values: GENES.map((_, i) => i), type: 'numerical', coverage: healthy.coverage },
        y: { values: GENES.map((_, i) => i), type: 'numerical', coverage: healthy.coverage },
        z: null,
        color: healthy.values, colorType: 'numerical', colorCategories: null,
        colorCoverage: healthy.coverage,                  // the PREVIOUS colour
        tableEntities: null, tableFilterMask: null,
        generation: DataManager.getDatasetGeneration()    // stamped by a finished load
    };
    const settings = {
        x: { type: 'var', key: 'a' }, y: { type: 'var', key: 'b' }, z: null,
        color: { ...COLOR }, hideNaN: false, hideOutliers: false, tableFilter: 'none'
    };
    const plotContainer = {
        data: [{ type: 'scattergl', x: [], y: [] }], layout: {},
        parentNode: { querySelector: () => null, insertBefore() {}, appendChild() {}, children: [] },
        querySelector: () => null, querySelectorAll: () => [],
        classList: { add() {}, remove() {} }, dataset: {}, id: 'plot-container-g', style: {},
        appendChild(c) { return c; }, removeChild() {}, contains: () => false
    };

    varpRow = Array(N).fill(null);                       // refocus onto an uncovered gene
    created.length = 0;
    let refreshed = false;
    await loadColorDataAndUpdatePlot({}, plotContainer, settings, data, 'g', () => { refreshed = true; });

    assert.equal(refreshed, false, 'took the incremental path, not the full-render fallback');
    assert.equal(data.colorCoverage.worstReason, GAP.EMPTY,
        'colorCoverage still describes the previous colour column');
    const notice = created.find(e => e._attrs && e._attrs['data-summary'] !== undefined);
    assert.ok(notice, 'a status strip was rendered');
    assert.match(String(notice._attrs['data-summary']), /focus a gene that "corr" covers/);
});
