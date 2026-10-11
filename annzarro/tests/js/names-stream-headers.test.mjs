/**
 * The client chooses its packed path for /data/cells from the headers.
 *
 * A zarr store's reply is written as it is read, so it has no Content-Length;
 * the server sends X-Annzarro-Names (how many) and
 * X-Annzarro-Names-Bytes-Estimate (about how big). Before, a chunked reply
 * fell through to response.text() and an array of JS strings, which fails at
 * about 24M cells (V8's string length) and takes 3 GB of heap at 95.6M.
 *
 * Run:  node --test annzarro/tests/js/names-stream-headers.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { PackedNames, namesReplyPlan } from '../../../static/js/utils/packed-names.js';
import { DataManager } from '../../../static/js/data-manager.js';

const THRESHOLD = 256 * 1024 * 1024;
const NAMES = Array.from({ length: 50 }, (_, i) => `AAAC_${i}-1`);
const BODY = JSON.stringify({ cells: NAMES, dataset_path: '/d/x.zarr' });

const headers = (h) => new Headers(h);

test('the Content-Length decides when the reply has one', () => {
    const big = namesReplyPlan(headers({ 'Content-Length': String(THRESHOLD + 1) }), THRESHOLD);
    assert.deepEqual(big, { packed: true, size: THRESHOLD + 1, count: 0 });
    assert.equal(namesReplyPlan(headers({ 'Content-Length': String(THRESHOLD) }), THRESHOLD).packed, false);
});

test('a reply with no Content-Length is sized by the estimate and counted by X-Annzarro-Names', () => {
    const plan = namesReplyPlan(headers({
        'X-Annzarro-Names': '95624334', 'X-Annzarro-Names-Bytes-Estimate': '2093130083',
    }), THRESHOLD);
    assert.deepEqual(plan, { packed: true, size: 2093130083, count: 95624334 });
    const small = namesReplyPlan(headers({
        'X-Annzarro-Names': '200', 'X-Annzarro-Names-Bytes-Estimate': '4000' }), THRESHOLD);
    assert.equal(small.packed, false);
    assert.equal(small.count, 200);
});

test('a reply that says nothing is read as before', () => {
    assert.deepEqual(namesReplyPlan(headers({}), THRESHOLD), { packed: false, size: 0, count: 0 });
    assert.equal(namesReplyPlan(headers({ 'X-Annzarro-Names-Bytes-Estimate': 'soon' }), THRESHOLD).packed, false);
});

test('PackedNames sizes its offsets from the count, and grows if the count was short', async () => {
    const respond = () => new Response(BODY);
    const counted = await PackedNames.fromJSON(respond(), 'cells', 0, NAMES.length);
    assert.equal(counted.length, NAMES.length);
    assert.equal(counted.at(49), NAMES[49]);
    // a count too small for the body costs a growth, not a wrong answer
    const short = await PackedNames.fromJSON(respond(), 'cells', 0, 3);
    assert.deepEqual([...short], NAMES);
});

function withFetch(headersOf, body, run) {
    const real = globalThis.fetch;
    globalThis.fetch = async () => new Response(body, { status: 200, headers: headersOf });
    return run().finally(() => { globalThis.fetch = real; });
}

test('loadCells reads a chunked reply above the threshold into packed names', async () => {
    const cells = await withFetch({
        'Content-Type': 'application/json', 'X-Annzarro-Names': String(NAMES.length),
        'X-Annzarro-Names-Bytes-Estimate': String(THRESHOLD + 1),
    }, BODY, () => DataManager.loadCells('/d/x.zarr'));
    assert.ok(cells instanceof PackedNames, 'packed');
    assert.equal(cells.length, NAMES.length);
    assert.equal(cells[7], NAMES[7]);
});

test('loadCells keeps a plain array for a small reply, with or without the headers', async () => {
    const withHeaders = await withFetch({
        'Content-Type': 'application/json', 'X-Annzarro-Names': String(NAMES.length),
        'X-Annzarro-Names-Bytes-Estimate': '700',
    }, BODY, () => DataManager.loadCells('/d/x.zarr'));
    assert.ok(Array.isArray(withHeaders));
    assert.deepEqual(withHeaders, NAMES);
    const old = await withFetch({ 'Content-Type': 'application/json' }, BODY, () => DataManager.loadCells('/d/x.zarr'));
    assert.deepEqual(old, NAMES);
});
