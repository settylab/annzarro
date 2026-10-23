/**
 * copyText: the clipboard API when the page is secure, a hidden textarea and execCommand otherwise.
 *
 * Run:  node --test annzarro/tests/js/clipboard.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyText, legacyCopy } from '../../../static/js/utils/clipboard.js';

function fakeDoc({ exec = true, active = { focus() { this.refocused = true; } } } = {}) {
    const log = { appended: [], copied: null, removed: false, ranges: [] };
    const sel = {
        rangeCount: 1, getRangeAt: () => 'range-0',
        removeAllRanges() { log.ranges.push('cleared'); }, addRange(r) { log.ranges.push(r); }
    };
    const doc = {
        activeElement: active,
        body: { appendChild: (el) => log.appended.push(el) },
        getSelection: () => sel,
        createElement: () => ({
            style: {}, attrs: {}, value: '',
            setAttribute(k, v) { this.attrs[k] = v; },
            focus() { doc.activeElement = this; }, select() {}, setSelectionRange() {},
            remove() { log.removed = true; }
        }),
        execCommand(cmd) {
            if (cmd === 'copy') log.copied = log.appended[0].value;
            if (exec instanceof Error) throw exec;
            return exec;
        }
    };
    return { doc, log };
}

test('secure page: the clipboard API is used and nothing else', async () => {
    const { doc, log } = fakeDoc();
    let got = null;
    const nav = { clipboard: { writeText: async (t) => { got = t; } } };
    assert.equal(await copyText('abc', { nav, doc, secure: true }), true);
    assert.equal(got, 'abc');
    assert.equal(log.appended.length, 0);
});

test('no clipboard API (plain http): execCommand runs synchronously, in the gesture', () => {
    const { doc, log } = fakeDoc();
    const p = copyText('hello', { nav: {}, doc, secure: false });
    assert.equal(log.copied, 'hello', 'copied before copyText returned');
    assert.ok(p instanceof Promise);
    assert.equal(log.appended[0].attrs.readonly, '');
    assert.ok(log.removed, 'the textarea is removed');
    return p.then((ok) => assert.equal(ok, true));
});

test('clipboard API present but the page is insecure: the fallback is used', async () => {
    const { doc, log } = fakeDoc();
    const nav = { clipboard: { writeText: async () => { throw new Error('should not be called'); } } };
    assert.equal(await copyText('x', { nav, doc, secure: false }), true);
    assert.equal(log.copied, 'x');
});

test('the API rejects: the fallback copies', async () => {
    const { doc, log } = fakeDoc();
    const nav = { clipboard: { writeText: async () => { throw new Error('denied'); } } };
    assert.equal(await copyText('y', { nav, doc, secure: true }), true);
    assert.equal(log.copied, 'y');
});

test('the API throws synchronously: the fallback copies', async () => {
    const { doc, log } = fakeDoc();
    const nav = { clipboard: { writeText: () => { throw new Error('boom'); } } };
    assert.equal(await copyText('z', { nav, doc, secure: true }), true);
    assert.equal(log.copied, 'z');
});

test('both ways fail: false, and it never rejects', async () => {
    const nav = { clipboard: { writeText: async () => { throw new Error('denied'); } } };
    assert.equal(await copyText('q', { nav, doc: fakeDoc({ exec: false }).doc, secure: true }), false);
    assert.equal(await copyText('q', { nav: {}, doc: fakeDoc({ exec: new Error('no') }).doc, secure: false }), false);
    assert.equal(await copyText('q', { nav: {}, doc: {}, secure: false }), false);
});

test('focus and selection are restored afterwards, also when copying fails', () => {
    for (const exec of [true, false]) {
        const active = { focus() { this.refocused = true; doc.activeElement = this; } };
        const { doc, log } = fakeDoc({ exec, active });
        legacyCopy('t', doc);
        assert.equal(active.refocused, true);
        assert.deepEqual(log.ranges, ['cleared', 'range-0']);
        assert.equal(doc.activeElement, active);
    }
});
