/**
 * Which side Plotly's toolbar sits on: left, unless a shown legend or colour bar is on the left.
 *
 * Run:  node --test annzarro/tests/js/modebar-side.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    sideOfX, modebarSide, figureSides, modebarSideOf, syncModebarSide, watchModebarSide, MODEBAR_RIGHT_CLASS
} from '../../../static/js/utils/modebar-side.js';

const legendAt = (x, extra = {}) => ({ showlegend: true, legend: { x }, ...extra });
const traces = [{ name: 'a', showlegend: true }, { name: 'b', showlegend: true }];

test('sideOfX: left, centre and right thirds; a missing x is Plotly\'s right default', () => {
    assert.equal(sideOfX(-0.05), 'left');
    assert.equal(sideOfX(0.5), 'centre');
    assert.equal(sideOfX(1.05), 'right');
    assert.equal(sideOfX(undefined), 'right');
});

test('modebarSide: left by default, right only against something on the left', () => {
    assert.equal(modebarSide(null, null), 'left');
    assert.equal(modebarSide('right', 'right'), 'left');
    assert.equal(modebarSide('centre', 'centre'), 'left');
    assert.equal(modebarSide('left', null), 'right');
    assert.equal(modebarSide('right', 'left'), 'right');
});

test('the legend decides when shown, not when hidden or empty', () => {
    assert.equal(modebarSideOf(traces, legendAt(-0.05)), 'right');
    assert.equal(modebarSideOf(traces, legendAt(1.05)), 'left');
    assert.equal(modebarSideOf(traces, legendAt(0.5)), 'left');
    assert.equal(modebarSideOf(traces, legendAt(-0.05, { showlegend: false })), 'left');
    assert.equal(modebarSideOf([{ name: 'a', showlegend: false }], legendAt(-0.05)), 'left');
});

test('a colour bar on the left moves it, whichever way the bar is attached', () => {
    const marker = x => [{ marker: { showscale: true, colorbar: { x } } }];
    assert.equal(modebarSideOf(marker(-0.1), {}), 'right');
    assert.equal(modebarSideOf(marker(1.02), {}), 'left');
    assert.equal(modebarSideOf([{ marker: { showscale: false, colorbar: { x: -0.1 } } }], {}), 'left');
    assert.equal(modebarSideOf([{ showscale: true, colorbar: { x: -0.1 } }], {}), 'right');
    assert.equal(modebarSideOf([{ marker: {} }], { coloraxis: { colorbar: { x: -0.1 } } }), 'right');
    assert.equal(modebarSideOf([{ marker: {} }], { coloraxis: { showscale: false, colorbar: { x: -0.1 } } }), 'left');
    assert.equal(modebarSideOf([{ visible: false, marker: { showscale: true, colorbar: { x: -0.1 } } }], {}), 'left');
});

test('figureSides reports both', () => {
    const data = [{ showlegend: true, marker: { showscale: true, colorbar: { x: -0.1 } } }];
    assert.deepEqual(figureSides(data, legendAt(1.05)), { legend: 'right', colourbar: 'left' });
    assert.deepEqual(figureSides([], {}), { legend: null, colourbar: null });
});

function fakeGd(data, layout) {
    const classes = new Set();
    const handlers = {};
    return {
        data, layout, classes, handlers,
        classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
        on(ev, fn) { handlers[ev] = fn; },
        removeListener(ev, fn) { if (handlers[ev] === fn) delete handlers[ev]; }
    };
}

test('syncModebarSide sets the class from the drawn figure; watch re-reads after a redraw', () => {
    const gd = fakeGd(traces, legendAt(1.05));
    watchModebarSide(gd);
    assert.equal(gd.classes.has(MODEBAR_RIGHT_CLASS), false);
    gd.layout = legendAt(-0.05);
    gd.handlers.plotly_afterplot();
    assert.equal(gd.classes.has(MODEBAR_RIGHT_CLASS), true);
    gd.layout = legendAt(1.05);
    syncModebarSide(gd);
    assert.equal(gd.classes.has(MODEBAR_RIGHT_CLASS), false);
});

test('watching twice leaves one listener', () => {
    const gd = fakeGd(traces, legendAt(1.05));
    watchModebarSide(gd);
    const first = gd.handlers.plotly_afterplot;
    watchModebarSide(gd);
    assert.notEqual(gd.handlers.plotly_afterplot, first);
    assert.equal(Object.keys(gd.handlers).length, 1);
});
