/**
 * C copies the hover label: its text, and when the key is ours.
 *
 * Run:  node --test annzarro/tests/js/hover-copy.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = [];
let active = null;
globalThis.document = {
    addEventListener: (type, fn, cap) => listeners.push([type, fn, cap]),
    removeEventListener() {},
    dispatchEvent() {},
    querySelector: () => null,
    activeElement: null,
    querySelectorAll: () => active ? [active] : []
};

const { hoverLines, hoverCopyText, copyHover, installHoverCopy } =
    await import('../../../static/js/utils/hover-copy.js');

// what plot-make.js builds: the template of a numerical colour plus the Hover columns in hovertext
const TEMPLATE = '%{text}<br>x: %{x:.4~g}<br>y: %{y:.4~g}<br>c: %{marker.color:.4~g}%{hovertext}<extra></extra>';
const trace = {
    name: 'In table', hovertemplate: TEMPLATE, text: ['c0', 'c1'],
    marker: { color: [0.5, 10.210302257599338], colorscale: 'RdBu' },
    hovertext: ['<br>cell_type: HSC<br>score: 1.235', '<br>cell_type: GMP<br>score: NA']
};

test('the template is filled in: name, numbers to 4 digits, every hover column, one per line', () => {
    assert.deepEqual(hoverLines(trace, { pointNumber: 1, x: 1.23456789, y: -3 }),
        ['c1', 'x: 1.235', 'y: -3', 'c: 10.21', 'cell_type: GMP', 'score: NA']);
});

test('a categorical trace names its category and the z value is kept', () => {
    const cat = { hovertemplate: '%{text}<br>x: %{x:.4~g}<br>y: %{y:.4~g}<br>z: %{z:.4~g}<br>HSC<extra></extra>', text: ['a'] };
    assert.deepEqual(hoverLines(cat, { pointNumber: 0, x: 1, y: 2, z: 0.000123456 }),
        ['a', 'x: 1', 'y: 2', 'z: 0.0001235', 'HSC']);
});

test('without a template the name, x and y are copied; the <extra> box is never', () => {
    assert.deepEqual(hoverLines({ text: ['c9'] }, { pointNumber: 0, x: 4, y: 5 }), ['c9', 'x: 4', 'y: 5']);
    assert.deepEqual(hoverLines({ hovertemplate: '%{text}<extra>trace 1</extra>', text: ['c9'] }, { pointNumber: 0 }), ['c9']);
});

test('a graph with a label is read; one without, or the pointer elsewhere, is not', () => {
    const gd = { matches: () => true, _hoverdata: [{ pointNumber: 0, curveNumber: 0, x: 1, y: 2, fullData: trace }] };
    active = gd;
    assert.equal(hoverCopyText(globalThis.document), 'c0\nx: 1\ny: 2\nc: 0.5\ncell_type: HSC\nscore: 1.235');
    gd.matches = () => false;
    assert.equal(hoverCopyText(globalThis.document), null);
    gd.matches = () => true; gd._hoverdata = undefined;
    assert.equal(hoverCopyText(globalThis.document), null);
});

test('copyHover says it copied, or says why not', async () => {
    const said = [];
    const wrote = [];
    assert.equal(await copyHover('a\nb', { write: async (t) => { wrote.push(t); }, say: (...a) => said.push(a) }), true);
    assert.deepEqual(wrote, ['a\nb']);
    assert.equal(said[0][0], 'Copied hover info');
    said.length = 0;
    assert.equal(await copyHover('a', { write: async () => { throw new Error('denied'); }, say: (...a) => said.push(a) }), false);
    assert.equal(said[0][0], 'Not copied');
    assert.match(said[0][1], /secure|permission/);
});

test('the key: C alone, with a label showing, outside a field', async () => {
    active = { matches: () => true, _hoverdata: [{ pointNumber: 0, curveNumber: 0, x: 1, y: 2, fullData: trace }] };
    const wrote = [];
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => { wrote.push(t); } } }, configurable: true });
    installHoverCopy();
    const onKey = listeners.find(([t]) => t === 'keydown')[1];
    const press = (extra = {}) => {
        const e = { key: 'c', target: { tagName: 'DIV' }, defaultPrevented: false, stopped: false,
            preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
        onKey(e);
        return e;
    };
    const ok = press();
    assert.ok(ok.defaultPrevented && ok.stopped, 'ours: nothing else acts on the key');
    await new Promise(r => setTimeout(r, 0));
    assert.equal(wrote.length, 1);
    for (const extra of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true },
        { target: { tagName: 'INPUT' } }, { target: { tagName: 'TEXTAREA' } }, { target: { tagName: 'SELECT' } },
        { target: { tagName: 'DIV', isContentEditable: true } }, { key: 'v' }]) {
        const e = press(extra);
        assert.ok(!e.defaultPrevented && !e.stopped, JSON.stringify(extra));
    }
    active = null;
    const none = press();
    assert.ok(!none.defaultPrevented, 'no label: C keeps toggling the controls');
    await new Promise(r => setTimeout(r, 0));
    assert.equal(wrote.length, 1);
});
