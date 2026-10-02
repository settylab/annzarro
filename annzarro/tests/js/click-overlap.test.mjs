/**
 * A point drawn under its neighbours can be clicked.
 *
 * Plotly reports the point on top, so the paper's example monocyte
 * (Mature_Young_2#TCAATTCAGTGAGGCT-1 on view D's cell-type UMAP, with 27
 * other cells within 4 px) could not be focused by clicking it. Now the
 * click focuses the point nearest the mouse, and clicking the same spot
 * again steps outward through the overlapping ones. Headless: the first
 * click on the monocyte's position focuses it (protocol-integration focused
 * Mature_Old_2#GTGGGAAGTATAGGGC-1 on every click).
 *
 * Run:  node --test annzarro/tests/js/click-overlap.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    getElementById: () => null, addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => []
};
globalThis.fetch = async () => ({ ok: false, statusText: 'test' });

const { nextOverlappingEntity } = await import('../../../static/js/panels/plot-utilities/plot-make-helper.js');

const axis = { c2p: v => v };   // 1 data unit = 1 px
const gd = {
    _fullLayout: { xaxis: axis, yaxis: axis },
    data: [
        { name: 'Monocyte', x: [10, 10.5, 12, 50], y: [10, 10, 11, 50], customdata: ['hidden', 'near', 'far', 'away'] },
        { name: 'cMoP', x: [10.2], y: [9.9], customdata: ['top'] },
        { name: 'Focused Cell', x: [10], y: [10], customdata: ['ignored'] }
    ]
};

test('the first click focuses the point nearest the mouse, not the one on top', () => {
    assert.equal(nextOverlappingEntity(gd, { x: 10.2, y: 9.9 }, 'top', 'someone else', { x: 10, y: 10 }), 'hidden');
});

test('clicking the same spot again steps through the overlapping points', () => {
    const order = [];
    let current = 'someone else';
    for (let k = 0; k < 5; k++) {
        current = nextOverlappingEntity(gd, { x: 10.2, y: 9.9 }, 'top', current, { x: 10, y: 10 });
        order.push(current);
    }
    assert.deepEqual(order, ['hidden', 'top', 'near', 'far', 'hidden']);
});

test('a lone point, a 3D plot or no layout keep Plotly\'s pick', () => {
    assert.equal(nextOverlappingEntity(gd, { x: 50, y: 50 }, 'away', null, { x: 50, y: 50 }), 'away');
    assert.equal(nextOverlappingEntity({ ...gd, data: [{ ...gd.data[0], type: 'scatter3d' }] }, { x: 10, y: 10 }, 'hidden', null), 'hidden');
    assert.equal(nextOverlappingEntity({ data: [] }, { x: 1 }, 'a', null), 'a');
});
