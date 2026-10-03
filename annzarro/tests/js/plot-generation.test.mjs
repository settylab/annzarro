/**
 * Plot data from a previous dataset is dropped, never reduced (PR #53
 * follow-up to issue #2).
 *
 * Seen on every headless dataset switch: "Error updating plot: TypeError:
 * Cannot read properties of null (reading 'values' / 'reduce')" in
 * createFilterMask / processCategories. loadDataAndCreatePlot clears the
 * series and rebuilds them asynchronously; meanwhile the tables reload and
 * fire tableChanged, the plot's incremental update read the half-built
 * series, threw, was caught, and fell back to a second full redraw.
 *
 * Now every finished load stamps its data with DataManager's dataset
 * generation. An incremental update on data that is mid-load or from an
 * older generation does nothing (the reload in flight draws), and a load
 * whose dataset changed while it ran is dropped like an aborted one.
 *
 * Run:  node --test annzarro/tests/js/plot-generation.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// Anything callable and chainable: stands in for jQuery and DOM elements.
const chain = new Proxy(function () {}, {
    get: (t, k) => (k === 'length' ? 0 : k === Symbol.toPrimitive ? () => '' : chain),
    apply: () => chain
});
const mkEl = () => ({
    style: {}, dataset: {}, children: [], classList: { add() {}, remove() {}, contains: () => false },
    appendChild(c) { return c; }, insertBefore(c) { return c; }, removeChild() {}, remove() {},
    querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, getAttribute: () => null,
    addEventListener() {}, contains: () => false, innerHTML: ''
});
globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {},
    getComputedStyle: () => ({ position: 'relative' }) };
globalThis.document = { createElement: mkEl, getElementById: () => null, body: mkEl(), querySelector: () => null };
globalThis.jQuery = chain;
globalThis.$ = chain;
const plotlyCalls = [];
globalThis.Plotly = new Proxy({}, {
    get: (t, fn) => (...args) => { plotlyCalls.push(fn); return Promise.resolve(); }
});

const { DataManager } = await import('../../../static/js/data-manager.js');
const { loadDataAndCreatePlot } = await import('../../../static/js/panels/plot-utilities/plot-make.js');
const { updatePlotElements, isPlotDataCurrent } =
    await import('../../../static/js/panels/plot-utilities/plot-update.js');

const N = 50;
const CELLS = Array.from({ length: N }, (_, i) => `c${i}`);
let generation = 7;
Object.assign(DataManager, {
    getCells: () => CELLS, getGenes: () => [],
    getCurrentDataset: () => '/a.zarr',
    getDatasetGeneration: () => generation,
    getCellIndex: () => -1, getGeneIndex: () => -1,
    getFocusedCell: () => null, getFocusedGene: () => null,
    getDatasetStructure: async () => ({ obs: { columns: ['celltype'] } })
});

const mkPlot = () => ({
    ...mkEl(), id: 'plot-container-p', layout: {},
    data: [{ type: 'scattergl', name: 'A', x: [], y: [] }],
    parentNode: { querySelector: () => null, insertBefore() {}, appendChild() {}, children: [] }
});
const settings = {
    x: { type: 'obs', key: 'x' }, y: { type: 'obs', key: 'y' }, z: null,
    color: { type: 'obs', key: 'celltype' }, hideNaN: false, hideOutliers: false, tableFilter: 'none',
    pointSize: 3, pointOpacity: 0.8
};
const series = () => ({ values: CELLS.map((_, i) => i), type: 'numerical' });

test('mid-load data (series cleared, not yet stamped) is left alone', async () => {
    // what loadDataAndCreatePlot leaves while its loads are in flight
    const data = { entities: 'cells', cells: CELLS, x: null, y: null, z: null, color: null, generation: null };
    assert.equal(isPlotDataCurrent(data), false);
    plotlyCalls.length = 0;
    let refreshed = false;
    await updatePlotElements(mkPlot(), data, settings, () => { refreshed = true; },
        { filter: true, colors: true, colorRange: true });
    assert.deepEqual(plotlyCalls, []);
    assert.equal(refreshed, false, 'the reload in flight draws; no second full redraw');
});

test('data stamped under a previous dataset is left alone', async () => {
    const data = { entities: 'cells', cells: CELLS, x: series(), y: series(), z: null,
        color: null, colorType: 'categorical', generation: generation - 1 };
    assert.equal(isPlotDataCurrent(data), false);
    plotlyCalls.length = 0;
    await updatePlotElements(mkPlot(), data, settings, () => {}, { filter: true, colors: true });
    assert.deepEqual(plotlyCalls, []);
    assert.equal(isPlotDataCurrent({ ...data, generation }), true);
});

test('a load whose dataset changed while it ran is dropped, not drawn', async () => {
    DataManager.loadObs = async ({ columns }) => {
        generation++;                         // the user switched dataset meanwhile
        await new Promise(r => setTimeout(r, 5));
        const values = columns[0] === 'celltype' ? CELLS.map(() => 'a') : CELLS.map((_, i) => i);
        return { data: { [columns[0]]: values } };
    };
    const data = {};
    plotlyCalls.length = 0;
    // dropped like any aborted load: quietly, leaving the newer load to draw
    await loadDataAndCreatePlot(mkEl(), mkPlot(), { ...settings }, data, 'p');
    assert.ok(!plotlyCalls.some(fn => fn === 'newPlot' || fn === 'react'), plotlyCalls.join(','));
    assert.equal(isPlotDataCurrent(data), false);
});
