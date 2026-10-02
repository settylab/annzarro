/**
 * A header picker that keeps keyboard focus still shows focus changes.
 *
 * After picking a gene with Enter the box keeps keyboard focus (menu
 * closed); a plot click then moved the focus but the box kept the old name
 * (headless: S100a9 shown, Mrpl15 focused). setValue now writes the text
 * unless the user is typing in an open menu.
 *
 * Run:  node --test annzarro/tests/js/name-picker-focus.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

function fakeEl(doc, tag) {
    const listeners = {};
    const el = {
        tagName: tag, children: [], dataset: {}, style: {}, hidden: false, value: '', textContent: '',
        ownerDocument: doc, attrs: {},
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
        appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
        append(...cs) { cs.forEach(c => this.appendChild(c)); },
        addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
        fire(t, ev = {}) { (listeners[t] || []).forEach(f => f({ preventDefault() {}, ...ev })); },
        select() {}, focus() { doc.activeElement = this; this.fire('focus'); }, blur() { doc.activeElement = null; },
        contains() { return false; }
    };
    return el;
}

const doc = { activeElement: null };
doc.createElement = (tag) => fakeEl(doc, tag);
globalThis.document = doc;

const { mountNamePicker } = await import('../../../static/js/utils/name-picker.js');

test('focus changes show in a focused box whose menu is closed, not while typing', async () => {
    const wrapper = fakeEl(doc, 'div');
    const input = fakeEl(doc, 'input');
    wrapper.appendChild(input);
    const picker = mountNamePicker({ input, noun: 'gene', search: async () => ({ matches: [], truncated: false }), onPick() {} });

    input.focus();                       // opens the menu
    input.value = 's100';                // the user is typing
    picker.setValue('Mrpl15');
    assert.equal(input.value, 's100', 'typing is not overwritten');

    picker.close();                      // e.g. after a pick with Enter; box keeps focus
    assert.equal(doc.activeElement, input);
    picker.setValue('Mrpl15');           // a plot click moved the focus
    assert.equal(input.value, 'Mrpl15');

    input.blur();
    picker.setValue('Actb');
    assert.equal(input.value, 'Actb');
});
