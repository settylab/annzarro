/**
 * G9e: the per-cell CSV of a grouping (GRP-18): cell name and group, up to a million cells, on request.
 *
 *   - the columns and their order, RFC 4180 quoting of a name (comma, quote, line break), "Not in any group";
 *   - codes of two bytes (over 255 groups) read their own missing value;
 *   - past 1,000,000 cells the offer is disabled with its reason, and nothing is requested: no watch, no names, no guard;
 *   - the memory guard is asked before the codes, and a refusal asks for nothing;
 *   - the build yields to the page between chunks, and 1M rows build inside a stated bound, linearly.
 *
 * Run:  node --test annzarro/tests/js/cell-export.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const X = await import('../../../static/js/panels/cell-grouping/cell-export.js');

const WORDS = Object.freeze({
    cellName: 'Cell name', groupName: 'Group name', notInAnyGroup: 'Not in any group',
    tooManyCells: (limit) => `Up to ${limit.toLocaleString('en-US')} cells`, failed: 'The cells could not be exported'
});
const noWait = () => Promise.resolve();

/** The CSV of codes and names, built the way the page builds it: through exportCells over fake group sources. */
async function csvOf({ names, codes, groupNames, rowsPerChunk, yieldTurn = noWait }) {
    const deps = {
        cells: () => codes.length, refusal: () => null, names: async () => names,
        sources: { watch: () => ({ read: () => ({ state: 'ready', values: { codes, reply: {} } }), release() {} }), namesOf: () => groupNames }
    };
    const out = await X.exportCells({ id: 'g', deps, words: WORDS, rowsPerChunk, yieldTurn });
    assert.equal(out.ok, true);
    return out.parts;
}

test('the columns are cell name then group name, one row a cell, in cell order', async () => {
    const parts = await csvOf({ names: ['c0', 'c1', 'c2'], codes: Uint8Array.from([1, 0, 1]), groupNames: ['T', 'B'] });
    assert.equal(parts.join(''), 'Cell name,Group name\nc0,B\nc1,T\nc2,B\n');
});

test('a cell in no group reads "Not in any group" (1-byte missing 255)', async () => {
    const parts = await csvOf({ names: ['a', 'b'], codes: Uint8Array.from([255, 0]), groupNames: ['T'] });
    assert.equal(parts.join(''), 'Cell name,Group name\na,Not in any group\nb,T\n');
});

test('RFC 4180: a comma, a quote and a line break in a name are quoted, a quote doubled', async () => {
    const names = ['a,b', 'say "hi"', 'two\nlines', 'plain'];
    const parts = await csvOf({ names, codes: Uint8Array.from([0, 0, 1, 255]), groupNames: ['x,y', 'q"r'] });
    assert.equal(parts.join(''),
        'Cell name,Group name\n"a,b","x,y"\n"say ""hi""","x,y"\n"two\nlines","q""r"\nplain,Not in any group\n');
});

test('codes of two bytes (over 255 groups) keep their groups and read 65535 as missing', async () => {
    const groups = Array.from({ length: 300 }, (_, i) => `g${i}`);
    const codes = Uint16Array.from([0, 255, 299, 65535]);
    const parts = await csvOf({ names: ['a', 'b', 'c', 'd'], codes, groupNames: groups });
    assert.equal(parts.join(''), 'Cell name,Group name\na,g0\nb,g255\nc,g299\nd,Not in any group\n');
});

test('255 is a real group in two-byte codes, not the missing value', async () => {
    const groups = Array.from({ length: 300 }, (_, i) => `g${i}`);
    const parts = await csvOf({ names: ['a'], codes: Uint16Array.from([255]), groupNames: groups });
    assert.match(parts.join(''), /a,g255\n$/);
});

test('the build yields to the page once between chunks, not once a row', async () => {
    let yields = 0;
    const n = 25;
    const names = Array.from({ length: n }, (_, i) => `c${i}`);
    const parts = await csvOf({ names, codes: new Uint8Array(n), groupNames: ['T'], rowsPerChunk: 10, yieldTurn: () => { yields++; return Promise.resolve(); } });
    assert.equal(yields, 2);
    assert.equal(parts.join('').split('\n').length, n + 2);
});

test('the export is open up to 1,000,000 cells and refused with its reason above', async () => {
    const at = fakes({ cells: 1000000 });
    assert.equal((await X.exportCells({ id: 'g', deps: at.deps, words: WORDS, yieldTurn: noWait })).ok, true);
    const over = fakes({ cells: 1000001 });
    const out = await X.exportCells({ id: 'g', deps: over.deps, words: WORDS, yieldTurn: noWait });
    assert.deepEqual(out, { ok: false, reason: 'Up to 1,000,000 cells' });
});

/** The page's side as fakes, counting every request. */
function fakes({ cells, codes = Uint8Array.from([0, 1, 255]), groups = ['T', 'B'], refusal = null, state = 'ready' }) {
    const calls = { watch: 0, names: 0, refusal: 0, release: 0, order: [] };
    const deps = {
        cells: () => cells,
        refusal: () => { calls.refusal++; calls.order.push('refusal'); return refusal; },
        names: async () => { calls.names++; return Array.from({ length: codes.length }, (_, i) => `c${i}`); },
        sources: {
            watch(id, opts) {
                calls.watch++; calls.order.push('watch');
                calls.consumer = opts.consumer;
                const snap = state === 'ready' ? { state, values: { codes, reply: { groups } } } : { state, values: null };
                return { read: () => snap, release: () => { calls.release++; } };
            },
            namesOf: (id, reply) => reply.groups
        }
    };
    return { deps, calls };
}

test('over the limit nothing is requested: no guard, no watch, no names', async () => {
    const { deps, calls } = fakes({ cells: 1000001 });
    const out = await X.exportCells({ id: 'cell-grouping-1', deps, words: WORDS, yieldTurn: noWait });
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'Up to 1,000,000 cells');
    assert.deepEqual([calls.watch, calls.names, calls.refusal], [0, 0, 0]);
});

test('the guard is asked before the codes, and a refusal asks for nothing', async () => {
    const refused = fakes({ cells: 3, refusal: { why: 'needs 2 GB, 1 GB free' } });
    const out = await X.exportCells({ id: 'g', deps: refused.deps, words: WORDS, yieldTurn: noWait });
    assert.deepEqual(out, { ok: false, reason: 'needs 2 GB, 1 GB free' });
    assert.deepEqual([refused.calls.watch, refused.calls.names], [0, 0]);
    const fine = fakes({ cells: 3 });
    const done = await X.exportCells({ id: 'g', deps: fine.deps, words: WORDS, yieldTurn: noWait });
    assert.equal(done.ok, true);
    assert.deepEqual(fine.calls.order, ['refusal', 'watch']);
});

test('a ready grouping gives the CSV, reads the codes as an export consumer and lets go of them', async () => {
    const { deps, calls } = fakes({ cells: 3 });
    const out = await X.exportCells({ id: 'g', deps, words: WORDS, yieldTurn: noWait });
    assert.equal(out.parts.join(''), 'Cell name,Group name\nc0,T\nc1,B\nc2,Not in any group\n');
    assert.equal(calls.consumer.kind, 'inspect-export');
    assert.equal(calls.release, 1);
    assert.equal(calls.names, 1);
});

test('groups that cannot be read say so and ask for no names', async () => {
    const { deps, calls } = fakes({ cells: 3, state: 'failed' });
    const out = await X.exportCells({ id: 'g', deps, words: WORDS, yieldTurn: noWait });
    assert.deepEqual(out, { ok: false, reason: WORDS.failed });
    assert.equal(calls.names, 0);
    assert.equal(calls.release, 1);
});

test('names that do not match the codes are refused, not written crooked', async () => {
    const { deps } = fakes({ cells: 3 });
    deps.names = async () => ['only one'];
    const out = await X.exportCells({ id: 'g', deps, words: WORDS, yieldTurn: noWait });
    assert.deepEqual(out, { ok: false, reason: WORDS.failed });
});

// ------------------------------------------------------------------------------------------------ timing

function synthetic(n, groups) {
    const names = new Array(n);
    const codes = new Uint8Array(n);
    for (let i = 0; i < n; i++) { names[i] = `AACGT-${i}-1`; codes[i] = i % 7 === 0 ? 255 : i % groups; }
    return { names, codes };
}
const GROUP_NAMES = Array.from({ length: 12 }, (_, i) => `Cluster ${i}`);
async function timed(n) {
    const { names, codes } = synthetic(n, GROUP_NAMES.length);
    let best = Infinity;
    for (let k = 0; k < 3; k++) {
        const t = performance.now();
        const parts = await csvOf({ names, codes, groupNames: GROUP_NAMES });
        best = Math.min(best, performance.now() - t);
        assert.equal(parts.join('').split('\n').length, n + 2);
    }
    return best;
}

test('1M rows build inside 2 s, and 1M costs under 15 times 100k', async () => {
    const small = await timed(100000);
    const large = await timed(1000000);
    console.log(`# cell-export timing: 100k ${small.toFixed(0)} ms, 1M ${large.toFixed(0)} ms`);
    assert.ok(large < 2000, `1M rows took ${large.toFixed(0)} ms (bound 2000)`);
    assert.ok(large < 15 * Math.max(small, 1), `1M took ${large.toFixed(0)} ms against 100k at ${small.toFixed(0)} ms (bound 15x)`);
});
