/* global Plotly -- stubbed on globalThis below */
/**
 * An incremental plot update reaches Plotly as ONE react, with the figure the
 * separate calls would have produced.
 *
 * Recolouring a 100,000-point panel by a new focused gene took 1.9-2.0 s in
 * the browser for 0.07-0.13 s of server time: updatePlotElements issued a
 * restyle or relayout per helper (unsort, colour, coverage annotation, hover,
 * log colour bar, sort by colour, focus highlight, aesthetics, legend), and
 * each restyle of the scattergl trace recomputed and redrew every point.
 * utils/plotly-batch.js applies those edits to a copy of the figure and draws
 * it once.
 *
 * The stub below applies each call to the graph the way Plotly does (for what
 * these helpers send), so the same update can be run batched and unbatched
 * and the two resulting figures compared. The comparison against real Plotly
 * (rendered pixels and _fullData) was made headless on the Tahoe and
 * bm_aging stores; see the PR.
 *
 * Run:  node --test annzarro/tests/js/plotly-batch.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

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

const batch = await import('../../../static/js/utils/plotly-batch.js');
const { applyRestyle, applyRelayout, setPath, withPlotlyBatch, setPlotlyBatching, isBatched } = batch;

// --- a Plotly that applies each call to the graph, and records it -------------
const calls = [];
function sequentialPlotly() {
    const record = (name, fn) => (gd, ...args) => {
        calls.push(name);
        fn(gd, ...args);
        return Promise.resolve(gd);
    };
    return {
        restyle: record('restyle', (gd, a, v, t) => applyRestyle(gd.data, gd.layout, a, v, t)),
        relayout: record('relayout', (gd, a, v) => applyRelayout(gd.layout, a, v)),
        update: record('update', (gd, d, l, t) => { if (d) applyRestyle(gd.data, gd.layout, d, t); if (l) applyRelayout(gd.layout, l); }),
        addTraces: record('addTraces', (gd, t) => { gd.data.push(...(Array.isArray(t) ? t : [t]).map(x => ({ ...x }))); }),
        deleteTraces: record('deleteTraces', (gd, idx) => {
            [...(Array.isArray(idx) ? idx : [idx])].sort((a, b) => b - a).forEach(i => gd.data.splice(i, 1));
        }),
        react: record('react', (gd, data, layout) => { gd.data = data; gd.layout = layout; }),
        purge: record('purge', () => {}),
        setPlotConfig: () => {}
    };
}
globalThis.Plotly = sequentialPlotly();

// --- semantics -------------------------------------------------------------

test('restyle: one value per listed trace, cycled; undefined skips; null deletes', () => {
    const data = [{ marker: { color: 'a', size: 2 } }, { marker: { color: 'b' } }, {}];
    applyRestyle(data, {}, { 'marker.color': ['x', 'y'], 'marker.size': undefined }, [0, 2]);
    assert.equal(data[0].marker.color, 'x');
    assert.equal(data[2].marker.color, 'y', 'created along the path');
    assert.equal(data[1].marker.color, 'b', 'not listed, not touched');
    applyRestyle(data, {}, { 'marker.size': null }, 0);
    assert.equal('size' in data[0].marker, false);
    applyRestyle(data, {}, 'name', 'all');
    assert.deepEqual(data.map(t => t.name), ['all', 'all', 'all'], 'string form, every trace');
});

test('restyle: the implied edits of cmin/cmax and colorscale', () => {
    const data = [{ marker: { cauto: true, autocolorscale: true } }];
    applyRestyle(data, {}, { 'marker.cmin': 1 }, [0]);
    assert.equal(data[0].marker.cauto, false);
    applyRestyle(data, {}, { 'marker.colorscale': 'Viridis' }, [0]);
    assert.equal(data[0].marker.autocolorscale, false);
    const kept = [{ marker: {} }];
    applyRestyle(kept, {}, { 'marker.cmin': 1, 'marker.cauto': true }, [0]);
    assert.equal(kept[0].marker.cauto, true, 'an explicit value in the same call wins');
});

test('relayout: paths, array items, and range implies autorange false', () => {
    const layout = { xaxis: { autorange: true }, annotations: [{ text: 'a' }] };
    applyRelayout(layout, { 'xaxis.range': [0, 1], 'annotations[0].text': 'b', 'legend.title.font': { size: 3 } });
    assert.equal(layout.xaxis.autorange, false);
    assert.equal(layout.annotations[0].text, 'b');
    assert.deepEqual(layout.legend.title.font, { size: 3 });
    applyRelayout(layout, { 'yaxis.range[0]': 5 });
    assert.equal(layout.yaxis.autorange, false);
    assert.deepEqual(layout.yaxis.range, [5]);
    applyRelayout(layout, { 'xaxis.range': [2, 3], 'xaxis.autorange': true });
    assert.equal(layout.xaxis.autorange, true);
    setPath(layout, 'legend.x', null);
    assert.equal('x' in layout.legend, false);
});

test('a batch: edits are visible to readers in between, and drawn once', async () => {
    const gd = { data: [{ name: 'a', marker: { color: [1, 2] } }], layout: { title: 't' } };
    const before = gd.data;
    calls.length = 0;
    await withPlotlyBatch(gd, async () => {
        assert.ok(isBatched(gd));
        Plotly.restyle(gd, { 'marker.color': [[3, 4]] }, [0]);
        assert.deepEqual(gd.data[0].marker.color, [3, 4], 'the helper after sees the edit');
        await Plotly.addTraces(gd, { name: 'Focused Cell', x: [1] });
        Plotly.relayout(gd, { 'legend.x': 1.05 });
        Plotly.deleteTraces(gd, -1);
    });
    assert.deepEqual(calls, ['react']);
    assert.equal(isBatched(gd), false);
    assert.deepEqual(gd.data.map(t => t.name), ['a']);
    assert.deepEqual(gd.data[0].marker.color, [3, 4]);
    assert.equal(gd.layout.legend.x, 1.05);
    assert.deepEqual(before[0].marker.color, [1, 2], 'the drawn input was not edited in place');
    assert.equal(globalThis.Plotly.react, globalThis.Plotly.react, 'router removed');
});

test('a batch that throws draws nothing; other graphs pass straight through', async () => {
    const gd = { data: [{ name: 'a' }], layout: {} };
    const other = { data: [{ name: 'o' }], layout: {} };
    calls.length = 0;
    await assert.rejects(withPlotlyBatch(gd, async () => {
        Plotly.restyle(gd, { name: 'b' });
        Plotly.restyle(other, { name: 'p' });
        throw new Error('boom');
    }), /boom/);
    assert.deepEqual(calls, ['restyle'], 'only the other graph reached Plotly');
    assert.equal(other.data[0].name, 'p');
    assert.equal(gd.data[0].name, 'a', 'the failed batch left the graph as it was');
});

test('any other Plotly call on a batched graph sees the batch drawn first', async () => {
    const gd = { data: [{ name: 'a' }], layout: {} };
    calls.length = 0;
    await withPlotlyBatch(gd, async () => {
        Plotly.restyle(gd, { name: 'b' });
        Plotly.purge(gd);
        Plotly.restyle(gd, { name: 'c' });
    });
    assert.deepEqual(calls, ['react', 'purge', 'restyle']);
    assert.equal(gd.data[0].name, 'c');
});

// --- updatePlotElements end to end ------------------------------------------

const { DataManager } = await import('../../../static/js/data-manager.js');
const { updatePlotElements } = await import('../../../static/js/panels/plot-utilities/plot-update.js');
const { Coverage } = await import('../../../static/js/utils/coverage.js');

const N = 400;
const CELLS = Array.from({ length: N }, (_, i) => `c${i}`);
Object.assign(DataManager, {
    getCells: () => CELLS, getCellsForPanel: () => CELLS, cellLabels: (x) => x, getGenes: () => [], getCurrentDataset: () => '/a.zarr',
    getDatasetGeneration: () => 3, getCellIndex: (c) => CELLS.indexOf(c), getGeneIndex: () => -1,
    getFocusedCell: () => 'c17', getFocusedGene: () => null
});

function figure() {
    const x = CELLS.map((_, i) => Math.cos(i)), y = CELLS.map((_, i) => Math.sin(i));
    return {
        id: 'plot-container-p', style: {}, dataset: {}, classList: { add() {}, remove() {} },
        parentNode: { querySelector: () => null, insertBefore() {}, appendChild() {}, children: [] },
        querySelector: () => null, querySelectorAll: () => [],
        _fullLayout: { xaxis: { range: [-1, 1], autorange: true }, yaxis: { range: [-1, 1], autorange: true } },
        data: [
            { type: 'scattergl', mode: 'markers', x, y, text: [...CELLS], customdata: [...CELLS],
              marker: { color: CELLS.map(() => 0), colorscale: 'Viridis', size: 3, opacity: 0.8,
                        colorbar: { title: { text: 'old' } }, showscale: true }, showlegend: false },
            { type: 'scattergl', mode: 'markers', name: 'Focused Cell', x: [x[3]], y: [y[3]],
              marker: { size: 6, color: 'red' } }
        ],
        layout: { xaxis: { range: [-1, 1], autorange: true }, yaxis: { range: [-1, 1], autorange: true },
                  annotations: [] }
    };
}

const KINDS = ['B cell', 'T cell', 'HSC'];

function scenario(overrides = {}) {
    const categorical = overrides.color && overrides.color.type === 'obs';
    const color = categorical
        ? CELLS.map((_, i) => (i % 13 === 0 ? null : KINDS[i % 3]))
        : CELLS.map((_, i) => (i % 11 === 0 ? NaN : (i * 37) % 101 + 0.5));
    const settings = {
        x: { type: 'obsm', key: 'X_umap', column: '0' }, y: { type: 'obsm', key: 'X_umap', column: '1' },
        z: null, color: { type: 'layer', key: 'X', column: 'g1', log: true, logFloor: null },
        colorScale: 'Viridis', colorReversed: false, colorMin: null, colorMax: null,
        pointSize: 3, pointOpacity: 0.8, hideNaN: false, hideOutliers: true, tableFilter: 'none',
        highlightFocusedCell: true, showLegend: true, legendPosition: 'left', sortByColor: true,
        showHoverInfo: true, ...overrides
    };
    const data = {
        entities: 'cells', cells: CELLS, generation: 3,
        x: { values: figure().data[0].x, type: 'numerical', coverage: Coverage.complete(N, 'cells') },
        y: { values: figure().data[0].y, type: 'numerical', coverage: Coverage.complete(N, 'cells') },
        z: null, color, colorType: categorical ? 'categorical' : 'numerical',
        colorCategories: categorical ? KINDS : null, colorCoverage: null,
        tableEntities: null, tableFilterMask: null
    };
    return { settings, data };
}

async function recolour(batched, overrides) {
    setPlotlyBatching(batched);
    const gd = figure();
    const { settings, data } = scenario(overrides);
    // as loadColorDataAndUpdatePlot does before updating
    const { applyLogColor } = await import('../../../static/js/panels/plot-utilities/plot-make.js');
    applyLogColor(data, settings);
    calls.length = 0;
    let refreshed = false;
    await updatePlotElements(gd, data, settings, () => { refreshed = true; },
        { colors: true, colorScale: true, colorRange: true, filter: true, layout: true });
    // let un-awaited helper chains (the highlight's add) settle
    await new Promise(r => setTimeout(r, 5));
    setPlotlyBatching(true);
    return { gd, calls: [...calls], refreshed };
}

const strip = (gd) => JSON.parse(JSON.stringify({ data: gd.data, layout: gd.layout }, (k, v) =>
    (typeof v === 'number' && Number.isNaN(v) ? 'NaN' : v)));

for (const [label, overrides] of [
    ['log colour, hide outliers, focus, legend left', {}],
    ['plain colour, no hiding, legend bottom', { color: { type: 'layer', key: 'X', column: 'g2' },
        hideOutliers: false, legendPosition: 'bottom' }],
    ['fixed colour range, hide NaN, no highlight', { color: { type: 'layer', key: 'X', column: 'g3' },
        colorMin: 5, colorMax: 60, hideNaN: true,
        highlightFocusedCell: false }],
    ['categorical colour, legend right', { color: { type: 'obs', key: 'celltype', column: '' },
        hideOutliers: false, legendPosition: 'right', categoryPalette: 'hue' }]
]) {
    test(`recolour reaches Plotly as one react, same figure as unbatched: ${label}`, async () => {
        const seq = await recolour(false, overrides);
        const one = await recolour(true, overrides);
        assert.equal(seq.refreshed, false);
        assert.equal(one.refreshed, false);
        assert.ok(seq.calls.length > 8, `unbatched made ${seq.calls.length} calls: ${seq.calls}`);
        assert.deepEqual(one.calls, ['react'], `batched made: ${one.calls}`);
        assert.deepEqual(strip(one.gd), strip(seq.gd));
        if (overrides.color && overrides.color.type === 'obs') {
            assert.ok(one.gd.data.length >= KINDS.length, 'one trace per category');
            return;
        }
        const trace = one.gd.data[0];
        assert.ok(Array.isArray(trace.marker.color) && trace.marker.color.length > 0);
        assert.ok(trace._azOrder, 'sorted by colour, so strong values are drawn last');
    });
}

test('deprecated keys are renamed as Plotly renames them', () => {
    const data = [{ marker: { colorbar: { title: { text: 't', side: 'right' } } } }];
    applyRestyle(data, {}, { 'marker.colorbar.titleside': 'bottom', 'marker.colorbar.titlefont': { size: 9 } }, [0]);
    assert.deepEqual(data[0].marker.colorbar.title, { text: 't', side: 'bottom', font: { size: 9 } });
    assert.equal('titleside' in data[0].marker.colorbar, false);
    const layout = {};
    applyRelayout(layout, { 'xaxis.title': 'x', title: 'top', 'legend.title.font': { size: 2 } });
    assert.deepEqual(layout.xaxis, { title: { text: 'x' } });
    assert.deepEqual(layout.title, { text: 'top' });
    assert.deepEqual(layout.legend.title.font, { size: 2 });
});
