/**
 * The gap between sections of a Cell-Gene Plot (panels/cell-gene/draw-annotations.js sectionGap): `gap` columns, a column
 * counting for at most GAP_COLUMN_PX of it, so two one-row sections sit side by side, not a stretched column apart, while a
 * plot of many gene columns keeps the gap it always had.
 *
 * Run:  node --test annzarro/tests/js/section-gap.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { sectionGap, GAP_COLUMN_PX } = await import('../../../static/js/panels/cell-gene/draw-annotations.js');

test('many gene columns: the gap is the setting, as it always was', () => {
    assert.equal(sectionGap(1, 62, 1, 700), 1);          // a column is 11 px
    assert.equal(sectionGap(2, 12, 1, 700), 2);          // 700 / 14 = 50 px, under the limit
    assert.equal(sectionGap(1, 12, 1, 726), 1);          // 56 px
});

test('two one-row sections across a wide plot: the gap is GAP_COLUMN_PX, not a whole stretched column', () => {
    const gap = sectionGap(1, 2, 1, 726);
    const pitch = (726 - GAP_COLUMN_PX) / 2;               // the columns that remain
    assert.ok(Math.abs(gap - GAP_COLUMN_PX / pitch) < 1e-9, String(gap));
    assert.ok(gap < 0.25, `a fifth of a column or less: ${gap}`);
    // the pixels of the gap are the same whatever the width
    assert.ok(Math.abs(sectionGap(1, 2, 1, 1500) * ((1500 - GAP_COLUMN_PX) / 2) - GAP_COLUMN_PX) < 1e-6);
});

test('a bigger setting widens the gap in columns, in the same px; no gap, no sections, no width: unchanged', () => {
    assert.ok(sectionGap(3, 2, 1, 726) > sectionGap(1, 2, 1, 726));
    assert.equal(sectionGap(0, 2, 1, 726), 0);
    assert.equal(sectionGap(1, 2, 0, 726), 1);
    assert.equal(sectionGap(1, 2, 1, 0), 1);
});

test('mixed one-row and gene sections: the gap shrinks only as far as the columns are wide', () => {
    const wide = sectionGap(1, 3, 2, 726);                  // three columns, two gaps: wide
    const genes = sectionGap(1, 40, 2, 726);                // many gene columns: unchanged
    assert.ok(wide < 1 && genes === 1, `${wide} ${genes}`);
});
