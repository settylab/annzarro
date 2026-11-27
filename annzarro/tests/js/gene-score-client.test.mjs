/**
 * The browser's reading of the score route's reply
 * (static/js/utils/gene-score-client.js): JSON lines, then the float32 bytes.
 *
 * Run:  node --test annzarro/tests/js/gene-score-client.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const C = await import('../../../static/js/utils/gene-score-client.js');

const enc = new TextEncoder();
const line = (obj) => enc.encode(`${JSON.stringify(obj)}\n`);
const floats = (...v) => new Uint8Array(new Float32Array(v).buffer);
const cat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
};

/** A Response-like with the body cut into `size` byte chunks. */
function reply(bytes, size = 7, { ok = true, status = 200 } = {}) {
    return {
        ok, status,
        body: { getReader() {
            let at = 0;
            return {
                async read() {
                    if (at >= bytes.length) return { done: true };
                    const value = bytes.slice(at, at + size);
                    at += size;
                    return { done: false, value };
                },
                async cancel() {}
            };
        } },
        async text() { return new TextDecoder().decode(bytes); },
        async json() { return JSON.parse(new TextDecoder().decode(bytes)); }
    };
}

const result = (n, extra = {}) => ({ type: 'result', scored: true, n_used: 2, byte_length: n * 4, dtype: 'float32', ...extra });

test('progress frames, the result frame, then the values', async () => {
    const seen = [];
    const body = cat(line({ type: 'progress', done: 0, total: 3 }), line({ type: 'progress', done: 3, total: 3 }),
        line(result(4)), floats(0.5, -1, NaN, 2));
    for (const size of [1, 3, 7, 1000]) {
        seen.length = 0;
        const out = await C.readScoreStream(reply(body, size), { onProgress: (d, t) => seen.push([d, t]) });
        assert.deepEqual(seen, [[0, 3], [3, 3]], `chunks of ${size}`);
        assert.equal(out.header.n_used, 2);
        assert.ok(out.values instanceof Float32Array);
        assert.equal(out.values[0], 0.5);
        assert.equal(out.values[1], -1);
        assert.ok(Number.isNaN(out.values[2]));
        assert.equal(out.values[3], 2);
    }
});

test('a result with no values (no gene is in the dataset) is not an error', async () => {
    const body = cat(line({ type: 'result', scored: false, reason: 'no_gene_present', message: 'None.', byte_length: 0 }));
    const out = await C.readScoreStream(reply(body));
    assert.equal(out.values, null);
    assert.equal(out.header.reason, 'no_gene_present');
});

test('an error frame after the stream began fails the read with the server\'s reason', async () => {
    const body = cat(line({ type: 'progress', done: 1, total: 3 }), line({ type: 'error', reason: 'read_failed', message: 'Failed to read the dataset: x' }));
    await assert.rejects(C.readScoreStream(reply(body)), (e) => e.reason === 'read_failed' && /Failed to read/.test(e.message));
});

test('a stream cut before the result, or inside the values, has failed', async () => {
    await assert.rejects(C.readScoreStream(reply(cat(line({ type: 'progress', done: 1, total: 3 })))), (e) => e.reason === 'stream_cut');
    const cut = cat(line(result(4)), floats(1, 2));
    await assert.rejects(C.readScoreStream(reply(cut, 5)), (e) => e.reason === 'stream_cut');
});

test('a refusal is an error with the status, the reason and the estimate', async () => {
    const body = enc.encode(JSON.stringify({ error: 'This score would take about 25 minutes.', reason: 'score_too_expensive',
        estimate: { seconds: 1500, tier: 'refused' } }));
    const error = await C.errorOf(reply(body, 1000, { ok: false, status: 413 }));
    assert.equal(error.status, 413);
    assert.equal(error.reason, 'score_too_expensive');
    assert.equal(error.estimate.seconds, 1500);
    assert.match(error.message, /25 minutes/);
});

test('the api posts the recipe in the body, the dataset in the query, the subset and confirm only when given', async () => {
    const posts = [];
    const fetchImpl = async (url, init) => {
        posts.push({ url, body: JSON.parse(init.body), method: init.method });
        const body = init.body.includes('estimate_only')
            ? enc.encode(JSON.stringify({ estimate: { seconds: 1, tier: 'auto' } }))
            : cat(line(result(1)), floats(3));
        return reply(body, 1000);
    };
    const api = C.createScoreApi({ url: '/api/v1/data/gene_score', fetchImpl });
    const recipe = { genes: ['B', 'A'], down: [], input: 'X', method: 'zscore_mean', clip: 10, seed: null, version: 1, title: 'must not be sent' };
    const est = await api.estimate({ recipe, dataset: 'a b.zarr' });
    assert.equal(est.estimate.tier, 'auto');
    const out = await api.compute({ recipe, dataset: 'a b.zarr', subset: 'k1', confirm: true, signal: null, onProgress() {} });
    assert.equal(out.values[0], 3);
    assert.equal(posts[0].method, 'POST');
    assert.match(posts[0].url, /^\/api\/v1\/data\/gene_score\?dataset_path=a\+b\.zarr$/);
    assert.equal(posts[0].body.estimate_only, true);
    assert.equal('title' in posts[0].body.recipe, false, 'the title is not part of the recipe the server reads');
    assert.equal(posts[1].body.subset, 'k1');
    assert.equal(posts[1].body.confirm, true);
    assert.equal('estimate_only' in posts[1].body, false);
});

test('errorOf keeps the figures of a size refusal: count, limit, axis, mode', async () => {
    const body = enc.encode(JSON.stringify({ error: 'too many', reason: 'too_many_levels', count: 46, limit: 8, axis: 2, mode: '2d' }));
    const error = await C.errorOf(reply(body, 1000, { ok: false, status: 422 }));
    assert.deepEqual(error.figures, { count: 46, limit: 8, axis: 2, mode: '2d' });
    const plain = await C.errorOf(reply(enc.encode(JSON.stringify({ error: 'x', reason: 'bad_x' })), 1000, { ok: false, status: 422 }));
    assert.equal(plain.figures, null);
});
