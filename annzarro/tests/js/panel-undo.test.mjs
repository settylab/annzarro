/**
 * The shared Undo of a panel whose state is its stored config (static/js/ui/panel-undo.js): a step is the config before a
 * change, with a label; undo re-applies it through the panel's own path; the stack is capped; a config that arrives from
 * outside forgets the steps; nothing is recorded while an undo restores.
 *
 * Run:  node --test annzarro/tests/js/panel-undo.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { createPanelUndo, labelByKeys, UNDO_MAX } = await import('../../../static/js/ui/panel-undo.js');

/** A panel: a config the test edits, and the helper wired to it. */
function panel(extra = {}) {
    const cfg = { columns: ['a'], order: [0, 'asc'], search: '' };
    const applied = [];
    let clock = 0;
    const undo = createPanelUndo({
        snapshot: () => JSON.parse(JSON.stringify(cfg)),
        restore: (c) => { applied.push(c); Object.keys(cfg).forEach((k) => delete cfg[k]); Object.assign(cfg, c); },
        now: () => clock,
        ...extra
    });
    return { cfg, undo, applied, at: (t) => { clock = t; } };
}

test('a change is one step: the config before it, with its label', () => {
    const { cfg, undo } = panel();
    assert.equal(undo.canUndo, false);
    assert.equal(undo.title, 'Nothing to undo');
    cfg.columns = ['a', 'b'];
    assert.equal(undo.observe('add a column'), true);
    assert.equal(undo.size, 1);
    assert.equal(undo.title, 'Undo: add a column');
    assert.deepEqual(undo.peek().before.columns, ['a']);
});

test('no change, no step; the label comes from the keys that differ when none is given', () => {
    const { cfg, undo } = panel();
    assert.equal(undo.observe('nothing'), false);
    cfg.order = [1, 'desc'];
    undo.observe();
    assert.equal(undo.title, 'Undo: change order');
    assert.equal(labelByKeys({ a: 1, b: 1 }, { a: 1, b: 2 }, { b: 'change the b' }), 'change the b');
    assert.equal(labelByKeys({}, {}), 'change');
});

test('undo re-applies the config before through restore, and two undos return to the start', async () => {
    const { cfg, undo, applied, at } = panel();
    at(0); cfg.columns = ['a', 'b']; undo.observe('add b');
    at(5000); cfg.search = 'x'; undo.observe('search');
    assert.equal(await undo.undo(), true);
    assert.equal(cfg.search, '');
    assert.deepEqual(cfg.columns, ['a', 'b']);
    assert.equal(await undo.undo(), true);
    assert.deepEqual(cfg, { columns: ['a'], order: [0, 'asc'], search: '' });
    assert.equal(applied.length, 2);
    assert.equal(undo.canUndo, false);
    assert.equal(await undo.undo(), false, 'nothing left');
});

test('nothing is recorded while an undo restores, and the restored config is the new start', async () => {
    const { cfg, undo } = panel({ restore: async (c) => { Object.assign(cfg, c); undo.observe('this must not count'); assert.equal(undo.restoring, true); } });
    cfg.search = 'q';
    undo.observe('search');
    await undo.undo();
    assert.equal(undo.size, 0);
    assert.equal(undo.observe('again'), false, 'the restored config is known: no step for it');
});

test('changes of one kind close together are one step with the earliest config; another kind is another step', () => {
    const { cfg, undo, at } = panel();
    at(0); cfg.search = 'a'; undo.observe('search');
    at(400); cfg.search = 'ab'; undo.observe('search');
    at(800); cfg.search = 'abc'; undo.observe('search');
    assert.equal(undo.size, 1);
    assert.equal(undo.peek().before.search, '', 'the config before the first keystroke');
    at(1000); cfg.columns = ['a', 'z']; undo.observe('add z');
    assert.equal(undo.size, 2);
    at(9000); cfg.search = 'abcd'; undo.observe('search');
    assert.equal(undo.size, 3, 'a pause ends the burst');
});

test('the stack is capped at 50 and the oldest step goes', () => {
    const { cfg, undo, at } = panel();
    assert.equal(UNDO_MAX, 50);
    for (let i = 1; i <= 60; i++) { at(i * 10000); cfg.search = String(i); undo.observe(`s${i}`); }
    assert.equal(undo.size, 50);
    assert.equal(undo.peek().label, 's60');
});

test('a config that arrives from outside forgets the steps and becomes the start', async () => {
    const { cfg, undo } = panel();
    cfg.search = 'mine';
    undo.observe('search');
    assert.equal(undo.canUndo, true);
    cfg.columns = ['from a link'];            // a link, Back and Forward, another panel
    undo.rebase();
    assert.equal(undo.canUndo, false, 'Undo never jumps to a state unrelated to what is on screen');
    assert.equal(undo.observe('nothing changed since'), false);
    cfg.search = 'again';
    undo.observe('search');
    await undo.undo();
    assert.deepEqual(cfg.columns, ['from a link'], 'it goes back to the rebased start, not before it');
});

test('listeners hear every change of the stack', async () => {
    const { cfg, undo } = panel();
    let heard = 0;
    const stop = undo.onChange(() => { heard++; });
    cfg.search = 'x'; undo.observe('search');
    await undo.undo();
    undo.rebase();
    assert.equal(heard, 3);
    stop();
    cfg.search = 'y'; undo.observe('search');
    assert.equal(heard, 3);
});

test('the button is disabled when empty, titled with the step, and undoes on click', async () => {
    const made = [];
    const doc = { createElement: () => { const el = { attrs: {}, listeners: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; } }; made.push(el); return el; } };
    const { cfg, undo } = panel();
    const b = undo.button({ document: doc });
    assert.equal(b.textContent, 'Undo');
    assert.equal(b.disabled, true);
    assert.equal(b.title, 'Nothing to undo');
    cfg.search = 'x'; undo.observe('search');
    assert.equal(b.disabled, false);
    assert.equal(b.title, 'Undo: search');
    assert.equal(b.attrs['aria-label'], 'Undo: search');
    b.listeners.click();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(cfg.search, '');
    assert.equal(b.disabled, true);
});
