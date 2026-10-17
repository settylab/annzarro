// The rules of the toast notices: which notice may replace which, and how long one stays.
//
// Run: `node --test annzarro/tests/js/notice-rules.test.mjs`. Also driven by test_js_suites.py.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    SEVERITY, severityRank, mayReplace, noticeDuration, planReplacement,
    MIN_SUCCESS_MS, MIN_NOTICE_MS, MAX_NOTICE_MS,
} from '../../../static/js/utils/notice-rules.js';

test('severity runs success, info, warning, error', () => {
    assert.ok(SEVERITY.success < SEVERITY.info && SEVERITY.info < SEVERITY.warning && SEVERITY.warning < SEVERITY.error);
    assert.equal(severityRank('nonsense'), SEVERITY.info);
});

test('a notice replaces one of equal or lower severity, never a higher one', () => {
    for (const a of Object.keys(SEVERITY)) {
        for (const b of Object.keys(SEVERITY)) {
            assert.equal(mayReplace(a, b), SEVERITY[b] >= SEVERITY[a], `${a} -> ${b}`);
        }
    }
    assert.equal(mayReplace('error', 'info'), false);
    assert.equal(mayReplace('error', 'error'), true);
});

test('planReplacement keeps the more severe toasts and replaces the rest', () => {
    const shown = [{ id: 'a', type: 'error' }, { id: 'b', type: 'warning' }, { id: 'c', type: 'info' }];
    assert.deepEqual(planReplacement(shown, 'info'), { replace: ['c'], keep: ['a', 'b'] });
    assert.deepEqual(planReplacement(shown, 'warning'), { replace: ['b', 'c'], keep: ['a'] });
    assert.deepEqual(planReplacement(shown, 'error'), { replace: ['a', 'b', 'c'], keep: [] });
    assert.deepEqual(planReplacement([], 'info'), { replace: [], keep: [] });
});

test('an error stays until closed, whatever the length', () => {
    assert.equal(noticeDuration('error', 'Oops', 'short'), 0);
    assert.equal(noticeDuration('error', 'Oops', 'x '.repeat(300)), 0);
});

test('a short notice gets the floor of its type', () => {
    assert.equal(noticeDuration('success', 'Copied', ''), MIN_SUCCESS_MS);
    assert.equal(noticeDuration('info', 'Title', 'A few words here.'), MIN_NOTICE_MS);
    assert.equal(noticeDuration('warning', 'Title', 'A few words here.'), MIN_NOTICE_MS);
});

test('a long notice scales with its words, up to a cap', () => {
    const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
    assert.equal(noticeDuration('info', '', words(60)), 60 * 200);
    assert.equal(noticeDuration('warning', 'two words', words(58)), 60 * 200);
    assert.equal(noticeDuration('info', '', words(1000)), MAX_NOTICE_MS);
});

test('an explicit duration wins, including 0 (until closed)', () => {
    assert.equal(noticeDuration('info', 'a', 'b', 12000), 12000);
    assert.equal(noticeDuration('info', 'a', 'b', 0), 0);
    assert.equal(noticeDuration('error', 'a', 'b', 3000), 3000);
});
