import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../../../static/js/utils/consumer-kinds.js';

test('the table names every kind a source can be read by, and what each counts as', () => {
    assert.deepEqual(Object.keys(K.CONSUMER_KINDS).sort(), ['grouping', 'inspect', 'inspect-export', 'plot', 'table']);
    assert.equal(K.countsAs('plot'), 'plots');
    assert.equal(K.countsAs('table'), 'tables');
    assert.equal(K.countsAs('grouping'), 'groupings');
    assert.equal(K.countsAs('inspect'), null);
    assert.equal(K.countsAs('inspect-export'), null);
});

test('only plots, tables and groupings are consumers; Inspect and its export are not', () => {
    for (const kind of ['plot', 'table', 'grouping']) assert.equal(K.isConsumer(kind), true, kind);
    for (const kind of ['inspect', 'inspect-export']) assert.equal(K.isConsumer(kind), false, kind);
});

test('an unknown or missing kind throws, naming it', () => {
    assert.throws(() => K.countsAs('heatmap'), /Unknown consumer kind 'heatmap'/);
    assert.throws(() => K.isConsumer(undefined), /Unknown consumer kind 'undefined'/);
    assert.throws(() => K.isConsumer(''), /Unknown consumer kind ''/);
    assert.throws(() => K.countsAs('toString'), /Unknown consumer kind 'toString'/);
});

test('a usage row has one count per counted kind, all zero to begin with', () => {
    assert.deepEqual(K.emptyUsage('mean'), { value: 'mean', plots: 0, tables: 0, groupings: 0 });
    assert.deepEqual(K.COUNT_FIELDS, ['plots', 'tables', 'groupings']);
});

test('the table is frozen', () => {
    assert.throws(() => { 'use strict'; K.CONSUMER_KINDS.extra = {}; }, TypeError);
    assert.throws(() => { 'use strict'; K.CONSUMER_KINDS.plot.counts = 'x'; }, TypeError);
});
