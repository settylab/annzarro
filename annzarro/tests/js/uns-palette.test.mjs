/**
 * The stored colours of a categorical column (uns.<key>_colors) are used only
 * when there is one valid colour for each category; a shorter list used to be
 * repeated, so different categories shared a colour. Scanpy discards such a
 * list and generates a palette; so does AnnZarro.
 *
 * Run:  node --test annzarro/tests/js/uns-palette.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { usableUnsPalette, unsPaletteNote, unsPaletteTag, isColourString } from '../../../static/js/utils/uns-palette.js';

const RGB = ['#1f77b4', '#ff7f0e', '#2ca02c'];

test('as many colours as categories are used', () => {
    assert.deepEqual(usableUnsPalette(RGB, 3), RGB);
});

test('extra colours are fine', () => {
    assert.deepEqual(usableUnsPalette(RGB, 2), RGB);
});

test('fewer colours than categories are not used', () => {
    assert.equal(usableUnsPalette(RGB, 4), null);
    assert.equal(usableUnsPalette([], 1), null);
});

test('an invalid colour among those used is a mismatch', () => {
    assert.equal(usableUnsPalette(['#1f77b4', 'not a colour', '#2ca02c'], 3), null);
    assert.equal(usableUnsPalette(['#1f77b4', 7, '#2ca02c'], 3), null);
    assert.equal(usableUnsPalette(['#1f77b4', null, '#2ca02c'], 3), null);
    assert.equal(usableUnsPalette(['#12345', '#1f77b4'], 2), null);
});

test('an invalid colour beyond the categories does not matter', () => {
    assert.deepEqual(usableUnsPalette(['#1f77b4', '#ff7f0e', 'nope'], 2), ['#1f77b4', '#ff7f0e', 'nope']);
});

test('not an array is not a palette', () => {
    for (const v of [null, undefined, '#ff0000', 3, { 0: '#ff0000' }]) assert.equal(usableUnsPalette(v, 1), null);
});

test('no categories gives no palette', () => {
    assert.equal(usableUnsPalette(RGB, 0), null);
});

test('the colour notations Plotly draws are accepted', () => {
    for (const c of ['#abc', '#aabbcc', '#aabbccdd', 'rgb(1,2,3)', 'rgba(1,2,3,0.5)', 'hsl(10,50%,50%)', 'tomato'])
        assert.ok(isColourString(c), c);
    for (const c of ['', '#ggg', '12', 'a b', null]) assert.ok(!isColourString(c), String(c));
});

test('the note says what was stored and what was needed', () => {
    assert.equal(unsPaletteNote('leiden', ['#aaa', '#bbb'], 5),
        "Colours in uns.leiden_colors (2) don't match the categories (5); using the default palette");
    assert.match(unsPaletteNote('leiden', ['#aaa', 'x y'], 2), /not all valid/);
});

test('no note when nothing is stored or the colours fit', () => {
    assert.equal(unsPaletteNote('leiden', null, 5), null);
    assert.equal(unsPaletteNote('leiden', [], 5), null);
    assert.equal(unsPaletteNote('leiden', RGB, 3), null);
    assert.equal(unsPaletteTag('leiden', RGB, 3), null);
    assert.equal(unsPaletteTag('leiden', RGB, 4).pop.text, unsPaletteNote('leiden', RGB, 4));
});
