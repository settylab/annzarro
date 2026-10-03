/**
 * Binary vector replies (`format=f32`) and the data layer that consumes them:
 * decoding, the JSON-shaped arrays handed to the views, request coalescing,
 * and the cache's size estimate.
 *
 * Run:  node --test annzarro/tests/js/wire.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = { addEventListener() {}, dispatchEvent() {}, getElementById: () => null };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const { decodeVector, toJSONShape, toPlainArray } = await import('../../../static/js/utils/wire.js');
const { CacheManager } = await import('../../../static/js/cache-manager.js');
const { DataManager } = await import('../../../static/js/data-manager.js');

// --- helpers -------------------------------------------------------------------

function denseBody(values, Ctor = Float32Array) {
    return new Ctor(values).buffer;
}

function sparseBody(n, entries, Ctor = Float32Array) {
    const nnz = entries.length;
    const buf = new ArrayBuffer(nnz * (Ctor.BYTES_PER_ELEMENT + 4));
    const vals = new Ctor(buf, 0, nnz);
    const pos = new Uint32Array(buf, nnz * Ctor.BYTES_PER_ELEMENT, nnz);
    entries.forEach(([p, v], i) => { pos[i] = p; vals[i] = v; });
    return buf;
}

function binaryResponse(buffer, { shape, dtype = 'float32', encoding = 'dense', nnz } = {}) {
    const headers = {
        'Content-Type': 'application/octet-stream',
        'X-Annzarro-Shape': shape.join(','),
        'X-Annzarro-Dtype': dtype,
        'X-Annzarro-Encoding': encoding,
    };
    if (nnz !== undefined) headers['X-Annzarro-Nnz'] = String(nnz);
    return new Response(buffer, { status: 200, headers });
}

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const DS = '/data/t.zarr';
const CELLS = ['c0', 'c1', 'c2', 'c3'];
const GENES = ['g0', 'g1', 'g2'];

/** Route fetches by path; records every URL requested. */
function installFetch(routes) {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url, signal: init.signal });
        const u = new URL(url, 'http://localhost');
        for (const [prefix, handler] of routes) {
            if (u.pathname.startsWith(prefix)) return handler(u, init);
        }
        return jsonResponse({ error: 'not found' }, 404);
    };
    return calls;
}

async function loadDataset() {
    installFetch([
        ['/api/v1/data/dataset_structure', () => jsonResponse({ shape: [4, 3] })],
        ['/api/v1/data/cells', () => jsonResponse({ cells: CELLS })],
        ['/api/v1/data/genes', () => jsonResponse({ genes: GENES })],
    ]);
    await DataManager.setCurrentDataset(DS, true);
}

// --- decoding --------------------------------------------------------------------

test('dense float32 decodes with NaN kept, and JSON-shapes NaN as null', () => {
    const d = decodeVector(denseBody([1.5, NaN, -2, Infinity]),
        new Headers({ 'X-Annzarro-Shape': '4,1', 'X-Annzarro-Dtype': 'float32', 'X-Annzarro-Encoding': 'dense' }));
    assert.deepEqual(d.shape, [4, 1]);
    assert.ok(d.values instanceof Float32Array);
    assert.ok(Number.isNaN(d.values[1]));
    assert.deepEqual(toJSONShape(d), [[1.5], [null], [-2], [null]]);
    assert.deepEqual(toJSONShape(d, true), [1.5, null, -2, null]);
});

test('sparse decodes to the dense row; float64 keeps what float32 cannot', () => {
    const d = decodeVector(sparseBody(6, [[1, 0.25], [4, 1e-60]], Float64Array),
        { 'X-Annzarro-Shape': '1,6', 'X-Annzarro-Dtype': 'float64', 'X-Annzarro-Encoding': 'sparse', 'X-Annzarro-Nnz': '2' });
    assert.ok(d.values instanceof Float64Array);
    assert.deepEqual(Array.from(d.values), [0, 0.25, 0, 0, 1e-60, 0]);
    assert.deepEqual(toJSONShape(d), [[0, 0.25, 0, 0, 1e-60, 0]]);
});

test('float32 values reach JS exactly as the old JSON delivered them', () => {
    // tolist() wrote float32 0.1 as its float64 widening; so does Float32Array.
    const d = decodeVector(denseBody([0.1]), { 'X-Annzarro-Shape': '1' });
    assert.equal(toPlainArray(d.values)[0], 0.10000000149011612);
});

test('a body that does not match its headers is rejected, not misread', () => {
    assert.throws(() => decodeVector(denseBody([1, 2, 3]), { 'X-Annzarro-Shape': '4' }), /expected 16/);
    assert.throws(() => decodeVector(new ArrayBuffer(7),
        { 'X-Annzarro-Shape': '9', 'X-Annzarro-Encoding': 'sparse', 'X-Annzarro-Nnz': '1' }), /expected 8/);
    assert.throws(() => decodeVector(new ArrayBuffer(0), { 'X-Annzarro-Shape': 'x' }), /Malformed/);
});

test('2-D slices nest by row unless they are a single row or column', () => {
    const d = { values: Float32Array.from([1, 2, 3, 4, 5, 6]), shape: [2, 3] };
    assert.deepEqual(toJSONShape(d, true), [[1, 2, 3], [4, 5, 6]]);
    assert.deepEqual(toJSONShape({ values: new Float32Array(0), shape: [0] }), []);
});

// --- loaders -------------------------------------------------------------------

test('loadLayer asks for f32 and hands the plot a flat gene column', async () => {
    await loadDataset();
    CacheManager.clear();
    const calls = installFetch([['/api/v1/data/layer/fc', () =>
        binaryResponse(denseBody([0.5, NaN, 2, 3]), { shape: [4, 1] })]]);
    const res = await DataManager.loadLayer({ datasetPath: DS, layerName: 'fc', cols: [1] });
    assert.deepEqual(res.data, [0.5, null, 2, 3]);
    assert.equal(res.layer_name, 'fc');
    const u = new URL(calls[0].url, 'http://localhost');
    assert.equal(u.searchParams.get('format'), 'f32');
    assert.equal(u.searchParams.get('cols'), '1');
});

test('loadObsp keeps the [row] shape, densified from sparse', async () => {
    await loadDataset();
    CacheManager.clear();
    installFetch([['/api/v1/data/obsp/connectivities', () =>
        binaryResponse(sparseBody(4, [[2, 0.75]]), { shape: [1, 4], encoding: 'sparse', nnz: 1 })]]);
    const res = await DataManager.loadObsp({ datasetPath: DS, obspKey: 'connectivities', rows: [1] });
    assert.deepEqual(res.data, [[0, 0, 0.75, 0]]);
});

test('loadObs: a numeric column comes binary, a categorical one as JSON', async () => {
    CacheManager.clear();
    installFetch([['/api/v1/data/obs', (u) => u.searchParams.get('columns') === 'score'
        ? binaryResponse(denseBody([1, 2, 3, 4], Float64Array), { shape: [4], dtype: 'float64' })
        : jsonResponse({ data: { kind: ['a', 'b', 'a', 'b'] }, categories: { kind: ['a', 'b'] } })]]);
    const num = await DataManager.loadObs({ datasetPath: DS, columns: ['score'] });
    assert.deepEqual(num.data, { score: [1, 2, 3, 4] });
    const cat = await DataManager.loadObs({ datasetPath: DS, columns: ['kind'] });
    assert.deepEqual(cat.categories, { kind: ['a', 'b'] });
    assert.deepEqual(cat.data.kind, ['a', 'b', 'a', 'b']);
});

test('loadObsm sends column 0 instead of fetching the whole matrix', async () => {
    CacheManager.clear();
    const calls = installFetch([['/api/v1/data/obsm/X_umap', () =>
        binaryResponse(denseBody([1, 2, 3, 4]), { shape: [4] })]]);
    const res = await DataManager.loadObsm({ datasetPath: DS, obsmKey: 'X_umap', columnName: 0 });
    assert.deepEqual(res.data, [1, 2, 3, 4]);
    assert.equal(new URL(calls[0].url, 'http://localhost').searchParams.get('column_name'), '0');
    const none = await DataManager.loadObsm({ datasetPath: DS, obsmKey: 'X_umap', columnName: '' });
    assert.deepEqual(none.data, []);
    assert.equal(calls.length, 1, 'an empty column name must not request the whole matrix');
});

test('an error reply still rejects with the server message', async () => {
    CacheManager.clear();
    installFetch([['/api/v1/data/layer/fc', () => jsonResponse(
        { error: 'Response too large', reason: 'response_too_large' }, 413)]]);
    await assert.rejects(DataManager.loadLayer({ datasetPath: DS, layerName: 'fc', cols: [0] }),
        (e) => e.status === 413 && e.data.reason === 'response_too_large');
});

// --- coalescing ----------------------------------------------------------------

function deferredFetch() {
    const pending = [];
    const calls = [];
    globalThis.fetch = (url, init = {}) => {
        calls.push({ url, signal: init.signal });
        return new Promise((resolve, reject) => {
            pending.push({ resolve, reject });
            init.signal?.addEventListener('abort',
                () => reject(new DOMException('aborted', 'AbortError')));
        });
    };
    return { calls, pending };
}

test('concurrent identical requests share one fetch', async () => {
    CacheManager.clear();
    const { calls, pending } = deferredFetch();
    const a = DataManager.loadObsm({ datasetPath: DS, obsmKey: 'X_umap', columnName: '1' });
    const b = DataManager.loadObsm({ datasetPath: DS, obsmKey: 'X_umap', columnName: '1' });
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.length, 1);
    pending[0].resolve(binaryResponse(denseBody([9, 8, 7, 6]), { shape: [4] }));
    assert.deepEqual((await a).data, [9, 8, 7, 6]);
    assert.deepEqual((await b).data, [9, 8, 7, 6]);
    // The finished request now comes from the short-lived cache.
    await DataManager.loadObsm({ datasetPath: DS, obsmKey: 'X_umap', columnName: '1' });
    assert.equal(calls.length, 1);
});

test('one waiter aborting does not cancel the request for the others', async () => {
    CacheManager.clear();
    const { calls, pending } = deferredFetch();
    const ac = new AbortController();
    const a = DataManager.getDatasetStructure('/x.zarr', ac.signal);
    const b = DataManager.getDatasetStructure('/x.zarr');
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.length, 1);
    ac.abort();
    await assert.rejects(a, { name: 'AbortError' });
    assert.equal(calls[0].signal.aborted, false);
    pending[0].resolve(jsonResponse({ shape: [1, 1] }));
    assert.deepEqual(await b, { shape: [1, 1] });
});

test('when every waiter aborts, the request is cancelled and the next caller starts afresh', async () => {
    CacheManager.clear();
    const { calls, pending } = deferredFetch();
    const ac = new AbortController();
    const a = DataManager.getDatasetStructure('/y.zarr', ac.signal);
    await new Promise(r => setTimeout(r, 0));
    ac.abort();
    await assert.rejects(a, { name: 'AbortError' });
    assert.equal(calls[0].signal.aborted, true);
    const b = DataManager.getDatasetStructure('/y.zarr');
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.length, 2);
    pending[1].resolve(jsonResponse({ shape: [2, 2] }));
    assert.deepEqual(await b, { shape: [2, 2] });
});

test('a failed shared request rejects every waiter and is not cached', async () => {
    CacheManager.clear();
    const { calls, pending } = deferredFetch();
    const a = DataManager.getDatasetStructure('/z.zarr');
    const b = DataManager.getDatasetStructure('/z.zarr');
    await new Promise(r => setTimeout(r, 0));
    pending[0].resolve(jsonResponse({ error: 'boom' }, 500));
    await assert.rejects(a, /boom/);
    await assert.rejects(b, /boom/);
    const c = DataManager.getDatasetStructure('/z.zarr');
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.length, 2);
    pending[1].resolve(jsonResponse({ ok: 1 }));
    assert.deepEqual(await c, { ok: 1 });
});
