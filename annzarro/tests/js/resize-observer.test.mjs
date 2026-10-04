/**
 * A plot is relaid out only when its container really changed size.
 *
 * The ResizeObserver fires once on observe and again whenever the panel's
 * layout is touched; each call ran Plotly.relayout({autosize}), a full redraw.
 * Right after the first render of 95.6M points that was a 3.1 s freeze for a
 * size that had not changed. Real resizes (splitting, dragging a divider)
 * still relayout.
 *
 * Run:  node --test annzarro/tests/js/resize-observer.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const chain = new Proxy(function () {}, {
    get: (t, k) => (k === 'length' ? 0 : k === Symbol.toPrimitive ? () => '' : chain),
    apply: () => chain
});
const mkEl = () => ({
    style: {}, dataset: {}, children: [], classList: { add() {}, remove() {}, contains: () => false },
    appendChild(c) { return c; }, insertBefore(c) { return c; }, removeChild() {}, remove() {},
    querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, getAttribute: () => null,
    addEventListener() {}, contains: () => false, innerHTML: ''
});
let observers = [];
globalThis.window = {
    addEventListener() {}, location: { href: 'http://localhost/' }, Config: {},
    getComputedStyle: (el) => ({ width: `${el._w}px`, height: `${el._h}px`, position: 'relative' }),
    ResizeObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} disconnect() {} }
};
globalThis.ResizeObserver = globalThis.window.ResizeObserver;
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '{}' });
globalThis.document = { createElement: mkEl, getElementById: () => null, body: mkEl(), querySelector: () => null };
globalThis.jQuery = chain;
globalThis.$ = chain;
const relayouts = [];
globalThis.Plotly = new Proxy({}, { get: (t, fn) => (...args) => { if (fn === 'relayout') relayouts.push(args[1]); return Promise.resolve(); } });

const { setupResizeObserver, sizeChanged } = await import('../../../static/js/panels/plot-utilities/listeners.js');

const graph = (w, h, drawnW, drawnH) => ({ _w: w, _h: h, clientWidth: w, clientHeight: h,
    data: [{ x: [1] }], _fullLayout: { width: drawnW, height: drawnH } });

test('sizeChanged compares the container with the size the plot was drawn at', () => {
    assert.equal(sizeChanged(graph(600, 400, 600, 400)), false);
    assert.equal(sizeChanged(graph(600.4, 400, 600, 400)), false, 'sub-pixel: the same size');
    assert.equal(sizeChanged(graph(300, 400, 600, 400)), true);
    assert.equal(sizeChanged(graph(600, 401.9, 600, 400)), true);
    assert.equal(sizeChanged(graph(0, 0, 600, 400)), false, 'hidden: nothing to fit');
    assert.equal(sizeChanged({ _w: 600, _h: 400 }), true, 'not drawn yet: let Plotly size it');
});

test('the observer relayouts on a real resize only', async () => {
    observers = [];
    const gd = graph(600, 400, 600, 400);
    setupResizeObserver(gd);
    const fire = async () => { observers[0].cb([{ target: gd }]); await new Promise(r => setTimeout(r, 20)); };
    await fire();                       // the callback ResizeObserver makes on observe
    assert.equal(relayouts.length, 0, 'unchanged size: no relayout');
    gd._w = 300; gd.clientWidth = 300;  // the panel was split
    await fire();
    assert.deepEqual(relayouts, [{ autosize: true }]);
});
