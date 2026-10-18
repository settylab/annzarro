/**
 * The site footer stays the last child of the page's scroller (utils/site-footer.js).
 *
 * Run:  node --test annzarro/tests/js/site-footer.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { keepLast } from '../../../static/js/utils/site-footer.js';

/** A container with children and an observer the test fires by hand, as the browser would. */
function setup() {
    const observers = [];
    class Observer {
        constructor(cb) { this.cb = cb; this.on = false; observers.push(this); }
        observe() { this.on = true; }
        disconnect() { this.on = false; }
    }
    const container = {
        children: [],
        get lastElementChild() { return this.children[this.children.length - 1] || null; },
        appendChild(node) {
            this.children = this.children.filter((c) => c !== node);
            this.children.push(node);
            return node;
        },
    };
    const flush = () => observers.forEach((o) => o.on && o.cb([]));
    return { container, Observer, flush, observers };
}

test('the footer is moved to the end at once', () => {
    const { container, Observer } = setup();
    const footer = { id: 'site-footer' };
    container.children = [footer, { id: 'panel' }];
    keepLast(container, footer, Observer);
    assert.deepEqual(container.children.map((c) => c.id), ['panel', 'site-footer']);
});

test('a chooser appended after it goes before it', () => {
    const { container, Observer, flush } = setup();
    const footer = { id: 'site-footer' };
    container.children = [{ id: 'panel' }, footer];
    keepLast(container, footer, Observer);
    container.appendChild({ id: 'chooser' });
    flush();
    assert.deepEqual(container.children.map((c) => c.id), ['panel', 'chooser', 'site-footer']);
});

test('emptying the container (a restored layout) does not lose it', () => {
    const { container, Observer, flush } = setup();
    const footer = { id: 'site-footer' };
    container.children = [{ id: 'panel' }, footer];
    keepLast(container, footer, Observer);
    container.children = [];          // innerHTML = ''
    container.appendChild({ id: 'restored' });
    flush();
    assert.deepEqual(container.children.map((c) => c.id), ['restored', 'site-footer']);
});

test('no footer, no container or no MutationObserver: nothing happens', () => {
    const { container, Observer, observers } = setup();
    container.children = [{ id: 'panel' }];
    keepLast(container, null, Observer)();
    keepLast(null, { id: 'site-footer' }, Observer)();
    keepLast(container, { id: 'site-footer' }, undefined)();
    assert.equal(observers.length, 0);
    assert.deepEqual(container.children.map((c) => c.id), ['panel']);
});

test('stop disconnects', () => {
    const { container, Observer, flush } = setup();
    const footer = { id: 'site-footer' };
    container.children = [footer];
    const stop = keepLast(container, footer, Observer);
    stop();
    container.appendChild({ id: 'chooser' });
    flush();
    assert.deepEqual(container.children.map((c) => c.id), ['site-footer', 'chooser']);
});
