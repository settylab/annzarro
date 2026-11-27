/**
 * The browser's reading of a compute stream (static/js/utils/frame-stream-client.js): JSON lines, then
 * the binary blocks the result frame lists. The chunk boundary is swept over every byte of the stream.
 *
 * Run:  node --test annzarro/tests/js/frame-stream-client.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const F = await import('../../../static/js/utils/frame-stream-client.js');
const S = await import('../../../static/js/utils/gene-score-client.js');

const enc = new TextEncoder();
const line = (obj) => enc.encode(`${JSON.stringify(obj)}\n`);
const bytesOf = (typed) => new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
const cat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
};

/** A Response-like whose body arrives in the given pieces. */
function reply(pieces) {
    return {
        ok: true, status: 200,
        body: { getReader() {
            let i = 0;
            return {
                async read() {
                    if (i >= pieces.length) return { done: true };
                    return { done: false, value: pieces[i++] };
                },
                async cancel() {}
            };
        } }
    };
}

/** Two pieces cut at `p`, the empty ones left out. */
const splitAt = (bytes, p) => [bytes.slice(0, p), bytes.slice(p)].filter(b => b.length);

const codes = new Uint8Array([0, 3, 1, 2, 255]);
const moments = new Float64Array([0.5, -1, 1e300, 2, NaN, -0]);
const counts = new Uint32Array([7, 0, 4294967295]);
const start = { type: 'start', codes: 'miss', lane: 'heavy', entries_total: 600, queue: { ahead: 1, sharing: 0 } };
const progress = { type: 'progress', stage: 'features', done: 1, total: 2, entries_done: 300, entries_total: 600,
    running_s: 1.5, queue: { ahead: 0, sharing: 1 } };
const result = { type: 'result', version: 1, shape: 'grouping', blocks: [
    { name: 'codes', dtype: 'uint8', length: 5 },
    { name: 'feature_moments', dtype: 'float64', length: 6, shape: [1, 2, 3] },
    { name: 'counts', dtype: 'uint32', length: 3 }] };
const stream = cat(line(start), line(progress), line(result), bytesOf(codes), bytesOf(moments), bytesOf(counts));

function same(got, want) {
    assert.equal(got.constructor, want.constructor);
    assert.deepEqual(Array.from(got), Array.from(want));
}

test('a stream with several blocks parses wherever the chunk boundary falls', async () => {
    for (let p = 0; p <= stream.length; p++) {
        const frames = [];
        const out = await F.readFrameStream(reply(splitAt(stream, p)), { onFrame: (f) => frames.push(f) });
        assert.deepEqual(frames, [start, progress], `cut at ${p}`);
        assert.equal(out.header.shape, 'grouping');
        same(out.blocks.codes, codes);
        same(out.blocks.feature_moments, moments);
        same(out.blocks.counts, counts);
    }
});

test('a stream delivered one byte at a time, or in three pieces at every pair of cuts near the blocks, parses', async () => {
    const out = await F.readFrameStream(reply(Array.from(stream, b => new Uint8Array([b]))));
    same(out.blocks.feature_moments, moments);
    const header = stream.length - codes.length - moments.byteLength - counts.byteLength;
    for (let a = header - 3; a <= stream.length; a++) {
        for (let b = a; b <= stream.length; b++) {
            const pieces = [stream.slice(0, a), stream.slice(a, b), stream.slice(b)].filter(x => x.length);
            const got = await F.readFrameStream(reply(pieces));
            same(got.blocks.codes, codes);
            same(got.blocks.counts, counts);
        }
    }
});

test('a stream cut anywhere before its last block is complete has failed', async () => {
    for (let n = 0; n < stream.length; n++) {
        await assert.rejects(F.readFrameStream(reply(splitAt(stream.slice(0, n), Math.floor(n / 2)))),
            (e) => e.reason === 'stream_cut', `cut after ${n} bytes`);
    }
});

test('an error frame fails the read with the server\'s reason; a busy server is read_busy', async () => {
    const body = cat(line(progress), line({ type: 'error', reason: 'read_busy', message: 'Other computations are using the server.' }));
    await assert.rejects(F.readFrameStream(reply([body])), (e) => e.reason === 'read_busy' && /Other computations/.test(e.message));
    await assert.rejects(F.readFrameStream(reply([line({ type: 'error' })]), { words: { failed: 'Grouping failed.' } }),
        (e) => e.reason === 'failed' && e.message === 'Grouping failed.');
});

test('an empty block, a block of an unknown type and bytes after the last block', async () => {
    const empty = { type: 'result', blocks: [{ name: 'codes', dtype: 'uint8', length: 0 }, { name: 'c', dtype: 'uint32', length: 3 }] };
    const out = await F.readFrameStream(reply([cat(line(empty), bytesOf(counts), enc.encode('trailing'))]));
    assert.equal(out.blocks.codes.length, 0);
    same(out.blocks.c, counts);
    const odd = { type: 'result', blocks: [{ name: 'x', dtype: 'complex128', length: 1 }] };
    await assert.rejects(F.readFrameStream(reply([line(odd)])), (e) => e.reason === 'bad_frame');
    await assert.rejects(F.readFrameStream(reply([enc.encode('{not json\n')])), (e) => e.reason === 'bad_frame');
});

test('the score stream tells its reader each progress frame, a queued one included', async () => {
    const queued = { type: 'progress', done: 0, total: 6, entries_done: 0, entries_total: 1200, running_s: 0, queue: { ahead: 2, sharing: 0 } };
    const moved = { ...queued, queue: { ahead: 1, sharing: 0 } };
    const running = { type: 'progress', done: 3, total: 6, entries_done: 600, entries_total: 1200, running_s: 0.4, queue: { ahead: 0, sharing: 0 } };
    const values = new Float32Array([1.5, -2]);
    const body = cat(line(queued), line(moved), line(running),
        line({ type: 'result', scored: true, byte_length: 8, dtype: 'float32' }), bytesOf(values));
    for (let p = 0; p <= body.length; p++) {
        const seen = [];
        const out = await S.readScoreStream(reply(splitAt(body, p)), { onProgress: (d, t, f) => seen.push([d, t, f.queue, f.entries_done]) });
        assert.deepEqual(seen, [[0, 6, { ahead: 2, sharing: 0 }, 0], [0, 6, { ahead: 1, sharing: 0 }, 0],
            [3, 6, { ahead: 0, sharing: 0 }, 600]]);
        same(out.values, values);
    }
});
