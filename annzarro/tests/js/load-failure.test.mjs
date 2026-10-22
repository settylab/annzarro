/**
 * A large plot whose data request got no answer (Safari: "Load failed"):
 * recognised (memory-guard.js isNetworkFailure) and said in plain words
 * (loadFailureText). A server that answered, even with an error, is not one.
 *
 * Run:  node --test annzarro/tests/js/load-failure.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { isNetworkFailure, loadFailureText, isOutOfMemory } from '../../../static/js/utils/memory-guard.js';

test('the engines\' failed fetch is a network failure', () => {
    for (const m of ['Load failed', 'Failed to fetch', 'NetworkError when attempting to fetch resource.',
        'Network request failed', 'The network connection was lost.']) {
        assert.ok(isNetworkFailure(new TypeError(m)), m);
    }
});

test('an answer from the server, an abort, or another error is not', () => {
    const served = Object.assign(new TypeError('Load failed'), { status: 500 });
    const withBody = Object.assign(new Error('Not found'), { data: { reason: 'not_found' } });
    const abort = new DOMException('aborted', 'AbortError');
    for (const e of [null, undefined, 'Load failed', served, withBody, abort, new Error('Load failed'),
        new TypeError('x is undefined'), new RangeError('Array buffer allocation failed')]) {
        assert.ok(!isNetworkFailure(e), String(e && e.message || e));
    }
    // out of memory has its own words
    assert.ok(isOutOfMemory(new RangeError('Array buffer allocation failed')));
});

test('the message names the points and the other plots, and the way out', () => {
    const t = loadFailureText(95624334, 3);
    assert.equal(t.headline, 'Could not load the 95.6 million points for this plot');
    assert.equal(t.lines[0], 'The browser probably ran out of memory with 3 other plots open, or lost the connection to the server.');
    assert.equal(t.lines[1], 'Close other plots, or plot a subset of cells, then try again.');
    assert.match(loadFailureText(1200000, 1).lines[0], /with 1 other plot open,/);
    assert.equal(loadFailureText(1200000, 1).headline, 'Could not load the 1.2 million points for this plot');
    assert.doesNotMatch(loadFailureText(5e6, 0).lines[0], /other plot/);
    for (const s of [t.headline, ...t.lines]) assert.ok(!/load failed/i.test(s.replace('Could not load', '')));
});
