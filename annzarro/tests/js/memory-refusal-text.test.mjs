/**
 * The sentence beside a refused control (static/js/utils/memory-guard-ui.js
 * refusalText): the guard's reason, then the ways out. A browser that cannot allocate
 * is not helped by closing other plots, so that advice goes.
 *
 * Run:  node --test annzarro/tests/js/memory-refusal-text.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = { addEventListener() {}, getElementById: () => null, createElement: () => ({}), querySelectorAll: () => [] };
globalThis.fetch = async () => ({ ok: false, statusText: 'test' });

const { refusalText } = await import('../../../static/js/utils/memory-guard-ui.js');
const ADVICE = 'Close a plot, or show fewer cells (a smaller subset).';

test('memory: the reason and both ways out', () => {
    assert.equal(refusalText({ binding: 'total', why: 'needs ~16 GB of browser memory; 12 GB free (of 12 GB, estimated)' }, ADVICE),
        'Needs ~16 GB of browser memory; 12 GB free (of 12 GB, estimated). Close a plot, or show fewer cells (a smaller subset).');
});

test('the browser cannot allocate: only a smaller step helps', () => {
    assert.equal(refusalText({ binding: 'alloc', why: 'this browser cannot allocate the ~6.0 GB the export needs' }, ADVICE),
        'This browser cannot allocate the ~6.0 GB the export needs. Show fewer cells (a smaller subset).');
});
