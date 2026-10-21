/**
 * Which panel a close/split/toggle shortcut acts on.
 *
 * Run:  node --test annzarro/tests/js/panel-target.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseTargetTile } from '../../../static/js/utils/panel-target.js';

const viewport = { width: 1000, height: 800 };

/** A panel at a rectangle; elements inside it are made with `inside`. */
const tile = (name, left, top, width, height) => ({
    name, getBoundingClientRect: () => ({ left, top, width, height }), closest: () => null
});
const inside = (t) => ({ closest: () => t });
const outside = { closest: () => null };

// two panels side by side, both as tall as the viewport
const first = tile('first', 0, 0, 500, 800);
const second = tile('second', 500, 0, 500, 800);
const tiles = [first, second];

test('the panel under the pointer wins, also the second of a row', () => {
    assert.equal(chooseTargetTile({ tiles, pointerEl: inside(second), activeEl: inside(first), viewport }), second);
    assert.equal(chooseTargetTile({ tiles, pointerEl: inside(first), activeEl: inside(second), viewport }), first);
});

test('with the pointer on no panel, the panel holding the focus', () => {
    assert.equal(chooseTargetTile({ tiles, pointerEl: outside, activeEl: inside(second), viewport }), second);
    assert.equal(chooseTargetTile({ tiles, pointerEl: null, activeEl: inside(second), viewport }), second);
});

test('otherwise the panel nearest the viewport centre in x and y', () => {
    const left = tile('left', 0, 300, 300, 200);
    const right = tile('right', 600, 300, 300, 200);      // centre x 750 is 250 from the middle, 150 is 350
    const pick = (ts) => chooseTargetTile({ tiles: ts, pointerEl: null, activeEl: outside, viewport });
    assert.equal(pick([left, right]), right);
    assert.equal(pick([right, left]), right);
    // the y distance counts too
    const high = tile('high', 400, 0, 200, 100);
    const centred = tile('centred', 100, 350, 200, 100);
    assert.equal(pick([high, centred]), centred);
});

test('a pointer or focus outside the known panels is not a target', () => {
    const stranger = tile('stranger', 0, 0, 10, 10);
    assert.equal(chooseTargetTile({ tiles, pointerEl: inside(stranger), activeEl: null, viewport }) !== stranger, true);
});

test('no panels, nothing to act on', () => {
    assert.equal(chooseTargetTile({ tiles: [], pointerEl: null, activeEl: null, viewport }), null);
});
