/**
 * The toolbar sits at the top right corner of the plotting area, whatever the legend does.
 *
 * Run:  node --test annzarro/tests/js/modebar-anchor.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLBAR_VERTICAL, TOOLBAR_HEIGHT, modebarAnchor, syncModebarAnchor, watchModebarAnchor } from '../../../static/js/utils/modebar-anchor.js';

const layout = (extra = {}) => ({ width: 800, height: 500, _size: { l: 60, t: 40, w: 600, h: 380 }, ...extra });

test('2D: the corner of the axes, as offsets from the figure\'s top and width', () => {
    assert.deepEqual(modebarAnchor(layout()), { top: 40, width: 660 });
});

test('"above": the toolbar sits in the top margin, held at the figure\'s top when the margin is thinner', () => {
    assert.deepEqual(modebarAnchor(layout(), 'above'), { top: 40 - TOOLBAR_HEIGHT, width: 660 });
    assert.deepEqual(modebarAnchor(layout({ _size: { l: 60, t: 8, w: 600, h: 380 } }), 'above'), { top: 0, width: 660 });
});

test('the default is the one the constant names', () => {
    assert.deepEqual(modebarAnchor(layout()), modebarAnchor(layout(), TOOLBAR_VERTICAL));
});

test('3D: the corner of the scene domain', () => {
    const scene = { domain: { x: [0, 0.5], y: [0.25, 0.75] } };
    assert.deepEqual(modebarAnchor(layout({ scene })), { top: 40 + 95, width: 60 + 300 });
});

test('no plot area yet, or a non-finite one: no anchor', () => {
    assert.equal(modebarAnchor(undefined), null);
    assert.equal(modebarAnchor({ width: 800 }), null);
    assert.equal(modebarAnchor(layout({ _size: { l: NaN, t: 0, w: 1, h: 1 } })), null);
});

test('a plot area starting above or left of the figure gives no negative offset', () => {
    assert.deepEqual(modebarAnchor({ width: 100, _size: { l: -130, t: -5, w: 120, h: 50 } }), { top: 0, width: 0 });
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
    assert.deepEqual(gd.box.style, { top: '40px', left: '0px', right: 'auto', width: '660px' });
    gd._fullLayout = layout({ _size: { l: 60, t: 40, w: 300, h: 380 } });
    gd.handlers.plotly_afterplot();
    assert.equal(gd.box.style.width, '360px');
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
