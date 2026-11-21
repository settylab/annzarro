/**
 * The browser's side of POST /api/v1/data/cell_groups (static/js/utils/cell-groups-client.js): the body, the estimate,
 * the refusals before the stream, and the stream (frames, then blocks sized by `length` or by `shape`).
 *
 * Run:  node --test annzarro/tests/js/cell-groups-client.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const C = await import('../../../static/js/utils/cell-groups-client.js');

const enc = new TextEncoder();
const line = (obj) => enc.encode(`${JSON.stringify(obj)}\n`);
const bytesOf = (typed) => new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
const cat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
};

/** A Response-like 200 whose body arrives in pieces of `size` bytes. */
function streamed(bytes, size = 7) {
    const pieces = [];
    for (let i = 0; i < bytes.length; i += size) pieces.push(bytes.slice(i, i + size));
    return {
        ok: true, status: 200,
        body: { getReader() {
            let i = 0;
            return {
                async read() { return i < pieces.length ? { done: false, value: pieces[i++] } : { done: true }; },
                async cancel() {}
            };
        } }
    };
}

/** A Response-like refusal with a JSON body. */
const refusal = (status, body) => ({ ok: false, status, text: async () => JSON.stringify(body), json: async () => body });

function fetching(responses) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        const next = responses.shift();
        return typeof next === 'function' ? next() : next;
    };
    return { calls, api: C.createGroupsApi({ url: '/api/v1/data/cell_groups', fetchImpl }) };
}

const request = { shape: 'grouping', partitionings: [{ source: { type: 'obs', key: 'cell_type' } }],
    small: { threshold: 10, mode: 'keep' }, subset: null, want: { codes: true, histograms: [] } };

const codes = new Uint8Array([0, 1, 1, 255, 0]);
const moments = Float64Array.from({ length: 2 * 2 * 5 }, (_, i) => i + 0.5);
const start = { type: 'start', codes: 'miss', lane: 'light', entries_total: 600, queue: { ahead: 1, sharing: 0 } };
const progress = { type: 'progress', stage: 'features', done: 1, total: 2, entries_done: 300, entries_total: 600,
    running_s: 1.5, queue: { ahead: 0, sharing: 0 } };
const result = { type: 'result', version: 1, shape: 'grouping', n_shown: 5, n_grouped: 4,
    partitionings: [{ kind: 'categorical', levels: [{ id: 'c:B cell', n: 2 }, { id: 'c:T cell', n: 2 }] }],
    groups: [{ key: ['c:B cell'], n: 2 }, { key: ['c:T cell'], n: 2 }],
    features: [{ id: 'f0', status: 'ok' }, { id: 'f1', status: 'ok' }], measures: [],
    moments: ['n', 'sum', 'sumsq', 'n_above', 'sum_above'],
    blocks: [{ name: 'codes', dtype: 'uint8', length: 5 }, { name: 'feature_moments', dtype: 'float64', shape: [2, 2, 5] }] };
const stream = cat(line(start), line(progress), line(result), bytesOf(codes), bytesOf(moments));

test('a computation posts the request with the dataset in the query and the cells shown in the body', async () => {
    const { calls, api } = fetching([streamed(stream)]);
    await api.compute({ recipe: request, dataset: 'd.zarr', subset: 'sub-1', confirm: true, onProgress() {} });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/v1/data/cell_groups?dataset_path=d.zarr');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(calls[0].body, { ...request, subset: 'sub-1', confirm: true });
    assert.equal(request.subset, null, 'the request given is not edited');
});

test('no subset and no confirmation: the body says subset null and has no confirm', async () => {
    const { calls, api } = fetching([streamed(stream)]);
    await api.compute({ recipe: request, dataset: 'd.zarr', subset: null, confirm: false });
    assert.deepEqual(calls[0].body, request);
});

test('the stream: frames before the result reach onProgress in stored entries, then every block, at any chunking', async () => {
    for (const size of [1, 3, 7, 64, stream.length]) {
        const seen = [];
        const { api } = fetching([streamed(stream, size)]);
        const out = await api.compute({ recipe: request, dataset: 'd.zarr', subset: null, confirm: false,
            onProgress: (done, total, frame) => seen.push([done, total, frame.type, frame.queue]) });
        assert.deepEqual(seen, [[0, 600, 'start', { ahead: 1, sharing: 0 }], [300, 600, 'progress', { ahead: 0, sharing: 0 }]]);
        assert.equal(out.header.shape, 'grouping');
        assert.deepEqual([...out.values.codes], [...codes]);
        assert.ok(out.values.feature_moments instanceof Float64Array);
        assert.deepEqual([...out.values.feature_moments], [...moments], `chunks of ${size}`);
    }
});

test('a grid block of shape [a, b] is sized by its shape', async () => {
    const counts = Uint32Array.from([1, 2, 3, 4, 5, 6]);
    const grid = { type: 'result', version: 1, shape: 'grid', n_shown: 21, axes: [{ levels: [] }, { levels: [] }],
        blocks: [{ name: 'counts', dtype: 'uint32', shape: [2, 3] }] };
    const { api } = fetching([streamed(cat(line(grid), bytesOf(counts)))]);
    const out = await api.compute({ recipe: { ...request, shape: 'grid' }, dataset: 'd.zarr', subset: null, confirm: false });
    assert.deepEqual([...out.values.counts], [1, 2, 3, 4, 5, 6]);
});

test('too many groups is a result with nothing in it, its reason lifted to the header', async () => {
    const refused = { type: 'result', version: 1, shape: 'grouping', n_shown: 8090,
        refused: { reason: 'too_many_groups', count: 6840, limit: 2000, levels: [380] } };
    const { api } = fetching([streamed(line(refused))]);
    const out = await api.compute({ recipe: request, dataset: 'd.zarr', subset: null, confirm: false });
    assert.equal(out.header.reason, 'too_many_groups');
    assert.deepEqual(out.header.refused, refused.refused);
    assert.deepEqual(out.values, {});
});

test('the estimate posts estimate_only and returns the reply', async () => {
    const reply = { estimate: { seconds: 2, tier: 'live', live_max_s: 5, auto_max_s: 60, max_s: 600, lane: 'light' }, missing: {} };
    const { calls, api } = fetching([{ ok: true, status: 200, json: async () => reply }]);
    assert.deepEqual(await api.estimate({ recipe: request, dataset: 'd.zarr' }), reply);
    assert.deepEqual(calls[0].body, { ...request, estimate_only: true });
});

test('refusals before the stream are errors with status, reason and estimate', async () => {
    const estimate = { seconds: 120, tier: 'confirm' };
    const cases = [
        [409, { error: 'Confirm first.', reason: 'confirmation_required', estimate }],
        [413, { error: 'Too expensive.', reason: 'groups_too_expensive', estimate }],
        [422, { error: 'The grid is too large.', reason: 'grid_too_large', count: 3000000, limit: 2097152 }]
    ];
    for (const [status, body] of cases) {
        const { api } = fetching([refusal(status, body)]);
        await assert.rejects(api.compute({ recipe: request, dataset: 'd.zarr', subset: null, confirm: false }), (error) => {
            assert.equal(error.status, status);
            assert.equal(error.reason, body.reason);
            assert.equal(error.message, body.error);
            assert.deepEqual(error.estimate, body.estimate || null);
            return true;
        });
        const again = fetching([refusal(status, body)]);
        await assert.rejects(again.api.estimate({ recipe: request, dataset: 'd.zarr' }), { status });
    }
});

test('a busy server is an error frame read_busy; a cut stream is stream_cut', async () => {
    const busy = { type: 'error', reason: 'read_busy', message: 'The server stayed busy.' };
    const one = fetching([streamed(cat(line(start), line(busy)))]);
    await assert.rejects(one.api.compute({ recipe: request, dataset: 'd.zarr', subset: null, confirm: false }),
        { reason: 'read_busy', message: 'The server stayed busy.' });
    const cut = fetching([streamed(cat(line(result), bytesOf(codes)))]);
    await assert.rejects(cut.api.compute({ recipe: request, dataset: 'd.zarr', subset: null, confirm: false }),
        { reason: 'stream_cut' });
});
