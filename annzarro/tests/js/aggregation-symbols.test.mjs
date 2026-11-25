/**
 * The symbols of the aggregations (static/js/utils/aggregation-symbols.js, aggregation-unify-080.md section 1): one symbol
 * string never stands for two different meanings, across a signature's methods, a group's statistics and the Cell-Gene
 * Plot's measures. The same meaning may share one (z\u0304 is the z-score mean of both, x\u0304 the mean, \u03a3 the sum).
 *
 * Run:  node --test annzarro/tests/js/aggregation-symbols.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { SCORE_SYMBOLS, STAT_SYMBOLS, MEASURE_SYMBOLS } = await import('../../../static/js/utils/aggregation-symbols.js');
const { METHOD_INFO } = await import('../../../static/js/utils/signature-options.js');
const { STATISTIC_INFO } = await import('../../../static/js/utils/group-statistics.js');

const key = (s) => `${s.over ? 'bar:' : ''}${s.text}`;
const nameIn = (info) => Object.fromEntries(info.map((m) => [m.value, m.label]));
const NAMES = {
    SCORE_SYMBOLS: nameIn(METHOD_INFO), STAT_SYMBOLS: nameIn(STATISTIC_INFO),
    MEASURE_SYMBOLS: { ...nameIn(STATISTIC_INFO), count: 'Cell count', same: 'Same as Color' }
};

test('no symbol stands for two different meanings across the three tables', () => {
    const meaning = new Map();
    for (const [table, symbols] of Object.entries({ SCORE_SYMBOLS, STAT_SYMBOLS, MEASURE_SYMBOLS })) {
        for (const [value, symbol] of Object.entries(symbols)) {
            const name = NAMES[table][value];
            assert.ok(name, `${table}.${value} has a name`);
            const held = meaning.get(key(symbol));
            if (held === undefined) meaning.set(key(symbol), name);
            else assert.equal(held, name, `${key(symbol)} stands for "${held}" and for "${name}" (${table}.${value})`);
        }
    }
});

test('% expressing and % of total are told apart', () => {
    assert.equal(STAT_SYMBOLS.pct_expressing.text, '%\u207a');
    assert.equal(SCORE_SYMBOLS.fraction_of_total.text, '%');
});
