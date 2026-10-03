/* global Plotly -- stubbed on globalThis below */
/**
 * Moving the focused-cell highlight must never leave an unhandled rejection.
 *
 * Reproduced headless on the demo view C (three UMAPs, two in a vertical
 * split squeezed by their control bars): every focus change logged
 *   Unhandled promise rejection: Something went wrong with axis scaling
 * from plot-update.js highlightFocusedEntity. It called
 * Plotly.update(plot, traceUpdate, <deep copy of the whole layout>), which
 * re-ran the axis scaling; on a degenerate plot area Plotly THROWS from
 * there (synchronously), inside a focus-change event handler, so nobody
 * could catch it. The first highlight after a restore took the other branch,
 * addTraces(...).then(() => relayout(layout)), where the same throw became a
 * rejection of a promise nobody held.
 *
 * Now the existing marker moves with restyle (no layout re-sent), and both
 * branches settle into a promise that resolves after logging a warning.
 *
 * Run:  node --test annzarro/tests/js/focus-highlight.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    getElementById: () => null, addEventListener() {}, dispatchEvent() {}
};

const calls = [];
let failMode = null;     // 'sync' | 'async' | null
const fail = (fn) => {
    if (failMode === 'sync') throw new Error('Something went wrong with axis scaling');
    if (failMode === 'async') return Promise.reject(new Error('Something went wrong with axis scaling'));
    return Promise.resolve();
};
globalThis.Plotly = {
    update: (...a) => { calls.push(['update', a]); return fail(); },
    restyle: (...a) => { calls.push(['restyle', a]); return fail(); },
    relayout: (...a) => { calls.push(['relayout', a]); return fail(); },
    addTraces: (...a) => { calls.push(['addTraces', a]); return Promise.resolve(); },
    deleteTraces: () => Promise.resolve(),
    setPlotConfig: () => {}
};

const { DataManager } = await import('../../../static/js/data-manager.js');
const { highlightFocusedEntity } = await import('../../../static/js/panels/plot-utilities/plot-update.js');
DataManager.getFocusedCell = () => 'c1';

const settings = {
    x: { type: 'obsm', key: 'X_umap', column: '0' }, y: { type: 'obsm', key: 'X_umap', column: '1' },
    z: null, pointSize: 3, highlightFocusedCell: true, showAxisTitles: true
};
const data = { entities: 'cells', cells: ['c0', 'c1', 'c2'], x: { values: [0, 1, 2] }, y: { values: [5, 6, 7] }, colorType: 'numerical' };
const plot = (withHighlight) => ({
    data: withHighlight ? [{ name: 'data' }, { name: 'Focused Cell', x: [0], y: [5] }] : [{ name: 'data' }],
    layout: { xaxis: { title: { text: '' }, range: [0, 2] }, yaxis: { title: { text: '' }, range: [5, 7] }, legend: { x: 1.05 } }
});

let unhandled = [];
process.on('unhandledRejection', (e) => unhandled.push(e));
const quiet = console.warn;

async function run(withHighlight, mode) {
    calls.length = 0; unhandled = []; failMode = mode;
    const warnings = [];
    console.warn = (...a) => warnings.push(a.join(' '));
    try {
        const p = highlightFocusedEntity(plot(withHighlight), data, settings, 'cells');
        await p;
        await new Promise(r => setTimeout(r, 10));
    } finally { console.warn = quiet; }
    return { warnings, unhandled: unhandled.slice() };
}

for (const mode of ['sync', 'async']) {
    test(`moving an existing highlight survives a ${mode} Plotly failure`, async () => {
        const { warnings, unhandled } = await run(true, mode);
        assert.equal(unhandled.length, 0, 'unhandled rejection escaped');
        assert.match(warnings.join('\n'), /highlight update skipped: Something went wrong with axis scaling/);
    });
    test(`adding the first highlight survives a ${mode} relayout failure`, async () => {
        const { warnings, unhandled } = await run(false, mode);
        assert.equal(unhandled.length, 0, 'unhandled rejection escaped');
        assert.match(warnings.join('\n'), /highlight add skipped/);
    });
}

test('moving the highlight restyles only that trace and does not resend the layout', async () => {
    await run(true, null);
    assert.deepEqual(calls.map(c => c[0]), ['restyle']);
    const [, [, update, indices]] = calls[0];
    assert.deepEqual(update, { x: [[1]], y: [[6]] });
    assert.deepEqual(indices, [1]);
});

test('the first highlight is added at the focused cell and the view is restored', async () => {
    await run(false, null);
    assert.deepEqual(calls.map(c => c[0]), ['addTraces', 'relayout']);
    assert.deepEqual(calls[0][1][1].x, [1]);
    assert.deepEqual(calls[1][1][1]['xaxis.range'], [0, 2]);
    assert.equal(calls[1][1][1].legend, undefined, 'the rest of the layout is not re-sent');
});

test('two focus changes during the first add leave ONE highlight trace', async () => {
    calls.length = 0; failMode = null;
    const gd = plot(false);
    const realAdd = Plotly.addTraces;
    Plotly.addTraces = (container, trace) => {
        calls.push(['addTraces']);
        return new Promise(r => setTimeout(() => { container.data.push(trace); r(); }, 20));
    };
    try {
        await Promise.all([
            highlightFocusedEntity(gd, data, settings, 'cells'),
            highlightFocusedEntity(gd, data, settings, 'cells')
        ]);
    } finally { Plotly.addTraces = realAdd; }
    assert.equal(gd.data.filter(t => t.name === 'Focused Cell').length, 1);
    assert.deepEqual(calls.map(c => c[0]), ['addTraces', 'relayout', 'restyle']);
});

test('a 3D plot (scene, no xaxis title) gets its highlight without a page error', async () => {
    // protocol-integration threw "Cannot set properties of undefined (setting
    // 'text')" here for every new gene plot (3D on varm PCs by default)
    calls.length = 0; failMode = null; unhandled = [];
    const s3 = { ...settings, z: { type: 'obsm', key: 'X_pca', column: '2' } };
    const d3 = { ...data, z: { values: [9, 8, 7] } };
    const gd = { data: [{ name: 'data' }], layout: { scene: { camera: { eye: { x: 1, y: 2, z: 3 } } } } };
    await highlightFocusedEntity(gd, d3, s3, 'cells');
    await new Promise(r => setTimeout(r, 10));
    assert.equal(unhandled.length, 0);
    assert.deepEqual(calls.map(c => c[0]), ['addTraces', 'relayout']);
    assert.equal(calls[0][1][1].type, 'scatter3d');
    assert.deepEqual(calls[1][1][1]['scene.camera'], { eye: { x: 1, y: 2, z: 3 } });
});

test('a size/opacity step is two restyles, not a highlight rebuild (#8)', async () => {
    const { restyleMarkers } = await import('../../../static/js/panels/plot-utilities/plot-update.js');
    failMode = null;
    calls.length = 0;
    const gd = { data: [{ name: 'HSC' }, { name: 'GMP' }, { name: 'Focused Cell' }, { name: 'LMPP' }] };
    await restyleMarkers(gd, { pointSize: 4, pointOpacity: 0.3 });
    assert.deepEqual(calls.map(c => c[0]), ['restyle', 'restyle']);
    assert.deepEqual(calls[0][1].slice(1), [{ 'marker.size': 4, 'marker.opacity': 0.3 }, [0, 1, 3]]);
    assert.deepEqual(calls[1][1].slice(1), [{ 'marker.size': 8 }, [2]]);
});

// --- a focused cell the subset does not show: the hollow ring (PR D) -------

/** DataManager as it answers for 'out', a cell of another part at row 42. */
function stubOutside({ value = (axis) => (axis.column === '0' ? 10 : 20) } = {}) {
    const saved = { ...DataManager };
    const reads = [];
    Object.assign(DataManager, {
        getFocusedCell: () => 'out',
        locateCell: async (name) => ({ name, position: -1, row: 42, shown: false }),
        cellRowParams: (cell) => (cell && !cell.shown ? { dataset_rows: String(cell.row) } : null),
        loadCellValue: async (axis) => { reads.push(axis); return value(axis); }
    });
    return { reads, restore: () => Object.assign(DataManager, saved) };
}

const ringGraph = () => ({ isConnected: true, data: [{ name: 'data' }], layout: plot(false).layout });

test('an outside focus is drawn as a hollow ring at its own coordinates', async () => {
    calls.length = 0; failMode = null;
    const { reads, restore } = stubOutside();
    try {
        await highlightFocusedEntity(ringGraph(), data, settings, 'cells');
    } finally { restore(); }
    assert.deepEqual(reads.map(a => a.column), ['0', '1'], 'one read per axis');
    const adds = calls.filter(c => c[0] === 'addTraces');
    assert.equal(adds.length, 1);
    const ring = adds[0][1][1];
    assert.deepEqual([ring.x, ring.y], [[10], [20]]);
    assert.equal(ring.marker.symbol, 'circle-open', 'hollow, not the filled dot of a shown cell');
    assert.equal(ring.name, 'Focused Cell', 'left out of hover, counts and size steps like the highlight');
    assert.equal(ring.hoverinfo, 'skip', 'the points under it keep their hover and clicks');
    assert.equal(ring.marker.colorscale, undefined, 'not coloured by the colour axis');
});

test('no ring for an obsp axis, nor in large-plot mode', async () => {
    for (const [s, d] of [
        [{ ...settings, y: { type: 'obsp', key: 'distances', column: 'out' } }, data],
        [settings, { ...data, large: true }]
    ]) {
        calls.length = 0;
        const { reads, restore } = stubOutside();
        try {
            await highlightFocusedEntity(ringGraph(), d, s, 'cells');
        } finally { restore(); }
        assert.equal(reads.length, 0);
        assert.equal(calls.filter(c => c[0] === 'addTraces').length, 0);
    }
});

test('no ring when a value cannot be read, or when the focus moves meanwhile', async () => {
    calls.length = 0;
    let stub = stubOutside({ value: () => null });
    try {
        await highlightFocusedEntity(ringGraph(), data, settings, 'cells');
    } finally { stub.restore(); }
    assert.equal(calls.filter(c => c[0] === 'addTraces').length, 0);

    calls.length = 0;
    let focused = 'out';
    stub = stubOutside({ value: () => { focused = 'c1'; return 1; } });
    DataManager.getFocusedCell = () => focused;
    try {
        await highlightFocusedEntity(ringGraph(), data, settings, 'cells');
    } finally { stub.restore(); }
    assert.equal(calls.filter(c => c[0] === 'addTraces').length, 0);
});

test('a shown focus after a ring replaces it with the filled dot', async () => {
    calls.length = 0;
    const gd = ringGraph();
    const { restore } = stubOutside();
    try {
        await highlightFocusedEntity(gd, data, settings, 'cells');
    } finally { restore(); }
    assert.equal(gd.__focusRing, true);
    gd.data.push({ name: 'Focused Cell', x: [10], y: [20] });
    calls.length = 0;
    const deleted = [];
    const realDelete = Plotly.deleteTraces;
    Plotly.deleteTraces = (container, idx) => { deleted.push(idx); container.data = container.data.filter((_, i) => !idx.includes(i)); return Promise.resolve(); };
    try {
        await highlightFocusedEntity(gd, data, settings, 'cells');    // focus 'c1' is shown
    } finally { Plotly.deleteTraces = realDelete; }
    assert.deepEqual(deleted, [[1]], 'the ring is removed, not moved');
    const add = calls.find(c => c[0] === 'addTraces');
    assert.ok(add, 'the dot is added');
    assert.notEqual(add[1][1].marker.symbol, 'circle-open');
    assert.equal(gd.__focusRing, false);
});
