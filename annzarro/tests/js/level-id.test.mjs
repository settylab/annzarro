/**
 * Level ids (plan 1.6): the helpers around canonLabel. canonLabel itself runs the shared vector file in
 * level-id-vectors.test.mjs.
 *
 * Run:  node --test annzarro/tests/js/level-id.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const L = await import('../../../static/js/utils/level-id.js');

test('the vector test no longer skips: the module exists and exports canonLabel', () => {
    assert.equal(typeof L.canonLabel, 'function');
});

test('a bigint is its digits, a null or NaN is @na, a boolean is tested before a number', () => {
    assert.equal(L.canonLabel(9223372036854775807n), 'c:9223372036854775807');
    assert.equal(L.canonLabel(undefined), '@na');
    assert.equal(L.canonLabel(null), '@na');
    assert.equal(L.canonLabel(NaN), '@na');
    assert.equal(L.canonLabel(true), 'c:true');
    assert.equal(L.canonLabel(1), 'c:1');
});

test('bin ids count from 0 and the reserved ids are the frozen ones', () => {
    assert.equal(L.binId(0), 'bin:0');
    assert.equal(L.binId(12), 'bin:12');
    assert.deepEqual({ ...L.RESERVED }, { zero: '@zero', in: '@in', out: '@out', other: '@other', na: '@na', small: '@small' });
});

test('a group key is JSON with nothing escaped but quotes, backslashes and control characters', () => {
    assert.equal(L.canonKey(['c:B cell', 'bin:0']), '["c:B cell","bin:0"]');
    assert.equal(L.canonKey(['c:é', 'c:日本']), '["c:é","c:日本"]');
    assert.equal(L.canonKey(['c:a\nb']), '["c:a\\nb"]');
    assert.equal(L.groupLevelId(['c:B cell', 'bin:0']), 'g:["c:B cell","bin:0"]');
});

test('parseLevelId reads every kind of id back, and nothing else', () => {
    assert.deepEqual(L.parseLevelId('c:T cell'), { kind: 'category', text: 'T cell' });
    assert.deepEqual(L.parseLevelId('c:'), { kind: 'category', text: '' });
    assert.deepEqual(L.parseLevelId('c:c:x'), { kind: 'category', text: 'c:x' });
    assert.deepEqual(L.parseLevelId('bin:3'), { kind: 'bin', index: 3 });
    assert.deepEqual(L.parseLevelId('g:["c:a","bin:0"]'), { kind: 'group', key: ['c:a', 'bin:0'] });
    for (const id of ['@zero', '@in', '@out', '@other', '@na', '@small']) assert.deepEqual(L.parseLevelId(id), { kind: 'reserved', id });
    for (const bad of ['', 'T cell', 'bin:x', 'bin:-1', 'bin:1.5', '@nothing', 'g:[1]', 'g:{', 'g:"a"', null, 7]) {
        assert.equal(L.parseLevelId(bad), null, String(bad));
    }
});

test('a category called other is not the reserved other', () => {
    assert.deepEqual(L.parseLevelId('c:other'), { kind: 'category', text: 'other' });
    assert.notEqual(L.canonLabel('other'), L.RESERVED.other);
});
