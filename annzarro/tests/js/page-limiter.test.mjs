/**
 * The page runs at most two computations at once across every derived store (SHR-31): score-source.js makes the one
 * limiter and gives it to the score store. A second kind of store given the same limiter shares the two slots.
 *
 * Run:  node --test annzarro/tests/js/page-limiter.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const SS = await import('../../../static/js/utils/score-source.js');

test('the score store shares the page limiter', () => {
    const limiter = SS.pageLimiter();
    assert.equal(limiter.max, 2);
    assert.equal(SS.pageLimiter(), limiter, 'one per page');
    const { store } = SS.scores();
    assert.equal(store.stats().active, 0);
    assert.equal(limiter.tryTake(), true, 'another store takes a slot of the page limiter');
    assert.equal(store.stats().active, 1, 'and the score store sees it');
    limiter.release();
    assert.equal(store.stats().active, 0);
});
