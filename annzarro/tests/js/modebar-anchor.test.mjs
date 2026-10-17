/**
 * The toolbar sits at the top right corner of the plotting area, whatever the legend does.
 *
 * Run:  node --test annzarro/tests/js/modebar-anchor.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { modebarAnchor, syncModebarAnchor, watchModebarAnchor } from '../../../static/js/utils/modebar-anchor.js';

const layout = (extra = {}) => ({ width: 800, height: 500, _size: { l: 60, t: 40, w: 600, h: 380 }, ...extra });

test('2D: the corner of the axes, as offsets from the figure\'s top and right', () => {
    assert.deepEqual(modebarAnchor(layout()), { top: 40, right: 140 });
});

test('3D: the corner of the scene domain', () => {
    const scene = { domain: { x: [0, 0.5], y: [0.25, 0.75] } };
    assert.deepEqual(modebarAnchor(layout({ scene })), { top: 40 + 95, right: 800 - (60 + 300) });
});

test('no plot area yet, or a non-finite one: no anchor', () => {
    assert.equal(modebarAnchor(undefined), null);
    assert.equal(modebarAnchor({ width: 800 }), null);
    assert.equal(modebarAnchor(layout({ _size: { l: NaN, t: 0, w: 1, h: 1 } })), null);
});

test('a plot area wider than the figure does not give a negative offset', () => {
    assert.deepEqual(modebarAnchor({ width: 100, _size: { l: 0, t: -5, w: 120, h: 50 } }), { top: 0, right: 0 });
});

function fakeGd(fullLayout) {
    const box = { style: {} };
    const handlers = {};
    return {
        box, handlers, _fullLayout: fullLayout,
        querySelector: sel => (sel === '.modebar-container' ? box : null),
        on(ev, fn) { handlers[ev] = fn; },
        removeListener(ev, fn) { if (handlers[ev] === fn) delete handlers[ev]; }
    };
}

test('sync writes the container\'s top and right; watch redoes it after a redraw', () => {
    const gd = fakeGd(layout());
    watchModebarAnchor(gd);
    assert.deepEqual(gd.box.style, { top: '40px', right: '140px' });
    gd._fullLayout = layout({ width: 500 });
    gd.handlers.plotly_afterplot();
    assert.equal(gd.box.style.right, '0px');
});

test('a graph with no container or no layout is left alone; watching twice leaves one listener', () => {
    syncModebarAnchor({ querySelector: () => null });
    const gd = fakeGd(undefined);
    syncModebarAnchor(gd);
    assert.deepEqual(gd.box.style, {});
    watchModebarAnchor(gd);
    watchModebarAnchor(gd);
    assert.equal(Object.keys(gd.handlers).length, 1);
});
