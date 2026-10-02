/**
 * Slider redraws are coalesced: never two at once, never more than one
 * waiting, and the newest value always lands (issue #8).
 *
 * The point size / opacity sliders used to redraw on every input event behind
 * a 5 ms debounce. A redraw took ~320 ms on bm_aging, so a drag stacked them
 * and the page stopped taking input for most of a second at a time.
 *
 * Run:  node --test annzarro/tests/js/render-queue.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { coalesce } = await import('../../../static/js/utils/render-queue.js');

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

/** A redraw whose completion the test controls. */
function controlledRun() {
    const calls = [];
    let active = 0, maxActive = 0;
    const releases = [];
    const run = (...args) => {
        calls.push(args);
        active++; maxActive = Math.max(maxActive, active);
        return new Promise(resolve => releases.push(() => { active--; resolve(); }));
    };
    return { run, calls, releaseNext: () => releases.shift()(), get maxActive() { return maxActive; } };
}

const immediate = { delay: 0, afterRun: () => Promise.resolve() };

test('a burst while idle runs once, with the newest arguments', async () => {
    const c = controlledRun();
    const request = coalesce(c.run, immediate);
    for (let i = 1; i <= 50; i++) request(i);
    await tick(5);
    assert.deepEqual(c.calls, [[50]]);
    c.releaseNext();
    await request.flush();
    assert.equal(c.calls.length, 1);
    assert.equal(request.pending(), false);
});

test('requests during a run collapse into ONE follow-up run with the newest arguments', async () => {
    const c = controlledRun();
    const request = coalesce(c.run, immediate);
    request('a');
    await tick(5);
    assert.deepEqual(c.calls, [['a']]);
    for (const v of ['b', 'c', 'd', 'e']) request(v);   // while 'a' is drawing
    await tick(5);
    assert.equal(c.calls.length, 1, 'nothing starts before the running draw finished');
    c.releaseNext();
    await tick(5);
    assert.deepEqual(c.calls, [['a'], ['e']]);
    c.releaseNext();
    await request.flush();
    assert.equal(c.maxActive, 1, 'two draws never overlap');
});

test('the next draw waits for afterRun (the paint), not only for the promise', async () => {
    const c = controlledRun();
    let painted;
    const request = coalesce(c.run, { delay: 0, afterRun: () => new Promise(r => { painted = r; }) });
    request(1);
    await tick(5);
    request(2);
    c.releaseNext();
    await tick(5);
    assert.equal(c.calls.length, 1, 'still waiting for the frame');
    painted();
    await tick(5);
    assert.deepEqual(c.calls, [[1], [2]]);
    c.releaseNext();
    await tick(5);
    painted();
    await request.flush();
});

test('a failing draw is reported and does not wedge the queue', async () => {
    const errors = [];
    let n = 0;
    const request = coalesce(async (v) => { n++; if (v === 'bad') throw new Error('boom'); },
        { ...immediate, onError: e => errors.push(e.message) });
    request('bad');
    await request.flush();
    request('good');
    await request.flush();
    assert.deepEqual(errors, ['boom']);
    assert.equal(n, 2);
});

test('while idle it waits the trailing delay before drawing', async () => {
    const c = controlledRun();
    const request = coalesce(c.run, { delay: 40, afterRun: () => Promise.resolve() });
    request(1);
    await tick(10);
    request(2);
    assert.equal(c.calls.length, 0);
    await tick(60);
    assert.deepEqual(c.calls, [[2]]);
    c.releaseNext();
    await request.flush();
});
