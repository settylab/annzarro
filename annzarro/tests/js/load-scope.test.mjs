// One abort signal per load of a panel (static/js/utils/load-scope.js).
//
// A newer full load of a panel aborts every older load of it; a partial one
// (recolour, one axis) only an older load of its own kind; Cancel aborts all,
// and says it was the user's. Other panels are never touched.
//
// Run: `node --test annzarro/tests/js/load-scope.test.mjs` (node >= 18).
import test from 'node:test';
import assert from 'node:assert/strict';
import { beginLoad, endLoad, cancelLoads, wasCancelled, hasLoads } from '../../../static/js/utils/load-scope.js';

test('a newer full load aborts the older one, with an AbortError', () => {
    const host = {};
    const first = beginLoad(host, 'plot');
    const second = beginLoad(host, 'plot');
    assert.equal(first.aborted, true);
    assert.equal(first.reason.name, 'AbortError');
    assert.equal(second.aborted, false);
});

test('a full load aborts the partial ones; a partial one only its own kind', () => {
    const host = {};
    const colour = beginLoad(host, 'colour');
    const axisX = beginLoad(host, 'axis:x');
    const colour2 = beginLoad(host, 'colour');
    assert.equal(colour.aborted, true);
    assert.equal(axisX.aborted, false, 'a recolour must not drop an axis change still arriving');
    assert.equal(colour2.aborted, false);
    const plot = beginLoad(host, 'plot');
    assert.equal(axisX.aborted, true);
    assert.equal(colour2.aborted, true);
    assert.equal(plot.aborted, false);
});

test('another panel is never aborted', () => {
    const a = {}, b = {};
    const loadA = beginLoad(a, 'plot');
    const loadB = beginLoad(b, 'plot');
    beginLoad(a, 'plot');
    cancelLoads(a, true);
    assert.equal(loadA.aborted, true);
    assert.equal(loadB.aborted, false);
    assert.equal(hasLoads(b), true);
});

test('cancelLoads from the Cancel button is told from a superseded load', () => {
    const host = {};
    const old = beginLoad(host, 'plot');
    const current = beginLoad(host, 'plot');
    assert.equal(wasCancelled(old), false);
    assert.equal(cancelLoads(host, true), true);
    assert.equal(wasCancelled(current), true);
    assert.equal(wasCancelled(old), false);
    assert.equal(hasLoads(host), false);
    assert.equal(cancelLoads(host, true), false, 'nothing is running any more');
});

test('closing a panel aborts without saying the user cancelled', () => {
    const host = {};
    const load = beginLoad(host, 'table');
    cancelLoads(host);
    assert.equal(load.aborted, true);
    assert.equal(wasCancelled(load), false);
});

test('the update batch that asked for a load also ends it', () => {
    const host = {};
    const batch = new AbortController();
    const load = beginLoad(host, 'plot', batch.signal);
    assert.equal(load.aborted, false);
    batch.abort();
    assert.equal(load.aborted, true);
    assert.equal(beginLoad(host, 'plot', batch.signal).aborted, true, 'a batch already aborted starts no load');
});

test('endLoad forgets a finished load but not a newer one', () => {
    const host = {};
    const first = beginLoad(host, 'plot');
    const second = beginLoad(host, 'plot');
    endLoad(host, first);
    assert.equal(hasLoads(host), true);
    endLoad(host, second);
    assert.equal(hasLoads(host), false);
});
