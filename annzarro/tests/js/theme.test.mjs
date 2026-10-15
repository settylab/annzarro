/**
 * The app colour theme (static/js/utils/theme.js): System, Light or Dark,
 * remembered per browser, with the system setting followed live while the
 * mode is System. static/js/theme-init.js repeats the resolve rule without
 * modules (it runs before the CSS paints); the last test runs it against the
 * same cases so the two cannot drift apart.
 *
 * Run:  node --test annzarro/tests/js/theme.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
    THEME_KEY, THEME_EVENT, normalizeMode, resolveTheme, readMode, saveMode, currentTheme, currentMode, startTheme
} from '../../../static/js/utils/theme.js';

function storage(initial = {}) {
    const m = new Map(Object.entries(initial));
    return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

function fakeWindow({ dark = false, stored = {}, blocked = false } = {}) {
    const attrs = {};
    const events = [];
    let listener = null;
    const query = {
        matches: dark,
        addEventListener: (type, fn) => { if (type === 'change') listener = fn; },
    };
    const store = storage(stored);
    const win = {
        matchMedia: (q) => { assert.equal(q, '(prefers-color-scheme: dark)'); return query; },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
        dispatchEvent: (e) => events.push(e),
        document: { documentElement: { getAttribute: k => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = v; } } },
        localStorage: blocked ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } } : store,
    };
    return { win, attrs, events, store, setSystem(v) { query.matches = v; listener && listener(); } };
}

test('a stored value is a mode; anything else is System', () => {
    assert.equal(normalizeMode('light'), 'light');
    assert.equal(normalizeMode('dark'), 'dark');
    for (const v of ['system', 'auto', '', null, undefined, 7, 'Dark']) assert.equal(normalizeMode(v), 'system');
});

test('the theme: Light and Dark are fixed, System follows the system', () => {
    assert.equal(resolveTheme('light', true), 'light');
    assert.equal(resolveTheme('dark', false), 'dark');
    assert.equal(resolveTheme('system', true), 'dark');
    assert.equal(resolveTheme('system', false), 'light');
    assert.equal(resolveTheme(undefined, false), 'light');
});

test('the choice is kept under one key; System forgets it; blocked storage is survivable', () => {
    const st = storage();
    assert.equal(readMode(st), 'system');
    assert.equal(saveMode(st, 'dark'), true);
    assert.equal(st.getItem(THEME_KEY), 'dark');
    assert.equal(readMode(st), 'dark');
    assert.equal(saveMode(st, 'system'), true);
    assert.equal(st.getItem(THEME_KEY), null);
    const blocked = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
    assert.equal(readMode(blocked), 'system');
    assert.equal(saveMode(blocked, 'dark'), false);
    assert.equal(readMode(null), 'system');
});

test('startTheme: the document gets the resolved theme and mode, and follows the system live in System', () => {
    const w = fakeWindow({ dark: false });
    const t = startTheme({ window: w.win });
    assert.equal(w.attrs['data-theme'], 'light');
    assert.equal(w.attrs['data-theme-mode'], 'system');
    assert.equal(w.events.length, 1);                      // the mode attribute was missing: announced once
    w.setSystem(true);
    assert.equal(w.attrs['data-theme'], 'dark');
    assert.equal(t.theme, 'dark');
    assert.deepEqual(w.events.at(-1).detail, { mode: 'system', theme: 'dark' });
    assert.equal(w.events.at(-1).type, THEME_EVENT);
    w.setSystem(false);
    assert.equal(w.attrs['data-theme'], 'light');
});

test('a fixed mode ignores the system, and is remembered', () => {
    const w = fakeWindow({ dark: true });
    const t = startTheme({ window: w.win });
    assert.equal(w.attrs['data-theme'], 'dark');
    t.setMode('light');
    assert.equal(w.attrs['data-theme'], 'light');
    assert.equal(w.store.getItem(THEME_KEY), 'light');
    const n = w.events.length;
    w.setSystem(false);
    w.setSystem(true);
    assert.equal(w.attrs['data-theme'], 'light');          // the system flipped, the page did not
    assert.equal(w.events.length, n);
    t.setMode('system');
    assert.equal(w.attrs['data-theme'], 'dark');           // back to following: dark now
    assert.equal(w.store.getItem(THEME_KEY), null);
    t.setMode('nonsense');
    assert.equal(t.mode, 'system');
});

test('a stored choice is read at start; a reload keeps it', () => {
    const w1 = fakeWindow({ dark: false, stored: { [THEME_KEY]: 'dark' } });
    startTheme({ window: w1.win });
    assert.equal(w1.attrs['data-theme'], 'dark');
    assert.equal(w1.attrs['data-theme-mode'], 'dark');
    const w2 = fakeWindow({ dark: true, blocked: true });
    startTheme({ window: w2.win });
    assert.equal(w2.attrs['data-theme'], 'dark');          // storage blocked: System
});

test('no event when nothing changed (the inline script already set the attributes)', () => {
    const w = fakeWindow({ dark: true });
    w.win.document.documentElement.setAttribute('data-theme', 'dark');
    w.win.document.documentElement.setAttribute('data-theme-mode', 'system');
    const t = startTheme({ window: w.win });
    assert.equal(w.events.length, 0);
    t.setMode('dark');
    assert.equal(w.events.length, 1);                      // the mode changed, the theme did not: still announced
});

test('currentTheme and currentMode read the document', () => {
    const doc = (theme, mode) => ({ documentElement: { getAttribute: k => (k === 'data-theme' ? theme : mode) } });
    assert.equal(currentTheme(doc('dark', 'dark')), 'dark');
    assert.equal(currentTheme(doc(null, null)), 'light');
    assert.equal(currentTheme(undefined), 'light');
    assert.equal(currentMode(doc('dark', 'light')), 'light');
    assert.equal(currentMode(doc('dark', null)), 'system');
});

test('theme-init.js (runs before the CSS) gives the same theme as resolveTheme for every case', () => {
    const src = readFileSync(new URL('../../../static/js/theme-init.js', import.meta.url), 'utf8');
    for (const stored of [null, 'light', 'dark', 'junk']) {
        for (const systemDark of [false, true]) {
            const attrs = {};
            const sandbox = {
                window: null,
                document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: k => attrs[k] } },
            };
            sandbox.window = {
                localStorage: { getItem: () => stored },
                matchMedia: () => ({ matches: systemDark, addEventListener() {} }),
            };
            vm.runInNewContext(src, { ...sandbox, window: sandbox.window, document: sandbox.document });
            assert.equal(attrs['data-theme'], resolveTheme(stored, systemDark), `${stored} / system dark ${systemDark}`);
            assert.equal(attrs['data-theme-mode'], normalizeMode(stored));
        }
    }
    // storage that throws, and no matchMedia at all
    const attrs = {};
    vm.runInNewContext(src, {
        window: { localStorage: { getItem() { throw new Error('blocked'); } } },
        document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: k => attrs[k] } },
    });
    assert.equal(attrs['data-theme'], 'light');
    assert.equal(attrs['data-theme-mode'], 'system');
});
