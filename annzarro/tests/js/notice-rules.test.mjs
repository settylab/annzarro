// The rules of the toast notices: which notice may replace which, and how long one stays.
//
// Run: `node --test annzarro/tests/js/notice-rules.test.mjs`. Also driven by test_js_suites.py.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    SEVERITY, severityRank, mayReplace, noticeDuration, planReplacement,
    joinNotices, focusOutsideSubsetNotice, fingerprintPendingNotice, removedColumnsNotice,
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

test('joinNotices: none is null, one is itself, several are one toast that keeps every title', () => {
    assert.equal(joinNotices([]), null);
    assert.equal(joinNotices([null, undefined]), null);
    assert.deepEqual(joinNotices([{ title: 'A', message: 'a.' }]), { title: 'A', message: 'a.' });
    assert.deepEqual(joinNotices([{ title: 'A', message: 'a.' }, null, { title: 'B', message: 'b.' }]),
        { title: 'A', message: 'a.\n\nB: b.' });
});

test('the focus-outside-subset notice has one text for a link and for a dataset load', () => {
    const n = focusOutsideSubsetNotice('AAAC-1');
    assert.equal(n.title, 'Focused cell not in the subset');
    assert.match(n.message, /^AAAC-1 is not among the cells shown, so it is not focused\./);
    assert.match(n.message, /cannot read a cell outside the subset/);
});

test('the fingerprint notice names the link or the save, in sentence case, in few words', () => {
    const link = fingerprintPendingNotice('link');
    const saved = fingerprintPendingNotice('saved');
    assert.equal(link.title, 'Link made before the names were checked');
    assert.equal(saved.title, 'Saved before the names were checked');
    assert.match(link.message, /Make the link again/);
    assert.match(saved.message, /Save again/);
    for (const n of [link, saved]) assert.ok(n.message.split(/\s+/).length <= 35, n.message);
});

test('removed columns: one column reads as a title, several tables as one toast', () => {
    assert.equal(removedColumnsNotice([]), null);
    assert.equal(removedColumnsNotice([{ title: 'Cell Table 1', keys: [] }]), null);
    const one = removedColumnsNotice([{ title: 'Cell Table 1', keys: ['expr (focused gene)'] }]);
    assert.equal(one.title, 'Cell Table 1: column expr (focused gene) removed');
    assert.match(one.message, /Add it again/);
    const many = removedColumnsNotice([{ title: 'Cell Table 1', keys: ['a', 'b'] }, { title: 'Gene Table', keys: ['c'] }]);
    assert.equal(many.title, '3 columns removed');
    assert.match(many.message, /Cell Table 1: a, b\nGene Table: c/);
    assert.match(many.message, /Add them again/);
});
