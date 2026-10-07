/**
 * Which scroller takes a wheel the browser would drop (utils/wheel-handover.js).
 *
 * Run:  node --test annzarro/tests/js/wheel-handover.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isScroller, hasRoom, findScrollers, nextWithRoom, pixelDelta } from
    '../../../static/js/utils/wheel-handover.js';

/** A fake element: content height, box height, scroll offset, overflow-y, parent. */
function box(scrollHeight, clientHeight, scrollTop = 0, overflowY = 'auto', parentElement = null) {
    return { scrollHeight, clientHeight, scrollTop, overflowY, parentElement };
}
const style = (el) => ({ overflowY: el.overflowY });

test('only overflow auto/scroll with more than a pixel beyond the box scrolls', () => {
    assert.equal(isScroller(box(500, 300), style), true);
    assert.equal(isScroller(box(500, 300, 0, 'scroll'), style), true);
    assert.equal(isScroller(box(500, 300, 0, 'hidden'), style), false);
    assert.equal(isScroller(box(500, 300, 0, 'visible'), style), false);
    assert.equal(isScroller(box(301, 300), style), false);   // rounding, not content
    assert.equal(isScroller(box(300, 300), style), false);
});

test('room in each direction', () => {
    assert.equal(hasRoom(box(500, 300, 0), 100), true);
    assert.equal(hasRoom(box(500, 300, 0), -100), false);
    assert.equal(hasRoom(box(500, 300, 200), 100), false);
    assert.equal(hasRoom(box(500, 300, 200), -100), true);
    assert.equal(hasRoom(box(500, 300, 199.7), 100), false);  // sub-pixel from the end
});

test('scrollers from the target out to the root, innermost first', () => {
    const page = box(2000, 900);
    const tile = box(900, 900, 0, 'auto', page);       // fits: not a scroller
    const body = box(800, 350, 0, 'auto', tile);
    const cell = box(24, 24, 0, 'visible', body);
    const outside = box(5000, 900, 0, 'auto');
    page.parentElement = outside;
    assert.deepEqual(findScrollers(cell, page, style), [body, page]);
});

test('the browser keeps the wheel while the inner scroller can move', () => {
    const page = box(2000, 900);
    const body = box(800, 350, 100, 'auto', page);
    assert.equal(nextWithRoom([body, page], 100), null);
    assert.equal(nextWithRoom([body, page], -100), null);
});

test('at its end the wheel goes to the next scroller out that can move', () => {
    const page = box(2000, 900, 0);
    const row = box(600, 400, 200, 'auto', page);       // also at its end
    const body = box(800, 350, 450, 'auto', row);
    assert.equal(nextWithRoom([body, row, page], 100), page);
    assert.equal(nextWithRoom([body, row, page], -100), null);   // the body can still move up
    page.scrollTop = 1100;                              // page at its end too
    assert.equal(nextWithRoom([body, row, page], 100), null);
});

test('upward at the top hands over as well', () => {
    const page = box(2000, 900, 500);
    const body = box(800, 350, 0, 'auto', page);
    assert.equal(nextWithRoom([body, page], -100), page);
});

test('no scroller under the pointer: the browser scrolls the page itself', () => {
    assert.equal(nextWithRoom([], 100), null);
});

test('wheel deltas in px, lines and pages', () => {
    assert.equal(pixelDelta({ deltaMode: 0, deltaY: 37 }, 900), 37);
    assert.equal(pixelDelta({ deltaMode: 1, deltaY: 3 }, 900), 48);
    assert.equal(pixelDelta({ deltaMode: 2, deltaY: -1 }, 900), -900);
});
