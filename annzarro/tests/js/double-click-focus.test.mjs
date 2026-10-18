/**
 * A double click (Plotly's zoom reset) leaves the focus where it was.
 *
 * Each press of a double click is a click, so the first used to focus the
 * point under the pointer. A click now focuses once Plotly's double-click
 * window has passed without a second press near it.
 *
 * Run:  node --test annzarro/tests/js/double-click-focus.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    getElementById: () => null, addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => []
};
globalThis.fetch = async () => ({ ok: false, statusText: 'test' });

const { deferFocus, noteDoublePress, noteClickRelease, cancelDeferredFocus } =
    await import('../../../static/js/panels/plot-utilities/plot-make-helper.js');

const graph = (context = {}) => ({ _fullLayout: {}, isConnected: true, _context: context });
const at = (x, y) => ({ clientX: x, clientY: y });

// a click: press, release, then the focus the click asks for
function click(t, gd, x, y, log, name) {
    const seq = noteDoublePress(gd, at(x, y));
    deferFocus(gd, at(x, y), () => log.push(name), seq);
}

test('a single click focuses once the double-click window has passed', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const gd = graph(), log = [];
    click(t, gd, 100, 100, log, 'a');
    t.mock.timers.tick(299);
    assert.deepEqual(log, []);
    t.mock.timers.tick(1);
    assert.deepEqual(log, ['a']);
});

test('a second press near the first is a double click: nothing is focused', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const gd = graph(), log = [];
    click(t, gd, 100, 100, log, 'a');
    t.mock.timers.tick(120);
    click(t, gd, 102, 99, log, 'b');
    t.mock.timers.tick(2000);
    assert.deepEqual(log, []);
});

test('a third quick click after a double click is still part of it', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const gd = graph(), log = [];
    click(t, gd, 100, 100, log, 'a');
    t.mock.timers.tick(100);
    click(t, gd, 100, 100, log, 'b');
    t.mock.timers.tick(100);
    click(t, gd, 100, 100, log, 'c');
    t.mock.timers.tick(2000);
    assert.deepEqual(log, []);
});

test('a click far from the first, or after the window, focuses; the same spot slowly steps on', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const gd = graph(), log = [];
    click(t, gd, 100, 100, log, 'a');
    t.mock.timers.tick(100);
    click(t, gd, 300, 100, log, 'b');           // elsewhere: replaces the waiting one
    t.mock.timers.tick(300);
    assert.deepEqual(log, ['b']);
    t.mock.timers.tick(400);
    click(t, gd, 300, 100, log, 'c');           // the same spot, past the window
    t.mock.timers.tick(300);
    assert.deepEqual(log, ['b', 'c']);
});

test('a press that is not a click leaves the next click alone', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const gd = graph(), log = [];
    click(t, gd, 100, 100, log, 'a');
    t.mock.timers.tick(100);
    noteDoublePress(gd, at(101, 100));          // a drag: no click follows
    t.mock.timers.tick(1000);
    click(t, gd, 100, 100, log, 'b');
    t.mock.timers.tick(300);
    assert.deepEqual(log, ['b']);
});

test('a plot without double click does not wait', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const gd = graph({ doubleClick: false }), log = [];
    click(t, gd, 100, 100, log, 'a');
    assert.deepEqual(log, ['a']);
});

test('the plot\'s own double-click delay is the window', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const gd = graph({ doubleClickDelay: 500 }), log = [];
    click(t, gd, 100, 100, log, 'a');
    t.mock.timers.tick(499);
    assert.deepEqual(log, []);
    t.mock.timers.tick(1);
    assert.deepEqual(log, ['a']);
});

test('a plot drawn again or gone focuses nothing, and no timer is left', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const gd = graph(), log = [];
    click(t, gd, 100, 100, log, 'a');
    cancelDeferredFocus(gd);
    assert.equal(gd.__azDouble.timer, null);
    t.mock.timers.tick(1000);
    click(t, gd, 100, 100, log, 'b');
    gd.isConnected = false;                     // leaves the page in the window
    t.mock.timers.tick(1000);
    const purged = graph(); delete purged._fullLayout;
    click(t, purged, 100, 100, log, 'd');
    t.mock.timers.tick(1000);
    assert.deepEqual(log, []);
});

test('a click reported after the second press began is still dropped, and so is the second', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const gd = graph(), log = [];
    // Plotly's click of the first press reaches us after the second press began
    const first = noteDoublePress(gd, at(100, 100));
    noteClickRelease(gd, at(100, 100));
    t.mock.timers.tick(30);
    const second = noteDoublePress(gd, at(100, 100));
    deferFocus(gd, at(100, 100), () => log.push('a'), first);
    deferFocus(gd, at(100, 100), () => log.push('b'), second);
    t.mock.timers.tick(2000);
    assert.deepEqual(log, []);
});
