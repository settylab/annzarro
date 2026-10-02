/**
 * Hide NaN (and Equal aspect) stay reachable on a categorical colour.
 *
 * Hide NaN acts on categorical colours: it hides points with no category.
 * But `updateColorControlsVisibility` hid the WHOLE colour toolbar for a
 * categorical colour, so a Hide NaN left on from a numerical colour or a
 * restored view kept hiding points that the user could not show again from
 * that panel. Equal aspect, an axis option, was unreachable there for the
 * same reason.
 *
 * Drives the real `updateColorControlsVisibility` against fake elements and
 * asserts which toolbar controls end up visible.
 *
 * Run:  node --test annzarro/tests/js/color-toolbar.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = { addEventListener() {}, getElementById: () => null, createElement: () => ({}) };
globalThis.Plotly = new Proxy({}, { get: () => () => Promise.resolve() });

const ID = 'p';
const TOOLBAR = ['center-colormap', 'reverse-colormap', 'lock-range', 'hide-outliers', 'hide-nan',
    'equal-aspect', 'sort-by-color', 'log-color', 'log-floor'];

/** One fake element per selector; `style` is what attr('style') last wrote. */
function makePanel() {
    const els = {};
    const el = (sel) => (els[sel] = els[sel] || { sel, style: '', css: {} });
    el(`#color-range-container-${ID}`);
    for (const name of TOOLBAR) el(`#${name}-${ID}`);
    el('.btn-toolbar'); el('.btn-group');
    return els;
}
function wrap(els, node) {
    const w = {
        length: node ? 1 : 0,
        attr(k, v) { if (node && v !== undefined) node.style = v; return v === undefined ? node?.style : w; },
        css(k, v) { if (node) node.css[k] = v; return w; },
        closest: () => wrap(els, null),
        find: (sel) => wrap(els, els[sel]),
        each(fn) { if (node) fn.call(node); return w; }
    };
    return w;
}
let current = null;
globalThis.jQuery = (x) => (x && x.find ? x            // already wrapped (showHide)
    : x && x.sel ? wrap(current, x) : { find: (sel) => wrap(x, x[sel]) });
globalThis.jQuery.showHide = () => {};
globalThis.$ = globalThis.jQuery;

const { updateColorControlsVisibility, COLOR_TOOLBAR_CONTROLS } = await import(
    '../../../static/js/panels/plot-utilities/panel-ui-update.js');

const visible = (els) => TOOLBAR.filter(n => !/display:\s*none/.test(els[`#${n}-${ID}`].style));

test('a categorical colour keeps Hide NaN and Equal aspect, and the toolbar shown', () => {
    const els = current = makePanel();
    updateColorControlsVisibility(els, 'categorical', ID);
    assert.deepEqual(visible(els), ['hide-nan', 'equal-aspect']);
    assert.doesNotMatch(els['.btn-toolbar'].style, /display:\s*none/);
    assert.doesNotMatch(els['.btn-group'].style, /display:\s*none/);
});

test('switching back to a numerical colour shows every control again', () => {
    const els = current = makePanel();
    updateColorControlsVisibility(els, 'categorical', ID);
    updateColorControlsVisibility(els, 'numerical', ID);
    assert.deepEqual(visible(els), TOOLBAR);
});

test('the table names every control in the template', () => {
    assert.deepEqual([...COLOR_TOOLBAR_CONTROLS.numerical].sort(), [...TOOLBAR].sort());
    for (const n of COLOR_TOOLBAR_CONTROLS.categorical) assert.ok(TOOLBAR.includes(n), n);
});
