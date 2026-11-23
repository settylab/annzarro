/**
 * X7: the Cell-Gene Plot's clicks (CXG-15), without a page. What a click on the plot means, from what Plotly says of it
 * (a point's coordinates and axes, or a tick label's axis and value) and the drawing's model:
 *
 *   - a dot or cell of a gene row, or a gene's label, is that gene (it is focused);
 *   - a one-row section's row and a row with no genes are no gene: the click means nothing;
 *   - a group's label is that group, offered Open grouping only when the groups are a Cell Grouping's;
 *   - the bands (strips, totals, dendrograms, legends) are on axes of their own and mean nothing;
 *   - gaps between sections, swap, and a gene in two sections are each placed as the drawing places them;
 *   - the focused gene's positions on the gene axis, to mark its labels.
 *
 * Run:  node --test annzarro/tests/js/cell-gene-clicks.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { CLICKS_PART } from '../../../static/js/panels/cell-gene/clicks.js';

const { targetOfPoint, targetOfTick, focusedPositions } = CLICKS_PART;

const G = (labels) => labels.map((label) => ({ label, n: 10 }));
const gene = (label, extra = {}) => ({ kind: 'gene', label, section: { index: 0, title: 'Markers' }, ...extra });

/** Two sections with a gap of one between them: genes A B C at 0 1 2, then the pathway's one row at 4, then D at 5. */
function model(fields = {}) {
    return {
        mode: 'dots', swap: false,
        groups: G(['B cells', 'T cells', 'NK']),
        rows: [
            gene('A'), gene('B'), gene('C'),
            { kind: 'set', label: 'Pathway', section: { index: 1, title: 'Pathway' }, own: { color: { id: 'm', label: 'mean' } }, gapBefore: 1 },
            gene('D', { section: { index: 2, title: 'More' } })
        ],
        ...fields
    };
}

/** A Plotly point of a matrix trace: main axes (no xaxis/yaxis on the trace). */
const point = (x, y, data = {}) => ({ x, y, data });

// ------------------------------------------------------------------ a dot or a cell

test('a dot of a gene row is that gene, the gaps between sections skipped', () => {
    const m = model();
    assert.deepEqual(targetOfPoint(point(0, 1), m), { gene: 'A' });
    assert.deepEqual(targetOfPoint(point(2, 0), m), { gene: 'C' });
    assert.deepEqual(targetOfPoint(point(5, 2), m), { gene: 'D' }, 'D is drawn at 5: the gap before the pathway takes 3');
});

test('swapped, the genes are on y and the groups on x', () => {
    const m = model({ swap: true });
    assert.deepEqual(targetOfPoint(point(1, 0), m), { gene: 'A' });
    assert.deepEqual(targetOfPoint(point(2, 5), m), { gene: 'D' });
    assert.equal(targetOfPoint(point(0, 3), m), null, 'the gap is no row');
});

test('a one-row section is not a gene: its dot means nothing', () => {
    const m = model();
    assert.equal(targetOfPoint(point(4, 0), m), null);
    assert.equal(targetOfPoint(point(4, 0), model({ mode: 'heatmap' })), null);
});

test('a row with no genes (an empty section) means nothing', () => {
    const m = model({ rows: [{ kind: 'empty', label: 'No gene of Markers is in this dataset.', section: { index: 0, title: 'Markers' } }, gene('A')] });
    assert.equal(targetOfPoint(point(0, 0), m), null);
    assert.deepEqual(targetOfPoint(point(1, 0), m), { gene: 'A' });
});

test('a heatmap cell, a cell with no value and a placeholder row of a gene are that gene', () => {
    const m = model({ mode: 'heatmap', rows: [gene('A'), gene('B', { pending: true })] });
    assert.deepEqual(targetOfPoint(point(0, 2), m), { gene: 'A' });
    assert.deepEqual(targetOfPoint(point(1, 2), m), { gene: 'B' });
});

test('a point on a band or a legend (an axis of its own) means nothing', () => {
    const m = model();
    assert.equal(targetOfPoint(point(0, 1, { xaxis: 'x90', yaxis: 'y90' }), m), null, 'a strip');
    assert.equal(targetOfPoint(point(1, 1, { xaxis: 'x2', yaxis: 'y2' }), m), null, 'the size legend');
    assert.deepEqual(targetOfPoint(point(1, 1, { xaxis: 'x', yaxis: 'y' }), m), { gene: 'B' }, 'the main axes named');
});

test('a point off the matrix, or with no drawing, means nothing', () => {
    const m = model();
    assert.equal(targetOfPoint(point(99, 0), m), null);
    assert.equal(targetOfPoint(point(0.5, 0), m), null);
    assert.equal(targetOfPoint(point(0, 0), null), null);
    assert.equal(targetOfPoint(null, m), null);
});

// ------------------------------------------------------------------ a label

test("a gene's label is that gene, on x or, swapped, on y", () => {
    assert.deepEqual(targetOfTick('x', 5, model(), null), { gene: 'D' });
    assert.deepEqual(targetOfTick('y', 1, model({ swap: true }), null), { gene: 'B' });
});

test("a one-row section's label means nothing", () => {
    assert.equal(targetOfTick('x', 4, model(), 'cell-grouping-A'), null);
});

test("a group's label offers its grouping when the groups are a Cell Grouping's", () => {
    assert.deepEqual(targetOfTick('y', 1, model(), 'cell-grouping-A'), { group: 1, label: 'T cells', grouping: 'cell-grouping-A' });
    assert.deepEqual(targetOfTick('x', 2, model({ swap: true }), 'cell-grouping-A'), { group: 2, label: 'NK', grouping: 'cell-grouping-A' });
});

test("with an obs column as the groups, a group's label offers nothing", () => {
    assert.equal(targetOfTick('y', 1, model(), null), null);
});

test('a label off the axis means nothing', () => {
    assert.equal(targetOfTick('y', 7, model(), 'cell-grouping-A'), null);
    assert.equal(targetOfTick('x', 3, model(), null), null, 'the gap');
});

// ------------------------------------------------------------------ the focused gene's mark

test("the focused gene's positions: each row of it, in every section", () => {
    const m = model({ rows: [gene('A'), gene('B'), gene('A', { section: { index: 1, title: 'Again' }, gapBefore: 1 })] });
    assert.deepEqual([...focusedPositions(m, 'A')].sort(), [0, 3]);
    assert.deepEqual([...focusedPositions(m, 'B')], [1]);
    assert.equal(focusedPositions(m, 'Z').size, 0);
    assert.equal(focusedPositions(m, null).size, 0);
});

test("a one-row section titled like a gene is not marked as that gene", () => {
    const m = model({ rows: [gene('A'), { kind: 'set', label: 'A', section: { index: 1, title: 'A' }, gapBefore: 1 }] });
    assert.deepEqual([...focusedPositions(m, 'A')], [0]);
});

test('the index of a drawing is made once, not per click', () => {
    const N = 20000;
    let reads = 0;
    const rows = Array.from({ length: N }, (_, r) => {
        const row = gene(`G${r}`);
        const label = row.label;
        Object.defineProperty(row, 'label', { get() { reads++; return label; }, enumerable: true });
        return row;
    });
    const m = { mode: 'heatmap', swap: false, groups: G(['a', 'b']), rows };
    for (let i = 0; i < 200; i++) targetOfPoint(point(i, 0), m);
    for (let i = 0; i < 200; i++) focusedPositions(m, `G${i}`);
    assert.ok(reads <= N + 400, `the rows are read once per drawing, then once per click (${reads} reads)`);
    assert.deepEqual(targetOfPoint(point(N - 1, 1), m), { gene: `G${N - 1}` });
});

// ------------------------------------------------------------------ one rule for where a row is

test("draw.js places the rows where rowCoordinates says, gaps included (its own copy of the rule must not drift)", async () => {
    const { buildFigure } = await import('../../../static/js/panels/cell-gene/draw.js');
    const { rowCoordinates } = await import('../../../static/js/panels/cell-gene/draw-annotations.js');
    const gaps = [0, 0, 2, 0, 1, 0, 0, 3];
    const rows = gaps.map((gapBefore, r) => ({ kind: 'gene', label: `Gene${r}`, gapBefore, section: { index: r, title: `S${r}` } }));
    const values = Float64Array.from({ length: rows.length }, (_, r) => r);
    for (const swap of [false, true]) {
        const fig = buildFigure({
            mode: 'dots', swap, groups: [{ label: 'g', n: 10 }], rows,
            color: { id: 'mean|X', stat: 'mean', layer: 'X', scaling: 'none', values, colorscale: 'Viridis' },
            size: { none: 'One size.' }
        });
        const drawn = fig.data[0][swap ? 'y' : 'x'];
        assert.deepEqual(Array.from(drawn), rowCoordinates(rows).pos, swap ? 'swapped' : 'not swapped');
        assert.deepEqual(Array.from(drawn), [0, 1, 4, 5, 7, 8, 9, 13]);
    }
});
