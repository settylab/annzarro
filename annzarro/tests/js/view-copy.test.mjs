/**
 * The view that C copies and a paste applies: descriptor, matching by coordinate, transport.
 *
 * Run:  node --test annzarro/tests/js/view-copy.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    coordinateId, buildViewDescriptor, parseView, planView, viewMessage, describeTarget, applyPlan, roundRange,
    capture, match, apply
} from '../../../static/js/utils/view-descriptor.js';
import { readView, viewHtml, entityOf, VIEW_MIME } from '../../../static/js/utils/view-copy.js';
import { legacyCopy, copyTextWith } from '../../../static/js/utils/clipboard.js';

const umap = (column) => ({ type: 'obsm', key: 'X_umap', column: String(column) });
const pca = (column) => ({ type: 'obsm', key: 'X_pca', column: String(column) });
const camera = { eye: { x: 1, y: 2, z: 3 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 }, projection: { type: 'orthographic' } };

function graph(settings, ranges, extra = {}) {
    const ax = (r) => ({ type: 'linear', range: r });
    const fl = settings.z
        ? { scene: { xaxis: ax(ranges.x), yaxis: ax(ranges.y), zaxis: ax(ranges.z), camera, aspectmode: 'cube' } }
        : { xaxis: ax(ranges.x), yaxis: ax(ranges.y) };
    return { _fullLayout: fl, __azSettings: settings, __azDrawnDataset: '/d/a.zarr', ...extra };
}

test('coordinateId: matrix columns are dims, plain columns have none', () => {
    assert.deepEqual(coordinateId(umap(1)), { key: 'obsm:X_umap', dim: 1 });
    assert.deepEqual(coordinateId({ type: 'obs', key: 'total_counts', column: '' }), { key: 'obs:total_counts', dim: null });
    assert.deepEqual(coordinateId({ type: 'layer', key: 'counts', column: 'CELL1' }), { key: 'layer:counts', dim: 'CELL1' });
    assert.equal(coordinateId(null), null);
    assert.equal(coordinateId({ type: 'obs', key: '' }), null);
});

test('descriptor: coordinates by identity, ranges ascending, 2D has no camera', () => {
    const d = buildViewDescriptor(graph({ x: umap(0), y: umap(1) }, { x: [5, 1], y: [2, 4] }), { x: umap(0), y: umap(1) },
        { dataset: '/d/a.zarr', entity: { kind: 'cell', id: 'c1' }, panel: 'cell-plot' });
    assert.equal(d.schema, 'annzarro-view');
    assert.equal(d.dims, 2);
    assert.equal(d.camera, null);
    assert.deepEqual(d.axes, [{ axis: 'x', key: 'obsm:X_umap', dim: 0, range: [1, 5] }, { axis: 'y', key: 'obsm:X_umap', dim: 1, range: [2, 4] }]);
});

test('descriptor: 3D has camera, three axes and the aspect; text axes are left out', () => {
    const s = { x: umap(0), y: umap(1), z: { type: 'obs', key: 'total_counts', column: '' } };
    const d = buildViewDescriptor(graph(s, { x: [0, 1], y: [0, 2], z: [0, 3] }), s, { dataset: '/d/a.zarr' });
    assert.equal(d.dims, 3);
    assert.deepEqual(d.camera.eye, camera.eye);
    assert.equal(d.camera.projection.type, 'orthographic');
    assert.equal(d.aspect.mode, 'cube');
    assert.equal(d.axes.length, 3);
    const g = graph({ x: umap(0), y: umap(1) }, { x: [0, 1], y: [0, 1] });
    g._fullLayout.yaxis.type = 'category';
    assert.deepEqual(buildViewDescriptor(g, g.__azSettings, {}).axes.map(a => a.axis), ['x']);
    g._fullLayout.xaxis.type = 'category';
    assert.equal(buildViewDescriptor(g, g.__azSettings, {}), null);
});

function src(axes, dims = 2, dataset = '/d/a.zarr', cam = null) {
    return { schema: 'annzarro-view', version: 1, dataset, dims, axes, camera: cam };
}
const target = (s, dataset = '/d/a.zarr', flipped = {}) => ({
    dataset, settings: s,
    axes: { x: { numeric: true, flipped: !!flipped.x }, y: { numeric: true, flipped: !!flipped.y }, z: { numeric: true, flipped: false } }
});
const A = [{ axis: 'x', key: 'obsm:X_umap', dim: 0, range: [1, 2] }, { axis: 'y', key: 'obsm:X_umap', dim: 1, range: [3, 4] }];

test('same embedding: both ranges set', () => {
    const p = planView(src(A), target({ x: umap(0), y: umap(1) }));
    assert.equal(p.status, 'applied');
    assert.deepEqual(p.update, { 'xaxis.range': [1, 2], 'yaxis.range': [3, 4] });
    assert.equal(viewMessage(p), 'View applied (x, y)');
});

test('swapped axes map by coordinate', () => {
    const p = planView(src(A), target({ x: umap(1), y: umap(0) }));
    assert.deepEqual(p.update, { 'xaxis.range': [3, 4], 'yaxis.range': [1, 2] });
});

test('partial match: the other axis keeps its range', () => {
    const p = planView(src(A), target({ x: pca(0), y: umap(1) }));
    assert.deepEqual(p.update, { 'yaxis.range': [3, 4] });
    assert.deepEqual(p.applied, ['y']);
});

test('no matching coordinate: nothing is set', () => {
    const p = planView(src(A), target({ x: pca(0), y: pca(1) }));
    assert.equal(p.status, 'none');
    assert.deepEqual(p.update, {});
    assert.equal(viewMessage(p), 'No matching coordinates');
});

test('the same key with another dim is another coordinate', () => {
    assert.equal(planView(src(A), target({ x: umap(5), y: umap(6) })).status, 'none');
});

test('a flipped target axis runs high to low', () => {
    const p = planView(src(A), target({ x: umap(0), y: umap(1), flipY: true }, '/d/a.zarr', { y: true }));
    assert.deepEqual(p.update['yaxis.range'], [4, 3]);
    assert.deepEqual(p.update['xaxis.range'], [1, 2]);
});

test('a text axis in the target is never given a numeric range', () => {
    const t = target({ x: umap(0), y: umap(1) });
    t.axes.x.numeric = false;
    assert.deepEqual(planView(src(A), t).applied, ['y']);
});

test('another dataset: not applied, and it says so', () => {
    const p = planView(src(A, 2, '/d/b.zarr'), target({ x: umap(0), y: umap(1) }));
    assert.equal(p.status, 'dataset');
    assert.deepEqual(p.update, {});
    assert.equal(viewMessage(p), 'View not applied: copied from another dataset');
});

const Z = { type: 'obs', key: 'total_counts', column: '' };
const A3 = [...A, { axis: 'z', key: 'obs:total_counts', dim: null, range: [0, 9] }];

test('3D to 3D on the same coordinates: ranges and camera', () => {
    const p = planView(src(A3, 3, '/d/a.zarr', camera), target({ x: umap(0), y: umap(1), z: Z }));
    assert.deepEqual(p.update['scene.xaxis.range'], [1, 2]);
    assert.deepEqual(p.update['scene.zaxis.range'], [0, 9]);
    assert.deepEqual(p.update['scene.camera'].eye, camera.eye);
    assert.equal(p.update['scene.camera'].projection.type, 'orthographic');
    assert.match(viewMessage(p), /camera/);
});

test('3D to 3D with the axes permuted: ranges by coordinate, no camera', () => {
    const p = planView(src(A3, 3, '/d/a.zarr', camera), target({ x: umap(1), y: umap(0), z: Z }));
    assert.deepEqual(p.update['scene.xaxis.range'], [3, 4]);
    assert.equal(p.update['scene.camera'], undefined);
});

test('3D to 3D with one axis different: ranges that match, no camera', () => {
    const p = planView(src(A3, 3, '/d/a.zarr', camera), target({ x: umap(0), y: umap(1), z: { type: 'obs', key: 'n_genes', column: '' } }));
    assert.deepEqual(Object.keys(p.update).sort(), ['scene.xaxis.range', 'scene.yaxis.range']);
});

test('3D to 2D: only the matching ranges, no camera; 2D to 3D likewise', () => {
    const p = planView(src(A3, 3, '/d/a.zarr', camera), target({ x: umap(0), y: umap(1) }));
    assert.deepEqual(p.update, { 'xaxis.range': [1, 2], 'yaxis.range': [3, 4] });
    const q = planView(src(A), target({ x: umap(0), y: umap(1), z: Z }));
    assert.deepEqual(q.update, { 'scene.xaxis.range': [1, 2], 'scene.yaxis.range': [3, 4] });
});

test('parse and read: bad schema, newer version, custom type, html flavour', () => {
    const d = src(A);
    assert.equal(parseView('nope'), null);
    assert.equal(parseView(JSON.stringify({ ...d, schema: 'x' })), null);
    assert.equal(parseView(JSON.stringify({ ...d, version: 2 })), null);
    assert.equal(parseView(JSON.stringify({ ...d, axes: [{ axis: 'q', key: 'k', range: [0, 1] }, ...A] })).axes.length, 2);
    const json = JSON.stringify(d);
    assert.equal(readView({ getData: (t) => (t === VIEW_MIME ? json : '') }).dims, 2);
    const html = viewHtml('c1\nx: <1>', d);
    assert.doesNotMatch(html, /<1>/);
    assert.equal(readView({ getData: (t) => (t === 'text/html' ? html : '') }).axes.length, 2);
    assert.equal(readView({ getData: () => '' }), null);
    assert.equal(readView(null), null);
});

test('describeTarget: the graph is read live; a graph never drawn is no target', () => {
    const g = graph({ x: umap(0), y: umap(1), flipY: true }, { x: [0, 1], y: [1, 0] });
    const t = describeTarget(g, '/d/other');
    assert.equal(t.dataset, '/d/a.zarr');
    assert.equal(t.axes.y.flipped, true);
    assert.equal(describeTarget({ _fullLayout: {} }), null);
});

test('applyPlan: one relayout for the panel, none when nothing applies', async () => {
    const calls = [];
    const plotly = { relayout: async (gd, u) => { calls.push(u); } };
    await applyPlan({}, { status: 'applied', update: { a: 1 }, applied: ['x'] }, plotly);
    await applyPlan({}, { status: 'none', update: {}, applied: [] }, plotly);
    assert.deepEqual(calls, [{ a: 1 }]);
});

test('entityOf: the first hover line names the cell or the gene', () => {
    assert.deepEqual(entityOf('AAAC\nx: 1', 'cell-plot-1'), { kind: 'cell', id: 'AAAC' });
    assert.deepEqual(entityOf('CD3E\nx: 1', 'gene-plot-2'), { kind: 'gene', id: 'CD3E' });
    assert.equal(entityOf('', 'cell-plot-1'), null);
});

// transport: the copy event fires inside the gesture and the page sets the flavours
function copyDoc({ exec = true } = {}) {
    const listeners = [];
    const set = {};
    const doc = {
        activeElement: null, body: { appendChild() {} },
        getSelection: () => null,
        addEventListener: (t, fn) => listeners.push([t, fn]),
        removeEventListener: (t, fn) => { const i = listeners.findIndex(l => l[0] === t && l[1] === fn); if (i >= 0) listeners.splice(i, 1); },
        createElement: () => ({ style: {}, setAttribute() {}, focus() {}, select() {}, setSelectionRange() {}, remove() {} }),
        execCommand() {
            let prevented = false;
            for (const [t, fn] of [...listeners]) if (t === 'copy') fn({ clipboardData: { setData: (k, v) => { set[k] = v; } }, preventDefault: () => { prevented = true; } });
            return exec && prevented;
        }
    };
    return { doc, set, listeners };
}

test('transport: text/plain is the hover text alone, the descriptor is the custom type, the listener is removed', () => {
    const { doc, set, listeners } = copyDoc();
    const json = JSON.stringify(src(A));
    assert.equal(legacyCopy('c1\nx: 1', doc, { [VIEW_MIME]: json }), true);
    assert.equal(set['text/plain'], 'c1\nx: 1');
    assert.equal(set[VIEW_MIME], json);
    assert.equal(set['text/html'], undefined);
    assert.equal(listeners.length, 0);
});

test('transport: without extras no copy listener is added', () => {
    const { doc, listeners } = copyDoc();
    doc.addEventListener = (t, fn) => listeners.push([t, fn]);
    legacyCopy('a', doc);
    assert.equal(listeners.length, 0);
});

test('copyTextWith: a failed flavoured copy falls back to the text alone', async () => {
    const { doc } = copyDoc({ exec: false });
    let wrote = null;
    const nav = { clipboard: { writeText: async (t) => { wrote = t; } } };
    assert.equal(await copyTextWith('c1', { [VIEW_MIME]: '{}' }, { doc, nav, secure: true }), true);
    assert.equal(wrote, 'c1');
});

test('roundRange: 4 digits of the span, so near-equal views are one view', () => {
    assert.deepEqual(roundRange([0.123456789, 1.987654321]), [0.1235, 1.988]);
    assert.deepEqual(roundRange([5000.123, 5000.9876]), [5000.123, 5000.988]);
    assert.deepEqual(roundRange([100000.1, 100002.9]), [100000.1, 100002.9]);
    assert.deepEqual(roundRange(roundRange([0.1234567, 2.7654321])), roundRange([0.1234567, 2.7654321]));
    assert.deepEqual(roundRange([1, 1]), [1, 1]);
    const g = graph({ x: umap(0), y: umap(1) }, { x: [0.12345678, 1.98765432], y: [2, 4] });
    assert.deepEqual(buildViewDescriptor(g, g.__azSettings, {}).axes[0].range, [0.1235, 1.988]);
});

test('shared names: capture, match, apply', () => {
    assert.equal(capture, buildViewDescriptor);
    assert.equal(match, planView);
    assert.equal(apply, applyPlan);
});
