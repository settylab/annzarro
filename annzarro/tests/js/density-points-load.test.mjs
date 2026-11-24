/**
 * What the Cell points layer may be drawn for, and how the loaded cells reach the figure (panels/cell-count/
 * density-points-load.js): the sources it takes, the refusal above the load cap, and the level of each cell.
 *
 * Run:  node --test annzarro/tests/js/density-points-load.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const L = await import('../../../static/js/panels/cell-count/density-points-load.js');
const { GROUP_SOURCE } = await import('../../../static/js/panels/cell-grouping/factors.js');
const P = await import('../../../static/js/panels/cell-count/density-points.js');

const obs = (key) => ({ source: { type: 'obs', key } });
const structure = { obs: { columns_info: { depth: { type: 'numeric' }, score: { type: 'numeric' }, condition: { type: 'categorical' } } } };
const config = (over = {}) => ({ mode: 'density2d', x: obs('depth'), y: obs('score'), ...over });

test('the layer takes numbers for x and y from an obs column, an embedding or a gene, and an obs column of categories for the Color by', () => {
    assert.equal(L.pointsRefused(config(), structure, 1000), null);
    assert.equal(L.pointsRefused(config({ split: obs('condition') }), structure, 1000), null);
    assert.equal(L.pointsRefused(config({ x: { source: { type: 'obsm', key: 'X_umap', column: '1' } } }), structure, 1000), null);
    assert.equal(L.pointsRefused(config({ y: { source: { type: 'layer', key: 'X', column: 'Cd3e' } } }), structure, 1000), null);
    assert.deepEqual(L.pointsRefused(config({ x: obs('condition') }), structure, 1000), { kind: 'source', input: 'x' });
    assert.deepEqual(L.pointsRefused(config({ y: { source: { type: 'obsp', key: 'connectivities', column: 'c1' } } }), structure, 1000), { kind: 'source', input: 'y' });
    assert.equal(L.pointsRefused(config({ split: obs('depth') }), structure, 1000), null, 'a number is binned by the reply\'s edges');
    assert.equal(L.pointsRefused(config({ split: { source: { type: GROUP_SOURCE, key: 'cell-grouping-G' } } }), structure, 1000), null, 'a grouping');
    assert.deepEqual(L.pointsRefused(config({ split: { source: { type: 'obsp', key: 'connectivities', column: 'c1' } } }), structure, 1000), { kind: 'source', input: 'split' });
});

test('above the load cap nothing is loaded: the refusal says how many cells and what the cap is', () => {
    assert.equal(L.pointsRefused(config(), structure, 25_000_000), null, 'the cap itself is allowed');
    const why = L.pointsRefused(config(), structure, 25_000_001);
    assert.deepEqual(why, { kind: 'too_many', total: 25_000_001, limit: 25_000_000 });
    assert.match(P.pointsRefusal(why), /25,000,001 cells are more than the 25,000,000/);
    assert.deepEqual(L.pointsRefused(config(), structure, 600, 500), { kind: 'too_many', total: 600, limit: 500 }, 'a lowered cap');
});

test('the level of each loaded cell is its index among the table\'s levels; a level the plot does not show is -1, a blank is -1', () => {
    const loaded = { x: new Float32Array(5), y: new Float32Array(5), codes: Uint16Array.from([0, 1, 2, 65535, 1]), MISSING: 65535,
        categories: ['ctrl', 'treated', 'other'], total: 5 };
    const p = L.pointsForFigure(loaded, ['c:treated', 'c:ctrl']);
    assert.deepEqual(Array.from(p.level), [1, 0, -1, -1, 0]);
    assert.equal(p.total, 5);
    assert.equal(L.pointsForFigure(loaded, null).level, null);
});

test('the key of the loaded cells changes with a source and with the cells shown', () => {
    const a = L.pointsKey(config(), 1000);
    assert.equal(L.pointsKey(config(), 1000), a);
    assert.notEqual(L.pointsKey(config(), 2000), a);
    assert.notEqual(L.pointsKey(config({ x: obs('score') }), 1000), a);
    assert.notEqual(L.pointsKey(config({ split: obs('condition') }), 1000), a);
});

test('a grouping\'s cell codes are matched to the grid\'s level ids by the group ids the source gives', () => {
    const levels = ['g:["c:b"]', 'g:["c:a"]'];            // the grid's order differs from the grouping's
    const loaded = { x: new Float32Array(4), y: new Float32Array(4), codes: Uint8Array.from([0, 1, 2, 255]), MISSING: 255,
        groupIds: ['g:["c:a"]', 'g:["c:b"]', 'g:["c:other"]'], total: 4 };
    assert.deepEqual(Array.from(L.pointsForFigure(loaded, levels).level), [1, 0, -1, -1]);
});

test('a number as Color by is binned by the reply\'s edges: the top edge in the last bin, outside, NaN and a missing level in none', () => {
    const loaded = { x: new Float32Array(7), y: new Float32Array(7), values: Float32Array.from([0.5, 1, 3.9, 4, 5, NaN, -1]), total: 7 };
    const levels = ['bin:0', 'bin:1', 'bin:2'];
    const p = L.pointsForFigure(loaded, levels, { edges: [0, 1, 2, 4] });
    assert.deepEqual(Array.from(p.level), [0, 1, 2, 2, -1, -1, -1]);
});

test('a zero bin takes the cells of exactly 0, and the bins keep the rest', () => {
    const loaded = { x: new Float32Array(4), y: new Float32Array(4), values: Float32Array.from([0, 0.5, 1.5, 3]), total: 4 };
    const levels = ['@zero', 'bin:0', 'bin:1'];
    const p = L.pointsForFigure(loaded, levels, { edges: [0, 1, 3] });
    assert.deepEqual(Array.from(p.level), [0, 1, 2, 2]);
});

test('uneven edges (equal-count bins) are searched, not divided', () => {
    const loaded = { x: new Float32Array(4), y: new Float32Array(4), values: Float32Array.from([0.1, 0.2, 5, 90]), total: 4 };
    const p = L.pointsForFigure(loaded, ['bin:0', 'bin:1', 'bin:2'], { edges: [0, 0.15, 10, 100] });
    assert.deepEqual(Array.from(p.level), [0, 1, 1, 2]);
});
